import { describe, expect, it } from 'vitest';
import { licenceClass, validateManifest, MANIFEST_MAX_BYTES, type ManifestIssue } from './manifest';
import { LibraryError, parseSource, readLimited, sourceKey } from './source';
import { imageType } from './registry';
import { parsePart } from './partFile';
import { buildInsert, freePrefix, liveSources, withSource } from './insert';
import { GH_BASE, fakeNet, fixtureFiles, makeRegistry, memoryKV, sha } from './testkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURE_DIR } from './testkit';
import type { PartDoc } from '@ck/part-model';

const manifest = (): Record<string, unknown> => JSON.parse(readFileSync(join(FIXTURE_DIR, 'library.json'), 'utf8'));
const codes = (r: ReturnType<typeof validateManifest>): string[] => (r.ok ? [] : r.issues.map((i: ManifestIssue) => `${i.path}:${i.code}`));
const err = async (p: Promise<unknown>): Promise<LibraryError> => { try { await p; } catch (e) { return e as LibraryError; } throw new Error('did not throw'); };

describe('manifest validation', () => {
  it('accepts the fixture library, ignores unknown fields and cleans text', () => {
    const m = manifest(); m.future = { x: 1 }; (m.parts as Array<Record<string, unknown>>)[0].title = '  Small‮ block\n ';
    const r = validateManifest(m, { requireSha: true });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.manifest.parts).toHaveLength(3); expect(r.manifest.parts[0].title).toBe('Small block'); expect('future' in r.manifest).toBe(false); }
  });
  it('reports missing fields', () => {
    expect(codes(validateManifest({}))).toEqual(expect.arrayContaining(['format:format', 'version:version', 'name:name', 'parts:parts']));
    expect(codes(validateManifest(null))).toEqual([':notObject']);
    const m = manifest(); delete (m.parts as Array<Record<string, unknown>>)[1].file; delete (m.parts as Array<Record<string, unknown>>)[1].title;
    expect(codes(validateManifest(m))).toEqual(expect.arrayContaining(['parts.1.file:file', 'parts.1.title:title']));
  });
  it('requires a sha256 for remote libraries only', () => {
    const m = manifest(); delete (m.parts as Array<Record<string, unknown>>)[0].sha256;
    expect(codes(validateManifest(m, { requireSha: true }))).toEqual(['parts.0.sha256:sha256Missing']);
    expect(validateManifest(m).ok).toBe(true);
    (m.parts as Array<Record<string, unknown>>)[0].sha256 = 'xyz';
    expect(codes(validateManifest(m))).toEqual(['parts.0.sha256:sha256']);
  });
  it('refuses paths that leave the folder, duplicate ids and non-https links', () => {
    const m = manifest(); const p = m.parts as Array<Record<string, unknown>>;
    p[0].file = '../secret.ckpart'; p[1].file = 'https://evil.example/x.ckpart'; p[2].id = p[1].id; p[2].source = 'http://example.com/x'; m.homepage = 'javascript:alert(1)';
    expect(codes(validateManifest(m))).toEqual(expect.arrayContaining(['parts.0.file:file', 'parts.1.file:file', 'parts.2.id:duplicateId', 'parts.2.source:source', 'homepage:homepage']));
  });
  it('treats a missing licence as unknown and a free-text licence as an error', () => {
    const m = manifest(); delete m.licence;
    const r = validateManifest(m); expect(r.ok && r.manifest.licence).toBe(undefined);
    expect(licenceClass(undefined)).toBe('unknown');
    expect(codes(validateManifest({ ...manifest(), licence: '<script>alert(1)</script>' }))).toEqual(['licence:licence']);
  });
  it('classifies licences', () => {
    for (const l of ['MIT', 'BSD-2-Clause', 'Apache-2.0', 'ISC', 'CC0-1.0', 'CC-BY-4.0', 'OFL-1.1', 'Unlicense', 'MIT OR Apache-2.0']) expect(licenceClass(l), l).toBe('permissive');
    for (const l of ['GPL-3.0', 'GPL-3.0-or-later', 'LGPL-2.1', 'CC-BY-SA-4.0', 'CC-BY-NC-4.0', 'AGPL-3.0', 'MIT AND GPL-2.0', 'Proprietary']) expect(licenceClass(l), l).toBe('other');
  });
});

