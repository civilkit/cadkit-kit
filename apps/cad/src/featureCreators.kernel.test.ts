import { afterEach, describe, expect, it } from 'vitest';
import { Session, type EditResult } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { ICON_NAMES } from '@kit/ui';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import type { Ctx, FeatureActions } from './featureCommands';
import { pickValue } from './featureCommands';
import { CREATORS, creatorCommands, isClosedSketch, isOpenSketch } from './featureCreators';

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

describe('creator commands: registry', () => {
  it('every creator has a label, an icon, a unique id and a ribbon tab', () => {
    const cmds = creatorCommands({ context: () => ({ doc: null, selection: [], mode: 'face', box: null, edges: [] }), create() {}, holeOnFace() {}, holeFlip: () => false, notify() {} });
    expect(new Set(cmds.map((c) => c.id)).size).toBe(CREATORS.length);
    expect(cmds.filter((c) => !ICON_NAMES.includes(c.id)).map((c) => c.id)).toEqual([]);
    expect(cmds.every((c) => c.label && !c.label.startsWith('cmd.') && c.enabled!() === false)).toBe(true);   // no document: nothing is enabled
  });
  it('sketch shapes: open chain, closed outline, circle', () => {
    const open = { id: 'a', type: 'sketch', entities: lines([['e1', 'p1', 'p2'], ['e2', 'p2', 'p3']]) };
    expect([isOpenSketch(open), isClosedSketch(open)]).toEqual([true, false]);
    expect([isOpenSketch(rect('r', 0, 0, 1, 1) as never), isClosedSketch(rect('r', 0, 0, 1, 1) as never)]).toEqual([false, true]);
    expect([isOpenSketch(circle('c', 0, 0, 1) as never), isClosedSketch(circle('c', 0, 0, 1) as never)]).toEqual([false, true]);
  });
});

describe('picking into a plane field', () => {
  it('neutral and plane take a face as a reference object, nothing else', () => {
    expect(pickValue('neutral', ['F2.C1'], [])).toEqual({ kind: 'face', id: 'F2.C1' });
    expect(pickValue('plane', ['F2.S.e1'], [])).toEqual({ kind: 'face', id: 'F2.S.e1' });
    expect(pickValue('plane', ['F2.C1|F2.S.e1#0'], [])).toBeNull();
  });
});

