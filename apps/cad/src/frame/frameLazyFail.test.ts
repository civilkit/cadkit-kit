// A region that cannot be fetched (offline, a bad deploy) rejects, leaves nothing half-loaded, and loads on the next try.
import { describe, expect, it, vi } from 'vitest';
import { PROFILES, loadRegion, profileById, regionLoaded, regionLoading } from './frameLib';

describe('a failed region load', () => {
  it('rejects, is not left loading, and can be tried again', async () => {
    vi.doMock('./profiles.us.json', () => { throw new Error('offline'); });
    await expect(loadRegion('US')).rejects.toThrow();
    expect(regionLoaded('US')).toBe(false);
    expect(regionLoading('US')).toBe(false);
    expect(PROFILES.some((p) => p.region === 'US')).toBe(false);
    vi.doUnmock('./profiles.us.json');
    vi.resetModules();
    await loadRegion('US');
    expect(regionLoaded('US')).toBe(true);
    expect(profileById('us-w14x30')).toBeTruthy();
  });
});
