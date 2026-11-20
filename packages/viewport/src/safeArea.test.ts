import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Viewport } from './viewport';
import { clampInsets, fitLimit, insetShift, NO_INSETS, safeCenter } from './safeArea';

describe('safe area maths', () => {
  it('the free-area centre of a 2000 px canvas with a 385 px panel is x = 1192.5', () => {
    expect(safeCenter({ left: 385, right: 0, top: 0, bottom: 0 }, 2000, 1000)).toEqual({ x: 1192.5, y: 500 });
    expect(insetShift({ left: 385, right: 0, top: 0, bottom: 0 })).toEqual({ x: 192.5, y: 0 });
  });
  it('no insets: the canvas centre, no shift, and the old fit limit min(1, aspect)', () => {
    expect(insetShift(NO_INSETS)).toEqual({ x: 0, y: 0 });
    expect(fitLimit(NO_INSETS, 2000, 1000)).toBe(1);
    expect(fitLimit(NO_INSETS, 500, 1000)).toBe(0.5);
  });
  it('fit uses the free width when the panels make it the narrow side', () => {
    expect(fitLimit({ left: 1500, right: 0, top: 0, bottom: 0 }, 2000, 1000)).toBe(0.5);
  });
  it('clamps negatives, NaN and insets that would cover the whole canvas', () => {
    expect(clampInsets({ left: -5, right: NaN }, 800, 600)).toEqual(NO_INSETS);
    const c = clampInsets({ left: 900, right: 100 }, 800, 600);
    expect(c.left + c.right).toBeLessThanOrEqual(799.0001);
  });
});

// A bare viewport with just a perspective camera and the fields view-offset code touches (the real class needs WebGL).
type Bare = Record<string, unknown> & { setSafeInsets(i: object, animate?: boolean): void; safeInsetsNow(): object; fit(): void };
const bare = (w: number, h: number): Bare => {
  const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 10000);
  camera.position.set(60, 50, 60);
  const controls = { target: new THREE.Vector3(), update: () => { camera.lookAt(controls.target); } };
  const v = Object.create(Viewport.prototype) as Bare;
  Object.assign(v, { camera, controls, host: { clientWidth: w, clientHeight: h }, dirty: false, anim: null, edges: [], insets: { ...NO_INSETS }, shown: { x: 0, y: 0 }, tween: null,
    center: () => new THREE.Vector3(0, 0, 0), radius: () => 20, updateClip() { camera.updateProjectionMatrix(); }, sketchEdit: null });
  camera.lookAt(0, 0, 0);
  return v;
};
const screenX = (v: Bare, w: number) => { (v.camera as THREE.PerspectiveCamera).updateMatrixWorld(true); const p = new THREE.Vector3(0, 0, 0).project(v.camera as THREE.PerspectiveCamera); return ((p.x + 1) / 2) * w; };

describe('Viewport safe insets', () => {
  it('the orbit target projects to the canvas centre with no insets', () => {
    const v = bare(2000, 1000);
    v.setSafeInsets({ left: 0, right: 0, top: 0, bottom: 0 }, false);
    expect(screenX(v, 2000)).toBeCloseTo(1000, 3);
    expect((v.camera as THREE.PerspectiveCamera).view?.enabled ?? false).toBe(false);
  });
  it('with left = 385 the orbit target projects to the centre of the free area, and the target itself did not move', () => {
    const v = bare(2000, 1000);
    v.setSafeInsets({ left: 385, right: 0, top: 0, bottom: 0 }, false);
    expect(screenX(v, 2000)).toBeCloseTo(1192.5, 3);
    expect((v.controls as { target: THREE.Vector3 }).target.length()).toBe(0);
    const p = new THREE.Vector3(0, 0, 0).project(v.camera as THREE.PerspectiveCamera);
    expect(((1 - p.y) / 2) * 1000).toBeCloseTo(500, 3);   // vertically unchanged
  });
  it('left and right insets centre between them; clearing the insets restores the canvas centre', () => {
    const v = bare(2000, 1000);
    v.setSafeInsets({ left: 400, right: 200, top: 0, bottom: 0 }, false);
    expect(screenX(v, 2000)).toBeCloseTo(1100, 3);
    v.setSafeInsets({ left: 0, right: 0, top: 0, bottom: 0 }, false);
    expect(screenX(v, 2000)).toBeCloseTo(1000, 3);
  });
  it('fit frames into the free width: a narrower free area backs the camera off', () => {
    const v = bare(1000, 1000);
    v.fit();
    const d0 = (v.camera as THREE.PerspectiveCamera).position.length();
    v.setSafeInsets({ left: 500, right: 0, top: 0, bottom: 0 }, false);
    v.fit();
    const d1 = (v.camera as THREE.PerspectiveCamera).position.length();
    expect(d1 / d0).toBeCloseTo(2, 3);
  });
});
