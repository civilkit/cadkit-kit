import { describe, expect, it } from 'vitest';
import { headLike, cube } from './testmesh';
import { indexMesh } from './stlRead';
import { canDeflate, checksumBytes, decodeMesh, deflateRaw, encodeMesh, gridStep, inflateRaw, MeshPackError } from './meshPack';

const headMesh = (n: number) => indexMesh(headLike(n, n)).mesh;

describe('meshPack', () => {
  it('round trip: indices and materials exact, vertices within half a grid step', () => {
    const m = headMesh(60);
    const tm = new Uint16Array(m.indices.length / 3).map((_, t) => (t < 100 ? 0 : t < 5000 ? 3 : 0xffff));
    const { payload, stats } = encodeMesh({ ...m, tm });
    expect(stats.lossless).toBe(false);
    const back = decodeMesh(payload);
    expect(Array.from(back.indices)).toEqual(Array.from(m.indices));
    expect(Array.from(back.tm!)).toEqual(Array.from(tm));
    expect(back.vertices.length).toBe(m.vertices.length);
    let worst = 0;
    for (let i = 0; i < m.vertices.length; i++) worst = Math.max(worst, Math.abs(back.vertices[i] - m.vertices[i]));
    expect(worst).toBeLessThanOrEqual(stats.step / 2 + 1e-4);   // + float32 resolution at 100 mm
    expect(stats.step).toBe(1e-3);
  });
  it('a second pack of a loaded mesh is byte identical (the grid is stable)', () => {
    const m = headMesh(40);
    const a = encodeMesh(m).payload;
    const b = decodeMesh(a);
    const c = encodeMesh({ vertices: b.vertices, indices: b.indices }).payload;
    expect(Array.from(c)).toEqual(Array.from(a));
  });
  it('small models get a finer grid, in decades', () => {
    expect(gridStep(Float32Array.from([0, 0, 0, 5, 5, 5]))).toBe(1e-5);
    expect(gridStep(Float32Array.from([0, 0, 0, 50, 5, 5]))).toBe(1e-4);
    expect(gridStep(Float32Array.from([0, 0, 0, 500, 5, 5]))).toBe(1e-3);
  });
  it('non-finite coordinates and huge ones are stored losslessly', () => {
    const v = Float32Array.from([0, 1, 2, 3, NaN, 5, 6, 7, 8]);
    const e = encodeMesh({ vertices: v, indices: Uint32Array.from([0, 1, 2]) });
    expect(e.stats.lossless).toBe(true);
    const back = decodeMesh(e.payload);
    expect(Array.from(back.vertices.slice(0, 4))).toEqual([0, 1, 2, 3]);
    expect(Number.isNaN(back.vertices[4])).toBe(true);
    const big = Float32Array.from([0, 0, 0, 1e7, 1, 1, 2, 2, 2]);
    const eb = encodeMesh({ vertices: big, indices: Uint32Array.from([0, 1, 2]) });
    expect(Array.from(decodeMesh(eb.payload).vertices)).toEqual(Array.from(big));
  });
  it('an index that is not the next new vertex still round-trips (arbitrary order)', () => {
    const idx = Uint32Array.from([5, 0, 9, 9, 8, 1, 2, 3, 4]);
    const v = new Float32Array(30).map((_, i) => i * 0.5);
    const back = decodeMesh(encodeMesh({ vertices: v, indices: idx }).payload);
    expect(Array.from(back.indices)).toEqual(Array.from(idx));
  });
  it('rejects damaged payloads with a MeshPackError', () => {
    const { payload } = encodeMesh(cubeIdx());
    expect(() => decodeMesh(payload.subarray(0, 10))).toThrow(MeshPackError);
    expect(() => decodeMesh(payload.subarray(0, payload.length - 3))).toThrow(MeshPackError);
    const bad = payload.slice(); bad[0] = 0;
    expect(() => decodeMesh(bad)).toThrow(MeshPackError);
    const idxBad = payload.slice(); idxBad[payload.length - 1] = 0x7f;
    expect(() => decodeMesh(idxBad)).toThrow();
  });
  it.skipIf(!canDeflate())('deflate round trip, and a bomb is stopped at the limit', async () => {
    const data = new Uint8Array(100000).map((_, i) => i % 7);
    const z = await deflateRaw(data);
    expect(z.length).toBeLessThan(data.length / 10);
    expect(Array.from(await inflateRaw(z, data.length))).toEqual(Array.from(data));
    await expect(inflateRaw(z, 1000)).rejects.toThrow(MeshPackError);
    await expect(inflateRaw(z.subarray(0, z.length - 4), data.length)).rejects.toThrow();
  });
  it('checksum differs on one changed byte', () => {
    const a = new Uint8Array([1, 2, 3, 4]), b = new Uint8Array([1, 2, 3, 5]);
    expect(checksumBytes(a)).not.toBe(checksumBytes(b));
  });
  it.skipIf(!canDeflate())('500,000 triangles pack to a few MB', async () => {
    const m = headMesh(500);
    expect(m.indices.length / 3).toBeGreaterThan(490000);
    const t0 = performance.now();
    const { payload } = encodeMesh(m);
    const z = await deflateRaw(payload);
    const t1 = performance.now();
    const back = decodeMesh(await inflateRaw(z, payload.length));
    const t2 = performance.now();
    console.log(`500k tris: raw ${m.vertices.byteLength + m.indices.byteLength}, payload ${payload.length}, deflated ${z.length}, pack ${Math.round(t1 - t0)} ms, unpack ${Math.round(t2 - t1)} ms`);
    expect(back.indices.length).toBe(m.indices.length);
    expect(z.length).toBeLessThan((m.vertices.byteLength + m.indices.byteLength) / 3);
  });
});

function cubeIdx() { return indexMesh(cube(10)).mesh; }

describe('buildBvhAsync', () => {
  it('gives the same tree as the one-go build, in slices', async () => {
    const { buildBvh, buildBvhAsync, raycast } = await import('./meshBvh');
    const m = headMesh(120);
    const a = buildBvh(m), b = await buildBvhAsync(m, 1);
    expect(b.nodes).toBe(a.nodes);
    expect(Array.from(b.order)).toEqual(Array.from(a.order));
    const hit = (t: typeof a) => raycast(t, [0, 500, 0], [0, -1, 0])?.point;
    expect(hit(b)).toEqual(hit(a));
  });
});
