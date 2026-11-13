// Pattern options against the real kernel: a linear pattern To object (a plane, then a face) and with a second direction, the warning
// the tree shows for copies off the body, and Pattern on path made by its command (the newest open sketch, spread over its length).
// Volumes are closed form. Needs CK_WASM.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from './controller';
import { pathPatternOps } from './featureCreators';
import type { Ctx } from './featureCommands';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

// 100 x 100 x 10 plate, a through hole of diameter 4 at (10, 10), a plane P9 at x = 80
const rect = (id: string, plane: unknown, x0: number, y0: number, x1: number, y1: number) => ({
  type: 'sketch', id, plane,
  points: [{ id: 'a', x: x0, y: y0 }, { id: 'b', x: x1, y: y0 }, { id: 'c', x: x1, y: y1 }, { id: 'd', x: x0, y: y1 }],
  entities: [{ type: 'line', id: 'e1', p1: 'a', p2: 'b' }, { type: 'line', id: 'e2', p1: 'b', p2: 'c' }, { type: 'line', id: 'e3', p1: 'c', p2: 'd' }, { type: 'line', id: 'e4', p1: 'd', p2: 'a' }],
  constraints: [],
});
const base = (): PartDoc => ({
  format: 'ck-part', version: 1, name: 'plate', seq: 10, rollback: null,
  features: [
    rect('F1', { kind: 'std', id: 'front' }, 0, 0, 100, 100),
    { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 10 },
    { type: 'plane', id: 'F3', mode: 'offset', base: { kind: 'std', id: 'front' }, offset: 10 },
    { type: 'sketch', id: 'F4', plane: { kind: 'feature', id: 'F3' }, points: [{ id: 'p', x: 10, y: 10 }], entities: [{ type: 'point', id: 'e1', p: 'p' }], constraints: [] },
    { type: 'hole', id: 'F5', sketch: 'F4', kind: 'simple', diameter: 4, end: 'through' },
    { type: 'plane', id: 'F6', mode: 'offset', base: { kind: 'std', id: 'right' }, offset: 80 },
  ],
} as unknown as PartDoc);
const HOLE = Math.PI * 4 * 10;
const vol = (n: number) => 100 * 100 * 10 - n * HOLE;

async function world(doc: PartDoc) {
  const store = createStore();
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  await controller.load(doc);
  const volume = async () => ((await (sessions.at(-1) as Session).massProps()) as { volume: number }).volume;
  return { store, controller, volume };
}

describe('pattern options with the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('To object follows the plane; a second direction makes a grid', async () => {
    const w = await world(base());
    const lp = { type: 'lpattern', id: 'F7', seeds: ['F5'], dir: { kind: 'axis', axis: 'x' }, count: 4, distanceType: 'toObject', to: { kind: 'feature', id: 'F6' } };
    expect((await w.controller.commit([{ op: 'add', feature: lp as never }])).ok).toBe(true);
    expect(await w.volume()).toBeCloseTo(vol(4), 4);
    expect(w.store.featureWarnings.value).toEqual({});
    // the plane moves to x = 40: still 4 holes, closer together (the last at x = 40)
    expect((await w.controller.commit([{ op: 'set', id: 'F6', path: 'offset', value: 40 }])).ok).toBe(true);
    expect(await w.volume()).toBeCloseTo(vol(4), 4);
    // the plate's side face, 10 short; 3 rows along y over 40
    expect((await w.controller.commit([{ op: 'replace', id: 'F7', feature: { ...lp, count: 5, to: { kind: 'face', id: 'F2.S.e2' }, toOffset: -10, dir2: { kind: 'axis', axis: 'y' }, count2: 3, distanceType2: 'extent', extent2: 40 } as never }])).ok).toBe(true);
    expect(await w.volume()).toBeCloseTo(vol(15), 4);
  }, 180000);

  it('what the editor writes for a direction vector and for an axis point builds', async () => {
    const w = await world(base());
    const commit = async (f: Record<string, unknown>, id = 'F7') => expect((await w.controller.commit([{ op: 'add', feature: { id, ...f } as never }])).ok).toBe(true);
    // a direction vector at 45 degrees: 3 holes (10, 10), (24.1, 24.1), (38.3, 38.3)
    await commit({ type: 'lpattern', seeds: ['F5'], dir: { kind: 'vector', dir: [1, 1, 0] }, count: 3, spacing: 20 });
    expect(await w.volume()).toBeCloseTo(vol(3), 4);
    // the hole turned 4 times about the Z axis through (50, 50): the corners (10, 10), (90, 10), (90, 90), (10, 90)
    expect((await w.controller.commit([{ op: 'remove', id: 'F7' }])).ok).toBe(true);
    await commit({ type: 'cpattern', seeds: ['F5'], axis: { kind: 'axis', point: [50, 50, 0], dir: [0, 0, 1] }, count: 4, angle: 360, equal: true });
    expect(await w.volume()).toBeCloseTo(vol(4), 4);
  }, 180000);

  it('copies off the plate show as a warning on the pattern', async () => {
    const w = await world(base());
    expect((await w.controller.commit([{ op: 'add', feature: { type: 'lpattern', id: 'F7', seeds: ['F5'], dir: { kind: 'axis', axis: 'x' }, count: 12, spacing: 9.5 } as never }])).ok).toBe(true);
    expect(await w.volume()).toBeCloseTo(vol(10), 4);
    const warn = w.store.featureWarnings.value.F7;
    expect(warn?.code).toBe('patternCopiesNoEffect');
    expect(warn?.params?.copies).toEqual([10, 11]);
    expect(warn?.hint).toMatch(/2 of the 11 copies change nothing/);
  }, 180000);

  it('Pattern on path: the command spreads 3 copies over the newest open sketch; past the end is refused', async () => {
    const doc = base();
    (doc.features as unknown as Array<Record<string, unknown>>).push({
      type: 'sketch', id: 'F7', plane: { kind: 'std', id: 'front' },
      points: [{ id: 'a', x: 10, y: 10 }, { id: 'b', x: 90, y: 10 }, { id: 'c', x: 90, y: 50 }],
      entities: [{ type: 'line', id: 'e1', p1: 'a', p2: 'b' }, { type: 'line', id: 'e2', p1: 'b', p2: 'c' }], constraints: [],
    });
    const w = await world(doc);
    const ctx = { doc: w.controller.document(), selection: [], mode: 'face', box: { min: [0, 0, 0], max: [100, 100, 10] }, edges: [] } as unknown as Ctx;
    const ops = pathPatternOps(ctx)!;
    expect(ops[0]).toMatchObject({ feature: { type: 'curvepattern', seeds: ['F5'], path: { kind: 'sketch', id: 'F7' }, count: 3, distanceType: 'extent', extent: 120 } });
    expect((await w.controller.commit(ops.map((o) => ({ ...o, feature: { ...(o as { feature: object }).feature, id: 'F8' } })) as never)).ok).toBe(true);
    // copies at (70, 10) and (90, 50)
    expect(await w.volume()).toBeCloseTo(vol(3), 4);
    expect(w.store.featureWarnings.value).toEqual({});
    const r = await w.controller.commit([{ op: 'set', id: 'F8', path: 'extent', value: 130 }]);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toMatch(/patternBeyondPath/);
  }, 180000);
});
