// @vitest-environment node
// The SolidCraft woodwork plugin (MIT, wasm component) through the replay host and the interpreter, on our kernel.
// Run:  CK_WASM=<gated wasm> CK_WOODWORK_ZIP=<zip from tools/plugin_wasm_pack.mjs> npx vitest run packages/plugin-wasm   (see tools/plugin-wasm-dev/README.md)
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { filesFromZip, inspectPackage, previewValues, type InstalledPlugin } from '@kit/plugin';
import { AgentSession } from '../../agent-tools/src';
import { placeholderSnapshot } from '../../agent-tools/src/testing/placeholder-snapshot';
import { listBodies } from '../../agent-tools/src/bodies';
import { runPlugin, type Loaded } from './host';
import { Interpreter, type Scratch } from './interpreter';
import { dataUrlLoader, wasmGenerators } from './package';

const ZIP = process.env.CK_WOODWORK_ZIP;
const on = !!(process.env.CK_WASM && ZIP);
let allowed = new Set<string>();
let hingeSide = false;
let entries = new Set<string>();
let version = '';
const load = async (): Promise<Loaded> => {
  const files = await filesFromZip(new Uint8Array(readFileSync(ZIP!)));
  if (!(files instanceof Map)) throw new Error(files.error);
  const i = await inspectPackage(files);
  if (!i.ok || !i.manifest?.wasm) throw new Error(`the package is not installable: ${i.errors.join('; ')}`);
  allowed = new Set(i.manifest.wasm.commands);
  hingeSide = JSON.stringify(i.manifest).includes('door_hinge');
  entries = new Set(i.manifest.contributes.generators.map((g) => g.entry!));
  version = i.manifest.version;
  const rec = { id: i.manifest.id, version: i.manifest.version, manifest: i.manifest, files: i.files!, scripts: {}, binaries: i.binaries, hash: i.hash!, source: { kind: 'zip', name: 'test' }, installedAt: 0, enabled: true } as InstalledPlugin;
  return dataUrlLoader.load(rec);
};
let plugin: Loaded, scratch: AgentSession;
beforeAll(async () => { if (!on) return; plugin = await load(); scratch = await AgentSession.open({ wasmPath: process.env.CK_WASM, snapshotFn: placeholderSnapshot as never }); }, 120_000);
afterAll(async () => { await scratch?.close(); });
const scr: Scratch = { async build(script) { const r = await scratch.runScript(script, 'new'); if (!r.ok) throw new Error(`kernel refused: ${r.errors[0]?.message}`); return listBodies(scratch); } };
const allow = () => allowed;
const run = async (params: object, entry = 'cabinet', more: object = {}) => { const I = new Interpreter(scr); const out = await runPlugin(plugin, entry, { material: 'none', place: 'origin', ...params, ...more }, (c, a) => I.run(c, a), { allow: allow() }); return { I, ...out }; };

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
    const names = (r.I.order.filter((o) => 'cut' in o && !o.cut) as Array<{ body?: string; name: string }>).map((o) => o.body ?? o.name);
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
    expect(pins.I.holes.length + pins.I.order.filter((o) => /pin/i.test(o.name)).length).toBeGreaterThan(2);
  }, 120_000);
  it('doors get hinge cups and handle holes; material is recorded', async () => {
    const r = await run({ doors: 2, handles: 'pull', material: 'Birch plywood' });
    const m = (await r.I.run('inspect.measure', {})) as { bodies: Array<{ name: string; volume_mm3: number; material: string | null }> };
    expect(m.bodies.some((x) => x.name === 'Cabinet Door L')).toBe(true);
    expect(r.I.holes.some((h) => h.name.includes('hinge cup')) || r.I.order.some((o) => /hinge cup/i.test(o.name))).toBe(true);
    expect(m.bodies.every((x) => x.material === 'Birch plywood')).toBe(true);
    // the cups and handle holes really cut the doors: each door is lighter than its bounding box
    for (const n of ['Cabinet Door L', 'Cabinet Door R']) {
      const d = m.bodies.find((x) => x.name === n) as unknown as { volume_mm3: number; bbox: { min: number[]; max: number[] } };
      const box = [0, 1, 2].reduce((a, i) => a * (d.bbox.max[i] - d.bbox.min[i]), 1);
      expect(d.volume_mm3).toBeLessThan(box - 1000);
    }
  }, 120_000);
  it('a corner cabinet builds, its diagonal bottom corner chamfered where the plugin asks', async () => {
    const r = await run({ place: 'origin' }, 'corner', { corner: 'left', shape: 'L-shaped', doors: 'hinged left' }).catch(async () => run({ place: 'origin' }, 'corner', { corner: 'left', shape: 'L-shaped' }));
    const m = (await r.I.run('inspect.measure', {})) as { bodies: Array<{ name: string; volume_mm3: number }> };
    expect(m.bodies.length).toBeGreaterThan(5);
    if (r.I.order.some((o) => 'kind' in o && o.kind === 'chamfer')) {
      const bottom = m.bodies.find((b) => /Bottom/.test(b.name))!;
      expect(bottom.volume_mm3).toBeGreaterThan(0);
    }
  }, 120_000);
  it('a live preview runs with the slow switches off (labels, shelf pins: ParamDef.previewOff), the final run keeps them', async () => {
    const files = await filesFromZip(new Uint8Array(readFileSync(ZIP!))); if (!(files instanceof Map)) throw new Error(files.error);
    const i = await inspectPackage(files);
    const rec = { id: i.manifest!.id, version: i.manifest!.version, manifest: i.manifest!, files: i.files!, scripts: {}, binaries: i.binaries, hash: i.hash!, source: { kind: 'zip', name: 'test' }, installedAt: 0, enabled: true } as never;
    const gens = wasmGenerators(rec, { scratch: () => scr });
    const decl = i.manifest!.contributes.generators.find((g) => g.entry === 'cabinet')!;
    const ctx = { used: [], uniqueName: (b: string) => b } as never;
    const base = { material: 'none', place: 'origin', name: 'Cabinet' };
    const off = decl.params.filter((d) => d.previewOff).map((d) => d.name);
    if (!off.length) return;   // a package packed without --preview-off: nothing to check
    expect(off).toEqual(expect.arrayContaining(['labels', 'shelf_pins']));
    const on = { ...base, labels: true, shelf_pins: true };
    const pv = previewValues(decl.params, on);
    expect([...pv.skipped].sort()).toEqual(['labels', 'shelf pin holes']);
    const full = await gens[decl.id](on as never, ctx);
    const quick = await gens[decl.id](pv.values as never, ctx);
    expect(full).toMatch(/text\(/); expect(quick).not.toMatch(/text\(/);
    expect(full.length).toBeGreaterThan(quick.length * 2);   // the pin holes and the label cuts are in the final script only
    expect(quick).toContain('Cabinet Side L');   // the boards are all still there
  }, 120_000);
  it('a second cabinet with the same name gets the next free number, so no body name repeats', async () => {
    const files = await filesFromZip(new Uint8Array(readFileSync(ZIP!))); if (!(files instanceof Map)) throw new Error(files.error);
    const i = await inspectPackage(files);
    const rec = { id: i.manifest!.id, version: i.manifest!.version, manifest: i.manifest!, files: i.files!, scripts: {}, binaries: i.binaries, hash: i.hash!, source: { kind: 'zip', name: 'test' }, installedAt: 0, enabled: true } as InstalledPlugin;
    const gens = wasmGenerators(rec, { scratch: () => scr });
    const id = i.manifest!.contributes.generators.find((g) => g.entry === 'cabinet')!.id;
    const ctx = (used: string[]) => ({ used, uniqueName: (b: string) => b } as never);
    const first = await gens[id]({ material: 'none', place: 'origin', name: 'Cabinet' } as never, ctx([]));
    const second = await gens[id]({ material: 'none', place: 'origin', name: 'Cabinet' } as never, ctx(['Cabinet Side L', 'Cabinet Side R', 'Cabinet Back']));
    const third = await gens[id]({ material: 'none', place: 'origin', name: 'Cabinet' } as never, ctx(['Cabinet Side L', 'Cabinet 2 Side L']));
    expect(first).toContain('Cabinet Side L'); expect(first).not.toContain('Cabinet 2 Side L');
    expect(second).toContain('Cabinet 2 Side L'); expect(second).not.toMatch(/"Cabinet Side L"/);
    expect(third).toContain('Cabinet 3 Side L');
  }, 120_000);
  it('the first door is hinged on the chosen side: its hinge cups move to the other edge', async () => {
    const cups = async (side: string) => { const r = await run({ doors: 1 }, 'cabinet', { door_hinge: side }); return r.I.order.filter((o) => /hinge cup/i.test(o.name)).map((o) => ('hole' in o ? o.pos : 'base' in o ? o.base : (o as { corner: number[] }).corner)[0]); };
    if (!hingeSide) return;   // a release before the hinge side was a setting
    const left = await cups('left'), right = await cups('right');
    expect(left.length).toBeGreaterThan(0);
    expect(Math.sign(left[0])).toBe(-Math.sign(right[0]));
  }, 120_000);
  // the plugin's Place (right, left, above a selected cabinet): it reads the selection from document.inspect and moves its component with occurrence.move
  describe('placing beside the selected cabinet', () => {
    const extent = (rows: Array<{ name: string; bbox: { min: number[]; max: number[] } | null }>, pre: string) => {
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (const b of rows.filter((r) => r.name.startsWith(pre) && r.bbox)) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], b.bbox!.min[k]); mx[k] = Math.max(mx[k], b.bbox!.max[k]); }
      return { mn, mx };
    };
    const second = async (entry: string, params: object) => {
      const A = new Interpreter(scr);
      await runPlugin(plugin, 'cabinet', { material: 'none', place: 'origin', name: 'A' }, (c, a) => A.run(c, a), { allow: allow() });
      await A.run('inspect.measure', {});
      const bodies = (await listBodies(scratch)).map((b) => ({ name: b.name, bbox: b.bbox ?? null, volume: b.volume }));
      const B = new Interpreter(scr, { doc: { up: 'z', bodies, selection: [{ type: 'body', name: 'A Side L' }] } });
      await runPlugin(plugin, entry, { material: 'none', name: 'B', ...params }, (c, a) => B.run(c, a), { allow: allow() });
      await B.run('inspect.measure', {});
      const rows = (await listBodies(scratch)).map((b) => ({ name: b.name, bbox: b.bbox ?? null }));
      return { a: extent(bodies, 'A '), b: extent(rows, 'B ') };
    };
    it('right: against its right side, backs flush', async () => {
      const { a, b } = await second('cabinet', { place: 'right' });
      expect(b.mn[0]).toBeCloseTo(a.mx[0]); expect(b.mx[0] - b.mn[0]).toBeCloseTo(600); expect(b.mx[1]).toBeCloseTo(a.mx[1]); expect(b.mn[2]).toBeCloseTo(a.mn[2]);
    }, 120_000);
    it('left: against its left side', async () => {
      const { a, b } = await second('cabinet', { place: 'left' });
      expect(b.mx[0]).toBeCloseTo(a.mn[0]); expect(b.mx[1]).toBeCloseTo(a.mx[1]);
    }, 120_000);
    it('above: on top of it', async () => {
      const { a, b } = await second('cabinet', { place: 'above' });
      expect(b.mn[2]).toBeCloseTo(a.mx[2]); expect(b.mn[0]).toBeCloseTo(a.mn[0]);
    }, 120_000);
    it('a corner cabinet goes right or left of it too', async () => {
      for (const [corner, side] of [['right', 'right'], ['left', 'left']] as const) {
        const { a, b } = await second('corner', { place: side, corner });
        expect(side === 'right' ? b.mn[0] : b.mx[0]).toBeCloseTo(side === 'right' ? a.mx[0] : a.mn[0]);
        expect(b.mx[1]).toBeCloseTo(a.mx[1]);
      }
    }, 240_000);
  });
  // Woodwork 0.1.7 and later: labels, turned doors, Joinery and Match selected read the document the way SolidCraft reports it
  describe('what 0.1.7 asks of the host', () => {
    const v7 = () => version.localeCompare('0.1.7', undefined, { numeric: true }) >= 0;
    const placed = async () => {
      const A = new Interpreter(scr);
      await runPlugin(plugin, 'cabinet', { material: 'none', place: 'origin', name: 'A' }, (c, a) => A.run(c, a), { allow: allow() });
      await A.run('inspect.measure', {});
      const bodies = (await listBodies(scratch)).map((b) => ({ name: b.name, bbox: b.bbox ?? null, volume: b.volume }));
      return { A, bodies };
    };
    const next = async (entry: string, params: object, bodies: Array<{ name: string; bbox: { min: number[]; max: number[] } | null; volume: number | null }>, sel: string, A: Interpreter) => {
      const I = new Interpreter(scr, { doc: { up: 'z', bodies, selection: [{ type: 'body', name: sel }], parameters: [...A.params.values()], components: A.componentMetadata() } });
      await runPlugin(plugin, entry, params, (c, a) => I.run(c, a), { allow: allow() });
      return I;
    };
    it('labels engrave each board\'s name, a little material off every board', async () => {
      if (!v7()) return;
      const plain = await run({ doors: 0 }), labelled = await run({ doors: 0, labels: true });
      const vol = async (r: { I: Interpreter }) => ((await r.I.run('inspect.measure', {})) as { bodies: Array<{ volume_mm3: number }> }).bodies.reduce((a, b) => a + b.volume_mm3, 0);
      expect(labelled.I.order.filter((o) => 'kind' in o && o.kind === 'label').length).toBeGreaterThan(4);
      const [a, b] = [await vol(plain), await vol(labelled)];
      expect(b).toBeLessThan(a); expect(a - b).toBeLessThan(a * 0.001);
    }, 240_000);
    it('a diagonal corner cabinet\'s turned door is built', async () => {
      if (!v7()) return;
      const r = await run({ doors: 'hinged right', handles: 'pull' }, 'corner', { shape: 'diagonal', corner: 'right' });
      const m = (await r.I.run('inspect.measure', {})) as { bodies: Array<{ name: string }> };
      expect(m.bodies.some((b) => /Door/.test(b.name))).toBe(true);
    }, 240_000);
    it('Match selected takes height, depth and thickness from the selected cabinet', async () => {
      if (!v7()) return;
      const { A, bodies } = await placed();
      const I = await next('cabinet', { material: 'none', place: 'right', match: 'selected', name: 'B', height: 100, depth: 100, thickness: 5 }, bodies, 'A Side L', A);
      const h = I.params.get('B_height')!, d = I.params.get('B_depth')!, t = I.params.get('B_thickness')!;
      expect([h.value, d.value, t.value]).toEqual([720, 560, 18]);
    }, 240_000);
    it('Joinery drills the cabinet where it stands, not at the origin', async () => {
      if (!v7() || !entries.has('joinery')) return;
      const { A, bodies } = await placed();
      const B = await next('cabinet', { material: 'none', place: 'right', name: 'A' }, bodies, 'A Side L', A);
      await B.run('inspect.measure', {});
      const bBodies = (await listBodies(scratch)).map((b) => ({ name: b.name, bbox: b.bbox ?? null, volume: b.volume }));
      const J = new Interpreter(scr, { doc: { up: 'z', bodies: [...bodies, ...bBodies], selection: [{ type: 'body', name: 'A 2 Side L' }], parameters: [...A.params.values(), ...B.params.values()], components: { ...A.componentMetadata(), ...B.componentMetadata() } } });
      await runPlugin(plugin, 'joinery', { type: 'confirmat' }, (c, a) => J.run(c, a), { allow: allow() });
      const cuts = J.order.filter((o): o is Extract<typeof o, { kind: 'round' }> => 'kind' in o && o.kind === 'round' && o.op === 'cut');
      expect(cuts.length).toBeGreaterThan(8);
      for (const c of cuts) { expect(c.base[0]).toBeGreaterThan(295); expect(c.base[0]).toBeLessThan(905); }
    }, 240_000);
    it('Material on a selected cabinet gives its boards the material as a script of colours only', async () => {
      if (!v7() || !entries.has('material')) return;
      const { A, bodies } = await placed();
      const files = await filesFromZip(new Uint8Array(readFileSync(ZIP!))); if (!(files instanceof Map)) throw new Error(files.error);
      const i = await inspectPackage(files);
      const rec = { id: i.manifest!.id, version: i.manifest!.version, manifest: i.manifest!, files: i.files!, scripts: {}, binaries: i.binaries, hash: i.hash!, source: { kind: 'zip', name: 'test' }, installedAt: 0, enabled: true } as InstalledPlugin;
      const gens = wasmGenerators(rec, { scratch: () => scr });
      const id = i.manifest!.contributes.generators.find((g) => g.entry === 'material')!.id;
      const doc = { up: 'z' as const, bodies: bodies.map((b, n) => ({ ...b, feature: `F${n + 1}` })), selection: [{ type: 'body' as const, name: 'A Side L' }], parameters: [...A.params.values()], components: A.componentMetadata() };
      const script = await gens[id]({ material: 'Oak', scope: 'cabinet' } as never, { used: [], uniqueName: (b: string) => b, doc } as never);
      expect(script).toContain('p.appearance({ feature: "F2"');   // A Side R, a body of the open document
    }, 240_000);
  });
});
