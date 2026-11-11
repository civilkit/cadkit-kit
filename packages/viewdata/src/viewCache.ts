// The view snapshot: what the viewer needs to show a part before the kernel has rebuilt it (mesh, edges, sketch frames, the
// tree's feature statuses). It is a cache of a regen reply, never an input to the kernel: the recipe stays the source of truth.
//
// Key: SHA-256 of the canonical recipe (the document as the kernel gets it) and a build id of the kernel (SHA-256 of the wasm
// bytes). A snapshot is shown only when both match what is being opened; anything else (wrong key, other build, corrupt bytes,
// a version this code does not know) is ignored and the part is rebuilt as usual.
//
// Stored in IndexedDB beside the file store (the .ckpart itself stays plain JSON). Binary layout of one record:
//   'CKVC' | version u8 | flags u8 (1 = gzip) | 2 pad | payload
//   payload = u32 headerLen | header JSON | pad to 4 | typed-array sections (f32 / i32 / u32, little endian, back to back)
// The header holds the snapshot with every typed array replaced by a reference to a section. A mesh is stored welded
// (f32 positions and normals once per distinct vertex, u32 indices) and expanded back to the unindexed arrays on read.
import type { FeatureStatus } from '@kit/store';

export const VIEW_VERSION = 1;
const MAGIC = [0x43, 0x4b, 0x56, 0x43];   // 'CKVC'

/** Everything the controller shows after a rebuild, in a form that survives JSON plus typed arrays. */
export interface ViewData {
  /** the body handed to the viewer: mesh, edges, box, sketches, curves, planes, markers and the surface bodies (null: nothing to show) */
  body: unknown | null;
  status: FeatureStatus[];
  extras: { threads: unknown[]; warnings: unknown[] };
  errors: unknown[];
  diag: unknown;
  limits: Array<[string, number]>;
  components: unknown[];
}

export interface ViewSnapshot { key: string; build: string; savedAt: number; data: ViewData }

// ---- keys ----

/** JSON with sorted keys, undefined and functions dropped, non-finite numbers as null: what JSON.stringify would give after a parse. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
  if (Array.isArray(v)) return '[' + v.map((x) => (x === undefined || typeof x === 'function' ? 'null' : canonicalJson(x))).join(',') + ']';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const parts: string[] = [];
    for (const k of Object.keys(o).sort()) {
      const x = o[k];
      if (x === undefined || typeof x === 'function') continue;
      parts.push(JSON.stringify(k) + ':' + canonicalJson(x));
    }
    return '{' + parts.join(',') + '}';
  }
  return 'null';
}

const hex = (b: ArrayBuffer): string => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
export async function sha256Hex(data: string | Uint8Array | ArrayBuffer): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  return hex(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

/** What the kernel is given of a document: the fonts, the reference meshes (megabytes the kernel never reads) and the file's picture travel beside it, not in it. */
export function recipeOf(doc: unknown): unknown {
  const { fonts: _f, meshes: _m, thumbnail: _t, [EMBED_FIELD]: _v, ...rest } = doc as Record<string, unknown>;
  return rest;
}
/** SHA-256 of the canonical recipe. */
export const recipeKey = (doc: unknown): Promise<string> => sha256Hex(canonicalJson(recipeOf(doc)));

/** The build id of the built-in kernel: the hash of its wasm file. (The kernel's own commit string is a constant that is not bumped per build.) */
export function createBuildId(fetchWasm: () => Promise<ArrayBuffer>): () => Promise<string | null> {
  let p: Promise<string | null> | null = null;
  return () => (p ??= fetchWasm().then((b) => sha256Hex(b)).then((h) => 'wasm-sha256:' + h).catch(() => null));
}

// ---- codec ----

type Sec = { t: 'f32' | 'i32' | 'u32'; n: number };
type Typed = Float32Array | Int32Array | Uint32Array;

