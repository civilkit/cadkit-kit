/**
 * View navigation maths that needs no renderer: the 26 targets of the view cube (6 faces, 12 edges, 8 corners), the
 * arrow ring's steps (turn the view up, down, left, right by a step) and the roll buttons (turn it about the view
 * direction), and the press-and-hold repeater. A view is a pose: `dir` points from the target to the camera, `up` is
 * the screen-up vector (perpendicular to `dir`).
 *
 * An arrow moves the model the way a drag in that direction does (right turns the model's left side towards you). While
 * the view is upright (no roll) left and right turn about the world up axis, so an iso view stays at its elevation, and
 * up and down tilt about the screen's horizontal axis, stopping at the pole views when a step would cross one. Once
 * the view is rolled, or sits on a pole, the steps are rigid turns about the screen's own axes, so four 90 degree steps
 * always come back to where they started. Results close to an axis are snapped to it exactly.
 */
import * as THREE from 'three';
import { upVector, type UpAxis, type V3 } from './camerarig';

export type ViewTurn = 'up' | 'down' | 'left' | 'right';
export type ViewRoll = 'cw' | 'ccw';
export interface ViewPose { dir: V3; up: V3 }
export type TargetKind = 'face' | 'edge' | 'corner';
export interface ViewTarget { dir: V3; kind: TargetKind }

/** The step sizes the arrows offer, in degrees; 90 is the default. */
export const STEP_SIZES = [15, 30, 45, 90] as const;
export const DEFAULT_STEP = 90;
export const sanitizeStep = (n: unknown): number => (STEP_SIZES as readonly number[]).includes(n as number) ? (n as number) : DEFAULT_STEP;

/** A face has one non-zero component, an edge two, a corner three. */
export const targetKind = (dir: V3): TargetKind => (dir.filter((c) => c !== 0).length === 1 ? 'face' : dir.filter((c) => c !== 0).length === 2 ? 'edge' : 'corner');

/** Every view the cube offers: the 26 non-zero combinations of -1, 0, +1 (the direction from the model to the camera). */
export function viewTargets(): ViewTarget[] {
  const out: ViewTarget[] = [];
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) {
    if (x || y || z) out.push({ dir: [x, y, z], kind: targetKind([x, y, z]) });
  }
  return out;
}

const EPS = 1e-9;
const vec = (a: V3) => new THREE.Vector3(a[0], a[1], a[2]);
/** Snap the components that are within rounding error of 0 or of +-1, so a quarter turn lands exactly on an axis. */
const tidy = (n: number): number => (Math.abs(n) < EPS ? 0 : Math.abs(Math.abs(n) - 1) < EPS ? Math.sign(n) : n);
const out = (v: THREE.Vector3): V3 => [tidy(v.x), tidy(v.y), tidy(v.z)];

/** A pose with unit `dir` and an `up` made perpendicular to it. */
export function normalisePose(p: ViewPose): ViewPose {
  const d = vec(p.dir).normalize();
  const u = vec(p.up);
  u.sub(d.clone().multiplyScalar(u.dot(d)));
  if (u.lengthSq() < 1e-12) u.crossVectors(d, Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0));
  u.normalize();
  return { dir: out(d), up: out(u) };
}

/** True when the screen's up is not the world up axis seen from the camera (the view was rolled); a pole view is never rolled, its screen-up says which way it was turned. */
export function isRolled(p: ViewPose, up: UpAxis): boolean {
  const d = vec(p.dir).normalize(), wu = vec(upVector(up));
  if (Math.abs(d.dot(wu)) > 1 - EPS) return false;
  const u0 = wu.clone().sub(d.clone().multiplyScalar(wu.dot(d))).normalize();
  return vec(p.up).normalize().dot(u0) < 1 - 1e-7;
}

function rotated(p: ViewPose, axis: THREE.Vector3, angle: number): ViewPose {
  const q = new THREE.Quaternion().setFromAxisAngle(axis.clone().normalize(), angle);
  return { dir: out(vec(p.dir).applyQuaternion(q)), up: out(vec(p.up).applyQuaternion(q)) };
}

