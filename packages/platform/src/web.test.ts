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
