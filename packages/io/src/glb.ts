import { facetNormal, parseHexColor, type MeshBody } from './mesh';

export interface GlbResult { data: Uint8Array; triangles: number; vertices: number; bodies: number }

const srgbToLinear = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const pad4 = (n: number) => (n + 3) & ~3;

/** Kernel space (Z up, millimetres) to glTF space (Y up, metres): (x, y, z) -> (x, z, -y) / 1000. That is a rotation about X
 *  (determinant +1), so counter-clockwise winding stays counter-clockwise; normals take the rotation only. */
export const toGltf = (x: number, y: number, z: number): [number, number, number] => [x / 1000, z / 1000, -y / 1000];
const nToGltf = (x: number, y: number, z: number): [number, number, number] => [x, z, -y];

/** Binary glTF 2.0 (one .glb): POSITION, NORMAL and 32-bit indices per body, one node and one material per body (colour,
 *  opacity, metallic and roughness from the body's look; a plain grey when it has none). Vertices are shared between triangles
 *  whose position and normal agree, so a smooth surface keeps its smooth normals and a sharp edge stays sharp. */
export function meshToGlb(bodies: readonly MeshBody[], opts: { name?: string } = {}): GlbResult {
  const live = bodies.filter((b) => Math.floor(b.positions.length / 9) > 0);
  const chunks: Uint8Array[] = [];
  let binLen = 0;
  const views: unknown[] = [], accessors: unknown[] = [], meshes: unknown[] = [], nodes: unknown[] = [], materials: unknown[] = [];
  const push = (bytes: Uint8Array, target: number): number => {
    views.push({ buffer: 0, byteOffset: binLen, byteLength: bytes.length, target });
    chunks.push(bytes);
    binLen += bytes.length;   // every view is a multiple of 4 bytes, so offsets stay aligned
    return views.length - 1;
  };
  let triangles = 0, vertices = 0;
  live.forEach((b, bi) => {
    const p = b.positions, nT = Math.floor(p.length / 9);
    const key = new Map<string, number>();
    const pos: number[] = [], nor: number[] = [], idx: number[] = [];
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let t = 0; t < nT; t++) {
      const fn = facetNormal(p, t);
      for (let k = 0; k < 3; k++) {
        const o = t * 9 + k * 3;
        let n: [number, number, number] = b.normals ? [b.normals[o], b.normals[o + 1], b.normals[o + 2]] : fn;
        const l = Math.hypot(n[0], n[1], n[2]);
        n = l > 0 ? [n[0] / l, n[1] / l, n[2] / l] : fn;
        const g = toGltf(Math.fround(p[o]), Math.fround(p[o + 1]), Math.fround(p[o + 2]));
        const gn = nToGltf(n[0], n[1], n[2]);
        const kk = `${g[0]},${g[1]},${g[2]}|${gn.map((v) => Math.round(v * 1000)).join(',')}`;
        let vi = key.get(kk);
        if (vi === undefined) {
          vi = pos.length / 3; key.set(kk, vi);
          pos.push(...g); nor.push(...gn);
          for (let a = 0; a < 3; a++) { if (g[a] < lo[a]) lo[a] = g[a]; if (g[a] > hi[a]) hi[a] = g[a]; }
        }
        idx.push(vi);
      }
    }
    const pv = push(new Uint8Array(Float32Array.from(pos).buffer), 34962);
    const nv = push(new Uint8Array(Float32Array.from(nor).buffer), 34962);
    const iv = push(new Uint8Array(Uint32Array.from(idx).buffer), 34963);
    const base = accessors.length;
    accessors.push(
      { bufferView: pv, componentType: 5126, count: pos.length / 3, type: 'VEC3', min: lo, max: hi },
      { bufferView: nv, componentType: 5126, count: nor.length / 3, type: 'VEC3' },
      { bufferView: iv, componentType: 5125, count: idx.length, type: 'SCALAR', min: [0], max: [pos.length / 3 - 1] },
    );
    const rgb = parseHexColor(b.color) ?? [204, 204, 204];
    const alpha = Math.min(1, Math.max(0, b.opacity ?? 1));
    materials.push({
      name: b.name || `Body ${bi + 1}`,
      pbrMetallicRoughness: { baseColorFactor: [...rgb.map(srgbToLinear), alpha], metallicFactor: b.metallic ?? 0, roughnessFactor: b.roughness ?? 0.6 },
      ...(alpha < 1 ? { alphaMode: 'BLEND' } : {}),
      doubleSided: false,
    });
    meshes.push({ name: b.name || `Body ${bi + 1}`, primitives: [{ attributes: { POSITION: base, NORMAL: base + 1 }, indices: base + 2, material: bi, mode: 4 }] });
    nodes.push({ name: b.name || `Body ${bi + 1}`, mesh: bi });
    triangles += idx.length / 3; vertices += pos.length / 3;
  });
  const json = {
    asset: { version: '2.0', generator: 'CAD Kit', extras: { units: 'metres (converted from millimetres)', upAxis: 'Y (converted from Z)' } },
    scene: 0,
    scenes: [{ name: opts.name ?? 'part', nodes: nodes.map((_, i) => i) }],
    nodes, meshes, materials, accessors, bufferViews: views,
    buffers: [{ byteLength: binLen }],
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jLen = pad4(jsonBytes.length), total = 12 + 8 + jLen + 8 + binLen;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jLen, true); dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20); out.fill(0x20, 20 + jsonBytes.length, 20 + jLen);
  const bo = 20 + jLen;
  dv.setUint32(bo, binLen, true); dv.setUint32(bo + 4, 0x004e4942, true);
  let o = bo + 8;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return { data: out, triangles, vertices, bodies: live.length };
}

