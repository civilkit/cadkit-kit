import { describe, expect, it } from 'vitest';
import { V, type Vec3 } from './handles';
import {
  axisDistance, moveFrame, planeMove, reaim, rotateVec, snapTo, spinAngle, triGeometry, triHit, WORLD_AXES, type Axes3, type TriFrame, type TriScreen,
} from './triball';

// A screen looking down -Z with X to the right and Y up: 2 px per unit, centre (400, 300).
const top: TriScreen = { project: (p) => [400 + p[0] * 2, 300 - p[1] * 2], worldPerPx: () => 0.5 };
// The same, slightly oblique so that Z shows too (it recedes up and to the left).
const scr: TriScreen = { project: (p) => [400 + (p[0] - 0.5 * p[2]) * 2, 300 - (p[1] + 0.3 * p[2]) * 2], worldPerPx: () => 0.5 };
const frame: TriFrame = { origin: [0, 0, 0], axes: WORLD_AXES };
const det = (a: Axes3) => V.dot(a[0], V.cross(a[1], a[2]));

describe('ball geometry', () => {
  const g = triGeometry(frame, scr)!;
  it('puts the end dots on the ring along each projected axis, and the squares 17 px inside them', () => {
    expect(g.c).toEqual([400, 300]);
    expect(g.ends[0][0]).toBeCloseTo(495); expect(g.ends[0][1]).toBeCloseTo(300);
    expect(g.ends[1][0]).toBeCloseTo(400); expect(g.ends[1][1]).toBeCloseTo(205);
    expect(g.minus[0][0]).toBeCloseTo(305);
    expect(g.squareCentres[0][0]).toBeCloseTo(495 - 17);
  });
  it('an axis pointing at the camera still gets a dot on the ring (a fallback direction) and a visible stub', () => {
    const t = triGeometry(frame, top)!;
    expect(Math.hypot(t.ends[2][0] - 400, t.ends[2][1] - 300)).toBeCloseTo(95);
    expect(Math.hypot(t.stubs[2][0] - 400, t.stubs[2][1] - 300)).toBeGreaterThanOrEqual(9 - 1e-9);
  });
  it('the square of an axis is spanned by the other two (the X square foreshortens to a line when X lies in the screen and Y too: it is a full square)', () => {
    const sq = g.squares[2];                       // perpendicular to Z: spanned by X and Y, a true square on this screen
    const w = Math.hypot(sq[0][0] - sq[1][0], sq[0][1] - sq[1][1]);
    expect(w).toBeCloseTo(38);
  });
  it('is null behind the camera', () => {
    expect(triGeometry(frame, { ...scr, project: () => null })).toBeNull();
  });
});

describe('hit testing', () => {
  const g = triGeometry(frame, scr)!;
  const hit = (p: [number, number], axis: number | null = null, off?: Parameters<typeof triHit>[1]['off']) => triHit(g, { axis, off }, p);
  it('finds each handle and respects the order centre > stub > end dot > plane > ring', () => {
    expect(hit([400, 300])).toEqual({ kind: 'centre' });
    expect(hit(g.stubs[0])).toEqual({ kind: 'stub', axis: 0 });
    expect(hit(g.ends[1])).toEqual({ kind: 'end', axis: 1, sign: 1 });
    expect(hit(g.squareCentres[0])).toEqual({ kind: 'plane', axis: 0 });
    expect(hit([400 + 130, 300 + 40])).toBeNull();           // outside the ring, off every handle
    expect(hit([400, 300 + 95])).toEqual({ kind: 'ring' });  // the ring itself
  });
  it('the minus dot and the interior only exist with an axis selected', () => {
    expect(hit(g.minus[0])).toEqual({ kind: 'ring' });       // only the ring is there without a selection
    expect(hit(g.minus[0], 0)).toEqual({ kind: 'end', axis: 0, sign: -1 });
    expect(hit([400 + 20, 300 + 60])).toBeNull();
    expect(hit([400 + 20, 300 + 60], 1)).toEqual({ kind: 'inner' });
  });
  it('switched-off handles are not hit', () => {
    expect(hit(g.ends[0], null, { axes: [false, true, true] })).toEqual({ kind: 'ring' });   // the dot is off: what is left under it is the ring
    expect(hit(g.squareCentres[1], null, { planes: [true, false, true] })).toBeNull();
    expect(hit([400, 300 + 95], null, { rotate: true })).toBeNull();
  });
});

