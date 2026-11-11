// The heavy parts of a document and how they travel. A part carries two kinds: reference meshes (`meshes`, an imported STL or SketchUp
// model: megabytes of vertices and triangles) and blobs (`blobs`, the STEP text an `importStep` feature holds). In memory both stay
// as the kernel and the viewer want them (a mesh record with base64 of its raw arrays, a blob as text). Everything that leaves the
// app (the .ckpart file, the browser's backup, the recovery snapshots) goes through `packDoc`, and everything that comes in goes
// through `unpackDoc`:
//
//   * a mesh becomes `{ ...its settings, fmt: 2, z, n, crc, c }`: z = base64 of the deflated packed payload (packages/io/src/meshPack.ts:
//     vertices on a grid of at most 1 micron stored as deltas, triangle corners as distances to the newest vertex, a material run-length
//     list, then deflate), n = payload bytes, crc = checksum of the payload, c = 1 when z is deflated;
//   * the blobs table becomes `blobsZ: { <key>: { z, n, c } }`, z = base64 of the deflated UTF-8 text; `blobs` is dropped;
//   * the document gets `assets: 2`.
// Older files are read as they are: a mesh with `v` and `i` (the first version stored them as raw base64) and a plain `blobs` table
// pass through and are packed the next time the part is saved. A file saved by this version opened by an older build loses the meshes
// (the older reader only knows `v` / `i`) and reports the STEP import as missing its data; nothing else changes.
// A damaged asset (cut off, not inflatable, failing its checksum, an index out of range) never fails the open: it is left out, the
// rest of the part loads, and `unpackDoc` lists what was dropped and why.
import { canDeflate, checksumBytes, decodeMeshAsync, deflateRaw, encodeMeshAsync, inflateRaw, MeshPackError } from '@kit/io';
import { base64ToBytes, bytesToBase64, bytesToBase64Async, decode, DEFAULT_MESH_COLOR, seedDecoded, sigOf, type MeshMat, type MeshRec } from '../meshes/meshDoc';

/** The `assets` field of a document written by this version. */
export const ASSETS_VERSION = 2;

export type AssetProblem =
  | { kind: 'mesh'; name: string; reason: 'damaged' | 'newer' | 'unsupported' }
  | { kind: 'blob'; key: string; reason: 'damaged' | 'unsupported' };

type Obj = Record<string, unknown>;
interface PackedGeo { z: string; n: number; crc: number; c: 0 | 1 }
interface PackedBlob { z: string; n: number; c: 0 | 1 }

const enc = new TextEncoder(), dec = new TextDecoder('utf-8', { fatal: true });

// ---- caches: what has been packed, by content ----

const geoCache = new Map<string, PackedGeo>();
const blobCache = new Map<string, PackedBlob>();
const CACHE_MAX = 8;
const remember = <V,>(m: Map<string, V>, k: string, v: V): void => { m.delete(k); m.set(k, v); while (m.size > CACHE_MAX * 4) m.delete(m.keys().next().value as string); };
const geoKey = (r: MeshRec): string => `${r.sig}|${r.v.length}|${r.i.length}|${r.m?.length ?? 0}`;
/** Forget what was packed (tests, and the heap when a big part is closed). */
export function clearAssetCaches(): void { geoCache.clear(); blobCache.clear(); }

// ---- meshes ----

async function packGeo(rec: MeshRec): Promise<PackedGeo> {
  const key = geoKey(rec);
  const hit = geoCache.get(key);
  if (hit) return hit;
  const mesh = decode(rec);
  const { payload } = await encodeMeshAsync({ vertices: mesh.mesh.vertices, indices: mesh.mesh.indices, ...(mesh.tm ? { tm: mesh.tm } : {}) });
  const crc = checksumBytes(payload);
  const z = canDeflate() ? await deflateRaw(payload) : payload;
  const geo: PackedGeo = { z: bytesToBase64(z), n: payload.length, crc, c: canDeflate() ? 1 : 0 };
  remember(geoCache, key, geo);
  return geo;
}

const packedMeta = (rec: MeshRec): Obj => {
  const { v: _v, i: _i, m: _m, ...meta } = rec;
  return meta as unknown as Obj;
};

