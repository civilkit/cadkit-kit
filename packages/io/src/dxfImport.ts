// DXF geometry -> sketch points and entities. Pure: the caller adds the result to the open draft (mergeIntoDraft) and
// sends it through the usual apply path, so the kernel solves and previews it like any other edit.
//
//  - units come from $INSUNITS (inches, feet, cm, m ... converted to mm; unitless and 4 = mm), the DXF Y axis is the sketch v axis;
//  - end points that agree within 1e-6 mm share one sketch point, so connected outlines close for extrude / revolve;
//  - LINE, CIRCLE, ARC, LWPOLYLINE / POLYLINE (bulges become arcs), SPLINE (fit points become a fit `spline`, clamped-uniform
//    control points a `cvspline`, anything else is sampled into lines), POINT; layer CONSTRUCTION marks construction geometry;
//  - no constraints are written, the sketch is as drawn.
import { nextId, type DraftEntity, type DraftPoint, type SketchDraft } from '@kit/sketch';
import { parseDxf, unitScale, DxfError, type DxfEntity, type DxfFile, type DxfV } from './dxfRead';

export const MAX_DXF_ENTITIES = 20000;
/** Coordinates beyond this (mm, from the sketch origin) are refused: the drawing is in a survey or map frame, not a part. */
export const MAX_DXF_COORD = 1e6;
const MERGE_TOL = 1e-6;

export type DxfImportError =
  | { code: 'tooMany'; count: number; max: number }
  | { code: 'nothing'; unsupported: Record<string, number> }
  | { code: 'range'; max: number }
  | { code: 'binary' | 'notDxf'; message: string };

export interface DxfImportOk {
  ok: true;
  points: DraftPoint[];
  entities: DraftEntity[];
  /** Millimetres per drawing unit that was applied and the `$INSUNITS` it came from. */
  scale: number;
  insunits: number;
  /** Unit code the file used that we do not convert (taken as millimetres); null when fine. */
  unknownUnits: number | null;
  unsupported: Record<string, number>;
  /** Entities dropped because they have no length (zero-length lines, zero-radius circles). */
  degenerate: number;
  /** Splines that were sampled into line segments. */
  sampled: number;
}
export type DxfImportResult = DxfImportOk | { ok: false; error: DxfImportError };

const rad = (d: number) => (d * Math.PI) / 180;

/** Evaluate a B-spline (de Boor) at `t`, knots given. */
function deBoor(deg: number, knots: number[], ctl: DxfV[], t: number): DxfV {
  const n = ctl.length;
  let k = deg;
  while (k < n - 1 && t >= knots[k + 1]) k++;
  const d = ctl.slice(k - deg, k + 1).map((p) => ({ ...p }));
  for (let r = 1; r <= deg; r++) {
    for (let j = deg; j >= r; j--) {
      const lo = knots[k - deg + j], hi = knots[k + 1 + j - r];
      const a = hi - lo === 0 ? 0 : (t - lo) / (hi - lo);
      d[j] = { x: (1 - a) * d[j - 1].x + a * d[j].x, y: (1 - a) * d[j - 1].y + a * d[j].y };
    }
  }
  return d[deg];
}

/** Open, non-rational B-spline whose knots are the kernel's own (clamped, uniform): a `cvspline` is exactly that curve. */
function isClampedUniform(deg: number, knots: number[], n: number): boolean {
  if (deg < 1 || deg > 9 || n < deg + 1 || knots.length !== n + deg + 1) return false;
  const lo = knots[0], hi = knots[knots.length - 1];
  const span = n - deg;
  if (!(hi > lo)) return false;
  const step = (hi - lo) / span;
  const eps = step * 1e-6;
  for (let i = 0; i < knots.length; i++) {
    const want = lo + step * Math.min(Math.max(i - deg, 0), span);
    if (Math.abs(knots[i] - want) > eps) return false;
  }
  return true;
}

