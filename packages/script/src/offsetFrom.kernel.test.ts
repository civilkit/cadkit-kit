import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { runScript, type ScriptHost } from './index';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function run(code: string) {
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  await controller.load(emptyPart('x') as never);
  const h: ScriptHost = {
    load: (d) => controller.load({ ...emptyPart('x'), ...d } as unknown as PartDoc),
    edit: (ops, why) => controller.edit(ops, why) as never,
    geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }),
    build: (d, v) => controller.scratchBuild(d as never, v) as never, release: () => controller.scratchRelease(), facts: (n) => controller.scratchFacts(n),
  };
  return runScript(code, h);
}

// sketch.offset: a parallel copy of the chain drawn last (geometry of the GUI Offset tool)
describe('sketch.offset', () => {
  it('an open chain offsets to the LEFT of its direction of travel for a positive distance', async () => {
    // east-going line, copy 3 above it (y up on the front plane), closed by two short lines: a 20 x 3 bar
    const r = await run(`part('Bar').sketch('front', (s) => { s.line([0, 0], [20, 0]); s.offset(3); s.polyline([[20, 0], [20, 3]]); s.polyline([[0, 3], [0, 0]]); }).extrude(4)
      .expectVolume(240, { tol: 1e-6 }).expectBBox({ min: [0, 0, 0], max: [20, 3, 4] }, { tol: 1e-6 });`);
    expect(r.errors.map((e) => e.message)).toEqual([]);
    const right = await run(`part('Bar').sketch('front', (s) => { s.line([0, 0], [20, 0]); s.offset(-3); s.polyline([[20, 0], [20, -3]]); s.polyline([[0, -3], [0, 0]]); }).extrude(4)
      .expectVolume(240, { tol: 1e-6 }).expectBBox({ min: [0, -3, 0], max: [20, 0, 4] }, { tol: 1e-6 });`);
    expect(right.errors.map((e) => e.message)).toEqual([]);
  }, 120_000);
  it('a closed loop offsets outward for a positive distance, whichever way it was drawn (mitred corners)', async () => {
    for (const pts of ['[[0, 0], [20, 0], [20, 10], [0, 10]]', '[[0, 0], [0, 10], [20, 10], [20, 0]]']) {
      const r = await run(`part('Frame').sketch('front', (s) => { s.polygon(${pts}); s.offset(2); }).extrude(5).expectVolume(${(24 * 14 - 20 * 10) * 5}, { tol: 1e-6 });`);
      expect(r.errors.map((e) => e.message)).toEqual([]);
    }
  }, 120_000);
  it('keep: false replaces the chain: a loop shrunk inside the same sketch is one smaller rectangle', async () => {
    const r = await run(`part('Small').sketch('front', (s) => { s.rect(20, 10); s.offset(-2, { keep: false }); }).extrude(5).expectVolume(${16 * 6 * 5}, { tol: 1e-6 });`);
    expect(r.errors.map((e) => e.message)).toEqual([]);
  }, 120_000);
  it('a circle: outward positive, inward negative', async () => {
    const out = await run(`part('Ring').sketch('front', (s) => { s.circle(10); s.offset(2); }).extrude(3).expectVolume(${Math.PI * (144 - 100) * 3}, { tol: 1e-6 });`);
    expect(out.errors.map((e) => e.message)).toEqual([]);
    const inn = await run(`part('Ring').sketch('front', (s) => { s.circle(10); s.offset(-3); }).extrude(3).expectVolume(${Math.PI * (100 - 49) * 3}, { tol: 1e-6 });`);
    expect(inn.errors.map((e) => e.message)).toEqual([]);
  }, 120_000);
  it('the direction of travel is the one the chain was drawn in, however the kit would walk it', async () => {
    // an L drawn from its top end down and then east: walking south, left is east (+x); walking east, left is north (+y)
    const r = await run(`part('L').sketch('front', (s) => { s.polyline([[0, 10], [0, 0], [10, 0]]); s.offset(2); s.polyline([[2, 10], [0, 10]]); s.polyline([[10, 2], [10, 0]]); }).extrude(3)
      .expectVolume(${(10 * 2 + 8 * 2) * 3}, { tol: 1e-6 }).expectBBox({ min: [0, 0, 0], max: [10, 10, 3] }, { tol: 1e-6 });`);
    expect(r.errors.map((e) => e.message)).toEqual([]);
  }, 120_000);
  it('lines and an arc: a quarter ring from the arc and its offset (left of a counter-clockwise arc is inside)', async () => {
    const r = await run(`part('Quarter').sketch('front', (s) => { s.arc3([10, 0], [Math.SQRT1_2 * 10, Math.SQRT1_2 * 10], [0, 10]); s.offset(2); s.polyline([[10, 0], [8, 0]]); s.polyline([[0, 8], [0, 10]]); }).extrude(2)
      .expectVolume(${Math.PI / 4 * (100 - 64) * 2}, { tol: 1e-4 });`);
    expect(r.errors.map((e) => e.message)).toEqual([]);
  }, 120_000);
  it('a chain of lines and an arc keeps its corners: wall of a cup profile offset inwards', async () => {
    // bottom, a corner arc r 5 and a wall, offset 1 to the left (inside): the ring between them revolved is the wall
    const r = await run(`part('Cup').sketch('front', (s) => { s.polyline([[0, 0], [15, 0]]); s.arc3([15, 0], [15 + 5 * Math.SQRT1_2, 5 - 5 * Math.SQRT1_2], [20, 5]); s.polyline([[20, 5], [20, 30]]); s.offset(1, { keep: false }); s.polyline([[19, 30], [0, 30]]); s.polyline([[0, 30], [0, 1]]); }).revolve(360, { axis: { from: [0, 0], to: [0, 1] } }).expectValid();`);
    expect(r.errors.map((e) => e.message)).toEqual([]);
  }, 120_000);
  it('a closed spline offsets outward', async () => {
    const pts = Array.from({ length: 8 }, (_, i) => `[${(10 * Math.cos(i * Math.PI / 4)).toFixed(6)}, ${(10 * Math.sin(i * Math.PI / 4)).toFixed(6)}]`).join(', ');
    const r = await run(`part('Ring').sketch('front', (s) => { s.spline([${pts}], { closed: true }); s.offset(2); }).extrude(3).expectBBox({ min: [-12, -12, 0], max: [12, 12, 3] }, { tol: 0.1 });`);
    expect(r.errors.map((e) => e.message)).toEqual([]);
  }, 120_000);
  it('says what is wrong: nothing drawn, a distance that collapses the shape, zero', async () => {
    const none = await run(`part('X').sketch('front', (s) => { s.offset(1); }).extrude(1);`);
    expect(none.errors.map((e) => e.message).join('\n')).toMatch(/nothing is drawn yet/);
    const big = await run(`part('X').sketch('front', (s) => { s.circle(2); s.offset(-5); }).extrude(1);`);
    expect(big.errors.map((e) => e.message).join('\n')).toMatch(/offset: .*too large|larger than the shape allows/);
    const zero = await run(`part('X').sketch('front', (s) => { s.circle(2); s.offset(0); }).extrude(1);`);
    expect(zero.errors.map((e) => e.message).join('\n')).toMatch(/offset: the distance is zero/);
  }, 120_000);
});

