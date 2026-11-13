// Every inserting wizard run twice into the same part, on a real kernel: both results must commit with no regeneration error (a clash of body names,
// variables or ids shows up here) and sit in their own folders. The bearing has its own test (bearing.kernel.test.ts).
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from './controller';
import './i18n';
import { DEFAULT_SCREW, screwOps } from './screw';
import { DEFAULT_WASHER, washerOps } from './washer';
import { DEFAULT_INSERT, DEFAULT_NUT, DEFAULT_STANDOFF, insertOps, nutOps, standoffOps } from './fasteners';
import { DEFAULT_KNURL, knurlOps } from './knurl';
import { DEFAULT_GEAR, defaultPair, gearCommitOps } from './gearData';
import { DEFAULT_PROP, propPlan } from './propData';
import { DEFAULT_MARINE, marinePlan } from './marineData';
import { DEFAULT_IMPELLER, impellerPlan } from './impellerData';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
async function world(doc: PartDoc = emptyPart('Twice') as never) {
  const kernel: KernelFactory = { async open(x) { const s = await Session.open(x); sessions.push(s); return s; } };
  const c = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  await c.load(doc);
  return c;
}
type Feat = { id: string; group?: string };
const feats = (c: Controller) => (c.document()?.features ?? []) as unknown as Feat[];
const folders = (c: Controller) => [...new Set(feats(c).map((f) => f.group).filter((g): g is string => typeof g === 'string'))];
const fail = (r: unknown) => JSON.stringify((r as { errors?: unknown }).errors ?? r);

describe('an inserting wizard run twice into one part', () => {
  it('screw', async () => {
    const c = await world();
    for (let i = 0; i < 2; i++) {
      const r = await c.commit(screwOps(c.document() as never, { ...DEFAULT_SCREW, origin: [i * 40, 0, 0] } as never), 'screw');
      expect(r.ok, fail(r)).toBe(true);
    }
    expect(folders(c)).toEqual(['Screw', 'Screw 2']);
  }, 120000);

  it('washer, flat then spring', async () => {
    const c = await world();
    for (const [i, kind] of (['flat', 'spring'] as const).entries()) {
      const r = await c.commit(washerOps(c.document() as never, { ...DEFAULT_WASHER, kind, origin: [i * 40, 0, 0] }), 'washer');
      expect(r.ok, fail(r)).toBe(true);
    }
    expect(folders(c)).toEqual(['Washer', 'Washer 2']);
  }, 120000);

  it('nut, standoff and heat-set insert, twice each (the second one threaded), with the insert cutting its hole into the block under it', async () => {
    const block = { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'o', x: 0, y: 0, fixed: true }], entities: [{ type: 'circle', id: 'e1', c: 'o', r: 15 }], constraints: [] };
    const c = await world({ ...emptyPart('Block'), features: [block, { type: 'extrude', id: 'F2', op: 'newBody', body: 'Block', sketch: 'F1', end: 'blind', depth: 12 }] } as never);
    const steps: Array<[string, (n: number) => never]> = [
      ['nut', (i) => nutOps(c.document() as never, { ...DEFAULT_NUT, thread: i ? 'cosmetic' : 'plain', origin: [i * 40, 40, 0] }) as never],
      ['standoff', (i) => standoffOps(c.document() as never, { ...DEFAULT_STANDOFF, ends: 'male-female', thread: i ? 'cosmetic' : 'plain', origin: [i * 40, 80, 0] }) as never],
      ['heat-set insert', (i) => insertOps(c.document() as never, { ...DEFAULT_INSERT, hole: true, holeIn: i ? 'Block' : '', thread: i ? 'cosmetic' : 'plain', origin: [i * 8, 0, 12] }) as never],
    ];
    for (const [name, mk] of steps) for (let i = 0; i < 2; i++) {
      const r = await c.commit(mk(i), name);
      expect(r.ok, `${name} ${i}: ${fail(r)}`).toBe(true);
    }
    expect(folders(c)).toEqual(['Nut', 'Nut 2', 'Standoff', 'Standoff 2', 'Heat-set insert', 'Heat-set insert 2']);
  }, 240000);

  it('gear, then a gear pair', async () => {
    const c = await world();
    const a = await c.commit(gearCommitOps(c.document() as never, DEFAULT_GEAR), 'gear');
    expect(a.ok, fail(a)).toBe(true);
    const b = await c.commit(gearCommitOps(c.document() as never, defaultPair({ ...DEFAULT_GEAR })), 'gear pair');
    expect(b.ok, fail(b)).toBe(true);
    expect(folders(c)).toEqual(['Gear', 'Gear 2']);
  }, 120000);

  it('knurl, twice on two bands of one cylinder', async () => {
    const cyl = { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'o', x: 0, y: 0, fixed: true }], entities: [{ type: 'circle', id: 'e1', c: 'o', r: 10 }], constraints: [] };
    const c = await world({ ...emptyPart('Rod'), features: [cyl, { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 24 }] } as never);
    const target = { axis: 'z' as const, center: [0, 0] as [number, number], radius: 10 };
    for (const [from, to] of [[0, 10], [14, 24]]) {
      const r = await c.commit(knurlOps(c.document() as never, { ...DEFAULT_KNURL, cosmetic: false, count: 24, depth: 0.6, target: { ...target, from, to } }), 'knurl');
      expect(r.ok, fail(r)).toBe(true);
    }
    expect(folders(c)).toEqual(['Knurl', 'Knurl 2']);
  }, 120000);

  // the three roles-based families commit a document patch (variables and features) as one step
  const families = [
    { name: 'Propeller', plan: (d: never, _i: number) => propPlan(d, DEFAULT_PROP).patch },
    // no origin setting: the second one is built at the same place, so it differs (a smaller four-blade one) instead of being a coincident copy
    { name: 'Marine propeller', plan: (d: never, i: number) => marinePlan(d, i === 0 ? DEFAULT_MARINE : { ...DEFAULT_MARINE, diameter: 180, blades: 4 }).patch },
    { name: 'Turbo impeller', plan: (d: never, _i: number) => impellerPlan(d, DEFAULT_IMPELLER).patch },
  ];
  for (const fam of families) {
    it(`${fam.name}`, async () => {
      const c = await world();
      for (let i = 0; i < 2; i++) {
        const r = await c.applyDocPatch(fam.plan(c.document() as never, i) as never, fam.name);
        expect(r.ok, fail(r)).toBe(true);
      }
      expect(folders(c)).toEqual([fam.name, `${fam.name} 2`]);
    }, 400000);
  }
});
