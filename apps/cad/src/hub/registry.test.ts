import { describe, it, expect, vi } from 'vitest';
import {
  HUB_PARSER_VERSION,
  BUILTIN_HUB_INDEX,
  BUILTIN_REGISTRY_ID,
  HUB_FORMAT,
  HUB_VERSION,
  HubError,
  HubRegistryStore,
  fetchHubIndex,
  filterHubPackages,
  hubCategories,
  hubSourceLink,
  hubTags,
  isValidHubSource,
  parseHubIndexJson,
  validateHubIndex,
  type HubIndex,
  type HubPackage,
} from './registry';
import type { FetchLike, FetchResponse } from '../library/source';
import type { KV } from '../library/registry';

function memKv(): KV {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => { m.set(k, v); },
    removeItem: (k) => { m.delete(k); },
  };
}

function jsonResp(body: unknown, status = 200, url?: string): FetchResponse {
  const bytes = new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body));
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: { get: (n) => (n.toLowerCase() === 'content-length' ? String(bytes.byteLength) : null) },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

const VALID_SHA = 'a'.repeat(64);
const samplePkg = (over: Partial<HubPackage> = {}): HubPackage => ({
  id: 'sample-pkg',
  name: 'Sample Package',
  kind: 'part',
  summary: 'A sample community CAD part.',
  author: 'alice',
  version: '1.0.0',
  license: 'MIT',
  category: 'mechanical',
  tags: ['sample', 'bracket'],
  source: 'github:alice/sample-pkg@v1.0.0',
  sha256: VALID_SHA,
  updatedAt: '2026-11-01',
  ...over,
});

const sampleIndex = (packages: HubPackage[] = [samplePkg()], over: Partial<HubIndex> = {}): HubIndex => ({
  format: HUB_FORMAT,
  version: HUB_VERSION,
  name: 'Test Community Hub',
  packages,
  ...over,
});