describe('drag maths', () => {
  const ray = (x: number, y: number) => ({ o: [x, y, 100] as Vec3, d: [0, 0, -1] as Vec3 });
  it('an axis drag reads the distance along the axis from two rays', () => {
    expect(axisDistance(ray(0, 0), ray(7, 3), [0, 0, 0], [1, 0, 0])).toBeCloseTo(7);
    expect(axisDistance(ray(0, 0), ray(7, 3), [0, 0, 0], V.norm([1, 1, 0]))).toBeCloseTo(7 * Math.SQRT1_2 + 3 * Math.SQRT1_2);
    expect(axisDistance(ray(0, 0), ray(-4, 0), [0, 0, 0], [1, 0, 0])).toBeCloseTo(-4);
  });
  it('an axis that points at the camera falls back to the screen, projected on the axis', () => {
    expect(axisDistance(ray(0, 0), ray(5, 0), [0, 0, 0], [0, 0, 1], { delta: [10, 0], s: [0.5, 0] })).toBeCloseTo(20);   // 10 px at half a pixel per unit
    expect(axisDistance(ray(0, 0), ray(5, 0), [0, 0, 0], [0, 0, 1])).toBe(0);
  });
  it('a plane drag is the move of the pointer ray on the plane', () => {
    expect(planeMove(ray(0, 0), ray(3, -2), [0, 0, 0], [0, 0, 1])).toEqual([3, -2, 0]);
    expect(planeMove(ray(0, 0), ray(3, -2), [0, 0, 0], [1, 0, 0])).toBeNull();     // edge-on
  });
  it('a spin is positive counter-clockwise looking at the axis tip, on either side of the camera', () => {
    const c: [number, number] = [400, 300];
    const ccw = spinAngle(c, [500, 300], [400, 200], [0, 0, 1], [0, 0, 1]);        // screen up from the right = counter-clockwise
    expect(ccw).toBeCloseTo(90);
    expect(spinAngle(c, [500, 300], [400, 200], [0, 0, -1], [0, 0, 1])).toBeCloseTo(-90);   // the axis points away from the camera
    expect(spinAngle(c, [500, 300], [400, 400], [0, 0, 1], [0, 0, 1])).toBeCloseTo(-90);
  });
  it('a spin never jumps across the branch cut', () => {
    // the pointer goes from just below the left of the centre to just above it: a small clockwise turn on screen (y is down)
    const a = spinAngle([0, 0], [-10, 1], [-10, -1], [0, 0, 1], [0, 0, 1]);
    expect(a).toBeLessThan(0);
    expect(Math.abs(a)).toBeLessThan(20);
  });
  it('snaps to the increment on both signs and leaves a zero step alone', () => {
    expect(snapTo(23, 10)).toBe(20); expect(snapTo(-26, 10)).toBe(-30); expect(snapTo(7.4, 15)).toBe(0); expect(snapTo(8, 15)).toBe(15); expect(snapTo(3.3, 0)).toBe(3.3);
  });
});

describe('frame algebra', () => {
  it('re-aiming any handle keeps an orthonormal right-handed set and puts that handle on the direction', () => {
    const dirs: Vec3[] = [[0, 0, 1], [1, 1, 1], [-0.2, 0.9, 0.1], [1, 0, 0], [0, -1, 0]];
    for (const i of [0, 1, 2] as const) for (const d of dirs) {
      const a = reaim(WORLD_AXES, i, d);
      expect(det(a)).toBeCloseTo(1, 9);
      expect(V.dot(a[0], a[1])).toBeCloseTo(0, 9); expect(V.dot(a[1], a[2])).toBeCloseTo(0, 9); expect(V.dot(a[0], a[2])).toBeCloseTo(0, 9);
      const n = V.norm(d);
      for (let k = 0; k < 3; k++) expect(a[i][k]).toBeCloseTo(n[k], 9);
    }
  });
  it('re-aiming along an existing axis, or a skewed one, still works', () => {
    const skew = reaim(WORLD_AXES, 0, V.norm([1, 2, 3]));
    const again = reaim(skew, 2, V.norm([-1, 0, 1]));
    expect(det(again)).toBeCloseTo(1, 9);
    expect(V.len(again[1])).toBeCloseTo(1, 9);
  });
  it('rotates a vector right-handed, and carries the frame with a moved body', () => {
    const r = rotateVec([1, 0, 0], [0, 0, 1], 90);
    expect(r[0]).toBeCloseTo(0, 9); expect(r[1]).toBeCloseTo(1, 9);
    const f = moveFrame({ origin: [10, 0, 0], axes: WORLD_AXES }, { axis: [0, 0, 1], origin: [0, 0, 0], angle: 90 }, [0, 0, 5]);
    expect(f.origin[0]).toBeCloseTo(0, 9); expect(f.origin[1]).toBeCloseTo(10, 9); expect(f.origin[2]).toBeCloseTo(5, 9);
    expect(f.axes[0][1]).toBeCloseTo(1, 9);
    expect(det(f.axes)).toBeCloseTo(1, 9);
    expect(moveFrame(frame, null, [1, 2, 3]).origin).toEqual([1, 2, 3]);
  });
});
