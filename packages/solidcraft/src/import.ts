// SolidCraft (.solidcraft) -> feature tree. A .solidcraft file is a zip whose `document.json` ("solidcraft/N") holds the parametric
// feature list (older files are that JSON on its own); the rest (`cache/`) is derived and ignored. SolidCraft is Z-up and this kit Y-up:
// everything is rotated by -90 degrees about X on the way in (see toYUp). Mapped from the sample files only: sketch (line, arc, circle; coincident,
// horizontal, vertical, length), extrude (total distance), box, cylinder and a constant-radius fillet. Everything else is reported
// per feature and kept as a suppressed placeholder carrying the original JSON, so the tree still regenerates and nothing is lost
// silently. Assemblies are refused as a whole. See docs/solidcraft.md.
import { zipFile } from '@kit/fcstd';
import { evalExpr, ExprError, kernelExpr, namesIn, usableName } from './expr';
import { bodyLooks, type ScLook } from './appearance';
import { followSketches, strandedSketches, STD_PLANES } from './follow';

export type V3 = [number, number, number];
export type FeatureJson = Record<string, unknown>;
export interface ScPart { format: 'ck-part'; version: number; name: string; features: FeatureJson[]; seq: number; variables?: Array<{ name: string; expr: string }>; blobs?: Record<string, string>; appearance?: Record<string, ScLook>; view?: { hiddenBodies: string[] } }

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
export interface EdgeHint { /** the faces the file names for the edge (`F2:side:l5@F5.1|F2:start@F5.1`), as our name prefix and instance suffix: found by name when the stored position is stale */ faces?: [FaceName, FaceName]; /** the body the edge is on, when the file names one: bodies can lie on one another, so the position alone does not tell */ body?: string; dir?: V3; /** the box of the whole body when the edge was picked, in our world: an axis on which it differs from the body now is the one that changed */ box?: { min: V3; max: V3 } }
/** A face by the name the kernel gives it: `prefix` (`F2.S.e5`, `F2.C1`) then maybe a qualifier (`~1`) then the instance suffix (`@F7.1`). */
export interface FaceName { prefix: string; inst?: string }
/** The same for a face the file names as the start or end cap of an extrude (`F2:top`): our id of that extrude and which cap. */
export interface FaceHint { body?: string; cap?: { feature: string; end: 'start' | 'end' } }
/** Resolves points on faces of the body built so far to our face names ("F2.S.e1"); null for a point that matches no single face. */
export type FaceResolver = (partBefore: ScPart, points: V3[], hints?: Array<FaceHint | undefined>) => Promise<Array<string | null>>;
/** The rim of a shell, found by a point on it: the face's name, its outward normal and its outlines (closed polylines in our world, line edges only; null when any edge is curved). */
export interface Rim { name: string; normal: V3; loops: V3[][] | null }
export type RimResolver = (partBefore: ScPart, point: V3) => Promise<Rim | null>;
/** Finds, for each pick, the cylinder face of an inserted part (by its insertPart id) whose axis passes through the point (a circle centre in our world); null when there is no single such face. */
export type AxisFaceResolver = (partBefore: ScPart, picks: Array<{ insert: string; point: V3 }>) => Promise<Array<string | null>>;
export type StepNormal = { ok: true; step: string; volume: number } | { ok: false; reason: string };
export type StepNormalizer = (step: string) => Promise<StepNormal>;
/** A history that rebuilds the stored original solid to within this fraction of its volume is kept. */
export const HISTORY_VOLUME_TOLERANCE = 0.005;

export interface ImportOpts {
  /** Needed to carry revolute joints over as hinge mates: without it they are kept as the pose they were saved in. */
  axisFaceResolver?: AxisFaceResolver;
  /** Needed for lips and grooves: without it they are reported as unsupported. */
  rimResolver?: RimResolver;
  /** Needed for fillets and chamfers: without it they are reported as unsupported. */
  resolver?: EdgeResolver;
  /** Needed for shells and offset faces: without it they are reported as unsupported. */
  faceResolver?: FaceResolver;
  /** Keep a suppressed `importedUnsupported` feature (with the original JSON) in the tree for each unsupported feature. Default true. */
  placeholders?: boolean;
  /** Reads a file of the archive the document came from (a STEP body is kept as `blobs/<sha>.step` beside document.json). Without it a feature that holds imported geometry cannot be carried. `importSolidcraft` sets it. */
  blob?: (path: string) => Promise<Uint8Array | null>;
  /**
   * Turns the STEP text of the original solid into one the kernel reads to the right body (its orientation repaired by the kernel's healing,
   * the text written again by the kernel when the plain reading differs), with the volume of that body; or says why the kernel cannot read it.
   * Without it the text is used as it is: right for the STEP of the program that made the file, wrong for a restatement that has some faces turned.
   */
  normalizeStep?: StepNormalizer;
  /**
   * The volume and error count of a part regenerated in the kernel. With it and `normalizeStep`, a file that keeps its original solid but also
   * builds a body from sketches and operations is checked: when the operations do not rebuild the original solid (volume off by more than 0.5%,
   * or they fail), the original solid is used and the operations that build bodies are skipped, with the volumes in the row.
   */
  volumeOf?: (part: ScPart) => Promise<{ volume: number | null; errors: number }>;
  /** The file's axes are already Y up (set from the file by `importSolidcraftDocument`; see `fromSolidWorks`). */
  yUp?: boolean;
  /** Called as the features are read (feature number, number of features); the importer gives the page a turn between calls so it can draw them. */
  onProgress?: (done: number, total: number) => void;
  /** Aborting it stops the import at the next feature: the result is refused with the reason "cancelled". */
  signal?: AbortSignal;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = Record<string, any>;

class Unsupported extends Error {}

/**
 * SolidCraft is Z-up and this kit is Y-up, so every point of the file is rotated by -90 degrees about X: (x, y, z) -> (x, z, -y).
 * That is a proper rotation (no mirroring): their ground plane XY becomes our top plane, their up axis becomes ours.
 */
/** Sheet metal: what a contour flange uses where the file is silent (see the `sheet_contour` case). */
const SHEET_THICKNESS = 2.5, SHEET_BEND_RADIUS = 2.5;
const SHEET_SIDE = 'inside';
/**
 * Whether the file's coordinates are already this kit's (Y up, front plane XY). A SolidWorks part is: SolidWorks stores Y up, as the kernel's own
 * `.sldprt` reader and the `.ckpart` Dutchman writes keep it. The file does not say so, but the original solid it keeps names the file it came
 * from, and that name is the convention the importer reads (a file converted from SolidWorks names a `.sldprt`). The answer travels with the
 * import (`ImportOpts.yUp`), so imports can run side by side.
 */
const SOLIDWORKS_FILE = /\.sld(prt|asm)$/i;
/** Whether `doc` was converted from a SolidWorks file (the `import` feature names its source file). */
export const fromSolidWorks = (doc: { features?: unknown }): boolean =>
  Array.isArray(doc.features) && doc.features.some((f: { type?: unknown; file?: unknown }) => f?.type === 'import' && typeof f.file === 'string' && SOLIDWORKS_FILE.test(f.file));
/** The turn from the file's axes to this kit's: from Z up (the default) or none when the file is already Y up. */
const frameFor = (yUp: boolean) => (p: V3): V3 => (yUp ? [p[0], p[1], p[2]] : [p[0], p[2], -p[1]]);
/** The turn from Z up. */
export const toYUp = frameFor(false);
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** SolidCraft's origin planes: in-plane axes u, v in their world (the normal is u x v). */
const SC_PLANE: Record<string, { u: V3; v: V3 }> = {
  XY: { u: [1, 0, 0], v: [0, 1, 0] },
  XZ: { u: [1, 0, 0], v: [0, 0, -1] },
  YZ: { u: [0, 1, 0], v: [0, 0, 1] },   // their sketch x = +Y, y = +Z, normal +X (their geometry source, plane.rs)
};
/** Our standard planes in our world: in-plane axes x, y and the normal z. */
const OUR_PLANE = STD_PLANES;
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

/** Points on a clamped B-spline of degree p over the control points (knots: the file's when they fit, else clamped uniform); both ends are included. */
function sampleBSpline(cv: V3[], p: number, knots?: number[]): V3[] {
  const n = cv.length, spans = n - p;
  let k = knots && knots.length === n + p + 1 ? knots : null;
  if (!k) { k = new Array(p + 1).fill(0); for (let i = 1; i < spans; i++) k.push(i / spans); k.push(...new Array(p + 1).fill(1)); }
  const t0 = k[p], t1 = k[n];
  const at = (t: number): V3 => {
    let s = p; while (s < n - 1 && t >= k![s + 1]) s++;
    const d = cv.slice(s - p, s + 1).map((q) => [...q] as V3);
    for (let r = 1; r <= p; r++) for (let j = p; j >= r; j--) {
      const den = k![s + j + 1 - r] - k![s - p + j];
      const a = den > 0 ? (t - k![s - p + j]) / den : 0;
      d[j] = [0, 1, 2].map((c) => (1 - a) * d[j - 1][c] + a * d[j][c]) as V3;
    }
    return d[p];
  };
  const m = Math.min(160, Math.max(16, 12 * spans));
  return Array.from({ length: m + 1 }, (_, i) => at(i === m ? t1 : t0 + ((t1 - t0) * i) / m));
}

/**
 * True when a sketch looks like the outline of a part with smaller shapes inside it: some curves reach the sketch's overall bounding box
 * and at least one other curve lies strictly inside it. A cut that selects "all" regions of such a sketch removes the outline's whole area.
 */
function hasEnclosingOutline(geo: Map<string, Geo>): boolean {
  const box = (g: Geo): [number, number, number, number] => {
    if (g.type === 'circle') return [g.c[0] - g.r, g.c[1] - g.r, g.c[0] + g.r, g.c[1] + g.r];
    if (g.type === 'line') return [Math.min(g.a[0], g.b[0]), Math.min(g.a[1], g.b[1]), Math.max(g.a[0], g.b[0]), Math.max(g.a[1], g.b[1])];
    const r = Math.hypot(g.a[0] - g.c[0], g.a[1] - g.c[1]), a0 = Math.atan2(g.a[1] - g.c[1], g.a[0] - g.c[0]);
    let sw = Math.atan2(g.b[1] - g.c[1], g.b[0] - g.c[0]) - a0;
    while (sw <= 1e-12) sw += 2 * Math.PI;
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i <= 32; i++) { xs.push(g.c[0] + r * Math.cos(a0 + (sw * i) / 32)); ys.push(g.c[1] + r * Math.sin(a0 + (sw * i) / 32)); }
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  };
  const boxes = [...geo.values()].map(box);
  if (boxes.length < 2) return false;
  const lo = [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1]))], hi = [Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))];
  const tol = 1e-6 * Math.max(1, hi[0] - lo[0], hi[1] - lo[1]);
  const inside = (b: [number, number, number, number]) => b[0] > lo[0] + tol && b[1] > lo[1] + tol && b[2] < hi[0] - tol && b[3] < hi[1] - tol;
  return boxes.some(inside) && boxes.some((b) => !inside(b));
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

/**
 * The regions of `profiles: {type: "whole_boundaries", profiles: [{outer, holes}]}`: each profile is a region bounded by the whole curves of its
 * outer loop, with the loops of its holes inside. The part picks a region by one curve of its outer boundary (it keeps the holes inside the region
 * by itself, and a hole curve in the list would add the hole as a region of its own), so one curve of each outer loop is returned: a curve that
 * no hole uses and that no other profile shares when there is one, because a shared curve also selects the region on its other side.
 */
export function boundaryRegions(profiles: Rec, entityOf: Map<string, string>): string[] {
  const list = (profiles.profiles ?? []) as Array<{ outer?: unknown; holes?: unknown }>;
  if (!Array.isArray(list) || !list.length) throw new Unsupported('a profile selection with no region');
  const ids = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
  const holeCurves = new Set(list.flatMap((p) => (Array.isArray(p.holes) ? p.holes.flatMap(ids) : [])));
  const uses = new Map<string, number>();
  for (const p of list) for (const c of new Set(ids(p.outer))) uses.set(c, (uses.get(c) ?? 0) + 1);
  return list.map((p) => {
    const outer = ids(p.outer).filter((c) => entityOf.has(c));
    if (!outer.length) throw new Unsupported('a profile whose outline is not in the sketch');
    const pick = outer.find((c) => !holeCurves.has(c) && uses.get(c) === 1) ?? outer.find((c) => !holeCurves.has(c)) ?? outer[0];
    return entityOf.get(pick)!;
  });
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
  /** A plane that lies on none of our standard ones (tilted): the frame itself in our world; `std` is then 'frame', the axes map straight across and `sign` is 1. */
  frame?: { o: V3; x: V3; y: V3; z: V3 };
}
/** A plane frame in their world: origin and the two in-plane axes (the normal is u x v). */
interface ScFrame { o: V3; u: V3; v: V3 }
const unit = (a: V3): V3 => { const l = Math.hypot(...a); if (!(l > 1e-12)) throw new Unsupported('a plane with a zero axis'); return [a[0] / l, a[1] / l, a[2] / l]; };