describe('sources', () => {
  it('parses github, https and refuses the rest', () => {
    expect(parseSource('github:owner/repo')).toEqual({ kind: 'github', owner: 'owner', repo: 'repo', ref: null });
    expect(sourceKey(parseSource('github:owner/repo@v1.2'))).toBe('github:owner/repo@v1.2');
    expect(parseSource('https://github.com/owner/repo')).toMatchObject({ kind: 'github', repo: 'repo' });
    expect(parseSource('https://example.com/libs/')).toEqual({ kind: 'url', url: 'https://example.com/libs/library.json' });
    for (const bad of ['http://example.com/library.json', 'ftp://example.com/x', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/plain,hi', 'github:owner', 'github:o/r@../x', 'https://user:pw@example.com/library.json']) {
      expect(() => parseSource(bad), bad).toThrow(LibraryError);
    }
    expect(() => parseSource('http://localhost:8080/library.json')).toThrow();
    expect(parseSource('http://localhost:8080/library.json', { allowLocalhost: true })).toMatchObject({ kind: 'url' });
  });
  it('stops reading at the size limit', async () => {
    const big = new Response(new Uint8Array(2000));
    expect((await err(readLimited(big as never, 1000))).code).toBe('tooLarge');
    const declared = new Response('x', { headers: { 'content-length': '99999999' } });
    expect((await err(readLimited(declared as never, 1000))).code).toBe('tooLarge');
    expect((await readLimited(new Response('abc') as never, 10)).length).toBe(3);
  });
  it('sniffs images by content', () => {
    expect(imageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0]))).toBe('image/png');
    expect(imageType(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeNull();
  });
});

describe('part files', () => {
  it('parses a valid part and rejects the rest', () => {
    const ok = readFileSync(join(FIXTURE_DIR, 'parts/block-small.ckpart'));
    expect(parsePart(new Uint8Array(ok)).features).toHaveLength(2);
    const bad = (s: string) => () => parsePart(new TextEncoder().encode(s));
    expect(bad('not json')).toThrow(LibraryError);
    expect(bad('[]')).toThrow(LibraryError);
    expect(bad('{"features":[]}')).toThrow(LibraryError);
    expect(bad('{"format":"other","features":[{"id":"F1","type":"x"}]}')).toThrow(LibraryError);
    expect(bad('{"features":[{"id":"F1","type":"x"},{"id":"F1","type":"x"}]}')).toThrow(LibraryError);
    expect(bad('{"features":[{"id":"F1","type":"x"}],"variables":[{"name":"1 bad","expr":"1"}]}')).toThrow(LibraryError);
  });
  it('the fixture checksums match', () => {
    for (const p of manifest().parts as Array<{ file: string; sha256: string; bytes: number }>) {
      const b = readFileSync(join(FIXTURE_DIR, p.file));
      expect(sha(b)).toBe(p.sha256); expect(b.length).toBe(p.bytes);
    }
  });
});

