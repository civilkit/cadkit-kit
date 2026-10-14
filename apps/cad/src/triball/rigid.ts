// Rigid motions as the kernel's moveBody states them (rotate about an axis through a point, then translate) and their
// composition, so a second drag on the same body can fold into the one feature that already moves it.
import type { Vec3 } from '@kit/viewport';

export type Mat3 = [Vec3, Vec3, Vec3];   // rows
export interface Rigid { R: Mat3; t: Vec3 }  // x' = R x + t
export interface RotSpec { axis: Vec3; origin: Vec3; angle: number }   // degrees
export interface MoveSpec { translate: Vec3; rotate?: RotSpec | null }

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const ID: Mat3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

export const mulV = (m: Mat3, v: Vec3): Vec3 => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];
export function mulM(a: Mat3, b: Mat3): Mat3 {
  const col = (j: number): Vec3 => [b[0][j], b[1][j], b[2][j]];
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => dot(a[i], col(j)))) as Mat3;
}

/** Rotation matrix about a unit axis by `deg` degrees (right-handed). */
export function rotMat(axis: Vec3, deg: number): Mat3 {
  const l = Math.hypot(...axis) || 1;
  const [x, y, z] = [axis[0] / l, axis[1] / l, axis[2] / l];
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), k = 1 - c;
  return [[c + x * x * k, x * y * k - z * s, x * z * k + y * s], [y * x * k + z * s, c + y * y * k, y * z * k - x * s], [z * x * k - y * s, z * y * k + x * s, c + z * z * k]];
}

/** Axis and angle (degrees, 0..180) of a rotation matrix. Axis is [0,0,1] for no rotation. */
export function axisAngle(m: Mat3): { axis: Vec3; angle: number } {
  const tr = m[0][0] + m[1][1] + m[2][2];
  const c = Math.max(-1, Math.min(1, (tr - 1) / 2));
  const angle = Math.acos(c);
  if (angle < 1e-9) return { axis: [0, 0, 1], angle: 0 };
  if (Math.PI - angle < 1e-6) {
    // half turn: the axis is the column of (R + I) with the largest norm
    const b = [0, 1, 2].map((j) => [m[0][j] + (j === 0 ? 1 : 0), m[1][j] + (j === 1 ? 1 : 0), m[2][j] + (j === 2 ? 1 : 0)] as Vec3);
    const best = b.reduce((p, q) => (Math.hypot(...q) > Math.hypot(...p) ? q : p));
    const l = Math.hypot(...best);
    return { axis: [best[0] / l, best[1] / l, best[2] / l], angle: 180 };
  }
  const s = 2 * Math.sin(angle);
  return { axis: [(m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s], angle: (angle * 180) / Math.PI };
}

export function toRigid(m: MoveSpec): Rigid {
  const r = m.rotate;
  if (!r || Math.abs(r.angle) < 1e-12) return { R: ID, t: m.translate };
  const R = rotMat(r.axis, r.angle);
  // about `origin`: R (x - o) + o, then translate
  return { R, t: add(add(sub(r.origin, mulV(R, r.origin)), [0, 0, 0]), m.translate) };
}

/** `b` after `a`. */
export const compose = (a: Rigid, b: Rigid): Rigid => ({ R: mulM(b.R, a.R), t: add(mulV(b.R, a.t), b.t) });

/** The moveBody parameters of a rigid motion (rotation about the world origin). */
export function fromRigid(r: Rigid): MoveSpec {
  const { axis, angle } = axisAngle(r.R);
  const clean = (v: Vec3): Vec3 => v.map((x) => +x.toFixed(9)) as Vec3;
  return angle < 1e-9 ? { translate: clean(r.t) } : { translate: clean(r.t), rotate: { axis: clean(axis), origin: [0, 0, 0], angle: +angle.toFixed(9) } };
}

export const isNoMove = (m: MoveSpec): boolean => Math.hypot(...m.translate) < 1e-9 && (!m.rotate || Math.abs(m.rotate.angle) < 1e-9);

/** Read the numbers out of a moveBody feature; null when any field is an expression (then it is never merged). */
export function specOf(f: Record<string, unknown>): MoveSpec | null {
  const vec = (v: unknown): Vec3 | null => (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number') ? [v[0], v[1], v[2]] as Vec3 : null);
  const t = f.translate === undefined ? ([0, 0, 0] as Vec3) : vec(f.translate);
  if (!t) return null;
  const r = f.rotate as { axis?: unknown; origin?: unknown; angle?: unknown } | undefined;
  if (!r) return { translate: t };
  const axis = vec(r.axis), origin = r.origin === undefined ? ([0, 0, 0] as Vec3) : vec(r.origin);
  if (!axis || !origin || typeof r.angle !== 'number') return null;
  return { translate: t, rotate: { axis, origin, angle: r.angle } };
}