describe('hub registry schema & validator', () => {
  it('BUILTIN_HUB_INDEX is valid and contains real released SolidCraft plugins', () => {
    const res = validateHubIndex(BUILTIN_HUB_INDEX);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.warnings).toEqual([]);
    expect(res.index.packages.length).toBeGreaterThanOrEqual(25);
    expect(res.index.packages.every((p) => p.kind === 'plugin' && !!p.downloadUrl)).toBe(true);   // only entries with a release zip
    expect(res.index.packages.some((p) => p.id === 'timber')).toBe(false);   // its catalog zip is the source archive, no wasm
    expect(res.index.packages.some((p) => p.id === 'box-importer')).toBe(false);   // its release is an app tag, no zip
    expect(res.index.packages.some((p) => p.id === 'solidcraft-gears')).toBe(true);
    expect(res.index.packages.some((p) => p.id === 'gridfinity')).toBe(true);
    expect(res.index.packages.some((p) => p.id === 'woodwork')).toBe(true);
  });

  it('the live catalog: an entry with a tag but no zip, and a hidden id, are left out', () => {
    const z = (slug: string) => `https://github.com/o/${slug}/releases/download/v1/${slug}.zip`;
    const plug = (slug: string, release: object) => ({ id: slug, repo: `o/${slug}`, name: slug, description: 'd', version: '1.0.0', license: 'MIT', release });
    const r = parseHubIndexJson(JSON.stringify({ plugins: [plug('good', { tag: 'v1', zip: z('good') }), plug('apptag', { tag: 'v0.45.0b-android' }), plug('timber', { tag: 'v1', zip: z('timber') })] }));
    expect(r.ok && r.index.packages.map((p) => p.id)).toEqual(['good']);
  });

  it('parseHubIndexJson parses SolidCraft plugins.json and skips plugins without releases', () => {
    const raw = {
      generated: '2026-11-22T12:00:00Z',
      plugins: [
        {
          repo: 'bherbruck/solidcraft-gears',
          url: 'https://github.com/bherbruck/solidcraft-gears',
          owner: 'bherbruck',
          id: 'solidcraft-gears',
          slug: 'solidcraft-gears',
          name: 'Gears',
          description: 'Involute spur gear generator.',
          version: '0.1.1',
          license: 'MIT',
          category: 'Gears & motion',
          topics: ['cad', 'gears'],
          updated: '2026-11-12T22:08:00Z',
          release: { tag: 'v0.1.1', zip: 'https://github.com/bherbruck/solidcraft-gears/releases/download/v0.1.1/solidcraft-gears-0.1.1.zip' },
        },
        {
          repo: 'someone/unreleased-plugin',
          owner: 'someone',
          id: 'unreleased-plugin',
          name: 'Unreleased Plugin',
          description: 'Has no release yet.',
          release: null,
        },
      ],
    };
    const res = parseHubIndexJson(JSON.stringify(raw));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.index.packages.map((p) => p.id)).toEqual(['solidcraft-gears']);
    expect(res.index.packages[0].source).toBe('github:bherbruck/solidcraft-gears@v0.1.1');
    expect(res.index.packages[0].downloadUrl).toContain('solidcraft-gears-0.1.1.zip');
  });

  it('rejects non-objects, invalid JSON, wrong format, and unsupported version with plain-English diagnostics', () => {
    expect(validateHubIndex(null).ok).toBe(false);
    expect(validateHubIndex([]).ok).toBe(false);

    const badJson = parseHubIndexJson('{not json');
    expect(badJson.ok).toBe(false);
    if (!badJson.ok) expect(badJson.diagnostics[0].message).toContain('Invalid JSON');

    const badFmt = validateHubIndex({ ...sampleIndex(), format: 'other', version: 99 });
    expect(badFmt.ok).toBe(false);
    if (!badFmt.ok) {
      expect(badFmt.diagnostics.some((d) => d.path === 'format' && d.message.includes('ck-hub'))).toBe(true);
      expect(badFmt.diagnostics.some((d) => d.path === 'version' && d.message.includes('99'))).toBe(true);
    }
  });

  it('validates sources strictly: allows github: and https://, rejects unsafe schemes and traversal', () => {
    expect(isValidHubSource('github:owner/repo@v1.2.3')).toBe(true);
    expect(isValidHubSource('github:owner/repo')).toBe(true);
    expect(isValidHubSource('https://example.org/releases/pkg.zip')).toBe(true);

    expect(isValidHubSource('javascript:alert(1)')).toBe(false);
    expect(isValidHubSource('data:text/plain,hello')).toBe(false);
    expect(isValidHubSource('file:///etc/passwd')).toBe(false);
    expect(isValidHubSource('http://example.org/pkg.zip')).toBe(false);
    expect(isValidHubSource('https://user:pass@example.org/pkg.zip')).toBe(false);
    expect(isValidHubSource('github:owner/repo@../escape')).toBe(false);

    expect(hubSourceLink('github:owner/repo@v1.0.0')).toBe('https://github.com/owner/repo/tree/v1.0.0');
    expect(hubSourceLink('https://example.org/pkg')).toBe('https://example.org/pkg');
  });

  it('validates sha256 (64 hex chars), duplicate ids, kinds, preview URLs, and cleans control chars', () => {
    const res = validateHubIndex(sampleIndex([
      samplePkg({ id: 'pkg-1', sha256: 'A'.repeat(64), name: 'Clean\u202eName', tags: ['TagA', 'taga'] }),
    ]));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.index.packages[0].sha256).toBe('a'.repeat(64));
      expect(res.index.packages[0].name).toBe('Clean Name');
      expect(res.index.packages[0].tags).toEqual(['taga']);
    }

    const bad = validateHubIndex(sampleIndex([
      samplePkg({ id: 'dup', sha256: 'not-a-sha', kind: 'widget' as never, preview: 'http://insecure.example/img.png' }),
      samplePkg({ id: 'dup', source: 'javascript:evil()' }),
    ]));
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      const paths = bad.diagnostics.map((d) => d.path);
      expect(paths).toContain('packages[0].sha256');
      expect(paths).toContain('packages[0].kind');
      expect(paths).toContain('packages[0].preview');
      expect(paths).toContain('packages[1].id');
      expect(paths).toContain('packages[1].source');
    }
  });
});

