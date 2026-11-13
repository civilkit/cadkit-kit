import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { MID_PLANE_CUT_WARNING, runScript, type ScriptHost } from './index';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function host() {
  const store = createStore();
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  const h: ScriptHost = {
    load: (d) => controller.load({ ...emptyPart('x'), ...d } as unknown as PartDoc),
    edit: (ops, why) => controller.edit(ops, why) as never,
    geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }),
  };
  const volume = async () => ((await sessions.at(-1)!.massProps()) as { volume: number }).volume;
  return { h, volume, controller };
}
/** Run a script on a fresh kernel: errors, volume, validity and the box of the body. */
async function run(code: string) {
  const { h, volume, controller } = await host();
  const r = await runScript(code, h);
  const ok = r.errors.length === 0;
  const v = ok ? await volume().catch(() => NaN) : NaN;   // a surface body has no volume
  const valid = ok ? (((await sessions.at(-1)!.validate().catch(() => ({ ok: false }))) as { ok: boolean }).ok) : false;
  return { r, v, valid, box: controller.bodyBox()!, names: (controller.bodyFaces()?.faceIds ?? []) as string[] };
}
const PI = Math.PI;
const T = 60000;
const features = (r: { document: Record<string, unknown> | null }) => (r.document?.features ?? []) as Array<Record<string, unknown>>;

describe('loft', () => {
  it('circle to a point is an exact cone (3 faces, no cap at the apex)', async () => {
    const o = await run(`part('Cone').loft([
  { on: 'front', draw: (s) => s.circle(10) },
  { on: at('front', 30), point: [0, 0] },
], { ends: { last: 'point' } });`);
    expect(o.r.errors).toEqual([]);
    expect(o.valid).toBe(true);
    expect(o.v).toBeCloseTo(PI * 100 * 30 / 3, 3);
    expect(o.names.length).toBe(3);
    expect(o.box.max[2]).toBeCloseTo(30, 6);
  }, T);
  it('square to a smaller square is a frustum', async () => {
    const o = await run(`part('Frustum').loft([
  { on: 'front', draw: (s) => s.rect(20, 20) },
  { on: at('front', 30), draw: (s) => s.rect(10, 10) },
]);`);
    expect(o.r.errors).toEqual([]);
    expect(o.valid).toBe(true);
    expect(o.v).toBeCloseTo(10 * (400 + 100 + 200), 3);
  }, T);
  it('a hull through four stations with a point bow is a valid solid', async () => {
    const st = [[-60, 6, 5, 3], [-35, 15, 9, 4], [0, 18, 12, 5], [30, 13, 9, 5.5]];
    const o = await run(`const st = ${JSON.stringify(st)};
part('Hull').loft([
  ...st.map(([x, hb, depth, deck]) => ({ on: at('right', x), draw: (s) => s.arc3([-hb, deck], [0, -depth], [hb, deck]).line([hb, deck], [-hb, deck]) })),
  { on: at('right', 62), point: [0, 0] },
], { ends: { last: 'point' } });`);
    expect(o.r.errors).toEqual([]);
    expect(o.valid).toBe(true);
    expect(o.box.min[0]).toBeCloseTo(-60, 3);
    expect(o.box.max[0]).toBeCloseTo(62, 3);
    expect(o.v).toBeGreaterThan(25000);
    expect(o.v).toBeLessThan(122 * 36 * 17);
  }, T);
  it('rejects a middle point, two points and a wrong ends flag with the script line', async () => {
    for (const [code, msg] of [
      [`part('A').loft([{ on: 'front', draw: (s) => s.circle(5) }, { on: at('front', 5), point: [0, 0] }, { on: at('front', 10), draw: (s) => s.circle(5) }]);`, /first or the last/],
      [`part('A').loft([{ on: 'front', point: [0, 0] }, { on: at('front', 5), point: [0, 0] }]);`, /cannot both/],
      [`part('A').loft([{ on: 'front', draw: (s) => s.circle(5) }, { on: at('front', 5), point: [0, 0] }], { ends: { last: 'cap' } });`, /'cap'/],
      [`part('A').loft([{ on: 'front', draw: (s) => s.circle(5) }]);`, /at least two/],
    ] as const) {
      const { h } = await host();
      const r = await runScript(code, h);
      expect(r.errors[0]?.message).toMatch(msg);
      expect(r.errors[0]?.line).toBe(1);
    }
  }, T);
  it('a straight centre line and a straight guide leave the volume of the plain loft', async () => {
    const sq = `[{ on: 'front', draw: (s) => s.rect(20, 20) }, { on: at('front', 30), draw: (s) => s.rect(10, 10) }]`;
    const a = await run(`part('C').loft(${sq}, { centre: { on: 'right', draw: (s) => s.line([0, 0], [-30, 0]) } });`);
    expect(a.r.errors).toEqual([]);
    expect(a.v).toBeCloseTo(7000, 2);
    // a straight guide along the middle of one side (top plane: sketch x is X, sketch y is -Z)
    const g = await run(`part('G').loft(${sq}, { guides: [{ on: 'top', draw: (s) => s.line([10, 0], [5, -30]) }] });`);
    expect(g.r.errors).toEqual([]);
    expect(g.valid).toBe(true);
    expect(g.v).toBeCloseTo(7000, 2);
    expect(features(g.r).at(-1)).toMatchObject({ type: 'loft', guides: [{ sketch: 'F4' }] });
  }, T);
});

