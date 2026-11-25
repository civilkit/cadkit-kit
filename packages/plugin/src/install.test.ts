import { tooBigMessage } from './zip';
import { describe, expect, it } from 'vitest';
import { fetchZipUrl, PluginManager, PluginRegistry, builtinRegistry, contextOf, fetchGithubPackage, inspectPackage, memoryStore, packageHash, parseGithubSpec, sha256Hex, scriptGenerator, stripWrapper } from './index';

const enc = (s: string) => new TextEncoder().encode(s);
const SCRIPT = "part(uniqueName('Plate')).sketch('front', (s) => s.rect(params.width, 20)).extrude(params.t);\n";
async function pkg(over: Record<string, unknown> = {}, scripts: Record<string, string> = { 'gen/plate.js': SCRIPT }, hashes = true): Promise<Map<string, Uint8Array>> {
  const files: Record<string, string> = { ...scripts };
  const manifest: Record<string, unknown> = {
    id: 'acme.plates', name: 'Plates', version: '1.0.0', license: 'MIT', engine: '>=0.7.0',
    contributes: { generators: [{ id: 'plate', title: 'Plate', script: 'gen/plate.js', params: [{ name: 'width', type: 'number', default: 40, min: 1 }, { name: 't', type: 'number', default: 3, min: 0.1 }] }] },
    ...over,
  };
  if (hashes && !('files' in over)) manifest.files = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([k, v]) => [k, await sha256Hex(v)])));
  return new Map([['plugin.json', enc(JSON.stringify(manifest))], ...Object.entries(files).map(([k, v]) => [k, enc(v)] as [string, Uint8Array])]);
}
const mgr = (denied?: (id: string, h: string) => string | null) => new PluginManager({ registry: builtinRegistry(), store: memoryStore(), appVersion: '0.7.4', denied });

describe('inspecting a package', () => {
  it('accepts a good package and pins it by one hash that does not depend on the archive', async () => {
    const files = await pkg();
    const i = await inspectPackage(files);
    expect(i.ok, i.errors.join('; ')).toBe(true);
    expect(i.manifest!.id).toBe('acme.plates');
    expect(i.scripts!.plate).toBe(SCRIPT);
    expect(i.hash).toBe(await packageHash(Object.fromEntries(files)));
    const wrapped = new Map([...files].map(([k, v]) => [`acme-plates-1.0.0/${k}`, v]));
    expect(stripWrapper(wrapped).has('plugin.json')).toBe(true);
    expect((await inspectPackage(wrapped)).hash).toBe(i.hash);
  });
  it('lists every problem: missing script, bad paths, binary files, blocked words, tampering', async () => {
    const files = await pkg();
    expect((await inspectPackage(new Map([['x.js', enc('1')]]))).errors[0]).toMatch(/plugin\.json is missing/);
    const noScript = await pkg({ contributes: { generators: [{ id: 'plate', title: 'P', script: 'gen/none.js', params: [] }] } });
    expect((await inspectPackage(noScript)).errors.join()).toMatch(/"gen\/none.js" is not in the package/);
    const traversal = new Map(files); traversal.set('../evil.js', enc('1'));
    expect((await inspectPackage(traversal)).errors.join()).toMatch(/not a safe relative path/);
    const binary = new Map(files); binary.set('gen/x.wasm', enc('\0asm'));
    expect((await inspectPackage(binary)).errors.join()).toMatch(/only \.json, \.js, \.md, \.txt/);
    const evil = await pkg({}, { 'gen/plate.js': "fetch('http://x'); " + SCRIPT });
    expect((await inspectPackage(evil)).errors.join()).toMatch(/uses "fetch"/);
    const comment = await pkg({}, { 'gen/plate.js': "// we never call fetch here\n" + SCRIPT });
    expect((await inspectPackage(comment)).ok).toBe(true);   // words in comments do not count
    const tampered = new Map(files); tampered.set('gen/plate.js', enc(SCRIPT + '// edited'));
    expect((await inspectPackage(tampered)).errors.join()).toMatch(/does not match its sha256/);
    const unlisted = new Map(files); unlisted.set('extra.md', enc('hi'));
    expect((await inspectPackage(unlisted)).errors.join()).toMatch(/not listed in plugin\.json "files"/);
    const big = await pkg({}, { 'gen/plate.js': SCRIPT + 'x'.repeat(41000) });
    expect((await inspectPackage(big)).errors.join()).toMatch(/at most 40000/);
    expect((await inspectPackage(await pkg({}, undefined, false))).warnings.join()).toMatch(/no "files" hashes/);
  });
});

