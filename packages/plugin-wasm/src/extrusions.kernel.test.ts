// @vitest-environment node
// The SolidCraft Extrusions plugin (a third-party release zip: T-slot and V-slot rails and slot nuts) converted by the app and run through the interpreter on our kernel.
// Run:  CK_WASM=<kernel wasm> CK_EXTRUSIONS_ZIP=<release.zip> vitest-queue run packages/plugin-wasm/src/extrusions.kernel.test.ts
import { existsSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { filesFromZip, inspectPackage, type InstalledPlugin } from '@kit/plugin';
import { AgentSession } from '../../agent-tools/src';
import { placeholderSnapshot } from '../../agent-tools/src/testing/placeholder-snapshot';
import { listBodies } from '../../agent-tools/src/bodies';
import { runPlugin, type Loaded } from './host';
import { convertRelease } from './convert';
import { Interpreter, type Scratch } from './interpreter';
import { dataUrlLoader } from './package';

const ZIP = process.env.CK_EXTRUSIONS_ZIP;
const on = !!(process.env.CK_WASM && ZIP && existsSync(ZIP));
let plugin: Loaded, allowed = new Set<string>(), scratch: AgentSession;
beforeAll(async () => {
  if (!on) return;
  const files = await filesFromZip(new Uint8Array(readFileSync(ZIP!)));
  if (!(files instanceof Map)) throw new Error(files.error);
  const c = await convertRelease(files);
  if ('error' in c) throw new Error(c.error);
  const i = await inspectPackage(c.files);
  if (!i.ok || !i.manifest?.wasm) throw new Error(`not installable: ${i.errors.join('; ')}`);
  allowed = new Set(i.manifest.wasm.commands);
  const rec = { id: i.manifest.id, version: i.manifest.version, manifest: i.manifest, files: i.files!, scripts: {}, binaries: i.binaries, hash: i.hash!, source: { kind: 'zip', name: 'test' }, installedAt: 0, enabled: true } as InstalledPlugin;
  plugin = await dataUrlLoader.load(rec);
  scratch = await AgentSession.open({ wasmPath: process.env.CK_WASM, snapshotFn: placeholderSnapshot as never });
}, 180_000);
afterAll(async () => { await scratch?.close(); });
const scr: Scratch = { async build(script) { const r = await scratch.runScript(script, 'new'); if (!r.ok) throw new Error(`kernel refused: ${r.errors[0]?.message}`); return listBodies(scratch); } };

const make = async (entry: string, params: object, pre: Array<[string, object]> = []) => {
  const I = new Interpreter(scr);
  for (const [c, a] of pre) await I.run(c, a);
  const log: string[] = [];
  const out = await runPlugin(plugin, entry, params, async (c, a) => { log.push(c); return I.run(c, a); }, { allow: allowed }) as { result: Record<string, unknown> };
  const rep = await scratch.runScript(I.script({ part: 'X' }), 'new');
  return { I, log, out, rep, rows: await listBodies(scratch) };
};
const size = (b: { bbox: { min: number[]; max: number[] } | null }) => [0, 1, 2].map((i) => b.bbox!.max[i] - b.bbox!.min[i]);
const near = (v: number, want: number, tol = 0.02) => expect(Math.abs(v / want - 1)).toBeLessThan(tol);
// the catalogue's section areas, mm2 (the plugin's docs): T-slot 2020, 2040, 4040 and V-slot 2020
const AREA = { t2020: 181.26, t2040: 322.44, t4040: 479.13, v2020: 171.4 };

describe.skipIf(!on)('Extrusions plugin end to end', () => {
  it('make-extrusion: a 2020 T-slot 500 long is one 20 x 20 x 500 solid of the catalogue area', async () => {
    const r = await make('make-extrusion', { mode: 'Fixed length', slot: 'T-slot', size: '2020', length: 500 });
    expect(r.rep.errors).toEqual([]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].name).toBe('T-slot 2020 x 500');
    size(r.rows[0]).forEach((v, i) => near(v, [20, 20, 500][i], 1e-3));
    near(r.rows[0].volume!, AREA.t2020 * 500);
    expect(r.out.result.area_mm2).toBeCloseTo(181.26, 1);
  }, 180_000);
  it('make-extrusion: the other sections and V-slot are the right size', async () => {
    for (const [p, dims, area] of [[{ slot: 'T-slot', size: '2040', length: 300 }, [20, 40, 300], AREA.t2040], [{ slot: 'T-slot', size: '4040', length: 100 }, [40, 40, 100], AREA.t4040], [{ slot: 'V-slot', size: '2020', length: 200 }, [20, 20, 200], AREA.v2020]] as const) {
      const r = await make('make-extrusion', { mode: 'Fixed length', ...p });
      expect(r.rep.errors).toEqual([]);
      expect(r.rows).toHaveLength(1);
      size(r.rows[0]).forEach((v, i) => near(v, dims[i], 1e-3));
      near(r.rows[0].volume!, area * dims[2]);
    }
  }, 240_000);
  it('make-extrusion: screw holes cut material, taps of the 4.2 bore cut nothing more, the run stays under 256 commands', async () => {
    const plain = await make('make-extrusion', { mode: 'Fixed length', slot: 'T-slot', size: '2020', length: 300 });
    const r = await make('make-extrusion', { mode: 'Fixed length', slot: 'T-slot', size: '2020', length: 300, end_taps: 'Both', thread_modeled: false, holes: '10, 290' });
    expect(r.rep.errors).toEqual([]);
    expect(r.rows).toHaveLength(1);
    const removed = plain.rows[0].volume! - r.rows[0].volume!;
    // two holes, each a 9.5 access hole 6 deep and a 5.5 clearance hole through the far wall, through a slot: 100 to 160 mm3 each
    expect(removed).toBeGreaterThan(200); expect(removed).toBeLessThan(330);
    expect(r.log.length).toBeLessThan(256);
  }, 180_000);
  it('make-extrusion: sketch driven rails follow their lines (a 300 mm and a 200 mm run), with holes and taps', async () => {
    const pre: Array<[string, object]> = [['sketch.create', { name: 'Paths', plane: 'XY' }], ['sketch.line', { points: [[0, 0], [300, 0]] }], ['sketch.line', { points: [[300, 0], [300, 200]] }], ['sketch.finish', {}]];
    const r = await make('make-extrusion', { mode: 'Sketch driven', slot: 'T-slot', size: '2020', end_taps: 'Both', thread_modeled: false, holes: '+Y 50', placement: [{ type: 'external_sketch_curve', sketch: 1, id: 'l1' }, { type: 'external_sketch_curve', sketch: 1, id: 'l2' }] }, pre);
    expect(r.rep.errors).toEqual([]);
    expect(r.rows).toHaveLength(2);
    const [a, b] = r.rows.sort((x, y) => x.name.localeCompare(y.name));
    size(a).forEach((v, i) => near(v, [300, 20, 20][i], 1e-3));
    size(b).forEach((v, i) => near(v, [20, 200, 20][i], 1e-3));
    near(a.volume!, AREA.t2020 * 300, 0.02); near(b.volume!, AREA.t2020 * 200, 0.02);
  }, 180_000);
  it('make-t-nut: the pre-assembly nut is 10 x 10 x 4.1 with its hole, the post-assembly nut 8.3 x 17 and a ball out of the bottom', async () => {
    const pre = await make('make-t-nut', { type: 'Pre-assembly', size: 'M5', slot: 'T-slot', along: 'Sketch X' });
    expect(pre.rep.errors).toEqual([]);
    expect(pre.rows).toHaveLength(1);
    size(pre.rows[0]).forEach((v, i) => near(v, [10, 10, 4.1][i], 0.01));
    const post = await make('make-t-nut', { type: 'Post-assembly', size: 'M4', slot: 'V-slot', along: 'Sketch Y' });
    expect(post.rep.errors).toEqual([]);
    expect(post.rows).toHaveLength(1);
    size(post.rows[0]).forEach((v, i) => near(v, [8.3, 17, 4.7][i], 0.02));
    expect(post.rows[0].volume!).toBeGreaterThan(300);
  }, 180_000);
});