describe('creator commands against the real kernel', { skip: !process.env.CK_WASM, timeout: 120000 }, () => {
  it('plane: offset 10 from the front plane; from a picked face; midway between two faces', async () => {
    const w = await world(box());
    expect(w.cmd('add-plane').enabled!()).toBe(true);
    await w.run('add-plane');
    expect(last(w)).toMatchObject({ type: 'plane', mode: 'offset', offset: 10, base: { kind: 'std', id: 'front' } });
    w.select(['F2.C1'], 'face');
    await w.run('add-plane');
    expect(last(w)).toMatchObject({ mode: 'offset', offset: 10, base: { kind: 'face', id: 'F2.C1' } });
    w.select(['F2.C1', 'F2.C0'], 'face');
    await w.run('add-plane');
    expect(last(w)).toMatchObject({ mode: 'mid', base: { kind: 'face', id: 'F2.C1' }, base2: { kind: 'face', id: 'F2.C0' } });
    const after = await w.stats();
    expect(after.errors).toEqual([]);
    expect(after.volume).toBeCloseTo(10000, 3);
    expect(w.controller.bodyBox()).toEqual({ min: [0, 0, 0], max: [40, 25, 10] });
  });

  it('axis: where two faces meet, or the front/top planes with nothing picked', async () => {
    const w = await world(box());
    await w.run('add-axis');
    expect(last(w)).toMatchObject({ type: 'axis', refs: [{ kind: 'std', id: 'front' }, { kind: 'std', id: 'top' }] });
    w.select(['F2.C1', 'F2.S.e1'], 'face');
    await w.run('add-axis');
    expect(last(w)).toMatchObject({ type: 'axis', refs: [{ kind: 'face', id: 'F2.C1' }, { kind: 'face', id: 'F2.S.e1' }] });
    expect((await w.stats()).errors).toEqual([]);
  });

  it('axis from one flat face is the documented structured error, nothing is added', async () => {
    const w = await world(box());
    const n = w.doc().features.length;
    w.select(['F2.C1'], 'face');
    const r = await w.run('add-axis');
    expect(r.ok).toBe(false);
    expect(w.doc().features.length).toBe(n);
  });

  it('draft: needs picked faces; tilts them about the plane of the first sketch', async () => {
    const w = await world(box());
    expect(w.cmd('add-draft').enabled!()).toBe(false);
    w.select(['F2.S.e1', 'F2.S.e3'], 'face');
    expect(w.cmd('add-draft').enabled!()).toBe(true);
    await w.run('add-draft');
    expect(last(w)).toMatchObject({ type: 'draft', faces: ['F2.S.e1', 'F2.S.e3'], angle: 3, neutral: { kind: 'std', id: 'front' } });
    const after = await w.stats();
    expect(after.errors).toEqual([]);
    expect(after.volume!).toBeLessThan(10000);
  });

  it('draft of a face parallel to the neutral plane is the structured draftParallelFace error', async () => {
    const w = await world(box());
    w.select(['F2.C1'], 'face');
    const r = await w.run('add-draft');
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.hints)).toContain('draftParallelFace');
  });

  it('mirror: the last feature about the right plane; about a picked face', async () => {
    const w = await world(box());
    expect(w.cmd('add-mirror').enabled!()).toBe(true);
    await w.run('add-mirror');
    expect(last(w)).toMatchObject({ type: 'mirror', seeds: ['F2'], plane: { kind: 'std', id: 'right' }, body: false });
    const after = await w.stats();
    expect(after.errors).toEqual([]);
    expect(after.volume).toBeCloseTo(20000, 2);
    expect(w.controller.bodyBox()).toEqual({ min: [-40, 0, 0], max: [40, 25, 10] });
    const f = await world(box());
    f.select(['F2.S.e2'], 'face');
    await f.run('add-mirror');
    expect(last(f)).toMatchObject({ plane: { kind: 'face', id: 'F2.S.e2' } });
    expect((await f.stats()).errors).toEqual([]);
  });

  it('lip: a raised band along the edges of the picked face', async () => {
    const w = await world(box());
    expect(w.cmd('add-lip').enabled!()).toBe(false);
    w.select(['F2.C1'], 'face');
    expect(w.cmd('add-lip').enabled!()).toBe(true);
    await w.run('add-lip');
    expect(last(w)).toMatchObject({ type: 'lip', kind: 'lip', faces: ['F2.C1'], width: 0.5, height: 0.5 });
    expect((last(w).edges as unknown[]).length).toBe(4);
    const after = await w.stats();
    expect(after.errors).toEqual([]);
    expect(after.volume!).toBeGreaterThan(10000);
  });

  it('rib: needs an open sketch; fills between the line and the walls of a shelled box', async () => {
    const shelled = box([
      { type: 'shell', id: 'F3', faces: ['F2.C1'], thickness: 2 },
      { type: 'plane', id: 'F4', mode: 'offset', base: { kind: 'std', id: 'top' }, offset: 12 },
      { type: 'sketch', id: 'F5', plane: { kind: 'feature', id: 'F4' }, points: [{ id: 'a', x: 10, y: -5 }, { id: 'b', x: 30, y: -5 }], entities: lines([['k1', 'a', 'b']]), constraints: [] },
    ]);
    const w = await world(shelled);
    const base = await w.stats();
    expect(base.errors).toEqual([]);
    expect(w.cmd('add-rib').enabled!()).toBe(true);
    await w.run('add-rib');
    expect(last(w)).toMatchObject({ type: 'rib', sketch: 'F5', thickness: 1 });
    const after = await w.stats();
    expect(after.errors).toEqual([]);
    expect(after.volume!).toBeGreaterThan(base.volume!);
    expect((await world(box())).cmd('add-rib').enabled!()).toBe(false);   // a closed sketch is no rib
  });

  it('helix: from the last circle sketch', async () => {
    const w = await world(box([circle('F3', 20, 12, 5)]));
    expect(w.cmd('add-helix').enabled!()).toBe(true);
    await w.run('add-helix');
    expect(last(w)).toMatchObject({ type: 'helix', sketch: 'F3', definedBy: 'pitchRevs', revolutions: 5 });
    expect((await w.stats()).errors).toEqual([]);
    expect((await world(box())).cmd('add-helix').enabled!()).toBe(false);
  });

  it('delete body: removes the body that holds the picked face', async () => {
    const two = box([rect('F3', 100, 0, 110, 10), { type: 'extrude', id: 'F4', op: 'add', sketch: 'F3', end: 'blind', depth: 10 }]);
    const w = await world(two);
    const base = await w.stats();
    expect(base.volume).toBeCloseTo(11000, 2);
    expect(w.cmd('add-delete-body').enabled!()).toBe(false);
    w.select(['F4.C1'], 'face');
    await w.run('add-delete-body');
    expect(last(w)).toMatchObject({ type: 'deleteBody', mode: 'delete', bodies: [{ face: 'F4.C1' }] });
    const after = await w.stats();
    expect(after.errors).toEqual([]);
    expect(after.volume).toBeCloseTo(10000, 2);
  });

  it('delete face: removes the picked face (the solid opens into a surface)', async () => {
    const w = await world(box());
    w.select(['F2.C1'], 'face');
    await w.run('add-delete-face');
    expect(last(w)).toMatchObject({ type: 'deleteFace', mode: 'delete', faces: ['F2.C1'] });
    expect((await w.stats()).errors).toEqual([]);
  });

  it('pipe cut: along a picked edge, the result is a surface body', async () => {
    const w = await world(box());
    w.select([edgeKey(w, 'F2.C1', 'F2.S.e1')], 'edge');
    expect(w.cmd('add-pipe-cut').enabled!()).toBe(true);
    await w.run('add-pipe-cut');
    expect(last(w)).toMatchObject({ type: 'pipeCut', radius: 1, faces: [] });
    expect((await w.stats()).errors).toEqual([]);
  });

  it('planar surface and extruded surface from the closed sketch; a circle too', async () => {
    const w = await world(box());
    expect(w.cmd('add-surface-planar').enabled!()).toBe(true);
    await w.run('add-surface-planar');
    expect(last(w)).toMatchObject({ type: 'surfacePlanar', sketch: 'F1' });
    await w.run('add-surface-extrude');
    expect(last(w)).toMatchObject({ type: 'surfaceExtrude', sketch: 'F1', end: 'blind', depth: 10 });
    const after = await w.stats();
    expect(after.errors).toEqual([]);
    expect(after.volume).toBeCloseTo(10000, 3);   // surfaces add no volume
    const c = await world(partOf([circle('F1', 0, 0, 5)]));
    await c.run('add-surface-extrude');
    expect(last(c)).toMatchObject({ sketch: 'F1' });
    expect((await c.stats()).errors).toEqual([]);
    expect((await world(box())).cmd('add-surface-revolve').enabled!()).toBe(false);   // no construction line
  });

  it('revolved surface: uses the construction line as the axis', async () => {
    const prof = {
      type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' },
      points: [{ id: 'a', x: 0, y: -5 }, { id: 'b', x: 0, y: 15 }, { id: 'c', x: 5, y: 0 }, { id: 'd', x: 15, y: 0 }, { id: 'e', x: 15, y: 10 }, { id: 'f', x: 5, y: 10 }],
      entities: [{ id: 'ax', type: 'line', p1: 'a', p2: 'b', construction: true }, ...lines([['l1', 'c', 'd'], ['l2', 'd', 'e'], ['l3', 'e', 'f'], ['l4', 'f', 'c']])], constraints: [],
    };
    const w = await world(partOf([prof]));
    expect(w.cmd('add-surface-revolve').enabled!()).toBe(true);
    await w.run('add-surface-revolve');
    expect(last(w)).toMatchObject({ type: 'surfaceRevolve', sketch: 'F1', axis: 'ax', angle: 360 });
    expect((await w.stats()).errors).toEqual([]);
  });

  it('knit and thicken: a planar surface becomes a solid when thickened', async () => {
    const surf = () => partOf([rect('F1', 0, 0, 40, 25), { type: 'surfacePlanar', id: 'F2', sketch: 'F1' }]);
    const w = await world(surf());
    expect(w.cmd('add-knit').enabled!()).toBe(true);
    await w.run('add-knit');
    expect(last(w)).toMatchObject({ type: 'knit', surfaces: ['F2'], solid: false });
    expect((await w.stats()).errors).toEqual([]);
    const t = await world(surf());
    expect(t.cmd('add-thicken').enabled!()).toBe(true);
    await t.run('add-thicken');
    expect(last(t)).toMatchObject({ type: 'thicken', surface: 'F2', thickness: 1 });
    const after = await t.stats();
    expect(after.errors).toEqual([]);
    expect(after.volume).toBeCloseTo(40 * 25 * 1, 2);
  });

  it('trim surface: not enabled without a tool; with a reference plane it trims the surface', async () => {
    const w = await world(partOf([rect('F1', 0, 0, 40, 25), { type: 'surfacePlanar', id: 'F2', sketch: 'F1' }]));
    expect(w.cmd('add-trim-surface').enabled!()).toBe(false);
    await w.controller.edit([{ op: 'add', feature: { type: 'plane', mode: 'offset', base: { kind: 'std', id: 'right' }, offset: 20 } }]);
    expect(w.cmd('add-trim-surface').enabled!()).toBe(true);
    await w.run('add-trim-surface');
    expect(last(w)).toMatchObject({ type: 'trimSurface', surface: 'F2', plane: { kind: 'feature', id: 'F3' } });
    expect((await w.stats()).errors).toEqual([]);
  });
});
