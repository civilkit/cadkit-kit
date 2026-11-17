// @vitest-environment node
// The third-party "Wood joinery" plugin (Apache-2.0, wasm component, SolidCraft format) through the replay host and the interpreter, on our kernel.
// It edits boards that are already in the document, so it needs selection.get, inspect.measure on document bodies, solid.cylinder/cone/combine/move.
// Run:  CK_WASM=<gated wasm> CK_WJ_ZIP=<zip from tools/plugin_wasm_pack.mjs, all entries> npx vitest run packages/plugin-wasm/src/woodJoinery
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { filesFromZip, inspectPackage, type InstalledPlugin } from '@kit/plugin';
import { AgentSession } from '../../agent-tools/src';
import { placeholderSnapshot } from '../../agent-tools/src/testing/placeholder-snapshot';
import { listBodies } from '../../agent-tools/src/bodies';
import { runPlugin, type Loaded } from './host';
import { Interpreter, type Scratch, type DocBody, type DocSel } from './interpreter';
import { dataUrlLoader } from './package';

const ZIP = process.env.CK_WJ_ZIP;
const on = !!(process.env.CK_WASM && ZIP);
let allowed = new Set<string>();
let plugin: Loaded, scratch: AgentSession;
beforeAll(async () => {
  if (!on) return;
  const files = await filesFromZip(new Uint8Array(readFileSync(ZIP!)));
  if (!(files instanceof Map)) throw new Error(files.error);
  const i = await inspectPackage(files);
  if (!i.ok || !i.manifest?.wasm) throw new Error(`not installable: ${i.errors.join('; ')}`);
  allowed = new Set(i.manifest.wasm.commands);
  plugin = await dataUrlLoader.load({ id: i.manifest.id, version: i.manifest.version, manifest: i.manifest, files: i.files!, scripts: {}, binaries: i.binaries, hash: i.hash!, source: { kind: 'zip', name: 'test' }, installedAt: 0, enabled: true } as InstalledPlugin);
  scratch = await AgentSession.open({ wasmPath: process.env.CK_WASM, snapshotFn: placeholderSnapshot as never });
}, 180_000);
afterAll(async () => { await scratch?.close(); });
/** The recorded edit as a script on top of the document's own script (the app runs it with the document's features as the prefix). */
const compose = (base: string, edit: string): string => `${base}\n${edit.replace(/const p = part\([^\n]*\n(p\.upAxis[^\n]*\n)?/, '').replace(/^const H = \{\};\n/m, 'var H = {};\n')}`;
let baseScript = '';
const scr: Scratch = { async build(script) { const r = await scratch.runScript(compose(baseScript, script), 'new'); if (!r.ok) throw new Error(`kernel refused: ${r.errors[0]?.message}`); return listBodies(scratch); } };

/** Two boards (Z-up numbers, in a Z-up part): a stile standing along Z, a rail lying along X with its end on the stile's side face. */
const stileRail = `const p = part('Joint').upAxis('z');
p.sketch(at('front', 0), (s) => s.rect(60, 20, [0, 0])).extrude(400, { name: 'Stile board', newBody: 'Stile' });
p.sketch(at('front', 170), (s) => s.rect(300, 20, [180, 0])).extrude(60, { name: 'Rail board', newBody: 'Rail' });`;

const doc = async (script: string): Promise<{ bodies: DocBody[] }> => {
  const r = await scratch.runScript(script, 'new'); expect(r.errors).toEqual([]);
  return { bodies: (await listBodies(scratch)).map((b) => ({ name: b.name, bbox: b.bbox ?? null, volume: b.volume })) };
};
/** run an entry against a document and return the combined script's bodies */
const run = async (entry: string, params: object, d: { bodies: DocBody[]; selection?: DocSel[] }, base: string) => {
  baseScript = base;
  const I = new Interpreter(scr, { doc: { up: 'z', bodies: d.bodies, selection: d.selection ?? [] } });
  await runPlugin(plugin, entry, params, (c, a) => I.run(c, a), { allow: allowed });
  const edit = I.script({ part: 'Joint', up: 'z' });
  const rep = await scratch.runScript(compose(base, edit), 'new');
  return { I, edit, errors: rep.errors, rows: rep.errors.length ? [] : await listBodies(scratch) };
};

