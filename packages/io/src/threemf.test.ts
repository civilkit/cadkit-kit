import { describe, expect, it } from 'vitest';
import { cube, cylinder } from './testmesh';
import { checkMesh, crc32, meshToGlb, meshToThreeMf, parseGlb, parseThreeMf, zipRead, zipWrite } from './index';

const volume = (p: ArrayLike<number>) => {
  let v = 0;
  for (let t = 0; t < p.length; t += 9) v += (p[t] * (p[t + 4] * p[t + 8] - p[t + 5] * p[t + 7]) - p[t + 1] * (p[t + 3] * p[t + 8] - p[t + 5] * p[t + 6]) + p[t + 2] * (p[t + 3] * p[t + 7] - p[t + 4] * p[t + 6])) / 6;
  return v;
};
const bounds = (p: ArrayLike<number>) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[i + a]); hi[a] = Math.max(hi[a], p[i + a]); }
  return { lo, hi };
};

describe('zip', () => {
  it('crc32 of "123456789" is cbf43926', () => expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926));
  it('round trips stored and deflated entries', async () => {
    const big = new TextEncoder().encode('abc'.repeat(5000));
    const files = [{ name: 'a.txt', data: new TextEncoder().encode('hi') }, { name: 'dir/b.txt', data: big }];
    for (const deflate of [false, true]) {
      const z = await zipWrite(files, { deflate });
      const back = await zipRead(z);
      expect(back.map((f) => f.name)).toEqual(['a.txt', 'dir/b.txt']);
      expect(Array.from(back[1].data)).toEqual(Array.from(big));
      if (deflate) expect(z.length).toBeLessThan(big.length / 4);
    }
  });
  it('detects a corrupted entry', async () => {
    const z = await zipWrite([{ name: 'a', data: new TextEncoder().encode('hello world') }], { deflate: false });
    z[30 + 1 + 2] ^= 0xff;
    await expect(zipRead(z)).rejects.toThrow(/corrupt/);
  });
});

describe('3MF', () => {
  it('a cube: millimetres, 12 triangles, 8 vertices, bounds and volume survive', async () => {
    const r = await meshToThreeMf([{ name: 'Cube', positions: cube(10) }], { title: 'Cube' });
    expect(r).toMatchObject({ triangles: 12, vertices: 8, bodies: 1 });
    const back = await parseThreeMf(r.data);
    expect(back.unit).toBe('millimeter');
    expect(back.build).toEqual([2]);
    expect(back.objects).toHaveLength(1);
    const o = back.objects[0];
    expect(o.name).toBe('Cube');
    expect(o.color).toBeNull();
    expect(o.positions.length / 9).toBe(12);
    expect(checkMesh({ positions: o.positions })).toMatchObject({ vertices: 8, watertight: true, inconsistentEdges: 0 });
    expect(bounds(o.positions)).toEqual({ lo: [0, 0, 0], hi: [10, 10, 10] });
    expect(volume(o.positions)).toBeCloseTo(1000, 6);
  });
  it('a cylinder: volume equals the polygonal prism, still watertight', async () => {
    const n = 48, r0 = 5, h = 12;
    const r = await meshToThreeMf([{ name: 'Pin', positions: cylinder(r0, h, n) }]);
    const o = (await parseThreeMf(r.data)).objects[0];
    expect(r.triangles).toBe(n * 4);
    expect(checkMesh({ positions: o.positions }).watertight).toBe(true);
    expect(volume(o.positions)).toBeCloseTo(0.5 * n * r0 * r0 * Math.sin((2 * Math.PI) / n) * h, 3);
    const b = bounds(o.positions);
    expect(b.lo[2]).toBe(0); expect(b.hi[2]).toBe(h);
    expect(b.hi[0]).toBeCloseTo(r0, 5);
  });
  it('one object per body, colours and opacity on base materials, XML in names escaped', async () => {
    const r = await meshToThreeMf([
      { name: 'Red & <co>', positions: cube(2), color: '#ff0000' },
      { name: 'Plain', positions: cube(3) },
      { name: 'Glass', positions: cube(4), color: '#0080ff', opacity: 0.5 },
    ]);
    expect(r.bodies).toBe(3);
    const back = await parseThreeMf(r.data);
    expect(back.objects.map((o) => o.name)).toEqual(['Red & <co>', 'Plain', 'Glass']);
    expect(back.objects.map((o) => o.color)).toEqual(['#FF0000FF', null, '#0080FF80']);
    expect(back.build).toEqual([2, 3, 4]);
    expect(volume(back.objects[2].positions)).toBeCloseTo(64, 6);
  });
  it('is deterministic and also works stored', async () => {
    const a = await meshToThreeMf([{ name: 'c', positions: cube() }]);
    const b = await meshToThreeMf([{ name: 'c', positions: cube() }]);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
    const s = await meshToThreeMf([{ name: 'c', positions: cube() }], { deflate: false });
    expect((await parseThreeMf(s.data)).objects[0].positions.length).toBe(108);
  });
  it('skips empty bodies', async () => {
    const r = await meshToThreeMf([{ name: 'none', positions: [] }, { name: 'c', positions: cube() }]);
    expect(r.bodies).toBe(1);
  });
});

