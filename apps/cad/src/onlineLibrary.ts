// Online libraries (Poly Haven textures first): off until the user allows them in Settings, never contacted otherwise. What is downloaded is kept in
// the browser's cache (a size cap, oldest first out) so a texture works again offline; each asset carries its credit. Poly Haven assets are CC0
// (public domain, https://polyhaven.com/license); the credit line is shown anyway. The network and the cache are passed in so tests need neither.
import type { TextureMaps } from '@kit/viewport';

export interface OnlinePrefs { enabled: boolean }
export const DEFAULT_ONLINE: OnlinePrefs = { enabled: false };
const PREFS_KEY = 'cad.online';
export function sanitizeOnlinePrefs(raw: unknown): OnlinePrefs {
  return { enabled: !!raw && typeof raw === 'object' && (raw as Record<string, unknown>).enabled === true };
}
export function loadOnlinePrefs(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): OnlinePrefs {
  try { return sanitizeOnlinePrefs(JSON.parse(storage?.getItem(PREFS_KEY) ?? 'null')); } catch { return DEFAULT_ONLINE; }
}
export function saveOnlinePrefs(p: OnlinePrefs, storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  try { storage?.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* private window: the setting lasts for this session only */ }
}

/** What one library asset needs to be listed and credited. `scale` is the real-world size of one tile in mm. */
export interface TextureAsset { id: string; name: string; authors: string[]; scale: number; thumb: string }

/** What one HDRI environment needs to be listed and credited. */
export interface HdriAsset { id: string; name: string; authors: string[]; thumb: string }

export const POLY = {
  api: 'https://api.polyhaven.com',
  thumb: (id: string): string => `https://cdn.polyhaven.com/asset_img/thumbs/${encodeURIComponent(id)}.png?width=128&height=128`,
  page: (id: string): string => `https://polyhaven.com/a/${encodeURIComponent(id)}`,
  license: 'https://polyhaven.com/license',
  hosts: ['api.polyhaven.com', 'dl.polyhaven.org', 'cdn.polyhaven.com'],
} as const;
export const CACHE_NAME = 'cad-online-v1';
export const CACHE_CAP_BYTES = 120 * 1024 * 1024;

export class OnlineOff extends Error { constructor() { super('online libraries are off'); this.name = 'OnlineOff'; } }

