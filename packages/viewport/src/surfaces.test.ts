import { describe, expect, it } from 'vitest';
import { mergeBodies, mergedBox, surfaceOwners, vertexTints, SURFACE_TINT, type ViewSurface } from './surfaces';
import { groupByFace, type BodyMesh } from './meshgeom';
import { applyBodyLook, makeBodyMaterial } from './styles';

const tri = (ids: string[], faceOfTri: number[], z = 0): BodyMesh => {
  const n = faceOfTri.length;
  const positions = new Float32Array(n * 9);
  for (let t = 0; t < n; t++) positions.set([0, 0, z + t, 1, 0, z + t, 0, 1, z + t], t * 9);
  return { positions, normals: new Float32Array(n * 9).fill(0.5), triFace: Int32Array.from(faceOfTri), faceIds: ids };
};
const solid = { mesh: tri(['A', 'B'], [0, 1]), edges: [{ key: 'A|B#0', pts: [[0, 0, 0], [1, 0, 0]] }] };
const sheet = (id: string): ViewSurface => ({ id, mesh: tri([`${id}.S.e1`, `${id}.S.e2`], [0, 1, 1], 10), edges: [{ key: `${id}.S.e1|${id}.S.e2#0`, pts: [[0, 0, 10], [1, 0, 10]] }], box: { min: [0, 0, 10], max: [1, 1, 12] } });

describe('mergeBodies', () => {
  it('a solid alone is returned as it is', () => {
    const m = mergeBodies(solid, []);
    expect(m.mesh).toBe(solid.mesh);
    expect(m.surfaceFaces.size).toBe(0);
  });
  it('puts the faces of surface bodies after the solid with shifted face indices', () => {
    const m = mergeBodies(solid, [sheet('F4')]);
    expect(m.mesh.faceIds).toEqual(['A', 'B', 'F4.S.e1', 'F4.S.e2']);
    expect([...m.mesh.triFace]).toEqual([0, 1, 2, 3, 3]);
    expect(m.mesh.positions.length).toBe(5 * 9);
    expect(m.mesh.positions[2 * 9 + 2]).toBe(10);   // the first sheet triangle follows the two solid ones
    expect(m.edges.map((e) => e.key)).toEqual(['A|B#0', 'F4.S.e1|F4.S.e2#0']);
    expect([...m.surfaceFaces].sort()).toEqual(['F4.S.e1', 'F4.S.e1|F4.S.e2#0', 'F4.S.e2']);
  });
  it('works with no solid at all (a part of sheets only)', () => {
    const m = mergeBodies(null, [sheet('F4'), sheet('F6')]);
    expect(m.mesh.faceIds).toEqual(['F4.S.e1', 'F4.S.e2', 'F6.S.e1', 'F6.S.e2']);
    expect([...m.mesh.triFace]).toEqual([0, 1, 1, 2, 3, 3]);
  });
  it('groups into one range per face, so picking names a sheet face', () => {
    const g = groupByFace(mergeBodies(solid, [sheet('F4')]).mesh);
    expect(g.ranges.map((r) => [r.name, r.count])).toEqual([['A', 3], ['B', 3], ['F4.S.e1', 3], ['F4.S.e2', 6]]);
  });
});

describe('mergedBox', () => {
  it('covers the solid and the sheets', () => {
    expect(mergedBox({ min: [0, 0, 0], max: [5, 5, 5] }, true, [sheet('F4')])).toEqual({ min: [0, 0, 0], max: [5, 5, 12] });
  });
  it('ignores the empty box of a part with no solid', () => {
    expect(mergedBox({ min: [0, 0, 0], max: [0, 0, 0] }, false, [sheet('F4')])).toEqual({ min: [0, 0, 10], max: [1, 1, 12] });
  });
  it('keeps the solid box when there are no sheets', () => {
    expect(mergedBox({ min: [1, 1, 1], max: [2, 2, 2] }, true, [])).toEqual({ min: [1, 1, 1], max: [2, 2, 2] });
  });
});

describe('tint and owners', () => {
  it('tints only the vertices of sheet faces', () => {
    const m = mergeBodies(solid, [sheet('F4')]);
    const g = groupByFace(m.mesh);
    const c = vertexTints(g.ranges, g.positions.length / 3, m.surfaceFaces);
    expect([c[0], c[1], c[2]]).toEqual([1, 1, 1]);                              // solid face A
    const first = g.ranges.find((r) => r.name === 'F4.S.e1')!.start * 3;
    [0, 1, 2].forEach((k) => expect(c[first + k]).toBeCloseTo(SURFACE_TINT[k], 6));
    expect(c.length).toBe(g.positions.length);
  });
  it('maps faces and edge keys to the owning surface body', () => {
    const o = surfaceOwners([sheet('F4'), sheet('F6')]);
    expect(o.get('F4.S.e2')).toBe('F4');
    expect(o.get('F6.S.e1|F6.S.e2#0')).toBe('F6');
    expect(o.get('A')).toBeUndefined();
  });
});

describe('material for tinted meshes', () => {
  const look = (style: 'shaded' | 'hiddenLines' | 'ghost' | 'wireframe') => ({ style, ghostOpacity: 0.4, appearance: { color: '#b8c4d6', material: 'default' as const } });
  it('uses vertex colours only when asked, and never in hidden-line white', () => {
    expect(makeBodyMaterial(look('shaded')).vertexColors).toBe(false);
    expect(makeBodyMaterial(look('shaded'), 1, true).vertexColors).toBe(true);
    const m = makeBodyMaterial(look('shaded'), 1, true);
    applyBodyLook(m, look('hiddenLines'), 1, true);
    expect(m.vertexColors).toBe(false);
    applyBodyLook(m, look('ghost'), 1, true);
    expect(m.vertexColors).toBe(true);
    expect(m.transparent).toBe(true);
  });
  it('is two-sided', () => { expect(makeBodyMaterial(look('shaded'), 1, true).side).toBe(2); });
});