describe('filterHubPackages', () => {
  const pkgs: HubPackage[] = [
    samplePkg({ id: 'a', name: 'Alpha Bracket', kind: 'part', author: 'zoe', category: 'structural', tags: ['cnc', 'aluminum'], updatedAt: '2026-10-01', sha256: VALID_SHA }),
    samplePkg({ id: 'b', name: 'Beta Gridfinity', kind: 'plugin', author: 'alex', category: 'organizers', tags: ['3d-printing', 'bins'], updatedAt: '2026-11-10', sha256: undefined }),
    samplePkg({ id: 'c', name: 'Gamma Fasteners', kind: 'library', author: 'maya', category: 'fasteners', tags: ['metric', 'cnc'], updatedAt: '2026-10-20', sha256: VALID_SHA }),
    samplePkg({ id: 'd', name: 'Delta Arm', kind: 'assembly', author: 'alex', category: 'robotics', tags: ['urdf', '3d-printing'], updatedAt: '2026-11-15', sha256: VALID_SHA }),
  ];

  it('filters by query, kind, category, tag(s), and verifiedOnly', () => {
    expect(filterHubPackages(pkgs, { query: 'gridfinity' }).map((p) => p.id)).toEqual(['b']);
    expect(filterHubPackages(pkgs, { query: 'alex urdf' }).map((p) => p.id)).toEqual(['d']);
    expect(filterHubPackages(pkgs, { kind: 'plugin' }).map((p) => p.id)).toEqual(['b']);
    expect(filterHubPackages(pkgs, { category: 'fasteners' }).map((p) => p.id)).toEqual(['c']);
    expect(filterHubPackages(pkgs, { tag: 'cnc' }).map((p) => p.id)).toEqual(['a', 'c']);
    expect(filterHubPackages(pkgs, { tags: ['cnc', 'metric'] }).map((p) => p.id)).toEqual(['c']);
    expect(filterHubPackages(pkgs, { verifiedOnly: true }).map((p) => p.id)).toEqual(['a', 'd', 'c']);
  });

  it('sorts by name, kind, updated (newest first), and author', () => {
    expect(filterHubPackages(pkgs, { sort: 'name' }).map((p) => p.id)).toEqual(['a', 'b', 'd', 'c']);
    expect(filterHubPackages(pkgs, { sort: 'kind' }).map((p) => p.id)).toEqual(['b', 'c', 'd', 'a']);
    expect(filterHubPackages(pkgs, { sort: 'updated' }).map((p) => p.id)).toEqual(['d', 'b', 'c', 'a']);
    expect(filterHubPackages(pkgs, { sort: 'author' }).map((p) => p.id)).toEqual(['b', 'd', 'c', 'a']);
  });

  it('collects unique sorted categories and tags', () => {
    expect(hubCategories(pkgs)).toEqual(['fasteners', 'organizers', 'robotics', 'structural']);
    expect(hubTags(pkgs)).toEqual(['3d-printing', 'aluminum', 'bins', 'cnc', 'metric', 'urdf']);
  });
});

