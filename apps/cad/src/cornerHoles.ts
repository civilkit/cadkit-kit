// Corner holes: the pure rules for putting mounting holes on a plate in one step. The user types ONE number, the inset (distance
// from both edges to the hole centre, which is also the radius of an imagined corner fillet the hole sits concentric with), and
// gets holes at the four corners; more per side puts holes along the edges. Nothing here touches the DOM or the kernel:
//  - `placeCornerHoles` turns a rectangle (sketch coordinates) and the numbers into points, with structured issues;
//  - `faceOutline` reads the outline of the picked face (the body's edges flattened into the sketch plane) and reduces it to a
//    rectangle with optional equal corner fillets, or says why it cannot;
//  - `withCornerHoles` / `readCornerHoles` write and read the record on the sketch (custom field `cornerHoles`, like the gear's
//    `gear`), so that reopening the hole feature shows the control again.
import { classifyCurve, flatten, type PlaneFrame3 } from '@kit/sketch';

export interface Pt { x: number; y: number }
export interface Rect { minX: number; minY: number; maxX: number; maxY: number }

/** What the user chose: kept on the sketch. `matchFillet` makes the inset follow the corner fillet radius of the plate. */
export interface CornerRecord { inset: number; matchFillet: boolean; nx: number; ny: number }
export const DEFAULT_CORNER: CornerRecord = { inset: 10, matchFillet: false, nx: 2, ny: 2 };
/** The least wall left between a hole and the plate's edge (or the fillet) before a warning, in mm. */
export const MIN_WALL = 1;

export type IssueCode = 'inset' | 'insetTooLarge' | 'count' | 'wall' | 'size' | 'outline' | 'noFillet' | 'noFace';
export interface Issue {
  code: IssueCode;
  /** error: nothing can be placed; warn: placed, but check it */
  level: 'error' | 'warn';
  params: Record<string, string | number>;
  /** English text (the UI translates `cornerHoles.issue.<code>` with `params`). */
  message: string;
}
const MSG: Record<IssueCode, string> = {
  inset: 'The inset must be more than 0 mm',
  insetTooLarge: 'An inset of {inset} mm leaves no room on a plate {w} x {h} mm: use less than {max} mm',
  count: 'Holes per side must be a whole number of 2 or more',
  wall: 'A {dia} mm hole at {inset} mm leaves only {wall} mm of material at the edge: use an inset of at least {min} mm or a smaller hole',
  size: 'The plate outline has no size',
  outline: 'The face is not a rectangle with equal corners: using its bounding box',
  noFillet: 'The face has no rounded corners: type the inset',
  noFace: 'The face outline could not be read: using the plate size the holes were placed with',
};
export function issue(code: IssueCode, level: 'error' | 'warn', params: Record<string, string | number> = {}): Issue {
  return { code, level, params, message: MSG[code].replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? '')) };
}
const r2 = (v: number) => Math.round(v * 100) / 100;

/** `n` values from `a` to `b` inclusive, evenly spaced. */
function spread(a: number, b: number, n: number): number[] { return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1)); }

export interface PlaceOptions {
  inset: number; nx: number; ny: number;
  /** Corner fillet radius of the plate (0 / undefined: sharp corners). */
  radius?: number;
  /** Diameter of the hole, for the wall warning. */
  holeDiameter?: number | null;
}
export interface Placement { points: Pt[]; issues: Issue[] }

/**
 * The hole centres: the holes lie on the edge of a grid inset from the plate on all four sides, `nx` across the top and bottom
 * rows and `ny` along the left and right columns (the corners are shared), so 2 x 2 is the four corners, 3 x 2 adds a hole in the
 * middle of each long side. Points come row by row from the bottom left. An `error` issue means no points.
 */
