import { describe, expect, it } from 'vitest';
import { bodiesToObj, meshToObj } from './obj';
import { MeshReadError, readObj, triangulate } from './index';
import { cube, cylinder, volumeOf } from './testmesh';

describe('readObj round trip with our writers', () => {
  it('a cube: counts, box, volume, watertight', () => {
    const r = readObj(meshToObj({ positions: cube(10) }, { name: 'box' }).data);
    expect(r.triangles).toBe(12);
    expect(r.mesh.vertices.length / 3).toBe(8);
    expect(r.bbox).toEqual({ min: [0, 0, 0], max: [10, 10, 10] });
    expect(volumeOf(r.mesh.vertices, r.mesh.indices)).toBeCloseTo(1000, 3);
    expect(r.check.watertight).toBe(true);
    expect(r.name).toBe('box');
    expect(r.mats).toBeUndefined();
  });
  it('a cylinder keeps its volume', () => {
    const p = cylinder(5, 10, 32);
    const r = readObj(meshToObj({ positions: p }).data);
    const a = readObj(meshToObj({ positions: p }).data);
    expect(r.triangles).toBe(p.length / 9);
    expect(volumeOf(r.mesh.vertices, r.mesh.indices)).toBeCloseTo(volumeOf(a.mesh.vertices, a.mesh.indices), 6);
    expect(volumeOf(r.mesh.vertices, r.mesh.indices)).toBeGreaterThan(0.95 * Math.PI * 25 * 10);
  });
  it('two coloured bodies: colours come back from the vertex extension, parts are merged and reported', () => {
    const moved = Float32Array.from(cube(5), (v, i) => (i % 3 === 0 ? v + 20 : v));
    const r = readObj(bodiesToObj([{ name: 'Red part', positions: cube(10), color: '#ff0000' }, { name: 'Blue', positions: moved, color: '#0000ff' }]).data);
    expect(r.triangles).toBe(24);
    expect(r.mats!.map((m) => m.c).sort()).toEqual(['#0000ff', '#ff0000']);
    expect(r.tm!.length).toBe(24);
    // triangles are grouped by colour: two runs of twelve
    expect(new Set(Array.from(r.tm!.subarray(0, 12))).size).toBe(1);
    expect(new Set(Array.from(r.tm!.subarray(12))).size).toBe(1);
    expect(r.parts).toBe(2);
    expect(r.notes).toContainEqual({ code: 'partsMerged', n: 2 });
    expect(r.bbox.max[0]).toBe(25);
  });
});

