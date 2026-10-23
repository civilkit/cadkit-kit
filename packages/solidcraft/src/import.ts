// SolidCraft (.solidcraft) -> feature tree. A .solidcraft file is a zip whose `document.json` ("solidcraft/N") holds the parametric
// feature list (older files are that JSON on its own); the rest (`cache/`) is derived and ignored. SolidCraft is Z-up and this kit Y-up:
// everything is rotated by -90 degrees about X on the way in (see toYUp). Mapped from the sample files only: sketch (line, arc, circle; coincident,
// horizontal, vertical, length), extrude (total distance), box, cylinder and a constant-radius fillet. Everything else is reported
// per feature and kept as a suppressed placeholder carrying the original JSON, so the tree still regenerates and nothing is lost
// silently. Assemblies are refused as a whole. See docs/solidcraft.md.
import { zipFile } from '@kit/fcstd';
import { evalExpr, ExprError } from './expr';

export type V3 = [number, number, number];
export type FeatureJson = Record<string, unknown>;
export interface ScPart { format: 'ck-part'; version: number; name: string; features: FeatureJson[]; seq: number }

/** One line of the import report: what became of one feature of the file. */
export interface ScRow {
  id: number | string;
  name: string;
  /** SolidCraft's feature type ("sketch", "extrude", "box", ...). */
  type: string;
  status: 'converted' | 'unsupported' | 'skipped';
  /** Why a feature was not converted (unsupported) or left alone (skipped). */
  reason?: string;
  /** Things dropped from a feature that was converted (a constraint kind we do not carry): the geometry is kept as stored. */
  notes?: string[];
}
export interface ScImport {
  name: string;
  /** The part, or null when the file is refused as a whole (see `refused`). */
  part: ScPart | null;
  rows: ScRow[];
  summary: { converted: number; unsupported: number; skipped: number; notes: number };
  /** False when any feature was not converted: the geometry is then partial. */
  geometryComplete: boolean;
  /** Set when nothing was imported: not a SolidCraft file, an unknown format version family, units, or an assembly. */
  refused?: string;
}
/** Resolves points on the body built so far to kernel edge references ({faces, at}); null for a point that matches no edge. */
export type EdgeResolver = (partBefore: ScPart, points: V3[]) => Promise<Array<Record<string, unknown> | null>>;
/** Resolves points on faces of the body built so far to our face names ("F2.S.e1"); null for a point that matches no single face. */
export type FaceResolver = (partBefore: ScPart, points: V3[]) => Promise<Array<string | null>>;
export interface ImportOpts {
  /** Needed for fillets and chamfers: without it they are reported as unsupported. */
  resolver?: EdgeResolver;
  /** Needed for shells and offset faces: without it they are reported as unsupported. */
  faceResolver?: FaceResolver;
  /** Keep a suppressed `importedUnsupported` feature (with the original JSON) in the tree for each unsupported feature. Default true. */
  placeholders?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = Record<string, any>;

class Unsupported extends Error {}

/**
 * SolidCraft is Z-up and this kit is Y-up, so every point of the file is rotated by -90 degrees about X: (x, y, z) -> (x, z, -y).
 * That is a proper rotation (no mirroring): their ground plane XY becomes our top plane, their up axis becomes ours.
 */
export const toYUp = (p: V3): V3 => [p[0], p[2], -p[1]];
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** SolidCraft's origin planes: in-plane axes u, v in their world (the normal is u x v). */
const SC_PLANE: Record<string, { u: V3; v: V3 }> = {
  XY: { u: [1, 0, 0], v: [0, 1, 0] },
  XZ: { u: [1, 0, 0], v: [0, 0, -1] },
  YZ: { u: [0, 0, -1], v: [0, 1, 0] },
};
/** Our standard planes in our world: in-plane axes x, y and the normal z. */
const OUR_PLANE: Record<string, { x: V3; y: V3; z: V3 }> = {
  front: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] },
  top: { x: [1, 0, 0], y: [0, 0, -1], z: [0, 1, 0] },
  right: { x: [0, 0, -1], y: [0, 1, 0], z: [1, 0, 0] },
};
type P2 = [number, number];
/** A sketch curve in their sketch coordinates (the points as stored). */
type Geo = { type: 'line'; a: P2; b: P2 } | { type: 'arc'; a: P2; b: P2; c: P2 } | { type: 'circle'; c: P2; r: number };
const near2 = (p: P2, q: P2, tol = 1e-6) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= tol;
/** The crossing of two infinite lines, or null when they are parallel. */
function crossLines(g: Geo, h: Geo): P2 | null {
  if (g.type !== 'line' || h.type !== 'line') return null;
  const d = [g.b[0] - g.a[0], g.b[1] - g.a[1]], e = [h.b[0] - h.a[0], h.b[1] - h.a[1]];
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-12 * Math.hypot(...d) * Math.hypot(...e)) return null;
  const t = ((h.a[0] - g.a[0]) * e[1] - (h.a[1] - g.a[1]) * e[0]) / den;
  return [g.a[0] + t * d[0], g.a[1] + t * d[1]];
}
/**
 * The outline of one profile loop of theirs (curve ids in order, closed): when every curve is used whole, the ids select the region as they
 * are; when a curve is only partly used (the loop runs along part of a longer line) the ids would also pick the neighbouring regions that
 * share it, so the real outline is returned as polygon corners instead. Only straight loops can be cut down; others must be whole.
 */