const L = {
  /** a rail's end on a stile's side face (a T) */
  butt: stileRail,
  /** two flat boards crossing */
  cross: `const p = part('Joint').upAxis('z');
p.sketch(at('front', 0), (s) => s.rect(400, 40, [0, 0])).extrude(20, { name: 'A', newBody: 'Rail' });
p.sketch(at('front', 0), (s) => s.rect(40, 400, [0, 0])).extrude(20, { name: 'B', newBody: 'Stile' });`,
  /** two flat boards meeting at a corner */
  flatCorner: `const p = part('Joint').upAxis('z');
p.sketch(at('front', 0), (s) => s.rect(300, 40, [150, 20])).extrude(20, { name: 'A', newBody: 'Rail' });
p.sketch(at('front', 0), (s) => s.rect(40, 300, [20, 150])).extrude(20, { name: 'B', newBody: 'Stile' });`,
  /** two boards standing up at a box corner (fingers alternate along the height): the rail stops at the stile's inner face, so the two never overlap */
  upright: `const p = part('Joint').upAxis('z');
p.sketch(at('front', 0), (s) => s.rect(280, 20, [160, 10])).extrude(200, { name: 'A', newBody: 'Rail' });
p.sketch(at('front', 0), (s) => s.rect(20, 300, [10, 150])).extrude(200, { name: 'B', newBody: 'Stile' });`,
  /** two boards edge to edge (a panel) */
  edge: `const p = part('Joint').upAxis('z');
p.sketch(at('front', 0), (s) => s.rect(400, 80, [0, 40])).extrude(20, { name: 'A', newBody: 'Rail' });
p.sketch(at('front', 0), (s) => s.rect(400, 80, [0, 120])).extrude(20, { name: 'B', newBody: 'Stile' });`,
  /** two boards end to end, overlapping by 140 mm (a scarf) */
  endToEnd: `const p = part('Joint').upAxis('z');
p.sketch(at('front', 0), (s) => s.rect(300, 40, [150, 0])).extrude(20, { name: 'A', newBody: 'Rail' });
p.sketch(at('front', 0), (s) => s.rect(300, 40, [310, 0])).extrude(20, { name: 'B', newBody: 'Stile' });`,
  /** a plate on a block (screws) */
  stack: `const p = part('Joint').upAxis('z');
p.sketch(at('front', 20), (s) => s.rect(300, 100, [150, 50])).extrude(20, { name: 'A', newBody: 'Rail' });
p.sketch(at('front', 0), (s) => s.rect(300, 100, [150, 50])).extrude(20, { name: 'B', newBody: 'Stile' });`,
};
const picked: DocSel[] = [{ type: 'body', name: 'Rail' }, { type: 'body', name: 'Stile' }];

