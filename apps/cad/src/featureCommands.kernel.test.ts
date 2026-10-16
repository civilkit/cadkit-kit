import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { DEFAULT_SETTINGS, pointTool } from '@kit/sketch';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import { DEFAULT_PREFS } from './holeData';
import { circularPatternOps, featureCommands, holeOps, linearPatternOps, patternSeed, pickValue, revolveOps, revolveSketch, type Ctx, type FeatureActions } from './featureCommands';

const rect = (id: string, x0: number, y0: number, x1: number, y1: number) => ({
  type: 'sketch', id, plane: { kind: 'std', id: 'front' },
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: x0, y: y0 }, { id: 'p2', x: x1, y: y0 }, { id: 'p3', x: x1, y: y1 }, { id: 'p4', x: x0, y: y1 }],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b })),
  constraints: [],
});
/** A 40 x 25 x 10 box from a sketch and an extrude, or (centred) a 40 x 40 x 10 one. */
const box = (centred = false): PartDoc => ({
  ...emptyPart('Box'),
  features: [centred ? rect('F1', -20, -20, 20, 20) : rect('F1', 0, 0, 40, 25), { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 10 }],
  seq: 3,
}) as unknown as PartDoc;

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
  const notices: string[] = [];
  let selectedId: string | null = null;
  const actions: FeatureActions = {
    context: (): Ctx => ({ doc: controller.document(), selection: store.selection.value, mode: store.mode.value, box: controller.bodyBox(), edges: controller.bodyEdges(), selectedId }),
    create: (ops) => { pending.push(controller.edit(ops)); },
    holeOnFace: () => {},
    addThread: () => {},
    holeFlip: (id) => controller.extrudeFlip(id, 'cut'),
    notify: (text) => { notices.push(text); },
  };
  const cmds = featureCommands(actions);
  const cmd = (id: string) => cmds.find((c) => c.id === id)!;
  /** Run a command and wait for its edit. */
  const run = async (id: string) => { cmd(id).run(); await Promise.all(pending.splice(0)); };
  const stats = async () => {
    const s = sessions.at(-1)!;
    const report = await s.verify();
    const mass = (await s.massProps()) as { volume: number };
    return { errors: report.regen.errors.map(([id, e]) => `${id}:${e.code}`), volume: mass.volume, faces: new Set(body?.mesh.faceIds).size, box: body?.box ?? null };
  };
  return { store, controller, cmd, run, stats, notices, select: (names: string[], mode: 'face' | 'edge') => { store.mode.value = mode; store.select(names); }, setSelected: (id: string | null) => { selectedId = id; }, doc: () => controller.document()! };
}

const lastFeature = (w: Awaited<ReturnType<typeof world>>) => w.doc().features.at(-1) as unknown as Record<string, unknown>;
const edgeKey = (w: Awaited<ReturnType<typeof world>>, a: string, b: string) => w.controller.bodyEdges().find((e) => e.faces?.includes(a) && e.faces?.includes(b))!.key!;

