import { describe, it, expect } from 'vitest';
import {
  planeCoords, planeToWorld, rayPlane, nearestSketchPoint,
  sketchEditPolylines, sketchPointWorld,
} from './sketchedit';
import type { Frame } from './layers';

const FRONT: Frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const FRONT_UP: Frame = { o: [10, 20, 30], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
// A tilted plane: normal along +x, in-plane axes y and z.
const SIDE: Frame = { o: [5, 0, 0], x: [0, 1, 0], y: [0, 0, 1], z: [1, 0, 0] };

describe('planeCoords / planeToWorld', () => {
  it('projects a world point to plane coordinates through the frame', () => {
    expect(planeCoords(FRONT, [3, 4, 99])).toEqual([3, 4]);
    expect(planeCoords(FRONT_UP, [13, 24, 123])).toEqual([3, 4]);
    expect(planeCoords(SIDE, [5, 7, 9])).toEqual([7, 9]);
  });

  it('planeToWorld is the inverse of planeCoords', () => {
    const w = planeToWorld(FRONT_UP, 3, 4);
    expect(planeCoords(FRONT_UP, w)).toEqual([3, 4]);
    const w2 = planeToWorld(SIDE, 7, 9);
    expect(planeCoords(SIDE, w2)).toEqual([7, 9]);
  });
});

describe('rayPlane', () => {
  it('intersects a ray heading at the plane', () => {
    // Straight down the +z axis at (3, 4): hits the front plane at u=3, v=4.
    expect(rayPlane([3, 4, 10], [0, 0, -1], FRONT)).toEqual([3, 4]);
  });

  it('works for an oblique ray and a offset plane', () => {
    const hit = rayPlane([13, 24, 40], [0, 0, -1], FRONT_UP);
    expect(hit).not.toBeNull();
    expect(hit![0]).toBeCloseTo(3, 9);
    expect(hit![1]).toBeCloseTo(4, 9);
  });

  it('works for a side plane (normal along x)', () => {
    const hit = rayPlane([20, 7, 9], [-1, 0, 0], SIDE);
    expect(hit![0]).toBeCloseTo(7, 9);
    expect(hit![1]).toBeCloseTo(9, 9);
  });

  it('a ray parallel to the plane misses', () => {
    expect(rayPlane([0, 0, 10], [1, 0, 0], FRONT)).toBeNull();
  });
});

describe('nearestSketchPoint', () => {
  const pts = [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 100, y: 0 },
    { id: 'c', x: 100, y: 80 },
  ];

  it('picks the closest point inside the radius', () => {
    expect(nearestSketchPoint(3, 1, pts, 10)).toBe('a');
    expect(nearestSketchPoint(95, 5, pts, 10)).toBe('b');
    expect(nearestSketchPoint(103, 77, pts, 10)).toBe('c');
  });

  it('returns null when nothing is close enough', () => {
    expect(nearestSketchPoint(50, 50, pts, 10)).toBeNull();
  });
});

describe('sketchEditPolylines / sketchPointWorld', () => {
  const sketch = {
    points: [
      { id: 'O', x: 0, y: 0 },
      { id: 'p1', x: 10, y: 0 },
      { id: 'p2', x: 10, y: 10 },
    ],
    entities: [
      { id: 'e1', type: 'line', p1: 'O', p2: 'p1' },
      { id: 'e2', type: 'line', p1: 'p1', p2: 'p2' },
    ],
  };

  it('draws the solved entities in world space through the frame', () => {
    const polys = sketchEditPolylines(sketch, FRONT_UP);
    expect(polys).toHaveLength(2);
    expect(polys[0]).toEqual([[10, 20, 30], [20, 20, 30]]);
    expect(polys[1]).toEqual([[20, 20, 30], [20, 30, 30]]);
  });

  it('splits solid and construction entities (construction is drawn dashed by the viewport)', () => {
    const mixed = { ...sketch, entities: [sketch.entities[0], { ...sketch.entities[1], construction: true }] };
    expect(sketchEditPolylines(mixed, FRONT_UP, 'solid')).toEqual([[[10, 20, 30], [20, 20, 30]]]);
    expect(sketchEditPolylines(mixed, FRONT_UP, 'construction')).toEqual([[[20, 20, 30], [20, 30, 30]]]);
    expect(sketchEditPolylines(mixed, FRONT_UP)).toHaveLength(2);
  });

  it('gives world positions for every point', () => {
    const world = sketchPointWorld(sketch.points, FRONT);
    expect(world).toEqual([
      { id: 'O', xyz: [0, 0, 0] },
      { id: 'p1', xyz: [10, 0, 0] },
      { id: 'p2', xyz: [10, 10, 0] },
    ]);
  });
});

import { viewSide } from './sketchedit';

describe('viewSide', () => {
  const frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
  it('looks from the side facing away from the body', () => {
    expect(viewSide(frame, [0, 0, -10])).toBe(1);    // body behind the plane: look from the front
    expect(viewSide(frame, [0, 0, 10])).toBe(-1);    // body in front of the plane: look from behind it
  });
  it('uses the plane normal with no body or a plane through the body', () => {
    expect(viewSide(frame, null)).toBe(1);
    expect(viewSide(frame, [5, 5, 0])).toBe(1);
  });
});
