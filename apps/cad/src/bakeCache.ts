// A cache of the export bake (cosmetic knurls cut as real grooves in a scratch copy): exporting the same part again with the same knurls reuses the
// STEP text or the triangles instead of cutting again. The key is a SHA-256 of the scratch document the kernel is given (so every feature, variable,
// unit, knurl number and the rolled-back state is in it), what is wanted (STEP or mesh) and the kernel build; anything that changes any of them is
// another key. Only a bake that passed every check is stored, never a failure or a time-out. A small in-memory LRU holds the latest results; the same
// results can also be kept in IndexedDB (capped in entries and bytes, stamped with the kernel build and dropped when the build changes). Storage that
// is unavailable or throws only means the cache is memory-only.
import { canonicalJson, sha256Hex } from '@kit/viewdata';

/** Bump when the shape of a stored result changes: old records are then never read. */
export const BAKE_CACHE_VERSION = 1;

/** What a bake gives the export: the STEP text, or the triangles of the knurled solid (positions only: that is all the STL and OBJ writers read). */
export interface BakeValue { step?: string; mesh?: { positions: Float32Array } }
export const bakeValueSize = (v: BakeValue): number => (v.step ? v.step.length * 2 : 0) + (v.mesh ? v.mesh.positions.byteLength : 0);

export interface BakeRecord { key: string; build: string; at: number; size: number; value: BakeValue }
export interface BakeBackend {
  get(key: string): Promise<BakeRecord | undefined>;
  put(rec: BakeRecord): Promise<void>;
  all(): Promise<Array<{ key: string; build: string; at: number; size: number }>>;
  remove(keys: string[]): Promise<void>;
}

export interface BakeCacheOptions {
  /** the id of the kernel build; null (unknown, for example a local service): nothing is cached */
  build: () => Promise<string | null>;
  backend?: BakeBackend | null;
  /** results kept in memory / their bytes */
  memEntries?: number; memBytes?: number;
  /** results kept in the backend / their bytes */
  diskEntries?: number; diskBytes?: number;
  now?: () => number;
}

/** The cache key for the scratch document `doc` (the document with its knurls already cut in), what is wanted, and the kernel build. */
export const bakeKey = (doc: unknown, want: 'step' | 'mesh', build: string): Promise<string> =>
  sha256Hex(canonicalJson({ v: BAKE_CACHE_VERSION, want, build, doc }));

export class BakeCache {
  private mem = new Map<string, { value: BakeValue; size: number }>();   // insertion order = least recently used first
  private o: Required<Omit<BakeCacheOptions, 'backend' | 'build'>> & Pick<BakeCacheOptions, 'backend' | 'build'>;
  constructor(o: BakeCacheOptions) {
    this.o = { memEntries: 3, memBytes: 64 << 20, diskEntries: 8, diskBytes: 96 << 20, now: Date.now, ...o };
  }

  /** The key for a scratch document, or null when the kernel build is unknown (nothing is cached then). */
  async key(doc: unknown, want: 'step' | 'mesh'): Promise<string | null> {
    let build: string | null = null;
    try { build = await this.o.build(); } catch { build = null; }
    return build ? bakeKey(doc, want, build) : null;
  }

  async get(key: string): Promise<BakeValue | null> {
    const m = this.mem.get(key);
    if (m) { this.mem.delete(key); this.mem.set(key, m); return m.value; }
    const b = this.o.backend;
    if (!b) return null;
    try {
      const rec = await b.get(key);
      if (!rec) return null;
      const build = await this.o.build().catch(() => null);
      if (!build || rec.build !== build || !validValue(rec.value)) { void b.remove([key]).catch(() => {}); return null; }
      this.remember(key, rec.value);
      return rec.value;
    } catch { return null; }
  }