export function placeCornerHoles(rect: Rect, o: PlaceOptions): Placement {
  const issues: Issue[] = [];
  const w = rect.maxX - rect.minX, h = rect.maxY - rect.minY;
  if (!(w > 1e-9) || !(h > 1e-9)) return { points: [], issues: [issue('size', 'error')] };
  if (!Number.isFinite(o.inset) || o.inset <= 0) return { points: [], issues: [issue('inset', 'error')] };
  if (!Number.isInteger(o.nx) || !Number.isInteger(o.ny) || o.nx < 2 || o.ny < 2) return { points: [], issues: [issue('count', 'error')] };
  if (2 * o.inset >= Math.min(w, h) - 1e-9) return { points: [], issues: [issue('insetTooLarge', 'error', { inset: r2(o.inset), w: r2(w), h: r2(h), max: r2(Math.min(w, h) / 2) })] };
  const dia = o.holeDiameter ?? null;
  if (dia !== null && dia > 0) {
    // distance from the hole centre to the plate's boundary at a corner: the straight edges, or the fillet arc when the hole sits inside the rounded part
    const r = o.radius ?? 0;
    const toBoundary = r > o.inset ? r - Math.SQRT2 * (r - o.inset) : o.inset;
    const wall = toBoundary - dia / 2;
    if (wall < MIN_WALL - 1e-9) issues.push(issue('wall', 'warn', { dia: r2(dia), inset: r2(o.inset), wall: r2(Math.max(0, wall)), min: r2(dia / 2 + MIN_WALL) }));
  }
  const xs = spread(rect.minX + o.inset, rect.maxX - o.inset, o.nx), ys = spread(rect.minY + o.inset, rect.maxY - o.inset, o.ny);
  const points: Pt[] = [];
  ys.forEach((y, j) => xs.forEach((x, i) => { if (i === 0 || j === 0 || i === o.nx - 1 || j === o.ny - 1) points.push({ x: round6(x) + 0, y: round6(y) + 0 }); }));
  return { points, issues };
}
const roundRect = (r: Rect): Rect => ({ minX: round6(r.minX), minY: round6(r.minY), maxX: round6(r.maxX), maxY: round6(r.maxY) });
const round6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;

/** The inset to use: the fillet radius when asked and the plate has one, else the typed inset. */
export function effectiveInset(rec: CornerRecord, radius: number | null | undefined): number {
  return rec.matchFillet && radius && radius > 0 ? radius : rec.inset;
}

// ---- the outline of the picked face ----

export interface Outline {
  rect: Rect;
  /** Equal corner fillet radius, null when the corners are sharp or the outline is not reducible. */
  radius: number | null;
  /** True when the outline is a rectangle (with or without equal corner fillets); false: the bounding box stands in. */
  rectangle: boolean;
  issues: Issue[];
}
export interface FaceEdge { faces?: string[]; pts?: number[][] }

/**
 * Reads the outline of face `face` from the body's edges: the edges that border it, flattened into the sketch plane. Straight edges
 * must run along x or y, curved ones must be quarter arcs of one radius whose corners the lines meet; full circles (holes already in
 * the face) are ignored. Anything else falls back to the bounding box of all non-circle edges with an `outline` warning. Null when
 * no edge belongs to the face.
 */
