// The positioning ball: the pure part. A frame (origin and three orthonormal axes) is drawn at a constant size on screen:
// a thin ring facing the camera, three axis end dots on the ring, a plane square beside each, three short orientation
// stubs at the centre. This file turns a frame and a camera (two functions) into screen geometry, finds the handle under
// the pointer, and maps pointer movement to a distance, a plane move or an angle. No WebGL, so it is tested directly.
import { V, rayLineParam, rayPlanePoint, type Vec3 } from './handles';

export type Axes3 = [Vec3, Vec3, Vec3];
export interface TriFrame { origin: Vec3; axes: Axes3 }
export type Px = [number, number];

export const RING_PX = 95;
export const SQUARE_PX = 38;
export const SQUARE_INSET_PX = 17;
export const STUB_PX = 22;

export interface TriScreen {
  /** Screen position (CSS pixels, relative to the canvas) of a world point, or null behind the camera. */
  project(p: Vec3): Px | null;
  /** World units per screen pixel at a point. */
  worldPerPx(p: Vec3): number;
}

export interface TriGeom {
  c: Px;
  ring: number;
  /** Screen vector of one pixel of each axis (its foreshortening): length 1 when the axis lies in the screen. */
  s: [Px, Px, Px];
  /** Orientation dots. */
  stubs: [Px, Px, Px];
  /** Axis end dots on the ring (+ side) and the opposite (- side) ones, drawn only for a selected axis. */
  ends: [Px, Px, Px];
  minus: [Px, Px, Px];
  /** The plane square that hangs off each axis end: four corners, and its centre. */
  squares: [Px[], Px[], Px[]];
  squareCentres: [Px, Px, Px];
}

const FALLBACK_ANGLE = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3];

/** Screen geometry of the ball for a frame. Null when the origin is behind the camera. */
export function triGeometry(frame: TriFrame, scr: TriScreen, ring = RING_PX): TriGeom | null {
  const c = scr.project(frame.origin);
  if (!c) return null;
  const w = scr.worldPerPx(frame.origin);
  const L = 30;
  const s = [0, 1, 2].map((i): Px => {
    const p = scr.project(V.add(frame.origin, V.mul(frame.axes[i], w * L)));
    return p ? [(p[0] - c[0]) / L, (p[1] - c[1]) / L] : [0, 0];
  }) as [Px, Px, Px];
  const dir = s.map((v, i): Px => {
    const l = Math.hypot(v[0], v[1]);
    return l < 0.04 ? [Math.cos(FALLBACK_ANGLE[i]), Math.sin(FALLBACK_ANGLE[i])] : [v[0] / l, v[1] / l];
  }) as [Px, Px, Px];
  const at = (d: Px, k: number): Px => [c[0] + d[0] * k, c[1] + d[1] * k];
  const stubs = s.map((v, i) => at(dir[i], Math.max(STUB_PX * Math.hypot(v[0], v[1]), 9))) as [Px, Px, Px];
  const ends = dir.map((d) => at(d, ring)) as [Px, Px, Px];
  const minus = dir.map((d) => at(d, -ring)) as [Px, Px, Px];
  const squareCentres = dir.map((d) => at(d, ring - SQUARE_INSET_PX)) as [Px, Px, Px];
  const h = SQUARE_PX / 2;
  const squares = [0, 1, 2].map((i) => {
    const u = s[(i + 1) % 3], v = s[(i + 2) % 3], sc = squareCentres[i];
    return ([[1, 1], [-1, 1], [-1, -1], [1, -1]] as Array<[number, number]>).map(([a, b]): Px => [sc[0] + h * (a * u[0] + b * v[0]), sc[1] + h * (a * u[1] + b * v[1])]);
  }) as [Px[], Px[], Px[]];
  return { c, ring, s, stubs, ends, minus, squares, squareCentres };
}

export type TriTarget =
  | { kind: 'centre' }
  | { kind: 'stub'; axis: 0 | 1 | 2 }
  | { kind: 'end'; axis: 0 | 1 | 2; sign: 1 | -1 }
  | { kind: 'plane'; axis: 0 | 1 | 2 }
  | { kind: 'ring' }
  | { kind: 'inner' };

export interface HitOptions {
  /** The selected axis: its minus dot becomes live and the interior turns into a rotation area. */
  axis: number | null;
  /** Handles that do nothing for this target (a face moves along its normal only). */
  off?: { axes?: boolean[]; /** one flag per plane square (the plane perpendicular to that axis); false = off */ planes?: boolean[]; rotate?: boolean };
}

