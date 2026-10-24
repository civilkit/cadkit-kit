import { describe, expect, it } from 'vitest';
import { buildId, precacheList, swSource } from './sw.mjs';

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
});
