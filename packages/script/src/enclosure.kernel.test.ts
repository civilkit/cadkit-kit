import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { runScript, type ScriptHost } from './index';

// split() and lipJoint(): a shelled 40 x 20 x 10 box (2 mm walls) cut at mid height, with and without the joint.

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function run(code: string) {
  const store = createStore();
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  const h: ScriptHost = {
    load: (d) => controller.load({ ...emptyPart('x'), ...d } as unknown as PartDoc),
    edit: (ops, why) => controller.edit(ops, why) as never,
    geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }),
  };
  const r = await runScript(code, h);
  const ok = r.errors.length === 0;
  const s = sessions.at(-1)!;
  const m = ok ? ((await s.massProps({ bodies: true })) as { volume: number; bodies?: Array<{ name?: string; volume: number }> }) : null;
  const valid = ok ? (((await s.validate().catch(() => ({ ok: false }))) as { ok: boolean }).ok) : false;
  const vol = (name: string) => m?.bodies?.find((b) => b.name === name)?.volume ?? NaN;
  return { r, total: m?.volume ?? NaN, bodies: m?.bodies ?? [], vol, valid };
}
const T = 120000;
const band = (d1: number, d2: number) => (40 - 2 * d1) * (20 - 2 * d1) - (40 - 2 * d2) * (20 - 2 * d2);
const CASE = "part('Case').sketch('front', (s) => s.rect(40, 20)).extrude(10).shell(face('>Z'), 2)";
const features = (r: { document: Record<string, unknown> | null }) => (r.document?.features ?? []) as Array<Record<string, unknown>>;

describe('split and lipJoint', () => {
  it('split cuts a shelled box at mid height into two named bodies whose volumes add up', async () => {
    const whole = await run(`${CASE};`);
    const o = await run(`${CASE}.split(at('front', 5), { names: ['Base', 'Lid'] });`);
    expect(o.r.errors).toEqual([]);
    expect(o.valid).toBe(true);
    expect(o.bodies).toHaveLength(2);
    expect(o.vol('Lid')).toBeCloseTo(5 * band(0, 2), 6);
    expect(o.vol('Base') + o.vol('Lid')).toBeCloseTo(whole.total, 6);
    const f = features(o.r).find((x) => x.type === 'split')!;
    expect(f.names).toEqual(['Base', 'Lid']);
  }, T);

  it('lipJoint: the tongue fits the groove with the clearance; total volume is the case plus tongue minus groove', async () => {
    const whole = await run(`${CASE};`);
    const split = await run(`${CASE}.split(at('front', 5), { names: ['Base', 'Lid'] });`);
    const o = await run(`${CASE}.lipJoint(at('front', 5), { height: 1.5, width: 1, clearance: 0.2, names: ['Base', 'Lid'] });`);
    expect(o.r.errors).toEqual([]);
    expect(o.valid).toBe(true);
    expect(o.bodies).toHaveLength(2);
    const tongue = 1.5 * band(0.5, 1.5);      // centred in the 2 mm wall: 0.5 mm in from the outer wall
    const groove = 1.7 * band(0.3, 1.7);      // 0.2 mm wider on each side, 0.2 mm deeper
    expect(o.vol('Base') - split.vol('Base')).toBeCloseTo(tongue, 6);
    expect(split.vol('Lid') - o.vol('Lid')).toBeCloseTo(groove, 6);
    expect(o.total).toBeCloseTo(whole.total + tongue - groove, 6);
    expect(features(o.r).find((x) => x.type === 'lipJoint')).toMatchObject({ height: 1.5, width: 1, clearance: 0.2 });
  }, T);

  it('lipJoint with the tongue on the lid and the width as a fraction of the wall', async () => {
    const split = await run(`${CASE}.split(at('front', 5), { names: ['Base', 'Lid'] });`);
    const o = await run(`${CASE}.lipJoint(at('front', 5), { height: 1.5, widthRatio: 0.5, tongue: 'above', names: ['Base', 'Lid'] });`);
    expect(o.r.errors).toEqual([]);
    expect(o.valid).toBe(true);
    expect(o.vol('Lid') - split.vol('Lid')).toBeCloseTo(1.5 * band(0.5, 1.5), 6);
    expect(split.vol('Base') - o.vol('Base')).toBeCloseTo(1.7 * band(0.3, 1.7), 6);
  }, T);

  it('a tongue that does not fit the wall is refused as invalidValue', async () => {
    const o = await run(`${CASE}.lipJoint(at('front', 5), { height: 1.5, width: 1.9, clearance: 0.2 });`);
    expect(o.r.errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(o.r.errors)).toMatch(/invalidValue/);
  }, T);

  it('split with keep drops the other half', async () => {
    const o = await run(`${CASE}.split(at('front', 5), { keep: 'above' });`);
    expect(o.r.errors).toEqual([]);
    expect(o.total).toBeCloseTo(5 * band(0, 2), 6);
  }, T);

  it('later cuts keep the names; one aimed at the Lid with from: changes only the Lid', async () => {
    const joint = `${CASE}.lipJoint(at('front', 5), { height: 1.5, width: 1, clearance: 0.2, names: ['Base', 'Lid'] })`;
    const hole = (z: number, extra: string) => `.sketch('front', (s) => s.rect(4, 6, [0, 10])).cut(${z}, { direction: 'away'${extra} })`;
    const j = await run(`${joint};`);
    expect(j.bodies.map((b) => b.name).sort()).toEqual(['Base', 'Lid']);
    // through everything, no body named: both halves are cut and stay two bodies with their names
    const all = await run(`${joint}${hole(10, '')};`);
    expect(all.r.errors).toEqual([]);
    expect(all.bodies.map((b) => b.name).sort()).toEqual(['Base', 'Lid']);
    expect(all.vol('Base')).toBeLessThan(j.vol('Base'));
    expect(all.vol('Lid')).toBeLessThan(j.vol('Lid'));
    // the same cut aimed at the lid: the base is untouched
    const lid = await run(`${joint}${hole(10, ", from: 'Lid'")};`);
    expect(lid.r.errors).toEqual([]);
    expect(lid.bodies.map((b) => b.name).sort()).toEqual(['Base', 'Lid']);
    expect(lid.vol('Base')).toBeCloseTo(j.vol('Base'), 6);
    expect(lid.vol('Lid')).toBeLessThan(j.vol('Lid') - 1e-6);
    expect(lid.valid).toBe(true);
  }, T);
});
