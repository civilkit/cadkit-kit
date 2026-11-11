import { describe, it, expect, vi, beforeAll } from 'vitest';
import { createOnlineLibrary, sanitizeOnlinePrefs, loadOnlinePrefs, OnlineOff, type Deps } from './onlineLibrary';

const LIST = { walnut_veneer_02: { name: 'Walnut Veneer 02', authors: { 'A Author': 'All' }, dimensions: [1000, 1000] }, 'bad id!': {}, oak_plank: { name: 'Oak Plank', authors: {}, dimensions: [2000, 2000] } };
const FILES = { Diffuse: { '1k': { jpg: { url: 'https://dl.polyhaven.org/x/diff.jpg' } } }, Rough: { '1k': { jpg: { url: 'https://dl.polyhaven.org/x/rough.jpg' } } } };

function memoryCache(): NonNullable<Deps['cache']> & { store: Map<string, Response> } {
  const store = new Map<string, Response>();
  return { store, async match(u) { const r = store.get(String(u)); return r ? r.clone() : undefined; }, async put(u, r) { store.set(String(u), r); }, async delete(u) { return store.delete(String(u)); } };
}
function setup(enabled = true, cap?: number) {
  const calls: string[] = [];
  const net = new Map<string, () => Response>([
    ['https://api.polyhaven.com/assets?t=textures&c=wood', () => new Response(JSON.stringify(LIST))],
    ['https://api.polyhaven.com/files/walnut_veneer_02', () => new Response(JSON.stringify(FILES))],
    ['https://dl.polyhaven.org/x/diff.jpg', () => new Response(new Uint8Array(1000), { headers: { 'content-type': 'image/jpeg' } })],
    ['https://dl.polyhaven.org/x/rough.jpg', () => new Response(new Uint8Array(500), { headers: { 'content-type': 'image/jpeg' } })],
  ]);
  const state = { on: enabled }, cache = memoryCache(); let idx: Record<string, { size: number; t: number }> = {}; let t = 0;
  const lib = createOnlineLibrary({
    fetch: async (u) => { calls.push(u); const f = net.get(u); if (!f) return new Response('', { status: 404 }); return f(); },
    cache, enabled: () => state.on, index: { read: () => ({ ...idx }), write: (v) => { idx = v; } }, now: () => ++t, ...(cap ? { capBytes: cap } : {}),
  });
  return { lib, calls, state, cache, idx: () => idx };
}
beforeAll(() => { (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => 'blob:test/' + Math.random(); (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => {}; });

describe('online library', () => {
  it('is off by default and the stored setting is read strictly', () => {
    expect(loadOnlinePrefs({ getItem: () => null }).enabled).toBe(false);
    expect(sanitizeOnlinePrefs({ enabled: 'yes' }).enabled).toBe(false);
    expect(sanitizeOnlinePrefs({ enabled: true }).enabled).toBe(true);
  });
  it('makes no request while off, and says so', async () => {
    const { lib, calls } = setup(false);
    await expect(lib.list()).rejects.toBeInstanceOf(OnlineOff);
    await expect(lib.maps('walnut_veneer_02')).rejects.toBeInstanceOf(OnlineOff);
    expect(calls).toEqual([]);
  });
  it('lists the textures with their size and credit, skipping ids that are not safe', async () => {
    const { lib } = setup();
    const l = await lib.list();
    expect(l.map((a) => a.id)).toEqual(['oak_plank', 'walnut_veneer_02']);
    expect(l[1]).toMatchObject({ name: 'Walnut Veneer 02', authors: ['A Author'], scale: 1000 });
    expect(l[1]!.thumb).toContain('cdn.polyhaven.com');
  });
  it('fetches the 1K colour and roughness maps once, then serves them from the cache, also when the libraries are turned off', async () => {
    const { lib, calls, state } = setup();
    const m = await lib.maps('walnut_veneer_02');
    expect(m?.map).toMatch(/^blob:/); expect(m?.rough).toMatch(/^blob:/);
    expect(calls.filter((u) => u.endsWith('.jpg'))).toHaveLength(2);
    state.on = false;
    const again = await lib.maps('walnut_veneer_02');
    expect(again?.map).toBe(m?.map);
    expect(calls.filter((u) => u.endsWith('.jpg'))).toHaveLength(2);
    expect(lib.cacheBytes()).toBeGreaterThan(1400);
  });
  it('refuses a download host that is not the library\'s', async () => {
    const { lib, cache } = setup();
    cache.store.set('https://api.polyhaven.com/files/evil', new Response(JSON.stringify({ Diffuse: { '1k': { jpg: { url: 'https://evil.example/x.jpg' } } } })));
    expect(await lib.maps('evil')).toBeNull();
  });
  it('drops the oldest files when over the cap, and Clear empties the cache', async () => {
    const { lib, cache, idx } = setup(true, 1200);
    await lib.maps('walnut_veneer_02');
    expect(Object.keys(idx()).some((u) => u.endsWith('diff.jpg'))).toBe(false);   // the colour map (1000) was the oldest large one
    await lib.clear();
    expect(lib.cacheBytes()).toBe(0); expect(cache.store.size).toBe(0);
  });
  it('a failed request falls back to the cached listing', async () => {
    const { lib, cache } = setup();
    await lib.list();
    const fail = vi.fn(); void fail;
    expect(cache.store.size).toBe(1);
    const { lib: lib2 } = (() => { const s = setup(); s.cache.store.set('https://api.polyhaven.com/assets?t=textures&c=wood', new Response(JSON.stringify(LIST))); return { lib: createOnlineLibrary({ fetch: async () => { throw new Error('offline'); }, cache: s.cache, enabled: () => true, index: { read: () => ({}), write: () => {} } }) }; })();
    expect((await lib2.list()).length).toBe(2);
  });
});