  async put(key: string, value: BakeValue): Promise<void> {
    if (!validValue(value)) return;
    this.remember(key, value);
    const b = this.o.backend;
    if (!b) return;
    try {
      const build = await this.o.build();
      if (!build) return;
      const size = bakeValueSize(value);
      if (size > this.o.diskBytes) return;
      await b.put({ key, build, at: this.o.now(), size, value });
      // other kernel builds go; then the oldest until the entry and byte caps hold
      const all = await b.all();
      const drop = all.filter((r) => r.build !== build).map((r) => r.key);
      const keep = all.filter((r) => r.build === build).sort((x, y) => y.at - x.at);
      let bytes = 0;
      keep.forEach((r, i) => { bytes += r.size; if (i >= this.o.diskEntries || bytes > this.o.diskBytes) drop.push(r.key); });
      if (drop.length) await b.remove(drop);
    } catch { /* storage unavailable or full: the memory copy stands */ }
  }

  /** Whether a result is held (memory or backend), without marking it used. */
  async has(key: string): Promise<boolean> {
    if (this.mem.has(key)) return true;
    return (await this.get(key)) !== null;
  }

  /** Forget everything held in memory and in the backend. */
  async clear(): Promise<void> {
    this.mem.clear();
    try { const b = this.o.backend; if (b) await b.remove((await b.all()).map((r) => r.key)); } catch { /* nothing to clear */ }
  }

  get memoryKeys(): string[] { return [...this.mem.keys()]; }

  private remember(key: string, value: BakeValue): void {
    this.mem.delete(key);
    this.mem.set(key, { value, size: bakeValueSize(value) });
    let bytes = 0;
    for (const e of this.mem.values()) bytes += e.size;
    for (const k of [...this.mem.keys()]) {
      if (this.mem.size <= this.o.memEntries && bytes <= this.o.memBytes) break;
      if (this.mem.size <= 1) break;   // the newest stays even when it alone is over the byte cap
      bytes -= this.mem.get(k)!.size;
      this.mem.delete(k);
    }
  }
}

function validValue(v: unknown): v is BakeValue {
  const x = v as BakeValue | null | undefined;
  if (!x || typeof x !== 'object') return false;
  if (typeof x.step === 'string') return x.step.includes('ISO-10303-21');
  return !!x.mesh && x.mesh.positions instanceof Float32Array && x.mesh.positions.length > 0 && x.mesh.positions.length % 9 === 0;
}

/** IndexedDB for the cache, or null where it does not exist. The results and their small `meta` rows (so the caps can be checked without reading
 *  the results) are two stores. Every call may reject (private window, quota): BakeCache catches them. */
export function idbBakeBackend(dbName = 'cad.bakecache.v1'): BakeBackend | null {
  if (typeof indexedDB === 'undefined') return null;
  let dbp: Promise<IDBDatabase> | null = null;
  const open = () => (dbp ??= new Promise<IDBDatabase>((res, rej) => {
    const rq = indexedDB.open(dbName, 1);
    rq.onupgradeneeded = () => { rq.result.createObjectStore('bakes', { keyPath: 'key' }); rq.result.createObjectStore('meta', { keyPath: 'key' }); };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => { dbp = null; rej(rq.error); };
  }));
  const run = async <T,>(mode: IDBTransactionMode, f: (bakes: IDBObjectStore, meta: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> => {
    const db = await open();
    return new Promise((res, rej) => {
      const tx = db.transaction(['bakes', 'meta'], mode);
      const rq = f(tx.objectStore('bakes'), tx.objectStore('meta'));
      tx.oncomplete = () => res(rq ? rq.result : undefined);
      tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
    });
  };
  return {
    async get(k) { return (await run('readonly', (b) => b.get(k))) as BakeRecord | undefined; },
    async put(r) { await run('readwrite', (b, m) => { b.put(r); m.put({ key: r.key, build: r.build, at: r.at, size: r.size }); }); },
    async all() { return ((await run('readonly', (_b, m) => m.getAll())) as Array<{ key: string; build: string; at: number; size: number }> | undefined) ?? []; },
    async remove(ks) { await run('readwrite', (b, m) => { for (const k of ks) { b.delete(k); m.delete(k); } }); },
  };
}
