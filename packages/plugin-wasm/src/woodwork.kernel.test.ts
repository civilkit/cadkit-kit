// @vitest-environment node
// The SolidCraft woodwork plugin (MIT, wasm component) through the replay host and the interpreter, on our kernel.
// Run:  CK_WASM=<gated wasm> CK_WOODWORK_ZIP=<zip from tools/plugin_wasm_pack.mjs> npx vitest run packages/plugin-wasm   (see tools/plugin-wasm-dev/README.md)
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { filesFromZip, inspectPackage, type InstalledPlugin } from '@kit/plugin';
import { AgentSession } from '../../agent-tools/src';
import { placeholderSnapshot } from '../../agent-tools/src/testing/placeholder-snapshot';
import { listBodies } from '../../agent-tools/src/bodies';
import { runPlugin, type Loaded } from './host';
import { Interpreter, type Scratch } from './interpreter';
import { dataUrlLoader } from './package';

const ZIP = process.env.CK_WOODWORK_ZIP;
const on = !!(process.env.CK_WASM && ZIP);
let allowed = new Set<string>();
const load = async (): Promise<Loaded> => {
  const files = await filesFromZip(new Uint8Array(readFileSync(ZIP!)));
  if (!(files instanceof Map)) throw new Error(files.error);
  const i = await inspectPackage(files);
  if (!i.ok || !i.manifest?.wasm) throw new Error(`the package is not installable: ${i.errors.join('; ')}`);
  allowed = new Set(i.manifest.wasm.commands);
  const rec = { id: i.manifest.id, version: i.manifest.version, manifest: i.manifest, files: i.files!, scripts: {}, binaries: i.binaries, hash: i.hash!, source: { kind: 'zip', name: 'test' }, installedAt: 0, enabled: true } as InstalledPlugin;
  return dataUrlLoader.load(rec);
};
let plugin: Loaded, scratch: AgentSession;
beforeAll(async () => { if (!on) return; plugin = await load(); scratch = await AgentSession.open({ wasmPath: process.env.CK_WASM, snapshotFn: placeholderSnapshot as never }); }, 120_000);
afterAll(async () => { await scratch?.close(); });
const scr: Scratch = { async build(script) { const r = await scratch.runScript(script, 'new'); if (!r.ok) throw new Error(`kernel refused: ${r.errors[0]?.message}`); return listBodies(scratch); } };
const allow = () => allowed;
const run = async (params: object) => { const I = new Interpreter(scr); const out = await runPlugin(plugin, 'cabinet', { material: 'none', place: 'origin', ...params }, (c, a) => I.run(c, a), { allow: allow() }); return { I, ...out }; };