export function dxfToSketch(input: string | DxfFile): DxfImportResult {
  let file: DxfFile;
  try { file = typeof input === 'string' ? parseDxf(input) : input; } catch (e) {
    if (e instanceof DxfError && (e.code === 'binary' || e.code === 'notDxf')) return { ok: false, error: { code: e.code, message: e.message } };
    throw e;
  }
  if (file.entities.length > MAX_DXF_ENTITIES) return { ok: false, error: { code: 'tooMany', count: file.entities.length, max: MAX_DXF_ENTITIES } };
  const known = unitScale(file.insunits);
  const scale = known ?? 1;

  const points: DraftPoint[] = [];
  const entities: DraftEntity[] = [];
  const grid = new Map<string, number>();
  let overflow = false, degenerate = 0, sampled = 0;
  const cell = (v: number) => Math.round(v / MERGE_TOL);

  /** The sketch point at (x, y) in mm, reusing one within 1e-6. */
  const pointAt = (x0: number, y0: number): string => {
    // trig leaves 1e-16 noise on centres and arc ends: snap to 1e-9 mm
    const x = Math.round(x0 * 1e9) / 1e9, y = Math.round(y0 * 1e9) / 1e9;
    if (Math.abs(x) > MAX_DXF_COORD || Math.abs(y) > MAX_DXF_COORD || !Number.isFinite(x) || !Number.isFinite(y)) overflow = true;
    const cx = cell(x), cy = cell(y);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const i = grid.get(`${cx + dx},${cy + dy}`);
      if (i !== undefined && Math.abs(points[i].x - x) <= MERGE_TOL && Math.abs(points[i].y - y) <= MERGE_TOL) return points[i].id;
    }
    const id = `p${points.length + 1}`;
    points.push({ id, x, y });
    grid.set(`${cx},${cy}`, points.length - 1);
    return id;
  };
  const S = (v: DxfV): DxfV => ({ x: v.x * scale, y: v.y * scale });
  const add = (e: Record<string, unknown>, layer: string) => {
    const id = `e${entities.length + 1}`;
    entities.push({ id, ...e, ...(/^construction$/i.test(layer) && e.type !== 'point' ? { construction: true } : {}) });
  };
  const line = (a: DxfV, b: DxfV, layer: string) => {
    const p1 = pointAt(a.x, a.y), p2 = pointAt(b.x, b.y);
    if (p1 === p2) { degenerate++; return; }
    add({ type: 'line', p1, p2 }, layer);
  };
  const arc = (c: DxfV, r: number, a0: number, a1: number, layer: string) => {
    if (!(r > MERGE_TOL)) { degenerate++; return; }
    const sweep = (((a1 - a0) % 360) + 360) % 360;
    if (sweep < 1e-9) { add({ type: 'circle', c: pointAt(c.x, c.y), r }, layer); return; }
    const cp = pointAt(c.x, c.y);
    const p1 = pointAt(c.x + r * Math.cos(rad(a0)), c.y + r * Math.sin(rad(a0)));
    const p2 = pointAt(c.x + r * Math.cos(rad(a1)), c.y + r * Math.sin(rad(a1)));
    if (p1 === p2) { degenerate++; return; }
    add({ type: 'arc', c: cp, p1, p2 }, layer);
  };

  for (const raw of file.entities as DxfEntity[]) {
    const layer = raw.layer;
    switch (raw.type) {
      case 'LINE': line(S(raw.a), S(raw.b), layer); break;
      case 'CIRCLE': {
        const r = raw.r * scale;
        if (r > MERGE_TOL) add({ type: 'circle', c: pointAt(raw.c.x * scale, raw.c.y * scale), r }, layer); else degenerate++;
        break;
      }
      case 'ARC': arc(S(raw.c), raw.r * scale, raw.a0, raw.a1, layer); break;
      case 'POINT': { const p = S(raw.p); add({ type: 'point', p: pointAt(p.x, p.y) }, layer); break; }
      case 'POLYLINE': {
        const v = raw.verts.map((q) => ({ ...S(q), bulge: q.bulge }));
        const n = v.length;
        const segs = raw.closed ? n : n - 1;
        for (let i = 0; i < segs; i++) {
          const a = v[i], b = v[(i + 1) % n];
          const d = Math.hypot(b.x - a.x, b.y - a.y);
          if (d <= MERGE_TOL) { if (n > 1) degenerate++; continue; }
          if (Math.abs(a.bulge) < 1e-9) { line(a, b, layer); continue; }
          // bulge = tan(included angle / 4); positive runs counter-clockwise from a to b. The centre lies on the left of
          // a->b for a counter-clockwise minor arc, and flips side for a major arc (tan of half the angle changes sign).
          const theta = 4 * Math.atan(a.bulge);
          const h = d / 2 / Math.tan(theta / 2);
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          const c = { x: mx + (-(b.y - a.y) / d) * h, y: my + ((b.x - a.x) / d) * h };
          const cp = pointAt(c.x, c.y);
          const pa = pointAt(a.x, a.y), pb = pointAt(b.x, b.y);
          if (pa === pb) { degenerate++; continue; }
          // counter-clockwise arcs run p1 -> p2: a bulge < 0 is the same arc walked from b to a
          add({ type: 'arc', c: cp, p1: a.bulge > 0 ? pa : pb, p2: a.bulge > 0 ? pb : pa }, layer);
        }
        break;
      }
      case 'SPLINE': {
        const fit = raw.fit.map(S), ctl = raw.controls.map(S);
        const distinct = (pts: DxfV[]) => pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) > MERGE_TOL);
        if (fit.length >= 2) {
          let pts = distinct(fit);
          let closed = raw.closed;
          if (pts.length > 2 && Math.hypot(pts[0].x - pts.at(-1)!.x, pts[0].y - pts.at(-1)!.y) <= MERGE_TOL) { pts = pts.slice(0, -1); closed = true; }
          if (pts.length >= (closed ? 3 : 2)) { add({ type: 'spline', pts: pts.map((p) => pointAt(p.x, p.y)), ...(closed ? { closed: true } : {}) }, layer); break; }
          degenerate++; break;
        }
        if (ctl.length >= 2) {
          if (!raw.closed && !raw.rational && isClampedUniform(raw.degree, raw.knots, ctl.length)) {
            add({ type: 'cvspline', pts: ctl.map((p) => pointAt(p.x, p.y)), degree: raw.degree }, layer);
            break;
          }
          // anything else (non-uniform knots, rational, periodic): sample the curve into line segments
          const deg = Math.round(raw.degree);
          if (deg >= 1 && ctl.length >= deg + 1 && raw.knots.length === ctl.length + deg + 1 && !raw.closed) {
            const t0 = raw.knots[deg], t1 = raw.knots[ctl.length];
            const samples = Math.min(Math.max(ctl.length * 8, 16), 256);
            const out: DxfV[] = [];
            for (let i = 0; i <= samples; i++) out.push(deBoor(deg, raw.knots, ctl, t0 + ((t1 - t0) * i) / samples - (i === samples ? 1e-12 * (t1 - t0) : 0)));
            for (let i = 0; i + 1 < out.length; i++) line(out[i], out[i + 1], layer);
            sampled++;
            break;
          }
          // no usable knot vector: the control polygon is the best we have
          for (let i = 0; i + 1 < ctl.length; i++) line(ctl[i], ctl[i + 1], layer);
          sampled++;
          break;
        }
        degenerate++;
        break;
      }
    }
    if (entities.length > MAX_DXF_ENTITIES) return { ok: false, error: { code: 'tooMany', count: entities.length, max: MAX_DXF_ENTITIES } };
  }
  if (overflow) return { ok: false, error: { code: 'range', max: MAX_DXF_COORD } };
  if (!entities.length) return { ok: false, error: { code: 'nothing', unsupported: file.unsupported } };
  return { ok: true, points, entities, scale, insunits: file.insunits, unknownUnits: known === null ? file.insunits : null, unsupported: file.unsupported, degenerate, sampled };
}