function loopOutline(ids: string[], geo: Map<string, Geo>): { whole: true } | { whole: false; corners: P2[] } {
  const g = ids.map((i) => geo.get(i));
  if (g.some((x) => !x)) throw new Unsupported('a profile curve that is not in the sketch');
  const gg = g as Geo[];
  if (gg.length === 1 && gg[0].type === 'circle') return { whole: true };
  const ends = (x: Geo): P2[] => (x.type === 'circle' ? [] : [x.a, x.b]);
  // whole when each curve meets the next at one of its own end points
  let chain = true;
  for (let i = 0; i < gg.length && chain; i++) {
    const a = ends(gg[i]), b = ends(gg[(i + 1) % gg.length]);
    chain = a.some((p) => b.some((q) => near2(p, q)));
  }
  if (chain) return { whole: true };
  if (gg.some((x) => x.type !== 'line')) throw new Unsupported('a profile that runs along only part of an arc or circle');
  const corners: P2[] = [];
  let wholeAll = true;
  for (let i = 0; i < gg.length; i++) {
    const prev = gg[(i + gg.length - 1) % gg.length], cur = gg[i], next = gg[(i + 1) % gg.length];
    const c0 = crossLines(prev, cur), c1 = crossLines(cur, next);
    if (!c0 || !c1) throw new Unsupported('a profile with parallel neighbouring curves that do not meet');
    corners.push(c0);
    const seg = cur as Extract<Geo, { type: 'line' }>;
    if (!((near2(c0, seg.a) && near2(c1, seg.b)) || (near2(c0, seg.b) && near2(c1, seg.a)))) wholeAll = false;
  }
  return wholeAll ? { whole: true } : { whole: false, corners };
}

/** Where a sketch plane of theirs lands in our Y-up world: one of our standard planes, an offset along its normal, and how the in-plane axes map. */
interface Placed {
  /** Our standard plane and the offset of the sketch plane along its normal. */
  std: string; offset: number;
  /** our in-plane coordinates = [t0 t1; t2 t3] * theirs + [sx, sy] */
  t: [number, number, number, number];
  s: [number, number];
  /** +1 when their plane normal points along ours, -1 against it (an extrude "forward" then runs the other way). */
  sign: 1 | -1;
}
/** A plane frame in their world: origin and the two in-plane axes (the normal is u x v). */
interface ScFrame { o: V3; u: V3; v: V3 }
const unit = (a: V3): V3 => { const l = Math.hypot(...a); if (!(l > 1e-12)) throw new Unsupported('a plane with a zero axis'); return [a[0] / l, a[1] / l, a[2] / l]; };

