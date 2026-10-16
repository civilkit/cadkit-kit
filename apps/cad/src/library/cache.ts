// Cache of fetched manifests, parts, thumbnails and the thumbnails rendered here for parts that came without one (`gen`), so a library keeps working without a network. IndexedDB in the browser;
// the in-memory store is for tests and for browsers that refuse IndexedDB. Keys are `url#sha` (or `url#size` without a sha).
export interface CacheRecord { key: string; lib: string; kind: 'manifest' | 'part' | 'thumb' | 'gen'; bytes: Uint8Array; at: number }
export interface CacheStore {
  get(key: string): Promise<CacheRecord | null>;
  put(rec: CacheRecord): Promise<void>;
  /** Drop everything of one library. */
  removeLibrary(lib: string): Promise<void>;
  /** Drop the records of one library whose key is not in `keep` of the given kind (an old part version after a refresh). */
  prune(lib: string, kind: CacheRecord['kind'], keep: Set<string>): Promise<void>;
  /** The keys held for a library (no file contents read). */
  keys(lib: string): Promise<string[]>;
  /** Bytes held for a library. */
  size(lib: string): Promise<number>;
}

export function memoryCache(): CacheStore {
  const m = new Map<string, CacheRecord>();
  return {
    async get(k) { return m.get(k) ?? null; },
    async put(r) { m.set(r.key, { ...r, bytes: r.bytes.slice() }); },
    async removeLibrary(lib) { for (const [k, r] of m) if (r.lib === lib) m.delete(k); },
    async prune(lib, kind, keep) { for (const [k, r] of m) if (r.lib === lib && r.kind === kind && !keep.has(k)) m.delete(k); },
    async keys(lib) { return [...m.values()].filter((r) => r.lib === lib).map((r) => r.key); },
    async size(lib) { let n = 0; for (const r of m.values()) if (r.lib === lib) n += r.bytes.length; return n; },
  };
}

const DB = 'ck-libraries', STORE = 'files';

export function indexedDbCache(idb: IDBFactory = indexedDB): CacheStore {
  let opened: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => (opened ??= new Promise((res, rej) => {
    const rq = idb.open(DB, 1);
    rq.onupgradeneeded = () => { const s = rq.result.createObjectStore(STORE, { keyPath: 'key' }); s.createIndex('lib', 'lib'); };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => { opened = null; rej(rq.error); };
  }));
  const run = async <T,>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> => {
    const db = await open();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, mode);
      const rq = f(tx.objectStore(STORE));
      tx.oncomplete = () => res(rq ? rq.result : undefined);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    });
  };
  const ofLib = async (lib: string): Promise<CacheRecord[]> => (await run('readonly', (s) => s.index('lib').getAll(lib)) ?? []) as CacheRecord[];
  return {
    async get(k) { return ((await run('readonly', (s) => s.get(k))) as CacheRecord | undefined) ?? null; },
    async put(r) { await run('readwrite', (s) => { s.put(r); }); },
    async removeLibrary(lib) { for (const r of await ofLib(lib)) await run('readwrite', (s) => { s.delete(r.key); }); },
    async prune(lib, kind, keep) { for (const r of await ofLib(lib)) if (r.kind === kind && !keep.has(r.key)) await run('readwrite', (s) => { s.delete(r.key); }); },
    async keys(lib) { return ((await run('readonly', (s) => s.index('lib').getAllKeys(lib))) ?? []) as string[]; },
    async size(lib) { return (await ofLib(lib)).reduce((n, r) => n + r.bytes.length, 0); },
  };
}

/** IndexedDB where it exists and works, else memory. */
export function defaultCache(): CacheStore {
  try { if (typeof indexedDB !== 'undefined') return indexedDbCache(); } catch { /* fall through */ }
  return memoryCache();
}
