import { describe, expect, it } from 'vitest';
import { resolveEdges, resolveFace, SelectorError, type Geometry } from './selectors';

// a unit cube 0..2 as 12 triangles; face ids by normal
const cube = (): Geometry => {
  const faces: Array<[string, number[], number[][]]> = [
    ['top', [0, 0, 1], [[0, 0, 2], [2, 0, 2], [2, 2, 2], [0, 0, 2], [2, 2, 2], [0, 2, 2]]],
    ['bot', [0, 0, -1], [[0, 0, 0], [2, 2, 0], [2, 0, 0], [0, 0, 0], [0, 2, 0], [2, 2, 0]]],
  ];
  const positions: number[] = [], normals: number[] = [], triFace: number[] = [];
  faces.forEach(([, n, tri], fi) => { tri.forEach((v) => { positions.push(...v); normals.push(...n); }); triFace.push(fi * 2, fi * 2 + 1); });
  // triFace holds an index per triangle into faceIds
  const tf = [0, 0, 1, 1];
  void triFace;
  return {
    mesh: { positions, normals, triFace: tf, faceIds: ['F2.top', 'F2.bot'] },
    edges: [
      { key: 'a', faces: ['F2.top', 'S1'], mid: [1, 0, 2], pts: [[0, 0, 2], [2, 0, 2]] },
      { key: 'b', faces: ['S1', 'S2'], mid: [0, 0, 1], pts: [[0, 0, 0], [0, 0, 2]] },
    ],
    box: { min: [0, 0, 0], max: [2, 2, 2] },
  };
};
describe('selectors', () => {
  it('picks faces by direction', () => {
    expect(resolveFace('>Z', cube()).id).toBe('F2.top');
    expect(resolveFace('<Z', cube()).id).toBe('F2.bot');
    expect(resolveFace('#top', cube()).id).toBe('F2.top');
  });
  it('rejects unsupported and impossible faces with the line', () => {
    expect(() => resolveFace('~Z', cube(), 7)).toThrow(SelectorError);
    try { resolveFace('>X', cube(), 7); } catch (e) { expect((e as SelectorError).line).toBe(7); }
  });
  it('picks edges parallel to or lying on an axis', () => {
    expect(resolveEdges('|Z', cube()).map((e) => e.at)).toEqual([[0, 0, 1]]);
    expect(resolveEdges('>Z', cube()).map((e) => e.at)).toEqual([[1, 0, 2]]);
    expect(resolveEdges('all', cube())).toHaveLength(2);
    expect(() => resolveEdges('|Y', cube(), 3)).toThrow(/no edge/);
  });
});
