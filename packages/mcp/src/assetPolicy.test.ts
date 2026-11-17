import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAssetPolicy, readAsset, resolveAsset, type AssetPolicy } from './assetPolicy';

let base: string, root: string, outside: string, policy: AssetPolicy;
beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'asset-')));
  root = join(base, 'workspace'); outside = join(base, 'secret');
  mkdirSync(join(root, 'parts'), { recursive: true }); mkdirSync(outside);
  writeFileSync(join(root, 'parts', 'plate.ckpart'), '{"features":[]}');
  writeFileSync(join(root, 'bracket.step'), 'ISO-10303-21;');
  writeFileSync(join(root, 'notes.txt'), 'hello');
  writeFileSync(join(root, 'big.stl'), Buffer.alloc(2048));
  writeFileSync(join(outside, 'passwd.ckpart'), 'top secret');
  writeFileSync(join(outside, 'shadow.txt'), 'top secret');
  symlinkSync(outside, join(root, 'linkdir'));                         // a folder link out of the root
  symlinkSync(join(outside, 'passwd.ckpart'), join(root, 'leak.ckpart'));   // a file link out of the root
  symlinkSync(join(outside, 'shadow.txt'), join(root, 'innocent.ckpart')); // right name, wrong target type
  symlinkSync(join(root, 'notes.txt'), join(root, 'alias.ckpart'));        // inside the root, but the target is not an allowed type
  mkdirSync(join(root, 'folder.ckpart'));
  policy = { roots: [root], configured: [root], maxBytes: 1024 * 1024, source: 'test' };
});
afterAll(() => rmSync(base, { recursive: true, force: true }));
const refused = async (p: unknown, code: string, pol = policy) => { const e = await resolveAsset(pol, p).then(() => null, (x) => x); expect(e, String(p)).not.toBeNull(); expect(e.code, String(p)).toBe(code); };

describe('asset policy: what may be opened', () => {
  it('a relative path below the first root, and an absolute path inside a root, resolve to the real file', async () => {
    const a = await resolveAsset(policy, 'parts/plate.ckpart');
    expect(a).toMatchObject({ file: join(root, 'parts', 'plate.ckpart'), kind: 'part', name: 'plate.ckpart', bytes: 15 });
    expect((await resolveAsset(policy, join(root, 'bracket.step'))).kind).toBe('step');
    expect(Buffer.from(await readAsset(a, policy)).toString()).toBe('{"features":[]}');
  });
  it('refuses a path that climbs out with .. (however it is written)', async () => {
    await refused('../secret/passwd.ckpart', 'path_traversal');
    await refused('parts/../../secret/passwd.ckpart', 'path_traversal');
    await refused('parts\\..\\..\\secret\\passwd.ckpart', 'path_traversal');
    await refused(root + '/../secret/passwd.ckpart', 'path_traversal');
    await refused(join(root, '..', 'secret', 'passwd.ckpart'), 'path_outside_workspace');   // join() folds the .. away: it is just an outside path
  });
  it('refuses an absolute path outside every root, without touching the file system', async () => {
    await refused(join(outside, 'passwd.ckpart'), 'path_outside_workspace');
    await refused('/etc/passwd', 'path_outside_workspace');
    await refused('/definitely/not/here.ckpart', 'path_outside_workspace');   // the same answer whether it exists or not
    await refused(root + '-evil/plate.ckpart', 'path_outside_workspace');     // a sibling that only shares the prefix
  });
  it('refuses a symlink that leaves the root (a file link and a folder link)', async () => {
    await refused('leak.ckpart', 'path_outside_workspace');
    await refused('linkdir/passwd.ckpart', 'path_outside_workspace');
    await refused('innocent.ckpart', 'path_outside_workspace');
  });
  it('refuses a link whose target is not an allowed type, a folder, a missing file and a wrong extension', async () => {
    await refused('alias.ckpart', 'asset_extension_not_allowed');
    await refused('notes.txt', 'asset_extension_not_allowed');
    await refused('noext', 'asset_extension_not_allowed');
    await refused('folder.ckpart', 'asset_not_file');
    await refused('parts/nope.ckpart', 'asset_not_found');
  });
  it('refuses a file over the size limit', async () => {
    await refused('big.stl', 'asset_too_large', { ...policy, maxBytes: 1000 });
    expect((await resolveAsset({ ...policy, maxBytes: 4096 }, 'big.stl')).bytes).toBe(2048);
  });
  it('refuses bad input and, with no root configured, everything', async () => {
    await refused('', 'bad_input'); await refused(42, 'bad_input'); await refused('a\0b.ckpart', 'bad_input'); await refused('x'.repeat(2000), 'bad_input');
    await refused('parts/plate.ckpart', 'asset_roots_not_configured', { roots: [], configured: [], maxBytes: 1e6, source: null });
  });
});

describe('asset policy: the user\'s configuration', () => {
  it('reads CK_MCP_ASSET_ROOTS and the size, ignores relative and missing roots, and allows nothing by default', () => {
    expect(loadAssetPolicy({}, join(base, 'nodir')).roots).toEqual([]);
    const p = loadAssetPolicy({ CK_MCP_ASSET_ROOTS: [root, 'relative/dir', join(base, 'missing')].join(':'), CK_MCP_ASSET_MAX_MB: '2' }, join(base, 'nodir'));
    expect(p.roots).toEqual([root]);
    expect(p.maxBytes).toBe(2 * 1024 * 1024);
    expect(p.source).toBe('CK_MCP_ASSET_ROOTS');
  });
  it('reads the config file when the variable is not set', () => {
    const dir = join(base, 'state'); mkdirSync(dir);
    writeFileSync(join(dir, 'assets.json'), JSON.stringify({ roots: [root], maxMb: 8 }));
    const p = loadAssetPolicy({}, dir);
    expect(p).toMatchObject({ roots: [root], maxBytes: 8 * 1024 * 1024 });
    writeFileSync(join(dir, 'assets.json'), '{not json');
    expect(loadAssetPolicy({}, dir).roots).toEqual([]);
  });
});
