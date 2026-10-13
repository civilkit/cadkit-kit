import { describe, it, expect } from 'vitest';
import { groupByFace, faceOfVertexIndex, edgeSegments } from './meshgeom';

const tri = (z: number) => [0, 0, z, 1, 0, z, 0, 1, z];
const mesh = {
  positions: new Float32Array([...tri(0), ...tri(1), ...tri(2)]),
  normals: new Float32Array(27),
  triFace: new Int32Array([1, 0, 1]),
  faceIds: ['F2.C0', 'F2.C1'],
};

describe('groupByFace', () => {
  it('makes each face one contiguous range', () => {
    const g = groupByFace(mesh);
    expect(g.ranges).toEqual([
      { name: 'F2.C0', start: 0, count: 3 },
      { name: 'F2.C1', start: 3, count: 6 },
    ]);
  });
  it('maps a vertex index back to its face', () => {
    const g = groupByFace(mesh);
    expect(faceOfVertexIndex(g, 1)).toBe('F2.C0');
    expect(faceOfVertexIndex(g, 8)).toBe('F2.C1');
    expect(faceOfVertexIndex(g, 99)).toBeNull();
  });
  it('copes with an empty mesh', () => {
    const g = groupByFace({ positions: new Float32Array(0), normals: new Float32Array(0), triFace: new Int32Array(0), faceIds: [] });
    expect(g.ranges).toEqual([]);
  });
});

describe('edgeSegments', () => {
  it('turns a polyline of n points into n-1 segments', () => {
    const s = edgeSegments([{ pts: [[0, 0, 0], [1, 0, 0], [1, 1, 0]] }]);
    expect(Array.from(s)).toEqual([0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0]);
  });
});