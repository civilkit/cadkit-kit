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
  const m = ok ? ((await s.massProps({ bodies: true })) as { volume: number; bodies?: Array<{ name?: string; volume: number; com?: number[] }> }) : null;
  const valid = ok ? (((await s.validate().catch(() => ({ ok: false }))) as { ok: boolean }).ok) : false;
  const interference = ok ? await queryInterference(s) : null;
  const gaps = ok ? await (s as unknown as { clearance(o: object): Promise<{ pairs: Array<{ distance: number; kind: string }> }> }).clearance({ min: 0.45, include: 'gap', limit: 500 }) : null;
  const mesh = ok ? await s.bodyForView() : null;
  const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  const pos = (mesh?.mesh.positions ?? []) as ArrayLike<number>;
  for (let i = 0; i < pos.length; i++) { const k = i % 3; box.min[k] = Math.min(box.min[k], pos[i]); box.max[k] = Math.max(box.max[k], pos[i]); }
  const vol = (name: string) => m?.bodies?.find((b) => b.name === name)?.volume ?? NaN;
  return { r, total: m?.volume ?? NaN, bodies: m?.bodies ?? [], box, vol, valid, interference, gaps: (gaps?.pairs ?? []).filter((p) => p.kind === 'gap').map((p) => p.distance) };
}
const T = 300000;
const span = (o: Awaited<ReturnType<typeof run>>) => o.box;   // the box of both halves together, from the mesh
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
/** What a top round of radius r takes off one cup: the removed profile (r x r square less the quarter disc, area (1 - pi/4) r2) swept round the outline by Pappus, along its centroid path
 *  (the centroid is c = r (5/6 - pi/4) / (1 - pi/4) in from both outer faces): a sharp outline mitres, a rounded one (radius R >= r) is arcs of radius R - c. Both cups lose the same. */
function topRound(w: number, d: number, R: number, r: number): number {
  if (!(r > 0)) return 0;
  const c = r * (5 / 6 - Math.PI / 4) / (1 - Math.PI / 4);
  const path = R > 0 ? 2 * (w - 2 * R) + 2 * (d - 2 * R) + 2 * Math.PI * (R - c) : 2 * (w + d) - 8 * c;
  return (1 - Math.PI / 4) * r * r * path;
}
const noOverlapAndGap = (o: Awaited<ReturnType<typeof run>>, c: number) => {
  expect(o.interference?.pairs).toEqual([]);   // the two bodies share no volume
  expect(o.gaps.length).toBeGreaterThan(0);
  expect(Math.min(...o.gaps)).toBeCloseTo(c, 6);   // the closest the bodies come, apart from where they touch on the rims, is the clearance: tongue to groove wall on both sides and to the groove floor
  expect(o.gaps.filter((d) => d < c + 0.05).length).toBeGreaterThan(2);
  expect(o.gaps.filter((d) => d < c - 1e-6)).toEqual([]);
};