describe('sweep', () => {
  it('a tube profile (two circles) along a straight path', async () => {
    const o = await run(`part('Pipe').sweep({ on: 'front', draw: (s) => { s.circle(5); s.circle(4); } }, { on: 'right', draw: (s) => s.polyline([[0, 0], [40, 0]]) });`);
    expect(o.r.errors).toEqual([]);
    expect(o.valid).toBe(true);
    expect(o.v).toBeCloseTo(PI * (25 - 16) * 40, 3);
  }, T);
  it('a bent path (two lines) keeps the volume near area x length', async () => {
    const o = await run(`part('Elbow').sweep({ on: 'front', draw: (s) => s.circle(5) }, { on: 'right', draw: (s) => s.polyline([[0, 0], [40, 0], [60, 20]]) });`);
    expect(o.r.errors).toEqual([]);
    expect(o.valid).toBe(true);
    const len = 40 + Math.hypot(20, 20);
    expect(Math.abs(o.v / (PI * 25 * len) - 1)).toBeLessThan(0.04);
  }, T);
  it('twist turns a square profile without changing the volume', async () => {
    const o = await run(`part('Twist').sweep({ on: 'front', draw: (s) => s.rect(10, 10) }, { on: 'right', draw: (s) => s.polyline([[0, 0], [40, 0]]) }, { twist: 90 });`);
    expect(o.r.errors).toEqual([]);
    expect(o.valid).toBe(true);
    expect(o.v).toBeCloseTo(100 * 40, 1);
  }, T);
});