describe('GLB', () => {
  it('header, JSON chunk and BIN chunk are valid and 4-byte aligned', () => {
    const r = meshToGlb([{ name: 'Cube', positions: cube(10) }]);
    const dv = new DataView(r.data.buffer);
    expect(new TextDecoder().decode(r.data.subarray(0, 4))).toBe('glTF');
    expect(dv.getUint32(4, true)).toBe(2);
    expect(dv.getUint32(8, true)).toBe(r.data.length);
    expect(r.data.length % 4).toBe(0);
    expect(new TextDecoder().decode(r.data.subarray(16, 20))).toBe('JSON');
    const g = parseGlb(r.data);   // throws on any chunk fault
    expect(g.json.asset.version).toBe('2.0');
    expect(g.json.buffers[0].byteLength).toBe(g.bin.length);
    for (const v of g.json.bufferViews) expect(v.byteOffset % 4).toBe(0);
  });
  it('a cube: counts, indices in range, Y-up metres bounds', () => {
    const r = meshToGlb([{ name: 'Cube', positions: cube(10) }]);
    expect(r.triangles).toBe(12);
    expect(r.vertices).toBe(24);   // a cube has 3 distinct normals per corner
    const b = parseGlb(r.data).bodies[0];
    expect(b.indices.length).toBe(36);
    expect(Math.max(...b.indices)).toBe(23);
    // Z-up cube [0,10]^3 mm becomes x [0, .01], y (was z) [0, .01], z (was -y) [-.01, 0]
    expect(b.min.map((v) => +v.toFixed(6) + 0)).toEqual([0, 0, -0.01]);
    expect(b.max.map((v) => +v.toFixed(6))).toEqual([0.01, 0.01, 0]);
    expect(Math.abs(b.min[0]) + Math.abs(b.min[1])).toBe(0);
  });
  it('converts Z up to Y up: the top face (+z) normal becomes +y, and winding stays outward', () => {
    const g = parseGlb(meshToGlb([{ name: 'Cube', positions: cube(10) }]).data).bodies[0];
    const c = [0.005, 0.005, -0.005];
    for (let t = 0; t < g.indices.length; t += 3) {
      const i = [g.indices[t], g.indices[t + 1], g.indices[t + 2]];
      const P = i.map((v) => [g.positions[v * 3], g.positions[v * 3 + 1], g.positions[v * 3 + 2]]);
      const u = P[1].map((v, k) => v - P[0][k]), w = P[2].map((v, k) => v - P[0][k]);
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const mid = P[0].map((v, k) => (v + P[1][k] + P[2][k]) / 3 - c[k]);
      expect(n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2]).toBeGreaterThan(0);   // geometric normal points away from the centre
      const vn = [g.normals[i[0] * 3], g.normals[i[0] * 3 + 1], g.normals[i[0] * 3 + 2]];
      expect(vn[0] * n[0] + vn[1] * n[1] + vn[2] * n[2]).toBeGreaterThan(0);          // stored normal agrees with the winding
    }
    // the top (z = 10 mm) vertices sit at y = 0.01 and carry normal +y
    let tops = 0;
    for (let v = 0; v < g.positions.length / 3; v++) if (Math.abs(g.positions[v * 3 + 1] - 0.01) < 1e-9 && Math.abs(g.normals[v * 3 + 1] - 1) < 1e-6) tops++;
    expect(tops).toBe(4);
  });
  it('a cylinder along Z stands along Y; its extent is the height in metres', () => {
    const r = meshToGlb([{ name: 'Pin', positions: cylinder(5, 12, 32) }]);
    const b = parseGlb(r.data).bodies[0];
    expect(b.min[1]).toBe(0);
    expect(b.max[1]).toBeCloseTo(0.012, 7);
    expect(b.max[0]).toBeCloseTo(0.005, 7);
    expect(b.min[2]).toBeCloseTo(-0.005, 7);
    // signed volume of the indexed mesh, in m3
    const P = b.positions; let vol = 0;
    for (let t = 0; t < b.indices.length; t += 3) {
      const a = b.indices[t] * 3, c = b.indices[t + 1] * 3, d = b.indices[t + 2] * 3;
      vol += (P[a] * (P[c + 1] * P[d + 2] - P[c + 2] * P[d + 1]) - P[a + 1] * (P[c] * P[d + 2] - P[c + 2] * P[d]) + P[a + 2] * (P[c] * P[d + 1] - P[c + 1] * P[d])) / 6;
    }
    expect(vol * 1e9).toBeCloseTo(0.5 * 32 * 25 * Math.sin((2 * Math.PI) / 32) * 12, 2);
  });
  it('uses supplied normals to share vertices on a smooth surface', () => {
    const p = cube(10);
    const flat = meshToGlb([{ name: 'a', positions: p }]);
    const up = new Float32Array(p.length); for (let i = 2; i < up.length; i += 3) up[i] = 1;   // every normal +z
    expect(meshToGlb([{ name: 'a', positions: p, normals: up }]).vertices).toBe(8);
    expect(flat.vertices).toBe(24);
  });
  it('one node, mesh and material per body, with colours in linear space', () => {
    const r = meshToGlb([
      { name: 'Red', positions: cube(2), color: '#ff0000', metallic: 1, roughness: 0.2 },
      { name: 'Glass', positions: cube(3), color: '#808080', opacity: 0.5 },
      { name: 'Plain', positions: cube(4) },
    ], { name: 'Asm' });
    const g = parseGlb(r.data);
    expect(g.json.scenes[0]).toMatchObject({ name: 'Asm', nodes: [0, 1, 2] });
    expect(g.bodies.map((b) => b.name)).toEqual(['Red', 'Glass', 'Plain']);
    expect(g.bodies[0].material.pbrMetallicRoughness).toMatchObject({ baseColorFactor: [1, 0, 0, 1], metallicFactor: 1, roughnessFactor: 0.2 });
    const grey = g.bodies[1].material.pbrMetallicRoughness.baseColorFactor;
    expect(grey[0]).toBeCloseTo(0.2158, 3);   // sRGB 128 is 0.2158 linear
    expect(grey[3]).toBe(0.5);
    expect(g.bodies[1].material.alphaMode).toBe('BLEND');
    expect(g.bodies[2].material.pbrMetallicRoughness.metallicFactor).toBe(0);
    expect(g.bodies[2].max[1]).toBeCloseTo(0.004, 7);
  });
  it('rejects a damaged file', () => {
    const r = meshToGlb([{ name: 'c', positions: cube() }]).data;
    expect(() => parseGlb(r.subarray(0, r.length - 4))).toThrow();
    const bad = r.slice(); bad[0] = 0; expect(() => parseGlb(bad)).toThrow(/magic/);
  });
});