export interface Deps {
  fetch: (url: string) => Promise<Response>;
  cache: Pick<Cache, 'match' | 'put' | 'delete'> | null;
  enabled: () => boolean;
  /** the index of what is cached (url -> size and time), kept apart from the cache so its size is known without reading it */
  index: { read(): Record<string, { size: number; t: number }>; write(v: Record<string, { size: number; t: number }>): void };
  now?: () => number;
  capBytes?: number;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object';

export function createOnlineLibrary(d: Deps) {
  const now = d.now ?? Date.now, cap = d.capBytes ?? CACHE_CAP_BYTES;
  const objectUrls = new Map<string, string>();

  async function evict(): Promise<void> {
    const idx = d.index.read();
    let total = Object.values(idx).reduce((a, e) => a + e.size, 0);
    for (const [url, e] of Object.entries(idx).sort((a, b) => a[1].t - b[1].t)) {
      if (total <= cap) break;
      await d.cache?.delete(url); delete idx[url]; total -= e.size;
      const o = objectUrls.get(url); if (o) { URL.revokeObjectURL(o); objectUrls.delete(url); }
    }
    d.index.write(idx);
  }
  /** The bytes of a url: from the cache when it is there, else from the network (only when online libraries are on), then cached. */
  async function blob(url: string, fresh = false): Promise<Blob> {
    const hit = !fresh || !d.enabled() ? await d.cache?.match(url) : undefined;   // a listing is asked again when online, and the cached copy serves when the network does not
    if (hit) return hit.blob();
    if (!d.enabled()) throw new OnlineOff();
    let r: Response;
    try { r = await d.fetch(url); } catch (e) { const old = await d.cache?.match(url); if (old) return old.blob(); throw e; }
    if (!r.ok) { const old = await d.cache?.match(url); if (old) return old.blob(); throw new Error(`${new URL(url).host} answered ${r.status}`); }
    const b = await r.blob();
    if (d.cache) {
      await d.cache.put(url, new Response(b, { headers: { 'content-type': b.type || 'application/octet-stream' } }));
      const idx = d.index.read(); idx[url] = { size: b.size, t: now() }; d.index.write(idx);
      await evict();
    }
    return b;
  }
  const json = async (url: string): Promise<unknown> => JSON.parse(await (await blob(url, true)).text());
  async function objectUrl(url: string): Promise<string> {
    const have = objectUrls.get(url); if (have) return have;
    const o = URL.createObjectURL(await blob(url)); objectUrls.set(url, o); return o;
  }

  return {
    /** The wood textures of the library, newest listing cached. */
    async list(category = 'wood'): Promise<TextureAsset[]> {
      const raw = await json(`${POLY.api}/assets?t=textures&c=${encodeURIComponent(category)}`);
      if (!isObj(raw)) return [];
      const out: TextureAsset[] = [];
      for (const [id, v] of Object.entries(raw)) {
        if (!/^[a-z0-9_]{1,80}$/.test(id) || !isObj(v)) continue;
        const dim = Array.isArray(v.dimensions) && typeof v.dimensions[0] === 'number' ? v.dimensions[0] : 1000;
        out.push({ id, name: typeof v.name === 'string' ? v.name : id, authors: isObj(v.authors) ? Object.keys(v.authors) : [], scale: Math.min(5000, Math.max(10, dim)), thumb: POLY.thumb(id) });
      }
      return out.sort((a, b) => a.name.localeCompare(b.name));
    },
    /** The HDRI environments of the library (1K only is ever downloaded). */
    async listHdris(): Promise<HdriAsset[]> {
      const raw = await json(`${POLY.api}/assets?t=hdris`);
      if (!isObj(raw)) return [];
      const out: HdriAsset[] = [];
      for (const [id, v] of Object.entries(raw)) {
        if (!/^[a-z0-9_]{1,80}$/.test(id) || !isObj(v)) continue;
        out.push({ id, name: typeof v.name === 'string' ? v.name : id, authors: isObj(v.authors) ? Object.keys(v.authors) : [], thumb: POLY.thumb(id) });
      }
      return out.sort((a, b) => a.name.localeCompare(b.name));
    },
    /** The object URL of an environment's 1K Radiance .hdr (about 1.5 MB), cached like the textures. Throws OnlineOff when it is not cached and the libraries are off. */
    async hdri(id: string): Promise<string | null> {
      const files = await json(`${POLY.api}/files/${encodeURIComponent(id)}`);
      if (!isObj(files)) return null;
      const f = files.hdri; const one = isObj(f) && isObj(f['1k']) ? f['1k'] : null; const hdr = one && isObj(one.hdr) ? one.hdr : null;
      if (!hdr || typeof hdr.url !== 'string' || !(POLY.hosts as readonly string[]).includes(new URL(hdr.url).host)) return null;
      return objectUrl(hdr.url);
    },
    /** Object URLs of a texture's colour, roughness and OpenGL normal maps (1K JPEG). Throws OnlineOff when they are not cached and the libraries are off. */
    async maps(id: string): Promise<TextureMaps | null> {
      const files = await json(`${POLY.api}/files/${encodeURIComponent(id)}`);
      if (!isObj(files)) return null;
      const pick = (k: string): string | null => {
        const f = files[k]; const one = isObj(f) && isObj(f['1k']) ? f['1k'] : null; const jpg = one && isObj(one.jpg) ? one.jpg : null;
        return jpg && typeof jpg.url === 'string' && (POLY.hosts as readonly string[]).includes(new URL(jpg.url).host) ? jpg.url : null;
      };
      const diff = pick('Diffuse'), rough = pick('Rough'), nor = pick('nor_gl');
      if (!diff) return null;
      const [map, r, n] = await Promise.all([objectUrl(diff), rough ? objectUrl(rough).catch(() => undefined) : Promise.resolve(undefined), nor ? objectUrl(nor).catch(() => undefined) : Promise.resolve(undefined)]);
      return { map, ...(r ? { rough: r } : {}), ...(n ? { normal: n } : {}) };
    },
    cacheBytes(): number { return Object.values(d.index.read()).reduce((a, e) => a + e.size, 0); },
    async clear(): Promise<void> {
      for (const url of Object.keys(d.index.read())) await d.cache?.delete(url);
      for (const o of objectUrls.values()) URL.revokeObjectURL(o);
      objectUrls.clear(); d.index.write({});
    },
  };
}
export type OnlineLibrary = ReturnType<typeof createOnlineLibrary>;
