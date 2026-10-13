import { describe, expect, it } from 'vitest';
import { zoneOf } from './viewcube';

describe('view cube zones', () => {
  it('the middle of a face snaps to that face', () => {
    expect(zoneOf({ x: 0.75, y: 0.1, z: -0.2 })).toEqual([1, 0, 0]);
    expect(zoneOf({ x: -0.1, y: -0.75, z: 0.3 })).toEqual([0, -1, 0]);
    expect(zoneOf({ x: 0, y: 0, z: 0.75 })).toEqual([0, 0, 1]);
  });
  it('near an edge it snaps to a two-axis diagonal, near a corner to a three-axis one', () => {
    expect(zoneOf({ x: 0.7, y: 0.6, z: 0.1 })).toEqual([1, 1, 0]);
    expect(zoneOf({ x: -0.7, y: 0.6, z: 0.7 })).toEqual([-1, 1, 1]);
  });
  it('an inner point reaches no zone', () => {
    expect(zoneOf({ x: 0.2, y: -0.3, z: 0.1 })).toEqual([0, 0, 0]);
  });
});
