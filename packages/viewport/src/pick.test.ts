import { describe, it, expect } from 'vitest';
import { pickFace, nearestEdge } from './pick';
import { groupByFace } from './meshgeom';

const mesh = {
  positions: new Float32Array([0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0]),
  normals: new Float32Array(18),
  triFace: new Int32Array([0, 0, 1]),
  faceIds: ['F2.C0'],
};

describe('pickFace', () => {
  it('maps a triangle hit to its face name', () => {
    const g = groupByFace(mesh);
    expect(pickFace(g, { faceIndex: 0 })).toBe('F2.C0');
    expect(pickFace(g, { faceIndex: 99 })).toBeNull();
  });
});

describe('nearestEdge', () => {
  it('picks the closest edge segment index', () => {
    const edges = [{ pts: [[0, 0, 0], [10, 0, 0], [10, 10, 0]] }];
    const pick = nearestEdge(edges, [0.01, 0, 0], 1);
    expect(pick).toBe(0);
  });
  it('returns null when point is far outside tolerance', () => {
    const edges = [{ pts: [[0, 0, 0], [10, 0, 0], [10, 10, 0]] }];
    const pick = nearestEdge(edges, [100, 100, 0], 1);
    expect(pick).toBeNull();
  });
});