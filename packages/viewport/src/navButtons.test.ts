import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { navButtons, wheelFactor, zoomAbout, zoomedDistance } from './navButtons';

describe('mouse navigation', () => {
  it('in the model the middle button orbits like the left one and the right button pans', () => {
    expect(navButtons(false)).toEqual({ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN });
  });
  it('in a sketch the left button is left to the tools; middle pans, right turns the view', () => {
    expect(navButtons(true)).toMatchObject({ MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE });
    expect(navButtons(true).LEFT).toBe(-1);
  });
  it('Ctrl+middle drag up zooms in, down zooms out, within the limits', () => {
    expect(zoomedDistance(100, -50)).toBeLessThan(100);
    expect(zoomedDistance(100, 50)).toBeGreaterThan(100);
    expect(zoomedDistance(100, -1e6, 5)).toBe(5);
    expect(zoomedDistance(100, 1e6, 1, 400)).toBe(400);
  });
});

describe('sketch wheel zoom', () => {
  it('scrolling up zooms in, down out, by a bounded smooth step', () => {
    expect(wheelFactor(-100)).toBeLessThan(1);
    expect(wheelFactor(100)).toBeGreaterThan(1);
    expect(wheelFactor(100)).toBeCloseTo(1 / wheelFactor(-100), 9);
    expect(wheelFactor(1e6)).toBe(wheelFactor(200));         // a flung wheel is one bounded step
    expect(wheelFactor(3, 1)).toBeCloseTo(wheelFactor(48, 0), 9);   // lines
    expect(wheelFactor(-5, 0, true)).toBeLessThan(wheelFactor(-5, 0, false));   // pinch is faster
  });
  it('keeps the anchor under the pointer: it stays on the same line from the camera', () => {
    const cam = new THREE.Vector3(10, 20, 100), tgt = new THREE.Vector3(10, 20, 0), anchor = new THREE.Vector3(40, -5, 0);
    const z = zoomAbout(cam, tgt, anchor, 0.5);
    expect(z.position.distanceTo(z.target)).toBeCloseTo(50, 9);
    // anchor, new camera and the old camera-anchor direction are collinear
    const d0 = cam.clone().sub(anchor).normalize(), d1 = z.position.clone().sub(anchor).normalize();
    expect(d0.distanceTo(d1)).toBeLessThan(1e-9);
  });
  it('never goes below the minimum or above the maximum distance, and zooming back and forth returns', () => {
    const cam = new THREE.Vector3(0, 0, 100), tgt = new THREE.Vector3(0, 0, 0), a = new THREE.Vector3(3, 4, 0);
    expect(zoomAbout(cam, tgt, a, 1e-9, 0.5).position.distanceTo(tgt)).toBeGreaterThan(0);
    const z = zoomAbout(cam, tgt, a, 1e-9, 0.5);
    expect(z.position.distanceTo(z.target)).toBeCloseTo(0.5, 9);
    const o = zoomAbout(cam, tgt, a, 1e9, 0.5, 1000);
    expect(o.position.distanceTo(o.target)).toBeCloseTo(1000, 6);
    const there = zoomAbout(cam, tgt, a, 0.8), back = zoomAbout(there.position, there.target, a, 1.25);
    expect(back.position.distanceTo(cam)).toBeLessThan(1e-9);
  });
});