describe('mirror, rib, gear', () => {
  it('mirror body doubles a block about the right plane', async () => {
    const o = await run(`part('M').sketch('front', (s) => s.polygon([[0, 0], [30, 0], [30, 10], [0, 10]])).extrude(8).mirror('right', { body: true });`);
    expect(o.r.errors).toEqual([]);
    expect(o.v).toBeCloseTo(60 * 10 * 8, 3);
    expect(o.box.min[0]).toBeCloseTo(-30, 6);
  }, T);
  it('mirror of the last feature copies only that boss', async () => {
    const o = await run(`part('M').sketch('front', (s) => s.rect(20, 20)).extrude(5).sketch(face('>Z'), (s) => s.circle(3, [6, 0])).extrude(5).mirror('right');`);
    expect(o.r.errors).toEqual([]);
    expect(o.v).toBeCloseTo(2000 + 2 * PI * 9 * 5, 2);
  }, T);
  it('mirror refuses keepOriginal: false', async () => {
    const { h } = await host();
    const r = await runScript(`part('M').sketch('front', (s) => s.rect(20, 20)).extrude(5).mirror('right', { keepOriginal: false });`, h);
    expect(r.errors[0]?.message).toMatch(/keeps the original/);
  }, T);
  it('rib fills the inside corner of an L: adds thickness x triangle area', async () => {
    const base = 6 * 50 * 40 + 34 * 6 * 40;
    const o = await run(`part('Gusset').sketch('front', (s) => s.polygon([[0, 0], [50, 0], [50, 6], [6, 6], [6, 40], [0, 40]])).extrude(40)
  .sketch(at('front', 20), (s) => s.line([6, 26], [26, 6])).rib(3);`);
    expect(o.r.errors).toEqual([]);
    expect(o.valid).toBe(true);
    expect(o.v).toBeCloseTo(base + 3 * 200, 2);
  }, T);
  it('rib side, draft and fillet: volumes against the hand estimate (right triangle of legs 20, 3 thick)', async () => {
    const L = `part('Gusset').sketch('front', (s) => s.polygon([[0, 0], [50, 0], [50, 6], [6, 6], [6, 40], [0, 40]])).extrude(40)
  .sketch(at('front', 20), (s) => s.line([6, 26], [26, 6]))`;
    const base = 6 * 50 * 40 + 34 * 6 * 40 + 3 * 200;
    const right = await run(`${L}.rib(3, { side: 'right' });`);
    expect(right.r.errors).toEqual([]);
    expect(right.valid).toBe(true);
    expect(right.v).toBeCloseTo(base, 2);
    // thickness 3 at the free edge, 2 tan(draft) wider per mm toward the body: the moment of the triangle about its hypotenuse is area * height / 3
    const hyp = 20 * Math.SQRT2, moment = 200 * (2 * 200 / hyp) / 3;
    const drafted = await run(`${L}.rib(3, { draft: 3 });`);
    expect(drafted.r.errors).toEqual([]);
    expect(drafted.valid).toBe(true);
    expect(drafted.v).toBeCloseTo(base + 2 * Math.tan(3 * PI / 180) * moment, 0);
    // two rounds of radius r along the free edge: (1 - pi/4) r^2 each per mm, less the ends the two faces clip (cot 45 + cot 45 per mm of depth)
    const r = 0.5, ac = (1 - PI / 4) * r * r, m = r ** 3 * (5 / 6 - PI / 4);
    const rounded = await run(`${L}.rib(3, { fillet: 0.5 });`);
    expect(rounded.r.errors).toEqual([]);
    expect(rounded.valid).toBe(true);
    expect(rounded.v).toBeCloseTo(base - 2 * (hyp * ac - 2 * m), 1);
  }, T);
  it('rib target names the body it grows to', async () => {
    const o = await run(`part('Two').sketch('front', (s) => s.polygon([[0, 0], [50, 0], [50, 6], [6, 6], [6, 40], [0, 40]])).extrude(40, { newBody: 'Gusset' })
  .sketch('front', (s) => s.rect(10, 10, [200, 5])).extrude(10, { newBody: 'Other' })
  .sketch(at('front', 20), (s) => s.line([6, 26], [26, 6])).rib(3, { target: 'Gusset' });`);
    expect(o.r.errors).toEqual([]);
    expect(o.valid).toBe(true);
    expect(o.v).toBeCloseTo(6 * 50 * 40 + 34 * 6 * 40 + 3 * 200 + 1000, 1);
    const miss = await run(`part('Two').sketch('front', (s) => s.polygon([[0, 0], [50, 0], [50, 6], [6, 6], [6, 40], [0, 40]])).extrude(40, { newBody: 'Gusset' })
  .sketch('front', (s) => s.rect(10, 10, [200, 5])).extrude(10, { newBody: 'Other' })
  .sketch(at('front', 20), (s) => s.line([6, 26], [26, 6])).rib(3, { target: 'Other' });`);
    expect(miss.r.errors.some((e) => /ribNoContact/.test(e.message))).toBe(true);
  }, T);
  it('the clevis rib gives the same part before or after the bore, and takes the new settings', async () => {
    const head = `part('Clevis')
  .sketch('top', (s) => s.rrect(140, 90, 8)).extrude(12)
  .holes.points(face('>Y'), [[-55, -30], [55, -30], [-55, 30], [55, 30]], { diameter: 10 })
  .sketch('front', (s) => s.rect(30, 79, [15, 45.5])).extrude(60, { mid: true })
  .sketch('front', (s) => s.circle(25, [15, 85])).extrude(60, { mid: true })`;
    const rib = (opts = '') => `.sketch('front', (s) => s.line([-50, 12], [-5, 70])).rib(15${opts})`;
    const bore = `.sketch('front', (s) => s.circle(15, [15, 85])).cut(through(), { direction: 'both' })`;
    const before = await run(`${head}${rib()}${bore};`);
    const after = await run(`${head}${bore}${rib()};`);
    for (const o of [before, after]) { expect(o.r.errors).toEqual([]); expect(o.valid).toBe(true); expect(o.v).toBeCloseTo(335157, 0); }
    const tuned = await run(`${head}${bore}${rib(', { fillet: 3, draft: 2 }')};`);
    expect(tuned.r.errors).toEqual([]);
    expect(tuned.valid).toBe(true);
    expect(tuned.v).toBeGreaterThan(335157 - 300);
    expect(tuned.v).toBeLessThan(335157 + 1500);
  }, T);
  it('a through cut from the mid-plane with no direction cuts one half and warns; direction both cuts all and does not', async () => {
    const body = `part('B').sketch('front', (s) => s.rect(60, 40)).extrude(20, { mid: true })`;
    const half = await run(`${body}.sketch('front', (s) => s.circle(5)).cut(through());`);
    expect(half.r.errors).toEqual([]);
    expect((half.r.warnings ?? []).map((w) => w.message)).toEqual([MID_PLANE_CUT_WARNING]);
    expect(half.v).toBeCloseTo(60 * 40 * 20 - PI * 25 * 10, 1);   // the result is unchanged: one half of the bore
    const all = await run(`${body}.sketch('front', (s) => s.circle(5)).cut(through(), { direction: 'both' });`);
    expect(all.r.warnings ?? []).toEqual([]);
    expect(all.v).toBeCloseTo(60 * 40 * 20 - PI * 25 * 20, 1);
  }, T);
  it('a rib in open air reports ribNoContact on its line', async () => {
    const o = await run(`part('R').sketch('front', (s) => s.rect(40, 30)).extrude(10).sketch(at('front', 30), (s) => s.line([-5, 0], [5, 0])).rib(2);`);
    expect(o.r.errors.some((e) => /ribNoContact/.test(e.message))).toBe(true);
  }, T);
  it('gear: valid, between root and tip circle volume, outside diameter module x (teeth + 2)', async () => {
    const o = await run(`part('Gear').gear({ module: 2, teeth: 20, thickness: 8, bore: 6 });`);
    expect(o.r.errors).toEqual([]);
    expect(o.valid).toBe(true);
    expect(o.box.max[0]).toBeCloseTo(22, 0);
    expect(o.v).toBeGreaterThan(PI * 17.5 ** 2 * 8 - PI * 9 * 8);
    expect(o.v).toBeLessThan(PI * 22 ** 2 * 8 - PI * 9 * 8);
    expect(o.box.max[2]).toBeCloseTo(8, 6);
  }, T);
});

