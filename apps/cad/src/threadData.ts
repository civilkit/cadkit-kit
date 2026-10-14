// Thread data and the pure rules of the Thread editor: the cylinder a face is (from the circular edges the view has),
// the sizes nearest to a diameter, the feature a new thread starts as, and the draft patches. No DOM here
// (threadData.test.ts; threadData.kernel.test.ts runs the real kernel). The tables live in the kernel (threadData
// request); the controller fetches and caches them, this file only reads the rows.
import type { EditOp } from '@ck/session';
import type { FeatureWarning } from '@kit/store';

type Wire = Record<string, unknown>;

/** One row of the kernel's `threadData` table (mm). */
export interface ThreadRow {
  size: string; standard: string; major: number; pitch: number; tpi?: number;
  minorInternal: number; minorExternal: number; pitchDiameter?: number; angle?: number;
  tapDrill: number; tapDrillName?: string; classInternal: string; classExternal: string; tapered?: boolean;
}
export interface ThreadStd { id: string; description: string; count: number; sizes?: string[] }

export const THREAD_STANDARDS = ['metric', 'metric-fine', 'UNC', 'UNF', 'BSP', 'NPT', 'Tr', 'Acme'] as const;
/** The standard the editor and the Add thread command start with. */
export const DEFAULT_STANDARD = 'metric';
export const THREAD_STARTS = ['open', 'top', 'bottom'] as const;
export type ThreadStart = (typeof THREAD_STARTS)[number];
export const THREAD_HANDS = ['right', 'left'] as const;

/** The edges the view has: persistent key, the faces the edge separates, the world-space polyline. */
export interface EdgeLike { key?: string; faces?: string[]; pts?: number[][] }
export interface Cylinder {
  radius: number;
  /** A point on the axis (the centre of the first circle found). */
  axisPoint: number[];
  /** Unit axis direction (its sign is arbitrary). */
  axisDir: number[];
  /** Known only when the face name says so (the wall of a hole feature); otherwise the kernel decides. */
  internal?: boolean;
}

const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: number[]) => Math.hypot(a[0], a[1], a[2]);

interface Circle { c: number[]; r: number; n: number[] }
/** Solve a 3x3 linear system (Cramer); null when singular. */
function solve3(m: number[][], b: number[]): number[] | null {
  const det = (a: number[][]) => a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const d = det(m);
  if (Math.abs(d) < 1e-12) return null;
  return [0, 1, 2].map((k) => det(m.map((row, i) => row.map((v, j) => (j === k ? b[i] : v)))) / d);
}
/**
 * Fit a circle to a closed polyline; null when it is not one (a line, an open arc, something not round or not flat).
 * The kernel's polylines are denser where the curve bends, so the centre is a least-squares fit, not the vertex average.
 */
function circleOf(pts: number[][]): Circle | null {
  if (pts.length < 8) return null;
  const first = pts[0], last = pts[pts.length - 1];
  const ring = pts.slice(0, len(sub(first, last)) < 1e-6 * Math.max(1, len(first)) + 1e-9 ? -1 : undefined);
  const m = ring.length;
  const c0 = [0, 0, 0];
  for (const p of ring) { c0[0] += p[0] / m; c0[1] += p[1] / m; c0[2] += p[2] / m; }
  // Newell normal of the polygon (sum of cross products around the centroid)
  const nn = [0, 0, 0];
  for (let i = 0; i < m; i++) { const x = cross(sub(ring[i], c0), sub(ring[(i + 1) % m], c0)); nn[0] += x[0]; nn[1] += x[1]; nn[2] += x[2]; }
  const nl = len(nn);
  if (nl < 1e-12) return null;
  const n = [nn[0] / nl, nn[1] / nl, nn[2] / nl];
  // an in-plane basis, the points in 2D, and the algebraic (Kasa) circle fit x^2 + y^2 + D x + E y + F = 0
  const seed = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u0 = cross(n, seed), ul = len(u0);
  const u = [u0[0] / ul, u0[1] / ul, u0[2] / ul];
  const v = cross(n, u);
  const q = ring.map((p) => { const d = sub(p, c0); return [dot(d, u), dot(d, v)]; });
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const B = [0, 0, 0];
  for (const [x, y] of q) {
    const row = [x, y, 1], z = -(x * x + y * y);
    for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) S[i][j] += row[i] * row[j]; B[i] += row[i] * z; }
  }
  const sol = solve3(S, B);
  if (!sol) return null;
  const cx = -sol[0] / 2, cy = -sol[1] / 2;
  const r2 = cx * cx + cy * cy - sol[2];
  if (!(r2 > 0)) return null;
  const r = Math.sqrt(r2);
  const c = [c0[0] + u[0] * cx + v[0] * cy, c0[1] + u[1] * cx + v[1] * cy, c0[2] + u[2] * cx + v[2] * cy];
  // roundness: the vertices lie on the circle; flatness: and in its plane
  if (ring.some((p) => Math.abs(len(sub(p, c)) - r) > 2e-3 * r)) return null;
  if (ring.some((p) => Math.abs(dot(sub(p, c0), n)) > 2e-3 * r)) return null;
  // an open arc is not a full circle: the vertices must go all the way round (no gap of 100 degrees or more, the closing one included)
  const ang = ring.map((p) => Math.atan2(dot(sub(p, c), v), dot(sub(p, c), u)));
  for (let i = 0; i < m; i++) {
    let d = Math.abs(ang[(i + 1) % m] - ang[i]);
    if (d > Math.PI) d = 2 * Math.PI - d;
    if (d > 1.75) return null;
  }
  return { c, r, n };
}

