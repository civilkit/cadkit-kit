import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bundleOf, bypassGap, decideUpdate, fetchVersion, rememberUpdated, reloadGuarded, RESUME_MS, takeUpdated, updateServiceWorker, runningBundle, shouldWatch, watchForUpdate, type BuildVersion, type FetchFn } from './updateCheck';

const ok = (body: unknown): ReturnType<FetchFn> => Promise.resolve({ ok: true, json: async () => body });
const v = (version: string, kit = 'aaa1111') => ({ version, kit, kernel: 'k1' });

describe('fetchVersion', () => {
  it('reads version.json next to the page with no-store', async () => {
    const f = vi.fn<FetchFn>(() => ok(v('0.6.4')));
    expect(await fetchVersion(f, 'https://example.com/cad/')).toEqual({ version: '0.6.4', kit: 'aaa1111', kernel: 'k1' });
    expect(f).toHaveBeenCalledWith('https://example.com/cad/version.json', { cache: 'no-store' });
  });
  it('is null for offline, non-OK, bad JSON and a body without a version', async () => {
    expect(await fetchVersion(() => Promise.reject(new Error('offline')), 'https://example.com/')).toBeNull();
    expect(await fetchVersion(async () => ({ ok: false, json: async () => v('1.0.0') }), 'https://example.com/')).toBeNull();
    expect(await fetchVersion(async () => ({ ok: true, json: async () => { throw new SyntaxError('x'); } }), 'https://example.com/')).toBeNull();
    expect(await fetchVersion(() => ok({ kit: 'x' }), 'https://example.com/')).toBeNull();
    expect(await fetchVersion(() => ok(null), 'https://example.com/')).toBeNull();
  });
});

describe('shouldWatch', () => {
  it('is off on localhost, in the desktop shell and off http(s)', () => {
    expect(shouldWatch({ protocol: 'https:', hostname: 'example.com' }, {})).toBe(true);
    expect(shouldWatch({ protocol: 'http:', hostname: 'localhost' }, {})).toBe(false);
    expect(shouldWatch({ protocol: 'http:', hostname: '127.0.0.1' }, {})).toBe(false);
    expect(shouldWatch({ protocol: 'tauri:', hostname: 'localhost' }, {})).toBe(false);
    expect(shouldWatch({ protocol: 'https:', hostname: 'example.com' }, { __TAURI_INTERNALS__: {} })).toBe(false);
    expect(shouldWatch({ protocol: 'file:', hostname: '' }, {})).toBe(false);
  });
});

const page = (js: string) => `<!doctype html><head><script type="module" crossorigin src="./assets/${js}"></script></head><body></body>`;

describe('bundle detection', () => {
  it('reads the bundle name from an index.html', () => {
    expect(bundleOf(page('index-7mBxvlx1.js'))).toBe('index-7mBxvlx1.js');
    expect(bundleOf('<script type="module" src="/src/main.tsx"></script>')).toBeNull();
  });
  it('reads the running bundle from the document, and none on the dev server', () => {
    const d = new DOMParser().parseFromString(page('index-aaa.js'), 'text/html');
    expect(runningBundle(d)).toBe('index-aaa.js');
    expect(runningBundle(new DOMParser().parseFromString('<script src="/src/main.tsx"></script>', 'text/html'))).toBeNull();
  });
});

