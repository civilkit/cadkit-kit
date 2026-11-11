import { describe, expect, it } from 'vitest';
import { cube, headLike } from './testmesh';
import { meshToStl, readStl, StlError, checkMesh, buildBvh, raycast, closestPoint, meshBox, indexMesh, checkIndexed } from './index';

const binary = (p: Float32Array) => meshToStl({ positions: p }).data as Uint8Array;
const ascii = (p: Float32Array) => meshToStl({ positions: p }, { binary: false, name: 'part' }).data as string;

describe('readStl', () => {
  it('reads binary: 12 triangles, 8 welded vertices, bounding box, watertight', () => {
    const r = readStl(binary(cube(10)));
    expect(r.format).toBe('binary');
    expect(r.triangles).toBe(12);
    expect(r.mesh.vertices.length / 3).toBe(8);
    expect(r.bbox).toEqual({ min: [0, 0, 0], max: [10, 10, 10] });
    expect(r.check).toMatchObject({ watertight: true, openEdges: 0, inconsistentEdges: 0 });
    expect(r.warnings).toEqual([]);
  });
  it('reads ASCII to the same mesh as the binary file', () => {
    const a = readStl(new TextEncoder().encode(ascii(cube(3))));
    const b = readStl(binary(cube(3)));
    expect(a.format).toBe('ascii');
    expect(a.name).toBe('part');
    expect(Array.from(a.mesh.indices)).toEqual(Array.from(b.mesh.indices));
    expect(Array.from(a.mesh.vertices)).toEqual(Array.from(b.mesh.vertices));
  });
  it('ASCII: exponents, signs, CRLF and several solids', () => {
    const txt = 'solid a\r\nfacet normal 0 0 1\r\nouter loop\r\nvertex 0 0 0\r\nvertex 1.5e1 -0 0\r\nvertex 0 +2.5E+0 1e-1\r\nendloop\r\nendfacet\r\nendsolid a\r\n' +
      'solid b\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 0 2.5 0.1\nvertex -3 0 0\nendloop\nendfacet\nendsolid b\n';
    const r = readStl(new TextEncoder().encode(txt));
    expect(r.triangles).toBe(2);
    expect(r.bbox.max).toEqual([15, 2.5, Math.fround(0.1)]);
    expect(r.bbox.min[0]).toBe(-3);
  });
  it('a binary file whose header starts with "solid" is still binary', () => {
    const d = binary(cube(1));
    d.set(new TextEncoder().encode('solid exported by a tool'), 0);
    const r = readStl(d);
    expect(r.format).toBe('binary');
    expect(r.triangles).toBe(12);
  });
  it('units scale the coordinates to millimetres', () => {
    const p = cube(1);
    expect(readStl(binary(p), { unit: 'cm' }).bbox.max).toEqual([10, 10, 10]);
    expect(readStl(binary(p), { unit: 'in' }).bbox.max).toEqual([25.4, 25.4, 25.4].map(Math.fround));
    expect(readStl(binary(p), { unit: 'm' }).bbox.max).toEqual([1000, 1000, 1000]);
    expect(readStl(binary(p), { unit: 'mm' }).bbox.max).toEqual([1, 1, 1]);
  });
  it('drops degenerate triangles and says so', () => {
    const p = Float32Array.from([...cube(1), 0, 0, 0, 0, 0, 0, 1, 1, 1, 5, 5, 5, 5, 5, 5, 6, 6, 6]);
    const r = readStl(binary(p));
    expect(r.fileTriangles).toBe(14);
    expect(r.triangles).toBe(12);
    expect(r.degenerate).toBe(2);
    expect(r.warnings).toContain('degenerate');
    expect(r.check.watertight).toBe(true);
  });
  it('reports an open mesh', () => {
    const r = readStl(binary(cube(1).subarray(9)));
    expect(r.triangles).toBe(11);
    expect(r.check.watertight).toBe(false);
    expect(r.check.openEdges).toBe(3);
  });
  it('a truncated binary file keeps the whole triangles it has and warns', () => {
    const d = binary(cube(1));
    const r = readStl(d.subarray(0, 84 + 50 * 5 + 20));
    expect(r.triangles).toBe(5);
    expect(r.warnings).toContain('truncated');
  });
  it('trailing bytes after the declared triangles are noted', () => {
    const d = binary(cube(1));
    const longer = new Uint8Array(d.length + 7); longer.set(d);
    expect(readStl(longer).warnings).toContain('trailingBytes');
  });
  it('malformed input throws StlError with a code', () => {
    const code = (f: () => unknown): string => { try { f(); } catch (e) { return (e as StlError).code; } return 'none'; };
    expect(code(() => readStl(new Uint8Array(0)))).toBe('empty');
    expect(code(() => readStl(new Uint8Array(40)))).toBe('tooShort');
    expect(code(() => readStl(new TextEncoder().encode('solid x\nendsolid x\n')))).toBe('noFacets');
    expect(code(() => readStl(new TextEncoder().encode('solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 abc\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid\n')))).toBe('badNumber');
    const nan = binary(cube(1)); new DataView(nan.buffer).setFloat32(84 + 12, NaN, true);
    expect(code(() => readStl(nan))).toBe('badNumber');
    const zero = new Uint8Array(84); expect(code(() => readStl(zero))).toBe('noFacets');
    const flat = Float32Array.from([0, 0, 0, 0, 0, 0, 1, 1, 1]);
    expect(code(() => readStl(binary(flat)))).toBe('allDegenerate');
  });
  it('indexMesh welds -0 and +0 and equal corners across triangles', () => {
    const { mesh } = indexMesh(Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, -0, 0, 0, 0, 1, 0, 0, 0, 1]));
    expect(mesh.vertices.length / 3).toBe(4);
  });
  it('checkIndexed agrees with checkMesh', () => {
    const p = cube(1);
    const r = readStl(binary(p));
    expect(checkIndexed(r.mesh.indices, 8)).toEqual({ ...checkMesh({ positions: p }) });
  });
});