describe('script generators', () => {
  it('put params and uniqueName in scope', async () => {
    const g = scriptGenerator('part(uniqueName("A"));');
    const text = await g({ width: 5, label: 'x"y' }, contextOf(['A']));
    expect(text).toContain('const params = Object.freeze({"width":5,"label":"x\\"y"});');
    expect(text).toContain('const used = ["A"];');
    expect(text.endsWith('part(uniqueName("A"));')).toBe(true);
    // the generated header is valid script that computes unique names
    const run = new Function(`${text.replace('part(uniqueName("A"));', '')}; return [params.width, uniqueName('A'), uniqueName('B')];`);
    expect(run()).toEqual([5, 'A 2', 'B']);
  });
});

describe('the manager', () => {
  it('plan has no side effects; install registers the generators, which prepare() can run', async () => {
    const m = mgr();
    const plan = await m.plan(await pkg());
    expect(plan.refusal).toBeUndefined();
    expect(m.registry.find('acme.plates', 'plate')).toBeUndefined();
    const rec = await m.install(plan, { kind: 'zip', name: 'plates.zip' });
    expect(rec).toMatchObject({ id: 'acme.plates', enabled: true });
    const p = await m.registry.prepare('acme.plates', 'plate', { width: 25 }, contextOf([]));
    expect(p.ok && p.script).toContain('const params = Object.freeze({"width":25,"t":3});');
    expect(p.ok && p.script).toContain("s.rect(params.width, 20)");
    expect(m.registry.find('acme.plates', 'plate')!.plugin.builtin).toBe(false);
  });
  it('survives a restart through the store; disable hides the generators; remove forgets it', async () => {
    const store = memoryStore();
    const a = new PluginManager({ registry: builtinRegistry(), store, appVersion: '0.7.4' });
    await a.install(await a.plan(await pkg()), { kind: 'zip', name: 'p.zip' });
    const b = new PluginManager({ registry: builtinRegistry(), store, appVersion: '0.7.4' });
    await b.load();
    expect(b.registry.find('acme.plates', 'plate')).toBeDefined();
    await b.setEnabled('acme.plates', false);
    expect(b.registry.find('acme.plates', 'plate')).toBeUndefined();
    const c = new PluginManager({ registry: builtinRegistry(), store, appVersion: '0.7.4' });
    await c.load();
    expect(c.list()[0].enabled).toBe(false);
    expect(c.registry.find('acme.plates', 'plate')).toBeUndefined();
    await c.remove('acme.plates');
    expect((await store.all())).toHaveLength(0);
  });
  it('refuses built-in ids, a newer engine and a denied hash; shows what an update changes', async () => {
    const m = mgr();
    expect((await m.plan(await pkg({ id: 'civilkit.springs' }))).refusal).toMatch(/built-in/);
    expect((await m.plan(await pkg({ engine: '>=9.0.0' }))).refusal).toMatch(/needs app >=9\.0\.0/);
    const first = await m.plan(await pkg());
    const rec = await m.install(first, { kind: 'zip', name: 'a' });
    expect((await mgr((id, h) => (h === rec.hash ? 'reported unsafe' : null)).plan(await pkg())).refusal).toMatch(/reported unsafe/);
    const v2 = await pkg({ version: '1.1.0', contributes: { generators: [{ id: 'plate', title: 'Plate', script: 'gen/plate.js', params: [{ name: 'width', type: 'number', default: 50 }] }, { id: 'box', title: 'Box', script: 'gen/plate.js', params: [] }] } });
    const plan = await m.plan(v2);
    expect(plan.change).toMatchObject({ from: '1.0.0', to: '1.1.0', added: ['box'], removed: [], paramsChanged: ['plate'], sameHash: false });
    await m.install(plan, { kind: 'zip', name: 'b' });
    expect(m.list()).toHaveLength(1);
    expect(m.registry.find('acme.plates', 'box')).toBeDefined();
  });
  it('a deny-list hit after install switches the plugin off with the reason', async () => {
    const store = memoryStore();
    const a = new PluginManager({ registry: builtinRegistry(), store, appVersion: '0.7.4' });
    await a.install(await a.plan(await pkg()), { kind: 'zip', name: 'p' });
    const b = new PluginManager({ registry: builtinRegistry(), store, appVersion: '0.7.4', denied: (id) => (id === 'acme.plates' ? 'withdrawn by its author' : null) });
    await b.load();
    expect(b.list()[0].blocked).toBe('withdrawn by its author');
    expect(b.registry.find('acme.plates', 'plate')).toBeUndefined();
  });
});