describe('holes', () => {
  const plate = `part('Plate').sketch('front', (s) => s.rect(60, 40)).extrude(12)`;
  const V0 = 60 * 40 * 12;
  it('counterbore: cylinder + counterbore cylinder minus the overlap', async () => {
    const o = await run(`${plate}.hole(face('>Z'), [0, 0], { kind: 'cbore', diameter: 6.6, cboreDiameter: 11, cboreDepth: 6 });`);
    expect(o.r.errors).toEqual([]);
    expect(o.valid).toBe(true);
    const d = 6.6, D = 11, cb = 6;
    expect(o.v).toBeCloseTo(V0 - (PI * (d / 2) ** 2 * 12 + PI * (D / 2) ** 2 * cb - PI * (d / 2) ** 2 * cb), 2);
  }, T);
  it('counterbore by ISO size takes the table dimensions', async () => {
    const o = await run(`${plate}.hole(face('>Z'), [0, 0], { kind: 'cbore', size: 'M6' });`);
    expect(o.r.errors).toEqual([]);
    expect(o.v).toBeCloseTo(V0 - (PI * 3.3 ** 2 * 12 + PI * (5.5 ** 2 - 3.3 ** 2) * 6.4), 1);
  }, T);
  it('countersink: hole cylinder plus the cone above it', async () => {
    const o = await run(`${plate}.hole(face('>Z'), [0, 0], { kind: 'csk', size: 'M6', cskDiameter: 12, cskAngle: 90 });`);
    expect(o.r.errors).toEqual([]);
    expect(o.valid).toBe(true);
    const r = 3.3, R = 6, h = R - r;   // 90 degrees included: depth = (R - r) / tan(45)
    const cone = (PI * h / 3) * (R * R + R * r + r * r);
    expect(o.v).toBeCloseTo(V0 - (PI * r * r * (12 - h) + cone), 1);
  }, T);
  it('a counterbore needs both dimensions or a standard size', async () => {
    for (const [opts, msg] of [
      ["{ kind: 'cbore', diameter: 6.6, cboreDiameter: 11 }", /together/],
      ["{ kind: 'cbore', diameter: 7.3 }", /standard size/],
      ["{ kind: 'drill', diameter: 5 }", /kind must be/],
      ['{ depth: 3 }', /diameter/],
    ] as const) {
      const { h } = await host();
      const r = await runScript(`${plate}.hole(face('>Z'), [0, 0], ${opts});`, h);
      expect(r.errors[0]?.message, opts).toMatch(msg);
    }
  }, T);
  it('tapped hole: tap-drill diameter and a thread feature on the wall', async () => {
    const { h, volume } = await host();
    const r = await runScript(`${plate}.hole(face('>Z'), [0, 0], { kind: 'tapped', thread: 'M6', depth: 8 });`, h);
    expect(r.errors).toEqual([]);
    expect(await volume()).toBeCloseTo(V0 - PI * 2.5 ** 2 * 8, 2);
    const th = features(r).find((f) => f.type === 'thread')!;
    expect(th).toMatchObject({ size: 'M6', standard: 'metric', face: 'F4.S.h1', modeled: false });
  }, T);
  it('holes.grid with counterbores: one feature, four counterbores', async () => {
    const o = await run(`${plate}.holes.grid(face('>Z'), { origin: [-10, -10], pitch: [20, 20], count: [2, 2] }, { kind: 'cbore', size: 'M5', end: 'blind', depth: 9 });`);
    expect(o.r.errors).toEqual([]);
    expect(o.valid).toBe(true);
    const d = 2.75, D = 5, cb = 5.4;
    expect(o.v).toBeCloseTo(V0 - 4 * (PI * d * d * 9 + PI * (D * D - d * d) * cb), 0);
  }, T);
  it('holes.polar tapped: a thread per hole on the ~k walls', async () => {
    const { h, volume } = await host();
    const r = await runScript(`${plate}.holes.polar(face('>Z'), { center: [0, 0], radius: 15, count: 3 }, { kind: 'tapped', thread: 'M6', depth: 8 });`, h);
    expect(r.errors).toEqual([]);
    expect(await volume()).toBeCloseTo(V0 - 3 * PI * 2.5 ** 2 * 8, 2);
    expect(features(r).filter((f) => f.type === 'thread').map((f) => f.face)).toEqual(['F4.S.h1~1', 'F4.S.h1~2', 'F4.S.h1~3']);
  }, T);
  it('thread() on the last hole, and modeled: true cuts the groove', async () => {
    const cos = await run(`${plate}.hole(face('>Z'), [0, 0], { diameter: 5, depth: 8 }).thread('hole', { size: 'M6', length: 6 });`);
    expect(cos.r.errors).toEqual([]);
    expect(cos.v).toBeCloseTo(V0 - PI * 2.5 ** 2 * 8, 2);
    const mod = await run(`${plate}.hole(face('>Z'), [0, 0], { kind: 'tapped', thread: { size: 'M6', modeled: true }, depth: 8 });`);
    expect(mod.r.errors).toEqual([]);
    expect(mod.valid).toBe(true);
    // the groove removes material beyond the tap-drill bore (the cosmetic thread removes nothing more)
    expect(mod.v).toBeLessThan(cos.v - 5);
    expect(mod.v).toBeGreaterThan(cos.v - PI * (3 ** 2 - 2.5 ** 2) * 8);
  }, 120000);
});

