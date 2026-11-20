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

  it('sizes a turned (revolved) board from its mesh through model.mesh: 300 x 40 x 40, not an unreadable size', async () => {
    const { rec } = await setup();
    // a 24-sided lathe of a 40 mm diameter spindle, 300 mm long, with a 20 mm collar: the volume is not the bounding box's, so the plugin asks for the mesh
    const n = 24, prof = [[20, 0], [20, 100], [10, 100], [10, 300]], pts = [[0, 0], ...prof, [0, 300]];
    const at = (r: number, z: number, k: number) => [r * Math.cos((2 * Math.PI * k) / n), r * Math.sin((2 * Math.PI * k) / n), z];
    const positions: number[] = [], triFace: number[] = [], faceIds = pts.slice(1).map((_, i) => `F1.${i + 1}`);
    for (let i = 0; i + 1 < pts.length; i++) for (let k = 0; k < n; k++) {
      const [r0, z0] = pts[i], [r1, z1] = pts[i + 1], A = at(r0, z0, k), B = at(r0, z0, k + 1), C = at(r1, z1, k + 1), D = at(r1, z1, k);
      if (r0 > 0) { positions.push(...A, ...B, ...D); triFace.push(i); }
      if (r1 > 0) { positions.push(...D, ...B, ...C); triFace.push(i); }
    }
    const turned = { up: 'z' as const, selection: [] as never[], bodies: [{ name: 'Turned Leg', bbox: { min: [-20, -20, 0], max: [20, 20, 300] }, volume: 150000 }], meshes: { mesh: { positions, triFace, faceIds }, faces: { 'Turned Leg': faceIds } } };
    const r = await wasmReaders(rec)['cutlist']({ file: '' }, contextOf([], { doc: turned } as never));
    const part = (r.result as { parts: Array<{ length: number; width: number; thickness: number }> }).parts[0];
    expect([part.length, part.width, part.thickness]).toEqual([300, 40, 40]);
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
