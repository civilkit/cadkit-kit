// GLB (binary glTF 2.0) import. glTF is metres and Y up; the reference mesh is millimetres and Z up (as the GLB writer converts them), so
// every vertex goes through (x, y, z) -> (x, -z, y) * 1000 and the file's unit counts as metres. The node tree is walked from the scene
// (matrix or translation / rotation / scale per node), triangle-list primitives are read, base colour factors become colours.
// Not read, and reported: other primitive modes, textures, vertex colours, animation, skins. Refused: Draco and meshopt compression,
// buffers that are a separate file or a data URI (a .glb keeps its data in its own BIN chunk).
import { MatTable, MeshReadError, TriSink, finishRead, type MeshFileRead, type MeshNote } from './meshRead';

type Json = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
type M4 = number[];                 // column-major, as glTF

const IDENT: M4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const mul = (a: M4, b: M4): M4 => {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; }
  return o;
};
function localMatrix(n: Json): M4 {
  if (Array.isArray(n.matrix) && n.matrix.length === 16) return n.matrix.map(Number);
  const t: number[] = Array.isArray(n.translation) ? n.translation : [0, 0, 0];
  const q: number[] = Array.isArray(n.rotation) ? n.rotation : [0, 0, 0, 1];
  const s: number[] = Array.isArray(n.scale) ? n.scale : [1, 1, 1];
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  const x = q[0] / l, y = q[1] / l, z = q[2] / l, w = q[3] / l;
  return [
    (1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + z * w) * s[0], 2 * (x * z - y * w) * s[0], 0,
    2 * (x * y - z * w) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + x * w) * s[1], 0,
    2 * (x * z + y * w) * s[2], 2 * (y * z - x * w) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}
const det3 = (m: M4): number => m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);

const COMP: Record<number, { size: number; get(dv: DataView, o: number): number; max: number }> = {
  5120: { size: 1, get: (d, o) => d.getInt8(o), max: 127 },
  5121: { size: 1, get: (d, o) => d.getUint8(o), max: 255 },
  5122: { size: 2, get: (d, o) => d.getInt16(o, true), max: 32767 },
  5123: { size: 2, get: (d, o) => d.getUint16(o, true), max: 65535 },
  5125: { size: 4, get: (d, o) => d.getUint32(o, true), max: 4294967295 },
  5126: { size: 4, get: (d, o) => d.getFloat32(o, true), max: 1 },
};
const NCOMP: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