/** The packed form of one record (async: the deflate runs off the main thread, the rest in slices). */
export async function packMesh(rec: MeshRec): Promise<Obj> {
  return { ...packedMeta(rec), fmt: ASSETS_VERSION, ...(await packGeo(rec)) };
}

async function unpackMesh(p: Obj): Promise<MeshRec> {
  const z = p.z, n = p.n, crc = p.crc;
  if (typeof z !== 'string' || typeof n !== 'number' || typeof crc !== 'number' || !(n > 0) || n > 0x40000000) throw new MeshPackError('size');
  const raw = base64ToBytes(z);
  let payload: Uint8Array;
  if (p.c === 0) payload = raw;
  else {
    if (!canDeflate()) throw new MeshPackError('size');
    payload = await inflateRaw(raw, n + 16);
  }
  if (payload.length !== n || checksumBytes(payload) !== crc) throw new MeshPackError('size');
  const a = await decodeMeshAsync(payload);
  const tris = a.indices.length / 3;
  const mats = Array.isArray(p.mats) ? (p.mats as MeshMat[]) : undefined;
  if (a.tm && !mats) throw new MeshPackError('size');
  if (mats && a.tm) for (let t = 0; t < a.tm.length; t++) if (a.tm[t] >= mats.length && a.tm[t] !== 0xffff) throw new MeshPackError('range');
  const { z: _z, n: _n, crc: _c, c: _cc, fmt: _f, ...meta } = p;
  const rec = {
    ...meta,
    tris, verts: a.vertices.length / 3,
    sig: tris + ':' + sigOf(a.vertices, a.tm),
    v: await bytesToBase64Async(new Uint8Array(a.vertices.buffer, 0, a.vertices.byteLength)),
    i: await bytesToBase64Async(new Uint8Array(a.indices.buffer, 0, a.indices.byteLength)),
    ...(a.tm ? { m: await bytesToBase64Async(new Uint8Array(a.tm.buffer, 0, a.tm.byteLength)) } : {}),
  } as unknown as MeshRec;
  if (typeof rec.color !== 'string') rec.color = DEFAULT_MESH_COLOR;
  seedDecoded(rec, { vertices: a.vertices, indices: a.indices, ...(a.tm ? { tm: a.tm } : {}) });
  remember(geoCache, geoKey(rec), { z, n, crc, c: p.c === 0 ? 0 : 1 });   // saving it again costs nothing
  return rec;
}

// ---- blobs ----

async function packBlob(key: string, text: string): Promise<PackedBlob> {
  const hit = blobCache.get(key);
  if (hit) return hit;
  const bytes = enc.encode(text);
  const z = canDeflate() ? await deflateRaw(bytes) : bytes;
  const out: PackedBlob = { z: bytesToBase64(z), n: bytes.length, c: canDeflate() ? 1 : 0 };
  remember(blobCache, key, out);
  return out;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource)), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function unpackBlob(key: string, p: PackedBlob): Promise<string> {
  if (typeof p?.z !== 'string' || typeof p.n !== 'number') throw new MeshPackError('size');
  const raw = base64ToBytes(p.z);
  let bytes: Uint8Array;
  if (p.c === 0) bytes = raw;
  else { if (!canDeflate()) throw new MeshPackError('size'); bytes = await inflateRaw(raw, p.n + 16); }
  if (bytes.length !== p.n) throw new MeshPackError('size');
  if (/^[0-9a-f]{64}$/i.test(key) && (await sha256Hex(bytes)) !== key.toLowerCase()) throw new MeshPackError('size');
  const text = dec.decode(bytes);
  remember(blobCache, key, { z: p.z, n: p.n, c: p.c === 0 ? 0 : 1 });
  return text;
}

// ---- documents ----

const meshList = (doc: Obj): Obj[] => (Array.isArray(doc.meshes) ? (doc.meshes as Obj[]).filter((m) => m && typeof m === 'object') : []);
const isRawMesh = (m: Obj): boolean => typeof m.v === 'string' && typeof m.i === 'string';
const rawBlobs = (doc: Obj): Array<[string, string]> => (doc.blobs && typeof doc.blobs === 'object' ? Object.entries(doc.blobs as Obj).filter((e): e is [string, string] => typeof e[1] === 'string') : []);