/** A frame of theirs (any origin and in-plane axes) as our standard plane: it must lie flat on one of them, with its axes along ours. */
function placeFrame(fr: ScFrame): Placed {
  const u = toYUp(unit(fr.u)), v = toYUp(unit(fr.v)), n = cross3(u, v), o = toYUp(fr.o);
  for (const [std, f] of Object.entries(OUR_PLANE)) {
    const d = dot3(n, f.z);
    if (Math.abs(Math.abs(d) - 1) > 1e-6) continue;
    const t: [number, number, number, number] = [dot3(u, f.x), dot3(v, f.x), dot3(u, f.y), dot3(v, f.y)];
    if (t.some((c) => Math.abs(c - Math.round(c)) > 1e-6)) throw new Unsupported('a sketch plane turned about its normal by an angle that is not a multiple of 90 degrees');
    return { std, offset: dot3(o, f.z), t: t.map(Math.round) as [number, number, number, number], s: [dot3(o, f.x), dot3(o, f.y)], sign: d > 0 ? 1 : -1 };
  }
  throw new Unsupported('a sketch plane that is not parallel to one of the three standard planes');
}
const originFrame = (name: string, distance = 0): ScFrame => {
  const sc = SC_PLANE[name];
  if (!sc) throw new Unsupported(`plane ${name}`);
  const n = cross3(sc.u, sc.v);
  return { o: [n[0] * distance, n[1] * distance, n[2] * distance], u: sc.u, v: sc.v };
};
const placeOf = (name: string, distance = 0): Placed => placeFrame(originFrame(name, distance));
const mapXY = (pl: Placed, x: number, y: number): [number, number] => [pl.t[0] * x + pl.t[1] * y + pl.s[0], pl.t[2] * x + pl.t[3] * y + pl.s[1]];
/** A reflection of the sketch plane (their counter-clockwise is our clockwise). */
const mirrored = (pl: Placed) => pl.t[0] * pl.t[3] - pl.t[1] * pl.t[2] < 0;
/** Their horizontal is our vertical when the plane axes swap. */
const swapsAxes = (pl: Placed) => pl.t[0] === 0;
/** A direction of theirs as one of our axes ("x" | "y" | "z") and whether it points the negative way. */
function axisOf(dir: V3, what: string): { axis: 'x' | 'y' | 'z'; neg: boolean } {
  const d = unit(toYUp(dir));
  const i = [0, 1, 2].find((k) => Math.abs(Math.abs(d[k]) - 1) < 1e-6);
  if (i === undefined) throw new Unsupported(`${what} along ${JSON.stringify(dir)}, which is not one of the three axes`);
  return { axis: 'xyz'[i] as 'x' | 'y' | 'z', neg: d[i] < 0 };
}

const refuse = (name: string, why: string): ScImport => ({ name, part: null, rows: [], summary: { converted: 0, unsupported: 0, skipped: 0, notes: 0 }, geometryComplete: false, refused: why });

/** True when the bytes look like a plain JSON document (older files are the bare document, newer ones a zip around it). */
const looksLikeJson = (b: Uint8Array): boolean => {
  let i = 0;
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) i = 3;   // UTF-8 byte order mark
  while (i < b.length && (b[i] === 0x20 || b[i] === 0x0a || b[i] === 0x0d || b[i] === 0x09)) i++;
  return b[i] === 0x7b;   // {
};

/**
 * A .solidcraft file as a part plus the report. Two containers exist: a zip with `document.json` inside (newer files) and the bare
 * JSON document (older files, format tag `solidcraft/1` ...). Never throws on a bad file: the reason is in `refused`.
 */
export async function importSolidcraft(bytes: Uint8Array, name = 'SolidCraft part', opts: ImportOpts = {}): Promise<ScImport> {
  let raw: Uint8Array | null;
  if (looksLikeJson(bytes)) raw = bytes;
  else {
    try { raw = await zipFile(bytes, 'document.json'); } catch (e) { return refuse(name, `not a SolidCraft file (${(e as Error).message})`); }
    if (!raw) return refuse(name, 'no document.json in the file');
  }
  let doc: Rec;
  try { doc = JSON.parse(new TextDecoder().decode(raw)); } catch { return refuse(name, 'the document is not valid JSON'); }
  return importSolidcraftDocument(doc, name, opts);
}