describe.skipIf(!on)('woodwork on our kernel: holes, patterns, materials', () => {
  it('a Y-up document gets the cabinet standing up, and Position moves the whole thing', async () => {
    const r = await run({ doors: 2, handles: 'pull' });
    const extent = async (o: { up?: 'y' | 'z'; offset?: number[] }) => {
      const rep = await scratch.runScript(r.I.script({ part: 'Cabinet', ...o }), 'new');
      expect(rep.errors).toEqual([]);
      const rows = await listBodies(scratch);
      const lo = [1, 2, 3].map(() => Infinity), hi = [1, 2, 3].map(() => -Infinity);
      for (const b of rows) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], b.bbox!.min[i]); hi[i] = Math.max(hi[i], b.bbox!.max[i]); }
      return { lo, size: lo.map((_, i) => hi[i] - lo[i]) };
    };
    const z = await extent({});
    const y = await extent({ up: 'y' });
    expect(z.size.map((v) => Math.round(v))).toEqual([600, 580, 720]);   // (doors stand 20 mm proud of the 560 carcass) Z-up: width X, depth Y, height Z
    expect(y.size.map((v) => Math.round(v))).toEqual([600, 720, 580]);   // Y-up: height now on Y, depth on Z
    expect(Math.round(y.size[1])).toBe(Math.round(z.size[2]));                  // Y-up: the same height now on Y
    expect(Math.round(y.size[2])).toBe(Math.round(z.size[1]));                  // and the depth on Z
    const moved = await extent({ up: 'y', offset: [1000, 0, 250] });
    expect(Math.round(moved.lo[0] - y.lo[0])).toBe(1000);
    expect(Math.round(moved.lo[2] - y.lo[2])).toBe(250);
    expect(Math.round(moved.lo[1] - y.lo[1])).toBe(0);
  }, 120_000);
  it('one moveBody over every named body moves the whole cabinet together (what Move folder emits)', async () => {
    const r = await run({ doors: 2 });
    const names = (r.I.order.filter((o) => !('hole' in o) && !o.cut) as Array<{ body?: string; name: string }>).map((o) => o.body ?? o.name);
    const base = r.I.script({ part: 'Cabinet', up: 'y' });
    const lo = async (script: string) => { const rep = await scratch.runScript(script, 'new'); expect(rep.errors).toEqual([]); const rows = await listBodies(scratch); expect(rows.length).toBe(names.length); return [0, 1, 2].map((i) => Math.min(...rows.map((b) => b.bbox!.min[i]))); };
    const a = await lo(base);
    const b = await lo(`${base}\np.moveBody(${JSON.stringify(names)}, { translate: [100, 0, -50] });`);
    expect(b.map((v, i) => Math.round(v - a[i]))).toEqual([100, 0, -50]);
  }, 120_000);
  it('a big cabinet through the async-only path (what the sandbox does) stays fast', async () => {
    const I = new Interpreter(scr);
    const t0 = performance.now();
    const { stats } = await runPlugin(plugin, 'cabinet', { material: 'Oak', place: 'origin', width: 1800, dividers: 3, shelves: 4, shelf_pins: true, doors: 4, handles: 'pull', plinth: 100 }, (c, a) => I.run(c, a), { allow: allow(), maxCommands: 256 });
    const ms = performance.now() - t0;
    console.log(`big cabinet: ${stats.commands} commands, ${stats.instances} instances, ${ms.toFixed(0)} ms (guest ${stats.guestMs.toFixed(0)} ms)`);
    expect(ms).toBeLessThan(10_000);
  }, 120_000);
  it('the app can supply the colours: its library wins over the plugin\'s guess', async () => {
    const r = await run({ material: 'Oak' });
    expect(r.I.script({ part: 'C', look: (m) => (m === 'Oak' ? '#123456' : undefined) })).toContain('#123456');
    expect(r.I.script({ part: 'C', look: () => undefined })).toContain('#b78a56');   // no library match: the plugin's own tone
  }, 120_000);
  it('a chosen board material becomes the body colours in the document', async () => {
    const r = await run({ material: 'Oak' });
    const rep = await scratch.runScript(r.I.script({ part: 'Cabinet' }), 'new');
    expect(rep.errors).toEqual([]);
    const doc = JSON.stringify((scratch as unknown as { doc: unknown }).doc);
    expect(doc).toContain('#b78a56');
    expect(doc).toContain('appearance');
  }, 120_000);
  it('shelf pins make holes in the sides', async () => {
    const plain = await run({ shelf_pins: false });
    const pins = await run({ shelf_pins: true });
    const a = (await plain.I.run('inspect.measure', {})) as { bodies: Array<{ name: string; volume_mm3: number }> };
    const b = (await pins.I.run('inspect.measure', {})) as { bodies: Array<{ name: string; volume_mm3: number }> };
    const vol = (m: typeof a, n: string) => m.bodies.find((x) => x.name === n)!.volume_mm3;
    expect(vol(b, 'Cabinet Side L')).toBeLessThan(vol(a, 'Cabinet Side L'));
    expect(vol(b, 'Cabinet Side R')).toBeLessThan(vol(a, 'Cabinet Side R'));
    expect(pins.I.holes.length).toBeGreaterThan(2);
  }, 120_000);
  it('doors get hinge cups and handle holes; material is recorded', async () => {
    const r = await run({ doors: 2, handles: 'pull', material: 'Birch plywood' });
    const m = (await r.I.run('inspect.measure', {})) as { bodies: Array<{ name: string; volume_mm3: number; material: string | null }> };
    expect(m.bodies.some((x) => x.name === 'Cabinet Door L')).toBe(true);
    expect(r.I.holes.some((h) => h.name.includes('hinge cup'))).toBe(true);
    expect(m.bodies.every((x) => x.material === 'Birch plywood')).toBe(true);
    // the cups and handle holes really cut the doors: each door is lighter than its bounding box
    for (const n of ['Cabinet Door L', 'Cabinet Door R']) {
      const d = m.bodies.find((x) => x.name === n) as unknown as { volume_mm3: number; bbox: { min: number[]; max: number[] } };
      const box = [0, 1, 2].reduce((a, i) => a * (d.bbox.max[i] - d.bbox.min[i]), 1);
      expect(d.volume_mm3).toBeLessThan(box - 1000);
    }
  }, 120_000);
});
