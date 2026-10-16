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

// ---- face rules, picks and the ambiguity warning on a synthetic plate + boss ----
import { faceInfos, matchFaces, resolveFaceSel, resolveFacesSel, ownerOf, type FaceSel } from './selectors';
import { face, faces } from './recorder';

const plateBoss = (): Geometry => {
  const positions: number[] = [], normals: number[] = [], triFace: number[] = [];
  const ids: string[] = [];
  const tri = (fi: number, n: number[], a: number[], b: number[], c: number[]) => { for (const v of [a, b, c]) { positions.push(...v); normals.push(...n); } triFace.push(fi); };
  const quad = (fi: number, n: number[], p: number[][]) => { tri(fi, n, p[0], p[1], p[2]); tri(fi, n, p[0], p[2], p[3]); };
  ids.push('F2.C1'); quad(0, [0, 0, 1], [[-30, -20, 10], [30, -20, 10], [30, 20, 10], [-30, 20, 10]]);   // plate top 60 x 40
  ids.push('F2.C0'); quad(1, [0, 0, -1], [[-30, -20, 0], [-30, 20, 0], [30, 20, 0], [30, -20, 0]]);
  ids.push('F4.C1'); { const n = 24, r = 12; for (let i = 0; i < n; i++) { const a0 = (2 * Math.PI * i) / n, a1 = (2 * Math.PI * (i + 1)) / n; tri(2, [0, 0, 1], [0, 0, 25], [r * Math.cos(a0), r * Math.sin(a0), 25], [r * Math.cos(a1), r * Math.sin(a1), 25]); } }
  ids.push('F4.S.c1'); { const n = 24, r = 12; for (let i = 0; i < n; i++) { const a0 = (2 * Math.PI * i) / n, a1 = (2 * Math.PI * (i + 1)) / n; const p = (a: number, z: number) => [r * Math.cos(a), r * Math.sin(a), z]; const nn = (a: number) => [Math.cos(a), Math.sin(a), 0]; for (const [a, b, c] of [[p(a0, 10), p(a1, 10), p(a1, 25)], [p(a0, 10), p(a1, 25), p(a0, 25)]]) { for (const v of [a, b, c]) { positions.push(...v); const ang = Math.atan2(v[1], v[0]); normals.push(...nn(ang)); } triFace.push(3); } } }
  return { mesh: { positions, normals, triFace, faceIds: ids }, edges: [], box: null };
};
describe('face rules', () => {
  const g = plateBoss();
  it('fits plane / cylinder kinds with radius and names the owner feature', () => {
    const f = faceInfos(g.mesh!);
    const cyl = f.find((x) => x.id === 'F4.S.c1')!;
    expect(cyl.kind).toBe('cylinder');
    expect(cyl.radius).toBeCloseTo(12, 3);
    expect(f.find((x) => x.id === 'F2.C1')!.kind).toBe('plane');
    expect(ownerOf('F8.C0@F10.1')).toBe('F10');
    expect(ownerOf('F4.S.c1')).toBe('F4');
  });
  it('face(">Z") returns the boss top and warns because the plate top faces the same way', () => {
    const w: string[] = [];
    const fs = face('>Z');
    expect(resolveFaceSel(fs, g, (m) => w.push(m)).id).toBe('F4.C1');
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/resolved to F4\.C1 \(feature F4.*F2\.C1 \(feature F2\).*\{of: \.\.\.\}/);
  });
  it('{of} chooses the feature and silences the warning; a name selects exactly', () => {
    const w: string[] = [];
    expect(resolveFaceSel(face('>Z', { of: 'F2' }), g, (m) => w.push(m)).id).toBe('F2.C1');
    expect(resolveFaceSel(face('>Z', { of: { id: 'F4' } }), g, (m) => w.push(m)).id).toBe('F4.C1');
    expect(resolveFaceSel(face('F2.C0'), g).id).toBe('F2.C0');
    expect(w).toEqual([]);
    expect(() => face('F2.C9') && resolveFaceSel(face('F2.C9', {}), g)).toThrow(/no such face/);
    expect(() => resolveFaceSel(face('>Z', { of: { id: null } }), g)).toThrow(/not resolved yet/);
  });
  it('rules AND their keys; several matches are an error unless a pick is given', () => {
    expect(resolveFaceSel(face({ kind: 'cylinder', radius: 12 }), g).id).toBe('F4.S.c1');
    expect(resolveFaceSel(face({ normal: [0, 0, 1], areaLess: 1000 }), g).id).toBe('F4.C1');
    expect(resolveFaceSel(face({ at: [0, 0, 10], normal: [0, 0, 1] }), g).id).toBe('F2.C1');
    expect(() => resolveFaceSel(face({ planar: true }), g)).toThrow(/matches 3 faces/);
    expect(resolveFaceSel(faces({ planar: true }).largest(), g).id).toBe('F2.C1');
    expect(resolveFaceSel(faces({ planar: true }).smallest(), g).id).toBe('F4.C1');
    expect(resolveFaceSel(faces({ planar: true }).near([0, 0, 24]), g).id).toBe('F4.C1');
    expect(resolveFaceSel(faces('>Z').nth(1), g).id).toBe('F4.C1');
    expect(resolveFacesSel(faces({ createdBy: 'F4' }), g).map((f) => f.id).sort()).toEqual(['F4.C1', 'F4.S.c1']);
  });
  it('combines and negates like edge rules', () => {
    const plateTop: FaceSel = face('>Z', { of: 'F2' });
    const m = (r: Parameters<typeof matchFaces>[0]) => matchFaces(r, undefined, g, faceInfos(g.mesh!), 0).map((f) => f.id).sort();
    expect(m({ planar: true, not: plateTop })).toEqual(['F2.C0', 'F4.C1']);
    expect(m({ union: [plateTop, face('F4.C1')] })).toEqual(['F2.C1', 'F4.C1']);
    expect(m({ planar: true, intersect: [faces('>Z')] })).toEqual(['F2.C1', 'F4.C1']);
    expect(m({ difference: [faces({ planar: true }), faces('<Z')] })).toEqual(['F2.C1', 'F4.C1']);
  });
});
