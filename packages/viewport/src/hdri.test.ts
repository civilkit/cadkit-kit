import { describe, it, expect, vi } from 'vitest';
import { loadHdri, onHdriProviderChanged, retryHdris, setHdriProvider } from './hdri';

describe('hdri provider', () => {
  it('gives nothing without a provider, or when the provider has no image', async () => {
    setHdriProvider(null);
    expect(await loadHdri('sky_01', {} as never)).toBeNull();
    setHdriProvider(async () => null);
    expect(await loadHdri('sky_01', {} as never)).toBeNull();
    setHdriProvider(async () => { throw new Error('offline'); });
    expect(await loadHdri('sky_01', {} as never)).toBeNull();
    setHdriProvider(null);
  });
  it('tells viewports when the provider changed or a retry was asked for', () => {
    const cb = vi.fn(), off = onHdriProviderChanged(cb);
    setHdriProvider(null); retryHdris();
    expect(cb).toHaveBeenCalledTimes(2);
    off(); retryHdris();
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