describe('sketch splines', () => {
  it('spline and cvspline record the entity JSON and extrude closed', async () => {
    const a = await run(`part('S').sketch('front', (s) => s.spline([[0, 0], [20, 10], [30, 30], [10, 40], [-10, 20]], { closed: true })).extrude(6);`);
    expect(a.r.errors).toEqual([]);
    expect(a.valid).toBe(true);
    const sp = (features(a.r)[0].entities as Array<Record<string, unknown>>)[0];
    expect(sp).toMatchObject({ type: 'spline', closed: true });
    expect((sp.pts as string[]).length).toBe(5);
    expect(a.v).toBeGreaterThan(0);
    const b = await run(`part('S').sketch('front', (s) => s.cvspline([[0, 0], [30, 0], [40, 20], [20, 40], [-10, 30]], { closed: true })).extrude(6);`);
    expect(b.r.errors).toEqual([]);
    expect(b.valid).toBe(true);
    expect((features(b.r)[0].entities as Array<Record<string, unknown>>)[0]).toMatchObject({ type: 'cvspline', degree: 3, closed: true });
  }, T);
  it('an interpolating spline through a circle of points has about the circle area', async () => {
    const pts = Array.from({ length: 12 }, (_, i) => [+(20 * Math.cos(i * PI / 6)).toFixed(4), +(20 * Math.sin(i * PI / 6)).toFixed(4)]);
    const o = await run(`part('S').sketch('front', (s) => s.spline(${JSON.stringify(pts)}, { closed: true })).extrude(5);`);
    expect(o.r.errors).toEqual([]);
    expect(Math.abs(o.v / (PI * 400 * 5) - 1)).toBeLessThan(0.01);
  }, T);
  it('rejects too few points', async () => {
    const { h } = await host();
    const r = await runScript(`part('S').sketch('front', (s) => s.spline([[0, 0]]));`, h);
    expect(r.errors[0]?.message).toMatch(/at least/);
  }, T);
});