function weld(positions: Float32Array, normals: Float32Array): { pos: Float32Array; nrm: Float32Array; idx: Uint32Array } {
  const verts = positions.length / 3;
  const pu = new Uint32Array(positions.buffer, positions.byteOffset, positions.length);
  const nu = new Uint32Array(normals.buffer, normals.byteOffset, normals.length);
  let size = 16;
  while (size < verts * 2) size <<= 1;
  const table = new Int32Array(size).fill(-1);
  const idx = new Uint32Array(verts);
  const first: number[] = [];
  for (let v = 0; v < verts; v++) {
    const a = pu[v * 3], b = pu[v * 3 + 1], c = pu[v * 3 + 2], d = nu[v * 3], e = nu[v * 3 + 1], f = nu[v * 3 + 2];
    let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b, 0xc2b2ae35) ^ Math.imul(c ^ 0x7f4a7c15, 0x27d4eb2f) ^ Math.imul(d, 0x165667b1) ^ Math.imul(e, 0x85ebca77) ^ Math.imul(f, 0xc2b2ae3d);
    h = (h ^ (h >>> 15)) & (size - 1);
    for (;;) {
      const s = table[h];
      if (s < 0) { table[h] = first.length; idx[v] = first.length; first.push(v); break; }
      const u = first[s];
      if (pu[u * 3] === a && pu[u * 3 + 1] === b && pu[u * 3 + 2] === c && nu[u * 3] === d && nu[u * 3 + 1] === e && nu[u * 3 + 2] === f) { idx[v] = s; break; }
      h = (h + 1) & (size - 1);
    }
  }
  const pos = new Float32Array(first.length * 3), nrm = new Float32Array(first.length * 3);
  for (let i = 0; i < first.length; i++) { const v = first[i]; pos.set(positions.subarray(v * 3, v * 3 + 3), i * 3); nrm.set(normals.subarray(v * 3, v * 3 + 3), i * 3); }
  return { pos, nrm, idx };
}

const isTyped = (v: unknown): v is Typed => v instanceof Float32Array || v instanceof Int32Array || v instanceof Uint32Array;
const isMesh = (v: unknown): v is { positions: Float32Array; normals: Float32Array; triFace: Int32Array; faceIds: string[] } => {
  const m = v as Record<string, unknown> | null;
  return !!m && typeof m === 'object' && m.positions instanceof Float32Array && m.normals instanceof Float32Array && m.triFace instanceof Int32Array
    && m.positions.length === m.normals.length && m.positions.length === m.triFace.length * 9 && Array.isArray(m.faceIds);
};

/** Replace typed arrays by section references; collect the sections. */
function pack(v: unknown, secs: Typed[]): unknown {
  const add = (a: Typed): number => secs.push(a) - 1;
  if (isMesh(v)) {
    const w = weld(v.positions, v.normals);
    return { $m: { p: add(w.pos), n: add(w.nrm), i: add(w.idx), f: add(v.triFace), ids: v.faceIds } };
  }
  if (isTyped(v)) return { $a: add(v) };
  if (Array.isArray(v)) return v.map((x) => pack(x, secs));
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined && typeof x !== 'function') out[k] = pack(x, secs);
    return out;
  }
  return v;
}

class Bad extends Error {}
function unpack(v: unknown, secs: Typed[], depth = 0): unknown {
  if (depth > 64) throw new Bad('deep');
  const sec = (i: unknown, t: Sec['t']): Typed => {
    const a = typeof i === 'number' ? secs[i] : undefined;
    if (!a || (t === 'f32' ? !(a instanceof Float32Array) : t === 'i32' ? !(a instanceof Int32Array) : !(a instanceof Uint32Array))) throw new Bad('section');
    return a;
  };
  if (Array.isArray(v)) return v.map((x) => unpack(x, secs, depth + 1));
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 1 && keys[0] === '$a') { if (typeof o.$a !== 'number' || !secs[o.$a]) throw new Bad('ref'); return secs[o.$a]; }
    if (keys.length === 1 && keys[0] === '$m') {
      const m = o.$m as { p: unknown; n: unknown; i: unknown; f: unknown; ids: unknown };
      const pos = sec(m.p, 'f32') as Float32Array, nrm = sec(m.n, 'f32') as Float32Array, idx = sec(m.i, 'u32') as Uint32Array, tf = sec(m.f, 'i32') as Int32Array;
      if (!Array.isArray(m.ids) || m.ids.some((x) => typeof x !== 'string')) throw new Bad('ids');
      const verts = pos.length / 3;
      if (nrm.length !== pos.length || idx.length !== tf.length * 3 || !Number.isInteger(verts)) throw new Bad('mesh');
      const positions = new Float32Array(idx.length * 3), normals = new Float32Array(idx.length * 3);
      for (let i = 0; i < idx.length; i++) {
        const s = idx[i];
        if (s >= verts) throw new Bad('index');
        positions[i * 3] = pos[s * 3]; positions[i * 3 + 1] = pos[s * 3 + 1]; positions[i * 3 + 2] = pos[s * 3 + 2];
        normals[i * 3] = nrm[s * 3]; normals[i * 3 + 1] = nrm[s * 3 + 1]; normals[i * 3 + 2] = nrm[s * 3 + 2];
      }
      for (let i = 0; i < tf.length; i++) if (tf[i] >= (m.ids as string[]).length) throw new Bad('face');
      return { positions, normals, triFace: tf, faceIds: m.ids as string[] };
    }
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = unpack(o[k], secs, depth + 1);
    return out;
  }
  return v;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const w = stream.writable.getWriter();
  void w.write(bytes as BufferSource).then(() => w.close()).catch(() => {});   // not awaited: the reader below drains it (no deadlock on backpressure)
  const r = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) { const { done, value } = await r.read(); if (done) break; chunks.push(value as Uint8Array); n += value.length; }
  const out = new Uint8Array(n);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}
