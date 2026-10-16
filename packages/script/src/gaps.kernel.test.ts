import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { plane, runScript, type ScriptHost } from './index';

const opened: Session[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map((s) => s.close().catch(() => {}))); });

async function rig(build = true) {
  const base = await Session.open(emptyPart('base'));
  opened.push(base);
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); opened.push(s); return s; } };
  const controller = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  await controller.load(emptyPart('start'));
  const host: ScriptHost = {
    load: (d) => controller.load({ ...emptyPart('x'), ...d } as unknown as PartDoc),
    edit: async (ops, why) => (await controller.edit(ops, why)) as never,
    geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }),
    ...(build ? { build: (d: Record<string, unknown>, v: boolean) => controller.scratchBuild(d as never, v) as never, release: () => controller.scratchRelease(), facts: (n: { mass?: boolean; validate?: boolean; describe?: string[] }) => controller.scratchFacts(n) } : {}),
  };
  // the volume of what the app ended up with
  const volume = async () => ((await (opened.at(-1) as Session).massProps()) as { volume: number }).volume;
  return { host, volume, controller };
}
const PI = Math.PI;

describe('script gaps on the kernel', () => {
  it('selects the boss top vs the plate top, with a warning only when it is ambiguous', async () => {
    const r = await rig();
    const code = `const p = part('B').sketch('front', (s) => s.rect(60, 40)).extrude(10);
const base = p.handle();
p.sketch(face('>Z'), (s) => s.circle(12)).extrude(15);
const boss = p.handle();
p.hole(face('>Z'), [0, 0], { diameter: 6 });
p.hole(face('>Z', { of: base }), [25, 0], { diameter: 5, depth: 4 });
p.fillet(edges({ createdBy: boss, onFace: face('>Z', { of: boss }) }), 0.5);
`;
    const res = await runScript(code, r.host);
    expect(res.errors).toEqual([]);
    const w = res.warnings ?? [];
    expect(w).toHaveLength(1);
    expect(w[0].line).toBe(5);   // the hole on face('>Z') (first use after the boss)
    expect(w[0].message).toMatch(/resolved to F\d+\.\w+ \(feature F\d+/);
    expect(w[0].message).toMatch(/\{of: \.\.\.\}/);
  }, 120000);

  it('selects faces by feature, name, kind, radius and pick', async () => {
    const r = await rig();
    const code = `const p = part('B').sketch('front', (s) => s.rect(60, 40)).extrude(10)
  .sketch(face('>Z'), (s) => s.circle(12)).extrude(15);
const boss = p.handle();
p.hole(face('>Z', { of: boss }), [0, 0], { diameter: 6 });
const fs = await p.faces();
const cyl12 = fs.filter((f) => f.kind === 'cylinder' && Math.abs(f.radius - 12) < 1e-3);
const bore = fs.filter((f) => f.kind === 'cylinder' && Math.abs(f.radius - 3) < 1e-3);
if (cyl12.length !== 1 || bore.length !== 1) throw new Error('cylinders: ' + JSON.stringify(fs.map((f) => [f.name, f.kind, f.radius])));
p.sketch(faces({ kind: 'cylinder', radius: 12 }).nth(0), (s) => s.rect(1, 1));    // a sketch on a curved face is refused by the kernel only at build
`;
    // the cylinder sketch is not meaningful: only test selection by building the checks without it
    const res = await runScript(code.replace(/p\.sketch\(faces[^\n]*\n/, ''), r.host);
    expect(res.errors).toEqual([]);
    // rules
    const code2 = `const p = part('B').sketch('front', (s) => s.rect(60, 40)).extrude(10)
  .sketch(face('>Z'), (s) => s.circle(12)).extrude(15);
const boss = p.handle();
p.sketch(face({ normal: [0, 0, 1], at: [0, 0, 25] }), (s) => s.circle(2)).cut(5)
 .sketch(faces({ createdBy: boss, planar: true }).largest(), (s) => s.circle(1, [6, 0])).cut(5)
 .sketch(faces('>Z').smallest(), (s) => s.circle(1, [3, 3])).cut(2)
 .sketch(faces({ areaGreater: 1000, normal: [0, 0, 1] }).near([20, 10, 10]), (s) => s.circle(1, [20, 10])).cut(1)
 .expectValid();
`;
    const r2 = await rig();
    const res2 = await runScript(code2, r2.host);
    expect(res2.errors).toEqual([]);
    // name selection and ambiguity errors
    const r3 = await rig();
    const bad = await runScript(`part('B').sketch('front', (s) => s.rect(60, 40)).extrude(10)
  .sketch(face({ kind: 'plane' }), (s) => s.circle(2)).cut(2);`, r3.host);
    expect(bad.errors[0].message).toMatch(/matches 6 faces/);
    expect(bad.errors[0].line).toBe(2);
    const r4 = await rig();
    const named = await runScript(`part('B').sketch('front', (s) => s.rect(60, 40)).extrude(10).sketch(face('F2.C1'), (s) => s.circle(2)).cut(2);`, r4.host);
    expect(named.errors).toEqual([]);
    const missing = await runScript(`part('B').sketch('front', (s) => s.rect(60, 40)).extrude(10).sketch(face('F2.C7'), (s) => s.circle(2)).cut(2);`, (await rig()).host);
    expect(missing.errors[0].message).toMatch(/no such face/);
  }, 240000);

  it('flips a cut that finds nothing, or takes an explicit direction (batched and per-step)', async () => {
    const code = `part('C').sketch('front', (s) => s.rect(40, 30)).extrude(10).sketch('front', (s) => s.circle(5)).cut(4);`;
    const expected = 40 * 30 * 10 - PI * 25 * 4;
    for (const build of [true, false]) {
      const r = await rig(build);
      const res = await runScript(code, r.host);
      expect(res.errors, `build=${build}`).toEqual([]);
      expect((res.warnings ?? []).map((w) => w.message)).toEqual(['cut direction flipped automatically']);
      expect(await r.volume()).toBeCloseTo(expected, 1);
    }
    const r = await rig();
    const res = await runScript(`part('C').sketch('front', (s) => s.rect(40, 30)).extrude(10).sketch('front', (s) => s.circle(5)).cut(4, { direction: 'away' });`, r.host);
    expect(res.errors).toEqual([]);
    expect(res.warnings ?? []).toEqual([]);
    expect(await r.volume()).toBeCloseTo(expected, 1);
    // symmetric: depth is the total, half each side of the sketch plane at z = 10 (top face)
    const r2 = await rig();
    const res2 = await runScript(`part('C').sketch('front', (s) => s.rect(40, 30)).extrude(10).sketch(at('front', 10), (s) => s.circle(5)).cut(6, { direction: 'both' });`, r2.host);
    expect(res2.errors).toEqual([]);
    expect(await r2.volume()).toBeCloseTo(40 * 30 * 10 - PI * 25 * 3, 1);
    // an extrude 'into' the sketch plane goes the other way
    const bb = await runScript(`const p = part('E').sketch('front', (s) => s.rect(20, 20)).extrude(5, { direction: 'into' }).expectBBox({ min: [-10, -10, -5], max: [10, 10, 0] });`, (await rig()).host);
    expect(bb.errors).toEqual([]);
  }, 240000);

  it('documents the sketch plane frames as the kernel reports them', async () => {
    expect(plane('top').y).toEqual([0, 0, -1]);
    expect(plane('right').x).toEqual([0, 0, -1]);
    expect(plane('top').toWorld([5, 10], 20)).toEqual([5, 20, -10]);
    const r = await rig();
    // sketch y = -world z on top; x = -world z on right
    const res = await runScript(`part('F').sketch('top', (s) => s.circle(1, [5, 10])).extrude(2).expectBBox({ min: [4, 0, -11], max: [6, 2, -9] })
  .sketch('right', (s) => s.circle(1, [10, 7])).extrude(2).expectBBox({ min: [4, 0, -11], max: [6, 8, -9] }, { tol: 1e-3 });`, r.host);
    // the second expectation is checked on the union: only the first is exact; the second must report a failure on its own line
    expect(res.errors.map((e) => e.line)).toEqual([2]);
  }, 120000);

  it('reads results back mid-script and checks them against analytic values', async () => {
    const r = await rig();
    const res = await runScript(`const p = part('Plate').sketch('front', (s) => s.rect(60, 40)).extrude(10).hole(face('>Z'), [0, 0], { diameter: 8 });
const v = await p.volume();
const a = await p.area();
const b = await p.bbox();
const c = await p.centreOfMass();
const n = await p.faceCount();
const e = await p.edgeCount();
const ok = await p.isValid();
const fs = await p.faces();
const bore = fs.find((f) => f.kind === 'cylinder' && Math.abs(f.radius - 4) < 1e-3);
globalThis_out = 0;
p.expectVolume(60 * 40 * 10 - Math.PI * 16 * 10, { tol: 1e-6 });
if (Math.abs(v - (24000 - Math.PI * 160)) > 1e-3) throw new Error('volume ' + v);
if (Math.abs(a - (2 * 2400 + 2 * 10 * 100 - 2 * Math.PI * 16 + 2 * Math.PI * 4 * 10)) > 1e-3) throw new Error('area ' + a);
if (Math.abs(b.size[0] - 60) > 1e-6 || Math.abs(b.size[2] - 10) > 1e-6) throw new Error('bbox ' + JSON.stringify(b));
if (Math.abs(c[2] - 5) > 1e-6) throw new Error('com ' + c);
if (n !== 7 || ok !== true) throw new Error('faces ' + n + ' valid ' + ok);
if (!bore || Math.abs(bore.area - 2 * Math.PI * 4 * 10) > 1e-2 || Math.abs(bore.radius - 4) > 1e-3) throw new Error('bore ' + JSON.stringify(bore));
if (e < 12) throw new Error('edges ' + e);
`.replace('globalThis_out = 0;\n', ''), r.host);
    expect(res.errors).toEqual([]);
    expect(await r.volume()).toBeCloseTo(24000 - PI * 160, 3);
  }, 120000);

  it('reports a failed expectation with its line and keeps going', async () => {
    const r = await rig();
    const res = await runScript(`part('Block')
  .sketch('front', (s) => s.rect(40, 30))
  .extrude(20)
  .expectVolume(25000, { tol: 1e-6 })
  .expectValid()
  .expectFaceCount(7);`, r.host);
    expect(res.errors.map((e) => e.line)).toEqual([4, 6]);
    expect(res.errors[0].message).toMatch(/expected volume 25000.*got 24000/);
    expect(res.errors[1].message).toMatch(/expected 7 faces, got 6/);
    // the same through the per-step path
    const r2 = await rig(false);
    r2.host.facts = async () => ({ volume: 24000, valid: true, issues: [] });
    const res2 = await runScript(`part('Block').sketch('front', (s) => s.rect(40, 30)).extrude(20)
  .expectVolume(25000, { tol: 1e-6 });`, r2.host);
    expect(res2.errors.map((e) => e.line)).toEqual([2]);
  }, 120000);

  it('patterns: a circular pattern of 6 holes, a 2D grid, several seeds, a pattern of a pattern', async () => {
    const r = await rig();
    let res = await runScript(`part('Disc').sketch('front', (s) => s.circle(40)).extrude(5)
  .sketch(face('>Z'), (s) => s.circle(2, [30, 0])).cut(through())
  .circularPattern({ count: 6, axis: 'z' });`, r.host);
    expect(res.errors).toEqual([]);
    expect(await r.volume()).toBeCloseTo(PI * 1600 * 5 - 6 * PI * 4 * 5, 2);
    const g = await rig();
    res = await runScript(`part('Grid').sketch('front', (s) => s.rect(80, 60)).extrude(10)
  .sketch(face('>Z'), (s) => s.circle(3, [-30, -20])).cut(through())
  .linearPattern({ count: 4, spacing: 20, direction: 'x', second: { direction: 'y', count: 3, totalLength: 40 } });`, g.host);
    expect(res.errors).toEqual([]);
    expect(await g.volume()).toBeCloseTo(4800 * 10 - 12 * PI * 9 * 10, 2);
    // two seeds patterned together, direction as a vector, reverse sign
    const m = await rig();
    res = await runScript(`const p = part('Two').sketch('front', (s) => s.rect(80, 60)).extrude(10)
  .sketch(face('>Z'), (s) => s.circle(2, [-30, -20])).cut(through());
const a = p.handle();
p.sketch(face('>Z'), (s) => s.circle(1, [-30, 20])).cut(through());
const b = p.handle();
p.linearPattern([a, b], { count: 3, spacing: 10, direction: [1, 0, 0] });`, m.host);
    expect(res.errors).toEqual([]);
    expect(await m.volume()).toBeCloseTo(4800 * 10 - 3 * PI * 4 * 10 - 3 * PI * 1 * 10, 2);
    // a direction given by a straight edge, symmetric cut
    const eg = await rig();
    res = await runScript(`part('E').sketch('front', (s) => s.rect(80, 60)).extrude(10).sketch(face('>Z'), (s) => s.circle(2, [-30, 0])).cut(through())
  .linearPattern({ count: 3, spacing: 25, direction: edges({ parallel: 'X', onFace: face('<Z'), near: [0, -30, 0], within: 1 }) });`, eg.host);
    expect(res.errors).toEqual([]);
    expect(await eg.volume()).toBeCloseTo(4800 * 10 - 3 * PI * 4 * 10, 2);
    // oblique directions and offset axes are refused with a clear message
    const o = await rig();
    res = await runScript(`part('X').sketch('front', (s) => s.rect(80, 60)).extrude(10).sketch(face('>Z'), (s) => s.circle(2)).cut(through()).linearPattern({ count: 3, spacing: 5, direction: [1, 1, 0] });`, o.host);
    expect(res.errors[0].message).toMatch(/world x, y or z axis only/);
    res = await runScript(`part('X').sketch('front', (s) => s.rect(80, 60)).extrude(10).sketch(face('>Z'), (s) => s.circle(2, [5, 0])).cut(through()).circularPattern({ count: 3, axis: [3, 0, 0, 0, 0, 1] });`, (await rig()).host);
    expect(res.errors[0].message).toMatch(/through the origin/);
  }, 240000);

  it('fillets with a radius per edge match separate fillets; a variable radius builds; chamfer variants are emitted', async () => {
    const BOX = `const p = part('Block').sketch('front', (s) => s.rect(40, 30)).extrude(20);`;
    const per = await rig();
    const res = await runScript(`${BOX}
const es = (await p.edges()).filter((e) => e.faces.length === 2);
const vertical = (await p.edges()).filter((e) => Math.abs(e.mid[2] - 10) < 1e-6);
const radius = {};
for (const e of vertical) radius[e.key] = e.mid[0] < 0 ? 2 : 3;
p.fillet(edges('|Z'), { radius });`, per.host);
    expect(res.errors).toEqual([]);
    const vPer = await per.volume();
    expect(vPer).toBeCloseTo(40 * 30 * 20 - 20 * (1 - PI / 4) * (2 * 4 + 2 * 9), 2);
    const ref = await rig();
    const res2 = await runScript(`${BOX}
p.fillet(edges({ parallel: 'Z', inside: [[-100, -100, -100], [0, 100, 100]] }), 2).fillet(edges({ parallel: 'Z', outside: [[-100, -100, -100], [0, 100, 100]] }), 3);`, ref.host);
    expect(res2.errors).toEqual([]);
    expect(vPer).toBeCloseTo(await ref.volume(), 6);
    const arr = await rig();
    const res3 = await runScript(`${BOX}
p.fillet(edges({ parallel: 'X', onFace: face('>Z'), near: [0, -15, 20], within: 1 }), { variable: [1, 3] }).expectValid();`, arr.host);
    expect(res3.errors).toEqual([]);
    const ch = await rig();
    const res4 = await runScript(`${BOX}
p.chamfer(edges('|Z'), { distance: 2, distance2: 1 });`, ch.host);
    expect(res4.errors[0].message).toMatch(/unsupported|chamfer/i);   // the kernel has only the equal-distance chamfer
  }, 240000);

  it('workplanes from a face, a point and normal, and a rotated plane', async () => {
    const f = await rig();
    let res = await runScript(`part('A').sketch('front', (s) => s.rect(40, 30)).extrude(20)
  .sketch(at(face('>Z'), -5), (s) => s.circle(5)).extrude(10).expectBBox({ max: [20, 15, 25] });`, f.host);
    expect(res.errors).toEqual([]);
    expect(await f.volume()).toBeCloseTo(40 * 30 * 20 + PI * 25 * 5, 1);
    const n = await rig();
    res = await runScript(`part('B').sketch('front', (s) => s.rect(40, 30)).extrude(20)
  .sketch(at({ origin: [0, 0, 30], normal: [0, 0, 1] }), (s) => s.circle(5)).extrude(2).expectBBox({ max: [20, 15, 32] });`, n.host);
    expect(res.errors).toEqual([]);
    const ob = await rig();
    res = await runScript(`part('C').sketch('front', (s) => s.rect(40, 30)).extrude(20)
  .sketch(at({ origin: [0, 0, 25], normal: [0, 1, 1] }), (s) => s.circle(5)).extrude(2);`, ob.host);
    expect(res.errors).toEqual([]);
    const rot = await rig();
    res = await runScript(`part('D').sketch('front', (s) => s.rect(40, 30)).extrude(20)
  .sketch(at('front', 20, { rotate: { axis: 'x', angle: 30 } }), (s) => s.rect(10, 10)).extrude(5);`, rot.host);
    expect(res.errors).toEqual([]);
    // the mid plane of two faces
    const mid = await rig();
    res = await runScript(`part('M').sketch('front', (s) => s.rect(40, 30)).extrude(20)
  .sketch(at({ between: [face('<Z'), face('>Z')] }), (s) => s.circle(5)).extrude(2).expectBBox({ max: [20, 15, 20] });`, mid.host);
    expect(res.errors).toEqual([]);
    expect(await mid.volume()).toBeCloseTo(40 * 30 * 20, 1);   // the disc lies inside the block: nothing added
    const wp = await rig();
    res = await runScript(`const p = part('E').sketch('front', (s) => s.rect(40, 30)).extrude(20);
p.workplane(face('>Z'), 4);
const wpl = p.handle();
p.sketch(at(wpl, 1), (s) => s.circle(3)).extrude(2).expectBBox({ max: [20, 15, 27] });`, wp.host);
    expect(res.errors).toEqual([]);
  }, 240000);
});
