// File System Access API support, kept apart from web.ts so it can be tested with fakes. Every browser object comes in
// through `FsEnv`; nothing here touches `window`.
import type { HandleStore, SavedDocument } from './index';
import { fileText, gzipText, wantsGzip } from './gzip';

interface Writable { write(d: string | Uint8Array): Promise<void>; close(): Promise<void> }
export interface FsHandle {
  name: string;
  createWritable(): Promise<Writable>;
  getFile?(): Promise<{ arrayBuffer?(): Promise<ArrayBuffer>; text?(): Promise<string> }>;
  queryPermission?(o: { mode: 'read' | 'readwrite' }): Promise<string>;
  requestPermission?(o: { mode: 'read' | 'readwrite' }): Promise<string>;
}
export interface FsEnv {
  /** `window.showSaveFilePicker`, absent in browsers without the API. */
  showSaveFilePicker?: (o: { suggestedName: string; /** the browser reopens the picker in the folder last used under the same id */ id?: string; types?: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<FsHandle>;
  /** Plain download, the fallback. */
  download(name: string, data: string | Uint8Array): Promise<void>;
}

const isAbort = (e: unknown) => (e as { name?: string })?.name === 'AbortError';

async function ensureWrite(h: FsHandle): Promise<boolean> {
  try {
    if (!h.queryPermission) return true;
    if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
    return (await h.requestPermission?.({ mode: 'readwrite' })) === 'granted';
  } catch { return false; }
}

async function write(h: FsHandle, data: string): Promise<void> {
  const w = await h.createWritable();
  await w.write(wantsGzip(h.name) ? await gzipText(data) : data);   // the name the file ended up with decides, the picker may have changed it
  await w.close();
}

/** Save through a remembered handle, the picker or a download (in that order of preference). Null when the user cancelled. */
export async function saveDocumentWith(env: FsEnv, name: string, data: string, opts: { handle?: unknown; pick?: boolean } = {}): Promise<SavedDocument | null> {
  const old = opts.handle as FsHandle | undefined | null;
  if (old && !opts.pick && typeof old.createWritable === 'function' && (await ensureWrite(old))) {
    try { await write(old, data); return { name: old.name, handle: old }; } catch { /* file gone or locked: ask again below */ }
  }
  if (env.showSaveFilePicker) {
    try {
      const h = await env.showSaveFilePicker({ suggestedName: name, id: 'ckpart-save', types: [{ description: 'Part', accept: { 'application/json': ['.ckpart'] } }, { description: 'Compressed part', accept: { 'application/gzip': ['.gz'] } }] });
      await write(h, data);
      return { name: h.name, handle: h };
    } catch (e) {
      if (isAbort(e)) return null;
      // any other failure (blocked in a frame, disk error): fall through to a download so the work is not lost
    }
  }
  await env.download(name, wantsGzip(name) ? await gzipText(data) : data);
  return { name, handle: null };
}

export async function readHandleWith(handle: unknown): Promise<{ name: string; text: string } | 'denied' | null> {
  const h = handle as FsHandle | undefined;
  if (!h || typeof h.getFile !== 'function') return null;
  try {
    if (h.queryPermission && (await h.queryPermission({ mode: 'read' })) !== 'granted') {
      if ((await h.requestPermission?.({ mode: 'read' })) !== 'granted') return 'denied';
    }
    const f = await h.getFile();
    return { name: h.name, text: await fileText(f) };
  } catch { return null; }
}

/** Handles survive in IndexedDB (they are structured-cloneable). Null where there is no IndexedDB. */
export function idbHandleStore(idb: IDBFactory | undefined, dbName = 'cad.handles.v1'): HandleStore | null {
  if (!idb) return null;
  const open = () => new Promise<IDBDatabase>((res, rej) => {
    const r = idb.open(dbName, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('h');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const run = async <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    return new Promise<T>((res, rej) => {
      const rq = f(db.transaction('h', mode).objectStore('h'));
      rq.onsuccess = () => { db.close(); res(rq.result); };
      rq.onerror = () => { db.close(); rej(rq.error); };
    });
  };
  return {
    get: (k) => run('readonly', (s) => s.get(k)),
    set: async (k, v) => { await run('readwrite', (s) => s.put(v, k)); },
    delete: async (k) => { await run('readwrite', (s) => s.delete(k)); },
  };
}