/** A frame of theirs (any origin and in-plane axes) as our standard plane: it must lie flat on one of them, with its axes along ours. */
function placeFrame(fr: ScFrame, general = false, toYUp: (p: V3) => V3): Placed {
  const u = toYUp(unit(fr.u)), v = toYUp(unit(fr.v)), n = cross3(u, v), o = toYUp(fr.o);
  // a sketch may stand on any plane (it becomes a `frame` plane of ours); a face frame for a hole or a rim must lie on a standard one
  const anywhere = (): Placed => ({ std: 'frame', offset: 0, t: [1, 0, 0, 1], s: [0, 0], sign: 1, frame: { o: o.map(clean) as V3, x: u.map(clean) as V3, y: v.map(clean) as V3, z: n.map(clean) as V3 } });
  for (const [std, f] of Object.entries(OUR_PLANE)) {
    const d = dot3(n, f.z);
    if (Math.abs(Math.abs(d) - 1) > 1e-6) continue;
    const t: [number, number, number, number] = [dot3(u, f.x), dot3(v, f.x), dot3(u, f.y), dot3(v, f.y)];
    if (t.some((c) => Math.abs(c - Math.round(c)) > 1e-6)) {
      if (general) return anywhere();
      throw new Unsupported('a sketch plane turned about its normal by an angle that is not a multiple of 90 degrees');
    }
    return { std, offset: dot3(o, f.z), t: t.map(Math.round) as [number, number, number, number], s: [dot3(o, f.x), dot3(o, f.y)], sign: d > 0 ? 1 : -1 };
  }
  if (general) return anywhere();
  throw new Unsupported('a sketch plane that is not parallel to one of the three standard planes');
}
/** Before format 6 their XZ plane had sketch y = +Z (normal -Y); from 6 on it is y = -Z (normal +Y). Older files keep the frame they were drawn on. */
const scPlane = (name: string, version: number): { u: V3; v: V3 } | undefined => (version < 6 && name === 'XZ' ? { u: [1, 0, 0], v: [0, 0, 1] } : SC_PLANE[name]);
const originFrameFor = (name: string, distance: number, version: number): ScFrame => {
  const sc = scPlane(name, version);
  if (!sc) throw new Unsupported(`plane ${name}`);
  const n = cross3(sc.u, sc.v);
  return { o: [n[0] * distance, n[1] * distance, n[2] * distance], u: sc.u, v: sc.v };
};
/** A frame at a point on a face with the face's outward direction as its normal; `along` (a direction across the face) is its x axis, else the first axis across. */
function faceFrame(position: V3, dir: V3, along?: V3): ScFrame {
  const n = unit(dir);
  const across = (a: V3) => Math.hypot(...cross3(a, n)) > 1e-6;
  const u0 = unit(along && across(along) ? along : ([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as V3[]).find(across)!), k = dot3(u0, n);
  const u = unit([u0[0] - n[0] * k, u0[1] - n[1] * k, u0[2] - n[2] * k]);   // square to the normal (it already is when the normal lies along an axis)
  return { o: position, u, v: cross3(n, u) };   // u x v = n
}
/** Snaps float noise (`1.9999999999999976`, from a rotated or recomputed value in their file) to 9 decimals: far below any tolerance, so the model is unchanged but names and numbers read clean. */
export const clean = (x: number): number => { const r = Math.round(x * 1e9) / 1e9; return Object.is(r, -0) ? 0 : r; };
const mapXY = (pl: Placed, x: number, y: number): [number, number] => [clean(pl.t[0] * x + pl.t[1] * y + pl.s[0]), clean(pl.t[2] * x + pl.t[3] * y + pl.s[1])];
/** A reflection of the sketch plane (their counter-clockwise is our clockwise). */
const mirrored = (pl: Placed) => pl.t[0] * pl.t[3] - pl.t[1] * pl.t[2] < 0;
/** Their horizontal is our vertical when the plane axes swap. */
const swapsAxes = (pl: Placed) => pl.t[0] === 0;
/** A direction of theirs as one of our axes ("x" | "y" | "z") and whether it points the negative way. */
function axisOf(dir: V3, what: string, toYUp: (p: V3) => V3): { axis: 'x' | 'y' | 'z'; neg: boolean } {
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
  return importSolidcraftDocument(doc, name, { blob: async (p) => (looksLikeJson(bytes) ? null : zipFile(bytes, p)), ...opts });
}

/** The same from an already parsed document.json. */
export async function importSolidcraftDocument(doc: Rec, name = 'SolidCraft part', opts: ImportOpts = {}): Promise<ScImport> {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.features)) return refuse(name, 'document.json has no feature list');
  const inner: ImportOpts = { ...opts, yUp: opts.yUp ?? fromSolidWorks(doc) };
  if (doc.occurrences?.length) return importComponents(doc, name, inner);
  return importOne(doc, name, inner);
}

/** Lower-case hex SHA-256 of the UTF-8 bytes of `text` (the key of a blob in the part). */
async function sha256Hex(text: string): Promise<string> {
  const h = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('');
}

const row4 = (m: number[][], i: number): V3 => [m[i][0], m[i][1], m[i][2]];

/** The bodies a join, cut or intersect may change: its own `targets`, else its `participants` (what their evaluator does); empty means the bodies of its own component. */
const cutTargets = (f: Rec): string[] => {
  const names = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const t = names(f.targets);
  return t.length ? t : names(f.participants);
};

/**
 * The part each feature is imported into. A feature belongs to its own component, except when it names a body that was made in
 * another one: a body transferred in (`body_transfer`) is still built where it was made, so the feature that moves, scales, cuts
 * or removes it has to run there (a part of its own would find no such body). That is only done when both components sit at
 * the identity in every occurrence, so the feature's coordinates are the same in both. A feature that names bodies from two
 * different parts, or sits in a placed component, stays where it is and is reported as before.
 */
function partsOf(doc: Rec): Map<Rec, number | undefined> {
  const identity = new Map<number, boolean>();
  for (const occ of (doc.occurrences ?? []) as Rec[]) {
    const m = occ.transform as number[][] | undefined;
    const id = Array.isArray(m) && m.length === 4 && m.every((r, i) => Array.isArray(r) && r.every((v, j) => Math.abs(v - (i === j ? 1 : 0)) < 1e-9));
    identity.set(occ.component as number, (identity.get(occ.component as number) ?? true) && id);
  }
  const placedAtIdentity = (c: number | undefined) => c === undefined || identity.get(c) === true;
  const names = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? [v] : []);
  const home = new Map<string, number | undefined>();
  const out = new Map<Rec, number | undefined>();
  for (const f of doc.features as Rec[]) {
    let part = f.component as number | undefined;
    if (f.type !== 'body_transfer') {
      const refs = ['bodies', 'target', 'tools', 'targets', 'participants'].flatMap((k) => names(f[k]));
      const foreign = [...new Set(refs.filter((b) => home.has(b) && home.get(b) !== part).map((b) => home.get(b)))];
      if (foreign.length === 1 && placedAtIdentity(part) && placedAtIdentity(foreign[0])) part = foreign[0];
    }
    out.set(f, part);
    for (const n of names(f.body_names)) home.set(n, part);
  }
  return out;
}

/** The ids of the occurrences along a hidden placement, from the design down, as one key. */
const pathKey = (p: unknown[]): string => p.join('/');
const MAX_NESTING = 24;

/**
 * Components become inserted parts: each component's features are imported as a part of its own, the root features stay in the main part, and every
 * occurrence is an `insertPart` placed by its transform (rows are images of the axes, translation in the last row). An occurrence whose `parent` is a
 * component that is itself placed (a sub-assembly) is inserted into the part of that component, so it moves with it. A placement the file hides
 * (`visibility.hidden_occurrences`, a path of occurrence ids from the design down) has the bodies of its part hidden.
 */
async function importComponents(doc: Rec, name: string, opts: ImportOpts): Promise<ScImport> {
  const yUp = !!opts.yUp, toYUp = frameFor(yUp);
  const comps = new Map<number, Rec>((doc.components ?? []).map((c: Rec) => [c.id as number, c]));
  const where = partsOf(doc);
  const sub = (component: number | undefined): Rec => ({ ...doc, components: undefined, occurrences: undefined, assembly: undefined, features: (doc.features as Rec[]).filter((f) => where.get(f) === component) });
  const root = await importOne(sub(undefined), name, opts);
  if (!root.part) return root;
  const rows = [...root.rows];
  const occs = (doc.occurrences ?? []) as Rec[];
  const placed = new Set<number>(occs.map((o) => o.component as number));
  /** The component an occurrence sits in: a placed component (a sub-assembly), else the design itself. */
  const parentOf0 = (o: Rec): number | undefined => (typeof o.parent === 'number' && placed.has(o.parent) && o.parent !== o.component ? o.parent : undefined);
  /** Whether the chain of holders of an occurrence ends at the design: an occurrence in a ring of components that hold one another is not reachable from it, and is placed in the design instead. */
  const reachable = (o: Rec): boolean => {
    let at = o, seen = 0;
    for (;;) {
      const up = parentOf0(at);
      if (up === undefined) return true;
      const holder = occs.find((x) => x.component === up);
      if (!holder || ++seen > MAX_NESTING) return false;
      at = holder;
    }
  };
  const parentOf = (o: Rec): number | undefined => (reachable(o) ? parentOf0(o) : undefined);
  const hidden = new Set<string>(((doc.visibility as Rec | undefined)?.hidden_occurrences as unknown[] | undefined ?? []).filter(Array.isArray).map((p) => pathKey(p as unknown[])));
  /** A part being assembled: its features, the ids in use, and what its inserts add to its colours and hidden bodies. */
  interface Host { part: ScPart; used: Set<string>; appearance: Record<string, ScLook>; hiddenBodies: string[]; nid: () => string }
  const hostOf = (part: ScPart): Host => {
    const used = new Set<string>(part.features.map((f) => String(f.id)));
    let seq = part.seq;
    return { part, used, appearance: { ...(part.appearance ?? {}) }, hiddenBodies: [...(part.view?.hiddenBodies ?? [])], nid: () => { let id: string; do id = `F${++seq}`; while (used.has(id)); used.add(id); part.seq = seq; return id; } };
  };
  const finish = (h: Host): ScPart => {
    if (Object.keys(h.appearance).length) h.part.appearance = h.appearance;
    if (h.hiddenBodies.length) h.part.view = { hiddenBodies: [...new Set(h.hiddenBodies)] };
    return h.part;
  };
  const rootHost = hostOf({ ...root.part, features: [...root.part.features] });
  const parts = new Map<number, ScImport>();
  const insertOf = new Map<number, string>();
  /** The part of a component, with the sub-assemblies it holds inserted. */
  const partOf = async (cid: number, trail: number[]): Promise<ScImport> => {
    let imp = parts.get(cid);
    if (imp) return imp;
    const cname = String(comps.get(cid)?.name ?? `Component ${cid}`);
    imp = await importOne(sub(cid), cname, opts);
    parts.set(cid, imp);
    for (const r of imp.rows) rows.push({ ...r, name: `${cname}: ${r.name}` });
    if (imp.part) {
      imp.part = { ...imp.part, features: [...imp.part.features] };
      const host = hostOf(imp.part);
      for (const o of occs.filter((x) => parentOf(x) === cid)) await place(host, o, trail);
      finish(host);
    }
    return imp;
  };
  const place = async (host: Host, occ: Rec, trail: number[]): Promise<void> => {
    const cname = String(comps.get(occ.component as number)?.name ?? `Component ${occ.component}`);
    const label = String(occ.name ?? cname);
    if (trail.length > MAX_NESTING || trail.includes(occ.component as number)) { rows.push({ id: String(occ.id), name: label, type: 'occurrence', status: 'unsupported', reason: 'components that hold themselves' }); return; }
    const imp = await partOf(occ.component as number, [...trail, occ.component as number]);
    if (!imp.part) { rows.push({ id: String(occ.id), name: label, type: 'occurrence', status: 'unsupported', reason: imp.refused ?? 'the component could not be imported' }); return; }
    const m = occ.transform as number[][];
    // the basis turns with the points: their (x, y, z) become our (x, z, -y), or stay when the file is already Y up
    const tr = toYUp(row4(m, 3)), ex = toYUp(row4(m, 0)), ey = yUp ? row4(m, 1) : toYUp(row4(m, 2)), ez = yUp ? row4(m, 2) : (toYUp(row4(m, 1)).map((x) => clean(-x)) as V3);
    const insertId = host.nid();
    // the colours and hidden bodies of the component's bodies, keyed in the assembly as feature-of-the-part @ insert (what its face names say); a body of a
    // sub-assembly keeps the key it has there (feature @ the insert inside the sub-assembly)
    const key = (k: string) => (k.includes('@') ? k : `${k}@${insertId}`);
    for (const [k, v] of Object.entries(imp.part.appearance ?? {})) host.appearance[key(k)] = v;
    for (const k of imp.part.view?.hiddenBodies ?? []) host.hiddenBodies.push(key(k));
    const path = [...ancestry(occ), occ.id as number];
    const hides = hidden.has(pathKey(path));
    if (hides) for (const f of imp.part.features) if (f.type !== 'sketch' && f.type !== 'plane' && typeof f.id === 'string') host.hiddenBodies.push(key(f.id));
    host.part.features.push({ type: 'insertPart', id: insertId, name: label, part: imp.part, place: { o: tr.map(clean), x: ex.map(clean), y: ey.map(clean), z: ez }, fixed: !!occ.grounded });
    if (host === rootHost) insertOf.set(occ.id as number, insertId);
    rows.push({ id: String(occ.id), name: label, type: 'occurrence', status: 'converted', ...(hides ? { notes: ['hidden in the file: its bodies are hidden here too'] } : {}) });
  };
  /** The occurrences that placed the component an occurrence sits in, from the design down (the first one that places it). */
  const ancestry = (occ: Rec): number[] => {
    const out: number[] = [];
    let at = parentOf(occ);
    for (let guard = 0; at !== undefined && guard < MAX_NESTING; guard++) {
      const holder = occs.find((o) => o.component === at);
      if (!holder) break;
      out.unshift(holder.id as number);
      at = parentOf(holder);
    }
    return out;
  };
  for (const occ of occs.filter((o) => parentOf(o) === undefined)) await place(rootHost, occ, []);
  const features = rootHost.part.features;
  const nid = rootHost.nid;
  // the saved transforms already satisfy the joints (the joint value is part of the pose), so the geometry is right; a revolute joint between
  // two circle centres also becomes a hinge mate (concentric cylinders), which keeps the pose and lets the part turn
  for (const j of (doc.assembly?.joints ?? []) as Rec[]) {
    const row = { id: `joint ${j.id}`, name: String(j.name ?? 'Joint'), type: `${j.kind ?? ''} joint`.trim() };
    const ia = insertOf.get(j.a?.occurrence), ib = insertOf.get(j.b?.occurrence);
    const pa = j.a?.snap?.type === 'circle_center' ? j.a.snap.pick : undefined, pb = j.b?.snap?.type === 'circle_center' ? j.b.snap.pick : undefined;
    let why = 'kept as the pose it was saved in; the joint (and so its motion) is not imported';
    if (j.kind === 'revolute' && ia && ib && Array.isArray(pa) && Array.isArray(pb) && opts.axisFaceResolver) {
      const names = await opts.axisFaceResolver({ format: 'ck-part', version: 1, name, features, seq: rootHost.part.seq }, [{ insert: ia, point: toYUp(pa as V3).map(clean) as V3 }, { insert: ib, point: toYUp(pb as V3).map(clean) as V3 }]).catch(() => [null, null]);
      if (names[0] && names[1]) {
        features.push({ type: 'mate', id: nid(), name: row.name, kind: 'hinge', a: names[0], b: names[1] });
        rows.push({ ...row, status: 'converted', notes: ['hinge mate on the two cylinders; the saved angle is kept as the pose, its limits are not imported'] });
        continue;
      }
      why = 'kept as the pose it was saved in; no single cylinder lies on each circle centre';
    }
    rows.push({ ...row, status: 'skipped', reason: why });
  }
  const final = finish(rootHost);
  const count = (s: ScRow['status']) => rows.filter((r) => r.status === s).length;
  const unsupported = count('unsupported');
  return { name, part: { ...final, format: 'ck-part', version: 1, name }, rows, summary: { converted: count('converted'), unsupported, skipped: count('skipped'), notes: rows.reduce((a, r) => a + (r.notes?.length ?? 0), 0) }, geometryComplete: unsupported === 0 };
}

