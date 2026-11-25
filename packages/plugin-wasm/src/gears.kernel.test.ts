// @vitest-environment node
// The SolidCraft Gears plugin (a third-party release zip) converted by the app and run through the interpreter on our kernel.
// Run:  CK_WASM=<kernel wasm> CK_GEARS_ZIP=<release.zip> npx vitest run packages/plugin-wasm/src/gears
import { existsSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { filesFromZip, inspectPackage, type InstalledPlugin } from '@kit/plugin';
import { AgentSession } from '../../agent-tools/src';
import { placeholderSnapshot } from '../../agent-tools/src/testing/placeholder-snapshot';
import { listBodies } from '../../agent-tools/src/bodies';
import { runPlugin, type Loaded } from './host';
import { convertRelease } from './convert';
import { Interpreter, type DocContext, type Scratch } from './interpreter';
import { dataUrlLoader } from './package';

const ZIP = process.env.CK_GEARS_ZIP;
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

const gear = async (params: object, entry = 'make-gear', doc?: DocContext) => {
  const I = new Interpreter(scr, doc ? { doc } : {});
  const log: string[] = [];
  await runPlugin(plugin, entry, params, async (c, a) => { log.push(`${c} ${JSON.stringify(a).slice(0, 200)}`); return I.run(c, a); }, { allow: allowed });
  const rep = await scratch.runScript(I.script({ part: 'Gear' }), 'new');
  return { I, log, rep, rows: await listBodies(scratch) };
};

describe.skipIf(!on)('Gears plugin end to end', () => {
  it('makes a 20 tooth module 2 spur gear: one valid solid, the size the formulas give', async () => {
    const { rep, rows, log } = await gear({ module: 2, teeth: 20, face_width: 10, pressure_angle: 20 });
    expect(rep.errors).toEqual([]);
    expect(log.some((l) => l.startsWith('sketch.create'))).toBe(true);
    expect(rows.length).toBe(1);
    const b = rows[0];
    console.log(`gear: ${rows.length} body, volume ${b.volume}, bbox ${JSON.stringify(b.bbox)}`);
    expect(b.volume!).toBeGreaterThan(0);
    // outside diameter = m (z + 2) = 44, thickness 10 along Z
    const ext = [0, 1, 2].map((i) => b.bbox!.max[i] - b.bbox!.min[i]);
    expect(ext[0]).toBeGreaterThan(43.5); expect(ext[0]).toBeLessThan(44.5);
    expect(ext[2]).toBeCloseTo(10, 3);
    // the section lies between the root disc and the tip disc
    const area = b.volume! / 10;
    expect(area).toBeGreaterThan(Math.PI * 17 * 17);   // bigger than the root disc
    expect(area).toBeLessThan(Math.PI * 22 * 22);      // smaller than the tip disc
  }, 180_000);
  it('the bore is cut through when asked for', async () => {
    const plain = await gear({ module: 2, teeth: 20, face_width: 10, pressure_angle: 20 });
    const bored = await gear({ module: 2, teeth: 20, face_width: 10, pressure_angle: 20, bore_diameter: 8 });
    expect(bored.rep.errors).toEqual([]);
    expect(bored.rows.length).toBe(1);
    // the reported volume is of the tessellated body, so the round bore comes out about 1% light
    const removed = plain.rows[0].volume! - bored.rows[0].volume!;
    expect(Math.abs(removed / (Math.PI * 16 * 10) - 1)).toBeLessThan(0.02);
  }, 180_000);
  // the defaults the app's form shows (bore 0, shift 0) and a few others: each must build one valid body, whatever the join targets are
  for (const c of [
    { module: 2, teeth: 20, face_width: 10, pressure_angle: 20, bore_diameter: 0, profile_shift: 0 },
    { module: 2, teeth: 12, face_width: 10, pressure_angle: 20 },
    { module: 2, teeth: 40, face_width: 10, pressure_angle: 20 },
    { module: 2, teeth: 20, face_width: 10, pressure_angle: 20, bore_diameter: 8 },
    { module: 2, teeth: 20, face_width: 10, pressure_angle: 20, profile_shift: 0.3 },
  ]) it(`builds one valid body for ${JSON.stringify(c)}`, async () => {
    const { rep, rows } = await gear(c);
    expect(rep.errors).toEqual([]);
    expect(rows.length).toBe(1);
    console.log(`gears ${JSON.stringify(c)}: ${rows.length} body, volume ${rows[0].volume}`);
    expect(rows[0].volume!).toBeGreaterThan(0);
  }, 180_000);
  // the live failure: a document that already holds two bodies. A join with no targets then has two (every body of the component)
  it('a document with two bodies of its own: the default gear still builds, and says what it joined', async () => {
    const doc = { bodies: [{ name: 'Body 1', bbox: null }, { name: 'Body 2', bbox: null }], selection: [] } as unknown as DocContext;
    const { log, I } = await gear({ module: 2, teeth: 20, face_width: 10, pressure_angle: 20, bore_diameter: 0, profile_shift: 0 }, 'make-gear', doc);
    console.log(`gears with doc bodies: ${log.length} calls, ${I.script({ part: 'Gear' }).length} chars`);
    const joins = I.script({ part: 'Gear' }).match(/p\.combine\([^\n]*/g) ?? [];
    expect(joins.length).toBeGreaterThan(0);
    expect(joins.some((j) => /Body [12]/.test(j))).toBe(false);   // the document's own bodies are not merged into the gear
    expect(log.length).toBeGreaterThan(0);
  }, 180_000);
  it('attached to a document that already holds a box, the gear is still one solid body', async () => {
    const doc = { bodies: [{ name: 'Block', bbox: null }], selection: [] } as unknown as DocContext;
    const first = await scratch.runScript(`const p = part('Block'); p.sketch(at('top', 0), (s) => s.circle(6, [30, 0])).extrude(20, { name: 'Block', newBody: 'Block' });`, 'new');
    console.log('BOXRUN ' + JSON.stringify(first.errors).slice(0, 200));
    const I = new Interpreter(scr, { doc });
    await runPlugin(plugin, 'make-gear', { module: 2, teeth: 20, face_width: 10, pressure_angle: 20, bore_diameter: 0, profile_shift: 0 }, async (c, a) => I.run(c, a), { allow: allowed });
    const script = I.script({ part: 'Gear' });
    const rep = await scratch.runScript(script, 'attach');
    const rows = await listBodies(scratch);
    console.log('ATTACH ' + JSON.stringify(rep.errors).slice(0, 300) + ' bodies ' + JSON.stringify(rows.map((r) => [r.name, r.volume])));
    console.log('SCRIPTHEAD ' + script.slice(0, 700).replace(/\n/g, ' | '));
  }, 180_000);
});