/** Append an import to a draft: ids are renumbered after the draft's own (p/e), references follow. Returns a new draft. */
export function mergeIntoDraft(draft: SketchDraft, imp: Pick<DxfImportOk, 'points' | 'entities'>): SketchDraft {
  const pmap = new Map<string, string>();
  let acc: SketchDraft = draft;
  const points: DraftPoint[] = [], entities: DraftEntity[] = [];
  for (const p of imp.points) {
    const id = nextId(acc, 'p');
    pmap.set(p.id, id);
    points.push({ ...p, id });
    acc = { ...acc, points: [...acc.points, { id, x: 0, y: 0 }] };   // reserve the id for the next one
  }
  const refs = (v: unknown): unknown => (typeof v === 'string' && pmap.has(v) ? pmap.get(v) : Array.isArray(v) ? v.map(refs) : v);
  for (const e of imp.entities) {
    const id = nextId(acc, 'e');
    const out: DraftEntity = { id };
    for (const [k, v] of Object.entries(e)) if (k !== 'id') out[k] = k === 'p1' || k === 'p2' || k === 'c' || k === 'p' || k === 'pts' ? refs(v) : v;
    entities.push(out);
    acc = { ...acc, entities: [...acc.entities, { id }] };
  }
  return { ...draft, points: [...draft.points, ...points], entities: [...draft.entities, ...entities] };
}
