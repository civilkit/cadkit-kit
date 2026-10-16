// Rolling snapshots of the open part, kept in IndexedDB (a document can be 900 KB: too big for localStorage to hold ten of).
// They are the safety net behind autosave: whatever happens to the live document, an earlier state is one click away.
export interface Snapshot { id: string; time: number; name: string; features: number; reason: 'auto' | 'undo' | 'drop' | 'load'; doc: unknown }
export interface SnapBackend { all(): Promise<Snapshot[]>; put(s: Snapshot): Promise<void>; remove(ids: string[]): Promise<void> }

export const SNAP_KEEP = 10;
export const SNAP_EVERY = 30_000;
export const SNAP_HOLD = 24 * 3600_000;

export const featureCount = (doc: unknown): number => { const f = (doc as { features?: unknown } | null)?.features; return Array.isArray(f) ? f.length : 0; };

/** Which snapshots to drop: all but the newest SNAP_KEEP, except that the richest one younger than SNAP_HOLD always stays. */
export function pruneIds(list: Snapshot[], now: number): string[] {
  const sorted = [...list].sort((a, b) => b.time - a.time);
  const keep = new Set(sorted.slice(0, SNAP_KEEP).map((s) => s.id));
  const recent = sorted.filter((s) => now - s.time < SNAP_HOLD);
  const richest = recent.reduce<Snapshot | null>((m, s) => (!m || s.features > m.features ? s : m), null);
  if (richest) keep.add(richest.id);
  return sorted.filter((s) => !keep.has(s.id)).map((s) => s.id);
}

export function memoryBackend(): SnapBackend & { items: Snapshot[] } {
  const items: Snapshot[] = [];
  return {
    items,
    async all() { return items.map((s) => ({ ...s })); },
    async put(s) { const i = items.findIndex((x) => x.id === s.id); if (i >= 0) items[i] = s; else items.push(s); },
    async remove(ids) { for (const id of ids) { const i = items.findIndex((x) => x.id === id); if (i >= 0) items.splice(i, 1); } },
  };
}

export function idbBackend(dbName = 'cad.snapshots.v1'): SnapBackend | null {
  if (typeof indexedDB === 'undefined') return null;
  let dbp: Promise<IDBDatabase> | null = null;
  const open = () => dbp ??= new Promise<IDBDatabase>((res, rej) => {
    const rq = indexedDB.open(dbName, 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('snaps', { keyPath: 'id' });
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => { dbp = null; rej(rq.error); };
  });
  const run = async <T,>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> => {
    const db = await open();
    return new Promise((res, rej) => {
      const tx = db.transaction('snaps', mode);
      const rq = f(tx.objectStore('snaps'));
      tx.oncomplete = () => res(rq ? rq.result : undefined);
      tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
    });
  };
  return {
    async all() { return ((await run('readonly', (s) => s.getAll())) as Snapshot[] | undefined) ?? []; },
    async put(snap) { await run('readwrite', (s) => { s.put(snap); }); },
    async remove(ids) { await run('readwrite', (s) => { for (const id of ids) s.delete(id); }); },
  };
}

export function createSnapshots(backend: SnapBackend | null, opts: { now?: () => number } = {}) {
  const now = opts.now ?? Date.now;
  let lastTime = 0, lastKey = '', seq = 0, queue: Promise<unknown> = Promise.resolve();
  return {
    /** Keep the document as it is now. `auto` snapshots come at most every SNAP_EVERY; `undo`, `drop` and `load` always (an identical state is not stored twice). */
    note(doc: unknown, name: string, reason: Snapshot['reason']): Promise<void> {
      if (!backend || !doc) return Promise.resolve();
      const features = featureCount(doc);
      const t = now();
      if (features === 0 || (reason === 'auto' && t - lastTime < SNAP_EVERY)) return Promise.resolve();
      let key: string;
      try { key = JSON.stringify(doc); } catch { return Promise.resolve(); }
      if (key === lastKey) return Promise.resolve();
      lastKey = key; if (reason === 'auto') lastTime = t;
      const snap: Snapshot = { id: `${t}-${seq++}`, time: t, name, features, reason, doc: JSON.parse(key) };
      const job = queue.then(async () => { await backend.put(snap); await backend.remove(pruneIds(await backend.all(), now())); }).catch(() => {});
      queue = job;
      return job;
    },
    /** Newest first. */
    async list(): Promise<Snapshot[]> { try { return backend ? (await backend.all()).sort((a, b) => b.time - a.time) : []; } catch { return []; } },
    /** Resolves when every write so far has finished (tests). */
    settled(): Promise<unknown> { return queue; },
  };
}
