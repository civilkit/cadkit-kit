// @vitest-environment node
// The woodwork plugin's own Cut list entry (effect: read) through our host: read-only, answered from the open document's bodies, files handed back as downloads.
// Run:  CK_WOODWORK_RELEASE=<unzipped release: plugin.json, woodwork.wasm, LICENSE> npx vitest run packages/plugin-wasm/src/cutlist.test.ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectPackage, PluginManager, PluginRegistry, memoryStore, contextOf, type InstalledPlugin } from '@kit/plugin';
import { convertRelease, isRelease } from './convert';
import { wasmGenerators, wasmReaders } from './package';

const dir = process.env.CK_WOODWORK_RELEASE;
const board = (name: string, size: [number, number, number], at: [number, number, number] = [0, 0, 0]) => ({ name, bbox: { min: at, max: [at[0] + size[0], at[1] + size[1], at[2] + size[2]] }, volume: size[0] * size[1] * size[2] });
const boards = [board('Cabinet Side L', [18, 560, 720]), board('Cabinet Side R', [18, 560, 720], [582, 0, 0]), board('Cabinet Bottom', [564, 560, 18], [18, 0, 0]), board('Cabinet Top', [564, 560, 18], [18, 0, 702]), board('Cabinet Back', [564, 6, 700], [18, 560, 10]), board('Cabinet Shelf 1', [564, 540, 18], [18, 10, 350])];

describe.skipIf(!dir || !existsSync(join(dir, 'plugin.json')))('the Cut list entry of the woodwork plugin', () => {
  const setup = async () => {
    const files = new Map<string, Uint8Array>(['plugin.json', 'woodwork.wasm', 'LICENSE'].map((n) => [n, new Uint8Array(readFileSync(join(dir!, n)))]));
    expect(isRelease(files)).toBe(true);
    const c = await convertRelease(files);
    if ('error' in c) throw new Error(c.error);
    const i = await inspectPackage(c.files);
    expect(i.errors).toEqual([]);
    const rec = { id: i.manifest!.id, version: i.manifest!.version, manifest: i.manifest!, files: i.files!, scripts: {}, binaries: i.binaries, hash: i.hash!, source: { kind: 'zip', name: 't' }, installedAt: 0, enabled: true } as unknown as InstalledPlugin;
    return { rec, manifest: i.manifest! };
  };
  const doc = { bodies: boards, selection: [] as never[], up: 'z' as const };

  it('is installed as a read entry with the file grant, without place fields, and cannot be run as an editing entry', async () => {
    const { rec, manifest } = await setup();
    const g = manifest.contributes.generators.find((x) => x.id === 'cutlist')!;
    expect(g.effect).toBe('read');
    expect(g.params!.map((p) => p.name)).toEqual(['file']);
    expect(manifest.wasm!.files).toEqual([{ name: 'cutlists', write: true }]);
    await expect(wasmGenerators(rec)['cutlist']({} as never, contextOf([]))).rejects.toThrow(/only reads the model/);
  }, 60000);

  it('lists the boards read from the open document, and changes nothing', async () => {
    const { rec } = await setup();
    const r = await wasmReaders(rec)['cutlist']({ file: '' }, contextOf([], { doc } as never));
    const res = r.result as { csv?: string; saved?: string };
    expect(typeof res.csv).toBe('string');
    expect(res.csv).toMatch(/Side/);
    expect(res.csv).toMatch(/Shelf/);
    expect(res.saved).toBeUndefined();
    expect(r.files).toEqual([]);
  }, 60000);

  it('"Save as" comes back as a file to download, named as asked', async () => {
    const { rec } = await setup();
    const r = await wasmReaders(rec)['cutlist']({ file: 'kitchen.csv' }, contextOf([], { doc } as never));
    expect((r.result as { saved?: string }).saved).toBe('kitchen.csv');
    expect(r.files).toHaveLength(1);
    expect(r.files[0]).toMatchObject({ grant: 'cutlists', name: 'kitchen.csv' });
    expect(new TextDecoder().decode(r.files[0].data)).toBe((r.result as { csv: string }).csv);
  }, 60000);

  it('a name with a folder in it is refused by the plugin or by the page, and nothing is saved', async () => {
    const { rec } = await setup();
    await expect(wasmReaders(rec)['cutlist']({ file: '../x.csv' }, contextOf([], { doc } as never))).rejects.toThrow();
  }, 60000);

  it('the manager runs it by id', async () => {
    const { rec } = await setup();
    const reg = new PluginRegistry();
    const mgr = new PluginManager({ registry: reg, store: memoryStore(), appVersion: '0.8.2', wasm: (p) => wasmGenerators(p), wasmRead: (p) => wasmReaders(p) });
    await mgr.install({ inspection: { ok: true, errors: [], warnings: [], manifest: rec.manifest, files: rec.files, scripts: {}, binaries: rec.binaries, hash: rec.hash } }, { kind: 'zip', name: 't' });
    const r = await mgr.read(rec.id, 'cutlist', { file: '' }, contextOf([], { doc } as never));
    expect((r.result as { csv: string }).csv).toMatch(/Side/);
    await expect(mgr.read(rec.id, 'cabinet', {}, contextOf([]))).rejects.toThrow(/no read entry/);
  }, 60000);
});