/**
 * The cylinder a face is, read from its circular edges: a cylinder wall has two circles of the same radius on the
 * same axis, apart along it. A lone circle counts only for the faces named like a cylinder (`.S.c1`, a hole wall
 * `.S.h1`); a flat face with a round hole also has one circle edge and is not a cylinder. Null otherwise.
 */
export function cylinderOfFace(faceName: string, edges: EdgeLike[]): Cylinder | null {
  const circles: Circle[] = [];
  for (const e of edges) {
    if (!e.pts || !e.faces?.includes(faceName)) continue;
    const c = circleOf(e.pts);
    if (c) circles.push(c);
  }
  if (!circles.length) return null;
  const a = circles[0];
  const sameAxis = (b: Circle) => Math.abs(Math.abs(dot(a.n, b.n)) - 1) < 1e-4 && Math.abs(a.r - b.r) < 1e-3 * a.r
    && len(cross(sub(b.c, a.c), a.n)) < 1e-3 * a.r + 1e-9;
  const coaxial = circles.filter(sameAxis);
  const stacked = coaxial.some((b) => Math.abs(dot(sub(b.c, a.c), a.n)) > 1e-6);
  const named = /\.S\.[ch]\d+(~\d+)?$/.test(faceName);
  if (!stacked && !named) return null;
  if (circles.length > coaxial.length && !named) return null;   // circles of different radius: a cone or a flat ring
  const hole = /\.S\.h\d+(~\d+)?$/.test(faceName);
  return { radius: a.r, axisPoint: a.c, axisDir: a.n, ...(hole ? { internal: true } : {}) };
}

/** Rows ordered by how close they are to a diameter; internal: tap drill, external: major, unknown: whichever is nearer. */
export function nearestSizes(rows: ThreadRow[], diameter: number, internal?: boolean): Array<ThreadRow & { delta: number }> {
  const d = (r: ThreadRow) => (internal === true ? Math.abs(r.tapDrill - diameter) : internal === false ? Math.abs(r.major - diameter) : Math.min(Math.abs(r.tapDrill - diameter), Math.abs(r.major - diameter)));
  return rows.map((r) => ({ ...r, delta: d(r) })).sort((a, b) => a.delta - b.delta || a.major - b.major);
}
/** How many of the nearest sizes the Size dropdown marks. */
export const NEAREST_MARKED = 3;

/** The default class for a size: the internal or the external one. */
export function defaultClass(row: ThreadRow | undefined, internal: boolean | undefined): string | undefined {
  if (!row) return undefined;
  return internal === false ? row.classExternal : row.classInternal;
}

/** The thread a new Add thread starts as: metric, the size nearest to the face diameter, full length, right hand, cosmetic. */
export function newThread(face: string, diameter: number, rows: ThreadRow[], internal?: boolean): Wire | null {
  const best = nearestSizes(rows, diameter, internal)[0];
  if (!best) return null;
  return { type: 'thread', face, standard: DEFAULT_STANDARD, size: best.size, class: defaultClass(best, internal), length: 'full', hand: 'right', modeled: false };
}
export function threadOps(face: string, diameter: number, rows: ThreadRow[], internal?: boolean): EditOp[] | null {
  const f = newThread(face, diameter, rows, internal);
  return f ? [{ op: 'add', feature: f as never }] : null;
}

