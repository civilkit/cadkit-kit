// Drag a part to move the mechanism: the pure maths. The app does not know a mate's axis or pivot, only that a driver (angle or distance) moves the
// parts. So the drag asks the kernel: where is the grabbed component at the current pose, and at the pose with each driver nudged a little? From
// those frames the grabbed point (fixed in the component) gives, per driver, how it moves on screen. A Gauss-Newton step then moves the best
// driver by the amount that brings the point towards the cursor; repeated on every pointer move, the point follows the cursor without drifting.
import type { Frame } from '@kit/motion';

export type V3 = [number, number, number];
export type V2 = [number, number];
/** World point to screen pixel; null when the point is behind the camera. */
export type Projector = (p: V3) => V2 | null;

/** The component's frame maps its own coordinates to the world: o + x*lx + y*ly + z*lz. */
export function worldOf(f: Frame, l: V3): V3 {
  return [0, 1, 2].map((i) => f.o[i]! + f.x[i]! * l[0] + f.y[i]! * l[1] + f.z[i]! * l[2]) as V3;
}
/** The component's own coordinates of a world point (the frame's axes are orthonormal). */
export function localOf(f: Frame, p: V3): V3 {
  const d = [p[0] - f.o[0]!, p[1] - f.o[1]!, p[2] - f.o[2]!];
  const dot = (a: number[]) => a[0]! * d[0]! + a[1]! * d[1]! + a[2]! * d[2]!;
  return [dot(f.x), dot(f.y), dot(f.z)];
}

export interface DragDriver { mate: string; step: number }
export interface DragInput {
  /** The component's frame at the current pose, then with driver i nudged by drivers[i].step (null: that pose failed). */
  frames: Array<Frame | null>;
  drivers: DragDriver[];
  /** The grabbed point in the component's own coordinates. */
  local: V3;
  pointer: V2;
  project: Projector;
  /** Keep to this driver once the first movement chose it. */
  locked?: string | null;
  /** Below this many pixels of error nothing moves (a click is not a drag). */
  deadPx?: number;
}
export interface DragStep { mate: string; index: number; delta: number; errorPx: number }

/** Pixels the grabbed point moves per unit of driver i (null when the nudge did not solve or moved the point nowhere). */
export function screenVelocities(inp: DragInput): Array<V2 | null> {
  const f0 = inp.frames[0];
  const s0 = f0 ? inp.project(worldOf(f0, inp.local)) : null;
  return inp.drivers.map((d, i) => {
    const fi = inp.frames[i + 1];
    if (!s0 || !fi || !(Math.abs(d.step) > 0)) return null;
    const si = inp.project(worldOf(fi, inp.local));
    if (!si) return null;
    const v: V2 = [(si[0] - s0[0]) / d.step, (si[1] - s0[1]) / d.step];
    return Math.hypot(v[0], v[1]) > 1e-9 ? v : null;
  });
}

/** One Gauss-Newton step towards the cursor: which driver to move and by how much, or null when no driver moves the point. */
export function dragStep(inp: DragInput): DragStep | null {
  const f0 = inp.frames[0];
  if (!f0) return null;
  const s0 = inp.project(worldOf(f0, inp.local));
  if (!s0) return null;
  const e: V2 = [inp.pointer[0] - s0[0], inp.pointer[1] - s0[1]];
  const errorPx = Math.hypot(e[0], e[1]);
  if (errorPx < (inp.deadPx ?? 0.5)) return null;
  const vel = screenVelocities(inp);
  let best = -1, bestGain = 0;
  vel.forEach((v, i) => {
    if (!v) return;
    if (inp.locked && inp.drivers[i]!.mate !== inp.locked) return;
    // how much of the error this driver can take away: the length of the error along its direction
    const gain = Math.abs(v[0] * e[0] + v[1] * e[1]) / Math.hypot(v[0], v[1]);
    if (gain > bestGain) { bestGain = gain; best = i; }
  });
  if (best < 0) return null;
  const v = vel[best]!;
  const delta = (v[0] * e[0] + v[1] * e[1]) / (v[0] * v[0] + v[1] * v[1]);
  return { mate: inp.drivers[best]!.mate, index: best, delta, errorPx };
}
