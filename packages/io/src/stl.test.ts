import { describe, expect, it } from 'vitest';
import { cube } from './testmesh';
import { checkMesh, facetNormal, meshToObj, meshToStl, parseStl, weld } from './index';

describe('checkMesh', () => {
  it('a cube is watertight with 8 vertices and consistent edges', () => {
    const c = checkMesh({ positions: cube() });
    expect(c).toMatchObject({ triangles: 12, vertices: 8, openEdges: 0, nonManifoldEdges: 0, inconsistentEdges: 0, degenerate: 0, watertight: true });
  });
  it('a missing triangle opens three edges', () => {
    const c = checkMesh({ positions: cube().subarray(9) });
    expect(c.openEdges).toBe(3);
    expect(c.watertight).toBe(false);
  });
  it('a flipped triangle is reported as inconsistent', () => {
    const p = Float32Array.from(cube());
    for (let k = 0; k < 3; k++) { const t = p[3 + k]; p[3 + k] = p[6 + k]; p[6 + k] = t; }
    expect(checkMesh({ positions: p }).inconsistentEdges).toBeGreaterThan(0);
  });
  it('welds vertices that differ by float noise', () => {
    const p = Float32Array.from(cube());
    p[0] += 1e-7;
    expect(weld(p).verts.length / 3).toBe(8);
  });
  it('an empty mesh is not watertight', () => expect(checkMesh({ positions: [] }).watertight).toBe(false));
});

describe('STL', () => {
  it('binary: size, count, header, normals and round trip', () => {
    const r = meshToStl({ positions: cube(10) }, { name: 'Bracket 1' });
    const d = r.data as Uint8Array;
    expect(d.length).toBe(84 + 12 * 50);
    expect(new DataView(d.buffer).getUint32(80, true)).toBe(12);
    expect(new TextDecoder().decode(d.subarray(0, 5))).not.toBe('solid');
    expect(r.check.watertight).toBe(true);
    const back = parseStl(d);
    expect(back.name).toBe('Bracket 1');
    expect(Array.from(back.positions)).toEqual(Array.from(cube(10)));
    expect(Array.from(back.normals.subarray(0, 3))).toEqual([0, 0, -1]);
    expect(Array.from(back.normals.subarray(12, 15))).toEqual([0, -1, 0]);
  });
  it('ASCII: keywords, solid name, round trip', () => {
    const r = meshToStl({ positions: cube(2.5) }, { name: 'Plate', binary: false });
    const s = r.data as string;
    expect(s.startsWith('solid Plate\n')).toBe(true);
    expect(s.trimEnd().endsWith('endsolid Plate')).toBe(true);
    expect(s.match(/facet normal/g)).toHaveLength(12);
    expect(s).toContain('facet normal 0 0 -1');
    const back = parseStl(s);
    expect(back.name).toBe('Plate');
    expect(Array.from(back.positions)).toEqual(Array.from(cube(2.5)));
  });
  it('an ASCII file is not mistaken for binary and vice versa', () => {
    expect(parseStl(meshToStl({ positions: cube() }, { binary: false }).data).positions.length).toBe(108);
    expect(parseStl(meshToStl({ positions: cube() }).data).positions.length).toBe(108);
  });
  it('names with odd characters are made safe', () => {
    const s = meshToStl({ positions: cube() }, { name: 'Schraube Ø8\nx', binary: false }).data as string;
    expect(s.split('\n')[0]).toBe('solid Schraube _8 x');
  });
  it('reports an open mesh but still writes it', () => {
    const r = meshToStl({ positions: cube().subarray(9) });
    expect(r.triangles).toBe(11);
    expect(r.check.openEdges).toBe(3);
  });
  it('facetNormal of a degenerate triangle is zero', () => expect(facetNormal([0, 0, 0, 1, 0, 0, 2, 0, 0], 0)).toEqual([0, 0, 0]));
});

describe('OBJ', () => {
  it('welds to 8 vertices and 12 faces with 1-based indices', () => {
    const r = meshToObj({ positions: cube(3) }, { name: 'My Part' });
    const lines = r.data.trim().split('\n');
    expect(lines[1]).toBe('o My_Part');
    expect(lines.filter((l) => l.startsWith('v '))).toHaveLength(8);
    const faces = lines.filter((l) => l.startsWith('f '));
    expect(faces).toHaveLength(12);
    expect(faces.flatMap((f) => f.slice(2).split(' ').map(Number)).every((i) => i >= 1 && i <= 8)).toBe(true);
  });
});
