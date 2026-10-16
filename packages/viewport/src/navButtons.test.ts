import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { navButtons, zoomedDistance } from './navButtons';

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