describe('registry against a fake network', () => {
  const setup = () => { const net = fakeNet([GH_BASE]); return { net, ...makeRegistry(net) }; };

  it('adds a github library, lists its manifest, downloads a verified part', async () => {
    const { registry, net } = setup();
    const pv = await registry.preview('github:example/parts');
    expect(pv.record).toMatchObject({ id: 'github:example/parts', name: 'Fixture parts', parts: 3, licence: 'CC0-1.0' });
    expect(pv.needsConfirm).toBe(false);
    expect(registry.list()).toHaveLength(0);   // a preview adds nothing
    await registry.add(pv);
    expect(registry.list().map((l) => l.id)).toEqual(['github:example/parts']);
    expect((await registry.manifest('github:example/parts')).manifest.parts).toHaveLength(3);
    const d = await registry.part('github:example/parts', 'block-small');
    expect(d.doc.features).toHaveLength(2); expect(d.fromCache).toBe(false);
    expect(net.calls.every((u) => u.startsWith('https://'))).toBe(true);
    expect(net.calls).toContain(GH_BASE + 'parts/block-small.ckpart');
  });

  it('refuses a part whose checksum or size is wrong, and one that is not a part', async () => {
    const { registry, net } = setup();
    await registry.add(await registry.preview('github:example/parts'));
    net.override('parts/block-small.ckpart', readFileSync(join(FIXTURE_DIR, 'parts/block-wide.ckpart')));
    expect((await err(registry.part('github:example/parts', 'block-small'))).code).toBe('size');
    const orig = readFileSync(join(FIXTURE_DIR, 'parts/block-small.ckpart'));
    const tampered = Buffer.from(orig.toString().replace('"depth": "=t"', '"depth": "=h"'));   // same length, different bytes
    expect(tampered.length).toBe(orig.length);
    net.override('parts/block-small.ckpart', tampered);
    expect((await err(registry.part('github:example/parts', 'block-small'))).code).toBe('sha');
    net.override('parts/block-small.ckpart', Buffer.alloc(0));
    expect((await err(registry.part('github:example/parts', 'block-small'))).code).toBe('size');
  });

  it('refuses an oversized manifest, a bad manifest and a non-https address', async () => {
    const { registry, net } = setup();
    net.override('library.json', new Uint8Array(MANIFEST_MAX_BYTES + 1));
    expect((await err(registry.preview('github:example/parts'))).code).toBe('tooLarge');
    net.override('library.json', '{"format":"fwlib","version":1,"name":"x","parts":[{"id":"a"}]}');
    const e = await err(registry.preview('github:example/parts'));
    expect(e.code).toBe('schema');
    net.override('library.json', '<html>');
    expect((await err(registry.preview('github:example/parts'))).code).toBe('parse');
    expect((await err(registry.preview('http://example.com/library.json'))).code).toBe('scheme');
    expect((await err(registry.preview('ftp://example.com/library.json'))).code).toBe('scheme');
  });

  it('a manifest with an unknown licence parses and asks for confirmation', async () => {
    const { registry, net } = setup();
    const m = manifest(); delete m.licence; for (const p of m.parts as Array<Record<string, unknown>>) delete p.licence;
    net.override('library.json', JSON.stringify(m));
    const pv = await registry.preview('github:example/parts');
    expect(pv.licence).toBeUndefined(); expect(pv.needsConfirm).toBe(true);
  });

  it('falls back to the mirror when the first server fails with a 5xx, but not on a 404', async () => {
    const mirror = 'https://cdn.jsdelivr.net/gh/example/parts/';
    const served = fakeNet([mirror]);
    const status = { code: 503 };
    const net = { ...served, fetch: async (u: string, i?: never) => (u.startsWith(GH_BASE) ? new Response('', { status: status.code }) : served.fetch(u, i)) };
    const { registry } = makeRegistry(net as never);
    expect((await registry.preview('github:example/parts')).record.parts).toBe(3);
    expect(served.calls.some((u) => u.startsWith(mirror))).toBe(true);
    status.code = 404;
    served.calls.length = 0;
    expect((await err(registry.preview('github:example/parts'))).code).toBe('http');
    expect(served.calls).toEqual([]);
  });

  it('adds, refreshes and removes a url library; cached files work offline; removal clears the cache', async () => {
    const base = 'https://example.com/libs/';
    const net = fakeNet([base]);
    const { registry, cache } = makeRegistry(net);
    const id = base + 'library.json';
    await registry.add(await registry.preview(id));
    await registry.part(id, 'block-wide');
    await registry.thumb(id, 'block-wide');
    expect(await registry.cacheSize(id)).toBeGreaterThan(1000);
    // refresh with a changed library
    const m = manifest(); m.name = 'Renamed'; net.override('library.json', JSON.stringify(m));
    expect((await registry.refresh(id)).manifest.name).toBe('Renamed');
    expect(registry.get(id)!.name).toBe('Renamed');
    // offline: the manifest and the part already fetched come from the cache, a part never fetched does not
    net.offline = true;
    const off = await registry.refresh(id);
    expect(off.offline).toBe(true); expect(off.manifest.name).toBe('Renamed');
    const calls = net.calls.length;
    const d = await registry.part(id, 'block-wide');
    expect(d.fromCache).toBe(true);
    expect((await err(registry.part(id, 'block-small'))).code).toBe('network');
    expect(net.calls.length).toBeGreaterThan(calls);
    // a registry rebuilt from the saved settings (a reload) still knows the library
    const again = makeRegistry(net, { kv: (registry as unknown as { d: { kv: never } }).d.kv, cache }).registry;
    expect(again.list().map((l) => l.id)).toEqual([id]);
    expect((await again.manifest(id)).manifest.name).toBe('Renamed');
    await registry.remove(id);
    expect(registry.list()).toEqual([]);
    expect(await cache.size(id)).toBe(0);
  });

  it('a local folder library is added with all its parts cached and keeps working after a reload', async () => {
    const net = fakeNet([]);
    const kv = memoryKV();
    const { registry, cache } = makeRegistry(net, { kv });
    const pv = await registry.preview({ local: fixtureFiles(), name: 'fixture' });
    expect(pv.record.id).toBe('local:fixture');
    await registry.add(pv);
    const reloaded = makeRegistry(net, { kv, cache }).registry;   // the folder handle is gone, the cache is not
    expect((await reloaded.part('local:fixture', 'block-small')).fromCache).toBe(true);
    expect(net.calls).toEqual([]);
  });

  it('adding the same library twice is refused', async () => {
    const { registry } = setup();
    await registry.add(await registry.preview('github:example/parts'));
    expect((await err(registry.preview('github:example/parts'))).code).toBe('exists');
  });

  it('bundled defaults come from the samples index and are never gated', async () => {
    const net = fakeNet(['/app/samples/']);
    net.override('index.json', JSON.stringify([{ id: 'bench-bolt', title: 'Bolt', file: 'bench-bolt.ckpart' }]));
    net.override('bench-bolt.ckpart', readFileSync(join(FIXTURE_DIR, 'parts/block-small.ckpart')));
    const { registry } = makeRegistry(net, { defaults: [{ id: 'samples', name: 'Bundled samples', source: 'bundled:samples', licence: 'LicenseRef-bundled' }] });
    expect(registry.list().map((l) => l.id)).toEqual(['samples']);
    const m = (await registry.manifest('samples')).manifest;
    expect(m.parts[0]).toMatchObject({ id: 'bench-bolt', category: 'bench' });
    expect(registry.needsConfirm('samples', 'LicenseRef-bundled')).toBe(false);
    expect((await registry.part('samples', 'bench-bolt')).doc.features).toHaveLength(2);
    await registry.remove('samples');
    expect(registry.list()).toEqual([]);
    registry.restoreDefaults();
    expect(registry.list()).toHaveLength(1);
  });
});