/** The same from an already parsed document.json. */
export async function importSolidcraftDocument(doc: Rec, name = 'SolidCraft part', opts: ImportOpts = {}): Promise<ScImport> {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.features)) return refuse(name, 'document.json has no feature list');
  if (!/^solidcraft\/\d+$/.test(String(doc.format ?? ''))) return refuse(name, `unknown document format "${doc.format}"`);
  if (doc.units && doc.units !== 'mm') return refuse(name, `units are ${doc.units}; only mm is supported`);
  if (doc.assembly || doc.occurrences?.length) return refuse(name, `assemblies are not supported (${doc.occurrences?.length ?? 0} occurrences in ${doc.components?.length ?? 0} components)`);

  const vars: Record<string, number> = {};
  try { for (const p of doc.params ?? []) vars[p.name] = evalExpr(p.expr, vars); } catch (e) { return refuse(name, `a parameter cannot be evaluated: ${(e as Error).message}`); }
  const num = (x: unknown, what: string): number => {
    try { return evalExpr(x as string | number, vars); } catch (e) {
      if (e instanceof ExprError) throw new Unsupported(`${what}: ${e.message}`);
      throw e;
    }
  };

  const features: FeatureJson[] = [];
  const part = (): ScPart => ({ format: 'ck-part', version: 1, name, features, seq: 1 });
  const rows: ScRow[] = [];
  let n = 0;
  const nid = () => `F${++n}`;
  let bodies = 0;
  /** sketch id (theirs) -> our sketch feature, its curve ids, the sketch JSON (to add an axis line) and its placement */
  const sketches = new Map<number | string, { id: string; entityOf: Map<string, string>; placed: Placed; plane: Record<string, unknown>; geo: Map<string, Geo>; json: { points: FeatureJson[]; entities: FeatureJson[] } }>();
  /** feature name (theirs) -> the ids of the features it made (ours), for patterns and mirrors */
  const named = new Map<string, string[]>();
  /** construction planes by name (their frames) */
  const constructionPlanes = new Map<string, ScFrame>();
  const failedSketches = new Set<number | string>();
  const placeholders = opts.placeholders !== false;

  const operation = (f: Rec): 'add' | 'cut' => {
    const op = f.operation;
    if (op === 'new_body') {
      if (bodies > 0) throw new Unsupported(`"${f.name}" starts a separate body; this kit keeps one connected body per part`);
      bodies++; return 'add';
    }
    if (op === 'join') { bodies = Math.max(bodies, 1); return 'add'; }
    if (op === 'cut') {
      if (bodies === 0) throw new Unsupported(`"${f.name}" cuts but there is nothing to cut yet`);
      return 'cut';
    }
    throw new Unsupported(`operation "${op}" of "${f.name}"`);
  };

  /** Our sketch plane for one of their origin planes at a distance: the standard plane, or an offset plane feature. */
  const planeRef = (pl: Placed): Record<string, unknown> => {
    if (Math.abs(pl.offset) < 1e-12) return { kind: 'std', id: pl.std };
    const id = nid();
    features.push({ type: 'plane', id, mode: 'offset', base: { kind: 'std', id: pl.std }, offset: pl.offset });
    return { kind: 'feature', id };
  };
  /** Their plane, in any of its forms, as a frame in their world. */
  const frameOf = (pl: Rec): ScFrame => {
    switch (pl?.type) {
      case 'origin': return originFrame(pl.name);
      case 'construction': {
        const c = constructionPlanes.get(pl.name);
        if (!c) throw new Unsupported(`construction plane "${pl.name}" is not defined before it is used`);
        return c;
      }
      case 'custom': case 'face': {
        const g = pl.plane;
        if (!g?.origin || !g.x_dir || !g.y_dir) throw new Unsupported(`a ${pl.type} plane without its frame`);
        return { o: g.origin as V3, u: g.x_dir as V3, v: g.y_dir as V3 };   // a face plane carries the frame it had when the sketch was made
      }
      case 'offset': {
        const b = frameOf(pl.base), d = num(pl.distance, 'plane offset'), n = cross3(unit(b.u), unit(b.v));
        return { o: [b.o[0] + n[0] * d, b.o[1] + n[1] * d, b.o[2] + n[2] * d], u: b.u, v: b.v };
      }
      default: throw new Unsupported(`sketch on a ${pl?.type ?? 'unknown'} plane`);
    }
  };
  const placeSketch = (pl: Rec): Placed => placeFrame(frameOf(pl));

  const extrudeOf = (f: Rec, sketchId: string, depth: number | 'through', positive: boolean, sign: 1 | -1, regions?: string[]): FeatureJson => {
    const op = operation(f);
    // a boss grows along the plane normal and a cut goes against it; `flip` reverses. Their "positive" runs along their normal,
    // which is ours or the opposite of ours (sign).
    const along = (positive ? 1 : -1) * sign;
    const flip = op === 'cut' ? along > 0 : along < 0;
    const e: FeatureJson = depth === 'through' ? { type: 'extrude', id: nid(), op, sketch: sketchId, end: 'through', name: f.name } : { type: 'extrude', id: nid(), op, sketch: sketchId, end: 'blind', depth, name: f.name };
    if (flip) e.flip = true;
    if (regions) e.regions = regions;
    return e;
  };

  const sketchOf = (f: Rec): { notes: string[] } => {
    const placed = placeSketch(f.plane);
    const plane = planeRef(placed);
    const sk = f.sketch as Rec;
    const pts: Rec[] = sk.points ?? [];
    const curves: Rec[] = sk.curves ?? [];
    // coincident points are one point here (the geometry is then closed without the solver)
    const parent = pts.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (const k of sk.constraints ?? []) if (k.type === 'coincident' && pts[k.p] && pts[k.q]) parent[find(k.p)] = find(k.q);
    const originRoot = pts.findIndex((p) => p.id === 'origin');
    const ids = new Map<number, string>();
    const outPts: FeatureJson[] = [{ id: 'O', x: 0, y: 0, fixed: true }];
    const pid = (i: number): string => {
      const r = find(i);
      if (originRoot >= 0 && r === find(originRoot)) return 'O';
      let id = ids.get(r);
      if (!id) {
        id = `p${ids.size + 1}`;
        ids.set(r, id);
        const [x, y] = mapXY(placed, ...(pts[r].pos as [number, number]));
        outPts.push({ id, x, y });
      }
      return id;
    };
    const eid = (i: number) => `e${i + 1}`;
    const entities = curves.map((c, i): FeatureJson => {
      const e: FeatureJson = { id: eid(i) };
      if (c.type === 'line') Object.assign(e, { type: 'line', p1: pid(c.a), p2: pid(c.b) });
      else if (c.type === 'arc') {
        // counter-clockwise from start to end in their sketch; a mirrored sketch plane turns that round
        const [a, b] = mirrored(placed) ? [c.b, c.a] : [c.a, c.b];
        Object.assign(e, { type: 'arc', c: pid(c.c), p1: pid(a), p2: pid(b) });
      }
      else if (c.type === 'circle') Object.assign(e, { type: 'circle', c: pid(c.c), r: c.r });
      else throw new Unsupported(`sketch curve "${c.type}"`);
      if (c.construction) e.construction = true;
      return e;
    });
    const notes: string[] = [];
    const constraints: FeatureJson[] = [];
    let kn = 0;
    for (const k of sk.constraints ?? []) {
      if (k.type === 'coincident') continue;
      if (k.type === 'horizontal' || k.type === 'vertical') {
        const kind = swapsAxes(placed) ? (k.type === 'horizontal' ? 'vertical' : 'horizontal') : k.type;
        constraints.push({ id: `k${++kn}`, type: kind, refs: [eid(k.l)] });
        continue;
      }
      if (k.type === 'length' && curves[k.l]?.type === 'line') {
        const c = curves[k.l];
        const [a, b] = [pid(c.a), pid(c.b)];
        if (a !== b) constraints.push({ id: `k${++kn}`, type: 'distance', refs: [a, b], value: Number(k.value) });
        continue;
      }
      notes.push(`${k.type} constraint dropped (the geometry is kept as stored)`);
    }
    const id = nid();
    features.push({ type: 'sketch', id, name: f.name, plane, points: outPts, entities, constraints });
    const geo = new Map<string, Geo>();
    for (const c of curves) {
      const at = (i: number) => pts[i].pos as P2;
      if (c.type === 'line') geo.set(String(c.id), { type: 'line', a: at(c.a), b: at(c.b) });
      else if (c.type === 'arc') geo.set(String(c.id), { type: 'arc', a: at(c.a), b: at(c.b), c: at(c.c) });
      else if (c.type === 'circle') geo.set(String(c.id), { type: 'circle', c: at(c.c), r: Number(c.r) });
    }
    sketches.set(f.id, { id, entityOf: new Map(curves.map((c, i) => [String(c.id), eid(i)])), placed, plane, geo, json: { points: outPts, entities } });
    return { notes };
  };

  const convert = async (f: Rec): Promise<string[]> => {
    switch (f.type) {
      case 'sketch': return sketchOf(f).notes;
      case 'extrude': {
        const s = sketches.get(f.sketch);
        if (!s) throw new Unsupported(failedSketches.has(f.sketch) ? `depends on sketch ${f.sketch}, which was not imported` : `refers to sketch ${f.sketch}, which is not in the file`);
        // which regions of the sketch: all, or the ones bounded by the listed curves
        let regions: string[] | undefined;
        let sk = s;
        if (f.profiles?.type === 'curves' && Array.isArray(f.profiles.loops)) {
          const loops = (f.profiles.loops as unknown[]).map((l) => (Array.isArray(l) ? l : Array.isArray((l as Rec)?.curves) ? (l as Rec).curves : [])) as string[][];
          if (!loops.length || loops.some((l) => !l.length)) throw new Unsupported('an extrude with an empty profile');
          const plans = loops.map((l) => loopOutline(l.map(String), s.geo));
          if (plans.every((p) => p.whole)) {
            regions = loops.flat().map((c) => s.entityOf.get(String(c))!);
            if (regions.some((r) => !r)) throw new Unsupported('the chosen profile refers to a curve that is not in the sketch');
          } else {
            // a loop runs along only part of a curve: draw just the chosen outline(s) on the same plane and extrude that
            const pts: FeatureJson[] = [{ id: 'O', x: 0, y: 0, fixed: true }], ents: FeatureJson[] = [];
            plans.forEach((p, li) => {
              if (p.whole) {
                // a whole loop next to a trimmed one: copy its curves as they are
                for (const cid of loops[li]) {
                  const g = s.geo.get(String(cid))!;
                  const m = (q: P2) => { const [x, y] = mapXY(s.placed, q[0], q[1]); const id = `q${pts.length}`; pts.push({ id, x, y }); return id; };
                  if (g.type === 'circle') ents.push({ id: `c${ents.length + 1}`, type: 'circle', c: m(g.c), r: g.r });
                  else if (g.type === 'line') ents.push({ id: `c${ents.length + 1}`, type: 'line', p1: m(g.a), p2: m(g.b) });
                  else { const [a, b] = mirrored(s.placed) ? [g.b, g.a] : [g.a, g.b]; ents.push({ id: `c${ents.length + 1}`, type: 'arc', c: m(g.c), p1: m(a), p2: m(b) }); }
                }
                return;
              }
              const ids = p.corners.map((q) => { const [x, y] = mapXY(s.placed, q[0], q[1]); const id = `q${pts.length}`; pts.push({ id, x, y }); return id; });
              ids.forEach((id, k) => ents.push({ id: `c${ents.length + 1}`, type: 'line', p1: id, p2: ids[(k + 1) % ids.length] }));
            });
            const nsid = nid();
            features.push({ type: 'sketch', id: nsid, name: `${f.name} profile`, plane: s.plane, points: pts, entities: ents, constraints: [], visible: false });
            sk = { ...s, id: nsid };
          }
        } else if (f.profiles?.type !== 'all') throw new Unsupported(`extrude profile selection "${f.profiles?.type}"`);
        // older files have no `convention`; their extents are the same total distance
        const conv = f.extent?.convention ?? 'total_distance';
        if (conv !== 'total_distance') throw new Unsupported(`extrude extent "${conv}"`);
        if (f.extent.direction !== 'positive' && f.extent.direction !== 'negative') throw new Unsupported(`extrude direction "${f.extent.direction}"`);
        if (f.extent.to !== undefined) throw new Unsupported('an extrude that stops at a point or face');
        if (f.extent.start_offset !== undefined) throw new Unsupported('an extrude that starts offset from its sketch');
        // a negative distance runs the other way: "-100 mm" going positive is 100 mm going negative
        const dist = f.extent.through_all ? 0 : num(f.extent.distance, 'extrude distance');
        const forward = (f.extent.direction === 'positive') !== (dist < 0);
        if (!f.extent.through_all && Math.abs(dist) < 1e-12) throw new Unsupported('an extrude of zero distance');
        features.push(extrudeOf(f, sk.id, f.extent.through_all ? 'through' : Math.abs(dist), forward, s.placed.sign, regions));
        named.set(f.name, [features[features.length - 1].id as string]);
        return [];
      }
      case 'box': {
        // a rectangle on their XY plane at z = corner z, extruded up
        const [cx, cy, cz] = f.corner as V3;
        const L = num(f.length, 'box length'), W = num(f.width, 'box width'), H = num(f.height, 'box height');
        const pl = placeOf('XY', cz);
        const plane = planeRef(pl);
        const sid = nid();
        const c = [[cx, cy], [cx + L, cy], [cx + L, cy + W], [cx, cy + W]].map(([x, y]) => mapXY(pl, x, y));
        features.push({ type: 'sketch', id: sid, name: `${f.name} sketch`, plane, points: [{ id: 'O', x: 0, y: 0, fixed: true }, ...c.map(([x, y], i) => ({ id: `p${i + 1}`, x, y }))], entities: [1, 2, 3, 4].map((i) => ({ id: `e${i}`, type: 'line', p1: `p${i}`, p2: `p${i % 4 + 1}` })), constraints: [] });
        features.push(extrudeOf(f, sid, H, true, pl.sign));
        named.set(f.name, [features[features.length - 1].id as string]);
        return [];
      }
      case 'cylinder': {
        // a circle on the origin plane across the axis, extruded along it (a negative axis runs the other way)
        const b = f.base as V3;
        const len = Math.hypot(...(f.axis as V3));
        const ax = (f.axis as V3).map((c) => c / (len || 1)) as V3;   // the axis as a unit vector
        const hit = (['YZ', 'XZ', 'XY'] as const).map((name) => {
          const { u, v } = SC_PLANE[name], nrm = cross3(u, v), d = dot3(ax, nrm);
          return len > 0 && Math.abs(Math.abs(d) - 1) < 1e-9 ? { name, u, v, nrm, positive: d > 0 } : null;   // |d| = 1 for a unit vector means it IS the plane normal
        }).find(Boolean);
        if (!hit) throw new Unsupported('cylinder along an axis other than X, Y or Z');
        const pl = placeOf(hit.name, dot3(b, hit.nrm));
        const plane = planeRef(pl);
        const [cx, cy] = mapXY(pl, dot3(b, hit.u), dot3(b, hit.v));
        const sid = nid();
        features.push({ type: 'sketch', id: sid, name: `${f.name} sketch`, plane, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: cx, y: cy }], entities: [{ id: 'e1', type: 'circle', c: 'p1', r: num(f.radius, 'cylinder radius') }], constraints: [] });
        features.push(extrudeOf(f, sid, num(f.height, 'cylinder height'), hit.positive, pl.sign));
        named.set(f.name, [features[features.length - 1].id as string]);
        return [];
      }
      case 'fillet': case 'chamfer': {
        if (!opts.resolver) throw new Unsupported('needs the kernel to find its edges');
        const points = (f.edges as V3[] | undefined)?.map(toYUp);   // the edge positions are in their Z-up world
        if (!points?.length) throw new Unsupported('no edge positions in the file');
        const refs = await opts.resolver(part(), points).catch(() => null);
        if (!refs || !refs.every(Boolean)) throw new Unsupported('an edge was not found on the body built so far');
        if (f.type === 'fillet') features.push({ type: 'fillet', id: nid(), name: f.name, radius: num(f.radius, 'fillet radius'), edges: refs });
        else {
          if (f.distance2 !== undefined || f.angle !== undefined) throw new Unsupported('a chamfer with two distances or an angle');
          features.push({ type: 'chamfer', id: nid(), name: f.name, chamferType: 'equal', distance: num(f.distance, 'chamfer distance'), edges: refs });
        }
        named.set(f.name, [features[features.length - 1].id as string]);
        return [];
      }
      case 'shell': case 'offset_face': {
        if (!opts.faceResolver) throw new Unsupported('needs the kernel to find its faces');
        const points = (f.faces as V3[] | undefined)?.map(toYUp);
        if (!points?.length) throw new Unsupported('no face positions in the file');
        const names = await opts.faceResolver(part(), points).catch(() => null);
        if (!names || !names.every(Boolean)) throw new Unsupported('a face was not found, or not found uniquely, on the body built so far');
        if (f.type === 'shell') {
          if (f.direction !== undefined && f.direction !== 'inside' && f.direction !== 'outside') throw new Unsupported(`shell direction "${f.direction}"`);
          const sh: FeatureJson = { type: 'shell', id: nid(), name: f.name, faces: names, thickness: num(f.thickness, 'shell thickness') };
          if (f.direction === 'outside') sh.outward = true;
          features.push(sh);
        } else features.push({ type: 'moveFace', id: nid(), name: f.name, faces: names, mode: 'offset', distance: num(f.distance, 'offset distance') });
        named.set(f.name, [features[features.length - 1].id as string]);
        return [];
      }
      case 'construction_plane': {
        // sketches carry their own plane, so the plane needs no feature of its own; it is remembered for what refers to it by name
        constructionPlanes.set(String(f.name), frameOf(f.plane));
        return [];
      }
      case 'revolve': {
        const s = sketches.get(f.sketch);
        if (!s) throw new Unsupported(failedSketches.has(f.sketch) ? `depends on sketch ${f.sketch}, which was not imported` : 'its sketch is not in the file');
        if (f.profiles?.type !== 'all') throw new Unsupported(`revolve profile selection "${f.profiles?.type}"`);
        if (f.axis?.type !== 'sketch_axis' || (f.axis.axis !== 'x' && f.axis.axis !== 'y')) throw new Unsupported(`a revolve about "${f.axis?.type ?? 'an unknown axis'}"`);
        const op = operation(f);
        const angle = num(f.angle, 'revolve angle');
        // the sketch's own x or y axis becomes a construction line through the sketch origin
        const pl = s.placed, d = f.axis.axis === 'x' ? [pl.t[0], pl.t[2]] : [pl.t[1], pl.t[3]];
        const o = mapXY(pl, 0, 0);
        const k = s.json.entities.length + 1;
        s.json.points.push({ id: `ax${k}a`, x: o[0], y: o[1] }, { id: `ax${k}b`, x: o[0] + d[0] * 10, y: o[1] + d[1] * 10 });
        s.json.entities.push({ id: `ax${k}`, type: 'line', p1: `ax${k}a`, p2: `ax${k}b`, construction: true });
        features.push({ type: 'revolve', id: nid(), op, sketch: s.id, axis: `ax${k}`, end: 'blind', angle, name: f.name });
        named.set(f.name, [features[features.length - 1].id as string]);
        return [];
      }
      case 'loft': {
        const secs = ((f.sections as Rec[] | undefined) ?? []).map((q) => sketches.get(q.sketch)?.id);
        if (secs.length < 2 || secs.some((x) => !x)) throw new Unsupported('a loft section whose sketch was not imported');
        const op = operation(f);
        features.push({ type: 'loft', id: nid(), op, sketches: secs, name: f.name });
        named.set(f.name, [features[features.length - 1].id as string]);
        return [];
      }
      case 'mirror': {
        const seeds = ((f.features as string[] | undefined) ?? []).flatMap((nm) => named.get(nm) ?? (() => { throw new Unsupported(`mirror of "${nm}", which was not imported`); })());
        if (!seeds.length) throw new Unsupported('a mirror with nothing to mirror');
        const plane = planeRef(placeFrame(frameOf(f.plane)));
        features.push({ type: 'mirror', id: nid(), name: f.name, seeds, plane, body: false });
        return [];
      }
      case 'pattern': {
        const pt = f.pattern as Rec | undefined;
        if (pt?.type !== 'rectangular') throw new Unsupported(`a ${pt?.type ?? 'unknown'} pattern`);
        let cur = ((f.features as string[] | undefined) ?? []).flatMap((nm) => named.get(nm) ?? (() => { throw new Unsupported(`pattern of "${nm}", which was not imported`); })());
        if (!cur.length) throw new Unsupported('a pattern with nothing to repeat');
        const made: string[] = [];
        for (const [dir, count, spacing] of [[pt.dir1, pt.count1, pt.spacing1], [pt.dir2, pt.count2, pt.spacing2]] as Array<[V3 | undefined, unknown, unknown]>) {
          const c = count === undefined ? 1 : num(count, 'pattern count');
          if (!dir || c <= 1) continue;
          const a = axisOf(dir, 'a pattern direction');
          const id = nid();
          features.push({ type: 'lpattern', id, name: f.name, seeds: cur, dir: { kind: 'axis', axis: a.axis }, count: c, spacing: num(spacing, 'pattern spacing'), reverse: a.neg });
          made.push(id);
          cur = [...cur, id];   // the second direction repeats the first row too
        }
        if (!made.length) throw new Unsupported('a pattern with a single instance');
        named.set(f.name, made);
        return [];
      }
      default: throw new Unsupported(`feature type "${f.type}"`);
    }
  };

  for (const f of doc.features as Rec[]) {
    const row = { id: f.id, name: String(f.name ?? f.type), type: String(f.type) };
    if (f.suppressed) { rows.push({ ...row, status: 'skipped', reason: 'suppressed in the file' }); continue; }
    const mark = features.length, bodiesBefore = bodies, nBefore = n;
    try {
      const notes = await convert(f);
      rows.push({ ...row, status: 'converted', ...(notes.length ? { notes } : {}) });
    } catch (e) {
      features.length = mark; bodies = bodiesBefore; n = nBefore;   // drop what the feature half-added
      if (f.type === 'sketch') failedSketches.add(f.id);
      // a feature we do not understand, or one whose data is not what we expect, is reported; a bad file never aborts the import
      const reason = e instanceof Unsupported || e instanceof ExprError ? e.message : `could not read this feature (${(e as Error).message})`;
      if (placeholders) features.push({ type: 'importedUnsupported', id: nid(), name: row.name, suppressed: true, reason, original: f });
      rows.push({ ...row, status: 'unsupported', reason });
    }
  }
  const count = (s: ScRow['status']) => rows.filter((r) => r.status === s).length;
  const unsupported = count('unsupported');
  return {
    name, part: part(), rows,
    summary: { converted: count('converted'), unsupported, skipped: count('skipped'), notes: rows.reduce((a, r) => a + (r.notes?.length ?? 0), 0) },
    geometryComplete: unsupported === 0,
  };
}
