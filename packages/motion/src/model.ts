// Motion studies, logic without DOM or kernel (docs/spec-motion-studies.md): the drivers the kernel reports, the pose a set of driver values
// gives, the per-component rigid motion the viewer draws, and the `motion` field of the document.
export type V3 = [number, number, number];
/** A kernel placement frame: origin and the images of the local x, y, z axes (local -> world). */
export interface Frame { o: number[]; x: number[]; y: number[]; z: number[] }
/** A rigid motion: rotation `r` (row-major 3x3) then translation `t`. */
export interface Rigid { r: number[]; t: number[] }

/** A drivable mate as the kernel's `solvePoses` reports it: angles in degrees, distances in mm. `value` is the assembled value. */
export interface KernelDriver { mate: string; kind: 'angle' | 'distance'; unit: 'deg' | 'mm'; value: number }
/** The first thing a pose touches: two components (feature ids), `contact` when their surfaces cross, `near` when closer than the clearance. */
export interface ContactReply { a: string; b: string; kind: 'contact' | 'near'; distance: number; at: number[] }
export interface PoseReply { ok: boolean; places: Array<{ id: string; place: Frame }>; error?: string; mate?: string; contact?: ContactReply }
export interface SolveReply { drivers: KernelDriver[]; poses: PoseReply[] }

const IDENTITY: Rigid = { r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };
const isVec = (v: unknown, n: number): v is number[] => Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x));
export const isFrame = (f: unknown): f is Frame => !!f && typeof f === 'object' && isVec((f as Frame).o, 3) && isVec((f as Frame).x, 3) && isVec((f as Frame).y, 3) && isVec((f as Frame).z, 3);

