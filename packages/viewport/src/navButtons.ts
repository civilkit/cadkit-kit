// Mouse navigation of the 3D view, as pure data and arithmetic so it is tested without WebGL.
import * as THREE from 'three';

type Buttons = { LEFT: THREE.MOUSE; MIDDLE: THREE.MOUSE; RIGHT: THREE.MOUSE };

/**
 * Which drag does what. In the model: left and middle orbit, right pans (a right click without movement is the context
 * menu); with Shift the OrbitControls swap orbit and pan, so Shift+middle pans; Ctrl+middle zooms (see `zoomedDistance`).
 * In a sketch the left button picks and rubber-bands, so the right button turns the view and the middle one pans.
 */
export function navButtons(sketching: boolean): Buttons {
  return sketching
    ? { LEFT: -1 as never, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }
    : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
}

/** The camera-to-target distance after a Ctrl+middle drag of `dy` pixels (a drag up, dy < 0, moves in). */
export function zoomedDistance(len: number, dy: number, min = 1e-3, max = Infinity): number {
  return Math.min(Math.max(len * Math.exp(dy * 0.008), min), max);
}

/** The distance factor of one wheel event (< 1 zooms in). Line and page deltas are scaled to pixels, one event moves at most ~ a quarter of the distance (a flung wheel stays controllable), and a trackpad pinch (browsers send it as Ctrl+wheel with small deltas) is made faster. */
export function wheelFactor(deltaY: number, deltaMode = 0, pinch = false): number {
  const px = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1);
  const d = Math.max(-200, Math.min(200, px)) * (pinch ? 0.01 : 0.0015);
  return Math.exp(d);
}

/** Zoom by `factor` about a fixed point: both the camera and the target move towards (factor < 1) or away from `anchor` by that factor, so the point stays under the same pixel (the sketch plane point under the pointer). */
export function zoomAbout(position: THREE.Vector3, target: THREE.Vector3, anchor: THREE.Vector3, factor: number, minDist = 1e-2, maxDist = 1e7): { position: THREE.Vector3; target: THREE.Vector3 } {
  const len = position.distanceTo(target);
  let f = factor;
  if (len * f < minDist) f = minDist / len;
  if (len * f > maxDist) f = maxDist / len;
  return {
    position: anchor.clone().add(position.clone().sub(anchor).multiplyScalar(f)),
    target: anchor.clone().add(target.clone().sub(anchor).multiplyScalar(f)),
  };
}
