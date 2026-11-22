// localStorage that never throws: private windows, blocked site data, quota errors, workers and tests without a window all
// fall back to "nothing stored". Reads give null or the fallback; writes say whether they stuck.
const store = (): Storage | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };

export const safeStorage = {
  get(key: string): string | null {
    try { return store()?.getItem(key) ?? null; } catch { return null; }
  },
  set(key: string, value: string): boolean {
    try { const s = store(); if (!s) return false; s.setItem(key, value); return true; } catch { return false; }
  },
  remove(key: string): void {
    try { store()?.removeItem(key); } catch { /* nothing to remove, or storage blocked */ }
  },
  /** The stored JSON, or `fallback` when nothing is stored, the text is not JSON, or storage is blocked. */
  getJson<T>(key: string, fallback: T): T {
    const raw = safeStorage.get(key);
    if (raw === null) return fallback;
    try { const v = JSON.parse(raw) as T; return v === null || v === undefined ? fallback : v; } catch { return fallback; }
  },
  setJson(key: string, value: unknown): boolean {
    try { return safeStorage.set(key, JSON.stringify(value)); } catch { return false; }
  },
};
