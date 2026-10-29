// Change a variable of an imported part and rebuild it: the volume follows (closed forms). Synthetic documents; needs the kernel (CK_WASM).
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { importSolidcraftDocument, type ScPart } from './import';

type Rec = Record<string, any>;
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
const volumeOf = async (part: ScPart) => {
  const s = await Session.open(part as unknown as PartDoc); sessions.push(s);
  const rep = await s.verify();
  expect(rep.regen.errors).toEqual([]);
  return (await s.facts()).volume!;
};
/** A rectangle w x h drawn from the origin (dimensions driven by the parameters `w` and `h`), extruded by `depth`. */
const doc = (depth: string) => ({
  format: 'solidcraft/33', units: 'mm',
  params: [{ name: 'w', expr: '30 mm' }, { name: 'h', expr: 'w / 2' }, { name: 't', expr: '4 mm' }],
  features: [
    { id: 1, name: 'S1', type: 'sketch', suppressed: false, plane: { type: 'origin', name: 'XY' }, sketch: {
      points: [{ id: 'origin', pos: [0, 0] }, { id: 'p1', pos: [0, 0] }, { id: 'p2', pos: [30, 0] }, { id: 'p3', pos: [30, 15] }, { id: 'p4', pos: [0, 15] }],
      curves: [{ id: 'l1', type: 'line', a: 1, b: 2 }, { id: 'l2', type: 'line', a: 2, b: 3 }, { id: 'l3', type: 'line', a: 3, b: 4 }, { id: 'l4', type: 'line', a: 4, b: 1 }],
      constraints: [{ id: 'k1', type: 'coincident', p: 0, q: 1 }, { id: 'k2', type: 'horizontal', l: 0 }, { id: 'k3', type: 'vertical', l: 1 }, { id: 'k4', type: 'horizontal', l: 2 }, { id: 'k5', type: 'vertical', l: 3 },
        { id: 'k6', type: 'length', l: 0, value: 30, param: 'w' }, { id: 'k7', type: 'length', l: 1, value: 15, param: 'h' }] } },
    { id: 2, name: 'E', type: 'extrude', suppressed: false, sketch: 1, profiles: { type: 'all' }, operation: 'new_body', extent: { convention: 'total_distance', direction: 'positive', distance: depth } },
  ],
});
const near = (a: number, b: number) => expect(Math.abs(a - b) / b, `${a} against ${b}`).toBeLessThan(1e-4);
const withVariable = (part: ScPart, name: string, expr: string): ScPart => ({ ...part, variables: part.variables!.map((v) => (v.name === name ? { ...v, expr } : v)) });

describe('live parameters against the kernel', { skip: !process.env.CK_WASM, timeout: 120_000 }, () => {
  it('the depth follows its variable: t = 4, then 10', async () => {
    const r = await importSolidcraftDocument(doc('t'), 'p');
    expect(r.part!.variables).toBeDefined();
    near(await volumeOf(r.part!), 30 * 15 * 4);
    near(await volumeOf(withVariable(r.part!, 't', '10')), 30 * 15 * 10);
  });
  it('the rectangle follows its dimensions: w = 30 makes 30 x 15, w = 60 makes 60 x 30 (h = w / 2)', async () => {
    const r = await importSolidcraftDocument(doc('t'), 'p');
    near(await volumeOf(r.part!), 30 * 15 * 4);
    near(await volumeOf(withVariable(r.part!, 'w', '60')), 60 * 30 * 4);
  });
  it('an expression of several variables: depth t + w / 10', async () => {
    const r = await importSolidcraftDocument(doc('t + w / 10'), 'p');
    near(await volumeOf(r.part!), 30 * 15 * 7);
    near(await volumeOf(withVariable(r.part!, 'w', '60')), 60 * 30 * 10);
  });
  it('a number that the grammar could not hold does not follow, and says so', async () => {
    const r = await importSolidcraftDocument(doc('max(t, 1)'), 'p');
    expect(r.rows[1].notes?.[0]).toMatch(/kept as the number 4/);
    near(await volumeOf(withVariable(r.part!, 't', '10')), 30 * 15 * 4);
  });
});