/** Turn the view one step with an arrow of the ring. */
export function turnPose(pose: ViewPose, turn: ViewTurn, stepDeg: number, up: UpAxis): ViewPose {
  const p = normalisePose(pose);
  const a = (stepDeg * Math.PI) / 180;
  const d = vec(p.dir), u = vec(p.up), wu = vec(upVector(up));
  const rolled = isRolled(p, up);
  if (turn === 'left' || turn === 'right') {
    // the model moves the way the arrow points: right = the camera goes round to the model's left
    const angle = turn === 'left' ? a : -a;
    return normalisePose(rotated(p, rolled ? u : wu, angle));
  }
  const right = new THREE.Vector3().crossVectors(u, d);
  // a positive turn about the screen's right axis takes the camera down: the Up arrow shows the model from below
  let angle = turn === 'up' ? a : -a;
  if (!rolled) {
    const elev = Math.asin(Math.max(-1, Math.min(1, d.dot(wu))));
    const toPole = elev - angle;   // the camera's elevation after the step
    const limit = Math.PI / 2;
    // stop on a pole view when the step would go over it from a view that is not on it (an iso view tilted by 90 degrees ends on Top)
    if (Math.abs(elev) < limit - EPS && Math.abs(toPole) > limit) angle = elev - Math.sign(toPole) * limit;
  }
  return normalisePose(rotated(p, right, angle));
}

/** Turn the view about its own direction: clockwise turns what is on screen clockwise. */
export function rollPose(pose: ViewPose, roll: ViewRoll, stepDeg: number): ViewPose {
  const p = normalisePose(pose);
  const a = (stepDeg * Math.PI) / 180;
  return normalisePose(rotated(p, vec(p.dir), roll === 'cw' ? a : -a));
}

/** The pose that looks from `dir` with the world up axis up on screen (what a click on a cube face, edge or corner gives). */
export function snapPose(dir: V3, up: UpAxis): ViewPose {
  const d = vec(dir).normalize();
  const wu = vec(upVector(up));
  if (Math.abs(d.dot(wu)) > 1 - EPS) {
    // a pole view looks from the front side: screen-up points away from the front on Top, towards it on Bottom
    const f = up === 'z' ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(0, 0, 1);
    return normalisePose({ dir: [d.x, d.y, d.z], up: out(f.multiplyScalar(d.dot(wu) > 0 ? -1 : 1)) });
  }
  return normalisePose({ dir: [d.x, d.y, d.z], up: upVector(up) });
}

/** The same orientation with a camera that can look at the target: a pole view's direction leans a hair towards the side the screen's up points away from. */
export function offPolePose(p: ViewPose, up: UpAxis): ViewPose {
  const d = vec(p.dir).normalize(), wu = vec(upVector(up));
  if (Math.abs(d.dot(wu)) < 1 - EPS) return p;
  const lean = vec(p.up).multiplyScalar(d.dot(wu) > 0 ? -1 : 1);
  return { dir: [...d.add(lean.multiplyScalar(1e-4)).normalize().toArray()] as V3, up: p.up };
}

/** The angle in degrees between two poses' orientations (0 when they look the same way up). */
export function poseAngle(a: ViewPose, b: ViewPose): number {
  const qa = poseQuaternion(a), qb = poseQuaternion(b);
  return (qa.angleTo(qb) * 180) / Math.PI;
}

/** The camera rotation of a pose: its x axis is the screen's right, y is up, z points at the viewer. */
export function poseQuaternion(p: ViewPose): THREE.Quaternion {
  const n = normalisePose(p);
  const z = vec(n.dir), y = vec(n.up), x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
export function poseOfQuaternion(q: THREE.Quaternion): ViewPose {
  return { dir: new THREE.Vector3(0, 0, 1).applyQuaternion(q).toArray() as V3, up: new THREE.Vector3(0, 1, 0).applyQuaternion(q).toArray() as V3 };
}

export interface HoldTimers { set(fn: () => void, ms: number): unknown; clear(id: unknown): void; now(): number }
export interface Repeater { down(): void; up(): void; readonly active: boolean }

/** A timer that fires this much later than asked means the page was busy: the release of the press may be waiting in the queue behind it. */
const STALL_MS = 80;

/**
 * Press and hold: `fire` runs at once on press, again after `delay` ms and then every `interval` ms until release. The
 * interval is longer than one animated step, so each step finishes before the next starts. When the page was too busy to
 * run a timer on time (a slow phone drawing a big model) it gives the queued events a moment first, so a quick tap that was
 * only delivered late is one step and not two.
 */
export function holdRepeat(fire: () => void, opts: { delay?: number; interval?: number; timers?: HoldTimers } = {}): Repeater {
  const delay = opts.delay ?? 420, interval = opts.interval ?? 300;
  const timers: HoldTimers = opts.timers ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>), now: () => Date.now() };
  let id: unknown = null;
  let on = false;
  const again = (ms: number, yielded = false) => {
    const due = timers.now() + ms;
    id = timers.set(() => {
      if (!on) return;
      if (!yielded && timers.now() - due > STALL_MS) { again(40, true); return; }
      fire();
      again(interval);
    }, ms);
  };
  return {
    down() { if (on) return; on = true; fire(); again(delay); },
    up() { on = false; if (id !== null) timers.clear(id); id = null; },
    get active() { return on; },
  };
}