/** The kernel frame as a rigid motion (columns of the rotation are the axis images). */
export const rigidOf = (f: Frame): Rigid => ({ r: [f.x[0], f.y[0], f.z[0], f.x[1], f.y[1], f.z[1], f.x[2], f.y[2], f.z[2]], t: [...f.o] });
const apply = (m: Rigid, p: number[]): V3 => [m.r[0] * p[0] + m.r[1] * p[1] + m.r[2] * p[2] + m.t[0], m.r[3] * p[0] + m.r[4] * p[1] + m.r[5] * p[2] + m.t[1], m.r[6] * p[0] + m.r[7] * p[1] + m.r[8] * p[2] + m.t[2]];
const turn = (m: Rigid, v: number[]): V3 => [m.r[0] * v[0] + m.r[1] * v[1] + m.r[2] * v[2], m.r[3] * v[0] + m.r[4] * v[1] + m.r[5] * v[2], m.r[6] * v[0] + m.r[7] * v[1] + m.r[8] * v[2]];
const transpose = (r: number[]): number[] => [r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]];
const mul = (a: number[], b: number[]): number[] => {
  const o = new Array<number>(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return o;
};

/** The motion that takes a component from its assembled placement to the posed one: `to ∘ from⁻¹`. */
export function deltaBetween(from: Frame, to: Frame): Rigid {
  const f = rigidOf(from), g = rigidOf(to);
  const r = mul(g.r, transpose(f.r));
  const rf = turn({ r, t: [0, 0, 0] }, f.t);
  return { r, t: [g.t[0] - rf[0], g.t[1] - rf[1], g.t[2] - rf[2]] };
}
export const isIdentity = (m: Rigid, tol = 1e-9): boolean => m.r.every((v, i) => Math.abs(v - IDENTITY.r[i]) < tol) && m.t.every((v) => Math.abs(v) < tol);

/** Per-component motion of a pose against the assembled placements (components that did not move are left out). */
export function poseDeltas(assembled: ReadonlyArray<{ id: string; place?: Frame }>, pose: PoseReply): Map<string, Rigid> {
  const out = new Map<string, Rigid>();
  const base = new Map(assembled.map((c) => [c.id, c.place] as const));
  for (const p of pose.places) {
    const from = base.get(p.id);
    if (!isFrame(from) || !isFrame(p.place)) continue;
    const d = deltaBetween(from, p.place);
    if (!isIdentity(d)) out.set(p.id, d);
  }
  return out;
}

/** Move a point / turn a direction by a component's pose motion. */
export const movePoint = (m: Rigid, p: number[]): V3 => apply(m, p);
export const moveDir = (m: Rigid, v: number[]): V3 => turn(m, v);

/** Why a sweep ended: `reached` is the farthest value reached freely. */
export interface SweepStop { reason: 'range' | 'limit' | 'contact' | 'solver' | 'branchJump'; value: number; mate?: string; bound?: 'min' | 'max'; bound_value?: number; a?: string; b?: string; near?: boolean; distance?: number; at?: number[]; error?: string; component?: string }
export interface SweepReply { driver: string; from: number; to: number; reached: number; stop: SweepStop; startContacts: string[][]; posesSolved: number }
export const isSweep = (r: unknown): r is SweepReply => !!r && typeof r === 'object' && typeof (r as SweepReply).reached === 'number' && !!(r as SweepReply).stop;

/** A stop as an i18n key and its parameters (the panel says it in the user's language; the kernel's reason stays in the tooltip). `name` turns a component or mate id into the name the user gave it. */
export function describeStop(stop: SweepStop, name: (id: string) => string, unit: string): { key: string; params: Record<string, string | number> } {
  const v = +stop.value.toFixed(3);
  const base = { value: v, unit };
  switch (stop.reason) {
    case 'range': return { key: 'motion.stop.range', params: base };
    case 'limit': return { key: 'motion.stop.limit.' + (stop.bound ?? 'max'), params: { ...base, mate: name(stop.mate ?? ''), bound: +(stop.bound_value ?? 0).toFixed(3) } };
    case 'contact': {
      const other = stop.b ?? '';
      return { key: stop.near ? 'motion.stop.near' : 'motion.stop.contact', params: { ...base, a: name(stop.a ?? ''), b: name(other), gap: +(stop.distance ?? 0).toFixed(3) } };
    }
    case 'branchJump': return { key: 'motion.stop.jump', params: { ...base, part: name(stop.component ?? '') } };
    default: return { key: 'motion.stop.solver', params: base };
  }
}

// ---- plain words ------------------------------------------------------------------------------------------------------------------

/** Why a pose could not be solved, in the words of the panel (the code stays in the tooltip). */
export function poseProblem(code: string): string {
  if (code === 'mateConflict') return 'The mates cannot all hold at this value: the motion would break one of them.';
  if (code === 'mateGeometry') return 'A mate in the chain has faces the solver cannot use.';
  if (code === 'mateFixed') return 'A fixed part would have to move.';
  return 'The mates cannot be solved at this value.';
}

// ---- the document's `motion` field --------------------------------------------------------------------------------------------------

/** A driver's range is a study setting (display only; the mates are untouched). */
export interface DriverSetting { mate: string; min: number; max: number; value: number }
export interface MotionDoc { version: 1; drivers: DriverSetting[]; [k: string]: unknown }
export const NO_MOTION: MotionDoc = { version: 1, drivers: [] };

/** Read `doc.motion` defensively: unknown fields (studies the mjcf bridge wrote, later phases) are kept as they are. */
export function readMotion(raw: unknown): MotionDoc {
  if (!raw || typeof raw !== 'object') return NO_MOTION;
  const o = raw as Record<string, unknown>;
  const drivers: DriverSetting[] = [];
  if (Array.isArray(o.drivers)) {
    for (const d of o.drivers as Array<Record<string, unknown>>) {
      if (d && typeof d.mate === 'string' && typeof d.min === 'number' && typeof d.max === 'number' && d.min <= d.max) drivers.push({ mate: d.mate, min: d.min, max: d.max, value: typeof d.value === 'number' ? d.value : 0 });
    }
  }
  return { ...o, version: 1, drivers };
}

/** The slider range of a driver: the saved one, else a default by kind (angles one turn each way, distances 100 mm each way). */
export function rangeOf(d: KernelDriver, saved: ReadonlyArray<DriverSetting>): { min: number; max: number } {
  const s = saved.find((x) => x.mate === d.mate);
  if (s) return { min: s.min, max: s.max };
  return d.kind === 'angle' ? { min: -360, max: 360 } : { min: -100, max: 100 };
}

/** Keep only the newest of several requests made while one is running (a slider drag asks faster than the kernel answers). */
export function latestOnly<A extends unknown[]>(run: (...a: A) => Promise<void>): (...a: A) => void {
  let busy = false;
  let pending: A | null = null;
  const go = async (a: A): Promise<void> => {
    busy = true;
    try { await run(...a); } finally {
      busy = false;
      const next = pending;
      pending = null;
      if (next) void go(next);
    }
  };
  return (...a: A) => { if (busy) pending = a; else void go(a); };
}

// ---- in between two solved frames --------------------------------------------------------------------------------------------------------

type Quat = [number, number, number, number];
function toQuat(r: number[]): Quat {
  const t = r[0] + r[4] + r[8];
  let q: Quat;
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; q = [0.25 * s, (r[7] - r[5]) / s, (r[2] - r[6]) / s, (r[3] - r[1]) / s]; }
  else if (r[0] > r[4] && r[0] > r[8]) { const s = Math.sqrt(1 + r[0] - r[4] - r[8]) * 2; q = [(r[7] - r[5]) / s, 0.25 * s, (r[1] + r[3]) / s, (r[2] + r[6]) / s]; }
  else if (r[4] > r[8]) { const s = Math.sqrt(1 + r[4] - r[0] - r[8]) * 2; q = [(r[2] - r[6]) / s, (r[1] + r[3]) / s, 0.25 * s, (r[5] + r[7]) / s]; }
  else { const s = Math.sqrt(1 + r[8] - r[0] - r[4]) * 2; q = [(r[3] - r[1]) / s, (r[2] + r[6]) / s, (r[5] + r[7]) / s, 0.25 * s]; }
  return q;
}
function fromQuat([w, x, y, z]: Quat): number[] {
  return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
}
function slerp(a: Quat, b0: Quat, u: number): Quat {
  let b = b0;
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (d < 0) { b = [-b[0], -b[1], -b[2], -b[3]]; d = -d; }
  if (d > 0.9995) { const q: Quat = [a[0] + u * (b[0] - a[0]), a[1] + u * (b[1] - a[1]), a[2] + u * (b[2] - a[2]), a[3] + u * (b[3] - a[3])]; const n = Math.hypot(...q); return [q[0] / n, q[1] / n, q[2] / n, q[3] / n]; }
  const th = Math.acos(d), s = Math.sin(th), wa = Math.sin((1 - u) * th) / s, wb = Math.sin(u * th) / s;
  return [wa * a[0] + wb * b[0], wa * a[1] + wb * b[1], wa * a[2] + wb * b[2], wa * a[3] + wb * b[3]];
}

/** A rigid motion `u` of the way (0..1) from `a` to `b`: the rotation by slerp, the translation linearly (between two frames a fraction of a degree apart the
 *  path is the arc to well under a micron). A missing side is the identity. */
export function lerpRigid(a: Rigid | undefined, b: Rigid | undefined, u: number): Rigid {
  const A = a ?? IDENTITY, B = b ?? IDENTITY;
  if (u <= 0) return A;
  if (u >= 1) return B;
  return { r: fromQuat(slerp(toQuat(A.r), toQuat(B.r), u)), t: [A.t[0] + u * (B.t[0] - A.t[0]), A.t[1] + u * (B.t[1] - A.t[1]), A.t[2] + u * (B.t[2] - A.t[2])] };
}

/** The pose between two solved frames (components that move in either). */
export function lerpPose(a: ReadonlyMap<string, Rigid> | undefined, b: ReadonlyMap<string, Rigid> | undefined, u: number): Map<string, Rigid> {
  const out = new Map<string, Rigid>();
  for (const id of new Set([...(a?.keys() ?? []), ...(b?.keys() ?? [])])) out.set(id, lerpRigid(a?.get(id), b?.get(id), u));
  return out;
}

