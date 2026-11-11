// Reference meshes in the document (an imported STL): the record kept in `doc.meshes`, its base64 payload, the placement transform,
// and the ray / closest point queries the 3D Sketch tool and the sketch-on-mesh command use. Pure: no DOM, no kernel. See
// docs/design/mesh-import.md for why this is a document field and not a kernel body.
import { buildBvh, buildBvhAsync, closestPoint, meshBox, raycast, UNIT_MM, type Bvh, type IndexedMesh, type StlRead, type StlUnit } from '@kit/io';

export type V3 = [number, number, number];

export interface MeshRec {
  id: string;
  name: string;
  visible: boolean;
  /** 0.05 .. 1 */
  opacity: number;
  /** `#rrggbb` */
  color: string;
  /** draw the triangle edges */
  wire: boolean;
  /** the unit the file was read in (information; the vertices are millimetres) */
  unit: StlUnit;
  pos: V3;
  /** degrees; applied X, then Y, then Z */
  rot: V3;
  /** uniform */
  scale: number;
  tris: number;
  verts: number;
  watertight: boolean;
  /** triangle count + checksum of the vertices: keys the decoded cache */
  sig: string;
  /** base64 of the Float32 vertices (xyz) */
  v: string;
  /** base64 of the Uint32 triangle corners */
  i: string;
  /** a SketchUp import: the materials its triangles use (colour, opacity 0..1); absent for an STL */
  mats?: MeshMat[];
  /** with `mats`: base64 of the Uint16 material index of each triangle (0xFFFF: none, drawn in `color`). Triangles are sorted by material, so a material is one run. */
  m?: string;
}

export interface MeshMat { /** `#rrggbb` */ c: string; /** 0.05 .. 1 */ o: number }
/** the material index of a triangle that has none */
export const NO_MAT = 0xffff;

export const MESH_KEY = 'meshes';
export const DEFAULT_MESH_COLOR = '#c9b8a6';

// ---- base64 of typed arrays ----

export function bytesToBase64(b: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < b.length; i += CH) s += String.fromCharCode.apply(null, b.subarray(i, i + CH) as unknown as number[]);
  return btoa(s);
}
/** The same without holding the page: slices of 768 KB (a multiple of 3, so the pieces join), a turn for the page between them. A 12 MB mesh is
 *  about 90 ms in one go and under 10 ms a slice here. */
export async function bytesToBase64Async(b: Uint8Array): Promise<string> {
  const SLICE = 3 * 256 * 1024;
  if (b.length <= SLICE) return bytesToBase64(b);
  const parts: string[] = [];
  for (let i = 0; i < b.length; i += SLICE) {
    parts.push(bytesToBase64(b.subarray(i, i + SLICE)));
    await new Promise<void>((r) => setTimeout(r, 0));
  }
  return parts.join('');
}
export function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const f32 = (b: Uint8Array): Float32Array => new Float32Array(b.buffer, b.byteOffset, b.byteLength >> 2);
const u16 = (b: Uint8Array): Uint16Array => new Uint16Array(b.buffer, b.byteOffset, b.byteLength >> 1);
const u32 = (b: Uint8Array): Uint32Array => new Uint32Array(b.buffer, b.byteOffset, b.byteLength >> 2);

/** FNV-1a over the vertex bits. */
function checksum(v: Float32Array): string {
  const w = new Uint32Array(v.buffer, v.byteOffset, v.length);
  let h = 0x811c9dc5;
  for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w[i], 0x01000193);
  return (h >>> 0).toString(16);
}

/** FNV-1a over the material indices. */
function checksum16(m: Uint16Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < m.length; i++) h = Math.imul(h ^ m[i], 0x01000193);
  return (h >>> 0).toString(16);
}
/** The cache key of geometry: triangle count, vertex checksum and, with materials, theirs. */
export const sigOf = (v: Float32Array, tm?: Uint16Array): string => `${v.length / 3}:${checksum(v)}${tm ? ':' + checksum16(tm) : ''}`;