describe('surfaces', () => {
  it('three sheets knit to a solid box', async () => {
    const o = await run(`part('Box from sheets')
  .sketch('front', (s) => s.rect(20, 20)).surfaceExtrude(10)
  .sketch('front', (s) => s.rect(20, 20)).surfacePlanar()
  .sketch(at('front', 10), (s) => s.rect(20, 20)).surfacePlanar()
  .knit({ solid: true });`);
    expect(o.r.errors).toEqual([]);
    expect(o.valid).toBe(true);
    expect(o.v).toBeCloseTo(4000, 3);
  }, T);
  it('thicken an extruded arc sheet: annular sector area x length', async () => {
    const o = await run(`part('W').sketch('front', (s) => s.arc3([-20, 0], [0, 10], [20, 0])).surfaceExtrude(30).thicken(2);`);
    expect(o.r.errors).toEqual([]);
    expect(o.valid).toBe(true);
    const R = 25, th = 2 * Math.asin(20 / R);
    expect(o.v).toBeCloseTo(0.5 * th * ((R + 2) ** 2 - R ** 2) * 30, 1);
  }, T);
  it('surfaceLoft makes a sheet; thicken before any surface is an error', async () => {
    const o = await run(`part('P').surfaceLoft([{ on: 'front', draw: (s) => s.arc3([-20, 0], [0, 6], [20, 0]) }, { on: at('front', 30), draw: (s) => s.arc3([-20, 0], [0, 12], [20, 0]) }]);`);
    expect(o.r.errors).toEqual([]);
    expect(features(o.r).map((f) => f.type)).toEqual(['sketch', 'plane', 'sketch', 'loft']);
    expect(features(o.r).at(-1)).toMatchObject({ type: 'loft', surface: true });
    const { h } = await host();
    const r = await runScript(`part('P').sketch('front', (s) => s.rect(5, 5)).extrude(2).thicken(1);`, h);
    expect(r.errors[0]?.message).toMatch(/needs a surface/);
  }, T);
});