describe('GitHub source', () => {
  it('parses the spec and warns about a moving ref', () => {
    expect(parseGithubSpec('github:acme/plates@v1.0.0')).toEqual({ owner: 'acme', repo: 'plates', ref: 'v1.0.0' });
    expect(parseGithubSpec('acme/plates')).toMatch(/github:owner/);
  });
  it('fetches plugin.json then each listed file from raw.githubusercontent.com and installs', async () => {
    const files = await pkg();
    const seen: string[] = [];
    const fetcher = async (url: string) => {
      seen.push(url);
      const path = url.replace('https://raw.githubusercontent.com/acme/plates/v1.0.0/', '');
      const f = files.get(path);
      return { ok: !!f, status: f ? 200 : 404, arrayBuffer: async () => (f ? f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) : new ArrayBuffer(0)) as ArrayBuffer };
    };
    const got = await fetchGithubPackage({ owner: 'acme', repo: 'plates', ref: 'v1.0.0' }, fetcher);
    expect('files' in got && got.warnings).toEqual([]);
    expect(seen).toEqual(['https://raw.githubusercontent.com/acme/plates/v1.0.0/plugin.json', 'https://raw.githubusercontent.com/acme/plates/v1.0.0/gen/plate.js']);
    if ('files' in got) expect((await inspectPackage(got.files)).ok).toBe(true);
    const branch = await fetchGithubPackage({ owner: 'acme', repo: 'plates', ref: 'main' }, async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }));
    expect(branch).toEqual({ error: 'plugin.json: HTTP 404' });
    const bare = await pkg({}, undefined, false);
    const nofiles = await fetchGithubPackage({ owner: 'acme', repo: 'plates', ref: 'main' }, async (u) => { const f = bare.get(u.split('/main/')[1])!; return { ok: true, status: 200, arrayBuffer: async () => f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer }; });
    expect(nofiles).toEqual({ error: expect.stringMatching(/no "files" list/) });
  });
});


