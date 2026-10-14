import { describe, it, expect, vi, afterEach } from 'vitest';
import { createWebPlatform } from './web';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createWebPlatform listSamples', () => {
  it('maps index.json entries to sample urls under the base', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('/app/samples/index.json');
      return {
        ok: true,
        json: async () => [{ id: 'bolt', title: 'Bolt', file: 'bench-bolt.ckpart' }],
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    const p = createWebPlatform({ base: '/app/' });
    expect(await p.listSamples()).toEqual([
      { id: 'bolt', title: 'Bolt', url: '/app/samples/bench-bolt.ckpart' },
    ]);
  });

  it('returns [] when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await createWebPlatform({ base: '/' }).listSamples()).toEqual([]);
  });

  it('returns [] when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => [] }) as unknown as Response));
    expect(await createWebPlatform({ base: '/' }).listSamples()).toEqual([]);
  });
});

describe('createWebPlatform wasmUrl', () => {
  it('points at kernel/ck_wasm.wasm under the base', () => {
    expect(createWebPlatform({ base: '/app/' }).wasmUrl()).toBe('/app/kernel/ck_wasm.wasm');
    expect(createWebPlatform({}).wasmUrl()).toBe('/kernel/ck_wasm.wasm');
  });
});

describe('createWebPlatform saveFile', () => {
  it('downloads bytes and text with a type from the extension', async () => {
    const blobs: Blob[] = [];
    vi.stubGlobal('URL', { createObjectURL: (b: Blob) => { blobs.push(b); return 'blob:x'; }, revokeObjectURL: () => {} });
    const clicks: string[] = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) { clicks.push(this.download); };
    try {
      const p = createWebPlatform({});
      await p.saveFile('a.stl', new Uint8Array([1, 2, 3]));
      await p.saveFile('b.dxf', '0\nEOF\n');
      await p.saveFile('c.bin', 'x', 'text/plain');
    } finally { HTMLAnchorElement.prototype.click = orig; }
    expect(clicks).toEqual(['a.stl', 'b.dxf', 'c.bin']);
    expect(blobs.map((b) => b.type)).toEqual(['model/stl', 'image/vnd.dxf', 'text/plain']);
    expect(blobs[0].size).toBe(3);
  });
});

import { saveDocumentWith, readHandleWith, type FsEnv } from './fsaccess';

const fakeHandle = (name: string, perm = 'granted') => {
  const writes: string[] = [];
  return {
    name, writes,
    createWritable: async () => ({ write: async (d: string) => { writes.push(d); }, close: async () => {} }),
    queryPermission: async () => perm,
    requestPermission: async () => perm,
    getFile: async () => ({ text: async () => 'file text' }),
  };
};

describe('saveDocumentWith', () => {
  it('downloads when there is no picker', async () => {
    const dl: string[] = [];
    const env: FsEnv = { download: async (n) => { dl.push(n); } };
    expect(await saveDocumentWith(env, 'a.ckpart', 'x')).toEqual({ name: 'a.ckpart', handle: null });
    expect(dl).toEqual(['a.ckpart']);
  });
  it('picks a file the first time and overwrites it the second time', async () => {
    const h = fakeHandle('picked.ckpart');
    let picks = 0;
    const env: FsEnv = { showSaveFilePicker: async () => { picks++; return h; }, download: async () => { throw new Error('no download'); } };
    const first = await saveDocumentWith(env, 'a.ckpart', 'one');
    expect(first).toEqual({ name: 'picked.ckpart', handle: h });
    await saveDocumentWith(env, 'a.ckpart', 'two', { handle: first!.handle });
    expect(picks).toBe(1);
    expect(h.writes).toEqual(['one', 'two']);
  });
  it('asks again with pick (Save As)', async () => {
    const h = fakeHandle('x.ckpart');
    let picks = 0;
    const env: FsEnv = { showSaveFilePicker: async () => { picks++; return fakeHandle('y.ckpart'); }, download: async () => {} };
    const r = await saveDocumentWith(env, 'y.ckpart', 'd', { handle: h, pick: true });
    expect(picks).toBe(1);
    expect(r!.name).toBe('y.ckpart');
    expect(h.writes).toEqual([]);
  });
  it('returns null when the dialog is cancelled and does not download', async () => {
    const env: FsEnv = { showSaveFilePicker: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); }, download: async () => { throw new Error('no'); } };
    expect(await saveDocumentWith(env, 'a.ckpart', 'x')).toBeNull();
  });
  it('falls back to a download when the picker fails otherwise, and when permission is refused it asks the picker', async () => {
    const dl: string[] = [];
    const env: FsEnv = { showSaveFilePicker: async () => { throw new Error('SecurityError'); }, download: async (n) => { dl.push(n); } };
    expect((await saveDocumentWith(env, 'a.ckpart', 'x'))!.handle).toBeNull();
    expect(dl).toEqual(['a.ckpart']);
    const denied = fakeHandle('old.ckpart', 'denied');
    const env2: FsEnv = { showSaveFilePicker: async () => fakeHandle('new.ckpart'), download: async () => {} };
    expect((await saveDocumentWith(env2, 'a.ckpart', 'x', { handle: denied }))!.name).toBe('new.ckpart');
    expect(denied.writes).toEqual([]);
  });
});

describe('readHandleWith', () => {
  it('reads a permitted handle, reports denied, and tolerates junk', async () => {
    expect(await readHandleWith(fakeHandle('a.ckpart'))).toEqual({ name: 'a.ckpart', text: 'file text' });
    expect(await readHandleWith(fakeHandle('a.ckpart', 'denied'))).toBe('denied');
    expect(await readHandleWith(undefined)).toBeNull();
    expect(await readHandleWith({})).toBeNull();
  });
});
