import { describe, expect, it, vi } from 'vitest';
import { bundleOf, runningBundle, watchForUpdate } from './updateCheck';

const page = (js: string) => `<!doctype html><head><script type="module" crossorigin src="./assets/${js}"></script></head><body></body>`;

describe('update check', () => {
  it('reads the bundle name from an index.html', () => {
    expect(bundleOf(page('index-7mBxvlx1.js'))).toBe('index-7mBxvlx1.js');
    expect(bundleOf('<script type="module" src="/src/main.tsx"></script>')).toBeNull();
  });

  it('reads the running bundle from the document, and none on the dev server', () => {
    const d = new DOMParser().parseFromString(page('index-aaa.js'), 'text/html');
    expect(runningBundle(d)).toBe('index-aaa.js');
    expect(runningBundle(new DOMParser().parseFromString('<script src="/src/main.tsx"></script>', 'text/html'))).toBeNull();
  });

  it('reports a newer build once, ignores the same build and failed fetches', async () => {
    let html = page('index-aaa.js');
    let fail = false;
    const onStale = vi.fn();
    const w = watchForUpdate({ current: 'index-aaa.js', fetchHtml: async () => { if (fail) throw new Error('offline'); return html; }, onStale, intervalMs: 1e9 });
    expect(await w.check()).toBe(false);
    fail = true; expect(await w.check()).toBe(false);
    fail = false; html = page('index-bbb.js');
    expect(await w.check()).toBe(true);
    expect(await w.check()).toBe(false);
    expect(onStale).toHaveBeenCalledTimes(1);
    w.stop();
  });

  it('does nothing without a hashed bundle (dev)', async () => {
    const fetchHtml = vi.fn(async () => page('index-bbb.js'));
    const w = watchForUpdate({ current: null, fetchHtml, onStale: vi.fn(), intervalMs: 1e9 });
    expect(await w.check()).toBe(false);
    expect(fetchHtml).not.toHaveBeenCalled();
    w.stop();
  });
});