async function importOne(doc: Rec, name: string, opts: ImportOpts): Promise<ScImport> {
  const yUp = !!opts.yUp, toYUp = frameFor(yUp);
  if (!/^solidcraft\/\d+$/.test(String(doc.format ?? ''))) return refuse(name, `unknown document format "${doc.format}"`);
  if (doc.units && doc.units !== 'mm') return refuse(name, `units are ${doc.units}; only mm is supported`);

  const version = Number(String(doc.format).split('/')[1]);   // the file's format: some conventions changed between versions (XZ plane at 6, revolve start at 11)
  const originFrame = (n: string, d = 0): ScFrame => originFrameFor(n, d, version);
  const placeOf = (n: string, d = 0): Placed => placeFrame(originFrame(n, d), false, toYUp);
  const vars: Record<string, number> = {};
  try {
    // a parameter may use one listed after it: evaluate in passes until each is settled; a pass that settles none is the error (a cycle, or a name that is not there)
    const pending = [...(doc.params ?? [])] as Array<{ name: string; expr: string }>;
    while (pending.length) {
      const before = pending.length;
      let last: unknown;
      for (let k = 0; k < pending.length;) {
        try { vars[pending[k].name] = evalExpr(pending[k].expr, vars); pending.splice(k, 1); } catch (e) { last = e; k++; }
      }
      if (pending.length === before) throw last;
    }
  } catch (e) { return refuse(name, `a parameter cannot be evaluated: ${(e as Error).message}`); }
  const num = (x: unknown, what: string): number => {
    try { return clean(evalExpr(x as string | number, vars)); } catch (e) {
      if (e instanceof ExprError) throw new Unsupported(`${what}: ${e.message}`);
      throw e;
    }
  };

  /**
   * The parameters of the file as the part's variables: the ones whose names the part can use, each with its expression when the part's grammar holds
   * it (else its value). A feature field written as an expression over them is carried as that expression (`field`), so changing a variable changes the part.
   */
  const paramNames = new Set<string>(((doc.params ?? []) as Array<{ name: string }>).map((p) => p.name).filter((n) => usableName(n) && Object.prototype.hasOwnProperty.call(vars, n)));
  const variables: Array<{ name: string; expr: string }> = ((doc.params ?? []) as Array<{ name: string; expr: string }>).filter((p) => paramNames.has(p.name)).map((p) => ({ name: p.name, expr: kernelExpr(p.expr, paramNames) ?? String(vars[p.name]) }));
  /** Things on the row of the feature being converted that the caller of `live` found. */
  let liveNotes: string[] = [];
  /** A field: its expression over the variables when it has names in it and the grammar holds it, else the number (said on the row when it had names). */
  const field = (x: unknown, what: string): number | string => {
    const v = num(x, what);
    if (typeof x !== 'string') return v;
    const used = namesIn(x).filter((n) => Object.prototype.hasOwnProperty.call(vars, n));
    if (!used.length) return v;
    const ke = used.every((n) => paramNames.has(n)) ? kernelExpr(x, paramNames) : null;
    if (ke === null) { liveNotes.push(`${what}: "${x.trim()}" is kept as the number ${v}: the part's expressions cannot hold it`); return v; }
    return `=${ke}`;
  };

  const features: FeatureJson[] = [];
  /** STEP texts of the imported geometry, by the SHA-256 of the text (the key the kernel checks). */
  const blobs: Record<string, string> = {};
  const part = (): ScPart => ({ format: 'ck-part', version: 1, name, features, seq: 1, ...(variables.length ? { variables } : {}), ...(Object.keys(blobs).length ? { blobs } : {}) });
  const rows: ScRow[] = [];
  let n = 0;
  const nid = () => `F${++n}`;
  let bodies = 0;
  /**
   * The file refers to bodies by name (a target, a move, a combine, a remove, an intersect) or makes several: then every new body is a
   * named `newBody` lump, so what comes later can find it. A file of one body keeps the plain output (`add`).
   */
  const namedBodies = (doc.features as Rec[]).some((q) => !q.suppressed && (['move', 'scale', 'combine', 'remove'].includes(q.type) || (q.type === 'mirror' && Array.isArray(q.bodies) && q.bodies.length > 0) || q.operation === 'intersect' || cutTargets(q).length > 0))
    || (doc.features as Rec[]).filter((q) => !q.suppressed && (q.operation === 'new_body' || q.type === 'import')).length > 1;
  /** names of the bodies alive, in creation order; `bodyCount` is how many were ever made (unnamed ones are Body1, Body2, ... in that order) */
  let live: string[] = [];
  let bodyCount = 0;
  /** Names a rename freed (`reserved_body_names`, format 33): the counter skips them, so a body made after `Body1` was renamed is `Body2`. */
  const reserved = new Set(Array.isArray(doc.reserved_body_names) ? (doc.reserved_body_names as unknown[]).map(String) : []);
  const autoName = (): string => { let k = bodyCount + 1; while (reserved.has(`Body${k}`) || live.includes(`Body${k}`)) k++; return `Body${k}`; };
  /** the name the feature being converted gives its new lump, and features that must follow it (the combine of a cut that names its targets) */
  let newName: string | undefined;
  let after: Array<() => FeatureJson> = [];
  /** sketch id (theirs) -> our sketch feature, its curve ids, the sketch JSON (to add an axis line) and its placement */
  const sketches = new Map<number | string, { id: string; entityOf: Map<string, string>; placed: Placed; plane: Record<string, unknown>; geo: Map<string, Geo>; json: { points: FeatureJson[]; entities: FeatureJson[] } }>();
  /** feature name (theirs) -> the ids of the features it made (ours), for patterns and mirrors */
  const named = new Map<string, string[]>();
  /** Features that act on named bodies through a tool body of their own: what a mirror of them needs (the tool body is kept until it is mirrored). */
  const targeted = new Map<string, { tool: string; op: string; targets: string[] }>();
  const mirroredFeatures = new Set<string>(((doc.features as Rec[]) ?? []).filter((x) => x.type === 'mirror').flatMap((x) => (x.features as string[] | undefined) ?? []));
  /** Their feature id -> our id of the extrude it became, for the names the file gives to caps (`F2:top`). */
  const ourExtrude = new Map<number, string>();
  /** Their extrude id -> their sketch id (a side face `F2:side:l5` is the line l5 of that sketch). */
  const extrudeSketch = new Map<number, number | string>();
  /** Their move id -> our moveBody id (the instance suffix `@F5.1` of the copy). */
  const ourMove = new Map<number, string>();
  /** construction planes by name (their frames) */
  const constructionPlanes = new Map<string, ScFrame>();
  const failedSketches = new Set<number | string>();
  /** Their sketch id -> the id of our 3D sketch holding its one spline (a sweep path). */
  const splinePaths = new Map<number | string, string>();
  const placeholders = opts.placeholders !== false;
  /** Their feature id -> the features of ours it made (for the timeline folders). */
  const produced = new Map<unknown, FeatureJson[]>();

  const operation = (f: Rec): 'add' | 'cut' | 'newBody' => {
    const op = f.operation, targets = cutTargets(f);
    const alive = (nm: string): string => { if (!live.includes(nm)) throw new Unsupported(`"${f.name}" refers to the body "${nm}", which does not exist at this point`); return nm; };
    if (op === 'new_body') {
      if (!namedBodies) {
        if (bodies > 0) throw new Unsupported(`"${f.name}" starts a separate body; this kit keeps one connected body per part`);
        bodies++; return 'add';
      }
      const nm = String(f.body_names?.[0] ?? autoName());
      if (live.includes(nm)) throw new Unsupported(`the body name "${nm}" is used twice`);
      bodyCount++; live.push(nm); bodies++; newName = nm;
      return 'newBody';
    }
    if (op === 'join' || op === 'cut' || op === 'intersect') {
      if (op !== 'join' && bodies === 0) throw new Unsupported(`"${f.name}" ${op === 'cut' ? 'cuts' : 'intersects'} but there is nothing to ${op === 'cut' ? 'cut' : 'intersect'} yet`);
      const named = targets.length ? targets : op === 'intersect' ? live : [];
      if (!named.length) {
        if (op === 'intersect') throw new Unsupported(`"${f.name}" intersects but there is no body`);
        if (op === 'join') bodies = Math.max(bodies, 1);
        return op === 'join' ? 'add' : 'cut';
      }
      if (!namedBodies) throw new Unsupported(`"${f.name}" works on named bodies`);
      // limited to some bodies: the shape becomes a body of its own, then a combine with each target
      named.forEach(alive);
      const tool = `__tool${n + 1}`, cop = op === 'join' ? 'union' : op;
      newName = tool;
      const keep = mirroredFeatures.has(String(f.name));
      if (keep) targeted.set(String(f.name), { tool, op: cop, targets: [...named] });
      after = named.map((t, i) => () => ({ type: 'combine', id: nid(), name: `${f.name}${named.length > 1 ? ` (${t})` : ''}`, op: cop, target: { body: t }, tools: [{ body: tool }], keepTools: i < named.length - 1 || keep }));
      return 'newBody';
    }
    throw new Unsupported(`operation "${op}" of "${f.name}"`);
  };

  /** Our sketch plane for one of their origin planes at a distance: the standard plane, or an offset plane feature. */
  const planeRef = (pl: Placed): Record<string, unknown> => {
    if (pl.frame) {
      const id = nid();
      features.push({ type: 'plane', id, mode: 'frame', origin: pl.frame.o, xDir: pl.frame.x, yDir: pl.frame.y });
      return { kind: 'feature', id };
    }
    if (Math.abs(pl.offset) < 1e-12) return { kind: 'std', id: pl.std };
    const id = nid();
    features.push({ type: 'plane', id, mode: 'offset', base: { kind: 'std', id: pl.std }, offset: clean(pl.offset) });
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
  const placeSketch = (pl: Rec): Placed => placeFrame(frameOf(pl), true, toYUp);

  const extrudeOf = (f: Rec, sketchId: string, depth: number | string, positive: boolean, sign: 1 | -1, regions?: string[], extra: { end?: 'mid' | 'throughBoth'; draft?: number; draftOut?: boolean } = {}): FeatureJson => {
    const op = operation(f);
    // a boss grows along the plane normal and a cut goes against it; `flip` reverses. Their "positive" runs along their normal,
    // which is ours or the opposite of ours (sign).
    const along = (positive ? 1 : -1) * sign;
    const flip = op === 'cut' ? along > 0 : along < 0;
    const e: FeatureJson = depth === 'through' ? { type: 'extrude', id: nid(), op, sketch: sketchId, end: extra.end ?? 'through', name: f.name } : { type: 'extrude', id: nid(), op, sketch: sketchId, end: extra.end ?? 'blind', depth, name: f.name };
    // a symmetric extent has no direction to reverse
    if (flip && !extra.end) e.flip = true;
    if (regions) e.regions = regions;
    if (extra.draft) { e.draft = extra.draft; if (extra.draftOut) e.draftOut = true; }
    if (op === 'newBody') { e.body = newName; newName = undefined; }
    return e;
  };

  /** How far `p` (a point in our world) lies above a placed sketch plane, along the normal of that plane. */
  const heightAbove = (pl: Placed, p: V3): number => {
    if (pl.frame) return dot3([p[0] - pl.frame.o[0], p[1] - pl.frame.o[1], p[2] - pl.frame.o[2]], pl.frame.z);
    return dot3(p, (OUR_PLANE as Record<string, { z: V3 }>)[pl.std].z) - pl.offset;
  };

  /** The two faces of an edge by their names in the file (`F2:side:l5@F5.1|F2:start@F5.1`; pieces of a split face carry `#1`, `#2`, which is ignored here: the nearest edge between any pieces of those faces is meant, and the stored position is tried first) as the names this kit gives them; undefined for any other form (a shell's inner faces, other features). */
  const faceNames = (edgeName: string | undefined): [FaceName, FaceName] | undefined => {
    const parts = edgeName?.split('|');
    if (parts?.length !== 2) return undefined;
    const one = (t: string): FaceName | undefined => {
      const m = /^F(\d+):(?:side:(l\d+)|(start|top|end))(?:#\d+)?(?:@F(\d+)\.1)?(?:#\d+)?$/.exec(t);
      if (!m) return undefined;
      const ext = ourExtrude.get(Number(m[1]));
      if (!ext) return undefined;
      let inst: string | undefined;
      if (m[4]) { const mv = ourMove.get(Number(m[4])); if (!mv) return undefined; inst = `@${mv}.1`; }
      if (m[2]) {
        const sk = extrudeSketch.get(Number(m[1])), ent = sk === undefined ? undefined : sketches.get(sk)?.entityOf.get(m[2]);
        return ent ? { prefix: `${ext}.S.${ent}`, ...(inst ? { inst } : {}) } : undefined;
      }
      return { prefix: `${ext}.C${m[3] === 'start' ? 0 : 1}`, ...(inst ? { inst } : {}) };
    };
    const a = one(parts[0]), b = one(parts[1]);
    return a && b ? [a, b] : undefined;
  };

  /** A sketch made of one spline (and the origin) is a path for a sweep: a 3D sketch with the spline through the same points in space. */
  const splinePathOf = (f: Rec): { notes: string[] } | null => {
    const sk = f.sketch as Rec, curves: Rec[] = sk.curves ?? [];
    if (curves.length !== 1 || curves[0].type !== 'spline' || curves[0].closed) return null;
    const ids: unknown[] = curves[0].pts ?? [];
    const pts: Rec[] = sk.points ?? [];
    if (ids.length < 2) return null;
    const fr = frameOf(f.plane), u = unit(fr.u), v = unit(fr.v);
    const at = (i: number): V3 => {
      const q = pts[i]?.pos as P2 | undefined;
      if (!q) throw new Unsupported('a spline through a point that is not in the sketch');
      return [0, 1, 2].map((k) => fr.o[k] + u[k] * q[0] + v[k] * q[1]) as V3;
    };
    let out = ids.map((i) => toYUp(at(Number(i))));
    const notes: string[] = [];
    if (curves[0].control) {
      // the points are the control polygon: the kernel's sweep path takes only a through-points spline, so the curve of the B-spline is sampled
      const p = Number.isInteger(curves[0].degree) ? Number(curves[0].degree) : 3;
      if (p < 1 || out.length < p + 1) throw new Unsupported('a control-vertex spline path with fewer points than its degree needs');
      out = sampleBSpline(out, p, Array.isArray(curves[0].knots) ? (curves[0].knots as number[]) : undefined);
      notes.push(`control-vertex spline path (degree ${p}) is carried as a through-points spline sampled from the curve (${out.length} points)`);
    }
    const id = nid();
    features.push({ type: 'sketch3d', id, name: f.name, points: out.map((q, k) => ({ id: `p${k + 1}`, x: clean(q[0]), y: clean(q[1]), z: clean(q[2]) })), entities: [{ id: 'e1', type: 'spline', pts: out.map((_, k) => `p${k + 1}`) }], constraints: [] });
    splinePaths.set(f.id, id);
    return { notes };
  };

  const sketchOf = (f: Rec): { notes: string[] } => {
    const path = splinePathOf(f);
    if (path) return path;
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
      const isOrigin = originRoot >= 0 && r === find(originRoot);
      // their sketch origin is the origin of their plane; ours is the plane's, which differs when the plane was moved within its own plane (a custom frame): then it is a point like the others
      const at = (): [number, number] => (isOrigin ? mapXY(placed, 0, 0) : mapXY(placed, ...(pts[r].pos as [number, number])));
      if (isOrigin) { const [ox, oy] = at(); if (Math.hypot(ox, oy) < 1e-9) return 'O'; }
      let id = ids.get(r);
      if (!id) {
        id = `p${ids.size + 1}`;
        ids.set(r, id);
        const [x, y] = at();
        outPts.push({ id, x, y });
      }
      return id;
    };
    const eid = (i: number) => `e${i + 1}`;
    // lettering: the file keeps the string and the outlines of its glyphs (curves linked to it); we keep the string as a text entity
    const textOf = new Map<string, string>();   // link id -> our text entity id
    const notes: string[] = [];
    const texts: FeatureJson[] = [];
    for (const l of (sk.links as Rec[] | undefined) ?? []) {
      if (l?.kind !== 'text' || !l.source?.text) continue;
      const src = l.source as Rec, a = Number(src.angle ?? 0), at = (src.at as P2 | undefined) ?? [0, 0];
      const d = [Math.cos(a), Math.sin(a)], t = placed.t;
      const e: FeatureJson = { id: `tx${texts.length + 1}`, type: 'text', string: String(src.text), font: 'gauge', height: num(src.height, 'text height'), at: mapXY(placed, at[0], at[1]) };
      const ang = (Math.atan2(t[2] * d[0] + t[3] * d[1], t[0] * d[0] + t[1] * d[1]) * 180) / Math.PI;
      if (Math.abs(ang) > 1e-9) e.angle = ang;
      if (mirrored(placed)) e.mirror = true;
      texts.push(e);
      textOf.set(String(l.id), e.id as string);
      if (src.font && src.font !== 'gauge') notes.push(`text "${src.text}": font "${src.font}" is not available here; the built-in sans is used`);
    }
    const textCurve = (c: Rec) => (c.link !== undefined && textOf.has(String(c.link)) ? textOf.get(String(c.link))! : undefined);
    const entities = curves.map((c, i): FeatureJson => {
      const e: FeatureJson = { id: eid(i) };
      if (textCurve(c)) return e;   // a glyph outline: replaced by the text entity
      if (c.type === 'line') Object.assign(e, { type: 'line', p1: pid(c.a), p2: pid(c.b) });
      else if (c.type === 'arc') {
        // counter-clockwise from start to end in their sketch; a mirrored sketch plane turns that round
        const [a, b] = mirrored(placed) ? [c.b, c.a] : [c.a, c.b];
        Object.assign(e, { type: 'arc', c: pid(c.c), p1: pid(a), p2: pid(b) });
      }
      else if (c.type === 'circle') Object.assign(e, { type: 'circle', c: pid(c.c), r: clean(Number(c.r)) });
      // an ellipse: its centre, the end of its major axis and the minor radius (a mirrored or turned plane keeps all three as they are)
      else if (c.type === 'ellipse' && pts[c.c] && pts[c.m] && Number(c.r) > 0) Object.assign(e, { type: 'ellipse', c: pid(c.c), p: pid(c.m), r: clean(Number(c.r)) });
      else if (c.type === 'spline' && Array.isArray(c.pts) && c.pts.length >= 2) {
        // `control` says the points are the control polygon of a B-spline of the given degree; otherwise the curve passes through them
        const ends = { pts: (c.pts as number[]).map(pid), ...(c.closed ? { closed: true } : {}) };
        if (c.control) Object.assign(e, { type: 'cvspline', ...ends, ...(Number.isInteger(c.degree) ? { degree: c.degree } : {}) });
        else Object.assign(e, { type: 'spline', ...ends });
      }
      else throw new Unsupported(`sketch curve "${c.type}"`);
      if (c.construction) e.construction = true;
      return e;
    });
    const constraints: FeatureJson[] = [];
    let kn = 0;
    /** A dimension that names a parameter holding the same number is driven by that variable. */
    const bind = (c: FeatureJson, k: Rec): FeatureJson => {
      const p = k.param;
      if (typeof p === 'string' && paramNames.has(p) && Math.abs(vars[p] - Number(c.value)) < 1e-6 * Math.max(1, Math.abs(vars[p]))) c.expr = `=${p}`;
      return c;
    };
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
        if (a !== b) constraints.push(bind({ id: `k${++kn}`, type: 'distance', refs: [a, b], value: Number(k.value) }, k));
        continue;
      }
      // the rest need the curves and points they name to be in the sketch (not glyph outlines of lettering, which are a text entity)
      const keep = (i: unknown) => typeof i === 'number' && !!curves[i] && !textCurve(curves[i]);
      const isRound = (i: unknown) => keep(i) && (curves[i as number].type === 'arc' || curves[i as number].type === 'circle');
      const isLine = (i: unknown) => keep(i) && curves[i as number].type === 'line';
      const num2 = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
      const dim = (type: string, refs: string[]): void => { const v = num2(k.value); if (v !== undefined && v > 0) constraints.push(bind({ id: `k${++kn}`, type, refs, value: clean(v) }, k)); else notes.push(`${k.type} constraint dropped (no usable value)`); };
      if (k.type === 'midpoint' && isLine(k.l) && pts[k.p]) { constraints.push({ id: `k${++kn}`, type: 'midpoint', refs: [pid(k.p), eid(k.l)] }); continue; }
      if ((k.type === 'distance_x' || k.type === 'distance_y') && pts[k.p] && pts[k.q] && find(k.p) !== find(k.q)) {
        const horizontal = (k.type === 'distance_x') !== swapsAxes(placed);   // an axis swap turns their horizontal distance into our vertical one
        dim(horizontal ? 'hdist' : 'vdist', [pid(k.p), pid(k.q)]);
        continue;
      }
      if (k.type === 'distance' && pts[k.p] && pts[k.q] && find(k.p) !== find(k.q)) { dim('distance', [pid(k.p), pid(k.q)]); continue; }
      if ((k.type === 'radius' || k.type === 'diameter') && isRound(k.c)) { dim(k.type, [eid(k.c)]); continue; }
      if (k.type === 'tangent' && keep(k.a) && keep(k.b)) { constraints.push({ id: `k${++kn}`, type: 'tangent', refs: [eid(k.a), eid(k.b)] }); continue; }
      if (k.type === 'symmetric' && pts[k.p] && pts[k.q] && isLine(k.l) && find(k.p) !== find(k.q)) { constraints.push({ id: `k${++kn}`, type: 'symmetric', refs: [pid(k.p), pid(k.q), eid(k.l)] }); continue; }
      if (k.type === 'collinear' && isLine(k.a) && isLine(k.b)) { constraints.push({ id: `k${++kn}`, type: 'collinear', refs: [eid(k.a), eid(k.b)] }); continue; }
      if (k.type === 'point_on_curve' && pts[k.p] && (isLine(k.c) || isRound(k.c))) { constraints.push({ id: `k${++kn}`, type: isLine(k.c) ? 'pointOnLine' : 'pointOnCircle', refs: [pid(k.p), eid(k.c)] }); continue; }
      if ((k.type === 'parallel' || k.type === 'perpendicular') && isLine(k.a) && isLine(k.b)) { constraints.push({ id: `k${++kn}`, type: k.type, refs: [eid(k.a), eid(k.b)] }); continue; }
      if (k.type === 'equal' && keep(k.a) && keep(k.b) && ((isLine(k.a) && isLine(k.b)) || (isRound(k.a) && isRound(k.b)))) { constraints.push({ id: `k${++kn}`, type: 'equal', refs: [eid(k.a), eid(k.b)] }); continue; }
      if (k.type === 'point_line_distance' && pts[k.p] && isLine(k.l)) { dim('pldist', [pid(k.p), eid(k.l)]); continue; }
      if (k.type === 'fix' && pts[k.p]) {
        const at = pid(k.p);
        if (at !== 'O') constraints.push({ id: `k${++kn}`, type: 'fix', refs: [at], value: mapXY(placed, ...(pts[k.p].pos as [number, number])) });
        continue;
      }
      notes.push(`${k.type} constraint dropped (the geometry is kept as stored)`);
    }
    const id = nid();
    const kept = [...entities.filter((e) => e.type !== undefined), ...texts];   // one array: a revolve adds its axis line to it later
    features.push({ type: 'sketch', id, name: f.name, plane, points: outPts, entities: kept, constraints });
    const geo = new Map<string, Geo>();
    for (const c of curves) {
      if (textCurve(c)) continue;
      const at = (i: number) => pts[i].pos as P2;
      if (c.type === 'line') geo.set(String(c.id), { type: 'line', a: at(c.a), b: at(c.b) });
      else if (c.type === 'arc') geo.set(String(c.id), { type: 'arc', a: at(c.a), b: at(c.b), c: at(c.c) });
      else if (c.type === 'circle') geo.set(String(c.id), { type: 'circle', c: at(c.c), r: Number(c.r) });
    }
    sketches.set(f.id, { id, entityOf: new Map(curves.map((c, i) => [String(c.id), textCurve(c) ?? eid(i)])), placed, plane, geo, json: { points: outPts, entities: kept } });
    return { notes };
  };

  /**
   * A pattern along a path, for round seeds (holes, round bosses): we have no such pattern, so each instance is the seed's sketch moved to
   * its place on the path and extruded the same way. Instances are `spacing` apart along one line or arc, the first being the seed itself;
   * the seed does not turn (round seeds look the same turned, so no orientation is needed).
   */
  /** A circular pattern of features about a coordinate axis through the origin: the kernel's `cpattern` (it turns only about the world axes). */
  const featureCircularPattern = (f: Rec, pt: Rec, names: string[]): string[] => {
    const seeds = names.flatMap((nm) => named.get(nm) ?? (() => { throw new Unsupported(`pattern of "${nm}", which was not imported`); })());
    const ax = pt.axis as V3 | undefined, org = (pt.origin as V3 | undefined) ?? [0, 0, 0];
    if (!ax || Math.hypot(ax[0], ax[1], ax[2]) < 1e-9) throw new Unsupported('a circular pattern without an axis');
    const a = axisOf(ax, 'a circular pattern axis', toYUp), at = toYUp(org), k = 'xyz'.indexOf(a.axis);
    if (at.some((c, i) => i !== k && Math.abs(c) > 1e-6)) throw new Unsupported('a circular pattern of features about an axis that does not pass through the origin');
    const count = num(pt.count, 'pattern count'), angle = pt.angle === undefined ? 360 : num(pt.angle, 'pattern angle');
    if (!(count >= 2) || !Number.isInteger(count)) throw new Unsupported('a pattern with a single instance');
    if (!(Math.abs(angle) > 0)) throw new Unsupported('a circular pattern of no angle');
    const id = nid();
    features.push({ type: 'cpattern', id, name: f.name, seeds, axis: { kind: 'axis', axis: a.axis }, count, angle: Math.abs(angle), equal: true, ...(a.neg !== angle < 0 ? { reverse: true } : {}) });
    named.set(f.name, [id]);
    return [];
  };
  // A circular pattern of whole bodies: rotated copies about an axis that may lie anywhere (the kernel's own circular pattern only turns about the world axes).
  const circularPattern = (f: Rec, pt: Rec): string[] => {
    const srcs = Array.isArray(f.bodies) ? (f.bodies as string[]) : [];
    const seedNames = Array.isArray(f.features) ? (f.features as string[]) : [];
    if (!srcs.length && seedNames.length) return featureCircularPattern(f, pt, seedNames);
    if (!srcs.length) throw new Unsupported('a circular pattern of no body');
    if (seedNames.length) throw new Unsupported('a circular pattern of features together with bodies');
    for (const b of srcs) if (!live.includes(b)) throw new Unsupported(`"${f.name}" repeats the body "${b}", which does not exist at this point`);
    const ax = pt.axis as V3 | undefined, org = (pt.origin as V3 | undefined) ?? [0, 0, 0];
    if (!ax || Math.hypot(ax[0], ax[1], ax[2]) < 1e-9) throw new Unsupported('a circular pattern without an axis');
    const count = num(pt.count, 'pattern count'), angle = pt.angle === undefined ? 360 : num(pt.angle, 'pattern angle');
    if (!(count >= 2) || !Number.isInteger(count)) throw new Unsupported('a pattern with a single instance');
    const step = Math.abs(Math.abs(angle) - 360) < 1e-9 ? angle / count : angle / (count - 1);
    const axis = toYUp(ax).map(clean), origin = toYUp(org).map(clean);
    for (const src of srcs) {
      for (let k = 1; k < count; k++) {
        const nm = `${src} ${k + 1}`;
        if (live.includes(nm)) throw new Unsupported(`the body name "${nm}" is used twice`);
        bodyCount++; live.push(nm);
        features.push({ type: 'moveBody', id: nid(), name: `${f.name} (${nm})`, bodies: [{ body: src }], copy: true, body: nm, rotate: { axis, origin, angle: clean(step * k) } });
      }
    }
    return [];
  };