describe('watchForUpdate', () => {
  class Tgt extends EventTarget { visibilityState = 'visible'; }
  let html: string, calls: number, offline: boolean, ver: BuildVersion | null | 'throw';
  const setup = (over: Partial<Parameters<typeof watchForUpdate>[0]> = {}) => {
    const doc = new Tgt(), win = new Tgt(), onStale = vi.fn();
    const w = watchForUpdate({
      current: 'index-aaa.js', onStale, target: doc, focusTarget: win,
      fetchHtml: async () => { calls++; if (offline) throw new Error('offline'); return html; },
      getVersion: async () => { if (ver === 'throw') throw new Error('x'); return ver; }, ...over });
    return { doc, win, onStale, w };
  };
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); html = page('index-aaa.js'); calls = 0; offline = false; ver = { version: '0.6.5', kit: 'bbb' }; });
  afterEach(() => vi.useRealTimers());
  const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

  it('compares the running bundle (not the first fetch) and reports a newer build once, with its version', async () => {
    html = page('index-bbb.js');   // already deployed when this page loaded an older build
    const { onStale, w } = setup();
    await tick(5 * 60_000);
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(onStale).toHaveBeenCalledWith({ version: '0.6.5' });
    await tick(60 * 60_000);
    expect(onStale).toHaveBeenCalledTimes(1);
    w.stop();
  });
  it('uses the generic notice when version.json is missing, invalid or fails', async () => {
    for (const v of [null, 'throw' as const]) {
      ver = v; html = page('index-bbb.js');
      const { onStale, w } = setup();
      expect(await w.check(true)).toEqual({ state: 'newer' });
      expect(onStale).toHaveBeenCalledWith({});
      w.stop();
    }
  });
  it('says nothing for the same build, offline, or a page without a bundle name', async () => {
    const { onStale, w } = setup();
    expect(await w.check(true)).toEqual({ state: 'latest' });
    offline = true; expect(await w.check(true)).toEqual({ state: 'unknown' });
    offline = false; html = '<html></html>'; expect(await w.check(true)).toEqual({ state: 'unknown' });
    await tick(30 * 60_000);
    expect(onStale).not.toHaveBeenCalled();
    w.stop();
  });
  it('does nothing without a hashed bundle (dev)', async () => {
    const { w } = setup({ current: null });
    expect(await w.check(true)).toEqual({ state: 'unknown' });
    expect(calls).toBe(0);
    w.stop();
  });
  it('checks no more than once every 5 minutes, however often the tab is shown or focused, and not while hidden', async () => {
    const { doc, win, w } = setup({ intervalMs: 1000 });   // asked for 1 s: held to 5 minutes
    for (let i = 0; i < 5; i++) { doc.dispatchEvent(new Event('visibilitychange')); win.dispatchEvent(new Event('focus')); await tick(10_000); }
    expect(calls).toBe(1);   // the first event; the rest are too soon
    await tick(5 * 60_000);
    expect(calls).toBe(2);
    w.stop();
  });
  it('does not check on visibilitychange while hidden, but does on focus', async () => {
    const { doc, win, w } = setup({ intervalMs: 1e9 });
    calls = 0;
    doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange')); await tick(0);
    expect(calls).toBe(0);
    win.dispatchEvent(new Event('focus')); await tick(0);
    expect(calls).toBe(1);
    w.stop();
  });
  it('prompts when the tab is shown again after a deploy', async () => {
    const { doc, onStale, w } = setup();
    doc.dispatchEvent(new Event('visibilitychange')); await tick(0);
    expect(onStale).not.toHaveBeenCalled();
    html = page('index-ccc.js');
    await tick(6 * 60_000 - 1);
    doc.dispatchEvent(new Event('visibilitychange')); await tick(0);
    expect(onStale).toHaveBeenCalledTimes(1);
    w.stop();
  });
  it('a manual check ignores the limit and, once a newer build is found, keeps answering newer', async () => {
    const { w, onStale } = setup();
    expect(await w.check(true)).toEqual({ state: 'latest' });
    html = page('index-bbb.js');
    expect(await w.check(true)).toEqual({ state: 'newer', version: '0.6.5' });
    expect(await w.check(true)).toEqual({ state: 'newer', version: '0.6.5' });
    expect(onStale).toHaveBeenCalledTimes(1);
    w.stop();
  });
  it('stops cleanly', async () => {
    const { w, doc } = setup();
    w.stop();
    html = page('index-bbb.js');
    await tick(60 * 60_000); doc.dispatchEvent(new Event('visibilitychange')); await tick(0);
    expect(calls).toBe(0);
  });
});