/** Whether the face names a hole wall (`<id>.S.h1`): internal for sure. */
export const isHoleWall = (face: string): boolean => /\.S\.h\d+(~\d+)?$/.test(face);
/** The wall face of a hole feature (persistent name, crates/ck-model hole.rs: S.h0 top disc, S.h1 wall, S.h2 bottom). */
export const holeWallFace = (holeId: string): string => `${holeId}.S.h1`;
/** The thread size a tapped hole of this ISO size takes (a metric size), or null for a plain hole. */
export function holeThreadSize(hole: Wire): string | null {
  return hole.type === 'hole' && hole.fit === 'tap' && typeof hole.size === 'string' && /^M[\d.]+$/.test(hole.size) ? hole.size : null;
}
export function holeThreadOps(hole: Wire, rows?: ThreadRow[]): EditOp[] | null {
  const size = holeThreadSize(hole);
  if (!size || typeof hole.id !== 'string') return null;
  const row = rows?.find((r) => r.size === size);
  return [{ op: 'add', feature: { type: 'thread', face: holeWallFace(hole.id), standard: 'metric', size, ...(row ? { class: row.classInternal } : {}), length: 'full', hand: 'right', modeled: false } as never }];
}

// ---- draft patches (a null means "remove the field": the editor sends a replace) ----

/** Changing the standard picks the size of the new standard nearest to the old major diameter (or the face's). */
export function patchStandard(std: string, rows: ThreadRow[], diameter: number | null, internal: boolean | undefined): Wire {
  const best = diameter === null ? rows[0] : nearestSizes(rows, diameter, internal)[0];
  return { standard: std, ...(best ? { size: best.size, class: defaultClass(best, internal) ?? null } : {}) };
}
export function patchSize(row: ThreadRow | undefined, size: string, internal: boolean | undefined): Wire {
  return { size, ...(row ? { class: defaultClass(row, internal) ?? null } : {}) };
}
export function patchLength(raw: string): Wire | null {
  const s = raw.trim().toLowerCase();
  if (s === '' || s === 'full') return { length: 'full' };
  const v = Number(s);
  return Number.isFinite(v) && v > 0 ? { length: v } : null;
}

// ---- warnings ----

/** The size the kernel suggests in a threadDiameterMismatch warning (`params.nearest`: a name, `{size}` or a list of them). */
export function suggestedSize(params: unknown): string | null {
  const n = (params as { nearest?: unknown } | null)?.nearest;
  const one = Array.isArray(n) ? n[0] : n;
  if (typeof one === 'string') return one;
  if (one && typeof one === 'object' && typeof (one as { size?: unknown }).size === 'string') return (one as { size: string }).size;
  return null;
}

export type { FeatureWarning };

/** Warnings `[featureId, {code, params}]` from a regen result as the store keeps them: the first per feature, the rest in `all`. */
export function warningsById(list: unknown): Record<string, FeatureWarning> {
  const out: Record<string, FeatureWarning> = {};
  if (!Array.isArray(list)) return out;
  for (const item of list) {
    if (!Array.isArray(item) || typeof item[0] !== 'string') continue;
    const w = (item[1] ?? {}) as { code?: unknown; params?: Record<string, unknown> };
    const code = typeof w.code === 'string' ? w.code : 'warning';
    const hint = typeof w.params?.hint === 'string' ? w.params.hint : code;
    const one = { code, hint, ...(w.params ? { params: w.params } : {}) };
    const cur = out[item[0]];
    if (!cur) out[item[0]] = { ...one };
    else { cur.all = [...(cur.all ?? [{ code: cur.code, hint: cur.hint, params: cur.params }]), one]; cur.hint = cur.all.map((x) => x.hint).join('; '); }
  }
  return out;
}

/** Apply simple edit ops (add, set on a top-level field, replace, remove) to a copy of the features; null when an op is not one of these. */
export function applyOpsLocal(features: Wire[], ops: EditOp[]): Wire[] | null {
  const out = features.map((f) => ({ ...f }));
  for (const op of ops as Array<Record<string, unknown>>) {
    const i = out.findIndex((f) => f.id === op.id);
    if (op.op === 'add' && op.feature) out.push({ ...(op.feature as Wire), id: (op.feature as Wire).id ?? `F${out.length + 1}` });
    else if (op.op === 'set' && i >= 0 && typeof op.path === 'string' && !/[.[\]]/.test(op.path)) out[i][op.path] = op.value;
    else if (op.op === 'replace' && i >= 0) out[i] = { ...(op.feature as Wire), id: out[i].id };
    else if (op.op === 'remove' && i >= 0) out.splice(i, 1);
    else return null;
  }
  return out;
}