/** A record from typed arrays (millimetres): placed at the origin as it is, shown at once. `tm` and `mats`: a material per triangle. */
export function meshRecFromArrays(a: { vertices: Float32Array; indices: Uint32Array; tm?: Uint16Array }, o: { id: string; name: string; unit: StlUnit; watertight: boolean; mats?: MeshMat[]; color?: string }): MeshRec {
  const v = a.vertices, i = a.indices, tris = i.length / 3;
  return {
    id: o.id, name: o.name, visible: true, opacity: 1, color: o.color ?? DEFAULT_MESH_COLOR, wire: false, unit: o.unit,
    pos: [0, 0, 0], rot: [0, 0, 0], scale: 1, tris, verts: v.length / 3, watertight: o.watertight,
    sig: tris + ':' + sigOf(v, a.tm),
    v: bytesToBase64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)),
    i: bytesToBase64(new Uint8Array(i.buffer, i.byteOffset, i.byteLength)),
    ...(a.tm && o.mats?.length ? { mats: o.mats, m: bytesToBase64(new Uint8Array(a.tm.buffer, a.tm.byteOffset, a.tm.byteLength)) } : {}),
  };
}

/** A record for a freshly read STL: placed at the origin as the file has it, shown at once. */
export function meshRecFromStl(r: StlRead, id: string, name: string, unit: StlUnit): MeshRec {
  return meshRecFromArrays(r.mesh, { id, name, unit, watertight: r.check.watertight });
}