describe('licence confirmation', () => {
  it('a GPL library asks once, the choice sticks across a reload, and parts are refused until then', async () => {
    const base = 'https://example.com/gpl/';
    const net = fakeNet([base]);
    const m = manifest(); m.licence = 'GPL-3.0'; for (const p of m.parts as Array<Record<string, unknown>>) delete p.licence;
    net.override('library.json', JSON.stringify(m));
    const kv = memoryKV();
    const { registry, cache } = makeRegistry(net, { kv });
    const id = base + 'library.json';
    const pv = await registry.preview(id);
    expect(pv.needsConfirm).toBe(true);
    expect((await err(registry.add(pv))).code).toBe('needsConfirm');
    await registry.add(pv, { confirm: true });
    expect(registry.needsConfirm(id, 'GPL-3.0')).toBe(false);   // adding with confirmation is the confirmation
    expect((await registry.part(id, 'block-small')).licence).toBe('GPL-3.0');
    expect(makeRegistry(net, { kv, cache }).registry.needsConfirm(id, 'GPL-3.0')).toBe(false);   // remembered on this device
    expect(makeRegistry(net).registry.needsConfirm(id, 'GPL-3.0')).toBe(true);                      // a device without the choice asks

  });

  it('a part under its own non-permissive licence asks separately, once', async () => {
    const net = fakeNet(['https://example.com/libs/']);
    const { registry } = makeRegistry(net);
    const id = 'https://example.com/libs/library.json';
    await registry.add(await registry.preview(id));
    expect((await registry.part(id, 'block-small')).licence).toBe('CC0-1.0');
    expect((await err(registry.part(id, 'plate-gpl'))).code).toBe('needsConfirm');
    registry.confirm(id, 'GPL-3.0-or-later');
    expect((await registry.part(id, 'plate-gpl')).licence).toBe('GPL-3.0-or-later');
    expect(registry.needsConfirm(id, 'GPL-3.0-or-later')).toBe(false);
    expect(registry.needsConfirm(id, 'AGPL-3.0')).toBe(true);
  });
});