export function inPoly(p: Px, q: Px[]): boolean {
  let inside = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    const [xi, yi] = q[i], [xj, yj] = q[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The handle under a pixel. Order: centre, orientation dots, axis end dots, plane squares, ring, interior (only with an axis selected). */
export function triHit(g: TriGeom, o: HitOptions, p: Px): TriTarget | null {
  const d = (a: Px) => Math.hypot(p[0] - a[0], p[1] - a[1]);
  if (d(g.c) <= 9) return { kind: 'centre' };
  for (let i = 0; i < 3; i++) if (d(g.stubs[i]) <= 8) return { kind: 'stub', axis: i as 0 | 1 | 2 };
  for (let i = 0; i < 3; i++) {
    if (o.off?.axes?.[i] === false) continue;
    if (d(g.ends[i]) <= 10) return { kind: 'end', axis: i as 0 | 1 | 2, sign: 1 };
    if (o.axis === i && d(g.minus[i]) <= 10) return { kind: 'end', axis: i as 0 | 1 | 2, sign: -1 };
  }
  for (let i = 0; i < 3; i++) if (o.off?.planes?.[i] !== false && inPoly(p, g.squares[i])) return { kind: 'plane', axis: i as 0 | 1 | 2 };
  const r = d(g.c);
  if (!o.off?.rotate && Math.abs(r - g.ring) <= 7) return { kind: 'ring' };
  if (!o.off?.rotate && o.axis !== null && r < g.ring - 7) return { kind: 'inner' };
  return null;
}

// ---- drag maths ----

export interface Ray { o: Vec3; d: Vec3 }

/** Signed distance along `dir` (unit) from the pointer's start to now, read from two rays. Falls back to the screen when the axis points at the camera. */
export function axisDistance(r0: Ray, r1: Ray, origin: Vec3, dir: Vec3, screen?: { delta: Px; s: Px }): number {
  const grazing = Math.abs(V.dot(V.norm(r1.d), dir)) > 0.985;
  if (!grazing) {
    const t0 = rayLineParam(r0.o, r0.d, origin, dir), t1 = rayLineParam(r1.o, r1.d, origin, dir);
    if (t0 !== null && t1 !== null) return t1 - t0;
  }
  if (!screen) return 0;
  const l2 = screen.s[0] ** 2 + screen.s[1] ** 2;
  return l2 < 1e-6 ? 0 : (screen.delta[0] * screen.s[0] + screen.delta[1] * screen.s[1]) / l2;
}

/** World vector moved in the plane through `origin` with normal `n`, from one ray to another. Null when the plane is edge-on. */
export function planeMove(r0: Ray, r1: Ray, origin: Vec3, n: Vec3): Vec3 | null {
  const a = rayPlanePoint(r0.o, r0.d, origin, n), b = rayPlanePoint(r1.o, r1.d, origin, n);
  return a && b ? V.sub(b, a) : null;
}

/** Degrees turned about `axis` when the pointer goes from `p0` to `p1` around the screen centre `c`. `toCamera` is the unit vector from the origin to the camera;
 *  looking at the axis tip, a counter-clockwise screen turn is a positive rotation. */
export function spinAngle(c: Px, p0: Px, p1: Px, axis: Vec3, toCamera: Vec3): number {
  const a0 = Math.atan2(-(p0[1] - c[1]), p0[0] - c[0]), a1 = Math.atan2(-(p1[1] - c[1]), p1[0] - c[0]);
  let d = a1 - a0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const sign = V.dot(axis, toCamera) >= 0 ? 1 : -1;
  return ((d * 180) / Math.PI) * sign;
}

/** Round to a multiple of `step` (Ctrl). A zero step leaves the value. */
export const snapTo = (v: number, step: number): number => (step > 0 ? +(Math.round(v / step) * step).toFixed(9) : v);

// ---- frame algebra ----

/** Orthonormal axes whose `i`-th axis is `dir`; the others follow the old frame (Gram-Schmidt), so a re-aim keeps the rest as close as it can. */
export function reaim(axes: Axes3, i: 0 | 1 | 2, dir: Vec3): Axes3 {
  const a = V.norm(dir);
  const j = ((i + 1) % 3) as 0 | 1 | 2;
  let b = V.sub(axes[j], V.mul(a, V.dot(axes[j], a)));
  if (V.len(b) < 1e-6) { b = V.sub(axes[((i + 2) % 3) as 0 | 1 | 2], V.mul(a, V.dot(axes[((i + 2) % 3) as 0 | 1 | 2], a))); }
  if (V.len(b) < 1e-6) b = V.cross(a, Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
  b = V.norm(b);
  const k = V.cross(a, b);              // a x b completes a right-handed set in the order (i, j, k)
  const out: Axes3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  out[i] = a; out[j] = b; out[((i + 2) % 3) as 0 | 1 | 2] = k;
  return out;
}

/** Rotate a vector about a unit axis by `deg` degrees (Rodrigues). */
export function rotateVec(v: Vec3, axis: Vec3, deg: number): Vec3 {
  const k = V.norm(axis), a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return V.add(V.add(V.mul(v, c), V.mul(V.cross(k, v), s)), V.mul(k, V.dot(k, v) * (1 - c)));
}

/** The frame after the object it rides on is moved: rotated about `axis` through `at`, then translated. */
export function moveFrame(f: TriFrame, rot: { axis: Vec3; origin: Vec3; angle: number } | null, translate: Vec3): TriFrame {
  if (!rot || Math.abs(rot.angle) < 1e-12) return { origin: V.add(f.origin, translate), axes: f.axes };
  const o = V.add(V.add(rot.origin, rotateVec(V.sub(f.origin, rot.origin), rot.axis, rot.angle)), translate);
  return { origin: o, axes: f.axes.map((a) => rotateVec(a, rot.axis, rot.angle)) as Axes3 };
}

export const WORLD_AXES: Axes3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
