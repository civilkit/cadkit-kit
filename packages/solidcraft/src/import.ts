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
export type EdgeResolver = (partBefore: ScPart, points: V3[], hints?: Array<EdgeHint | undefined>) => Promise<Array<Record<string, unknown> | null>>;
/** What else the file says about an edge, for when its stored position no longer lies on the body (a parameter changed after it was picked): the direction of the edge, in our world. */
export interface EdgeHint { dir?: V3; /** the box of the whole body when the edge was picked, in our world: an axis on which it differs from the body now is the one that changed */ box?: { min: V3; max: V3 } }
/** The same for a face the file names as the start or end cap of an extrude (`F2:top`): our id of that extrude and which cap. */
export interface FaceHint { cap: { feature: string; end: 'start' | 'end' } }
/** Resolves points on faces of the body built so far to our face names ("F2.S.e1"); null for a point that matches no single face. */
export type FaceResolver = (partBefore: ScPart, points: V3[], hints?: Array<FaceHint | undefined>) => Promise<Array<string | null>>;
/** The rim of a shell, found by a point on it: the face's name, its outward normal and its outlines (closed polylines in our world, line edges only; null when any edge is curved). */
export interface Rim { name: string; normal: V3; loops: V3[][] | null }
export type RimResolver = (partBefore: ScPart, point: V3) => Promise<Rim | null>;
export interface ImportOpts {
  /** Needed for lips and grooves: without it they are reported as unsupported. */
  rimResolver?: RimResolver;
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
/** Joins polylines end to end into closed loops (the edges of a face); null when they do not close into loops. */
export function assembleLoops(lines: V3[][], tol = 1e-6): V3[][] | null {
  const same = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= tol;
  const left = lines.map((l) => l.slice());
  const loops: V3[][] = [];
  while (left.length) {
    const loop = left.pop()!;
    for (let guard = 0; guard < 10000; guard++) {
      if (loop.length > 2 && same(loop[0], loop[loop.length - 1])) break;
      const end = loop[loop.length - 1];
      const i = left.findIndex((l) => same(l[0], end) || same(l[l.length - 1], end));
      if (i < 0) return null;
      const next = left.splice(i, 1)[0];
      if (!same(next[0], end)) next.reverse();
      loop.push(...next.slice(1));
    }
    if (!(loop.length > 2 && same(loop[0], loop[loop.length - 1]))) return null;
    loop.pop();
    loops.push(loop);
  }
  return loops;
}
/** The outlines of one face from the kernel's view edges (each has a key "faceA|faceB#n" and a polyline): null when any edge of it is curved or they do not close. */
export function faceOutlines(edges: Array<{ key?: string; pts: number[][] }>, face: string): V3[][] | null {
  const mine = edges.filter((e) => (e.key ?? '').split('#')[0].split('|').includes(face));
  if (!mine.length || mine.some((e) => e.pts.length !== 2)) return null;   // a straight edge is two points; a curve has more
  return assembleLoops(mine.map((e) => e.pts.map((q) => [q[0], q[1], q[2]] as V3)));
}
/** A face as the kernel's query lists it (the label is the axis of a flat face's normal, "+y"). */
export interface FaceInfo { name: string; normal?: string; centroid: number[] }
/**
 * The face a point lies ON: among the flat, axis-aligned faces whose plane passes through the point, the one whose outline contains it
 * (several faces can share a plane, like a rim and the floor of a groove). The kernel's own "nearest" ranks by face centre, so it
 * mistakes a point near the edge of a big face for a neighbour with a nearer centre.
 */
export function faceAtPoint(point: V3, faces: FaceInfo[], edges: Array<{ key?: string; pts: number[][] }>): string | null {
  const tol = 1e-5;
  const onPlane = faces.filter((f) => {
    const n = axisLabel(f.normal);
    return n && Math.abs(dot3(n, [point[0] - f.centroid[0], point[1] - f.centroid[1], point[2] - f.centroid[2]])) < tol;
  });
  if (onPlane.length <= 1) return onPlane[0]?.name ?? null;
  const inside = onPlane.filter((f) => {
    const loops = faceOutlines(edges, f.name);
    if (!loops) return false;
    const k = [0, 1, 2].find((i) => Math.abs(axisLabel(f.normal)![i]) === 1)!;
    const drop = (q: V3): P2 => { const a = [0, 1, 2].filter((i) => i !== k); return [q[a[0]], q[a[1]]]; };
    const [px, py] = drop(point);
    let crossings = 0;   // even-odd over every outline: an inner outline makes a hole
    for (const loop of loops.map((l) => l.map(drop))) {
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i], b = loop[(i + 1) % loop.length];
        if ((a[1] > py) !== (b[1] > py) && px < a[0] + ((py - a[1]) / (b[1] - a[1])) * (b[0] - a[0])) crossings++;
      }
    }
    return crossings % 2 === 1;
  });
  return inside.length === 1 ? inside[0].name : null;
}
/** An axis label of the kernel's face query ("+y", "-z") as a unit vector. */
export function axisLabel(label: string | undefined): V3 | null {
  const m = /^([+-])([xyz])$/.exec(label ?? '');
  if (!m) return null;
  const v: V3 = [0, 0, 0];
  v['xyz'.indexOf(m[2])] = m[1] === '+' ? 1 : -1;
  return v;
}
/** The vertices of a closed polygon without the collinear ones. */
function corners2(pts: P2[]): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[(i + pts.length - 1) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cr) > 1e-9 * Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(c[0] - b[0], c[1] - b[1])) out.push(b);
  }
  return out;
}
const area2 = (p: P2[]) => p.reduce((a, q, i) => { const r = p[(i + 1) % p.length]; return a + (q[0] * r[1] - r[0] * q[1]) / 2; }, 0);
/** A simple polygon moved sideways by `d` (positive = outwards): each edge line is shifted and neighbouring lines meet at the new corners. */
function offsetPolygon(poly: P2[], d: number): P2[] {
  const p = corners2(poly), n = p.length;
  const sgn = area2(p) > 0 ? 1 : -1;   // counter-clockwise polygons have their outside on the right of each edge
  const lines = p.map((a, i) => {
    const b = p[(i + 1) % n], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nx = sgn * (b[1] - a[1]) / len, ny = sgn * -(b[0] - a[0]) / len;
    return { a: [a[0] + nx * d, a[1] + ny * d] as P2, b: [b[0] + nx * d, b[1] + ny * d] as P2 };
  });
  return lines.map((ln, i) => {
    const prev = lines[(i + n - 1) % n];
    const c = crossLines({ type: 'line', a: prev.a, b: prev.b }, { type: 'line', a: ln.a, b: ln.b });
    if (!c) throw new Unsupported('a rim with a doubled-back edge');
    return c;
  });
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
/** A frame at a point on a face with the face's outward direction as its normal; `along` (a direction across the face) is its x axis, else the first axis across. */
function faceFrame(position: V3, dir: V3, along?: V3): ScFrame {
  const n = unit(dir);
  const across = (a: V3) => Math.hypot(...cross3(a, n)) > 1e-6;
  const u = unit(along && across(along) ? along : ([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as V3[]).find(across)!);
  return { o: position, u, v: cross3(n, u) };   // u x v = n
}
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
  /** Their feature id -> our id of the extrude it became, for the names the file gives to caps (`F2:top`). */
  const ourExtrude = new Map<number, string>();
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
        // the stored direction of each edge: when a parameter changed after the pick, the point is off the body but the line is not
        const hints = (f.edge_refs as Rec[] | undefined)?.map((r): EdgeHint | undefined => {
          const d = r?.dir as V3 | undefined, lo = r?.min as V3 | undefined, hi = r?.max as V3 | undefined;
          const h: EdgeHint = {};
          if (d && Math.hypot(d[0], d[1], d[2]) > 0.5) h.dir = toYUp(d);
          if (lo && hi) {
            const a = toYUp(lo), b = toYUp(hi);
            h.box = { min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])], max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])] };
          }
          return h.dir || h.box ? h : undefined;
        });
        const refs = await opts.resolver(part(), points, hints).catch(() => null);
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
        // `F2:top` and `F2:start` name the end and start cap of extrude 2: found by name when the stored point is off the body
        const hints = (f.face_names as string[] | undefined)?.map((n): FaceHint | undefined => {
          const m = /^F(\d+):(top|start)$/.exec(n ?? '');
          const mine = m ? ourExtrude.get(Number(m[1])) : undefined;
          return m && mine ? { cap: { feature: mine, end: m[2] === 'top' ? 'end' : 'start' } } : undefined;
        });
        const names = await opts.faceResolver(part(), points, hints).catch(() => null);
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
      case 'lip': {
        if (!opts.rimResolver) throw new Unsupported('needs the kernel to find its rim');
        const at = f.face as V3 | undefined;
        if (!at) throw new Unsupported('a lip without a position on the rim');
        const w = num(f.width, 'lip width'), H = num(f.height, 'lip height');
        if (f.gap !== undefined && num(f.gap, 'lip clearance') !== 0) throw new Unsupported('a lip or groove with a clearance gap');
        if (!(w > 0 && H > 0)) throw new Unsupported('a lip with no size');
        const rim = await opts.rimResolver(part(), toYUp(at)).catch(() => null);
        if (!rim) throw new Unsupported('the rim face was not found on the body built so far');
        if (!rim.loops) throw new Unsupported('a lip on a rim with curved edges');
        if (rim.loops.length < 2) throw new Unsupported('a lip on a face that has no inner edge');
        const std = Object.entries(OUR_PLANE).find(([, fr]) => Math.abs(Math.abs(dot3(rim.normal, fr.z)) - 1) < 1e-6);
        if (!std) throw new Unsupported('a rim that is not parallel to one of the three standard planes');
        const [stdName, fr] = std;
        const zsign = dot3(rim.normal, fr.z) > 0 ? 1 : -1;
        const offset = dot3(rim.loops[0][0], fr.z);
        const flat = rim.loops.map((l) => l.map((q): P2 => [dot3(q, fr.x), dot3(q, fr.y)]));
        const order = flat.map((l, i) => ({ i, a: Math.abs(area2(l)) })).sort((x, y) => x.a - y.a);
        const inner = flat[order[0].i], outer = flat[order[order.length - 1].i];
        const groove = f.groove === true, outside = f.outside === true;
        // the band: next to the inner edge (growing outwards into the wall) or next to the outer edge (shrinking inwards)
        const edge = outside ? outer : inner;
        const other = offsetPolygon(edge, outside ? -w : w);
        const plane = planeRef({ std: stdName, offset, t: [1, 0, 0, 1], s: [0, 0], sign: 1 });
        const sid = nid();
        const pts: FeatureJson[] = [{ id: 'O', x: 0, y: 0, fixed: true }], ents: FeatureJson[] = [];
        [corners2(edge), other].forEach((loop, li) => {
          const ids = loop.map((q, k) => { const id = `l${li}_${k}`; pts.push({ id, x: q[0], y: q[1] }); return id; });
          ids.forEach((id, k) => ents.push({ id: `le${li}_${k}`, type: 'line', p1: id, p2: ids[(k + 1) % ids.length] }));
        });
        features.push({ type: 'sketch', id: sid, name: `${f.name} band`, plane, points: pts, entities: ents, constraints: [], visible: false });
        // a lip stands up from the rim (along its outward normal); a groove is cut down into it
        const wantZ = (groove ? -1 : 1) * zsign;
        const ex = extrudeOf({ operation: groove ? 'cut' : 'join', name: f.name }, sid, H, wantZ > 0, 1);
        features.push(ex);
        named.set(f.name, [ex.id as string]);
        return [];
      }
      case 'boss': case 'rest': case 'snap_fit': {
        // plastic features as plain sketches and extrudes on the face they stand on
        const position = f.position as V3 | undefined;
        if (!position) throw new Unsupported(`a ${f.type} without a position`);
        const bodyHere = bodies > 0;
        if (!bodyHere) throw new Unsupported(`a ${f.type} with no body to stand on`);
        const dir = (f.direction as V3 | undefined) ?? undefined;
        if (!dir) throw new Unsupported(`a ${f.type} without a direction (their face normal is not stored)`);
        const joinOp = { operation: 'join', name: f.name };
        const stand = (frame: ScFrame, name: string, build: (pl: Placed) => { points: FeatureJson[]; entities: FeatureJson[] }) => {
          const pl = placeFrame(frame);
          const plane = planeRef(pl);
          const sid = nid();
          const g = build(pl);
          features.push({ type: 'sketch', id: sid, name, plane, points: [{ id: 'O', x: 0, y: 0, fixed: true }, ...g.points], entities: g.entities, constraints: [], visible: false });
          return { sid, pl };
        };
        /** closed polygon / circle entities from corner lists in the frame's own coordinates (u, v) */
        const poly = (pl: Placed, loops: P2[][], tag: string) => {
          const points: FeatureJson[] = [], entities: FeatureJson[] = [];
          loops.forEach((loop, li) => {
            const ids = loop.map((q, k) => { const [x, y] = mapXY(pl, q[0], q[1]); const id = `${tag}${li}_${k}`; points.push({ id, x, y }); return id; });
            ids.forEach((id, k) => entities.push({ id: `${tag}e${li}_${k}`, type: 'line', p1: id, p2: ids[(k + 1) % ids.length] }));
          });
          return { points, entities };
        };
        const circle = (pl: Placed, r: number, tag: string) => { const [x, y] = mapXY(pl, 0, 0); return { points: [{ id: `${tag}c`, x, y }], entities: [{ id: `${tag}e`, type: 'circle', c: `${tag}c`, r }] }; };
        const rect = (l: number, w: number): P2[] => [[-l / 2, -w / 2], [l / 2, -w / 2], [l / 2, w / 2], [-l / 2, w / 2]];
        const added: string[] = [];
        const push = (e: FeatureJson) => { features.push(e); added.push(e.id as string); };
        const draftOf = (x: unknown): number => (x === undefined || x === null ? 0 : num(x, 'draft'));
        if (f.type === 'boss') {
          if (f.fillet !== undefined && num(f.fillet, 'boss fillet') > 0) throw new Unsupported('a boss with a fillet at its foot');
          if (f.ribs !== undefined && num(f.ribs, 'boss ribs') > 0) throw new Unsupported('a boss with ribs');
          const D = num(f.diameter, 'boss diameter'), H = num(f.height, 'boss height');
          if (!(D > 0 && H > 0)) throw new Unsupported('a boss with no size');
          const fr = faceFrame(position, dir);
          const { sid, pl } = stand(fr, `${f.name} boss`, (p) => circle(p, D / 2, 'b'));
          const ex = extrudeOf(joinOp, sid, H, true, pl.sign);
          const dr = draftOf(f.draft);
          if (dr) ex.draft = dr;
          push(ex);
          if (f.hole_diameter !== undefined) {
            const d = num(f.hole_diameter, 'boss hole'), depth = f.hole_depth !== undefined ? num(f.hole_depth, 'boss hole depth') : H;
            if (!(d > 0 && d < D)) throw new Unsupported('a boss hole that is not narrower than the boss');
            // from the boss top, down into the boss
            const nn = unit(dir);
            const top = faceFrame([position[0] + nn[0] * H, position[1] + nn[1] * H, position[2] + nn[2] * H], dir);
            const h = stand(top, `${f.name} hole`, (p) => circle(p, d / 2, 'h'));
            push(extrudeOf({ operation: 'cut', name: `${f.name} hole` }, h.sid, depth, false, h.pl.sign));
          }
        } else if (f.type === 'rest') {
          const w = num(f.width, 'rest width'), H = num(f.height, 'rest height');
          const l = f.length !== undefined ? num(f.length, 'rest length') : undefined;
          const t = f.thickness !== undefined ? num(f.thickness, 'rest wall') : 0;
          if (!(w > 0 && H > 0)) throw new Unsupported('a rest with no size');
          const fr = faceFrame(position, dir, f.along as V3 | undefined);
          const { sid, pl } = stand(fr, `${f.name} pad`, (p) => {
            if (l === undefined) {
              if (t > 0) throw new Unsupported('a round hollow rest');
              return circle(p, w / 2, 'r');
            }
            // length along their `along`, width across it
            return poly(p, t > 0 ? [rect(l, w), rect(l - 2 * t, w - 2 * t)] : [rect(l, w)], 'r');
          });
          if (t > 0 && (2 * t >= w || (l !== undefined && 2 * t >= l))) throw new Unsupported('a rest whose wall is thicker than half its width');
          const ex = extrudeOf(joinOp, sid, H, true, pl.sign);
          const dr = draftOf(f.draft);
          if (dr) ex.draft = dr;
          push(ex);
        } else {
          // snap fit: an arm standing on the face (length along the face normal, thickness along the hook, width across both) and a
          // triangular catch on the hook side at the arm's free end, deepest at its lower end
          const hook = unit(f.hook as V3), n = unit(dir);
          const L = num(f.length, 'snap fit length'), T = num(f.thickness, 'snap fit thickness'), W = num(f.width, 'snap fit width');
          const cd = num(f.catch_depth, 'catch depth'), cl = num(f.catch_length, 'catch length');
          if (Math.abs(dot3(hook, n)) > 1e-6) throw new Unsupported('a snap fit whose hook points along its arm');
          if (!(L > 0 && T > 0 && W > 0 && cd > 0 && cl > 0 && cl < L)) throw new Unsupported('a snap fit with no usable size');
          // the arm: a rectangle T x W on the face, centred on the position, thickness along the hook
          const armFrame = faceFrame(position, dir, hook);   // u = hook, v = n x hook (across)
          const arm = stand(armFrame, `${f.name} arm`, (p) => poly(p, [rect(T, W)], 'a'));
          push(extrudeOf(joinOp, arm.sid, L, true, arm.pl.sign));
          // the catch: a triangle in the (hook, arm) plane, extruded across the width
          // the catch sketch lies in the plane holding the hook and arm directions (its normal is hook x n), started half a width to one
          // side so that extruding it across the width is centred on the arm
          const nrm = unit(cross3(hook, n));
          const catchFrame: ScFrame = { o: [position[0] - nrm[0] * W / 2, position[1] - nrm[1] * W / 2, position[2] - nrm[2] * W / 2], u: hook, v: n };
          const top = L, h0 = T / 2;
          const cat = stand(catchFrame, `${f.name} catch`, (p) => poly(p, [[[h0, top], [h0, top - cl], [h0 + cd, top - cl]]], 'k'));
          push(extrudeOf(joinOp, cat.sid, W, true, cat.pl.sign));
        }
        named.set(f.name, added);
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
      if (f.type === 'extrude' || f.type === 'box' || f.type === 'cylinder') { const mine = named.get(f.name)?.[0]; if (mine) ourExtrude.set(f.id, mine); }
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
