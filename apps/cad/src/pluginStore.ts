// Where installed plugins live between sessions: one IndexedDB object store, keyed by plugin id. A record holds the package's files
// (text and wasm bytes), its pin and whether it is switched on. Private windows and blocked storage fall back to memory for the session.
import { memoryStore, type InstalledPlugin, type PluginStore } from '@kit/plugin';
import { safeStorage } from '@kit/platform';

const DB = 'ck-plugins', STORE = 'installed';
const open = (): Promise<IDBDatabase> => new Promise((ok, fail) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: 'id' }); };
  r.onsuccess = () => ok(r.result);
  r.onerror = () => fail(r.error);
});
const req = <T,>(r: IDBRequest<T>): Promise<T> => new Promise((ok, fail) => { r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });

export function idbPluginStore(): PluginStore {
  const fallback = memoryStore();
  let db: Promise<IDBDatabase | null> | undefined;
  const get = (): Promise<IDBDatabase | null> => (db ??= typeof indexedDB === 'undefined' ? Promise.resolve(null) : open().catch(() => null));
  const tx = async <T,>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> => {
    const d = await get();
    if (!d) return undefined;
    return req(run(d.transaction(STORE, mode).objectStore(STORE)));
  };
  return {
    async all() { return (await tx('readonly', (s) => s.getAll() as IDBRequest<InstalledPlugin[]>)) ?? fallback.all(); },
    async put(p) { if ((await tx('readwrite', (s) => s.put(p))) === undefined) await fallback.put(p); },
    async remove(id) { if ((await tx('readwrite', (s) => s.delete(id))) === undefined) await fallback.remove(id); },
  };
}

/** Third-party plugins are switched off until the user turns them on here (a setting of this browser, not of the document). */
const FLAG = 'ck.plugins.thirdParty';
export const thirdPartyEnabled = (): boolean => safeStorage.get(FLAG) === '1';
export const setThirdPartyEnabled = (on: boolean): void => { if (on) safeStorage.set(FLAG, '1'); else safeStorage.remove(FLAG); };
