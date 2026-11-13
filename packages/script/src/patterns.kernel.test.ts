// linearPattern per-direction options (spacing / totalLength / to, a second direction in the same feature), pathPattern, and the
// kernel's pattern warnings carried into the run's warnings. Volumes are closed form.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { runScript, type ScriptHost } from './index';

const opened: Session[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map((s) => s.close().catch(() => {}))); });

async function rig() {
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); opened.push(s); return s; } };
  const controller = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  await controller.load(emptyPart('start'));
  const host: ScriptHost = {
    load: (d) => controller.load({ ...emptyPart('x'), ...d } as unknown as PartDoc),
    edit: async (ops, why) => (await controller.edit(ops, why)) as never,
    geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }),
    build: (d: Record<string, unknown>, v: boolean) => controller.scratchBuild(d as never, v) as never,
    release: () => controller.scratchRelease(),
    facts: (n: { mass?: boolean; validate?: boolean; describe?: string[] }) => controller.scratchFacts(n),
  };
  const volume = async () => ((await (opened.at(-1) as Session).massProps()) as { volume: number }).volume;
  return { host, volume };
}
const PI = Math.PI;
// 100 x 60 x 10 plate centred on the origin, a through hole of radius 2 at (-40, -20)
const PLATE = `part('P').sketch('front', (s) => s.rect(100, 60)).extrude(10).sketch(face('>Z'), (s) => s.circle(2, [-40, -20])).cut(through())`;
const HOLE = PI * 4 * 10;
const pattern = (doc: Record<string, unknown> | null, type: string) => ((doc?.features ?? []) as Array<Record<string, unknown>>).find((f) => f.type === type)!;

describe('linearPattern options on the kernel', () => {
  it('totalLength is the kernel extent; a second direction is one feature', async () => {
    const r = await rig();
    const res = await runScript(`${PLATE}.linearPattern({ count: 4, totalLength: 60, direction: 'x', second: { direction: 'y', count: 3, spacing: 15 } });`, r.host);
    expect(res.errors).toEqual([]);
    const f = pattern(res.document, 'lpattern');
    expect(f).toMatchObject({ distanceType: 'extent', extent: 60, count: 4, dir2: { kind: 'axis', axis: 'y' }, count2: 3, spacing2: 15 });
    expect(((res.document?.features ?? []) as unknown[]).filter((x) => (x as { type: string }).type === 'lpattern')).toHaveLength(1);
    expect(await r.volume()).toBeCloseTo(6000 * 10 - 12 * HOLE, 2);
    expect(res.warnings ?? []).toEqual([]);
  }, 120000);

  it('to a face with an offset, and to a point', async () => {
    const r = await rig();
    // the hole at x = -40 to the face at x = 50, 10 short: copies at -40, -20, 0, 20, 40
    let res = await runScript(`${PLATE}.linearPattern({ count: 5, to: face('>X'), toOffset: -10 });`, r.host);
    expect(res.errors).toEqual([]);
    expect(pattern(res.document, 'lpattern')).toMatchObject({ distanceType: 'toObject', to: { kind: 'face' }, toOffset: -10 });
    expect(await r.volume()).toBeCloseTo(6000 * 10 - 5 * HOLE, 2);
    const p = await rig();
    res = await runScript(`${PLATE}.linearPattern({ count: 3, to: [0, 0, 0], direction: 'x', second: { direction: 'y', count: 2, to: 'front' } });`, p.host);
    // the front plane runs along y: refused by the kernel with its code
    expect(res.errors[0]?.message).toMatch(/patternToObjectParallel/);
  }, 120000);

  it('refuses unclear options before the kernel', async () => {
    const r = await rig();
    let res = await runScript(`${PLATE}.linearPattern({ count: 3, spacing: 10, totalLength: 40 });`, r.host);
    expect(res.errors[0].message).toMatch(/one of spacing, totalLength or to/);
    res = await runScript(`${PLATE}.linearPattern({ count: 3, spacing: 10, toOffset: 2 });`, r.host);
    expect(res.errors[0].message).toMatch(/toOffset goes with to/);
  }, 120000);

  it('copies off the plate are named in the warnings', async () => {
    const r = await rig();
    const res = await runScript(`${PLATE}.linearPattern({ count: 8, spacing: 14 });`, r.host);
    expect(res.errors).toEqual([]);
    // copies at -40 + 14 k: k = 7 (x = 58) is off the 100 wide plate
    expect(await r.volume()).toBeCloseTo(6000 * 10 - 7 * HOLE, 2);
    expect((res.warnings ?? []).map((w) => w.message).join('\n')).toMatch(/patternCopiesNoEffect \(F\d+\): 1 of the 7 copies change nothing/);
  }, 120000);
});

