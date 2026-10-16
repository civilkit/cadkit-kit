import { afterEach, describe, expect, it } from 'vitest';
import { Session, type EditResult } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import type { Ctx, FeatureActions } from './featureCommands';
import { pickValue } from './featureCommands';
import { creatorCommands } from './featureCreators';

type Wire = Record<string, unknown>;
const lines = (ids: string[][]) => ids.map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b }));
const rect = (id: string, x0: number, y0: number, x1: number, y1: number, plane: Wire = { kind: 'std', id: 'front' }) => ({
  type: 'sketch', id, plane,
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: x0, y: y0 }, { id: 'p2', x: x1, y: y0 }, { id: 'p3', x: x1, y: y1 }, { id: 'p4', x: x0, y: y1 }],
  entities: lines([['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']]), constraints: [],
});
const circle = (id: string, x: number, y: number, r: number, plane: Wire = { kind: 'std', id: 'front' }) => ({
  type: 'sketch', id, plane, points: [{ id: 'c', x, y, fixed: true }], entities: [{ id: 'k1', type: 'circle', c: 'c', r }], constraints: [],
});
const box = (extra: Wire[] = []): PartDoc => ({
  ...emptyPart('Box'),
  features: [rect('F1', 0, 0, 40, 25), { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 10 }, ...extra],
  seq: 3 + extra.length,
}) as unknown as PartDoc;
const partOf = (features: Wire[]): PartDoc => ({ ...emptyPart('P'), features, seq: features.length + 1 }) as unknown as PartDoc;

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

type Body = { mesh: { faceIds: string[] }; box: { min: number[]; max: number[] } } | null;

async function world(doc: PartDoc) {
  const store = createStore();
  let body: Body = null;
  const view: ViewSink = { setBody(b) { body = b as Body; }, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view, kernel });
  await controller.load(doc);
  const pending: Promise<unknown>[] = [];
  const results: EditResult[] = [];
  let selectedId: string | null = null;
  const actions: FeatureActions = {
    context: (): Ctx => ({ doc: controller.document(), selection: store.selection.value, mode: store.mode.value, box: controller.bodyBox(), edges: controller.bodyEdges(), selectedId }),
    create: (ops) => { pending.push(controller.edit(ops).then((r) => { results.push(r); })); },
    holeOnFace: () => {},
    addThread: () => {},
    holeFlip: () => false,
    notify: () => {},
  };
  const cmds = creatorCommands(actions);
  const cmd = (id: string) => cmds.find((c) => c.id === id)!;
  const run = async (id: string) => { cmd(id).run(); await Promise.all(pending.splice(0)); return results.at(-1)!; };
  const stats = async () => {
    const s = sessions.at(-1)!;
    const report = await s.verify();
    let volume: number | null = null;
    try { volume = ((await s.massProps()) as { volume: number }).volume; } catch { /* no solid */ }
    return { errors: report.regen.errors.map(([id, e]) => `${id}:${e.code}`), volume, faces: new Set((body as Body)?.mesh.faceIds).size };
  };
  return { store, controller, cmd, run, stats, results, select: (names: string[], mode: 'face' | 'edge') => { store.mode.value = mode; store.select(names); }, setSelected: (id: string | null) => { selectedId = id; }, doc: () => controller.document()! };
}
type World = Awaited<ReturnType<typeof world>>;
const last = (w: World) => w.doc().features.at(-1) as unknown as Wire;
const edgeKey = (w: World, a: string, b: string) => w.controller.bodyEdges().find((e) => e.faces?.includes(a) && e.faces?.includes(b))!.key!;


const top = { kind: 'std', id: 'top' }; const front = { kind: 'std', id: 'front' };
const fp = (id: string): Wire => ({ kind: 'feature', id });
const plane = (id: string, offset: number): Wire => ({ type: 'plane', id, mode: 'offset', base: top, offset });
const polyline = (id: string, pts: Array<[number, number]>, pl: Wire): Wire => ({
  type: 'sketch', id, plane: pl, points: pts.map((p, i) => ({ id: 'q' + i, x: p[0], y: p[1] })),
  entities: pts.slice(1).map((_, i) => ({ id: 'l' + i, type: 'line', p1: 'q' + i, p2: 'q' + (i + 1) })), constraints: [],
});
const loftDoc = (): PartDoc => partOf([circle('A', 0, 0, 10, top), plane('P', 40), rect('B', -12, -8, 12, 8, fp('P'))]);
const sweepDoc = (): PartDoc => partOf([circle('A', 0, 0, 3, top), polyline('Pth', [[0, 0], [0, 30], [20, 50]], front)]);
const wall = (): PartDoc => partOf([circle('C', 0, 0, 10, top), { type: 'surfaceExtrude', id: 'W', sketch: 'C', end: 'blind', depth: 20 }]);
const sheet = (): PartDoc => partOf([rect('R', -20, -20, 20, 20, top), { type: 'surfacePlanar', id: 'SP', sketch: 'R' }]);