/** Read a GLB's bytes. */
export function readGlb(input: Uint8Array | ArrayBuffer, opts: { name?: string } = {}): MeshFileRead {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length === 0) throw new MeshReadError('empty', 'the file is empty');
  if (bytes.length < 20) throw new MeshReadError('notGlb', 'the file is too short to be a GLB');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new MeshReadError('notGlb', 'not a GLB file (bad header); a .gltf text file is not supported');
  if (dv.getUint32(4, true) !== 2) throw new MeshReadError('glbVersion', 'only glTF version 2 is supported');
  const total = dv.getUint32(8, true);
  if (total > bytes.length) throw new MeshReadError('glbTruncated', 'the file ends before the length its header states');
  let json: Json | null = null;
  let bin: Uint8Array | null = null;
  for (let p = 12; p + 8 <= Math.min(total, bytes.length);) {
    const cl = dv.getUint32(p, true), ct = dv.getUint32(p + 4, true);
    if (p + 8 + cl > bytes.length) throw new MeshReadError('glbTruncated', 'a chunk runs past the end of the file');
    if (ct === 0x4e4f534a && !json) {
      try { json = JSON.parse(new TextDecoder().decode(bytes.subarray(p + 8, p + 8 + cl))); } catch { throw new MeshReadError('notGlb', 'the JSON chunk is not valid JSON'); }
    } else if (ct === 0x004e4942 && !bin) bin = bytes.subarray(p + 8, p + 8 + cl);
    p += 8 + cl;
  }
  if (!json) throw new MeshReadError('notGlb', 'no JSON chunk in the file');
  const g = json;
  const required: string[] = Array.isArray(g.extensionsRequired) ? g.extensionsRequired : [];
  if (required.includes('KHR_draco_mesh_compression')) throw new MeshReadError('draco', 'this GLB is Draco compressed, which is not supported: export it without compression');
  if (required.includes('EXT_meshopt_compression')) throw new MeshReadError('meshopt', 'this GLB uses meshopt compression, which is not supported: export it without compression');

  const accessors: Json[] = g.accessors ?? [], views: Json[] = g.bufferViews ?? [], buffers: Json[] = g.buffers ?? [];
  const bufferBytes = (bi: number): Uint8Array => {
    const b = buffers[bi];
    if (!b) throw new MeshReadError('badAccessor', `buffer ${bi} is missing`);
    if (b.uri !== undefined) throw new MeshReadError('externalBuffer', 'the file points to data outside itself (a buffer with a uri); only a GLB that holds its data inside is read');
    if (bi !== 0 || !bin) throw new MeshReadError('badAccessor', 'the BIN chunk is missing');
    return bin;
  };
  /** Components of an accessor as numbers (normalised ints decoded), count * n of them. */
  const readAccessor = (ai: number): { data: Float64Array; n: number; count: number } => {
    const a = accessors[ai];
    if (!a) throw new MeshReadError('badAccessor', `accessor ${ai} is missing`);
    if (a.sparse) throw new MeshReadError('sparse', 'a sparse accessor is not supported');
    const n = NCOMP[a.type], comp = COMP[a.componentType];
    if (!n || !comp || !(a.count >= 0)) throw new MeshReadError('badAccessor', `accessor ${ai} is not valid`);
    const out = new Float64Array(a.count * n);
    if (a.bufferView === undefined) return { data: out, n, count: a.count };   // all zeros
    const v = views[a.bufferView];
    if (!v) throw new MeshReadError('badAccessor', `buffer view ${a.bufferView} is missing`);
    if (v.extensions?.EXT_meshopt_compression) throw new MeshReadError('meshopt', 'this GLB uses meshopt compression, which is not supported: export it without compression');
    const buf = bufferBytes(v.buffer);
    const stride = v.byteStride || n * comp.size;
    const base = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const last = base + (a.count > 0 ? (a.count - 1) * stride + n * comp.size : 0);
    if (last > buf.length || last > (v.byteOffset ?? 0) + v.byteLength) throw new MeshReadError('badAccessor', `accessor ${ai} reads past its buffer`);
    const d = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const norm = a.normalized === true && a.componentType !== 5126;
    for (let i = 0; i < a.count; i++) {
      for (let c = 0; c < n; c++) {
        const x = comp.get(d, base + i * stride + c * comp.size);
        out[i * n + c] = norm ? Math.max(x / comp.max, -1) : x;
      }
    }
    return { data: out, n, count: a.count };
  };

  const notes: MeshNote[] = [];
  const table = new MatTable();
  const matCache = new Map<number, number>();
  let texturedMats = 0;
  const materialIndex = (mi: number | undefined): number => {
    if (mi === undefined) return -1;
    let c = matCache.get(mi);
    if (c !== undefined) return c;
    const m: Json | undefined = (g.materials ?? [])[mi];
    c = -1;
    if (m) {
      const pbr = m.pbrMetallicRoughness ?? {};
      if (pbr.baseColorTexture) texturedMats++;
      const f: number[] | undefined = pbr.baseColorFactor;
      if (Array.isArray(f) && f.length >= 3) {
        const srgb = (x: number) => 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
        c = table.add([srgb(f[0]), srgb(f[1]), srgb(f[2])], m.alphaMode === 'BLEND' || m.alphaMode === 'MASK' ? (f[3] ?? 1) : 1);
      }
    }
    matCache.set(mi, c);
    return c;
  };

  const sink = new TriSink();
  let parts = 0, badMode = 0, sawNormals = false, sawVertexColours = false;
  const nodes: Json[] = g.nodes ?? [];
  const meshes: Json[] = g.meshes ?? [];
  const emit = (mesh: Json, world: M4): void => {
    const flip = det3(world) < 0;
    let any = false;
    for (const prim of mesh.primitives ?? []) {
      const mode = prim.mode ?? 4;
      if (mode !== 4) { badMode++; continue; }
      const pa = prim.attributes?.POSITION;
      if (pa === undefined) continue;
      if (prim.extensions?.KHR_draco_mesh_compression) throw new MeshReadError('draco', 'this GLB is Draco compressed, which is not supported: export it without compression');
      if (prim.attributes.NORMAL !== undefined) sawNormals = true;
      if (prim.attributes.COLOR_0 !== undefined) sawVertexColours = true;
      const pos = readAccessor(pa);
      if (pos.n !== 3) throw new MeshReadError('badAccessor', 'POSITION is not a VEC3');
      // to millimetres, Z up
      const w = new Float64Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const x = pos.data[i * 3], y = pos.data[i * 3 + 1], z = pos.data[i * 3 + 2];
        const px = world[0] * x + world[4] * y + world[8] * z + world[12];
        const py = world[1] * x + world[5] * y + world[9] * z + world[13];
        const pz = world[2] * x + world[6] * y + world[10] * z + world[14];
        w[i * 3] = px * 1000; w[i * 3 + 1] = -pz * 1000; w[i * 3 + 2] = py * 1000;
      }
      let idx: ArrayLike<number>;
      if (prim.indices !== undefined) idx = readAccessor(prim.indices).data;
      else { const a = new Uint32Array(pos.count); for (let i = 0; i < a.length; i++) a[i] = i; idx = a; }
      const mat = materialIndex(prim.material);
      const nT = Math.floor(idx.length / 3);
      for (let t = 0; t < nT; t++) {
        const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
        if (!(a < pos.count && b < pos.count && c < pos.count)) throw new MeshReadError('badAccessor', 'an index points past the vertices');
        if (flip) sink.add(w, a * 3, w, c * 3, w, b * 3, mat); else sink.add(w, a * 3, w, b * 3, w, c * 3, mat);
        any = true;
      }
    }
    if (any) parts++;
  };
  const seen = new Set<number>();
  const walk = (ni: number, parent: M4, depth: number): void => {
    const n = nodes[ni];
    if (!n || depth > 256 || seen.has(ni)) return;   // a node reached twice would be a cycle or a shared child; glTF forbids both
    seen.add(ni);
    const world = mul(parent, localMatrix(n));
    if (n.mesh !== undefined && meshes[n.mesh]) emit(meshes[n.mesh], world);
    if (n.skin !== undefined) notes.push({ code: 'skins' });
    for (const c of n.children ?? []) walk(c, world, depth + 1);
    seen.delete(ni);
  };
  const scenes: Json[] = g.scenes ?? [];
  const scene = scenes[g.scene ?? 0];
  if (scene) for (const r of scene.nodes ?? []) walk(r, IDENT, 0);
  else {
    // no scene: the nodes nothing else lists as a child are the roots
    const child = new Set<number>();
    for (const n of nodes) for (const c of n.children ?? []) child.add(c);
    nodes.forEach((_, i) => { if (!child.has(i)) walk(i, IDENT, 0); });
    if (!nodes.length) meshes.forEach((m) => emit(m, IDENT));
  }
  if (!sink.n) throw new MeshReadError('noTriangles', badMode ? 'the file has no triangle meshes (only points, lines, strips or fans)' : 'no triangle meshes in the file');
  if (sawNormals) notes.push({ code: 'normals' });
  if (texturedMats || (g.textures ?? []).length || (g.images ?? []).length) notes.push({ code: 'textures' });
  if (sawVertexColours) notes.push({ code: 'vertexColours' });
  if ((g.animations ?? []).length) notes.push({ code: 'animation', n: g.animations.length });
  const dedup = notes.filter((n, i) => notes.findIndex((m) => m.code === n.code) === i);
  if (badMode) dedup.push({ code: 'primitiveMode', n: badMode });
  if (parts > 1) dedup.push({ code: 'partsMerged', n: parts });
  dedup.push({ code: 'upAxisConverted' });
  const name = (scene?.name as string | undefined) || (nodes.find((n) => n.mesh !== undefined)?.name as string | undefined) || opts.name || '';
  return finishRead(sink, table.list, { format: 'glb', name, unit: 'm', unitFromFile: true, parts: Math.max(1, parts), notes: dedup });
}