const canGzip = (): boolean => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

/** Serialise a snapshot. Compressed with gzip where the platform has it. */
export async function encodeSnapshot(s: ViewSnapshot): Promise<Uint8Array> {
  const secs: Typed[] = [];
  const header = new TextEncoder().encode(JSON.stringify({ key: s.key, build: s.build, savedAt: s.savedAt, data: pack(s.data, secs), secs: secs.map((a): Sec => ({ t: a instanceof Float32Array ? 'f32' : a instanceof Int32Array ? 'i32' : 'u32', n: a.length })) }));
  const hpad = (4 - ((4 + header.length) & 3)) & 3;
  const total = 4 + header.length + hpad + secs.reduce((n, a) => n + a.byteLength, 0);
  const raw = new Uint8Array(total);
  new DataView(raw.buffer).setUint32(0, header.length, true);
  raw.set(header, 4);
  let at = 4 + header.length + hpad;
  for (const a of secs) { raw.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), at); at += a.byteLength; }
  const gz = canGzip();
  const body = gz ? await pipe(raw, new CompressionStream('gzip')) : raw;
  const out = new Uint8Array(8 + body.length);
  out.set(MAGIC, 0); out[4] = VIEW_VERSION; out[5] = gz ? 1 : 0;
  out.set(body, 8);
  return out;
}

/** Read a snapshot; null for anything that is not a well-formed snapshot of this version (never throws). */
export async function decodeSnapshot(bytes: Uint8Array): Promise<ViewSnapshot | null> {
  try {
    if (bytes.length < 12 || MAGIC.some((m, i) => bytes[i] !== m) || bytes[4] !== VIEW_VERSION) return null;
    let payload = bytes.subarray(8);
    if (bytes[5] & 1) { if (!canGzip()) return null; payload = await pipe(payload, new DecompressionStream('gzip')); }
    // a view on a buffer whose offset is a multiple of 4
    const raw = payload.byteOffset % 4 === 0 ? payload : payload.slice();
    const hl = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint32(0, true);
    if (hl > raw.length - 4) return null;
    const head = JSON.parse(new TextDecoder().decode(raw.subarray(4, 4 + hl))) as { key: unknown; build: unknown; savedAt: unknown; data: unknown; secs: unknown };
    if (typeof head.key !== 'string' || typeof head.build !== 'string' || typeof head.savedAt !== 'number' || !Array.isArray(head.secs)) return null;
    let at = 4 + hl + ((4 - ((4 + hl) & 3)) & 3);
    const secs: Typed[] = [];
    for (const s of head.secs as Sec[]) {
      if (!s || !['f32', 'i32', 'u32'].includes(s.t) || !Number.isInteger(s.n) || s.n < 0 || at + s.n * 4 > raw.length) return null;
      const view = (C: typeof Float32Array | typeof Int32Array | typeof Uint32Array): Typed => new C(raw.buffer as ArrayBuffer, raw.byteOffset + at, s.n);
      secs.push(s.t === 'f32' ? view(Float32Array) : s.t === 'i32' ? view(Int32Array) : view(Uint32Array));
      at += s.n * 4;
    }
    const data = unpack(head.data, secs) as ViewData;
    if (!data || typeof data !== 'object' || !Array.isArray(data.status) || !Array.isArray(data.limits) || !Array.isArray(data.errors) || !Array.isArray(data.components) || !data.extras) return null;
    return { key: head.key, build: head.build, savedAt: head.savedAt, data };
  } catch { return null; }
}

