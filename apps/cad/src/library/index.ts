// The library registry of the running app (one per page), built from the browser's fetch, IndexedDB and local storage.
import defaults from './libraries.default.json';
import { defaultCache } from './cache';
import { LibraryRegistry, type DefaultLibrary } from './registry';
import type { FetchLike } from './source';

export * from './manifest';
export * from './source';
export * from './registry';
export * from './insert';
export { openableText } from './partFile';

let reg: LibraryRegistry | null = null;
export function libraryRegistry(): LibraryRegistry {
  if (reg) return reg;
  let kv = null;
  try { kv = localStorage; } catch { /* blocked: the list lasts for this page */ }
  const f: FetchLike = (url, init) => fetch(url, init);
  reg = new LibraryRegistry({ fetch: f, cache: defaultCache(), kv, defaults: (defaults as { libraries: DefaultLibrary[] }).libraries, base: import.meta.env.BASE_URL, allowLocalhost: import.meta.env.DEV });
  return reg;
}