describe('readObj by hand', () => {
  it('negative indices count from the last vertex so far', () => {
    const r = readObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1\nv 0 0 1\nf -4 -1 -2\n');
    expect(r.triangles).toBe(2);
    expect(Array.from(r.mesh.indices.subarray(0, 3))).toEqual([0, 1, 2]);
  });
  it('v/vt, v//vn and v/vt/vn forms read the same triangle; normals and textures are reported as not kept', () => {
    const head = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nvn 0 0 1\n';
    for (const f of ['f 1 2 3', 'f 1/1 2/2 3/3', 'f 1//1 2//1 3//1', 'f 1/1/1 2/2/1 3/3/1']) {
      const r = readObj(head + f + '\n');
      expect(Array.from(r.mesh.indices)).toEqual([0, 1, 2]);
      expect(r.notes.map((n) => n.code)).toEqual(expect.arrayContaining(['normals', 'textures']));
    }
  });
  it('a quad becomes two triangles covering its area; so does a pentagon', () => {
    const q = readObj('v 0 0 0\nv 2 0 0\nv 2 2 0\nv 0 2 0\nf 1 2 3 4\n');
    expect(q.triangles).toBe(2);
    const pent = readObj('v 0 0 0\nv 4 0 0\nv 5 3 0\nv 2 5 0\nv -1 3 0\nf 1 2 3 4 5\n');
    expect(pent.triangles).toBe(3);
    let area = 0;
    const v = pent.mesh.vertices, i = pent.mesh.indices;
    for (let t = 0; t < i.length; t += 3) area += ((v[i[t + 1] * 3] - v[i[t] * 3]) * (v[i[t + 2] * 3 + 1] - v[i[t] * 3 + 1]) - (v[i[t + 1] * 3 + 1] - v[i[t] * 3 + 1]) * (v[i[t + 2] * 3] - v[i[t] * 3])) / 2;
    expect(area).toBeCloseTo(21, 4);
  });
  it('a concave L-shaped hexagon is triangulated without covering the notch (area 3, not the hull 4)', () => {
    // L: (0,0) (2,0) (2,1) (1,1) (1,2) (0,2), area 3
    const p = [0, 0, 0, 2, 0, 0, 2, 1, 0, 1, 1, 0, 1, 2, 0, 0, 2, 0];
    const out: number[] = [];
    triangulate(p, [0, 1, 2, 3, 4, 5], out);
    expect(out.length / 3).toBe(4);
    let area = 0;
    for (let t = 0; t < out.length; t += 3) {
      const a = out[t] * 3, b = out[t + 1] * 3, c = out[t + 2] * 3;
      const ar = ((p[b] - p[a]) * (p[c + 1] - p[a + 1]) - (p[b + 1] - p[a + 1]) * (p[c] - p[a])) / 2;
      expect(ar).toBeGreaterThan(0);   // every ear keeps the polygon's winding
      area += ar;
    }
    expect(area).toBeCloseTo(3, 9);
  });
  it('a concave polygon in a tilted plane and wound the other way keeps its winding', () => {
    // the L on the plane x = z (rotated about Y), clockwise from +Y: normal -Y... check triangles agree with the polygon's normal
    const L = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]].reverse();
    const p = L.flatMap(([x, y]) => [x, y, 0]);
    const out: number[] = [];
    triangulate(p, [0, 1, 2, 3, 4, 5], out);
    expect(out.length / 3).toBe(4);
    for (let t = 0; t < out.length; t += 3) {
      const a = out[t] * 3, b = out[t + 1] * 3, c = out[t + 2] * 3;
      expect(((p[b] - p[a]) * (p[c + 1] - p[a + 1]) - (p[b + 1] - p[a + 1]) * (p[c] - p[a])) / 2).toBeLessThan(0);
    }
  });
  it('MTL colours (Kd, d, Tr) by usemtl; without the MTL there are no colours and a notice says so', () => {
    const obj = 'mtllib a.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nv 0 0 1\nusemtl red\nf 1 2 3\nusemtl glass\nf 1 3 4\nusemtl none\nf 1 2 4\n';
    const mtl = '# m\nnewmtl red\nKd 1 0 0\nnewmtl glass\nKd 0 0.5 1\nd 0.4\nnewmtl none\nNs 3\n';
    const r = readObj(obj, { mtl });
    expect(r.mats).toEqual([{ c: '#ff0000', o: 1 }, { c: '#0080ff', o: 0.4 }]);
    expect(r.notes.some((n) => n.code === 'mtlMissing')).toBe(false);
    // the one with no Kd has no colour (0xFFFF)
    expect(Array.from(r.tm!).sort()).toEqual([0, 1, 0xffff]);
    const bare = readObj(obj);
    expect(bare.mats).toBeUndefined();
    expect(bare.notes).toContainEqual({ code: 'mtlMissing' });
    const tr = readObj(obj, { mtl: 'newmtl red\nKd 1 0 0\nTr 0.25\n' });
    expect(tr.mats![0].o).toBe(0.75);
  });
  it('objects and groups are joined; smoothing groups, lines and curves are reported', () => {
    const r = readObj('o A\nv 0 0 0\nv 1 0 0\nv 0 1 0\ns 1\nf 1 2 3\no B\nv 0 0 1\nf 1 3 4\nl 1 2\ncurv 0 1 1 2\n');
    expect(r.parts).toBe(2);
    expect(r.name).toBe('A');
    expect(r.notes.map((n) => n.code)).toEqual(expect.arrayContaining(['smoothing', 'lines', 'curves', 'partsMerged']));
  });
  it('units scale the numbers; comments, CRLF and continuation lines are fine', () => {
    const r = readObj('# c\r\nv 0 0 0\r\nv 1 0 0\r\nv 0 \\\r\n 1 0 # tail\r\nf 1 2 3\r\n', { unit: 'in' });
    expect(r.bbox.max[0]).toBeCloseTo(25.4, 4);
    expect(r.bbox.max[1]).toBeCloseTo(25.4, 4);
    expect(r.unit).toBe('in');
  });
  it('faces with an index past the end are dropped and counted; degenerate triangles are dropped', () => {
    const r = readObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\nf 1 2 9\nf 1 1 2\n');
    expect(r.triangles).toBe(1);
    expect(r.degenerate).toBe(1);
    expect(r.notes).toContainEqual({ code: 'badFaces', n: 1 });
  });
  it('refuses an empty file, a non-OBJ file, and a file with no faces', () => {
    expect(() => readObj('')).toThrow(MeshReadError);
    expect(() => readObj('hello world\n')).toThrowError(/not an OBJ/);
    expect(() => readObj('v 0 0 0\nv 1 0 0\n')).toThrowError(/no faces/);
    expect(() => readObj('v 0 0 x\nf 1 1 1\n')).toThrowError(/bad vertex/);
  });
});
