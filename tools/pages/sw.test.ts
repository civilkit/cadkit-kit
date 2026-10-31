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
});