describe('buildInsert', () => {
  const doc = (vars: Array<{ name: string; expr: string }> = [], n = 3): PartDoc => ({ format: 'ck-part', version: 1, name: 'D', variables: vars, features: Array.from({ length: n - 1 }, (_, i) => ({ type: 'sketch', id: `F${i + 1}` })), seq: n }) as unknown as PartDoc;
  const part = (): PartDoc => parsePart(new Uint8Array(readFileSync(join(FIXTURE_DIR, 'parts/block-small.ckpart'))));
  const meta = { library: 'Fixture parts', libraryId: 'l', part: 'Small block', partId: 'block-small', ref: 'HEAD', sha256: 'abc', licence: 'CC0-1.0' };

  it('renumbers features after the document and prefixes the variables', () => {
    const d = doc([{ name: 'w', expr: '5' }]);
    const r = buildInsert(d, part(), meta);
    expect(r.idMap).toEqual({ F1: 'F3', F2: 'F4' });
    expect(r.patch.seq).toBe(5);
    const names = (r.patch.variables as Array<{ name: string }>).map((v) => v.name);
    expect(names).toEqual(['w', 'blocksmall_1_w', 'blocksmall_1_h', 'blocksmall_1_t']);
    const feats = r.patch.append as Array<Record<string, unknown>>;
    expect(feats.map((f) => f.id)).toEqual(['F3', 'F4']);
    expect(feats[1].sketch).toBe('F3'); expect(feats[1].depth).toBe('=blocksmall_1_t');
    const cons = feats[0].constraints as Array<{ expr?: string }>;
    expect(cons.filter((c) => c.expr).map((c) => c.expr)).toEqual(['blocksmall_1_w', 'blocksmall_1_h']);
    expect(r.entry).toMatchObject({ partId: 'block-small', features: ['F3', 'F4'], variablePrefix: 'blocksmall_1_', sha256: 'abc' });
  });
  it('a second insert gets another prefix and further ids', () => {
    const first = buildInsert(doc(), part(), meta);
    const d2 = { ...doc(first.patch.variables as never), features: [...doc().features, ...(first.patch.append as never[])], seq: first.patch.seq } as unknown as PartDoc;
    const second = buildInsert(d2, part(), meta);
    expect(freePrefix(first.patch.variables as never, 'block-small')).toBe('blocksmall_2_');
    expect((second.patch.append as Array<{ id: string }>).map((f) => f.id)).toEqual(['F5', 'F6']);
    const names = (second.patch.variables as Array<{ name: string }>).map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('blocksmall_2_w');
  });
  it('keeps only live provenance entries', () => {
    const d = doc(); const e = buildInsert(d, part(), meta).entry;
    const withIt = { ...d, sources: [e] } as unknown as PartDoc;
    expect(liveSources(withIt)).toEqual([]);   // its features are not in the document (undone)
    const full = { ...d, features: [...d.features, { id: 'F3', type: 'sketch' }, { id: 'F4', type: 'extrude' }], sources: [e] } as unknown as PartDoc;
    expect(liveSources(full)).toHaveLength(1);
    expect(withSource(full, { ...e, features: ['F4'] })).toHaveLength(2);
  });
});