describe.skipIf(!on)('wood joinery on our kernel: every joint edits the boards it is given', () => {
  it('the package asks for the seven commands and nothing else', () => { expect([...allowed].sort()).toEqual(['inspect.measure', 'selection.get', 'solid.box', 'solid.combine', 'solid.cone', 'solid.cylinder', 'solid.move']); });

  // [entry, layout, params, what the joint must have done (volumes before the edit are 'Rail' and 'Stile' of the layout)]
  const cases: Array<[string, keyof typeof L, object, (v: Record<string, number>, before: Record<string, number>) => boolean]> = [
    ['mortise-tenon', 'butt', { rail: 'Rail', stile: 'Stile' }, (v, b) => v.Rail > b.Rail && v.Stile < b.Stile],            // a tenon on the rail, a mortise in the stile
    ['half-lap', 'cross', {}, (v, b) => v.Rail < b.Rail && v.Stile < b.Stile],
    ['dowels', 'butt', {}, (v, b) => v.Rail < b.Rail && v.Stile < b.Stile && Object.keys(v).some((k) => k.startsWith('Dowel'))],
    ['box-joint', 'upright', {}, (v, b) => v.Stile < b.Stile],
    ['loose-tenon', 'butt', {}, (v, b) => v.Stile < b.Stile && Object.keys(v).some((k) => k.startsWith('Loose tenon'))],
    ['housing', 'butt', {}, (v, b) => v.Stile < b.Stile && v.Rail > b.Rail],
    ['miter', 'flatCorner', {}, (v, b) => v.Rail < b.Rail && v.Stile < b.Stile],                                              // solid.move (turn) + solid.combine (cut)
    ['tongue-groove', 'edge', {}, (v, b) => v.Rail !== b.Rail && v.Stile !== b.Stile],
    ['scarf', 'endToEnd', {}, (v, b) => v.Rail < b.Rail && v.Stile < b.Stile],
    ['dovetail', 'upright', {}, (v, b) => v.Stile < b.Stile],                                                                  // combine cut and join with keep_tools
    ['screws', 'stack', { length: 30 }, (v, b) => v.Rail < b.Rail && v.Stile < b.Stile],                                      // solid.cone (countersink) + solid.cylinder
    ['biscuits', 'edge', {}, (v, b) => v.Rail < b.Rail && Object.keys(v).some((k) => k.startsWith('Biscuit'))],               // solid.cylinder intersect
  ];
  for (const [entry, layout, params, ok] of cases) {
    it(`${entry} on ${layout} boards`, async () => {
      const d = await doc(L[layout]);
      const before = Object.fromEntries(d.bodies.map((b) => [b.name, b.volume ?? 0]));
      const r = await run(entry, params, { ...d, selection: picked }, L[layout]);
      expect(r.errors).toEqual([]);
      const v = Object.fromEntries(r.rows.map((b) => [b.name, b.volume ?? 0]));
      expect(ok(v, before), `${entry}: ${JSON.stringify(v)} after ${JSON.stringify(before)}`).toBe(true);
    }, 120_000);
  }

  it('groove takes the picked face and its normal from selection.get (detail)', async () => {
    const d = await doc(L.butt);
    const r = await run('groove', {}, { ...d, selection: [{ type: 'face', body: 'Stile', normal: [1, 0, 0] }] }, L.butt);
    expect(r.errors).toEqual([]);
    expect(r.rows.find((b) => b.name === 'Stile')!.volume!).toBeLessThan(d.bodies.find((b) => b.name === 'Stile')!.volume!);
  }, 120_000);

  it('a Y-up document: the plugin sees the boards in its own Z-up frame and its cuts land on the same boards', async () => {
    // the same T, written for a Y-up part (x, y, z) -> (x, z, -y): the joint must come out the same
    const yup = `const p = part('Joint');
p.sketch(at('front', -10), (s) => s.rect(60, 400, [0, 200])).extrude(20, { name: 'S', newBody: 'Stile' });
p.sketch(at('front', -10), (s) => s.rect(300, 60, [180, 200])).extrude(20, { name: 'R', newBody: 'Rail' });`;
    const d = await doc(yup);
    expect(d.bodies.map((b) => b.name).sort()).toEqual(['Rail', 'Stile']);
    baseScript = yup;
    const I = new Interpreter(scr, { up: 'y', doc: { up: 'y', bodies: d.bodies, selection: [] } });
    await runPlugin(plugin, 'mortise-tenon', { rail: 'Rail', stile: 'Stile' }, (c, a) => I.run(c, a), { allow: allowed });
    const rep = await scratch.runScript(compose(yup, I.script({ part: 'Joint', up: 'y' })), 'new');
    expect(rep.errors).toEqual([]);
    const rows = await listBodies(scratch);
    expect(rows.find((b) => b.name === 'Rail')!.volume!).toBeGreaterThan(d.bodies.find((b) => b.name === 'Rail')!.volume!);
    expect(rows.find((b) => b.name === 'Stile')!.volume!).toBeLessThan(d.bodies.find((b) => b.name === 'Stile')!.volume!);
  }, 120_000);
});

