// The one online library of the running app: the setting (off by default), the browser cache behind it, and the texture provider handed to the viewport.
import { signal } from '@preact/signals-core';
import { retryHdris, retryTextures, setHdriProvider, setTextureProvider } from '@kit/viewport';
import { CACHE_NAME, createOnlineLibrary, loadOnlinePrefs, saveOnlinePrefs, type OnlinePrefs } from './onlineLibrary';

export const online = signal<OnlinePrefs>(loadOnlinePrefs());
export const cacheSize = signal(0);

const INDEX_KEY = 'cad.online.index';
const index = {
  read: (): Record<string, { size: number; t: number }> => { try { const v = JSON.parse(localStorage.getItem(INDEX_KEY) ?? '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } },
  write: (v: Record<string, { size: number; t: number }>): void => { try { localStorage.setItem(INDEX_KEY, JSON.stringify(v)); } catch { /* the cache still works, its size is just not shown */ } },
};
const opened = typeof caches === 'undefined' ? null : caches.open(CACHE_NAME);
const cache = opened ? {
  match: async (u: RequestInfo | URL) => (await opened).match(u),
  put: async (u: RequestInfo | URL, r: Response) => (await opened).put(u, r),
  delete: async (u: RequestInfo | URL) => (await opened).delete(u),
} : null;

export const library = createOnlineLibrary({ fetch: (u) => fetch(u, { credentials: 'omit' }), cache: cache as never, enabled: () => online.value.enabled, index });

export function setOnlineEnabled(enabled: boolean): void {
  online.value = { enabled };
  saveOnlinePrefs(online.value);
  if (enabled) { retryTextures(); retryHdris(); }
}
export async function clearOnlineCache(): Promise<void> { await library.clear(); cacheSize.value = 0; }

/** Start: textures of a part's look come through the library (the cache first, the network only when the setting is on). */
export function startOnlineTextures(): void {
  cacheSize.value = library.cacheBytes();
  setTextureProvider(async (id) => { try { const m = await library.maps(id); cacheSize.value = library.cacheBytes(); return m; } catch { return null; } });
  setHdriProvider(async (id) => { try { const u = await library.hdri(id); cacheSize.value = library.cacheBytes(); return u; } catch { return null; } });
}