const hexColor = (x: unknown): string | null => (typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x) ? x : null);
const num = (x: unknown, d: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const vec = (x: unknown, d: V3): V3 => (Array.isArray(x) && x.length === 3 && x.every((n) => typeof n === 'number' && Number.isFinite(n)) ? [x[0], x[1], x[2]] : d);

/** The records of a document field, checked: a bad entry is dropped, a bad number takes its default. */
export function readMeshes(field: unknown): MeshRec[] {
  if (!Array.isArray(field)) return [];
  const out: MeshRec[] = [];
  for (const m of field as Array<Record<string, unknown>>) {
    if (!m || typeof m !== 'object' || typeof m.id !== 'string' || typeof m.v !== 'string' || typeof m.i !== 'string') continue;
    const unit = (['mm', 'cm', 'm', 'in'] as const).find((u) => u === m.unit) ?? 'mm';
    out.push({
      id: m.id, name: typeof m.name === 'string' ? m.name : 'Mesh', visible: m.visible !== false,
      opacity: Math.min(1, Math.max(0.05, num(m.opacity, 1))), color: typeof m.color === 'string' && /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : DEFAULT_MESH_COLOR,
      wire: m.wire === true, unit, pos: vec(m.pos, [0, 0, 0]), rot: vec(m.rot, [0, 0, 0]), scale: Math.max(1e-6, num(m.scale, 1)),
      tris: num(m.tris, 0), verts: num(m.verts, 0), watertight: m.watertight === true, sig: typeof m.sig === 'string' ? m.sig : '', v: m.v, i: m.i,
      ...readMats(m.mats, m.m),
    });
  }
  return out;
}

/** The materials of a record, checked: both the list and the per-triangle indices must be there. */
function readMats(mats: unknown, m: unknown): { mats?: MeshMat[]; m?: string } {
  if (!Array.isArray(mats) || !mats.length || typeof m !== 'string') return {};
  const out = mats.map((x) => ({ c: hexColor((x as MeshMat | null)?.c) ?? DEFAULT_MESH_COLOR, o: Math.min(1, Math.max(0.05, num((x as MeshMat | null)?.o, 1))) }));
  return { mats: out, m };
}

export const meshesOf = (doc: unknown): MeshRec[] => readMeshes((doc as Record<string, unknown> | null | undefined)?.[MESH_KEY]);

/** An id not used by the other records, `mesh1`, `mesh2`... */
export function nextMeshId(recs: MeshRec[]): string {
  const used = new Set(recs.map((r) => r.id));
  let n = 1;
  while (used.has('mesh' + n)) n++;
  return 'mesh' + n;
}

// ---- decoded geometry, cached by id and signature ----

export interface Decoded { mesh: IndexedMesh; box: { min: V3; max: V3 }; /** the material of each triangle (a record with `mats`) */ tm?: Uint16Array; bvh(): Bvh; /** builds the picking tree in slices of a few milliseconds (a later `bvh()` finds it ready) */ prepare(): Promise<void> }
const cache = new Map<string, Decoded>();

function withBvh(d: Omit<Decoded, 'bvh' | 'prepare'>): Decoded {
  let bvh: Bvh | null = null, building: Promise<void> | null = null;
  return { ...d, bvh: () => (bvh ??= buildBvh(d.mesh)), prepare: () => (building ??= bvh ? Promise.resolve() : buildBvhAsync(d.mesh).then((b) => { bvh ??= b; })) };
}
export function decode(rec: MeshRec): Decoded {
  const key = rec.id + '|' + rec.sig + '|' + rec.v.length + '|' + rec.i.length + '|' + (rec.m?.length ?? 0);
  let d = cache.get(key);
  if (d) { cache.delete(key); cache.set(key, d); return d; }
  const mesh: IndexedMesh = { vertices: f32(base64ToBytes(rec.v)), indices: u32(base64ToBytes(rec.i)) };
  const tm = rec.m && rec.mats ? u16(base64ToBytes(rec.m)) : undefined;
  d = withBvh({ mesh, box: meshBox(mesh), ...(tm && tm.length === mesh.indices.length / 3 ? { tm } : {}) });
  cache.set(key, d);
  while (cache.size > 6) cache.delete(cache.keys().next().value as string);
  return d;
}
export const clearMeshCache = (): void => cache.clear();
/** Put arrays that were just decoded (an opened file) into the cache, so the first use does not decode the base64 again. */
export function seedDecoded(rec: MeshRec, a: { vertices: Float32Array; indices: Uint32Array; tm?: Uint16Array }): void {
  const key = rec.id + '|' + rec.sig + '|' + rec.v.length + '|' + rec.i.length + '|' + (rec.m?.length ?? 0);
  const mesh: IndexedMesh = { vertices: a.vertices, indices: a.indices };
  cache.set(key, withBvh({ mesh, box: meshBox(mesh), ...(a.tm ? { tm: a.tm } : {}) }));
  while (cache.size > 6) cache.delete(cache.keys().next().value as string);
}

/** The runs of triangles of one material, for the viewer's groups (a record with `mats`; triangles are sorted by material, so a run is a material). */
export interface MatRun { start: number; count: number; color: string; opacity: number }
const runCache = new WeakMap<Decoded, MatRun[]>();
export function matRuns(rec: MeshRec): MatRun[] | undefined {
  if (!rec.mats?.length) return undefined;
  const d = decode(rec);
  if (!d.tm) return undefined;
  let runs = runCache.get(d);
  if (!runs) {
    runs = [];
    const tm = d.tm;
    for (let t = 0; t < tm.length;) {
      let e = t + 1;
      while (e < tm.length && tm[e] === tm[t]) e++;
      const mat = tm[t] === NO_MAT ? undefined : rec.mats[tm[t]];
      runs.push({ start: t, count: e - t, color: mat?.c ?? rec.color, opacity: mat?.o ?? 1 });
      t = e;
    }
    runCache.set(d, runs);
  }
  // the record's colour is for the triangles that have no material: it follows the record, the cached runs are the materials'
  return runs.map((r, k) => (d.tm![r.start] === NO_MAT ? { ...runs![k], color: rec.color } : r));
}

// ---- placement ----

/** Rotation matrix rows for degrees about X, then Y, then Z: R = Rz * Ry * Rx. */
export function rotation(rot: V3): number[] {
  const [a, b, c] = rot.map((d) => (d * Math.PI) / 180);
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  return [
    cc * cb, cc * sb * sa - sc * ca, cc * sb * ca + sc * sa,
    sc * cb, sc * sb * sa + cc * ca, sc * sb * ca - cc * sa,
    -sb, cb * sa, cb * ca,
  ];
}
/** Column-major 4 x 4 (the layout three.js reads) of local -> world. */
export function matrixOf(m: Pick<MeshRec, 'pos' | 'rot' | 'scale'>): number[] {
  const r = rotation(m.rot), s = m.scale;
  return [r[0] * s, r[3] * s, r[6] * s, 0, r[1] * s, r[4] * s, r[7] * s, 0, r[2] * s, r[5] * s, r[8] * s, 0, m.pos[0], m.pos[1], m.pos[2], 1];
}
export function toWorld(m: Pick<MeshRec, 'pos' | 'rot' | 'scale'>, p: V3): V3 {
  const r = rotation(m.rot), s = m.scale;
  return [m.pos[0] + s * (r[0] * p[0] + r[1] * p[1] + r[2] * p[2]), m.pos[1] + s * (r[3] * p[0] + r[4] * p[1] + r[5] * p[2]), m.pos[2] + s * (r[6] * p[0] + r[7] * p[1] + r[8] * p[2])];
}
export function toLocal(m: Pick<MeshRec, 'pos' | 'rot' | 'scale'>, p: V3): V3 {
  const r = rotation(m.rot), s = m.scale;
  const x = (p[0] - m.pos[0]) / s, y = (p[1] - m.pos[1]) / s, z = (p[2] - m.pos[2]) / s;
  return [r[0] * x + r[3] * y + r[6] * z, r[1] * x + r[4] * y + r[7] * z, r[2] * x + r[5] * y + r[8] * z];
}
/** A direction (no translation, no scale) into the mesh's frame, and back. */
export function dirToLocal(m: Pick<MeshRec, 'rot'>, d: V3): V3 {
  const r = rotation(m.rot);
  return [r[0] * d[0] + r[3] * d[1] + r[6] * d[2], r[1] * d[0] + r[4] * d[1] + r[7] * d[2], r[2] * d[0] + r[5] * d[1] + r[8] * d[2]];
}
export function dirToWorld(m: Pick<MeshRec, 'rot'>, d: V3): V3 {
  const r = rotation(m.rot);
  return [r[0] * d[0] + r[1] * d[1] + r[2] * d[2], r[3] * d[0] + r[4] * d[1] + r[5] * d[2], r[6] * d[0] + r[7] * d[1] + r[8] * d[2]];
}

/** World box of a record. */
export function worldBox(rec: MeshRec): { min: V3; max: V3 } {
  const b = decode(rec).box;
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < 8; k++) {
    const w = toWorld(rec, [k & 1 ? b.max[0] : b.min[0], k & 2 ? b.max[1] : b.min[1], k & 4 ? b.max[2] : b.min[2]]);
    for (let c = 0; c < 3; c++) { if (w[c] < lo[c]) lo[c] = w[c]; if (w[c] > hi[c]) hi[c] = w[c]; }
  }
  return { min: lo, max: hi };
}
/** Box of all the visible records (null for none). */
export function allWorldBox(recs: MeshRec[]): { min: V3; max: V3 } | null {
  let out: { min: V3; max: V3 } | null = null;
  for (const r of recs) {
    if (!r.visible) continue;
    const b = worldBox(r);
    out = out ? { min: [Math.min(out.min[0], b.min[0]), Math.min(out.min[1], b.min[1]), Math.min(out.min[2], b.min[2])], max: [Math.max(out.max[0], b.max[0]), Math.max(out.max[1], b.max[1]), Math.max(out.max[2], b.max[2])] } : b;
  }
  return out;
}