describe('patterns about any direction or axis on the kernel', () => {
  it('a 30 degree direction vector, not unit length: closed-form volume, one vector feature', async () => {
    const r = await rig();
    // copies of the hole at (-40, -20) step (17.3205, 10): the last is at (11.96, 10), inside the plate
    const res = await runScript(`${PLATE}.linearPattern({ count: 4, spacing: 20, direction: [Math.sqrt(3), 1, 0] });`, r.host);
    expect(res.errors).toEqual([]);
    expect(pattern(res.document, 'lpattern')).toMatchObject({ dir: { kind: 'vector' }, count: 4 });
    expect(await r.volume()).toBeCloseTo(6000 * 10 - 4 * HOLE, 2);
    expect(res.warnings ?? []).toEqual([]);
  }, 120000);

  it('an axis through (20, 0) parallel to z: six holes of a bolt circle off the origin', async () => {
    const r = await rig();
    const res = await runScript(`part('B').sketch('front', (s) => s.rect(100, 100)).extrude(10).sketch(face('>Z'), (s) => s.circle(2, [35, 0])).cut(through())
  .circularPattern({ count: 6, axis: { point: [20, 0, 0], dir: [0, 0, 1] } });`, r.host);
    expect(res.errors).toEqual([]);
    expect(pattern(res.document, 'cpattern')).toMatchObject({ axis: { kind: 'axis', point: [20, 0, 0], dir: [0, 0, 1] }, count: 6 });
    // ring of radius 15 round (20, 0): all inside the plate and apart from each other
    expect(await r.volume()).toBeCloseTo(10000 * 10 - 6 * HOLE, 2);
    expect(res.warnings ?? []).toEqual([]);
  }, 120000);

  it('an edge as the axis: holes turn about the vertical edge of a boss', async () => {
    const r = await rig();
    const res = await runScript(`const p = part('B').sketch('front', (s) => s.rect(100, 100)).extrude(10).sketch(face('>Z'), (s) => s.circle(2, [40, 20])).cut(through());
const hole = p.handle();
p.sketch(face('>Z'), (s) => s.rect(20, 20)).extrude(10);
p.circularPattern(hole, { count: 4, axis: edges({ parallel: 'Z', near: [10, 10, 15], within: 1 }) });`, r.host);
    expect(res.errors).toEqual([]);
    expect(pattern(res.document, 'cpattern')).toMatchObject({ axis: { kind: 'edge' }, count: 4 });
    // (40, 20) turned about (10, 10) by 90 degree steps: (0, 40), (-20, 0), (20, -20): all outside the boss, inside the plate
    expect(await r.volume()).toBeCloseTo(10000 * 10 + 400 * 10 - 4 * HOLE, 2);
  }, 120000);
});

describe('pathPattern on the kernel', () => {
  it('holes along an L-shaped path, spread first to last', async () => {
    const r = await rig();
    // path from the hole at (-40, -20) along x to (40, -20) then up to (40, 20): 120 long, 7 copies 20 apart
    const res = await runScript(`${PLATE}.pathPattern({ path: { on: 'front', draw: (s) => s.polyline([[-40, -20], [40, -20], [40, 20]]) }, count: 7, totalLength: 120 });`, r.host);
    expect(res.errors).toEqual([]);
    expect(pattern(res.document, 'curvepattern')).toMatchObject({ count: 7, distanceType: 'extent', extent: 120, path: { kind: 'sketch' } });
    expect(await r.volume()).toBeCloseTo(6000 * 10 - 7 * HOLE, 2);
  }, 120000);

  it('a last copy past the path end is refused with the largest spacing that fits', async () => {
    const r = await rig();
    const res = await runScript(`${PLATE}.pathPattern({ path: { on: 'front', draw: (s) => s.line([-40, -20], [40, -20]) }, count: 5, spacing: 25 });`, r.host);
    expect(res.errors[0]?.message).toMatch(/patternBeyondPath/);
    expect(res.errors[0]?.message).toMatch(/at most 20 mm/);
  }, 120000);

  it('checks its options', async () => {
    const r = await rig();
    const res = await runScript(`${PLATE}.pathPattern({ path: { on: 'front', draw: (s) => s.line([-40, -20], [40, -20]) }, count: 3, spacing: 10, orientation: 'sideways' });`, r.host);
    expect(res.errors[0].message).toMatch(/orientation is 'fixed' or 'tangent'/);
  }, 120000);
});
