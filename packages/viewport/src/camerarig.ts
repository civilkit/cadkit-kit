/**
 * Camera math that does not need a renderer: the up axis, the standard views for both conventions and the two orbit
 * modes. The viewport applies the results to its camera; model coordinates are never touched, only where the camera
 * sits and which way is up on screen.
 *
 *   Y up (default): Top = +Y, Front = +Z, Right = +X     (camera positions, target -> camera)
 *   Z up:           Top = +Z, Front = -Y, Right = +X
 *
 * The views follow the up axis, not the named reference planes: with Z up, "Top" looks down the up axis (at the XZ-named
 * plane's sibling, the XY plane) while the planes keep their names and geometry.
 */
import * as THREE from 'three';

export type UpAxis = 'y' | 'z';
export type OrbitMode = 'turntable' | 'trackball';
export type OrbitPivot = 'centre' | 'cursor' | 'selection';
export type StdViewName = 'iso' | 'front' | 'top' | 'right' | 'back' | 'left' | 'bottom';
export type V3 = [number, number, number];

export const UP_AXES: readonly UpAxis[] = ['y', 'z'];
export const ORBIT_MODES: readonly OrbitMode[] = ['turntable', 'trackball'];
export const ORBIT_PIVOTS: readonly OrbitPivot[] = ['centre', 'cursor', 'selection'];

export const upVector = (up: UpAxis): V3 => (up === 'z' ? [0, 0, 1] : [0, 1, 0]);

/** The horizontal direction the Front view sits on: +Z with Y up, -Y with Z up. */
export const frontDir = (up: UpAxis): V3 => (up === 'z' ? [0, -1, 0] : [0, 0, 1]);

/** A hair of tilt keeps the camera off the pole so lookAt never flips: Top and Bottom lean towards the front side. */
const TILT = 0.0001;

/** The camera direction (target -> camera) of a standard view. */
export function viewDirection(view: StdViewName, up: UpAxis): V3 {
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

/** Nudge a direction that lies on the up axis (a pole view) towards the front side, so the camera can look at the target. */
export function offPole(dir: V3, up: UpAxis): V3 {
  const u = upVector(up), f = frontDir(up);
  const along = dir[0] * u[0] + dir[1] * u[1] + dir[2] * u[2];
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  if (Math.abs(along) / len < 1 - 1e-9) return dir;
  return [dir[0] + f[0] * TILT, dir[1] + f[1] * TILT, dir[2] + f[2] * TILT];
}

/** The camera orientation as the pair the viewport needs. */
export interface CamState { position: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3 }

/** Pose for a camera direction at a distance: up is the world up axis. */
export function poseForDirection(target: V3, dir: V3, dist: number, up: UpAxis): CamState {
  const d = new THREE.Vector3(...offPole(dir, up)).normalize();
  const t = new THREE.Vector3(...target);
  return { position: t.clone().add(d.multiplyScalar(dist)), target: t, up: new THREE.Vector3(...upVector(up)) };
}

/** Switching the up axis keeps the target, the distance and the camera's place around the model (the same face still
 *  faces the camera); only the screen-up changes. A camera that sat on the new axis is nudged off the pole. */
export function switchUpAxis(cam: { position: THREE.Vector3; target: THREE.Vector3 }, up: UpAxis): CamState {
  const off = cam.position.clone().sub(cam.target);
  const dist = off.length() || 1;
  if (off.lengthSq() < 1e-12) off.set(1, 1, 1);
  const d = offPole(off.normalize().toArray() as V3, up);
  const dir = new THREE.Vector3(...d).normalize().multiplyScalar(dist);
  return { position: cam.target.clone().add(dir), target: cam.target.clone(), up: new THREE.Vector3(...upVector(up)) };
}

/** Which up axis a camera's up vector is closest to (for reading a camera back into a setting). */
export const upAxisOf = (camUp: THREE.Vector3): UpAxis => (Math.abs(camUp.z) > Math.abs(camUp.y) ? 'z' : 'y');

const EPS = 0.001;

/**
 * Rotate the camera rigidly about a pivot. `dTheta` turns about the vertical (screen-up in trackball mode, the world up
 * axis in turntable mode); `dPhi` tilts about the camera's right axis, positive moving the camera away from "up".
 * The signs are those of three's spherical coordinates, as OrbitControls uses. Turntable keeps `up` fixed and clamps the
 * tilt before the poles; trackball carries `up` along (roll is allowed) with no clamp.
 */
export function orbitCamera(
  cam: CamState, dTheta: number, dPhi: number, mode: OrbitMode, upAxis: UpAxis, pivot?: THREE.Vector3,
): CamState {
  const p = pivot ?? cam.target;
  const pos = cam.position.clone().sub(p);
  const tgt = cam.target.clone().sub(p);
  const worldUp = new THREE.Vector3(...upVector(upAxis));
  const up = (mode === 'turntable' ? worldUp : cam.up.clone()).normalize();
  // the offset used for the tilt is camera -> target direction, so the pole clamp holds when the pivot is off-centre
  const off = cam.position.clone().sub(cam.target);
  if (mode === 'turntable') {
    const cur = off.angleTo(up);
    dPhi = Math.max(EPS - cur, Math.min(Math.PI - EPS - cur, dPhi));
  }
  const q = new THREE.Quaternion().setFromAxisAngle(up, dTheta);
  const right = new THREE.Vector3().crossVectors(up, off.clone().applyQuaternion(q));
  if (right.lengthSq() < 1e-14) right.crossVectors(up, new THREE.Vector3(1, 0, 0));
  right.normalize();
  q.premultiply(new THREE.Quaternion().setFromAxisAngle(right, dPhi));
  const nextUp = mode === 'trackball' ? cam.up.clone().applyQuaternion(q).normalize() : worldUp;
  return { position: p.clone().add(pos.applyQuaternion(q)), target: p.clone().add(tgt.applyQuaternion(q)), up: nextUp };
}

/** The labels of the view cube faces in BoxGeometry order (+x, -x, +y, -y, +z, -z). */
export function cubeFaceLabels(up: UpAxis): string[] {
  return up === 'z' ? ['RIGHT', 'LEFT', 'BACK', 'FRONT', 'TOP', 'BOT'] : ['RIGHT', 'LEFT', 'TOP', 'BOT', 'FRONT', 'BACK'];
}

/** Ground grid placement: the horizontal plane of the up axis, at the part's lowest point. */
export function groundPlane(up: UpAxis, box: { min: number[]; max: number[] } | null): { ax: 0 | 1 | 2; bx: 0 | 1 | 2; level: number; ca: number; cb: number; size: number } {
  const [a, b, h] = up === 'z' ? ([0, 1, 2] as const) : ([0, 2, 1] as const);
  return {
    ax: a, bx: b,
    level: box ? box.min[h] : 0,
    ca: box ? (box.min[a] + box.max[a]) / 2 : 0,
    cb: box ? (box.min[b] + box.max[b]) / 2 : 0,
    size: box ? Math.max(box.max[a] - box.min[a], box.max[b] - box.min[b], 20) : 100,
  };
}