/** Whether the document carries anything `packDoc` would change. */
export const hasRawAssets = (doc: unknown): boolean => { const d = doc as Obj | null; return !!d && (meshList(d).some(isRawMesh) || rawBlobs(d).length > 0); };

/** Pack the heavy parts of a document (a copy; the argument is not touched). Nothing to pack: the same object. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the packed form has fields the document type does not (z, blobsZ, assets)
export async function packDoc<T extends object>(doc: T): Promise<T & Record<string, any>> {
  const d = doc as unknown as Obj;
  if (!hasRawAssets(d)) return doc;
  const out: Obj = { ...d };
  if (meshList(d).some(isRawMesh)) out.meshes = await Promise.all(meshList(d).map((m) => (isRawMesh(m) ? packMesh(m as unknown as MeshRec) : m)));
  const blobs = rawBlobs(d);
  if (blobs.length) {
    const z: Obj = { ...((d.blobsZ as Obj | undefined) ?? {}) };
    for (const [k, text] of blobs) z[k] = await packBlob(k, text);
    out.blobsZ = z;
    const left = Object.fromEntries(Object.entries(d.blobs as Obj).filter(([, v]) => typeof v !== 'string'));
    if (Object.keys(left).length) out.blobs = left; else delete out.blobs;
  }
  out.assets = ASSETS_VERSION;
  return out as unknown as T;
}

/** The same from what is already packed (the caches), without waiting: for the backups, which run on a timer and must not stall. A mesh
 *  or blob not packed yet stays in its raw form. With `budget` (characters), meshes are left out once the total passes it (their names are
 *  returned); blobs are never left out, the part would not rebuild. */
export function packDocCached<T extends object>(doc: T, budget = Infinity): { doc: T; omitted: string[] } {
  const d = doc as unknown as Obj;
  if (!hasRawAssets(d)) return { doc, omitted: [] };
  const out: Obj = { ...d };
  const omitted: string[] = [];
  let used = 0;
  const blobs = rawBlobs(d);
  if (blobs.length) {
    const z: Obj = { ...((d.blobsZ as Obj | undefined) ?? {}) };
    const kept: Obj = { ...((d.blobs as Obj | undefined) ?? {}) };
    for (const [k, text] of blobs) {
      const hit = blobCache.get(k);
      if (hit) { z[k] = hit; delete kept[k]; used += hit.z.length; } else used += text.length;
    }
    if (Object.keys(z).length) out.blobsZ = z;
    if (Object.keys(kept).length) out.blobs = kept; else delete out.blobs;
  }
  if (meshList(d).length) {
    const list: Obj[] = [];
    for (const m of meshList(d)) {
      if (!isRawMesh(m)) { list.push(m); continue; }
      const hit = geoCache.get(geoKey(m as unknown as MeshRec));
      const cost = hit ? hit.z.length : (m.v as string).length + (m.i as string).length;
      if (used + cost > budget) { omitted.push(String(m.name ?? m.id ?? 'mesh')); continue; }
      used += cost;
      list.push(hit ? { ...packedMeta(m as unknown as MeshRec), fmt: ASSETS_VERSION, ...hit } : m);
    }
    if (list.length) out.meshes = list; else delete out.meshes;
  }
  if (out.blobsZ || (Array.isArray(out.meshes) && (out.meshes as Obj[]).some((m) => !isRawMesh(m)))) out.assets = ASSETS_VERSION;
  return { doc: out as unknown as T, omitted };
}

/** Pack what is not packed yet, so the next `packDocCached` is complete (call after an import, an undo or a load; cheap when warm). */
export async function warmPackCache(doc: unknown): Promise<void> {
  const d = doc as Obj | null;
  if (!d) return;
  for (const m of meshList(d)) if (isRawMesh(m)) await packGeo(m as unknown as MeshRec);
  for (const [k, text] of rawBlobs(d)) await packBlob(k, text);
}