// ---- storage ----

export interface ViewRecord { key: string; build: string; savedAt: number; bytes: Uint8Array }
export interface ViewBackend {
  get(key: string): Promise<ViewRecord | undefined>;
  put(r: ViewRecord): Promise<void>;
  all(): Promise<Array<Pick<ViewRecord, 'key' | 'savedAt'> & { size: number }>>;
  remove(keys: string[]): Promise<void>;
}

export function memoryViewBackend(): ViewBackend & { items: Map<string, ViewRecord> } {
  const items = new Map<string, ViewRecord>();
  return {
    items,
    async get(k) { return items.get(k); },
    async put(r) { items.set(r.key, r); },
    async all() { return [...items.values()].map((r) => ({ key: r.key, savedAt: r.savedAt, size: r.bytes.length })); },
    async remove(ks) { for (const k of ks) items.delete(k); },
  };
}

export function idbViewBackend(dbName = 'cad.viewcache.v1'): ViewBackend | null {
  if (typeof indexedDB === 'undefined') return null;
  let dbp: Promise<IDBDatabase> | null = null;
  const open = () => (dbp ??= new Promise<IDBDatabase>((res, rej) => {
    const rq = indexedDB.open(dbName, 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('views', { keyPath: 'key' });
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => { dbp = null; rej(rq.error); };
  }));
  const run = async <T,>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> => {
    const db = await open();
    return new Promise((res, rej) => {
      const tx = db.transaction('views', mode);
      const rq = f(tx.objectStore('views'));
      tx.oncomplete = () => res(rq ? rq.result : undefined);
      tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
    });
  };
  return {
    async get(k) { return (await run('readonly', (s) => s.get(k))) as ViewRecord | undefined; },
    async put(r) { await run('readwrite', (s) => { s.put(r); }); },
    async all() { return (((await run('readonly', (s) => s.getAll())) as ViewRecord[] | undefined) ?? []).map((r) => ({ key: r.key, savedAt: r.savedAt, size: r.bytes?.length ?? 0 })); },
    async remove(ks) { await run('readwrite', (s) => { for (const k of ks) s.delete(k); }); },
  };
}

export const VIEW_KEEP = 8;
export const VIEW_BUDGET = 96 * 1024 * 1024;

/** Which records to drop: all but the newest VIEW_KEEP, and the oldest while the total is over the budget (the newest always stays). */
export function pruneViews(list: Array<{ key: string; savedAt: number; size: number }>, keep = VIEW_KEEP, budget = VIEW_BUDGET): string[] {
  const sorted = [...list].sort((a, b) => b.savedAt - a.savedAt);
  const drop: string[] = sorted.slice(keep).map((r) => r.key);
  let total = 0;
  sorted.slice(0, keep).forEach((r, i) => { total += r.size; if (i > 0 && total > budget) drop.push(r.key); });
  return drop;
}

export function createViewCache(backend: ViewBackend | null, opts: { now?: () => number } = {}) {
  const now = opts.now ?? Date.now;
  let queue: Promise<unknown> = Promise.resolve();
  return {
    /** Keep the snapshot of the recipe `key` built by kernel `build`. Never rejects. */
    save(key: string, build: string, data: ViewData): Promise<void> {
      if (!backend) return Promise.resolve();
      const job = queue.then(async () => {
        const bytes = await encodeSnapshot({ key, build, savedAt: now(), data });
        await backend.put({ key, build, savedAt: now(), bytes });
        await backend.remove(pruneViews(await backend.all()));
      }).catch(() => {});
      queue = job;
      return job;
    },
    /** The snapshot for this recipe and kernel, or null (missing, other build, corrupt: the part is then rebuilt as usual). */
    async lookup(key: string, build: string): Promise<ViewSnapshot | null> {
      if (!backend) return null;
      try {
        const r = await backend.get(key);
        if (!r || r.build !== build || !(r.bytes instanceof Uint8Array)) return null;
        const s = await decodeSnapshot(r.bytes);
        if (s && s.key === key && s.build === build) return s;
        await backend.remove([key]).catch(() => {});   // unreadable: do not keep trying
        return null;
      } catch { return null; }
    },
    /** Resolves when every write so far has finished (tests). */
    settled(): Promise<unknown> { return queue; },
  };
}

// ---- what the app does with it ----
type Cache = Pick<ReturnType<typeof createViewCache>, 'lookup' | 'save'>;

/** The stored view of this document for the running kernel, or null. Any problem (no kernel id, hashing fails, nothing stored) is a null. */
export async function findSnapshot(cache: Cache, build: () => Promise<string | null>, doc: unknown): Promise<ViewSnapshot | null> {
  try {
    const b = await build();
    if (!b) return null;
    return await cache.lookup(await recipeKey(doc), b);
  } catch { return null; }
}

/** Keep `data` (taken from the controller in the same tick as `doc`) for this document and kernel. Never rejects. */
export async function keepSnapshot(cache: Cache, build: () => Promise<string | null>, doc: unknown, data: ViewData | null): Promise<void> {
  try {
    const b = await build();
    if (!b || !data) return;
    await cache.save(await recipeKey(doc), b, data);
  } catch { /* the cache is optional */ }
}


// ---- the view inside the file ----
// A part can carry its own view: the same snapshot, written as the base64 of its binary form in a top-level field (like the
// thumbnail). Opened on a machine that has never seen the part, it is shown at once and the kernel rebuilds behind it. It is used
// only when its recipe key and kernel build match, so an edited file, or one saved by another kernel, just rebuilds as always.

/** Name of the file's top-level field that holds the view. */
export const EMBED_FIELD = 'viewCache';
export interface EmbeddedView { format: 'ck-view'; version: number; key: string; build: string; data: string }

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(text: string): Uint8Array { const bin = atob(text); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }

/** The view of `doc` (as it will be written) as a file field; null when there is no kernel id or no view. Never rejects. */
export async function embedSnapshot(build: () => Promise<string | null>, doc: unknown, data: ViewData | null): Promise<EmbeddedView | null> {
  try {
    const b = await build();
    if (!b || !data) return null;
    const key = await recipeKey(doc);
    return { format: 'ck-view', version: VIEW_VERSION, key, build: b, data: toBase64(await encodeSnapshot({ key, build: b, savedAt: Date.now(), data })) };
  } catch { return null; }
}

/** The document without its embedded view, and that field as read (undefined when the file has none). The input is not changed. */
export function takeEmbedded<T extends object>(doc: T): { doc: T; embedded: unknown } {
  if (!(EMBED_FIELD in doc)) return { doc, embedded: undefined };
  const { [EMBED_FIELD]: embedded, ...rest } = doc as T & Record<string, unknown>;
  return { doc: rest as T, embedded };
}

/** Why a file's stored view is not used. `recipe`: the part was edited after the view was stored; `build`: another kernel build made it;
 *  `version`: a view format this code does not know; `corrupt`: not a well-formed view. */
export type ViewRejection = 'recipe' | 'build' | 'version' | 'corrupt';
export type EmbeddedResult =
  | { ok: true; snapshot: ViewSnapshot }
  | { ok: false; reason: ViewRejection }
  /** nothing to judge by: the field is absent, or this kernel's build id is not known */
  | { ok: false; reason: null };

/** The view a file carries and, when it is not used, why. Never throws. */
export async function checkEmbedded(build: () => Promise<string | null>, doc: unknown, field: unknown): Promise<EmbeddedResult> {
  try {
    if (field === undefined || field === null) return { ok: false, reason: null };
    const e = field as Partial<EmbeddedView>;
    if (typeof e !== 'object' || e.format !== 'ck-view' || typeof e.version !== 'number') return { ok: false, reason: 'corrupt' };
    if (e.version !== VIEW_VERSION) return { ok: false, reason: 'version' };
    if (typeof e.key !== 'string' || typeof e.build !== 'string' || typeof e.data !== 'string') return { ok: false, reason: 'corrupt' };
    const b = await build();
    if (!b) return { ok: false, reason: null };
    if (b !== e.build) return { ok: false, reason: 'build' };
    if (e.key !== await recipeKey(doc)) return { ok: false, reason: 'recipe' };
    const s = await decodeSnapshot(fromBase64(e.data));
    return s && s.key === e.key && s.build === b ? { ok: true, snapshot: s } : { ok: false, reason: 'corrupt' };
  } catch { return { ok: false, reason: 'corrupt' }; }
}

/** The view a file carries when it belongs to exactly this recipe and kernel build; otherwise null (never throws). */
export async function embeddedSnapshot(build: () => Promise<string | null>, doc: unknown, field: unknown): Promise<ViewSnapshot | null> {
  const r = await checkEmbedded(build, doc, field);
  return r.ok ? r.snapshot : null;
}