export function faceOutline(frame: PlaneFrame3, edges: FaceEdge[], face: string): Outline | null {
  const mine = edges.filter((e) => e.pts && e.pts.length >= 2 && (e.faces ?? []).includes(face));
  if (!mine.length) return null;
  const lines: Array<{ a: Pt; b: Pt }> = [];
  const arcs: Array<{ c: Pt; r: number; p1: Pt; p2: Pt }> = [];
  let other = 0;
  const all: Pt[] = [];
  for (const e of mine) {
    const flat = flatten(frame, e.pts!).pts;
    const c = classifyCurve(flat);
    if (!c) continue;
    if (c.kind === 'circle') continue;
    all.push(...flat);
    if (c.kind === 'line') lines.push({ a: c.a, b: c.b });
    else if (c.kind === 'arc') arcs.push(c);
    else other++;
  }
  if (!all.length) return null;
  const rect: Rect = {
    minX: Math.min(...all.map((p) => p.x)), maxX: Math.max(...all.map((p) => p.x)),
    minY: Math.min(...all.map((p) => p.y)), maxY: Math.max(...all.map((p) => p.y)),
  };
  const size = Math.max(rect.maxX - rect.minX, rect.maxY - rect.minY);
  const tol = Math.max(1e-6, size * 1e-5);
  const near = (a: number, b: number) => Math.abs(a - b) <= tol;
  const axis = (l: { a: Pt; b: Pt }) => near(l.a.x, l.b.x) || near(l.a.y, l.b.y);
  const fallback: Outline = { rect, radius: null, rectangle: false, issues: [issue('outline', 'warn')] };
  if (other || !lines.every(axis)) return fallback;
  if (!arcs.length) {
    // sharp rectangle: exactly four sides, each on the bounding box
    const onBox = lines.every((l) => (near(l.a.x, l.b.x) && (near(l.a.x, rect.minX) || near(l.a.x, rect.maxX))) || (near(l.a.y, l.b.y) && (near(l.a.y, rect.minY) || near(l.a.y, rect.maxY))));
    return lines.length === 4 && onBox ? { rect: roundRect(rect), radius: null, rectangle: true, issues: [] } : fallback;
  }
  if (arcs.length !== 4 || lines.length !== 4) return fallback;
  const r = arcs[0].r;
  if (!arcs.every((a) => near(a.r, r))) return fallback;
  // each arc is a quarter circle in one corner: its centre sits r inside both edges of the box, its ends touch them
  const corners = new Set<string>();
  for (const a of arcs) {
    const cx = near(a.c.x, rect.minX + r) ? 'L' : near(a.c.x, rect.maxX - r) ? 'R' : '';
    const cy = near(a.c.y, rect.minY + r) ? 'B' : near(a.c.y, rect.maxY - r) ? 'T' : '';
    if (!cx || !cy) return fallback;
    const quarter = Math.hypot(a.p1.x - a.p2.x, a.p1.y - a.p2.y);
    if (!near(quarter, r * Math.SQRT2)) return fallback;
    corners.add(cx + cy);
  }
  return corners.size === 4 ? { rect: roundRect(rect), radius: round6(r), rectangle: true, issues: [] } : fallback;
}

// ---- the record on the sketch ----

export interface CornerOnSketch extends CornerRecord {
  /** The plate rectangle and corner radius the points were placed against, kept so the control still works when the face cannot be read. */
  rect?: Rect;
  radius?: number | null;
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The corner-holes record of a sketch feature (defaults filled in), or null when it has none. */
export function readCornerHoles(f: unknown): CornerOnSketch | null {
  const rec = (f as { cornerHoles?: Record<string, unknown> } | null)?.cornerHoles;
  if (!rec || typeof rec !== 'object') return null;
  const rect = rec.rect as Rect | undefined;
  const validRect = rect && [rect.minX, rect.minY, rect.maxX, rect.maxY].every(finite);
  return {
    inset: finite(rec.inset) ? rec.inset : DEFAULT_CORNER.inset,
    matchFillet: rec.matchFillet === true,
    nx: finite(rec.nx) ? rec.nx : DEFAULT_CORNER.nx,
    ny: finite(rec.ny) ? rec.ny : DEFAULT_CORNER.ny,
    ...(validRect ? { rect } : {}),
    ...(finite(rec.radius) ? { radius: rec.radius } : {}),
  };
}

/** Ids of the points and entities this feature made: points `ch1`, `ch2`, ... and entities `che1`, ..., so a re-place replaces exactly them. */
const isMine = (id: string) => /^che?\d+$/.test(id);

/**
 * A sketch (feature or draft shaped: points, entities) with the corner-hole points replaced by `points`, and the record stored.
 * Points the user added by hand stay.
 */
export function withCornerHoles<S extends { points: Array<{ id: string; [k: string]: unknown }>; entities: Array<{ id: string; [k: string]: unknown }> }>(
  sketch: S, points: Pt[],
): S {
  const keepP = sketch.points.filter((p) => !isMine(p.id));
  const keepE = sketch.entities.filter((e) => !isMine(e.id));
  return {
    ...sketch,
    points: [...keepP, ...points.map((p, i) => ({ id: `ch${i + 1}`, x: p.x, y: p.y }))],
    entities: [...keepE, ...points.map((_, i) => ({ id: `che${i + 1}`, type: 'point', p: `ch${i + 1}` }))],
  };
}