describe('raw features and assemblies', () => {
  it('feature() resolves face handles: shell with the top open', async () => {
    const o = await run(`part('Cup').sketch('front', (s) => s.rect(40, 40)).extrude(20).feature({ type: 'shell', faces: [face('>Z')], thickness: 2 });`);
    expect(o.r.errors).toEqual([]);
    expect(o.v).toBeCloseTo(40 * 40 * 20 - 36 * 36 * 18, 2);
    expect(features(o.r).at(-1)).toMatchObject({ type: 'shell', id: 'F3', thickness: 2 });
  }, T);
  it('feature() resolves edges() and the $sketch / $last placeholders', async () => {
    const o = await run(`part('B').sketch('front', (s) => s.rect(40, 40)).extrude(20).feature({ type: 'fillet', radius: 3, edges: edges('|Z') });`);
    expect(o.r.errors).toEqual([]);
    expect(o.v).toBeCloseTo((1600 - 4 * (1 - PI / 4) * 9) * 20, 2);
    const p = await run(`part('X').sketch('front', (s) => s.rect(10, 10)).feature({ type: 'extrude', op: 'add', sketch: '$sketch', end: 'blind', depth: 5 }).feature({ type: 'mirror', seeds: ['$last'], plane: { kind: 'std', id: 'right' }, body: true });`);
    expect(p.r.errors).toEqual([]);
    expect(p.v).toBeCloseTo(500, 2);
  }, T);
  it('feature() rejects unknown types and non-objects with the line', async () => {
    const { h } = await host();
    const r = await runScript(`part('X')\n  .feature({ type: 'teleport' });`, h);
    expect(r.errors[0]?.message).toMatch(/unknown type "teleport"/);
    expect(r.errors[0]?.line).toBe(2);
    const r2 = await runScript(`part('X').feature({ type: 'sketch' });`, h);
    expect(r2.errors[0]?.message).toMatch(/sketchFeature/);
  }, T);
  it('sketchFeature(): a raw triangle sketch extrudes', async () => {
    const o = await run(`part('Tri').sketchFeature('front', { points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 20, y: 0 }, { id: 'c', x: 0, y: 20 }], entities: [{ id: 'e1', type: 'line', p1: 'a', p2: 'b' }, { id: 'e2', type: 'line', p1: 'b', p2: 'c' }, { id: 'e3', type: 'line', p1: 'c', p2: 'a' }] }).extrude(5);`);
    expect(o.r.errors).toEqual([]);
    expect(o.v).toBeCloseTo(1000, 3);
  }, T);
  it('insertPart twice and mate the facing plates: the mated component moves down onto the fixed one', async () => {
    const a = await host();
    const plate = (await runScript(`part('Plate').sketch('front', (s) => s.rect(20, 20)).extrude(5)`, a.h)).document!;
    const b = await host();
    const r = await runScript(`const plate = ${JSON.stringify(plate)};
part('Asm').insertPart(plate, { fixed: true }).insertPart(plate, { at: [0, 0, 30] })
  .mate({ kind: 'coincident', a: { part: 1, face: 'F2.C1' }, b: { part: 2, face: 'F2.C0' } });`, b.h);
    expect(r.errors).toEqual([]);
    expect(b.controller.bodyBox()!.max[2]).toBeCloseTo(10, 3);
    expect(features(r).map((f) => f.type)).toEqual(['insertPart', 'insertPart', 'mate']);
    expect(features(r)[2]).toMatchObject({ a: 'F2.C1@F1.1', b: 'F2.C0@F2.1' });
  }, T);
});