describe('fetchHubIndex and HubRegistryStore', () => {
  it('drops a cache made by an older parser or older than a day for the built-in registry', async () => {
    const kv = memKv();
    const stale = sampleIndex([samplePkg({ id: 'removed-entry', name: 'Removed', kind: 'plugin' })], { name: 'old' });
    kv.setItem('ck.hub.cache.v1', JSON.stringify({ v: 1, entries: { [BUILTIN_REGISTRY_ID]: { at: 1700000000000, index: stale } } }));
    const fetchNever: FetchLike = vi.fn(async () => { throw new Error('offline'); });
    const store = new HubRegistryStore({ fetch: fetchNever, kv, now: () => 1700000000000 });
    expect((await store.load()).index.name).toBe(BUILTIN_HUB_INDEX.name);   // the v1 copy is not shown
    expect(kv.getItem('ck.hub.cache.v1')).toBeNull();
    kv.setItem('ck.hub.cache.v2', JSON.stringify({ v: 2, p: HUB_PARSER_VERSION - 1, entries: { [BUILTIN_REGISTRY_ID]: { at: 1700000000000, index: stale } } }));
    expect((await new HubRegistryStore({ fetch: fetchNever, kv, now: () => 1700000000000 }).load()).index.name).toBe(BUILTIN_HUB_INDEX.name);
    kv.setItem('ck.hub.cache.v2', JSON.stringify({ v: 2, p: HUB_PARSER_VERSION, entries: { [BUILTIN_REGISTRY_ID]: { at: 1700000000000, index: stale } } }));
    expect((await new HubRegistryStore({ fetch: fetchNever, kv, now: () => 1700000000000 + 3600_000 }).load()).index.name).toBe('old');   // same parser, under a day: used
    expect((await new HubRegistryStore({ fetch: fetchNever, kv, now: () => 1700000000000 + 25 * 3600_000 }).load()).index.name).toBe(BUILTIN_HUB_INDEX.name);   // a day on: the snapshot
  });

  it('fetches, validates, caches, and falls back to cached index when offline', async () => {
    const kv = memKv();
    const remoteIndex = sampleIndex([samplePkg({ id: 'remote-1', name: 'Remote Gear Plugin', kind: 'plugin' })], { name: 'Custom Team Hub' });
    let online = true;
    const mockFetch: FetchLike = vi.fn(async () => {
      if (!online) throw new Error('offline');
      return jsonResp(remoteIndex);
    });

    const store = new HubRegistryStore({ fetch: mockFetch, kv, now: () => 1700000000000 });
    expect(store.listRegistries()).toHaveLength(1);
    expect(store.activeRegistryId()).toBe(BUILTIN_REGISTRY_ID);

    // Built-in loads without network
    const builtin = await store.load();
    expect(builtin.index.name).toBe(BUILTIN_HUB_INDEX.name);
    expect(mockFetch).not.toHaveBeenCalled();

    // Add custom registry
    const added = await store.addRegistry('https://hub.example.org/index.json');
    expect(added.offline).toBe(false);
    expect(added.index.name).toBe('Custom Team Hub');
    expect(store.listRegistries()).toHaveLength(2);
    expect(store.activeRegistryId()).toBe('https://hub.example.org/index.json');

    // Persists across reload of store
    const store2 = new HubRegistryStore({ fetch: mockFetch, kv });
    expect(store2.listRegistries()).toHaveLength(2);
    expect(store2.activeRegistryId()).toBe('https://hub.example.org/index.json');

    // Offline refresh falls back cleanly to cached index
    online = false;
    const offlineRes = await store2.load(undefined, { refresh: true });
    expect(offlineRes.offline).toBe(true);
    expect(offlineRes.error).toContain('Could not reach');
    expect(offlineRes.index.packages[0].id).toBe('remote-1');

    // Removing custom registry restores built-in; removing built-in is ignored
    store2.removeRegistry(BUILTIN_REGISTRY_ID);
    expect(store2.listRegistries()).toHaveLength(2);
    store2.removeRegistry('https://hub.example.org/index.json');
    expect(store2.listRegistries()).toHaveLength(1);
    expect(store2.activeRegistryId()).toBe(BUILTIN_REGISTRY_ID);
  });

  it('rejects non-HTTPS URLs, HTTP errors, and schema errors in fetchHubIndex', async () => {
    const okFetch: FetchLike = vi.fn(async () => jsonResp(sampleIndex()));
    await expect(fetchHubIndex('http://insecure.example/index.json', { fetch: okFetch })).rejects.toThrow(HubError);

    const errFetch: FetchLike = vi.fn(async () => jsonResp('not found', 404));
    await expect(fetchHubIndex('https://hub.example.org/index.json', { fetch: errFetch })).rejects.toThrow(/HTTP 404/);

    const badSchemaFetch: FetchLike = vi.fn(async () => jsonResp({ format: 'wrong', version: 1 }));
    await expect(fetchHubIndex('https://hub.example.org/index.json', { fetch: badSchemaFetch })).rejects.toThrow(/ck-hub/);
  });
});
