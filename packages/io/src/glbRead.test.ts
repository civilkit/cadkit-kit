import { describe, expect, it } from 'vitest';
import { meshToGlb } from './glb';
import { MeshReadError, readGlb } from './index';
import { cube, cylinder, volumeOf } from './testmesh';

/** A GLB from a JSON document and a binary payload (the helper hand-written test files are made with). */
function makeGlb(json: object, bin: Uint8Array | null): Uint8Array {
  const pad = (n: number) => (n + 3) & ~3;
  const j = new TextEncoder().encode(JSON.stringify(json));
  const jl = pad(j.length), bl = bin ? pad(bin.length) : 0;
  const total = 12 + 8 + jl + (bin ? 8 + bl : 0);
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jl, true); dv.setUint32(16, 0x4e4f534a, true);
  out.set(j, 20); out.fill(0x20, 20 + j.length, 20 + jl);
  if (bin) { dv.setUint32(20 + jl, bl, true); dv.setUint32(24 + jl, 0x004e4942, true); out.set(bin, 28 + jl); }
  return out;
}
const f32 = (a: number[]) => new Uint8Array(Float32Array.from(a).buffer);
/** One triangle (0,0,0) (1,0,0) (0,1,0) in glTF space, as a single non-indexed POSITION accessor. */
const tri = (extra: object = {}, node: object = { mesh: 0 }, mesh: object = {}) => ({
  asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [node],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, ...mesh }] }],
  accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
  bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }], buffers: [{ byteLength: 36 }], ...extra,
});
const triBin = f32([0, 0, 0, 1, 0, 0, 0, 1, 0]);

describe('readGlb round trip with our writer', () => {
  it('a cube body: counts, box in mm, volume, closed, colour and name', () => {
    const w = meshToGlb([{ name: 'Block', positions: cube(10), color: '#336699' }]);
    const r = readGlb(w.data);
    expect(r.triangles).toBe(12);
    expect(r.mesh.vertices.length / 3).toBe(8);
    for (let k = 0; k < 3; k++) { expect(r.bbox.min[k]).toBeCloseTo(0, 3); expect(r.bbox.max[k]).toBeCloseTo(10, 3); }
    expect(volumeOf(r.mesh.vertices, r.mesh.indices)).toBeCloseTo(1000, 1);
    expect(r.check.watertight).toBe(true);
    expect(r.mats).toEqual([{ c: '#336699', o: 1 }]);
    expect(r.unit).toBe('m');
    expect(r.notes.map((n) => n.code)).toEqual(expect.arrayContaining(['normals', 'upAxisConverted']));
  });
  it('two bodies with different colours and an opacity: merged, colours and runs kept', () => {
    const moved = Float32Array.from(cylinder(3, 8, 16), (v, i) => (i % 3 === 0 ? v + 30 : v));
    const r = readGlb(meshToGlb([{ name: 'A', positions: cube(10), color: '#ff0000' }, { name: 'B', positions: moved, color: '#00ff00', opacity: 0.5 }]).data);
    expect(r.parts).toBe(2);
    expect(r.triangles).toBe(12 + 16 * 4);
    expect(r.mats!.map((m) => `${m.c}/${m.o}`).sort()).toEqual(['#00ff00/0.5', '#ff0000/1']);
    expect(r.notes).toContainEqual({ code: 'partsMerged', n: 2 });
    expect(r.bbox.max[0]).toBeCloseTo(33, 2);
  });
  it('a body without colour reads as the default grey the writer gives it (a colour, not "none")', () => {
    const r = readGlb(meshToGlb([{ name: 'A', positions: cube(2) }]).data);
    expect(r.mats).toEqual([{ c: '#cccccc', o: 1 }]);
  });
});