describe('mesh BVH', () => {
  const head = readStl(binary(headLike(60, 60)));
  const bvh = buildBvh(head.mesh);
  it('the head-like mesh is closed', () => expect(head.check.watertight).toBe(true));
  it('a ray from outside hits the surface near the expected point and the normal faces back', () => {
    const h = raycast(bvh, [0, 500, 0], [0, -1, 0])!;
    expect(h).not.toBeNull();
    expect(h.point[1]).toBeGreaterThan(80);
    expect(h.point[1]).toBeLessThan(140);   // the nose pushes the front out
    expect(h.normal[1]).toBeGreaterThan(0.5);
    expect(h.t).toBeCloseTo(500 - h.point[1], 3);
  });
  it('a ray that misses returns null; maxT cuts it', () => {
    expect(raycast(bvh, [0, 500, 400], [0, -1, 0])).toBeNull();
    expect(raycast(bvh, [0, 500, 0], [0, -1, 0], 10)).toBeNull();
  });
  it('matches a brute force cast for many rays', () => {
    const { vertices: V, indices: I } = head.mesh;
    const brute = (o: number[], d: number[]): number => {
      let best = Infinity;
      for (let t = 0; t < I.length / 3; t++) {
        const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
        const e1 = [V[b] - V[a], V[b + 1] - V[a + 1], V[b + 2] - V[a + 2]], e2 = [V[c] - V[a], V[c + 1] - V[a + 1], V[c + 2] - V[a + 2]];
        const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
        const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
        if (Math.abs(det) < 1e-18) continue;
        const s = [o[0] - V[a], o[1] - V[a + 1], o[2] - V[a + 2]];
        const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) / det;
        if (u < 0 || u > 1) continue;
        const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
        const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det;
        if (v < 0 || u + v > 1) continue;
        const tt = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
        if (tt >= 0 && tt < best) best = tt;
      }
      return best;
    };
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < 200; k++) {
      const o = [(rnd() - 0.5) * 600, (rnd() - 0.5) * 600, (rnd() - 0.5) * 600];
      const tgt = [(rnd() - 0.5) * 120, (rnd() - 0.5) * 120, (rnd() - 0.5) * 120];
      const d = [tgt[0] - o[0], tgt[1] - o[1], tgt[2] - o[2]];
      const h = raycast(bvh, o as never, d as never);
      const want = brute(o, d);
      if (want === Infinity) expect(h).toBeNull(); else expect(h!.t).toBeCloseTo(want, 6);
    }
  });
  it('closest point lies on the surface and agrees with brute force distance', () => {
    const box = meshBox(head.mesh);
    expect(box.max[2]).toBeGreaterThan(95);
    const c = closestPoint(bvh, [0, 0, 300])!;
    expect(c.point[2]).toBeGreaterThan(95);
    expect(c.dist).toBeCloseTo(300 - c.point[2], 3);
    const inside = closestPoint(bvh, [0, 0, 0])!;
    expect(inside.dist).toBeGreaterThan(60);
    expect(closestPoint(bvh, [0, 0, 300], 10)).toBeNull();
    // a point on the surface is its own closest point
    const h = raycast(bvh, [30, 500, 20], [0, -1, 0])!;
    expect(closestPoint(bvh, h.point)!.dist).toBeLessThan(1e-3);
  });
  it('an empty mesh answers null', () => {
    const e = buildBvh({ vertices: new Float32Array(0), indices: new Uint32Array(0) });
    expect(raycast(e, [0, 0, 0], [0, 0, 1])).toBeNull();
    expect(closestPoint(e, [0, 0, 0])).toBeNull();
  });
});

describe('performance', () => {
  it('500k triangles: read, weld, check and build the BVH in a few seconds; a ray cast is fast', () => {
    const soup = headLike(500, 500);
    const n = soup.length / 9;
    const file = new Uint8Array(84 + n * 50);
    const dv = new DataView(file.buffer);
    dv.setUint32(80, n, true);
    for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) dv.setFloat32(84 + t * 50 + 12 + k * 4, soup[t * 9 + k], true);
    expect(file.length).toBeGreaterThan(24_000_000);
    const t0 = performance.now();
    const r = readStl(file);
    const t1 = performance.now();
    const bvh = buildBvh(r.mesh);
    const t2 = performance.now();
    expect(r.triangles).toBeGreaterThan(495_000);
    expect(r.check.watertight).toBe(true);
    let hits = 0;
    const t3 = performance.now();
    for (let k = 0; k < 500; k++) if (raycast(bvh, [(k % 25) * 4 - 50, 500, (k / 25 | 0) * 6 - 60], [0, -1, 0])) hits++;
    const t4 = performance.now();
    expect(hits).toBeGreaterThan(300);
    console.log(`read ${(t1 - t0).toFixed(0)} ms, bvh ${(t2 - t1).toFixed(0)} ms, 500 rays ${(t4 - t3).toFixed(0)} ms`);
    expect(t2 - t0).toBeLessThan(6000);
    expect(t4 - t3).toBeLessThan(500);
  }, 30000);
});
