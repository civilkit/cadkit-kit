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
