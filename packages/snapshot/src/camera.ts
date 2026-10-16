// Camera math for the renderer. The standard view table is the one in packages/viewport/src/camerarig.ts (and
// docs/navigation.md): Y up: Top +Y, Front +Z, Right +X; Z up: Top +Z, Front -Y, Right +X. A test pins the two together.
import type { V3, ViewSpec } from './types.js';

export const TILT = 0.0001;
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export const upVector = (up: 'y' | 'z'): V3 => (up === 'z' ? [0, 0, 1] : [0, 1, 0]);
export const frontDir = (up: 'y' | 'z'): V3 => (up === 'z' ? [0, -1, 0] : [0, 0, 1]);

export type StdView = 'iso' | 'front' | 'top' | 'right' | 'back' | 'left' | 'bottom';
export const STD_VIEWS: readonly StdView[] = ['iso', 'front', 'top', 'right', 'back', 'left', 'bottom'];

/** Camera direction (target -> camera) of a standard view. */
export function stdDirection(view: StdView, up: 'y' | 'z'): V3 {
  if (up === 'y') {
    switch (view) {
      case 'iso': return [1, 0.8, 1];
      case 'front': return [0, 0, 1];
      case 'back': return [0, 0, -1];
      case 'right': return [1, 0, 0];
      case 'left': return [-1, 0, 0];
      case 'top': return [0, 1, TILT];
      case 'bottom': return [0, -1, TILT];
    }
  }
  switch (view) {
    case 'iso': return [1, -1, 0.8];
    case 'front': return [0, -1, 0];
    case 'back': return [0, 1, 0];
    case 'right': return [1, 0, 0];
    case 'left': return [-1, 0, 0];
    case 'top': return [0, -TILT, 1];
    case 'bottom': return [0, -TILT, -1];
  }
}

/** Azimuth 0 = Front side, +90 = Right side; elevation up from the horizon (degrees). */
export function dirFromAzEl(az: number, el: number, up: 'y' | 'z'): V3 {
  const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180;
  const f = frontDir(up), u = upVector(up);
  const h = Math.cos(e), x: V3 = [1, 0, 0];
  const d: V3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) d[i] = h * (Math.cos(a) * f[i] + Math.sin(a) * x[i]) + Math.sin(e) * u[i];
  return offPole(norm(d), up);
}

export function azElOf(dir: V3, up: 'y' | 'z'): { az: number; el: number } {
  const d = norm(dir), f = frontDir(up), u = upVector(up);
  const el = Math.asin(Math.max(-1, Math.min(1, dot(d, u))));
  const az = Math.atan2(d[0], dot(d, f));
  return { az: (az * 180) / Math.PI, el: (el * 180) / Math.PI };
}

export function offPole(dir: V3, up: 'y' | 'z'): V3 {
  const d = norm(dir);
  if (Math.abs(dot(d, upVector(up))) < 1 - 1e-9) return d;
  const f = frontDir(up);
  return norm([d[0] + f[0] * TILT, d[1] + f[1] * TILT, d[2] + f[2] * TILT]);
}

/** Resolve a ViewSpec to a camera direction and the world up vector. */
export function resolveView(view: ViewSpec | undefined, up: 'y' | 'z'): { dir: V3; upv: V3; name: string } {
  const v = view ?? 'iso';
  if (typeof v === 'string') {
    if (!STD_VIEWS.includes(v)) throw new Error(`snapshot: unknown view '${v}'`);
    return { dir: norm(stdDirection(v, up)), upv: upVector(up), name: v };
  }
  if ('dir' in v) return { dir: offPole(norm(v.dir), up), upv: norm(v.up ?? upVector(up)), name: 'custom' };
  const dir = dirFromAzEl(v.azimuth, v.elevation ?? 20, up);
  return { dir, upv: upVector(up), name: `az${+v.azimuth.toFixed(1)}el${+(v.elevation ?? 20).toFixed(1)}` };
}

export interface Camera {
  dir: V3; right: V3; upv: V3;
  center: V3; radius: number;
  persp: boolean; dist: number;
  /** pixels per model unit at the centre depth */
  scale: number;
  /** pixel position of `center` */
  px: number; py: number;
  /** depth bias in the units of `n` */
  bias: number;
  /** Project: out = [sx, sy, nearness]. Returns false when behind the eye. */
  project(p: ArrayLike<number>, out: Float64Array): boolean;
}

export function makeCamera(o: { dir: V3; upv: V3; center: V3; radius: number; persp: boolean; scale: number; px: number; py: number }): Camera {
  const dir = norm(o.dir);
  let right = cross(o.upv, dir);
  if (Math.hypot(...right) < 1e-9) right = cross([0, 1, 0], dir);
  right = norm(right);
  const upv = norm(cross(dir, right));
  const R = o.radius || 1;
  const dist = R / Math.sin((32 * Math.PI) / 360); // vertical fov about 32 degrees
  const { center, scale, px, py, persp } = o;
  const cam: Camera = {
    dir, right, upv, center, radius: R, persp, dist, scale, px, py,
    bias: persp ? 0.006 * (R / dist) : 0.006,
    project(p, out) {
      const dx = p[0] - center[0], dy = p[1] - center[1], dz = p[2] - center[2];
      const x = dx * right[0] + dy * right[1] + dz * right[2];
      const y = dx * upv[0] + dy * upv[1] + dz * upv[2];
      const z = dx * dir[0] + dy * dir[1] + dz * dir[2];
      if (persp) {
        const w = dist - z;
        if (w < dist * 0.05) return false;
        const k = (scale * dist) / w;
        out[0] = px + x * k; out[1] = py - y * k; out[2] = dist / w;
      } else {
        out[0] = px + x * scale; out[1] = py - y * scale; out[2] = z / R;
      }
      return true;
    },
  };
  return cam;
}

export { sub };