describe('loft and sweep creators', () => {
  it('loft joins the two unused closed sketches into a solid', async () => {
    const w = await world(loftDoc());
    expect(w.cmd('add-loft').enabled!()).toBe(true);
    await w.run('add-loft');
    expect(last(w)).toMatchObject({ type: 'loft', op: 'add', sketches: ['A', 'B'] });
    const s = await w.stats();
    expect(s.errors).toEqual([]);
    expect(s.volume).toBeGreaterThan(5000);
  });
  it('loft is off with a single sketch; a sketch already used by another feature is not offered', async () => {
    const w = await world(partOf([circle('A', 0, 0, 10, top)]));
    expect(w.cmd('add-loft').enabled!()).toBe(false);
    const w2 = await world(loftDoc());
    await w2.run('add-loft');
    expect(w2.cmd('add-loft').enabled!()).toBe(false);   // both sketches are in the loft now
  });
  it('surface loft leaves a surface body and no solid', async () => {
    const w = await world(loftDoc());
    await w.run('add-surface-loft');
    expect(last(w)).toMatchObject({ type: 'loft', surface: true });
    const s = await w.stats();
    expect(s.errors).toEqual([]);
    expect(w.controller.surfaceBodies().map((b) => b.id)).toEqual([String(last(w).id)]);
  });
  it('loft guide curve and end tension are read by the kernel', async () => {
    const w = await world(partOf([circle('A', 0, 0, 10, top), plane('P', 40), circle('B', 0, 0, 10, fp('P')), polyline('G', [[10, 0], [14, 40]], front)]));
    await w.run('add-loft');
    const id = String(last(w).id);
    await w.controller.edit([{ op: 'set', id, path: 'guides', value: [{ sketch: 'G' }] }]);
    expect((await w.stats()).errors).toEqual([]);
    await w.controller.edit([{ op: 'set', id, path: 'startNormal', value: 1 }]);
    expect((await w.stats()).errors).toEqual([]);
  });
  it('sweep takes the closed profile and the open path', async () => {
    const w = await world(sweepDoc());
    expect(w.cmd('add-sweep').enabled!()).toBe(true);
    await w.run('add-sweep');
    expect(last(w)).toMatchObject({ type: 'sweep', sketch: 'A', path: { kind: 'sketch', id: 'Pth' } });
    const s = await w.stats();
    expect(s.errors).toEqual([]);
    expect(s.volume).toBeGreaterThan(500);
  });
  it('sweep guide curves go in as sketch curve references', async () => {
    const w = await world(partOf([circle('A', 0, 0, 3, top), polyline('Pth', [[0, 0], [0, 40]], front), polyline('G', [[3, 0], [6, 40]], front)]));
    await w.run('add-sweep');
    const id = String(last(w).id);
    const r = await w.controller.edit([{ op: 'set', id, path: 'guides', value: [{ kind: 'sketchCurve', sketch: 'G', entity: 'l0' }] }]);
    expect(r.errors ?? []).toEqual([]);
    expect((await w.stats()).errors).toEqual([]);
  });
});

describe('fill and extend creators', () => {
  it('fill closes the first open loop of the surface in the tree', async () => {
    const w = await world(wall());
    w.setSelected('W');
    expect(w.cmd('add-fill').enabled!()).toBe(true);
    await w.run('add-fill');
    const f = last(w) as unknown as { type: string; edges: unknown[]; continuity: string };
    expect(f.type).toBe('fill');
    expect(f.edges.length).toBeGreaterThan(0);
    const s = await w.stats();
    expect(s.errors).toEqual([]);
  });
  it('extend lengthens the first open edge, or the picked one', async () => {
    const w = await world(sheet());
    w.setSelected('SP');
    await w.run('add-extend');
    expect(last(w)).toMatchObject({ type: 'extend' });
    const s = await w.stats();
    expect(s.errors).toEqual([]);
  });
});

describe('sketching on a reference-plane feature and lofting closed splines', () => {
  const plane = (id: string, offset: number, name?: string): Wire => ({ type: 'plane', id, mode: 'offset', base: { kind: 'std', id: 'front' }, offset, ...(name ? { name } : {}) });
  const closedSpline = (id: string, r: number, pl: Wire): Wire => ({
    type: 'sketch', id, plane: pl,
    points: Array.from({ length: 10 }, (_, i) => i).map((i) => ({ id: 'p' + i, x: r * Math.cos((i * Math.PI) / 5), y: r * Math.sin((i * Math.PI) / 5) })),
    entities: [{ id: 's', type: 'spline', pts: Array.from({ length: 10 }, (_, i) => 'p' + i), closed: true }], constraints: [],
  });
  it('a new sketch on a Plane feature is named after the plane and lands on it', async () => {
    const w = await world(partOf([plane('P', -60, 'Plane -60 from Front')]));
    const view = await w.controller.beginNewSketch({ kind: 'feature', id: 'P' });
    expect(view).not.toBeNull();
    await w.controller.commitSketch();
    expect(last(w)).toMatchObject({ type: 'sketch', name: 'Sketch on Plane -60 from Front', plane: { kind: 'feature', id: 'P' } });
    await w.controller.beginNewSketch('top');
    await w.controller.commitSketch();
    expect(last(w)).toMatchObject({ name: 'Sketch on Top' });
  });
  it('Loft through three closed splines is enabled, takes all of them in tree order and builds', async () => {
    const w = await world(partOf([closedSpline('A', 10, front), plane('P', 30), closedSpline('B', 14, fp('P')), plane('Q', 60), closedSpline('C', 8, fp('Q'))]));
    expect(w.cmd('add-loft').enabled!()).toBe(true);
    const r = await w.run('add-loft');
    console.log(JSON.stringify(r).slice(0, 600));
    expect(last(w)).toMatchObject({ type: 'loft', sketches: ['A', 'B', 'C'] });
    const s = await w.stats();
    expect(s.errors).toEqual([]);
    expect(s.volume).toBeGreaterThan(1000);
  });
});