describe.skipIf(!on)('wood joinery: a whole frame, joint after joint', () => {
  // Two stiles standing along Z and two rails between them, ends on the stiles' faces: four mortise-and-tenon corners, each run on the part as the last one left it.
  const frame = `const p = part('Frame').upAxis('z');
p.sketch(at('front', 0), (s) => s.rect(60, 20, [0, 0])).extrude(500, { name: 'Stile L board', newBody: 'Stile L' });
p.sketch(at('front', 0), (s) => s.rect(60, 20, [340, 0])).extrude(500, { name: 'Stile R board', newBody: 'Stile R' });
p.sketch(at('front', 440), (s) => s.rect(280, 20, [170, 0])).extrude(60, { name: 'Rail top board', newBody: 'Rail top' });
p.sketch(at('front', 40), (s) => s.rect(280, 20, [170, 0])).extrude(60, { name: 'Rail bottom board', newBody: 'Rail bottom' });`;
  const strip = (edit: string): string => edit.replace(/const p = part\([^\n]*\n(p\.upAxis[^\n]*\n)?/, '').replace(/^const H = \{\};\n/m, '');
  it('four corners: every board ends up joined, the volume only moves by what the joints move', async () => {
    let script = frame;
    const start = await doc(script);
    expect(start.bodies.map((b) => b.name).sort()).toEqual(['Rail bottom', 'Rail top', 'Stile L', 'Stile R']);
    const total0 = start.bodies.reduce((a, b) => a + (b.volume ?? 0), 0);
    for (const [rail, stile] of [['Rail top', 'Stile L'], ['Rail top', 'Stile R'], ['Rail bottom', 'Stile L'], ['Rail bottom', 'Stile R']]) {
      const d = await doc(script);
      baseScript = script;
      const I = new Interpreter(scr, { doc: { up: 'z', bodies: d.bodies, selection: [] } });
      await runPlugin(plugin, 'mortise-tenon', { rail, stile }, (c, a) => I.run(c, a), { allow: allowed });
      script += '\n' + strip(I.script({ part: 'Frame', up: 'z' }));
      const rep = await scratch.runScript(script, 'new');
      expect(rep.errors, `${rail} to ${stile}`).toEqual([]);
    }
    const rows = await listBodies(scratch);
    const vol = Object.fromEntries(rows.map((b) => [b.name, b.volume ?? 0]));
    expect(Object.keys(vol).sort()).toEqual(['Rail bottom', 'Rail top', 'Stile L', 'Stile R']);   // no stray tool or tenon bodies left over
    for (const r of ['Rail top', 'Rail bottom']) expect(vol[r]).toBeGreaterThan(start.bodies.find((b) => b.name === r)!.volume!);          // a tenon on each end
    for (const st of ['Stile L', 'Stile R']) expect(vol[st]).toBeLessThan(start.bodies.find((b) => b.name === st)!.volume!);               // a mortise from each rail
    const total1 = Object.values(vol).reduce((a, b) => a + b, 0);
    expect(Math.abs(total1 - total0) / total0).toBeLessThan(0.02);   // the wood moves from the stiles to the tenons, it is not lost or doubled
  }, 180_000);
});

describe.skipIf(!on)('wood joinery: a drawer box, two kinds of joint', () => {
  // Four boards standing on edge: front and back run along X, the sides along Y, each side overlapping the ends of both. Dovetails at the two front corners, box joints at the two back corners.
  const drawer = `const p = part('Drawer').upAxis('z'); var H = {};
p.sketch(at('front', 0), (s) => s.rect(260, 20, [150, 10])).extrude(100, { name: 'Front board', newBody: 'Front' });
p.sketch(at('front', 0), (s) => s.rect(260, 20, [150, 190])).extrude(100, { name: 'Back board', newBody: 'Back' });
p.sketch(at('front', 0), (s) => s.rect(20, 200, [10, 100])).extrude(100, { name: 'Left board', newBody: 'Left' });
p.sketch(at('front', 0), (s) => s.rect(20, 200, [290, 100])).extrude(100, { name: 'Right board', newBody: 'Right' });`;
  const strip = (edit: string): string => edit.replace(/const p = part\([^\n]*\n(p\.upAxis[^\n]*\n)?/, '').replace(/^const H = \{\};\n/m, '');
  it('dovetails in front, box joints behind: every board keeps its name and the joints cut the sides', async () => {
    let script = drawer;
    const start = await doc(script);
    expect(start.bodies.map((b) => b.name).sort()).toEqual(['Back', 'Front', 'Left', 'Right']);
    const steps: Array<[string, string, string]> = [['dovetail', 'Front', 'Left'], ['dovetail', 'Front', 'Right'], ['box-joint', 'Back', 'Left'], ['box-joint', 'Back', 'Right']];
    const log: string[] = [];
    for (const [entry, first, second] of steps) {
      const d = await doc(script);
      baseScript = script;
      const I = new Interpreter(scr, { doc: { up: 'z', bodies: d.bodies, selection: [{ type: 'body', name: first }, { type: 'body', name: second }] } });
      try { await runPlugin(plugin, entry, {}, (c, a) => I.run(c, a), { allow: allowed }); } catch (e) { log.push(`${entry} ${first}/${second}: ${(e as Error).message.slice(0, 200)}`); continue; }
      script += '\n' + strip(I.script({ part: 'Drawer', up: 'z' }));
      const rep = await scratch.runScript(script, 'new');
      expect(rep.errors, `${entry} ${first} ${second}`).toEqual([]);
      log.push(`${entry} ${first}/${second}: ok`);
    }
    const rows = await listBodies(scratch);
    const vol = Object.fromEntries(rows.map((b) => [b.name, b.volume ?? 0])), v0 = Object.fromEntries(start.bodies.map((b) => [b.name, b.volume ?? 0]));
    expect(Object.keys(vol).sort()).toEqual(['Back', 'Front', 'Left', 'Right']);   // no tool or tail bodies left over
    for (const side of ['Left', 'Right']) expect(vol[side]).toBeLessThan(v0[side]);            // the sockets are cut in the sides
    for (const end of ['Front', 'Back']) expect(vol[end]).toBeGreaterThan(v0[end]);            // the tails and fingers are added to the front and back
    const total = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
    expect(Math.abs(total(vol) - total(v0)) / total(v0)).toBeLessThan(0.01);                    // what the sides lose the front and back gain: the boards do not overlap
    expect(log.every((l) => l.endsWith(': ok'))).toBe(true);
  }, 180_000);
});

describe.skipIf(!on)('wood joinery: how many tails', () => {
  // a dovetail corner of two 20 x 100 mm drawer sides, the tail board along X stopping at the pin board's inner face, the pin board along Y
  const corner = `const p = part('Joint').upAxis('z'); var H = {};
p.sketch(at('front', 0), (s) => s.rect(180, 20, [110, 10])).extrude(100, { name: 'Tail board', newBody: 'Front' });
p.sketch(at('front', 0), (s) => s.rect(20, 200, [10, 100])).extrude(100, { name: 'Pin board', newBody: 'Left' });`;
  const run1 = async (params: object) => {
    const d = await doc(corner); baseScript = corner;
    const I = new Interpreter(scr, { doc: { up: 'z', bodies: d.bodies, selection: [{ type: 'body', name: 'Front' }, { type: 'body', name: 'Left' }] } });
    await runPlugin(plugin, 'dovetail', params, (c, a) => I.run(c, a), { allow: allowed });
    const rep = await scratch.runScript(compose(corner, I.script({ part: 'Joint', up: 'z' })), 'new');
    expect(rep.errors).toEqual([]);
    return { tails: I.order.filter((o) => o.name === 'Dovetail blank').length, rows: await listBodies(scratch) };
  };
  it('the default is two tails across a 100 mm drawer side (the pins are half the board thick)', async () => { expect((await run1({})).tails).toBe(2); }, 120_000);
  it('six tails with 4 mm pins', async () => {
    const r = await run1({ count: 6, pin: 4 });
    expect(r.tails).toBe(6);
    expect(r.rows.map((b) => b.name).sort()).toEqual(['Front', 'Left']);
    const vol = Object.fromEntries(r.rows.map((b) => [b.name, b.volume ?? 0]));
    expect(vol.Left).toBeLessThan(400000);          // the sockets are cut in the pin board
    expect(vol.Front).toBeGreaterThan(360000);      // and the tails are added to the tail board (it was 180 x 20 x 100)
    expect(Math.abs(vol.Front + vol.Left - 760000)).toBeLessThan(1);   // exactly what the pin board lost: nothing overlaps
  }, 120_000);
  it('six tails with the default (10 mm) pins are refused with a reason, not drawn badly', async () => {
    const d = await doc(corner); baseScript = corner;
    const I = new Interpreter(scr, { doc: { up: 'z', bodies: d.bodies, selection: [{ type: 'body', name: 'Front' }, { type: 'body', name: 'Left' }] } });
    await expect(runPlugin(plugin, 'dovetail', { count: 6 }, (c, a) => I.run(c, a), { allow: allowed })).rejects.toThrow(/leave tails under 3 mm wide/);
  }, 120_000);
});
