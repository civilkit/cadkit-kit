import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { queryInterference } from '../../../apps/cad/src/inspect/kernel';
import { runScript, type ScriptHost } from './index';

// caseBox(): two cups (a lip on one rim, a groove in the other, the lid moved on top). The default 80 x 50 x 30 case (2 mm walls, lid 15, tongue 1 x 1.5, clearance 0.2)
// must give two valid bodies of 28 882.24 mm3 together (worked out by hand below, the number of the guide), a rounded one must match the same formula, the halves must not overlap and
// the gap between tongue and groove must be the clearance.

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
  const interference = ok ? await queryInterference(s) : null;
  const gaps = ok ? await (s as unknown as { clearance(o: object): Promise<{ pairs: Array<{ distance: number; kind: string }> }> }).clearance({ min: 0.45, include: 'gap', limit: 500 }) : null;
  const vol = (name: string) => m?.bodies?.find((b) => b.name === name)?.volume ?? NaN;
  return { r, total: m?.volume ?? NaN, bodies: m?.bodies ?? [], vol, valid, interference, gaps: (gaps?.pairs ?? []).filter((p) => p.kind === 'gap').map((p) => p.distance) };
}
const T = 300000;
const GUIDE = "caseBox({ width: 80, depth: 50, height: 30, wall: 2, lidHeight: 15, tongueHeight: 1.5, tongueWidth: 1, clearance: 0.2 });";

/** area of a w x d rectangle with corner radius r, inset by e on every side */
const area = (w: number, d: number, r: number, e = 0) => (w - 2 * e) * (d - 2 * e) - (r > e ? (4 - Math.PI) * (r - e) ** 2 : 0);
/** the hand estimate of the whole case: the hollow box, plus the tongue (a band tongueW wide centred in the wall) minus the groove (c wider each side, c deeper) */
function estimate(w: number, d: number, h: number, t: number, r: number, tongueH: number, tongueW: number, c: number) {
  const box = h * area(w, d, r) - (h - 2 * t) * area(w, d, r, t);
  const e0 = (t - tongueW) / 2;
  const tongue = tongueH * (area(w, d, r, e0) - area(w, d, r, e0 + tongueW));
  const groove = (tongueH + c) * (area(w, d, r, e0 - c) - area(w, d, r, e0 + tongueW + c));
  return { box, tongue, groove, total: box + tongue - groove };
}
const noOverlapAndGap = (o: Awaited<ReturnType<typeof run>>, c: number) => {
  expect(o.interference?.pairs).toEqual([]);   // the two bodies share no volume
  expect(o.gaps.length).toBeGreaterThan(0);
  expect(Math.min(...o.gaps)).toBeCloseTo(c, 6);   // the closest the bodies come, apart from where they touch on the rims, is the clearance: tongue to groove wall on both sides and to the groove floor
  expect(o.gaps.filter((d) => d < c + 0.05).length).toBeGreaterThan(2);
  expect(o.gaps.filter((d) => d < c - 1e-6)).toEqual([]);
};