// body targets of a cut: from: 'Name' | [names] on cut / revolve / loft / sweep (kernel `target`)
describe('cut from named bodies', () => {
  const two = `part('Two').sketch('front', (s) => s.rect(40, 40)).extrude(10, { newBody: 'A' })
      .sketch('front', (s) => s.rect(40, 40, [50, 0])).extrude(10, { newBody: 'B' })`;
  it('cut() with from changes only the named body', async () => {
    // a 50 x 10 bar across both boxes (A x -20..20, B x 30..70): 2000 of A (x 0..20) and 2000 of B (x 30..50)
    const cutter = `.sketch('front', (s) => s.rect(50, 10, [25, 0]))`;
    const all = await run(`${two}${cutter}.cut(10, { direction: 'away' }).expectVolume(${32000 - 4000}, { tol: 1e-3 });`);
    expect(all.errors.map((e) => e.message)).toEqual([]);
    const onlyA = await run(`${two}${cutter}.cut(10, { direction: 'away', from: 'A' }).expectVolume(${32000 - 2000}, { tol: 1e-3 });`);
    expect(onlyA.errors.map((e) => e.message)).toEqual([]);
    const both = await run(`${two}${cutter}.cut(10, { direction: 'away', from: ['A', 'B'] }).expectVolume(${32000 - 4000}, { tol: 1e-3 });`);
    expect(both.errors.map((e) => e.message)).toEqual([]);
  }, 120_000);
  it('an unknown body name is an error that lists the bodies that exist', async () => {
    const r = await run(`${two}.sketch('front', (s) => s.rect(50, 10, [25, 0])).cut(10, { direction: 'away', from: 'Cupp' });`);
    const text = JSON.stringify(r.errors);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(text).toMatch(/Cupp/);
    expect(text).toMatch(/the bodies in the part: A, B/);
  }, 120_000);
  it('from on an add, an empty list or a blank name is refused before the build', async () => {
    const add = await run(`part('X').sketch('front', (s) => s.rect(4, 4)).extrude(3, { from: 'A' });`);
    expect(add.errors.map((e) => e.message).join('\n')).toMatch(/from applies to a cut/);
    const empty = await run(`part('X').sketch('front', (s) => s.rect(4, 4)).extrude(3, { newBody: 'A' }).sketch('front', (s) => s.rect(2, 2)).cut(1, { from: [] });`);
    expect(empty.errors.map((e) => e.message).join('\n')).toMatch(/from is a body name or a list/);
  }, 120_000);
  it('revolve cut with from', async () => {
    // a ring r 3..6 about the vertical axis x = 50 (inside B only), z 0..10: from: 'B' cuts it; naming A finds nothing to cut
    const ring = `.sketch('top', (s) => s.polygon([[53, 0], [56, 0], [56, -10], [53, -10]]))`;
    const r = await run(`${two}${ring}.revolve(360, { op: 'cut', from: 'B', axis: { from: [50, 0], to: [50, -1] } }).expectVolume(${32000 - Math.PI * 27 * 10}, { tol: 1e-3 });`);
    expect(r.errors.map((e) => e.message)).toEqual([]);
  }, 120_000);
});