/** The document as the app holds it: packed meshes and blobs unpacked (a copy). Records that cannot be read are left out and listed. */
export async function unpackDoc<T extends object>(doc: T): Promise<{ doc: T; problems: AssetProblem[] }> {
  const d = doc as unknown as Obj;
  const problems: AssetProblem[] = [];
  const packedMeshes = meshList(d).filter((m) => !isRawMesh(m));
  const hasZ = !!d.blobsZ && typeof d.blobsZ === 'object';
  if (!packedMeshes.length && !hasZ && d.assets === undefined) return { doc, problems };
  const out: Obj = { ...d };
  delete out.assets; delete out.blobsZ;
  if (Array.isArray(d.meshes)) {
    const list: Obj[] = [];
    for (const m of d.meshes as Obj[]) {
      if (!m || typeof m !== 'object') continue;
      if (isRawMesh(m)) { list.push(m); continue; }
      const name = typeof m.name === 'string' ? m.name : String(m.id ?? 'mesh');
      if (typeof m.fmt === 'number' && m.fmt > ASSETS_VERSION) { problems.push({ kind: 'mesh', name, reason: 'newer' }); continue; }
      if (m.fmt !== ASSETS_VERSION || typeof m.id !== 'string') { problems.push({ kind: 'mesh', name, reason: 'unsupported' }); continue; }
      try { list.push(await unpackMesh(m) as unknown as Obj); } catch { problems.push({ kind: 'mesh', name, reason: 'damaged' }); }
    }
    if (list.length) out.meshes = list; else delete out.meshes;
  }
  if (hasZ) {
    const blobs: Obj = { ...((d.blobs as Obj | undefined) ?? {}) };
    for (const [k, p] of Object.entries(d.blobsZ as Obj)) {
      try { blobs[k] = await unpackBlob(k, p as PackedBlob); } catch { problems.push({ kind: 'blob', key: k, reason: 'damaged' }); }
    }
    if (Object.keys(blobs).length) out.blobs = blobs;
  }
  return { doc: out as unknown as T, problems };
}

/** The document without the weight of its assets, for comparing two states ("is this part changed since the last save"): a mesh keeps its
 *  settings, signature and sizes but not its arrays, a blob (keyed by the hash of its text) only its size. */
export function lightDoc<T extends object>(doc: T): T {
  const d = doc as unknown as Obj;
  if (!hasRawAssets(d) && !d.blobsZ) return doc;
  const out: Obj = { ...d };
  if (Array.isArray(d.meshes)) out.meshes = (d.meshes as Obj[]).map((m) => (m && isRawMesh(m) ? { ...m, v: (m.v as string).length, i: (m.i as string).length, ...(typeof m.m === 'string' ? { m: m.m.length } : {}) } : m));
  if (d.blobs && typeof d.blobs === 'object') out.blobs = Object.fromEntries(Object.entries(d.blobs as Obj).map(([k, v]) => [k, typeof v === 'string' ? v.length : v]));
  return out as unknown as T;
}

/** Size of the heavy parts as they would be written (characters of base64), for the notices and the measurements. */
export function assetSize(doc: unknown): { meshes: number; blobs: number } {
  const d = doc as Obj;
  let meshes = 0, blobs = 0;
  for (const m of meshList(d)) meshes += isRawMesh(m) ? (m.v as string).length + (m.i as string).length + (typeof m.m === 'string' ? m.m.length : 0) : typeof m.z === 'string' ? m.z.length : 0;
  for (const [, v] of rawBlobs(d)) blobs += v.length;
  if (d.blobsZ && typeof d.blobsZ === 'object') for (const v of Object.values(d.blobsZ as Obj)) blobs += (v as PackedBlob).z?.length ?? 0;
  return { meshes, blobs };
}

/** The words for what `unpackDoc` dropped, one notice each. */
export function problemKey(p: AssetProblem): { key: string; params: Record<string, string> } {
  if (p.kind === 'mesh') return { key: `files.assets.mesh.${p.reason}`, params: { name: p.name } };
  return { key: `files.assets.blob.${p.reason}`, params: { key: p.key.slice(0, 8) } };
}

/** The text of a document file with its assets packed (a frozen part exported from a folder holds its STEP text). Text that is not a document is returned as it is. */
export async function packText(text: string): Promise<string> {
  try {
    const d = JSON.parse(text) as object;
    return hasRawAssets(d) ? JSON.stringify(await packDoc(d), null, 1) : text;
  } catch { return text; }
}
