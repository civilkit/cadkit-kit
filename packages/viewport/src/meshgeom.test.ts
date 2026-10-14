import { describe, it, expect } from 'vitest';
import { groupByFace, faceOfVertexIndex, edgeSegments, facesGeometry, namesBox } from './meshgeom';

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
describe('facesGeometry and namesBox', () => {
  const g = groupByFace({
    positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 5, 5, 6, 5, 5, 5, 6, 5]),
    normals: new Float32Array(18), triFace: Int32Array.from([0, 1]), faceIds: ['A', 'B'],
  });
  it('collects only the named faces', () => {
    expect(facesGeometry(g, ['B']).positions).toEqual([5, 5, 5, 6, 5, 5, 5, 6, 5]);
    expect(facesGeometry(g, ['X']).positions).toEqual([]);
  });
  it('boxes faces and edges, null for unknown names', () => {
    expect(namesBox(g, [], ['A'])).toEqual({ min: [0, 0, 0], max: [1, 1, 0] });
    expect(namesBox(g, [{ key: 'A|B#1', pts: [[0, 0, 0], [9, 0, 0]] }], ['B', 'A|B#1'])).toEqual({ min: [0, 0, 0], max: [9, 6, 5] });
    expect(namesBox(g, [], ['nope'])).toBeNull();
    expect(namesBox(null, [], ['A'])).toBeNull();
  });
});

import { nameOwner, withoutOwned } from './meshgeom';

describe('nameOwner / withoutOwned (feature hide)', () => {
  it('reads the feature id from face and edge names', () => {
    expect(nameOwner('F5.S.e1')).toBe('F5');
    expect(nameOwner('F12.C1')).toBe('F12');
    expect(nameOwner('F5.C1|F5.C2#0')).toBe('F5');
    expect(nameOwner('F5')).toBe('F5');
    expect(nameOwner('vertex:1,2,3')).toBeNull();
  });
  it('drops the triangles and edges a hidden feature made and keeps the rest', () => {
    const m = { positions: new Float32Array([...tri(0), ...tri(1), ...tri(2)]), normals: new Float32Array(27), triFace: new Int32Array([1, 0, 1]), faceIds: ['F2.C0', 'F7.C1'] };
    const edges = [{ key: 'F2.C0|F7.C1#0', pts: [[0, 0, 0]] }, { key: 'F7.C1|F7.C2#0', pts: [[1, 1, 1]] }, { pts: [[2, 2, 2]] }];
    const r = withoutOwned(m, edges, new Set(['F7']));
    expect(Array.from(r.mesh.triFace)).toEqual([0]);
    expect(r.mesh.positions.length).toBe(9);
    expect(Array.from(r.mesh.positions)).toEqual(tri(1));
    expect(r.edges.map((e) => e.key)).toEqual(['F2.C0|F7.C1#0', undefined]);
    expect(withoutOwned(m, edges, new Set(['F9'])).mesh).toBe(m);
  });
});