describe('parts without an image, and what is installed', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const setup = async () => {
    const net = fakeNet([GH_BASE]);
    const made = makeRegistry(net);
    const id = 'github:example/parts';
    await made.registry.add(await made.registry.preview(id));
    return { net, id, ...made };
  };

  it('a part without a thumb is a warning, not an error', () => {
    const r = validateManifest(manifest(), { requireSha: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => `${w.path}:${w.code}`)).toEqual(['parts.0.thumb:thumbMissing', 'parts.1.thumb:thumbMissing', 'parts.2.thumb:thumbMissing']);
    const m = manifest(); (m.parts as Array<Record<string, unknown>>)[0].thumb = 'thumbs/a.png';
    const r2 = validateManifest(m, { requireSha: true });
    expect(r2.ok && r2.warnings).toHaveLength(2);
  });

  it('the preview counts the parts that have no image', async () => {
    const net = fakeNet([GH_BASE]);
    const { registry } = makeRegistry(net);
    expect((await registry.preview('github:example/parts')).missingThumbs).toBe(3);
  });

  it('install saves a verified part for offline use and installedIds lists it', async () => {
    const { registry, id, net } = await setup();
    expect([...await registry.installedIds(id)]).toEqual([]);
    let changes = 0;
    registry.subscribe(() => { changes++; });
    await registry.install(id, 'block-small');
    expect(changes).toBeGreaterThan(0);
    expect([...await registry.installedIds(id)]).toEqual(['block-small']);
    expect(await registry.isInstalled(id, 'block-small')).toBe(true);
    expect(await registry.isInstalled(id, 'block-wide')).toBe(false);
    net.offline = true;
    expect((await registry.part(id, 'block-small')).fromCache).toBe(true);
    // a checksum mismatch is refused and nothing is saved
    net.offline = false;
    net.override('parts/block-wide.ckpart', readFileSync(join(FIXTURE_DIR, 'parts/block-small.ckpart')));
    await expect(registry.install(id, 'block-wide')).rejects.toBeInstanceOf(LibraryError);
    expect(await registry.isInstalled(id, 'block-wide')).toBe(false);
  });

  it('a thumbnail rendered here is kept with the part (keyed by its sha256), only if it is a png, and goes when the library does', async () => {
    const { registry, id, cache } = await setup();
    expect(await registry.generatedThumb(id, 'block-small')).toBeNull();
    await registry.putGeneratedThumb(id, 'block-small', new Uint8Array([1, 2, 3, 4]));     // not an image: refused
    expect(await registry.generatedThumb(id, 'block-small')).toBeNull();
    await registry.putGeneratedThumb(id, 'block-small', PNG);
    expect(await registry.generatedThumb(id, 'block-small')).toEqual(PNG);
    const keys = await cache.keys(id);
    expect(keys.some((k) => k.includes('/gen#5591783fc16cf9b1afdb2600ec0bc425859d59ffbd20a0071c97f33e5e8fb1ee'))).toBe(true);
    await registry.refresh(id);
    expect(await registry.generatedThumb(id, 'block-small')).toEqual(PNG);                   // a refresh keeps it while the part is unchanged
    await registry.remove(id);
    expect(await cache.keys(id)).toEqual([]);
  });
});