export interface ParsedGlb {
  json: Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
  bin: Uint8Array;
  /** Per node, in order: its decoded geometry. */
  bodies: Array<{ name: string; positions: Float32Array; normals: Float32Array; indices: Uint32Array; min: number[]; max: number[]; material: Record<string, any> }>;   // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Read a GLB written by `meshToGlb`, checking the header and both chunks (the reader the tests use). */
export function parseGlb(bytes: Uint8Array): ParsedGlb {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 28 || dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB (bad magic)');
  if (dv.getUint32(4, true) !== 2) throw new Error('GLB version is not 2');
  if (dv.getUint32(8, true) !== bytes.length) throw new Error('GLB length does not match the file');
  const jl = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== 0x4e4f534a || jl % 4) throw new Error('first GLB chunk is not JSON');
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jl)));
  const bo = 20 + jl;
  const bl = dv.getUint32(bo, true);
  if (dv.getUint32(bo + 4, true) !== 0x004e4942 || bl % 4 || bo + 8 + bl !== bytes.length) throw new Error('second GLB chunk is not a BIN chunk that ends the file');
  const bin = bytes.slice(bo + 8, bo + 8 + bl);
  if (json.buffers[0].byteLength !== bl) throw new Error('buffer length does not match the BIN chunk');
  const read = (ai: number) => {
    const a = json.accessors[ai], v = json.bufferViews[a.bufferView];
    const n = a.count * ({ SCALAR: 1, VEC3: 3 } as Record<string, number>)[a.type];
    const off = bin.byteOffset + v.byteOffset + (a.byteOffset ?? 0);
    return { a, data: a.componentType === 5125 ? new Uint32Array(bin.buffer, off, n) : new Float32Array(bin.buffer, off, n) };
  };
  const bodies = (json.nodes as Array<{ name: string; mesh: number }>).map((nd) => {
    const prim = json.meshes[nd.mesh].primitives[0];
    const p = read(prim.attributes.POSITION), n = read(prim.attributes.NORMAL), i = read(prim.indices);
    return { name: nd.name, positions: p.data as Float32Array, normals: n.data as Float32Array, indices: i.data as Uint32Array, min: p.a.min as number[], max: p.a.max as number[], material: json.materials[prim.material] };
  });
  return { json, bin, bodies };
}