// ---- queries (world space) ----

export interface SurfaceHit { id: string; pos: V3; normal: V3; /** along the ray, in the ray's own units (a unit ray: distance) */ t?: number }

/** Nearest surface point of the visible meshes along a world ray. */
export function pickMeshes(recs: MeshRec[], ray: { o: V3; d: V3 }): SurfaceHit | null {
  let best: SurfaceHit | null = null;
  for (const r of recs) {
    if (!r.visible) continue;
    const h = raycast(decode(r).bvh(), toLocal(r, ray.o), dirToLocal(r, ray.d).map((x) => x / r.scale) as V3);
    if (h && (!best || h.t < best.t!)) best = { id: r.id, pos: toWorld(r, h.point), normal: dirToWorld(r, h.normal), t: h.t };
  }
  return best;
}

/** The surface point nearest to `p` (within `maxDist` world units). */
export function nearestOnMeshes(recs: MeshRec[], p: V3, maxDist = Infinity): SurfaceHit | null {
  let best: (SurfaceHit & { dist: number }) | null = null;
  for (const r of recs) {
    if (!r.visible) continue;
    const h = closestPoint(decode(r).bvh(), toLocal(r, p), maxDist / r.scale);
    if (h && (!best || h.dist * r.scale < best.dist)) best = { id: r.id, pos: toWorld(r, h.point), normal: dirToWorld(r, h.normal), dist: h.dist * r.scale };
  }
  return best;
}

/** `p` pushed onto the surface along `dir` (either way, the nearer hit); null when the line misses. */
export function projectAlong(recs: MeshRec[], p: V3, dir: V3): SurfaceHit | null {
  const fwd = pickMeshes(recs, { o: p, d: dir });
  const back = pickMeshes(recs, { o: p, d: [-dir[0], -dir[1], -dir[2]] });
  if (fwd && back) return fwd.t! <= back.t! ? fwd : back;
  return fwd ?? back;
}

export { UNIT_MM };