describe('caseBox() in the kernel', () => {
  it('the default case by hand: 29 104 + 378 - 599.76 = 28 882.24 mm3, two valid bodies named Base and Lid, no overlap, a gap of the clearance', async () => {
    // by hand: the hollow box 80 x 50 x 30 less 76 x 46 x 26 is 120 000 - 90 896 = 29 104; the tongue is a band 1 mm wide centred in the 2 mm wall, between the outlines
    // 79 x 49 and 77 x 47: (3871 - 3619) x 1.5 = 252 x 1.5 = 378; the groove 1.4 wide and 1.7 deep, between 79.4 x 49.4 and 76.6 x 46.6... worked out as 78.6 x 48.6 less 77 x 47
    const e = estimate(80, 50, 30, 2, 0, 1.5, 1, 0.2);
    expect(e.box).toBe(29104);
    expect(e.tongue).toBeCloseTo(378, 9);
    expect(e.groove).toBeCloseTo(599.76, 9);
    const o = await run(GUIDE);
    expect(o.r.errors).toEqual([]);
    expect(o.valid).toBe(true);
    expect(o.bodies.map((b) => b.name).sort()).toEqual(['Base', 'Lid']);
    expect(Math.abs(o.total - 28882.24)).toBeLessThan(0.5);
    expect(o.vol('Lid')).toBeCloseTo(14552 + 378, 1);   // the tongue is on the lid by default
    expect(o.vol('Base')).toBeCloseTo(14552 - 599.76, 1);
    noOverlapAndGap(o, 0.2);
  }, T);

  it('tongue on the base moves the tongue to the other half; the total stays', async () => {
    const o = await run(GUIDE.replace('clearance: 0.2 }', "clearance: 0.2, tongueOn: 'base' }"));
    expect(o.valid).toBe(true);
    expect(o.bodies.map((b) => b.name).sort()).toEqual(['Base', 'Lid']);
    expect(Math.abs(o.total - 28882.24)).toBeLessThan(0.5);
    expect(o.vol('Base')).toBeCloseTo(14552 + 378, 1);
    expect(o.vol('Lid')).toBeCloseTo(14552 - 599.76, 1);
    noOverlapAndGap(o, 0.2);
  }, T);

  it('rounded corners (radius 5), tongue on either half: valid, volume within 1 mm3 of the formula (and so within 1%), no overlap, a gap of the clearance', async () => {
    for (const side of ['lid', 'base']) {
      const o = await run(`caseBox({ width: 80, depth: 50, height: 30, wall: 2, radius: 5, lidHeight: 15, tongueHeight: 1.5, tongueWidth: 1, tongueOn: '${side}' });`);
      expect(o.r.errors).toEqual([]);
      expect(o.valid).toBe(true);
      expect(o.bodies).toHaveLength(2);
      const e = estimate(80, 50, 30, 2, 5, 1.5, 1, 0.2);
      expect(Math.abs(o.total - e.total) / e.total).toBeLessThan(0.01);
      expect(Math.abs(o.total - e.total)).toBeLessThan(1);
      expect(Math.abs(o.vol(side === 'lid' ? 'Lid' : 'Base') - o.vol(side === 'lid' ? 'Base' : 'Lid') - (e.tongue + e.groove))).toBeLessThan(1);
      expect(o.total).toBeLessThan(28882.24);   // the corners take material away
      noOverlapAndGap(o, 0.2);
    }
  }, T);

  it('placed at an origin, with its own names, a lid taller than the base and a different wall: valid, the same formula', async () => {
    const o = await run("caseBox({ width: 60, depth: 40, height: 24, wall: 1.6, lidHeight: 14, tongueHeight: 1.2, tongueWidth: 0.8, clearance: 0.15, origin: [15, -20, 5], names: ['Tray', 'Cover'] });");
    expect(o.r.errors).toEqual([]);
    expect(o.valid).toBe(true);
    expect(o.bodies.map((b) => b.name).sort()).toEqual(['Cover', 'Tray']);
    const e = estimate(60, 40, 24, 1.6, 0, 1.2, 0.8, 0.15);
    expect(Math.abs(o.total - e.total)).toBeLessThan(0.5);
    noOverlapAndGap(o, 0.15);
  }, T);

  it('two cases at the same seam height next to another body: each leaves the others alone', async () => {
    const o = await run("part('Other').sketch('front', (s) => s.rect(20, 20, [300, 0])).extrude(10, { newBody: 'Other' });\n" + GUIDE + "\n" + GUIDE.replace('caseBox({', "caseBox({ origin: [120, 0, 0], names: ['Base 2', 'Lid 2'],"));
    expect(o.r.errors).toEqual([]);
    expect(o.valid).toBe(true);
    expect(o.bodies.map((b) => b.name).sort()).toEqual(['Base', 'Base 2', 'Lid', 'Lid 2', 'Other']);
    expect(o.vol('Other')).toBeCloseTo(4000, 3);
    expect(Math.abs(o.total - 2 * 28882.24 - 4000)).toBeLessThan(1);
  }, T);

  it("joint: 'lipJoint' keeps the centred tongue of the guide: 28 882.24 mm3, two valid bodies", async () => {
    const o = await run(GUIDE.replace('clearance: 0.2 }', "clearance: 0.2, joint: 'lipJoint' }"));
    expect(o.r.errors).toEqual([]);
    expect(o.valid).toBe(true);
    expect(o.bodies).toHaveLength(2);
    expect(Math.abs(o.total - 28882.24)).toBeLessThan(0.5);
  }, T);
});