const pathPattern = (f: Rec, pt: Rec): string[] => {
    const ps = sketches.get(pt.path_sketch), curveIds = (pt.path as string[] | undefined) ?? [];
    if (!ps || curveIds.length !== 1) throw new Unsupported(curveIds.length > 1 ? 'a path of several curves' : 'a path pattern whose path sketch was not imported');
    const g = ps.geo.get(String(curveIds[0]));
    if (!g || (g.type !== 'line' && g.type !== 'arc')) throw new Unsupported('a path that is not a line or an arc');
    const count = num(pt.count, 'pattern count'), spacing = num(pt.spacing, 'pattern spacing');
    if (!(count >= 2) || !(spacing > 0)) throw new Unsupported('a pattern with a single instance');
    // where the path is, `s` along it, in the path sketch's own coordinates
    let length: number, at: (s: number) => P2;
    if (g.type === 'line') {
      length = Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]);
      at = (u) => [g.a[0] + ((g.b[0] - g.a[0]) * u) / length, g.a[1] + ((g.b[1] - g.a[1]) * u) / length];
    } else {
      const r = Math.hypot(g.a[0] - g.c[0], g.a[1] - g.c[1]), a0 = Math.atan2(g.a[1] - g.c[1], g.a[0] - g.c[0]);
      let sweep = Math.atan2(g.b[1] - g.c[1], g.b[0] - g.c[0]) - a0;
      while (sweep <= 1e-12) sweep += 2 * Math.PI;   // arcs run counter-clockwise from start to end
      length = r * sweep;
      at = (u) => [g.c[0] + r * Math.cos(a0 + u / r), g.c[1] + r * Math.sin(a0 + u / r)];
    }
    if ((count - 1) * spacing > length * (1 + 1e-6)) throw new Unsupported('a path shorter than its pattern');
    const frame = (OUR_PLANE as Record<string, { x: V3; y: V3; z: V3 }>)[ps.placed.std];
    if (!frame) throw new Unsupported('a path pattern whose path lies on a tilted plane');
    const world = (q: P2): V3 => { const [x, y] = mapXY(ps.placed, q[0], q[1]); return [0, 1, 2].map((k) => x * frame.x[k] + y * frame.y[k] + ps.placed.offset * frame.z[k]) as V3; };
    const origin = world(at(0));
    const out: string[] = [];
    for (const nm of (f.features as string[] | undefined) ?? []) {
      const seedIds = named.get(nm);
      if (!seedIds) throw new Unsupported(`pattern of "${nm}", which was not imported`);
      for (const sid of seedIds) {
        const ex = features.find((q) => q.id === sid);
        const sk = ex && features.find((q) => q.type === 'sketch' && q.id === ex.sketch);
        if (!ex || ex.type !== 'extrude' || !sk) throw new Unsupported(`a path pattern of "${nm}", which is not an extrude`);
        // only what the extrude uses is repeated: its chosen profiles, or the whole sketch when it uses all of it
        const chosen = Array.isArray(ex.regions) ? new Set(ex.regions as string[]) : null;
        const ents = (sk.entities as FeatureJson[]).filter((e) => !chosen || chosen.has(e.id as string));
        if (!ents.length || ents.some((e) => e.type !== 'circle')) throw new Unsupported(`a path pattern of "${nm}", which is not made of circles`);
        const pl = sk.plane as { kind: string; id: string };
        const base = pl.kind === 'std' ? { std: pl.id, offset: 0 } : (() => { const q = features.find((x) => x.type === 'plane' && x.id === pl.id); return q && q.mode === 'offset' && (q.base as { kind: string })?.kind === 'std' ? { std: (q.base as { id: string }).id, offset: Number(q.offset) } : null; })();
        const sf = base && (OUR_PLANE as Record<string, { x: V3; y: V3; z: V3 }>)[base.std];
        if (!base || !sf) throw new Unsupported(`a path pattern of "${nm}", whose sketch plane is not a standard or offset plane`);
        for (let i = 1; i < count; i++) {
          const p = world(at(i * spacing)), d: V3 = [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]];
          if (Math.abs(dot3(d, sf.z)) > 1e-6) throw new Unsupported(`a path that leaves the plane of "${nm}"`);
          const dx = clean(dot3(d, sf.x)), dy = clean(dot3(d, sf.y));
          const nsid = nid();
          features.push({ type: 'sketch', id: nsid, name: `${f.name} ${i}`, plane: sk.plane, points: (sk.points as FeatureJson[]).map((q) => (q.id === 'O' ? { ...q } : { ...q, x: clean(Number(q.x) + dx), y: clean(Number(q.y) + dy) })), entities: JSON.parse(JSON.stringify(ents)), constraints: [], visible: false });
          const nex = { ...ex, id: nid(), sketch: nsid, name: `${f.name} ${i}` };
          features.push(nex);
          out.push(nex.id as string);
        }
      }
    }
    if (!out.length) throw new Unsupported('a pattern with nothing to repeat');
    named.set(f.name, out);
    return [];
  };

  /**
   * A sketch of ours that holds exactly the curves `ids` of their sketch `src` (lines and arcs, joined by shared points): the sketch itself when
   * it draws nothing else, else a hidden copy. A sweep path or a guide rail is the whole drawn content of the sketch it is given as.
   */
  const curveSketch = (src: number | string, ids: string[], name: string): string => {
    const s = sketches.get(src);
    if (!s) throw new Unsupported(failedSketches.has(src) ? `depends on sketch ${src}, which was not imported` : `refers to sketch ${src}, which is not in the file`);
    const chosen = new Set(ids.map((c) => s.entityOf.get(String(c))));
    if (chosen.has(undefined)) throw new Unsupported('a curve that is not in its sketch');
    if (ids.some((c) => { const g = s.geo.get(String(c)); return !g || g.type === 'circle'; })) throw new Unsupported('a path or rail that is not made of lines and arcs');
    const drawn = s.json.entities.filter((e) => !e.construction && e.type !== 'text');
    if (drawn.every((e) => chosen.has(e.id as string)) && [...chosen].every((c) => drawn.some((e) => e.id === c))) return s.id;
    const pts: FeatureJson[] = [{ id: 'O', x: 0, y: 0, fixed: true }], ents: FeatureJson[] = [], at = new Map<string, string>();
    const m = (q: P2): string => {
      const [x, y] = mapXY(s.placed, q[0], q[1]), key = `${x.toFixed(6)},${y.toFixed(6)}`;
      let id = at.get(key);
      if (!id) { id = `q${pts.length}`; pts.push({ id, x, y }); at.set(key, id); }
      return id;
    };
    for (const cid of ids.map(String)) {
      const g = s.geo.get(cid);
      if (!g || g.type === 'circle') throw new Unsupported('a path or rail that is not made of lines and arcs');
      if (g.type === 'line') ents.push({ id: `c${ents.length + 1}`, type: 'line', p1: m(g.a), p2: m(g.b) });
      else { const [a, b] = mirrored(s.placed) ? [g.b, g.a] : [g.a, g.b]; ents.push({ id: `c${ents.length + 1}`, type: 'arc', c: m(g.c), p1: m(a), p2: m(b) }); }
    }
    const nsid = nid();
    features.push({ type: 'sketch', id: nsid, name, plane: s.plane, points: pts, entities: ents, constraints: [], visible: false });
    return nsid;
  };

  /** The regions a revolve or a sheet base takes: all of the sketch, or the ones its outlines name (an outline that runs along only part of a curve is not carried). */
  const wholeRegions = (f: Rec, s: { entityOf: Map<string, string>; geo: Map<string, Geo> }, what: string): string[] | undefined => {
    const sel = f.profiles as Rec | undefined;
    if (sel?.type === 'all') return undefined;
    if (sel?.type === 'whole_boundaries') return boundaryRegions(sel, s.entityOf);
    if (sel?.type === 'curves' && Array.isArray(sel.loops) && sel.loops.length) {
      const loops = (sel.loops as unknown[]).map((l) => (Array.isArray(l) ? l : Array.isArray((l as Rec)?.curves) ? (l as Rec).curves : [])) as string[][];
      if (loops.some((l) => !l.length)) throw new Unsupported(`${what} with an empty profile`);
      if (loops.some((l) => !loopOutline(l.map(String), s.geo).whole)) throw new Unsupported(`${what} with a profile that runs along only part of a curve`);
      const ids = loops.flat().map((c) => s.entityOf.get(String(c)));
      if (ids.some((x) => !x)) throw new Unsupported('the chosen profile refers to a curve that is not in the sketch');
      return [...new Set(ids as string[])];
    }
    throw new Unsupported(`${what} profile selection "${sel?.type}"`);
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
          // loops made of the outlines of lettering select the text entity; the others are handled as below
          const isText = (l: string[]) => l.every((c) => String(s.entityOf.get(String(c))).startsWith('tx'));
          const letterIds = [...new Set(loops.filter(isText).flat().map((c) => s.entityOf.get(String(c))!))];
          const shapeLoops = loops.filter((l) => !isText(l));
          const plans = shapeLoops.map((l) => loopOutline(l.map(String), s.geo));
          if (letterIds.length && plans.some((p) => !p.whole)) throw new Unsupported('lettering together with an outline that uses only part of its curves');
          if (plans.every((p) => p.whole)) {
            regions = [...shapeLoops.flat().map((c) => s.entityOf.get(String(c))!), ...letterIds];
            if (regions.some((r) => !r)) throw new Unsupported('the chosen profile refers to a curve that is not in the sketch');
          } else {
            // a loop runs along only part of a curve: draw just the chosen outline(s) on the same plane and extrude that
            const pts: FeatureJson[] = [{ id: 'O', x: 0, y: 0, fixed: true }], ents: FeatureJson[] = [];
            plans.forEach((p, li) => {
              if (p.whole) {
                // a whole loop next to a trimmed one: copy its curves as they are
                for (const cid of shapeLoops[li]) {
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
        } else if (f.profiles?.type === 'whole_boundaries') regions = boundaryRegions(f.profiles, s.entityOf);
        else if (f.profiles?.type !== 'all') throw new Unsupported(`extrude profile selection "${f.profiles?.type}"`);
        // older files have no `convention`; their extents are the same total distance. `legacy_per_side` only differs from the total for a
        // symmetric extent (the distance on each side).
        const ext = (f.extent ?? {}) as Rec;
        const conv = ext.convention ?? 'total_distance';
        if (conv !== 'total_distance' && conv !== 'legacy_per_side') throw new Unsupported(`extrude extent "${conv}"`);
        const symmetric = ext.direction === 'symmetric';
        if (!symmetric && ext.direction !== 'positive' && ext.direction !== 'negative') throw new Unsupported(`extrude direction "${ext.direction}"`);
        const dist2 = ext.distance2 !== undefined ? num(ext.distance2, 'second extrude distance') : undefined;
        if (dist2 !== undefined && (symmetric || conv !== 'total_distance' || ext.direction !== 'positive' || ext.through_all || ext.to !== undefined || !(dist2 > 0))) throw new Unsupported('an extrude with a second distance (two sides) that is not a plain distance each way');
        const taper = ext.taper !== undefined ? num(ext.taper, 'extrude taper') : 0;
        if (taper !== 0 && (symmetric || dist2 !== undefined || ext.through_all || ext.to !== undefined)) throw new Unsupported('a tapered extrude that is symmetric, two-sided, through all or stops at a face');
        if (ext.to_offset !== undefined && num(ext.to_offset, 'end offset') !== 0) throw new Unsupported('an extrude that stops at an offset from a face');
        // a negative distance runs the other way: "-100 mm" going positive is 100 mm going negative
        const dist = ext.through_all ? 0 : num(ext.distance, 'extrude distance');
        let forward = symmetric || (ext.direction === 'positive') !== (dist < 0);
        if (!ext.through_all && Math.abs(dist) < 1e-12) throw new Unsupported('an extrude of zero distance');
        if (dist2 !== undefined && dist < 0) throw new Unsupported('an extrude with a second distance (two sides) that is not a plain distance each way');
        // an extent "to" a point or face: the extrude runs to the plane through that point that is parallel to the sketch (the usual
        // target, a face facing the sketch). The depth is fixed here at what it reaches now; the stored distance is only the value the
        // file last had and is not used when it differs.
        let reachDepth: number | undefined;
        const stops: string[] = [];
        if (ext.to !== undefined) {
          const to = ext.to as V3 | undefined;
          if (!Array.isArray(to) || ext.through_all || symmetric) throw new Unsupported('an extrude that stops at a point or face');
          const startAt = ext.start_offset !== undefined ? num(ext.start_offset, 'start offset') : 0;
          // the direction follows the target: towards the plane through the point, whatever the stored direction says
          const gap = heightAbove(s.placed, toYUp(to));
          reachDepth = Math.abs(gap) - startAt;
          if (!(reachDepth > 1e-9)) throw new Unsupported('an extrude whose target lies at or before its start');
          forward = gap * s.placed.sign > 0;
          stops.push(`${f.name}: stops at a face; imported as the fixed depth ${+reachDepth.toFixed(4)} it reaches now${Math.abs(reachDepth - Math.abs(dist)) > 1e-3 * Math.max(1, Math.abs(dist)) ? ` (the stored distance ${Math.abs(dist)} is not used)` : ''}`);
        }
        // a start offset moves the profile along the extrude direction before it is extruded: the same sketch on an offset plane
        const startOffset = ext.start_offset !== undefined ? num(ext.start_offset, 'start offset') : 0;
        let delta = (forward ? 1 : -1) * s.placed.sign * startOffset;   // in our normal
        // a start "from" a face: the profile starts on the plane through that point, parallel to the sketch
        if (ext.from !== undefined) {
          if (!Array.isArray(ext.from) || ext.from.length !== 3 || symmetric) throw new Unsupported('an extrude that starts at a point or face');
          if (!forward && Math.abs(startOffset) > 1e-12) throw new Unsupported('an extrude that starts at a face plus an offset and runs against its sketch normal');
          const at = heightAbove(s.placed, toYUp(ext.from as V3));
          delta += at;
          stops.push(`${f.name}: starts at a face; imported as the profile moved ${+at.toFixed(4)} from its sketch plane`);
        }
        let total = reachDepth ?? Math.abs(dist);
        if (dist2 !== undefined) {
          if (Math.abs(startOffset) > 1e-12 || ext.from !== undefined) throw new Unsupported('an extrude with a second distance (two sides) and a start offset');
          // the sketch plane lies inside the solid: start the profile the second distance back and run the two distances together
          delta = -s.placed.sign * dist2;
          total = Math.abs(dist) + dist2;
        }
        if (Math.abs(delta) > 1e-12) {
          const src = features.find((q) => q.type === 'sketch' && q.id === sk.id);
          if (!src) throw new Unsupported('an offset start for a sketch that cannot be copied');
          const fz = s.placed.frame?.z;
          const moved: Placed = { ...s.placed, offset: s.placed.offset + delta, ...(s.placed.frame && fz ? { frame: { ...s.placed.frame, o: s.placed.frame.o.map((c, k) => clean(c + fz[k] * delta)) as V3 } } : {}) };
          const nsid = nid();
          features.push({ type: 'sketch', id: nsid, name: `${f.name} start`, plane: planeRef(moved), points: JSON.parse(JSON.stringify(src.points)), entities: JSON.parse(JSON.stringify(src.entities)), constraints: [], visible: false });
          sk = { ...s, id: nsid };
        }
        if (symmetric) {
          const half = conv === 'legacy_per_side' ? 2 : 1;
          features.push(extrudeOf(f, sk.id, ext.through_all ? 'through' : Math.abs(dist) * half, true, s.placed.sign, regions, { end: ext.through_all ? 'throughBoth' : 'mid' }));
        } else features.push(extrudeOf(f, sk.id, ext.through_all ? 'through' : dist2 === undefined && reachDepth === undefined && dist > 0 ? field(ext.distance, 'extrude distance') : total, forward, s.placed.sign, regions, taper !== 0 ? { draft: Math.abs(taper), draftOut: taper > 0 } : {}));
        named.set(f.name, [features[features.length - 1].id as string]);
        if (f.profiles?.type === 'all' && f.operation === 'cut' && hasEnclosingOutline(s.geo)) stops.push('all profiles selected; the file does not name the regions, and the sketch holds an outline around other shapes, so this cut can remove the whole body');
        return stops;
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
          const { u, v } = scPlane(name, version)!, nrm = cross3(u, v), d = dot3(ax, nrm);
          return len > 0 && Math.abs(Math.abs(d) - 1) < 1e-9 ? { name, u, v, nrm, positive: d > 0 } : null;   // |d| = 1 for a unit vector means it IS the plane normal
        }).find(Boolean);
        if (!(len > 0)) throw new Unsupported('a cylinder with no axis');
        // along another direction: the circle stands on a plane through the base with the axis as its normal (a tilted plane of ours)
        const pl = hit ? placeOf(hit.name, dot3(b, hit.nrm)) : placeFrame(faceFrame(b, ax), true, toYUp);
        const plane = planeRef(pl);
        const [cx, cy] = hit ? mapXY(pl, dot3(b, hit.u), dot3(b, hit.v)) : [0, 0];
        const sid = nid();
        features.push({ type: 'sketch', id: sid, name: `${f.name} sketch`, plane, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: cx, y: cy }], entities: [{ id: 'e1', type: 'circle', c: 'p1', r: num(f.radius, 'cylinder radius') }], constraints: [] });
        features.push(extrudeOf(f, sid, field(f.height, 'cylinder height'), hit ? hit.positive : true, pl.sign));
        named.set(f.name, [features[features.length - 1].id as string]);
        return [];
      }
      case 'sphere': {
        const op = operation(f);
        features.push({ type: 'sphere', id: nid(), name: f.name, op, center: toYUp(f.center as V3).map(clean), radius: field(f.radius, 'sphere radius'), ...(op === 'newBody' ? { body: newName } : {}) });
        newName = undefined;
        named.set(f.name, [features[features.length - 1].id as string]);
        return [];
      }
      case 'torus': {
        // a ring about their Z axis: a circle of the tube's radius, revolved about a vertical line through the centre, in a plane through that axis
        const c = f.center as V3 | undefined;
        if (!c) throw new Unsupported('a torus without a centre');
        if (yUp) throw new Unsupported('a torus in a file that is already Y up');
        const major = num(f.major, 'torus major radius'), minor = num(f.minor, 'torus minor radius');
        if (!(minor > 0 && major > minor)) throw new Unsupported('a torus whose tube is as wide as its ring');
        const op = operation(f);
        const [cx, cy, cz] = toYUp(c);
        const plane = planeRef({ std: 'front', offset: clean(cz), t: [1, 0, 0, 1], s: [0, 0], sign: 1 });
        const sid = nid();
        features.push({ type: 'sketch', id: sid, name: `${f.name} section`, plane, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: clean(cx + major), y: clean(cy) }, { id: 'a1', x: clean(cx), y: clean(cy) }, { id: 'a2', x: clean(cx), y: clean(cy + 10) }], entities: [{ id: 'e1', type: 'circle', c: 'p1', r: minor }, { id: 'e2', type: 'line', p1: 'a1', p2: 'a2', construction: true }], constraints: [], visible: false });
        features.push({ type: 'revolve', id: nid(), op, sketch: sid, axis: 'e2', end: 'blind', angle: 360, name: f.name, ...(op === 'newBody' ? { body: newName } : {}) });
        newName = undefined;
        named.set(f.name, [features[features.length - 1].id as string]);
        return [];
      }
      case 'sheet_base': {
        // a flat sheet from a closed profile: the profile extruded by the thickness of the sheet rule it names (bend settings of the rule are not kept)
        const s = sketches.get(f.sketch);
        if (!s) throw new Unsupported(failedSketches.has(f.sketch) ? `depends on sketch ${f.sketch}, which was not imported` : `refers to sketch ${f.sketch}, which is not in the file`);
        const regions = wholeRegions(f, s, 'sheet base');
        const rule = ((doc.sheet as Rec | undefined)?.rules as Rec[] | undefined)?.find((r) => r.name === f.rule);
        if (!rule) throw new Unsupported(`the sheet rule "${f.rule}" is not in the file`);
        const T = num(rule.thickness, 'sheet thickness');
        if (!(T > 0)) throw new Unsupported('a sheet of no thickness');
        const ex = extrudeOf({ ...f, operation: bodies === 0 ? 'new_body' : 'join' }, s.id, T, f.flip !== true, s.placed.sign, regions);
        features.push(ex);
        named.set(f.name, [ex.id as string]);
        return [`a sheet metal base flange is carried as a plain extrude of its thickness ${T} mm; the bend rule is not kept`];
      }
      case 'hole': {
        // their hole is a position, a drilling direction (into the material) and sizes; ours is a sketch of points on the face with the hole drilled into it.
        // The sketch stands on the face at the hole: its normal points out of the material, so the drill (against the normal) runs along their direction.
        if (bodies === 0) throw new Unsupported('a hole with no body to drill');
        const dir = f.direction as V3 | undefined, entry0 = f.position as V3 | undefined;
        if (!dir) throw new Unsupported('a hole without a drilling direction');
        const kind = (f.hole as Rec | undefined)?.type ?? 'simple';
        // where the axes meet the surface, in their world: the hole's own position, or the chosen points of a sketch (on that sketch's plane)
        let at: V3[];
        if (f.points) {
          const ps = f.points as { sketch: number; ids: string[] };
          const raw = (doc.features as Rec[]).find((q) => q.id === ps.sketch && q.type === 'sketch');
          if (!raw) throw new Unsupported('a hole at the points of a sketch that is not in the file');
          const fr = frameOf(raw.plane as Rec), pts = (raw.sketch as Rec).points as Rec[];
          at = ps.ids.map((pid) => {
            const q = pts.find((x) => x.id === pid);
            if (!q) throw new Unsupported(`a hole at the sketch point "${pid}", which is not in the sketch`);
            const [x, y] = q.pos as [number, number];
            return [0, 1, 2].map((k) => fr.o[k] + fr.u[k] * x + fr.v[k] * y) as V3;
          });
        } else {
          if (!entry0) throw new Unsupported('a hole without a position');
          at = [entry0];
        }
        if (!at.length) throw new Unsupported('a hole at no points');
        const d = unit(dir), out: V3 = [-d[0], -d[1], -d[2]];
        const fr = faceFrame(at[0], out), pl = placeFrame(fr, false, toYUp), plane = planeRef(pl);
        const u = unit(fr.u), v = unit(fr.v);
        const sid = nid();
        const pts: FeatureJson[] = [{ id: 'O', x: 0, y: 0, fixed: true }], ents: FeatureJson[] = [];
        at.forEach((q, i) => {
          const rel: V3 = [q[0] - at[0][0], q[1] - at[0][1], q[2] - at[0][2]];
          if (Math.abs(dot3(rel, d)) > 1e-6) throw new Unsupported('a hole at points that are not on one plane across the drill');
          const [x, y] = mapXY(pl, dot3(rel, u), dot3(rel, v));
          pts.push({ id: `p${i + 1}`, x, y }); ents.push({ id: `e${i + 1}`, type: 'point', p: `p${i + 1}` });
        });
        features.push({ type: 'sketch', id: sid, name: `${f.name} points`, plane, points: pts, entities: ents, constraints: [], visible: false });
        const notes: string[] = [];
        const h: FeatureJson = { type: 'hole', id: nid(), name: f.name, sketch: sid, diameter: field(f.diameter, 'hole diameter') };
        if (f.to !== undefined && f.to !== null) {
          // up to a face: the depth to the plane through that point across the drill (the face the file names is square to the drill)
          const target = f.to as V3 | undefined;
          if (!Array.isArray(target) || target.length !== 3) throw new Unsupported('a hole drilled up to a face or point that the file does not locate');
          const reach = dot3([target[0] - at[0][0], target[1] - at[0][1], target[2] - at[0][2]], d);
          if (!(reach > 1e-9)) throw new Unsupported('a hole whose end face lies at or behind its start');
          h.end = 'blind'; h.depth = clean(reach);
        } else if (f.depth === undefined || f.depth === null) h.end = 'through'; else { h.end = 'blind'; h.depth = field(f.depth, 'hole depth'); }
        if (pl.sign < 0) h.flip = true;   // their drill runs against the normal of the sketch we stand on; ours does too, unless the plane faces the other way
        const hk = f.hole as Rec | undefined;
        if (kind === 'simple') h.kind = 'simple';
        else if (kind === 'drilled') {
          h.kind = 'simple'; h.tip = true;
          if (Math.abs(num(hk!.tip_angle, 'tip angle') - 118) > 0.5) notes.push('the drill point is the standard 118 degrees; theirs is a different angle');
        } else if (kind === 'counterbore') { h.kind = 'cbore'; h.cboreDiameter = field(hk!.cb_diameter, 'counterbore diameter'); h.cboreDepth = field(hk!.cb_depth, 'counterbore depth'); }
        else if (kind === 'countersink') { h.kind = 'countersink'; h.cskDiameter = num(hk!.cs_diameter, 'countersink diameter'); h.cskAngle = num(hk!.cs_angle, 'countersink angle'); }
        else throw new Unsupported(`a ${kind} hole`);
        features.push(h);
        if (Array.isArray(f.references) && f.references.length) notes.push('placed by distances from edges: kept at the place they give now, so it will not follow those edges');
        if (f.thread) notes.push(`the cosmetic thread "${String(f.thread)}" is not kept (an annotation, no geometry)`);
        named.set(f.name, [h.id as string]);
        return notes;
      }
      case 'fillet': case 'chamfer': {
        if (!opts.resolver) throw new Unsupported('needs the kernel to find its edges');
        const points = (f.edges as V3[] | undefined)?.map(toYUp);   // the edge positions are in their Z-up world
        if (!points?.length) throw new Unsupported('no edge positions in the file');
        // the stored direction of each edge: when a parameter changed after the pick, the point is off the body but the line is not
        let hints = points.map((_, i): EdgeHint | undefined => {
          const r = (f.edge_refs as Rec[] | undefined)?.[i];
          const d = r?.dir as V3 | undefined, lo = r?.min as V3 | undefined, hi = r?.max as V3 | undefined;
          const h: EdgeHint = {};
          if (d && Math.hypot(d[0], d[1], d[2]) > 0.5) h.dir = toYUp(d);
          if (lo && hi) {
            const a = toYUp(lo), b = toYUp(hi);
            h.box = { min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])], max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])] };
          }
          if (typeof f.body === 'string') h.body = f.body;
          const fn = faceNames((f.edge_names as string[] | undefined)?.[i]);
          if (fn) h.faces = fn;
          return h.dir || h.box || h.body || h.faces ? h : undefined;
        });
        if (!hints && typeof f.body === 'string') hints = points.map(() => ({ body: f.body as string }));
        const refs = await opts.resolver(part(), points, hints).catch(() => null);
        if (!refs || !refs.every(Boolean)) throw new Unsupported('an edge was not found on the body built so far');
        if (f.type === 'fillet') features.push({ type: 'fillet', id: nid(), name: f.name, radius: field(f.radius, 'fillet radius'), edges: refs });
        else {
          if (f.distance2 !== undefined || f.angle !== undefined) throw new Unsupported('a chamfer with two distances or an angle');
          features.push({ type: 'chamfer', id: nid(), name: f.name, chamferType: 'equal', distance: field(f.distance, 'chamfer distance'), edges: refs });
        }
        named.set(f.name, [features[features.length - 1].id as string]);
        return [];
      }
      case 'shell': case 'offset_face': {
        if (!opts.faceResolver) throw new Unsupported('needs the kernel to find its faces');
        const points = (f.faces as V3[] | undefined)?.map(toYUp);
        if (!points?.length) throw new Unsupported('no face positions in the file');
        // `F2:top` and `F2:start` name the end and start cap of extrude 2: found by name when the stored point is off the body
        let hints = (f.face_names as string[] | undefined)?.map((n): FaceHint | undefined => {
          const m = /^F(\d+):(top|start)$/.exec(n ?? '');
          const mine = m ? ourExtrude.get(Number(m[1])) : undefined;
          const body = typeof f.body === 'string' ? f.body : undefined;
          return m && mine ? { ...(body ? { body } : {}), cap: { feature: mine, end: m[2] === 'top' ? 'end' : 'start' } } : body ? { body } : undefined;
        });
        if (!hints && typeof f.body === 'string') hints = points.map(() => ({ body: f.body as string }));
        const names = await opts.faceResolver(part(), points, hints).catch(() => null);
        if (!names || !names.every(Boolean)) throw new Unsupported('a face was not found, or not found uniquely, on the body built so far');
        if (f.type === 'shell') {
          if (f.direction !== undefined && f.direction !== 'inside' && f.direction !== 'outside') throw new Unsupported(`shell direction "${f.direction}"`);
          const sh: FeatureJson = { type: 'shell', id: nid(), name: f.name, faces: names, thickness: field(f.thickness, 'shell thickness') };
          if (f.direction === 'outside') sh.outward = true;
          features.push(sh);
        } else features.push({ type: 'moveFace', id: nid(), name: f.name, faces: names, mode: 'offset', distance: num(f.distance, 'offset distance') });
        named.set(f.name, [features[features.length - 1].id as string]);
        return [];
      }
      case 'move': {
        const srcs = Array.isArray(f.bodies) ? (f.bodies as string[]) : [];
        if (!srcs.length) throw new Unsupported('a move of no body');
        for (const b of srcs) if (!live.includes(b)) throw new Unsupported(`"${f.name}" moves the body "${b}", which does not exist at this point`);
        const t = ((f.translate as unknown[] | undefined) ?? [0, 0, 0]).map((x) => num(x, 'move distance'));
        if (t.length !== 3) throw new Unsupported('a move that is not given as three distances');
        const m: FeatureJson = { type: 'moveBody', id: nid(), name: f.name, bodies: srcs.map((b) => ({ body: b })) };
        if (f.angle !== undefined && Number(num(f.angle, 'move angle')) !== 0) {
          const ax = f.rotate_axis as V3 | undefined;
          if (!ax || Math.hypot(ax[0], ax[1], ax[2]) < 1e-9) throw new Unsupported('a rotation without an axis');
          m.rotate = { axis: toYUp(ax).map(clean), origin: [0, 0, 0], angle: num(f.angle, 'move angle') };
        }
        const tv = toYUp([t[0], t[1], t[2]]).map(clean);
        if (tv.some((x) => x !== 0)) m.translate = tv;
        if (f.copy === true) {
          if (srcs.length !== 1) throw new Unsupported('a copy of several bodies at once');
          const nm = String(f.body_names?.[0] ?? autoName());
          if (live.includes(nm)) throw new Unsupported(`the body name "${nm}" is used twice`);
          bodyCount++; live.push(nm); m.copy = true; m.body = nm;
        }
        features.push(m);
        return [];
      }
      case 'scale': {
        // a scale of whole bodies about a point: one factor, or one per axis (`factors` wins; the lone `factor` is dead
        // when it is there); their Z-up axes become ours (their y is our z, their z our y)
        const srcs = Array.isArray(f.bodies) ? (f.bodies as string[]) : [];
        if (!srcs.length) throw new Unsupported('a scale of no body');
        for (const b of srcs) if (!live.includes(b)) throw new Unsupported(`"${f.name}" scales the body "${b}", which does not exist at this point`);
        const fs = Array.isArray(f.factors) && f.factors.length === 3 ? (f.factors as unknown[]).map((x) => num(x, 'scale factor')) : [num(f.factor ?? 1, 'scale factor')];
        if (fs.some((x) => !(x > 0))) throw new Unsupported('a scale factor that is not above zero');
        const about = toYUp((((f.origin as unknown[] | undefined) ?? [0, 0, 0]).map((x) => num(x, 'scale origin'))) as V3).map(clean);
        const m: FeatureJson = { type: 'scale', id: nid(), name: f.name, bodies: srcs.map((b) => ({ body: b })), factor: fs.length === 3 ? [fs[0], fs[2], fs[1]].map(clean) : fs[0], at: about };
        if (fs.length === 1 ? fs[0] !== 1 : fs.some((x) => x !== 1)) features.push(m);
        return [];
      }
      case 'combine': {
        const target = f.target as string | undefined, tools = Array.isArray(f.tools) ? (f.tools as string[]) : [];
        for (const b of [target, ...tools]) if (!b || !live.includes(b)) throw new Unsupported(`"${f.name}" combines the body "${b}", which does not exist at this point`);
        const cop = ({ cut: 'cut', join: 'union', union: 'union', intersect: 'intersect' } as Record<string, string>)[String(f.operation)];
        if (!cop) throw new Unsupported(`a combine with operation "${f.operation}"`);
        features.push({ type: 'combine', id: nid(), name: f.name, op: cop, target: { body: target }, tools: tools.map((b) => ({ body: b })), keepTools: f.keep_tools === true });
        if (f.keep_tools !== true) live = live.filter((b) => !tools.includes(b));
        return [];
      }
      case 'remove': {
        const gone = Array.isArray(f.bodies) ? (f.bodies as string[]) : [];
        if (!gone.length) throw new Unsupported('a remove of no body');
        for (const b of gone) if (!live.includes(b)) throw new Unsupported(`"${f.name}" removes the body "${b}", which does not exist at this point`);
        features.push({ type: 'deleteBody', id: nid(), name: f.name, mode: 'delete', bodies: gone.map((b) => ({ body: b })) });
        live = live.filter((b) => !gone.includes(b));
        return [];
      }
      case 'construction_plane': {
        // sketches carry their own plane, so the plane needs no feature of its own; it is remembered for what refers to it by name
        constructionPlanes.set(String(f.name), frameOf(f.plane));
        return [];
      }
      case 'coil': {
        if (f.sketch !== undefined) throw new Unsupported('a coil swept from a sketch profile: the file does not state the radius of its helix');
        // a helix of the coil's size on a plane across its axis, and the wire's section on a plane through the axis at the helix start, swept along it
        const sect = f.section === undefined ? 'circular' : String(f.section).toLowerCase();
        if (sect !== 'circular' && sect !== 'circle' && sect !== 'square') throw new Unsupported(`a coil with a "${f.section}" section`);
        const ax = f.axis as V3 | undefined;
        if (!ax || !f.base) throw new Unsupported('a coil without an axis or a base point');
        const a = unit(toYUp(ax)), o = toYUp(f.base as V3);
        const diameter = num(f.diameter, 'coil diameter'), size = num(f.section_size, 'coil section size'), turns = num(f.turns ?? f.revolutions, 'coil turns');
        const pitch = f.pitch !== undefined ? num(f.pitch, 'coil pitch') : num(f.height, 'coil height') / turns;
        if (!(diameter > 0 && size > 0 && turns > 0 && pitch > 0)) throw new Unsupported('a coil with no size');
        const where = f.section_position === 'outside' ? 1 : f.section_position === 'inside' ? -1 : 0;
        const rc = diameter / 2 + (where * size) / 2;   // the wire's centre line: the diameter is the centre line's when centred, the wire's inner or outer edge otherwise
        if (!(rc > size / 2)) throw new Unsupported('a coil whose wire reaches the axis');
        // the coil starts where their world X axis, projected square to the coil's axis, points (an axis along X: their axis x Y, which is their Z), and a start angle turns right-handed from there
        const xAxis: V3 = [1, 0, 0], kx = dot3(a, xAxis);
        const x0 = Math.hypot(...cross3(a, xAxis)) > 1e-6 ? unit([xAxis[0] - a[0] * kx, xAxis[1] - a[1] * kx, xAxis[2] - a[2] * kx]) : unit(cross3(a, toYUp([0, 1, 0]))), y0 = cross3(a, x0);
        const op = operation(f);
        const across = nid(), through = nid(), helixSketch = nid(), helix = nid(), wire = nid();
        features.push({ type: 'plane', id: across, mode: 'frame', origin: o.map(clean), xDir: x0.map(clean), yDir: y0.map(clean) });
        features.push({ type: 'plane', id: through, mode: 'frame', origin: o.map(clean), xDir: x0.map(clean), yDir: a.map(clean) });
        features.push({ type: 'sketch', id: helixSketch, name: `${f.name} helix`, plane: { kind: 'feature', id: across }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: 0, y: 0 }], entities: [{ id: 'e1', type: 'circle', c: 'p1', r: clean(rc) }], constraints: [] });
        const start = f.start_angle === undefined ? 0 : num(f.start_angle, 'coil start angle');
        features.push({ type: 'helix', id: helix, name: `${f.name} path`, sketch: helixSketch, definedBy: 'pitchRevs', pitch: clean(pitch), revolutions: clean(turns), startAngle: clean(start), ...(f.clockwise === true ? { leftHand: true } : {}) });
        const h = size / 2;
        const section = sect === 'square'
          ? { points: [{ id: 'O', x: 0, y: 0, fixed: true }, ...[[-h, -h], [h, -h], [h, h], [-h, h]].map(([dx, dy], k) => ({ id: `p${k + 1}`, x: clean(rc + dx), y: clean(dy) }))], entities: [1, 2, 3, 4].map((k) => ({ id: `e${k}`, type: 'line', p1: `p${k}`, p2: `p${k % 4 + 1}` })) }
          : { points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: clean(rc), y: 0 }], entities: [{ id: 'e1', type: 'circle', c: 'p1', r: clean(h) }] };
        features.push({ type: 'sketch', id: wire, name: `${f.name} section`, plane: { kind: 'feature', id: through }, ...section, constraints: [] });
        features.push({ type: 'sweep', id: nid(), op, sketch: wire, path: { kind: 'curve', id: helix }, name: f.name, ...(op === 'newBody' ? { body: newName } : {}) });
        newName = undefined;
        named.set(f.name, [features[features.length - 1].id as string]);
        return [];
      }
      case 'sweep': {
        const s = sketches.get(f.sketch);
        if (!s) throw new Unsupported(failedSketches.has(f.sketch) ? `depends on sketch ${f.sketch}, which was not imported` : 'its profile sketch is not in the file');
        if (f.profiles?.type !== 'all') throw new Unsupported(`sweep profile selection "${f.profiles?.type}"`);
        if (f.orientation !== undefined) throw new Unsupported('a sweep whose profile keeps a fixed or given orientation along the path');
        if (f.scale !== undefined && num(f.scale, 'sweep scale') !== 1) throw new Unsupported('a sweep that scales its profile along the path');
        if (Array.isArray(f.rails) && f.rails.length) throw new Unsupported('a sweep guided by a rail');
        const spline = splinePaths.get(f.path_sketch);
        const curveIds = Array.isArray(f.path) ? (f.path as unknown[]).map(String) : [];
        if (!spline && !failedSketches.has(f.path_sketch) && !sketches.has(f.path_sketch)) throw new Unsupported('its path sketch is not in the file');
        if (spline && curveIds.length > 1) throw new Unsupported('a path of several curves');
        if (!spline && !curveIds.length) throw new Unsupported('a sweep without a path');
        const pathId = spline ?? curveSketch(f.path_sketch, curveIds, `${f.name} path`);
        const twist = f.twist !== undefined ? num(f.twist, 'sweep twist') : 0;
        const op = operation(f);
        features.push({ type: 'sweep', id: nid(), op, sketch: s.id, path: { kind: 'sketch', id: pathId }, name: f.name, ...(twist !== 0 ? { twist: field(f.twist, 'sweep twist') } : {}), ...(op === 'newBody' ? { body: newName } : {}) });
        newName = undefined;
        named.set(f.name, [features[features.length - 1].id as string]);
        return [];
      }
      case 'revolve': {
        const s = sketches.get(f.sketch);
        if (!s) throw new Unsupported(failedSketches.has(f.sketch) ? `depends on sketch ${f.sketch}, which was not imported` : 'its sketch is not in the file');
        const regions = wholeRegions(f, s, 'revolve');
        const ax = f.axis as Rec | undefined;
        if (ax?.type !== 'sketch_axis' && ax?.type !== 'sketch_line' && ax?.type !== 'line') throw new Unsupported(`a revolve about "${ax?.type ?? 'an unknown axis'}"`);
        if (ax.type === 'sketch_axis' && ax.axis !== 'x' && ax.axis !== 'y') throw new Unsupported(`a revolve about "${ax.type}"`);
        const pl = s.placed;
        // the axis as a line of the profile's sketch: one of its own lines, or a construction line through the given place
        let axisId: string | undefined;
        let axisLine: { o: P2; d: P2 } | undefined;
        if (ax.type === 'sketch_line') {
          const g = s.geo.get(String(ax.curve));
          axisId = s.entityOf.get(String(ax.curve));
          if (!axisId || g?.type !== 'line') throw new Unsupported('a revolve about a curve of its sketch that is not a straight line');
        } else if (ax.type === 'line') {
          const o = toYUp(ax.origin as V3), d = unit(toYUp(ax.dir as V3));
          const nrm = pl.frame ? pl.frame.z : (OUR_PLANE as Record<string, { z: V3 }>)[pl.std].z;
          if (Math.abs(heightAbove(pl, o)) > 1e-6 || Math.abs(dot3(d, nrm)) > 1e-6) throw new Unsupported('a revolve about an axis that is not in the plane of its sketch');
          const fr = pl.frame ?? { o: [0, 0, 0] as V3, ...(OUR_PLANE as Record<string, { x: V3; y: V3 }>)[pl.std] };
          const rel = (p: V3): V3 => [p[0] - fr.o[0], p[1] - fr.o[1], p[2] - fr.o[2]];
          axisLine = { o: [clean(dot3(rel(o), fr.x)), clean(dot3(rel(o), fr.y))], d: [clean(dot3(d, fr.x)), clean(dot3(d, fr.y))] };
        } else {
          axisLine = { o: mapXY(pl, 0, 0), d: ax.axis === 'x' ? [pl.t[0], pl.t[2]] : [pl.t[1], pl.t[3]] };
        }
        const op = operation(f);
        const angle = num(f.angle, 'revolve angle');
        if (!axisId) {
          const k = s.json.entities.length + 1, { o, d } = axisLine!;
          s.json.points.push({ id: `ax${k}a`, x: o[0], y: o[1] }, { id: `ax${k}b`, x: clean(o[0] + d[0] * 10), y: clean(o[1] + d[1] * 10) });
          s.json.entities.push({ id: `ax${k}`, type: 'line', p1: `ax${k}a`, p2: `ax${k}b`, construction: true });
          axisId = `ax${k}`;
        }
        // a symmetric extent turns half the angle each way from the sketch plane (a full turn has no sides)
        const mid = f.symmetric === true && Math.abs(angle) < 360 - 1e-9;
        features.push({ type: 'revolve', id: nid(), op, sketch: s.id, axis: axisId, end: mid ? 'mid' : 'blind', angle: angle > 0 ? field(f.angle, 'revolve angle') : angle, name: f.name, ...(regions ? { regions } : {}), ...(op === 'newBody' ? { body: newName } : {}) });
        newName = undefined;
        named.set(f.name, [features[features.length - 1].id as string]);
        return [];
      }
      case 'loft': {
        const given = (f.sections as Rec[] | undefined) ?? [];
        const secs = given.map((q) => sketches.get(q.sketch)?.id);
        if (secs.length < 2 || secs.some((x) => !x)) throw new Unsupported('a loft section whose sketch was not imported');
        if (given.some((q) => q.profiles && q.profiles.type !== 'all')) throw new Unsupported('a loft section that uses only some of the regions of its sketch');
        // a section that is a point (the apex of a cone): the sketch holds only its origin, which the part wants as a point entity
        given.forEach((q, i) => {
          if (q.point === undefined) return;
          const sk = features.find((x) => x.type === 'sketch' && x.id === secs[i]);
          if (!sk || (sk.entities as FeatureJson[]).length) throw new Unsupported('a loft section that is a point of a sketch that holds curves');
          if (i !== 0 && i !== given.length - 1) throw new Unsupported('a loft with a point section in the middle');
          (sk.entities as FeatureJson[]).push({ id: 'pt1', type: 'point', p: 'O' });
        });
        const rails = Array.isArray(f.rails) ? (f.rails as Rec[]) : [];
        if (rails.length > 2) throw new Unsupported('a loft guided by more than two rails');
        const guides = rails.map((r) => ({ sketch: curveSketch(r.sketch, (r.curves as unknown[]).map(String), `${f.name} rail`), influence: 'next' }));
        const op = operation(f);
        features.push({ type: 'loft', id: nid(), op, sketches: secs, ...(guides.length ? { guides } : {}), name: f.name, ...(op === 'newBody' ? { body: newName } : {}) });
        newName = undefined;
        named.set(f.name, [features[features.length - 1].id as string]);
        return [];
      }
      case 'mirror': {
        const names = (f.features as string[] | undefined) ?? [];
        if (Array.isArray(f.bodies) && f.bodies.length) {
          // whole bodies: a mirrored copy of each, kept as a body of its own or united with the original
          if (names.length) throw new Unsupported('a mirror of bodies together with features');
          const plane = planeRef(placeFrame(frameOf(f.plane), true, toYUp));
          for (const b of f.bodies as string[]) {
            if (!live.includes(b)) throw new Unsupported(`"${f.name}" mirrors the body "${b}", which does not exist at this point`);
            let nm = `${b} (mirror)`;
            for (let k = 2; live.includes(nm); k++) nm = `${b} (mirror ${k})`;
            bodyCount++; live.push(nm);
            features.push({ type: 'moveBody', id: nid(), name: `${f.name} (${nm})`, bodies: [{ body: b }], copy: true, body: nm, mirror: plane });
            if (f.combine === true) {
              features.push({ type: 'combine', id: nid(), name: `${f.name} (${b})`, op: 'union', target: { body: b }, tools: [{ body: nm }], keepTools: false });
              live = live.filter((x) => x !== nm);
            }
          }
          return [];
        }
        const plain = names.filter((nm) => !targeted.has(nm));
        const seeds = plain.flatMap((nm) => named.get(nm) ?? (() => { throw new Unsupported(`mirror of "${nm}", which was not imported`); })());
        if (!seeds.length && plain.length === names.length) throw new Unsupported('a mirror with nothing to mirror');
        const plane = planeRef(placeFrame(frameOf(f.plane), true, toYUp));
        if (seeds.length) { features.push({ type: 'mirror', id: nid(), name: f.name, seeds, plane, body: false }); named.set(f.name, [features[features.length - 1].id as string]); }
        // a feature that worked on named bodies through a tool body: the tool body is mirrored (a copy about the plane), the original tool
        // removed, and the mirrored tool does the same operation on the same bodies
        for (const nm of names.filter((x) => targeted.has(x))) {
          const t = targeted.get(nm)!, mt = `${t.tool}m`;
          features.push({ type: 'moveBody', id: nid(), name: `${f.name} (${nm})`, bodies: [{ body: t.tool }], copy: true, body: mt, mirror: plane });
          features.push({ type: 'deleteBody', id: nid(), name: `${f.name} (${nm} tool)`, mode: 'delete', bodies: [{ body: t.tool }] });
          t.targets.forEach((tg, i) => features.push({ type: 'combine', id: nid(), name: `${f.name} (${nm}${t.targets.length > 1 ? `, ${tg}` : ''})`, op: t.op, target: { body: tg }, tools: [{ body: mt }], keepTools: i < t.targets.length - 1 }));
        }
        return [];
      }
      case 'pattern': {
        const pt = f.pattern as Rec | undefined;
        if (pt?.type === 'path') return pathPattern(f, pt);
        if (pt?.type === 'circular') return circularPattern(f, pt);
        if (pt?.type !== 'rectangular') throw new Unsupported(`a ${pt?.type ?? 'unknown'} pattern`);
        let cur = ((f.features as string[] | undefined) ?? []).flatMap((nm) => named.get(nm) ?? (() => { throw new Unsupported(`pattern of "${nm}", which was not imported`); })());
        if (!cur.length) throw new Unsupported('a pattern with nothing to repeat');
        const made: string[] = [];
        for (const [dir, count, spacing] of [[pt.dir1, pt.count1, pt.spacing1], [pt.dir2, pt.count2, pt.spacing2]] as Array<[V3 | undefined, unknown, unknown]>) {
          const c = count === undefined ? 1 : num(count, 'pattern count');
          if (!dir || c <= 1) continue;
          const a = axisOf(dir, 'a pattern direction', toYUp);
          const id = nid();
          features.push({ type: 'lpattern', id, name: f.name, seeds: cur, dir: { kind: 'axis', axis: a.axis }, count: c, spacing: field(spacing, 'pattern spacing'), reverse: a.neg });
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
          const pl = placeFrame(frame, false, toYUp);
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
      case 'sheet_contour': {
        // A contour flange: a sheet of constant thickness along the path of the sketch, bent at its corners, as wide as `distance`.
        // The file stores neither the thickness nor the bend radius (they are the app's settings); 2.5 mm and an inner bend radius of the same
        // reproduce the volume, area and box its own evaluator saved for the one sample. The sheet lies to the right of the path, the way it runs.
        const sk = sketches.get(f.sketch);
        if (!sk) throw new Unsupported(failedSketches.has(f.sketch) ? `depends on sketch ${f.sketch}, which was not imported` : `refers to sketch ${f.sketch}, which is not in the file`);
        const ids = Array.isArray(f.curves) ? (f.curves as unknown[]).map(String) : [];
        if (!ids.length) throw new Unsupported('a contour flange without curves');
        const lines = ids.map((c) => { const g = sk.geo.get(c); if (!g || g.type !== 'line') throw new Unsupported('a contour flange along something other than lines'); return g; });
        for (let i = 1; i < lines.length; i++) if (!near2(lines[i - 1].b, lines[i].a)) throw new Unsupported('a contour flange whose curves do not run end to end');
        const T = SHEET_THICKNESS, R = SHEET_BEND_RADIUS, W = num(f.distance, 'flange distance');
        const dirs = lines.map((g): P2 => { const l = Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]); return [(g.b[0] - g.a[0]) / l, (g.b[1] - g.a[1]) / l]; });
        // per corner: trim along both lines and the arc of the path (the path is the outer side of a bend that turns towards the sheet)
        const corner = lines.slice(1).map((g, i) => {
          const d1 = dirs[i], d2 = dirs[i + 1], cr = d1[0] * d2[1] - d1[1] * d2[0], th = Math.atan2(Math.abs(cr), d1[0] * d2[0] + d1[1] * d2[1]);
          if (th < 1e-6) return null;
          const rp = cr < 0 ? R + T : R, trim = rp * Math.tan(th / 2), v = g.a;
          const p1: P2 = [v[0] - d1[0] * trim, v[1] - d1[1] * trim], p2: P2 = [v[0] + d2[0] * trim, v[1] + d2[1] * trim];
          const nIn: P2 = cr > 0 ? [-d1[1], d1[0]] : [d1[1], -d1[0]];
          return { trim, p1, p2, c: [p1[0] + nIn[0] * rp, p1[1] + nIn[1] * rp] as P2, left: cr > 0 };
        });
        const pts: FeatureJson[] = [{ id: 'O', x: 0, y: 0, fixed: true }], ents: FeatureJson[] = [];
        const pt = (q: P2): string => { const [x, y] = mapXY(sk.placed, q[0], q[1]); const id = `p${pts.length}`; pts.push({ id, x, y }); return id; };
        let prev: string | undefined;
        lines.forEach((g, i) => {
          const before = i > 0 ? corner[i - 1] : null, after = i < corner.length ? corner[i] : null;
          const a: P2 = before ? before.p2 : g.a, b: P2 = after ? after.p1 : g.b;
          if ((b[0] - a[0]) * dirs[i][0] + (b[1] - a[1]) * dirs[i][1] < -1e-9) throw new Unsupported('a contour flange whose bends are larger than its flat parts');
          const ia = prev ?? pt(a), ib = pt(b);
          ents.push({ id: `e${ents.length + 1}`, type: 'line', p1: ia, p2: ib });
          prev = ib;
          if (after) {
            const ic = pt(after.c), ip = pt(after.p2);
            let [s1, s2] = after.left ? [ib, ip] : [ip, ib];   // counter-clockwise from start to end
            if (mirrored(sk.placed)) [s1, s2] = [s2, s1];
            ents.push({ id: `e${ents.length + 1}`, type: 'arc', c: ic, p1: s1, p2: s2 });
            prev = ip;
          }
        });
        const sid = nid();
        features.push({ type: 'sketch', id: sid, name: `${f.name} path`, plane: sk.plane, points: pts, entities: ents, constraints: [], visible: false });
        const ex = extrudeOf({ ...f, operation: bodies === 0 ? 'new_body' : 'join' }, sid, W, true, sk.placed.sign);
        ex.thin = { thickness: T, side: SHEET_SIDE, ends: 'flat', cornerStyle: 'mitre' };
        features.push(ex);
        named.set(f.name, [ex.id as string]);
        return [`thickness ${T} mm and inner bend radius ${R} mm are assumed: the file stores neither`];
      }
      case 'import': {
        // the original solid of a part converted from another CAD system: a STEP body kept in the archive. It becomes an importStep
        // feature holding the text, turned from their Z-up to our Y-up like every point of the file.
        const why = 'the file holds the original solid as imported geometry (a STEP body of a part converted from another CAD system) but its STEP data could not be read, so only the sketches and operations around it are carried';
        let text = await stepTextOf(f);
        if (!text.includes('ISO-10303-21')) throw new Unsupported(why + (f.step_blob && !opts.blob ? ' (the archive was not given to the importer)' : ''));
        if (opts.normalizeStep) {
          const n = await opts.normalizeStep(text);
          if (!n.ok) throw new Unsupported(`the file holds the original solid as imported geometry, but the kernel cannot read it (${n.reason}), so only the sketches and operations around it are carried`);
          text = n.step;
        }
        const key = await sha256Hex(text);
        let nm: string | undefined;
        if (namedBodies) {
          nm = String(f.body_names?.[0] ?? autoName());
          if (live.includes(nm)) throw new Unsupported(`the body name "${nm}" is used twice`);
          bodyCount++; live.push(nm);
        } else if (bodies > 0) throw new Unsupported(`"${f.name}" holds a separate body; this kit keeps one connected body per part`);
        bodies++;
        blobs[key] = text;
        const id = nid();
        features.push({ type: 'importStep', id, name: String(f.name ?? 'Imported body'), blob: key, ...(nm ? { body: nm } : {}) });
        if (yUp) return ['the solid is the STEP body stored in the file, in the axes of the file (Y up, as this kit\'s)'];
        features.push({ type: 'moveBody', id: nid(), name: `${f.name} (Y up)`, bodies: [nm ? { body: nm } : { feature: id }], rotate: { axis: 'x', origin: [0, 0, 0], angle: -90 } });
        return ['the solid is the STEP body stored in the file, turned to this kit\'s Y-up axes'];
      }
      default: throw new Unsupported(`feature type "${f.type}"`);
    }
  };

  /** The STEP text of an `import` feature: inline, or the blob of the archive it names. */
  const stepTextOf = async (f: Rec): Promise<string> => {
    let text = typeof f.step === 'string' && f.step.includes('ISO-10303-21') ? f.step : '';
    if (!text && typeof f.step_blob === 'string' && opts.blob) {
      let data: Uint8Array | null = null;
      try { data = await opts.blob(f.step_blob); } catch { data = null; }
      if (data) text = new TextDecoder().decode(data);
    }
    return text;
  };

  const all = doc.features as Rec[];
  for (const [fi, f] of all.entries()) {
    if (opts.onProgress && fi % 20 === 0) { opts.onProgress(fi, all.length); await new Promise((r) => setTimeout(r, 0)); }
    if (opts.signal?.aborted) return refuse(name, 'cancelled');
    const row = { id: f.id, name: String(f.name ?? f.type), type: String(f.type) };
    if (f.suppressed) { rows.push({ ...row, status: 'skipped', reason: typeof f.skipReason === 'string' ? f.skipReason : 'suppressed in the file' }); continue; }
    if (f.type === 'body_transfer') {
      // hands bodies from one component to another; the bodies are built where the file builds them, so with the identity transform nothing moves and only the grouping is lost
      const m = f.transform as number[][] | undefined, still = !m || m.every((r, i) => r.every((x, j) => Math.abs(Number(x) - (i === j ? 1 : 0)) < 1e-9));
      rows.push(still ? { ...row, status: 'skipped', reason: 'the bodies stay where they were built; which component owns them is not kept' } : { ...row, status: 'unsupported', reason: 'a body transfer that also moves the bodies' });
      continue;
    }
    if (f.type === 'thread' && !f.modeled) { rows.push({ ...row, status: 'skipped', reason: 'a cosmetic thread is an annotation: it has no geometry to rebuild' }); continue; }
    const mark = features.length, bodiesBefore = bodies, nBefore = n, liveBefore = [...live], countBefore = bodyCount;
    newName = undefined; after = [];
    try {
      liveNotes = [];
      const notes = [...(await convert(f))];
      notes.push(...liveNotes);
      for (const make of after) features.push(make());
      after = [];
      if (f.type === 'extrude' || f.type === 'box' || f.type === 'cylinder') { const mine = named.get(f.name)?.[0]; if (mine) { ourExtrude.set(f.id, mine); if (f.sketch !== undefined) extrudeSketch.set(f.id, f.sketch); } }
      if (f.type === 'move') { const mv = features.slice(mark).find((x) => x.type === 'moveBody'); if (mv) ourMove.set(f.id, String(mv.id)); }
      produced.set(f.id, features.slice(mark));
      rows.push({ ...row, status: 'converted', ...(notes.length ? { notes } : {}) });
    } catch (e) {
      features.length = mark; bodies = bodiesBefore; n = nBefore; live = liveBefore; bodyCount = countBefore; newName = undefined; after = [];   // drop what the feature half-added
      if (f.type === 'sketch') failedSketches.add(f.id);
      // a feature we do not understand, or one whose data is not what we expect, is reported; a bad file never aborts the import
      const reason = e instanceof Unsupported || e instanceof ExprError ? e.message : `could not read this feature (${(e as Error).message})`;
      if (placeholders) features.push({ type: 'importedUnsupported', id: nid(), name: row.name, suppressed: true, reason, original: f });
      rows.push({ ...row, status: 'unsupported', reason });
    }
  }
  // the file keeps its original solid (suppressed, because its operations are meant to rebuild it) and also builds a body from sketches and
  // operations: when those do not give the original back, the original is the body and the operations that build bodies are skipped
  if (opts.volumeOf && opts.normalizeStep && !opts.signal?.aborted) {
    const original = all.find((x) => x.type === 'import' && x.suppressed);
    const builds = rows.some((r) => r.status === 'converted' && r.type !== 'sketch' && r.type !== 'construction_plane');
    const text = original && builds ? await stepTextOf(original) : '';
    const norm = text ? await opts.normalizeStep(text) : null;
    if (original && norm?.ok && norm.volume > 0) {
      let built: { volume: number | null; errors: number } | null = null;
      try { built = await opts.volumeOf(part()); } catch { built = null; }
      const off = !built || built.errors > 0 || !built.volume || Math.abs(built.volume - norm.volume) > HISTORY_VOLUME_TOLERANCE * norm.volume;
      if (off) {
        const num = (v: number | null | undefined) => (v ? String(Math.round(v * 100) / 100) : 'none');
        const why = `the operations of the file do not rebuild its original solid (volume ${num(built?.volume)} mm3 against ${num(norm.volume)} mm3${built && built.errors ? `, ${built.errors} error(s)` : ''}): the stored solid is the body`;
        const patched = { ...doc, features: all.map((x) => (x === original ? { ...x, suppressed: false } : x.type === 'sketch' || x.type === 'construction_plane' ? x : { ...x, suppressed: true, skipReason: why })) };
        return importOne(patched, name, { ...opts, volumeOf: undefined });
      }
    }
  }
  const count = (s: ScRow['status']) => rows.filter((r) => r.status === s).length;
  const unsupported = count('unsupported');
  // their sketches and datum planes are consumed by the features that use them and are not drawn; ours stay out of the way the same way (shown again from the tree)
  // a moved body leaves its sketches behind: copies of them at its pose (shown when few), and the originals, which no body is at any more, hidden
  const stranded = strandedSketches(features);
  features.push(...followSketches(features, nid));
  for (const f of features) if (f.type === 'sketch' && stranded.has(f.id as string)) f.visible = false;
  for (const f of features) if ((f.type === 'sketch' || f.type === 'plane') && f.visible === undefined) f.visible = false;
  // the timeline folders of the file: the features a folder lists carry its name as their cosmetic group
  for (const g of Array.isArray(doc.timeline_groups) ? (doc.timeline_groups as Rec[]) : []) {
    const folder = typeof g?.name === 'string' ? g.name.trim() : '';
    if (!folder || !Array.isArray(g.features)) continue;
    for (const id of g.features as unknown[]) for (const made of produced.get(id) ?? []) if (made.group === undefined) made.group = folder;
  }
  return {
    name, part: { ...part(), ...bodyLooks(doc, features, live) }, rows,
    summary: { converted: count('converted'), unsupported, skipped: count('skipped'), notes: rows.reduce((a, r) => a + (r.notes?.length ?? 0), 0) },
    geometryComplete: unsupported === 0,
  };
}
