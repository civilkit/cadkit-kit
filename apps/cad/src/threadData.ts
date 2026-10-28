// Thread data and the pure rules of the Thread editor: the cylinder a face is (from the circular edges the view has),
// the sizes nearest to a diameter, the feature a new thread starts as, and the draft patches. No DOM here
// (threadData.test.ts; threadData.kernel.test.ts runs the real kernel). The tables live in the kernel (threadData
// request); the controller fetches and caches them, this file only reads the rows.
import type { EditOp } from '@ck/session';
import type { FeatureWarning } from '@kit/store';
import { faceInfo, type MeshLike } from './handles/geom';

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
export function circleOf(pts: number[][]): Circle | null {
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
  return { type: 'thread', face, standard: DEFAULT_STANDARD, size: best.size, class: defaultClass(best, internal), length: 'full', hand: 'right', modeled: loadThreadPrefs().modeled === true };
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
  return [{ op: 'add', feature: { type: 'thread', face: holeWallFace(hole.id), standard: 'metric', size, ...(row ? { class: row.classInternal } : {}), length: 'full', hand: 'right', modeled: loadThreadPrefs().modeled === true } as never }];
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

/** Printed-thread clearance: `clearance` on the feature is signed millimetres, positive = Wider (a looser fit), negative = Narrower (tighter), absent = none. */
export const THREAD_CLEARANCES = ['none', 'wider', 'narrower'] as const;
export type ThreadClearance = (typeof THREAD_CLEARANCES)[number];
/** The value Wider / Narrower starts with (a common first try for a printer with a 0.4 mm nozzle), and the largest accepted. */
export const CLEARANCE_DEFAULT = 0.2;
export const CLEARANCE_MAX = 1;
/** The direction and size (mm, always positive) a feature's `clearance` stands for. */
export function clearanceOf(f: Wire): { dir: ThreadClearance; mm: number } {
  const v = typeof f.clearance === 'number' && Number.isFinite(f.clearance) ? f.clearance : 0;
  return v > 0 ? { dir: 'wider', mm: Math.min(v, CLEARANCE_MAX) } : v < 0 ? { dir: 'narrower', mm: Math.min(-v, CLEARANCE_MAX) } : { dir: 'none', mm: 0 };
}
/** The draft patch for a clearance choice; `mm` is held to 0.01 .. CLEARANCE_MAX, and none removes the field. */
export function patchClearance(dir: ThreadClearance, mm: number): Wire {
  if (dir === 'none') return { clearance: null };
  const v = Math.round(Math.min(CLEARANCE_MAX, Math.max(0.01, Number.isFinite(mm) ? mm : CLEARANCE_DEFAULT)) * 1000) / 1000;
  return { clearance: dir === 'wider' ? v : -v };
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

// ---- the Thread editor's pure rules: quick sizes, filter, readout, fit, length, ends of the face, remembered choices ----

/** The short list of sizes shown as chips above the Size field, per standard (names as in the kernel's tables). */
export const QUICK_SIZES: Record<string, string[]> = {
  metric: ['M3', 'M4', 'M5', 'M6', 'M8', 'M10', 'M12'],
  'metric-fine': ['M8x1', 'M10x1.25', 'M12x1.5', 'M16x1.5', 'M20x1.5'],
  UNC: ['#6-32', '#8-32', '#10-24', '1/4-20', '5/16-18', '3/8-16', '1/2-13'],
  UNF: ['#6-40', '#8-36', '#10-32', '1/4-28', '5/16-24', '3/8-24', '1/2-20'],
  BSP: ['G1/8', 'G1/4', 'G3/8', 'G1/2'],
  NPT: ['1/8 NPT', '1/4 NPT', '3/8 NPT', '1/2 NPT'],
  Tr: ['Tr10x2', 'Tr12x3', 'Tr16x4', 'Tr20x4'],
  Acme: ['Acme 1/4-16', 'Acme 3/8-12', 'Acme 1/2-10', 'Acme 5/8-8'],
};
/** Chips for a standard: the last used size first, then the short list; only sizes the table has (when it is loaded). */
export function quickSizes(standard: string, rows: ThreadRow[], last?: string | null): string[] {
  const base = QUICK_SIZES[standard] ?? rows.slice(0, 7).map((r) => r.size);
  const list = last && !base.includes(last) ? [last, ...base] : last ? [last, ...base.filter((s) => s !== last)] : base;
  return rows.length ? list.filter((s) => rows.some((r) => r.size === s)) : list;
}

/** The label of a size in the list: pitch next to it ('M10 × 1.5 coarse', 'M10 × 1.25 fine', 'UNC 1/4-20 · 1.27 mm'). */
export function sizeLabel(row: ThreadRow): string {
  const p = String(Math.round(row.pitch * 1000) / 1000);
  if (row.standard === 'metric') return `${row.size} × ${p} coarse`;
  if (row.standard === 'metric-fine') return `${row.size.replace('x', ' × ')} fine`;
  return `${row.size} · ${p} mm`;
}
const norm = (s: string): string => s.toLowerCase().replace(/\s/g, '').replace(/×/g, 'x');
/**
 * The sizes matching what was typed ('m10', '10', '10x1.25', '1/4', '20', 'g1/2'), best first: names that start with the
 * query, then names that contain it, then diameters that start with it ('1' also finds M10 and M12). Inside each group the
 * sizes nearest to the face diameter come first (table order when the diameter is unknown). Empty query: all, nearest first.
 */
export function filterSizes(rows: ThreadRow[], query: string, diameter: number | null, internal?: boolean): ThreadRow[] {
  const q = norm(query.trim());
  const order = diameter === null ? rows : nearestSizes(rows, diameter, internal);
  if (!q) return order;
  const rank = (r: ThreadRow): number => {
    const n = norm(r.size);
    if (n.startsWith(q)) return 0;
    if (n.includes(q)) return 1;
    const digits = q.replace(/^[a-z#]+/, '');
    return digits && norm(String(r.major)).startsWith(digits) ? 2 : 3;
  };
  const withRank = order.map((r, i) => ({ r, k: rank(r), i }));
  return withRank.filter((x) => x.k < 3).sort((a, b) => a.k - b.k || a.i - b.i).map((x) => x.r);
}

export interface ReadoutRow { key: 'major' | 'root' | 'tapDrill' | 'minor' | 'pitch'; value: string }
const f3 = (v: number): string => String(Math.round(v * 1000) / 1000);
/** The numbers worth showing for a thread: a shaft needs the major diameter and the root (d3), a hole the tap drill and the minor (D1). */
export function readoutRows(row: ThreadRow, internal: boolean | undefined): ReadoutRow[] {
  const pitch: ReadoutRow = { key: 'pitch', value: `${f3(row.pitch)} mm` };
  const tap: ReadoutRow = { key: 'tapDrill', value: `${f3(row.tapDrill)} mm${row.tapDrillName ? ` (${row.tapDrillName})` : ''}` };
  if (internal === false) return [{ key: 'major', value: `${f3(row.major)} mm` }, { key: 'root', value: `${f3(row.minorExternal)} mm` }, pitch];
  if (internal === true) return [tap, { key: 'minor', value: `${f3(row.minorInternal)} mm` }, pitch];
  return [{ key: 'major', value: `${f3(row.major)} mm` }, { key: 'minor', value: `${f3(row.minorInternal)} mm` }, tap, pitch];
}

/** The classes of the standard to pick from (the table's internal and external defaults), the current one kept even when unknown. */
export function classOptions(row: ThreadRow | undefined, current?: string, internal?: boolean): string[] {
  const list = row ? (internal === false ? [row.classExternal, row.classInternal] : [row.classInternal, row.classExternal]) : [];
  if (current && !list.includes(current)) list.push(current);
  return [...new Set(list.filter(Boolean))];
}

export type Fit =
  | { ok: true; kind: 'shaft' | 'hole'; face: number; size: string; against: number }
  | { ok: false; hint: string; suggest: string | null };
/** Fit of the face to the size: the kernel's warning wins (amber, with its hint and the size it suggests); else green when the diameter is known. */
export function fitStatus(face: number | null, internal: boolean | undefined, row: ThreadRow | undefined, warning: FeatureWarning | null | undefined): Fit | null {
  const w = warning ? (warning.all ?? [warning]).find((x) => x.code === 'threadDiameterMismatch') : undefined;
  if (w) return { ok: false, hint: w.hint, suggest: suggestedSize(w.params) };
  if (face === null || !row || internal === undefined) return null;
  return { ok: true, kind: internal ? 'hole' : 'shaft', face, size: row.size, against: internal ? row.tapDrill : row.major };
}

/** A length typed or dragged, held between the shortest useful thread (one pitch) and the face (when known). */
export function clampLength(v: number, max: number | null, pitch = 0.1): number {
  const lo = Math.max(pitch, 0.1);
  const hi = max !== null && max > lo ? max : Infinity;
  return Math.min(hi, Math.max(lo, v));
}
/** The Full / Custom control's starting custom length: 8 pitches, held to the face. */
export function customLengthDefault(pitch: number | undefined, max: number | null): number {
  return clampLength(Math.round((pitch ?? 1) * 8 * 10) / 10, max, pitch ?? 0.1);
}

/** The view's description of a cylinder face wall: its length along the axis and which ends are open (the kernel's rule, thread.rs). */
export interface FaceExtent { length: number | null; open: [boolean, boolean] | null }
export function faceExtent(faceName: string, edges: EdgeLike[], mesh: MeshLike | null): FaceExtent | null {
  const rings: Array<{ c: number[]; other: string[] }> = [];
  let axis: number[] | null = null;
  for (const e of edges) {
    if (!e.pts || !e.faces?.includes(faceName)) continue;
    const c = circleOf(e.pts);
    if (!c) continue;
    if (!axis) axis = c.n;
    if (Math.abs(Math.abs(dot(axis, c.n)) - 1) > 1e-4) continue;
    rings.push({ c: c.c, other: e.faces.filter((x) => x !== faceName) });
  }
  if (!rings.length || !axis) return null;
  // the kernel orients the axis so its dominant world component is positive
  const k = [0, 1, 2].reduce((m, i) => (Math.abs(axis![i]) > Math.abs(axis![m]) ? i : m), 0);
  const up = axis[k] < 0 ? axis.map((x) => -x) : axis;
  const s = rings.map((r) => dot(r.c, up));
  const lo = Math.min(...s), hi = Math.max(...s);
  const length = hi - lo > 1e-6 ? hi - lo : null;
  if (!mesh || length === null) return { length, open: null };
  const open: [boolean, boolean] = [true, true];
  rings.forEach((r, i) => {
    const end = Math.abs(s[i] - lo) < 1e-6 * Math.max(1, hi - lo) ? 0 : 1;
    for (const g of r.other) {
      const info = faceInfo(mesh, g);
      if (!info?.planar) continue;
      const np = dot(info.normal, up);
      if ((end === 0 && np > 0.5) || (end === 1 && np < -0.5)) open[end] = false;
    }
  });
  return { length, open };
}
/** The Start choice matters only when both ends are open or neither (the kernel then takes `top`); with one open end it is that end. Unknown: matters. */
export const startMatters = (x: FaceExtent | null): boolean => !x?.open || x.open[0] === x.open[1];

// ---- remembered choices (localStorage; every access guarded: private windows, tests, workers) ----

export interface ThreadPrefs { modeled?: boolean; lastSize?: Record<string, string>; modeledMs?: number }
const PREFS_KEY = 'ck.thread.prefs';
export function loadThreadPrefs(): ThreadPrefs {
  try { const raw = globalThis.localStorage?.getItem(PREFS_KEY); const v = raw ? JSON.parse(raw) : null; return v && typeof v === 'object' ? v as ThreadPrefs : {}; } catch { return {}; }
}
export function saveThreadPrefs(patch: Partial<ThreadPrefs>): void {
  try { globalThis.localStorage?.setItem(PREFS_KEY, JSON.stringify({ ...loadThreadPrefs(), ...patch })); } catch { /* storage unavailable: the choice is just not remembered */ }
}
export const rememberSize = (standard: string, size: string): void => saveThreadPrefs({ lastSize: { ...(loadThreadPrefs().lastSize ?? {}), [standard]: size } });
/** The kernel's reason a modeled thread was not built (the committed entry says modeled:false although it was asked for), or null. */
export function modelFallbackReason(requested: boolean, entryModeled: boolean | undefined, warning: FeatureWarning | null | undefined): string | null {
  if (!requested || entryModeled !== false) return null;
  const w = warning ? (warning.all ?? [warning]).find((x) => x.code === 'threadModelFallback') : undefined;
  return w ? w.hint : null;
}

// ---- several faces at once (Shift+T on a selection, "Select same size", the group chip and the per-face fit line) ----

/** A selected face with the cylinder read from its edges; faces that are not cylinders are left out of `cylinders`. */
export interface FaceCylinder { face: string; cyl: Cylinder }
/** The cylinders among faces, in order; null when any face is not one (a thread goes on cylinder walls only). */
export function cylindersOfFaces(faces: string[], edges: EdgeLike[]): FaceCylinder[] | null {
  if (!faces.length) return null;
  const out: FaceCylinder[] = [];
  for (const face of faces) {
    const cyl = cylinderOfFace(face, edges);
    if (!cyl) return null;
    out.push({ face, cyl });
  }
  return out;
}
const faceNamesIn = (edges: EdgeLike[]): string[] => [...new Set(edges.flatMap((e) => e.faces ?? []))];
/**
 * Every cylinder face of the body with the same radius (to 0.001 mm) and the same kind (hole wall or not) as `face`, the face
 * itself first. The "Select same size" action: all the holes of one diameter, or all the shafts of one diameter.
 */
export function sameSizeFaces(face: string, edges: EdgeLike[]): string[] {
  const ref = cylinderOfFace(face, edges);
  if (!ref) return [];
  const out = [face];
  for (const n of faceNamesIn(edges)) {
    if (n === face || n.includes('|')) continue;
    const c = cylinderOfFace(n, edges);
    if (c && Math.abs(c.radius - ref.radius) < 1e-3 && (c.internal === true) === (ref.internal === true)) out.push(n);
  }
  return out;
}
/** The wall faces of a hole feature (one per position: `F4.S.h1`, or `F4.S.h1~0`, `F4.S.h1~1` ... with several), from the faces the view has. */
export function holeWallFaces(holeId: string, edges: EdgeLike[]): string[] {
  const re = new RegExp(`^${holeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.S\\.h1(~\\d+)?$`);
  const found = faceNamesIn(edges).filter((n) => re.test(n));
  return found.sort((a, b) => Number(a.split('~')[1] ?? -1) - Number(b.split('~')[1] ?? -1));
}
/** Whether a face name is a wall of this hole (any of its positions). */
export const isWallOfHole = (face: unknown, holeId: string): boolean => typeof face === 'string' && face.startsWith(`${holeId}.S.h1`) && /^(~\d+)?$/.test(face.slice(holeId.length + 5));

/** The chip text for several faces: '4 holes, Ø 5 mm', '3 shafts, Ø 10 mm', '2 faces, Ø 4 - 6 mm'. */
export function groupChip(cyls: FaceCylinder[], internal?: boolean[]): { key: string; n: number; d: string } {
  const ds = cyls.map((c) => c.cyl.radius * 2);
  const lo = Math.min(...ds), hi = Math.max(...ds);
  const kinds = new Set(internal ?? cyls.map((c) => c.cyl.internal));
  const key = kinds.size === 1 && kinds.has(true) ? 'holes' : kinds.size === 1 && kinds.has(false) ? 'shafts' : 'faces';
  const r = (v: number) => String(Math.round(v * 1000) / 1000);
  return { key, n: cyls.length, d: hi - lo < 1e-3 ? r(lo) : `${r(lo)} - ${r(hi)}` };
}

/** The faces that do not fit the size: the kernel's threadDiameterMismatch warning per feature id wins. */
export function groupMisfits(items: Array<{ face: string; id?: string }>, warnings: Record<string, FeatureWarning | undefined>): string[] {
  return items.filter((x) => x.id && ((warnings[x.id]?.all ?? (warnings[x.id] ? [warnings[x.id]!] : [])).some((w) => w.code === 'threadDiameterMismatch'))).map((x) => x.face);
}

/** The settings of a thread feature that a group shares (everything but its id, name and face). */
const settingsKey = (f: Wire): string => JSON.stringify(Object.entries(f).filter(([k]) => k !== 'id' && k !== 'name' && k !== 'face').sort(([a], [b]) => (a < b ? -1 : 1)));
/**
 * The threads edited together with thread `id`: the run of neighbouring thread features in the history with exactly the same
 * settings (what one Shift+T on several faces creates). Just `[id]` when it stands alone.
 */
export function threadGroup(features: Wire[], id: string): string[] {
  const i = features.findIndex((f) => f.id === id);
  if (i < 0 || features[i].type !== 'thread') return [id];
  const key = settingsKey(features[i]);
  const same = (f: Wire | undefined): boolean => !!f && f.type === 'thread' && settingsKey(f) === key;
  let a = i, b = i;
  while (same(features[a - 1])) a--;
  while (same(features[b + 1])) b++;
  return features.slice(a, b + 1).map((f) => String(f.id));
}

/** One new thread per face, sharing settings: the size nearest to the first face's diameter. */
export function threadOpsForFaces(cyls: FaceCylinder[], rows: ThreadRow[]): EditOp[] | null {
  const first = cyls[0];
  if (!first) return null;
  const one = newThread(first.face, first.cyl.radius * 2, rows, first.cyl.internal);
  if (!one) return null;
  return cyls.map((c) => ({ op: 'add' as const, feature: { ...one, face: c.face } as never }));
}