describe('caseBox() in the kernel', () => {
  it('stands on the Top plane by default: floor at y = 0, lid on top at y = height, x and z centred on the origin; axis z keeps the old orientation along +z; the volume is the same', async () => {
    for (const [extra, min, max] of [['', [-40, 0, -25], [40, 30, 25]], [", axis: 'y'", [-40, 0, -25], [40, 30, 25]], [", axis: 'z'", [-40, -25, 0], [40, 25, 30]], [", origin: [10, 5, -7]", [-30, 5, -32], [50, 35, 18]], [", axis: 'z', origin: [10, 5, -7]", [-30, -20, -7], [50, 30, 23]]] as Array<[string, number[], number[]]>) {
      const o = await run(GUIDE.replace('clearance: 0.2 }', `clearance: 0.2${extra} }`));
      expect(o.r.errors, extra).toEqual([]);
      expect(o.valid).toBe(true);
      expect(Math.abs(o.total - 28882.24)).toBeLessThan(0.5);
      const b = span(o);
      for (let k = 0; k < 3; k++) { expect(b.min[k], `${extra} min ${k}`).toBeCloseTo(min[k], 3); expect(b.max[k], `${extra} max ${k}`).toBeCloseTo(max[k], 3); }
      noOverlapAndGap(o, 0.2);
    }
  }, 5 * T);

  it('the lid is the upper half: it ends at the top, the base starts at the floor (y by default)', async () => {
    const o = await run(GUIDE);
    const com = (n: string) => o.bodies.find((b) => b.name === n)!.com!;
    expect(com('Base')[1]).toBeLessThan(15);   // the open cup: its mass is the floor, low in the lower half
    expect(com('Lid')[1]).toBeGreaterThan(15);   // the lid: closed at the top, in the upper half
    expect(com('Lid')[1]).toBeLessThan(30);
    for (const n of ['Base', 'Lid']) { expect(com(n)[0]).toBeCloseTo(0, 3); expect(com(n)[2]).toBeCloseTo(0, 3); }
    expect(o.box.min[1]).toBeCloseTo(0, 3);
    expect(o.box.max[1]).toBeCloseTo(30, 3);
  }, T);

  it('round the edges on each axis: side corners and the top round (picked by the cap names) give the same volume and the box as the formula, on y and on z', async () => {
    for (const axis of ['y', 'z']) {
      for (const side of ['lid', 'base']) {
        const o = await run(`caseBox({ width: 80, depth: 50, height: 30, wall: 2, radius: 6, topRadius: 3, lidHeight: 15, tongueHeight: 1.5, tongueWidth: 1, tongueOn: '${side}', axis: '${axis}' });`);
        expect(o.r.errors, `${axis} ${side}`).toEqual([]);
        expect(o.valid).toBe(true);
        const e = estimate(80, 50, 30, 2, 6, 1.5, 1, 0.2).total - 2 * topRound(80, 50, 6, 3);
        expect(Math.abs(o.total - e), `${axis} ${side}: ${o.total} vs ${e}`).toBeLessThan(1.5);
        const b = span(o), up = axis === 'y' ? 1 : 2, deep = axis === 'y' ? 2 : 1;
        expect(b.min[up]).toBeCloseTo(0, 3);
        expect(b.max[up]).toBeCloseTo(30, 3);
        expect(b.max[0]).toBeCloseTo(40, 3);
        expect(b.max[deep]).toBeCloseTo(25, 3);
        noOverlapAndGap(o, 0.2);
      }
    }
  }, 5 * T);

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

  it('top edges: the round takes (1 - pi/4) r2 x the centroid path off each cup, for a sharp and a rounded outline, tongue on either half: valid, within 1.5 mm3 (and 0.5%), no overlap, the gap stays the clearance', async () => {
    for (const [R, r, side, wall] of [[0, 2, 'lid', 2], [0, 4, 'base', 2], [6, 3, 'lid', 2], [6, 4.4, 'base', 2], [10, 4.4, 'lid', 2], [6, 6, 'lid', 3]] as Array<[number, number, string, number]>) {
      const B = `width: 80, depth: 50, height: 30, wall: ${wall}, lidHeight: 15, tongueHeight: 1.5, tongueWidth: 1`;
      const o = await run(`caseBox({ ${B}, radius: ${R}, topRadius: ${r}, tongueOn: '${side}' });`);
      expect(o.r.errors, `R ${R} r ${r}`).toEqual([]);
      expect(o.valid).toBe(true);
      expect(o.bodies.map((b) => b.name).sort()).toEqual(['Base', 'Lid']);
      const e = estimate(80, 50, 30, wall, R, 1.5, 1, 0.2).total - 2 * topRound(80, 50, R, r);
      expect(Math.abs(o.total - e), `R ${R} r ${r}: ${o.total} vs ${e}`).toBeLessThan(1.5);
      expect(Math.abs(o.total - e) / e).toBeLessThan(0.005);
      noOverlapAndGap(o, 0.2);
    }
  }, 5 * T);

  it('top edges only take the outside: each half loses the same volume as the side-only case, and the 4 mm round on a 2 mm wall (wall left at the round 1.17 mm) does not break through: the volumes are the formula', async () => {
    const B = 'width: 80, depth: 50, height: 30, wall: 2, lidHeight: 15, tongueHeight: 1.5, tongueWidth: 1';
    const plain = await run(`caseBox({ ${B} });`);
    const o = await run(`caseBox({ ${B}, topRadius: 4 });`);
    expect(o.r.errors).toEqual([]);
    const cut = topRound(80, 50, 0, 4);
    expect(plain.vol('Lid') - o.vol('Lid')).toBeCloseTo(cut, 0);
    expect(plain.vol('Base') - o.vol('Base')).toBeCloseTo(cut, 0);
    expect(o.valid).toBe(true);
  }, 2 * T);
});