describe('feature commands against the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('fillet: needs a selected edge, adds one fillet that rounds it', async () => {
    const w = await world(box());
    const base = await w.stats();
    expect(base.faces).toBe(6);
    expect(w.cmd('add-fillet').enabled!()).toBe(false);
    w.select([edgeKey(w, 'F2.C1', 'F2.S.e1')], 'face');
    expect(w.cmd('add-fillet').enabled!()).toBe(false);   // face mode
    w.select([edgeKey(w, 'F2.C1', 'F2.S.e1')], 'edge');
    expect(w.cmd('add-fillet').enabled!()).toBe(true);
    const n = w.doc().features.length;
    await w.run('add-fillet');
    expect(w.doc().features.length).toBe(n + 1);
    const f = lastFeature(w);
    expect(f.type).toBe('fillet');
    expect(f.radius).toBe(0.5);   // 5% of the smallest dimension (10), as a nice number
    const after = await w.stats();
    expect(after.errors).toEqual([]);
    expect(after.faces).toBe(7);
    expect(after.volume).toBeLessThan(base.volume);
    expect(after.box).toEqual(base.box);
  });

  it('chamfer: same rule, adds a chamfer face', async () => {
    const w = await world(box());
    const base = await w.stats();
    w.select([edgeKey(w, 'F2.C1', 'F2.S.e1'), edgeKey(w, 'F2.C1', 'F2.S.e2')], 'edge');
    expect(w.cmd('add-chamfer').enabled!()).toBe(true);
    await w.run('add-chamfer');
    const f = lastFeature(w);
    expect(f.type).toBe('chamfer');
    expect((f.edges as unknown[]).length).toBe(2);
    const after = await w.stats();
    expect(after.errors).toEqual([]);
    expect(after.faces).toBe(8);
    expect(after.volume).toBeLessThan(base.volume);
  });

  it('shell: needs a selected face, removes it and hollows the body', async () => {
    const w = await world(box());
    const base = await w.stats();
    expect(w.cmd('add-shell').enabled!()).toBe(false);
    w.select(['F2.C1'], 'face');
    expect(w.cmd('add-shell').enabled!()).toBe(true);
    await w.run('add-shell');
    expect(lastFeature(w)).toMatchObject({ type: 'shell', faces: ['F2.C1'], thickness: 1 });
    const after = await w.stats();
    expect(after.errors).toEqual([]);
    expect(after.faces).toBe(11);
    expect(after.volume).toBeCloseTo(40 * 25 * 10 - 38 * 23 * 9, 1);
    expect(after.box).toEqual(base.box);
  });

  const addPointSketch = async (w: Awaited<ReturnType<typeof world>>, plane: 'front' | { kind: 'face'; id: string }, centreOfBody: boolean) => {
    const view = (await w.controller.beginNewSketch(plane))!;
    expect(view).not.toBeNull();
    const b = w.controller.bodyBox()!;
    const c = [0, 1, 2].map((i) => (b.min[i] + b.max[i]) / 2);
    const d = (axis: number[]) => axis.reduce((s, a, i) => s + a * (c[i] - view.frame.o[i]), 0);
    const [u, v] = centreOfBody ? [d(view.frame.x), d(view.frame.y)] : [0, 0];
    const out = pointTool.step(pointTool.start(), { type: 'click', at: { x: u, y: v }, mods: { shift: false, ctrl: false, alt: false } }, w.controller.sketchDraft()!, DEFAULT_SETTINGS);
    await w.controller.applySketchDraft(out.draft);
    await w.controller.commitSketch();
    return view.featureId;
  };

  it.each([['F2.C1', 'top face'], ['F2.C0', 'bottom face']])('hole on the %s (%s): drills into the body', async (face) => {
    const w = await world(box());
    const base = await w.stats();
    w.select([face], 'face');
    expect(w.cmd('add-hole').enabled!()).toBe(true);
    const sk = await addPointSketch(w, { kind: 'face', id: face }, true);
    const ops = holeOps(sk, w.controller.extrudeFlip(sk, 'cut'), DEFAULT_PREFS);
    await w.controller.edit(ops);
    const f = lastFeature(w);
    expect(f).toMatchObject({ type: 'hole', sketch: sk, kind: 'simple', size: 'M6', fit: 'normal', end: 'through' });
    const after = await w.stats();
    expect(after.errors).toEqual([]);
    expect(after.volume).toBeCloseTo(base.volume - Math.PI * 3.3 * 3.3 * 10, 2);
  });

  it('hole on a front-plane sketch with the body on the normal side is flipped; the command uses the last point sketch', async () => {
    try { localStorage.clear(); } catch { /* no storage: the defaults apply anyway */ }
    const w = await world(box());
    const base = await w.stats();
    expect(w.cmd('add-hole').enabled!()).toBe(false);   // no face, no point sketch
    const sk = await addPointSketch(w, 'front', true);
    w.store.select([]);
    expect(w.cmd('add-hole').enabled!()).toBe(true);
    await w.run('add-hole');
    expect(lastFeature(w)).toMatchObject({ type: 'hole', sketch: sk, flip: true, size: 'M6', end: 'through' });
    const after = await w.stats();
    expect(after.errors).toEqual([]);
    expect(after.volume).toBeCloseTo(base.volume - Math.PI * 3.3 * 3.3 * 10, 2);
  });

  it('revolve: uses the first construction line as the axis; without one it only says so', async () => {
    const profile = (construction: boolean) => ({
      type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' },
      points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'a', x: 0, y: -20 }, { id: 'b', x: 0, y: 20 }, { id: 'c', x: 5, y: 0 }, { id: 'd', x: 15, y: 0 }, { id: 'e', x: 15, y: 10 }, { id: 'f', x: 5, y: 10 }],
      entities: [{ id: 'ax', type: 'line', p1: 'a', p2: 'b', ...(construction ? { construction: true } : {}) }, ...[['l1', 'c', 'd'], ['l2', 'd', 'e'], ['l3', 'e', 'f'], ['l4', 'f', 'c']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b }))],
      constraints: [],
    });
    const make = (construction: boolean) => ({ ...emptyPart('R'), features: [profile(construction)], seq: 2 }) as unknown as PartDoc;
    const w = await world(make(true));
    expect(w.cmd('add-revolve').enabled!()).toBe(true);
    await w.run('add-revolve');
    expect(lastFeature(w)).toMatchObject({ type: 'revolve', sketch: 'F1', axis: 'ax', angle: 360 });
    const after = await w.stats();
    expect(after.errors).toEqual([]);
    expect(after.volume).toBeCloseTo(Math.PI * (15 * 15 - 5 * 5) * 10, 3);

    const none = await world(make(false));
    const n = none.doc().features.length;
    await none.run('add-revolve');
    expect(none.doc().features.length).toBe(n);
    expect(none.notices).toEqual(['Draw a construction line for the axis']);
    expect(revolveOps(revolveSketch({ doc: none.doc(), selection: [], mode: 'face', box: null, edges: [] })!)).toBeNull();
  });

  const withHole = (): PartDoc => {
    const d = box(true) as unknown as { features: unknown[]; seq: number };
    d.features.push(
      { type: 'sketch', id: 'F3', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: -15, y: 0 }], entities: [{ id: 'e1', type: 'point', p: 'p1' }], constraints: [] },
      { type: 'hole', id: 'F4', sketch: 'F3', kind: 'simple', diameter: 2, end: 'through', flip: true },
    );
    d.seq = 5;
    return d as unknown as PartDoc;
  };

  it('linear pattern of the last feature: three holes in a row', async () => {
    const w = await world(withHole());
    const one = await w.stats();
    expect(one.errors).toEqual([]);
    expect(w.cmd('add-lpattern').enabled!()).toBe(true);
    await w.run('add-lpattern');
    expect(lastFeature(w)).toMatchObject({ type: 'lpattern', seeds: ['F4'], count: 3 });
    const after = await w.stats();
    expect(after.errors).toEqual([]);
    const hole = Math.PI * 1 * 10;
    expect(after.volume).toBeCloseTo(one.volume - 2 * hole, 2);
  });

  it('circular pattern of the last feature: three holes round the thin axis', async () => {
    const w = await world(withHole());
    const one = await w.stats();
    await w.run('add-cpattern');
    expect(lastFeature(w)).toMatchObject({ type: 'cpattern', seeds: ['F4'], count: 3, angle: 360, axis: { kind: 'axis', axis: 'z' } });
    const after = await w.stats();
    expect(after.errors).toEqual([]);
    expect(after.volume).toBeCloseTo(one.volume - 2 * Math.PI * 1 * 10, 2);
    expect(patternSeed({ doc: w.doc(), selection: [], mode: 'face', box: null, edges: [], selectedId: 'F2' })!.id).toBe('F2');
    expect(linearPatternOps({ id: 'F4', type: 'hole' }, null)[0]).toBeTruthy();
    expect(circularPatternOps({ id: 'F4', type: 'hole' }, null)[0]).toBeTruthy();
  });

  it('a selection picked into the Editor field regenerates: edges and faces', async () => {
    const w = await world(box());
    const base = await w.stats();
    const four = ['e1', 'e2', 'e3', 'e4'].map((e) => edgeKey(w, 'F2.C1', 'F2.S.' + e));
    const value = pickValue('edges', four, w.controller.bodyEdges());
    w.select([four[0]], 'edge');
    await w.run('add-fillet');
    const id = lastFeature(w).id as string;
    expect((value as unknown[]).length).toBe(4);
    const r = await w.controller.edit([{ op: 'set', id, path: 'edges', value }]);
    expect(r.ok).toBe(true);
    const after = await w.stats();
    expect(after.errors).toEqual([]);
    expect(after.faces).toBe(base.faces + 4);

    w.select(['F2.C1', 'F2.C0'], 'face');
    await w.run('add-shell');
    const shell = lastFeature(w).id as string;
    const faces = pickValue('faces', ['F2.C1', 'F2.S.e1'], w.controller.bodyEdges());
    expect(faces).toEqual(['F2.C1', 'F2.S.e1']);
    expect((await w.controller.edit([{ op: 'set', id: shell, path: 'faces', value: faces }])).ok).toBe(true);
    expect((await w.stats()).errors).toEqual([]);
  });
});