describe('reloadGuarded', () => {
  it('reloads straight away when nothing is modified', () => {
    const reload = vi.fn(), guard = vi.fn();
    reloadGuarded({ anyDirty: () => false, guard, reload });
    expect(reload).toHaveBeenCalledTimes(1); expect(guard).not.toHaveBeenCalled();
  });
  it('hands the reload to the unsaved-changes guard when something is modified, and does not reload by itself', () => {
    const reload = vi.fn(); let held: (() => void) | null = null;
    reloadGuarded({ anyDirty: () => true, guard: (go) => { held = go; }, reload });
    expect(reload).not.toHaveBeenCalled();
    held!();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('decideUpdate', () => {
  const base = { stale: true, dirty: false, editing: false, hiddenMs: 120_000, autoOn: true };
  it('reloads at a fresh foreground moment when nothing is modified or being edited and the setting is on', () => {
    expect(decideUpdate(base)).toBe('reload');
    expect(decideUpdate({ ...base, hiddenMs: Infinity })).toBe('reload');   // launch
  });
  it('shows the notice when something is modified, an edit is open, or the setting is off', () => {
    expect(decideUpdate({ ...base, dirty: true })).toBe('notice');
    expect(decideUpdate({ ...base, editing: true })).toBe('notice');
    expect(decideUpdate({ ...base, autoOn: false })).toBe('notice');
  });
  it('never reloads a build found while the app was in use (not a foreground moment)', () => {
    expect(decideUpdate({ ...base, hiddenMs: null })).toBe('notice');
  });
  it('does nothing without a newer build', () => {
    expect(decideUpdate({ ...base, stale: false })).toBe('none');
    expect(decideUpdate({ ...base, stale: false, dirty: true, autoOn: false })).toBe('none');
  });
});

describe('the updated note across a reload', () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
  it('is read once', () => {
    const s = mem();
    expect(takeUpdated(s)).toBeNull();
    rememberUpdated('0.7.1', s);
    expect(takeUpdated(s)).toEqual({ version: '0.7.1' });
    expect(takeUpdated(s)).toBeNull();
  });
  it('keeps an unknown number as empty', () => {
    const s = mem(); rememberUpdated(undefined, s);
    expect(takeUpdated(s)).toEqual({ version: '' });
  });
  it('survives blocked or broken storage and bad content', () => {
    const blocked = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
    expect(() => rememberUpdated('1', blocked)).not.toThrow();
    expect(takeUpdated(blocked)).toBeNull();
    expect(() => rememberUpdated('1', null)).not.toThrow();
    expect(takeUpdated(null)).toBeNull();
    const s = mem(); s.setItem('cad.updatedTo', '{bad'); expect(takeUpdated(s)).toBeNull();
  });
});

describe('updateServiceWorker', () => {
  it('asks the registration to update, and ignores a missing registration, support or a failure', async () => {
    const update = vi.fn(async () => undefined);
    updateServiceWorker({ serviceWorker: { getRegistration: async () => ({ update }) } });
    await Promise.resolve(); await Promise.resolve();
    expect(update).toHaveBeenCalledTimes(1);
    expect(() => updateServiceWorker({ serviceWorker: { getRegistration: async () => undefined } })).not.toThrow();
    expect(() => updateServiceWorker({})).not.toThrow();
    expect(() => updateServiceWorker({ serviceWorker: { getRegistration: () => Promise.reject(new Error('x')) } })).not.toThrow();
    expect(() => updateServiceWorker({ serviceWorker: { getRegistration: async () => ({ update: () => Promise.reject(new Error('offline')) }) } })).not.toThrow();
  });
});

describe('check on resume', () => {
  class Tgt extends EventTarget { visibilityState = 'visible'; }
  let html: string, calls: number;
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); html = page('index-aaa.js'); calls = 0; });
  afterEach(() => vi.useRealTimers());
  const hide = (d: Tgt) => { d.visibilityState = 'hidden'; d.dispatchEvent(new Event('visibilitychange')); };
  const show = (d: Tgt) => { d.visibilityState = 'visible'; d.dispatchEvent(new Event('visibilitychange')); };
  const mk = () => {
    const doc = new Tgt(), win = new Tgt(), onResume = vi.fn(), onForeground = vi.fn();
    const w = watchForUpdate({ current: 'index-aaa.js', target: doc, focusTarget: win, onStale: vi.fn(), onResume, onForeground,
      fetchHtml: async () => { calls++; return html; }, getVersion: async () => ({ version: '0.7.1' }) });
    return { doc, onResume, onForeground, w };
  };

  it('bypasses the gap only after more than 60 s hidden', () => {
    expect(bypassGap(null)).toBe(false);
    expect(bypassGap(RESUME_MS)).toBe(false);
    expect(bypassGap(RESUME_MS + 1)).toBe(true);
    expect(bypassGap(Infinity)).toBe(true);
  });
  it('checks at launch without waiting for the gap and reports it as a foreground moment', async () => {
    const { onForeground, w } = mk();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    expect(onForeground).toHaveBeenCalledWith({ hiddenMs: Infinity, result: { state: 'latest' } });
    w.stop();
  });
  it('after 61 s hidden: checks at once despite the 5-minute gap, asks the service worker to update, and reports the hidden time', async () => {
    const { doc, onResume, onForeground, w } = mk();
    await vi.advanceTimersByTimeAsync(0); calls = 0; onForeground.mockClear(); onResume.mockClear();
    await vi.advanceTimersByTimeAsync(10_000);          // 10 s after the launch check: inside the gap
    hide(doc); await vi.advanceTimersByTimeAsync(61_000); html = page('index-bbb.js'); show(doc);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1); expect(onResume).toHaveBeenCalledTimes(1);
    expect(onForeground).toHaveBeenCalledWith({ hiddenMs: 61_000, result: { state: 'newer', version: '0.7.1' } });
    w.stop();
  });
  it('a short absence keeps the gap: no check, no service worker update', async () => {
    const { doc, onResume, onForeground, w } = mk();
    await vi.advanceTimersByTimeAsync(0); calls = 0; onForeground.mockClear(); onResume.mockClear();
    await vi.advanceTimersByTimeAsync(10_000);
    hide(doc); await vi.advanceTimersByTimeAsync(20_000); show(doc);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(0); expect(onResume).not.toHaveBeenCalled();
    expect(onForeground).toHaveBeenCalledWith({ hiddenMs: 20_000, result: { state: 'unknown' } });
    w.stop();
  });
  it('a newer build already found is reported again at the next foreground moment', async () => {
    html = page('index-bbb.js');
    const { doc, onForeground, w } = mk();
    await vi.advanceTimersByTimeAsync(100);
    hide(doc); await vi.advanceTimersByTimeAsync(5_000); show(doc); await vi.advanceTimersByTimeAsync(0);
    expect(onForeground).toHaveBeenLastCalledWith({ hiddenMs: 5_000, result: { state: 'newer', version: '0.7.1' } });
    w.stop();
  });
});
