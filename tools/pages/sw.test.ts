import { describe, expect, it } from 'vitest';
import { buildId, precacheList, swSource, LITE_SKIP } from './sw.mjs';

describe('service worker of the published site', () => {
  it('the build id depends on the files and their sizes, not on their order', () => {
    const a = [{ path: 'index.html', size: 10 }, { path: 'assets/x.js', size: 5 }];
    expect(buildId(a)).toBe(buildId([...a].reverse()));
    expect(buildId(a)).not.toBe(buildId([{ path: 'index.html', size: 11 }, a[1]!]));
    expect(buildId(a)).toMatch(/^[0-9a-f]{12}$/);
  });

  it('stores the shell, the bundles, the kernel and the icons, not the samples or the licences page', () => {
    const l = precacheList(['licenses.html', 'index.html', 'samples/index.json', 'samples/thumbs/a.webp', 'assets/index-abc.js', 'kernel/ck_wasm.wasm', 'icons/icon-192.png', 'manifest.webmanifest', '.nojekyll']);
    expect(l).toEqual(['assets/index-abc.js', 'icons/icon-192.png', 'index.html', 'kernel/ck_wasm.wasm', 'manifest.webmanifest']);
  });

  it('is valid script that names the build and the files, and handles install, activate and fetch', () => {
    const src = swSource('abc123', ['index.html', 'assets/index-abc.js']);
    expect(() => new Function(src)).not.toThrow();
    expect(src).toContain('"abc123"');
    expect(src).toContain('"assets/index-abc.js"');
    for (const ev of ['install', 'activate', 'fetch']) expect(src).toContain(`addEventListener('${ev}'`);
  });

  // run the generated worker against a fake service-worker scope and report what it stores at install and which fetches it answers
  const install = async (url: string) => {
    const src = swSource('abc123', ['index.html', 'assets/index-abc.js', 'kernel/ck_wasm.wasm', 'icons/icon-192.png']);
    const stored: string[] = [];
    const handlers: Record<string, (e: unknown) => void> = {};
    const self = { location: { href: url }, registration: { scope: 'https://example.com/app/' }, addEventListener: (n: string, f: (e: unknown) => void) => { handlers[n] = f; }, skipWaiting: () => {}, clients: { claim: () => {} } };
    const caches = { open: async () => ({ addAll: async (urls: string[]) => { stored.push(...urls); }, put: async () => {} }), keys: async () => [], match: async () => undefined };
    new Function('self', 'caches', 'URL', 'fetch', src)(self, caches, URL, async () => new Response('x'));
    let wait: Promise<unknown> = Promise.resolve();
    handlers.install!({ waitUntil: (p: Promise<unknown>) => { wait = p; } });
    await wait;
    return stored;
  };
  it('a desktop install stores the kernel with the shell', async () => {
    const stored = await install('https://example.com/app/sw.js');
    expect(stored).toContain('https://example.com/app/kernel/ck_wasm.wasm');
    expect(stored).toContain('https://example.com/app/assets/index-abc.js');
  });
  it('a lite install (phone, tablet) leaves the kernel out and keeps the rest; the fetch handler caches it on first use', async () => {
    const stored = await install('https://example.com/app/sw.js?lite');
    expect(stored.some((u) => u.includes(LITE_SKIP))).toBe(false);
    expect(stored).toEqual(expect.arrayContaining(['https://example.com/app/', 'https://example.com/app/index.html', 'https://example.com/app/assets/index-abc.js', 'https://example.com/app/icons/icon-192.png']));
    expect(swSource('x', [])).toContain('c.put(req, res.clone())');
  });

  // run activate against fake caches: `old` is the content of an older build's cache, `fresh` receives what the new build's cache gets
  const activate = async (url: string, old: Record<string, string> | null, net: { fail?: boolean } = {}) => {
    const src = swSource('new', ['index.html', 'kernel/ck_wasm.wasm']);
    const store: Record<string, Map<string, Response>> = {};
    if (old) store['cadkit-old'] = new Map(Object.entries(old).map(([u, b]) => [u, new Response(b)]));
    const open = async (name: string) => {
      const m = (store[name] ??= new Map());
      return { keys: async () => [...m.keys()].map((u) => ({ url: u })), match: async (r: { url: string }) => m.get(r.url)?.clone(), put: async (r: string | { url: string }, res: Response) => { m.set(typeof r === 'string' ? r : r.url, res); }, addAll: async () => {} };
    };
    const caches = { keys: async () => Object.keys(store), delete: async (k: string) => delete store[k], open, match: async () => undefined };
    const handlers: Record<string, (e: unknown) => void> = {};
    const self = { location: { href: url }, registration: { scope: 'https://example.com/app/' }, addEventListener: (n: string, f: (e: unknown) => void) => { handlers[n] = f; }, skipWaiting: () => {}, clients: { claim: () => {} } };
    const fetched: string[] = [];
    const fetchFn = async (u: string) => { fetched.push(u); if (net.fail) throw new Error('offline'); return new Response('fresh kernel'); };
    new Function('self', 'caches', 'URL', 'fetch', src)(self, caches, URL, fetchFn);
    const waits: Promise<unknown>[] = [];
    handlers.activate!({ waitUntil: (p: Promise<unknown>) => { waits.push(p); } });
    await Promise.all(waits);
    const text = async (name: string, u: string) => store[name]?.get(u) ? await store[name]!.get(u)!.text() : undefined;
    return { store, text, fetched };
  };
  const K = 'https://example.com/app/kernel/ck_wasm.wasm';
  it('a lite update carries the kernel over from the old cache before deleting it, then refreshes it from the network', async () => {
    const r = await activate('https://example.com/app/sw.js?lite', { [K]: 'old kernel', 'https://example.com/app/index.html': 'old shell' });
    expect(Object.keys(r.store)).toEqual(['cadkit-new']);
    expect(await r.text('cadkit-new', K)).toBe('fresh kernel');
    expect(r.fetched).toEqual([K]);
    expect([...r.store['cadkit-new']!.keys()]).toEqual([K]);   // only the kernel is carried
  });
  it('a lite update offline keeps the carried kernel', async () => {
    const r = await activate('https://example.com/app/sw.js?lite', { [K]: 'old kernel' }, { fail: true });
    expect(await r.text('cadkit-new', K)).toBe('old kernel');
  });
  it('a lite update whose old cache never had the kernel fetches nothing', async () => {
    const r = await activate('https://example.com/app/sw.js?lite', { 'https://example.com/app/index.html': 'old shell' });
    expect(r.fetched).toEqual([]);
    expect([...r.store['cadkit-new']!.keys()]).toEqual([]);
    expect(Object.keys(r.store)).toEqual(['cadkit-new']);
  });
  it('a first lite install (no old cache) and a desktop update leave the kernel to install and the fetch handler', async () => {
    expect((await activate('https://example.com/app/sw.js?lite', null)).fetched).toEqual([]);
    const d = await activate('https://example.com/app/sw.js', { [K]: 'old kernel' });
    expect(d.fetched).toEqual([]);
    expect(Object.keys(d.store)).toEqual(['cadkit-new']);
  });
});