describe('installing a wasm package from a link', () => {
  const core = new Uint8Array(300 * 1024); core.set([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);   // 300 KB: over the 200 KB a script file may have
  async function wasmPkg(): Promise<Map<string, Uint8Array>> {
    const js = enc('export const instantiate = () => {};\n');
    const manifest = { id: 'acme.wood', name: 'Wood', version: '1.0.0', license: 'MIT', wasm: { js: 'component.js', cores: ['component.core.wasm'], commands: ['solid.box'] },
      files: { 'component.js': await sha256Hex(js), 'component.core.wasm': await sha256Hex(core) },
      contributes: { generators: [{ id: 'cab', entry: 'cabinet', title: 'Cabinet', params: [] }] } };
    return new Map([['plugin.json', enc(JSON.stringify(manifest))], ['component.js', js], ['component.core.wasm', core]]);
  }
  const served = (files: Map<string, Uint8Array>, base: string) => async (url: string) => {
    const path = url.slice(base.length);
    const b = files.get(path);
    return { ok: !!b, status: b ? 200 : 404, arrayBuffer: async () => (b ?? new Uint8Array()).slice().buffer as ArrayBuffer };
  };
  it('GitHub: a compiled file bigger than a script is fetched, hashed and inspected; an unpinned ref warns', async () => {
    const files = await wasmPkg();
    const got = await fetchGithubPackage({ owner: 'acme', repo: 'wood', ref: 'v1.0.0' }, served(files, 'https://raw.githubusercontent.com/acme/wood/v1.0.0/'));
    expect('error' in got ? got.error : '').toBe('');
    if ('error' in got) return;
    expect(got.warnings).toEqual([]);
    const i = await inspectPackage(got.files);
    expect(i.ok, i.errors.join('; ')).toBe(true);
    const moving = await fetchGithubPackage({ owner: 'acme', repo: 'wood', ref: 'main' }, served(files, 'https://raw.githubusercontent.com/acme/wood/main/'));
    if (!('error' in moving)) expect(moving.warnings.join()).toMatch(/not a tag or commit/);
  });
  it('GitHub: a script package still has the small file limit', async () => {
    const big = await pkg({}, { 'gen/plate.js': SCRIPT + 'x'.repeat(250 * 1024) });
    const got = await fetchGithubPackage({ owner: 'a', repo: 'b', ref: 'v1.0.0' }, served(big, 'https://raw.githubusercontent.com/a/b/v1.0.0/'));
    expect('error' in got && got.error).toMatch(/larger than 200 KB/);
  });
  it('a link to a .zip: https only, .zip only, errors named, and a warning that nothing pins it', async () => {
    const unzip = async () => new Map<string, Uint8Array>([['plugin.json', enc('{}')]]);
    const ok = { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer as ArrayBuffer };
    expect(await fetchZipUrl('http://x.example/p.zip', async () => ok, unzip)).toEqual({ error: 'only https:// addresses are accepted' });
    expect(await fetchZipUrl('https://x.example/p.exe', async () => ok, unzip)).toEqual({ error: 'the address must end in .zip' });
    expect(await fetchZipUrl('nonsense', async () => ok, unzip)).toEqual({ error: 'not a valid address' });
    expect(await fetchZipUrl('https://x.example/p.zip', async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }), unzip)).toEqual({ error: 'x.example: HTTP 404' });
    const blocked = await fetchZipUrl('https://x.example/p.zip', async () => { throw new Error('Failed to fetch'); }, unzip);
    expect('error' in blocked && blocked.error).toMatch(/may not allow reading from other pages/);
    const good = await fetchZipUrl('https://x.example/p.zip', async () => ok, unzip);
    expect('files' in good && good.warnings[0]).toMatch(/not pinned/);
  });

  it('a zip over the limit says so in plain words, and names a desktop program as one', () => {
    const big = new Uint8Array(31 * 1024 * 1024);
    expect(tooBigMessage(big)).toBe('This plugin is bigger than CivilKit can install (31 MB; the limit is 8 MB).');
    // a zip whose only entry is a Linux program (central directory only is read)
    const name = new TextEncoder().encode('companion_linux-x64_v0.9.0/companion');
    const cd = new Uint8Array(46 + name.length); const dv = new DataView(cd.buffer);
    dv.setUint32(0, 0x02014b50, true); dv.setUint16(28, name.length, true); cd.set(name, 46);
    const eocd = new Uint8Array(22); const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(10, 1, true); ev.setUint32(12, cd.length, true); ev.setUint32(16, 9 * 1024 * 1024, true);
    const z = new Uint8Array(9 * 1024 * 1024 + cd.length + 22); z.set(cd, 9 * 1024 * 1024); z.set(eocd, 9 * 1024 * 1024 + cd.length);
    expect(tooBigMessage(z)).toMatch(/^This plugin is bigger than CivilKit can install \(9 MB; the limit is 8 MB\)\. It contains a program for your computer .* download for the SolidCraft desktop app\.$/);
  });
});