describe('readGlb by hand', () => {
  it('converts metres to mm and Y up to Z up: (1,0,0)/(0,1,0) in glTF becomes (1000,0,0)/(0,0,1000)', () => {
    const r = readGlb(makeGlb(tri(), triBin));
    expect(r.bbox).toEqual({ min: [0, 0, 0], max: [1000, 0, 1000] });
    expect(r.unitFromFile).toBe(true);
  });
  it('node translation, rotation and scale (TRS) compose; nested nodes multiply', () => {
    const s = Math.SQRT1_2;
    const doc = tri({ scenes: [{ nodes: [0] }], nodes: [{ translation: [1, 0, 0], scale: [2, 2, 2], children: [1] }, { mesh: 0, rotation: [0, 0, s, s] }] });
    // child: rotate 90 degrees about Z: (1,0,0) -> (0,1,0), (0,1,0) -> (-1,0,0); parent: scale 2, move +1 in X
    const r = readGlb(makeGlb(doc, triBin));
    const v = Array.from(r.mesh.vertices).map((x) => Math.round(x) + 0);
    // child: 90 degrees about Z takes (1,0,0) to (0,1,0) and (0,1,0) to (-1,0,0); parent: scale 2, move +1 in X; then glTF (x,y,z) -> mm (x, -z, y)
    expect([0, 1, 2].map((i) => [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]])).toEqual([[1000, 0, 0], [1000, 0, 2000], [-1000, 0, 0]]);
  });
  it('a node matrix; and a mirroring matrix flips the winding so the triangle still faces the same way', () => {
    const plain = readGlb(makeGlb(tri({}, { mesh: 0, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 5, 1] }), triBin));
    expect(plain.bbox.min[1]).toBe(-5000);   // glTF z 5 -> mm y -5000
    const mirror = readGlb(makeGlb(tri({}, { mesh: 0, matrix: [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }), triBin));
    const v = mirror.mesh.vertices, i = mirror.mesh.indices;
    // the unmirrored triangle has normal +Y in glTF = -Y... compare with the plain reading: the mirrored one must keep the same normal sign in the plane test
    const nz = (vv: Float32Array, ii: Uint32Array) => { const a = ii[0] * 3, b = ii[1] * 3, c = ii[2] * 3; return (vv[b] - vv[a]) * (vv[c + 2] - vv[a + 2]) - (vv[b + 2] - vv[a + 2]) * (vv[c] - vv[a]); };
    const pl = readGlb(makeGlb(tri(), triBin));
    expect(Math.sign(nz(v, i))).toBe(Math.sign(nz(pl.mesh.vertices, pl.mesh.indices)));
  });
  it('indices of 16 bits and interleaved vertices (byteStride) with a byteOffset', () => {
    const buf = new Uint8Array(76);
    const dv = new DataView(buf.buffer);
    // 3 vertices, stride 20 (xyz + 8 bytes of something else), starting at 4
    [[0, 0, 0], [2, 0, 0], [0, 2, 0]].forEach((p, i) => p.forEach((c, k) => dv.setFloat32(4 + i * 20 + k * 4, c, true)));
    [0, 1, 2].forEach((x, i) => dv.setUint16(68 + i * 2, x, true));
    const doc = {
      asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }, { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' }],
      bufferViews: [{ buffer: 0, byteOffset: 4, byteLength: 60, byteStride: 20 }, { buffer: 0, byteOffset: 68, byteLength: 6 }], buffers: [{ byteLength: 76 }],
    };
    const r = readGlb(makeGlb(doc, buf));
    expect(r.bbox).toEqual({ min: [0, 0, 0], max: [2000, 0, 2000] });
    expect(r.triangles).toBe(1);
  });
  it('base colour factor is linear: 0.5 linear is sRGB #bcbcbc; BLEND keeps alpha; a material without a factor gives no colour', () => {
    const mats = [{ pbrMetallicRoughness: { baseColorFactor: [0.5, 0.5, 0.5, 0.25] }, alphaMode: 'BLEND' }];
    const r = readGlb(makeGlb(tri({ materials: mats }, { mesh: 0 }, { material: 0 }), triBin));
    expect(r.mats).toEqual([{ c: '#bcbcbc', o: 0.25 }]);
    const none = readGlb(makeGlb(tri({ materials: [{ name: 'x' }] }, { mesh: 0 }, { material: 0 }), triBin));
    expect(none.mats).toBeUndefined();
  });
  it('lines and points are reported, not read; textures and animation are reported', () => {
    const doc = tri({ animations: [{}], images: [{}], textures: [{}] });
    (doc.meshes[0].primitives as object[]).push({ attributes: { POSITION: 0 }, mode: 1 });
    const r = readGlb(makeGlb(doc, triBin));
    expect(r.triangles).toBe(1);
    expect(r.notes).toEqual(expect.arrayContaining([{ code: 'primitiveMode', n: 1 }, { code: 'textures' }, { code: 'animation', n: 1 }]));
    const onlyLines = tri(); (onlyLines.meshes[0].primitives[0] as { mode?: number }).mode = 1;
    expect(() => readGlb(makeGlb(onlyLines, triBin))).toThrowError(/no triangle meshes/);
  });
  it('refuses Draco, meshopt, a buffer with a uri, sparse accessors, a truncated file and a non-GLB with clear messages', () => {
    const code = (f: () => unknown) => { try { f(); } catch (e) { return (e as MeshReadError).code; } return 'none'; };
    expect(code(() => readGlb(makeGlb(tri({ extensionsRequired: ['KHR_draco_mesh_compression'] }), triBin)))).toBe('draco');
    expect(code(() => readGlb(makeGlb(tri({ extensionsRequired: ['EXT_meshopt_compression'] }), triBin)))).toBe('meshopt');
    expect(code(() => readGlb(makeGlb(tri({ buffers: [{ byteLength: 36, uri: 'data:application/octet-stream;base64,AAAA' }] }), null)))).toBe('externalBuffer');
    expect(code(() => readGlb(makeGlb(tri({ accessors: [{ componentType: 5126, count: 3, type: 'VEC3', sparse: { count: 1 } }] }), triBin)))).toBe('sparse');
    expect(code(() => readGlb(makeGlb(tri(), triBin).subarray(0, 60)))).toBe('glbTruncated');
    expect(code(() => readGlb(new TextEncoder().encode('{"asset":{"version":"2.0"}}')))).toBe('notGlb');
    expect(code(() => readGlb(new Uint8Array(0)))).toBe('empty');
    expect(code(() => readGlb(makeGlb(tri({ accessors: [{ bufferView: 0, componentType: 5126, count: 30, type: 'VEC3' }] }), triBin)))).toBe('badAccessor');
  });
});
