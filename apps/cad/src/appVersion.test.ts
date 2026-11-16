import { beforeEach, describe, expect, it } from 'vitest';
import { appVersion, loadAppVersion, versionLink } from './appVersion';

const ok = (body: unknown) => (async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch;

describe('appVersion', () => {
  beforeEach(() => { appVersion.value = null; });
  it('reads the version from version.json', async () => {
    await loadAppVersion(ok({ version: '0.7.3', kit: 'abc', kernel: 'x' }), 'https://example.test/cad/');
    expect(appVersion.value).toBe('0.7.3');
  });
  it('stays unknown for a missing file, an odd body or a failed fetch', async () => {
    await loadAppVersion((async () => ({ ok: false })) as unknown as typeof fetch, 'https://example.test/cad/');
    await loadAppVersion(ok({ version: 7 }), 'https://example.test/cad/');
    await loadAppVersion(ok(null), 'https://example.test/cad/');
    await loadAppVersion((async () => { throw new Error('offline'); }) as unknown as typeof fetch, 'https://example.test/cad/');
    expect(appVersion.value).toBeNull();
  });
  it('links to the What\'s new page next to the app', () => {
    expect(versionLink('0.7.3', 'https://example.test/cad/')).toEqual([{ label: 'v0.7.3', href: 'https://example.test/cad/whats-new/' }]);
    expect(versionLink(null, 'https://example.test/cad/')).toEqual([]);
  });
});
