import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import type { Ctx, FeatureActions } from './featureCommands';
import { creatorCommands } from './featureCreators';

type Wire = Record<string, unknown>;
const lines = (ids: string[][]) => ids.map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b }));
const rect = (id: string, x1: number, y1: number): Wire => ({
  type: 'sketch', id, plane: { kind: 'std', id: 'front' },
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p2', x: x1, y: 0 }, { id: 'p3', x: x1, y: y1 }, { id: 'p4', x: 0, y: y1 }],
  entities: lines([['e1', 'O', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'O']]), constraints: [],
});
/** An open two-line sketch on the front plane (a corner in the middle). */
const polyline: Wire = {
  type: 'sketch', id: 'F3', plane: { kind: 'std', id: 'front' },
  points: [{ id: 'a', x: 5, y: 5 }, { id: 'b', x: 20, y: 20 }, { id: 'c', x: 35, y: 5 }],
  entities: lines([['k1', 'a', 'b'], ['k2', 'b', 'c']]), constraints: [],
};
const box = (extra: Wire[] = []): PartDoc => ({
  ...emptyPart('Box'),
  features: [rect('F1', 40, 25), { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 10 }, polyline, ...extra],
  seq: 4 + extra.length,
}) as unknown as PartDoc;

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

type Body = { curves?: Array<{ id: string; pts: number[][] }>; markers?: Array<[string, Wire]> } | null;

async function world(doc: PartDoc) {
  const store = createStore();
  let body: Body = null;
  const view: ViewSink = { setBody(b) { body = b as Body; }, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view, kernel });
  await controller.load(doc);
  const pending: Promise<unknown>[] = [];
  let selectedId: string | null = null;
  const actions: FeatureActions = {
    context: (): Ctx => ({ doc: controller.document(), selection: store.selection.value, mode: store.mode.value, box: controller.bodyBox(), edges: controller.bodyEdges(), selectedId }),
    create: (ops) => { pending.push(controller.edit(ops)); },
    holeOnFace: () => {}, addThread: () => {}, holeFlip: () => false, notify: () => {},
  };
  const cmds = creatorCommands(actions);
  const run = async (id: string) => { cmds.find((c) => c.id === id)!.run(); await Promise.all(pending.splice(0)); };
  const stats = async () => {
    const s = sessions.at(-1)!;
    const report = await s.verify();
    let volume: number | null = null;
    try { volume = ((await s.massProps()) as { volume: number }).volume; } catch { /* no solid */ }
    return { errors: report.regen.errors.map(([id, e]) => `${id}:${e.code}`), volume };
  };
  const last = (): Wire => controller.document()!.features.at(-1) as unknown as Wire;
  return { controller, run, stats, last, curve: (id: string) => (body as Body)?.curves?.find((c) => c.id === id), marker: (id: string) => (body as Body)?.markers?.find((m) => m[0] === id)?.[1],
    select: (names: string[], mode: 'face' | 'edge') => { store.mode.value = mode; store.select(names); }, setSelected: (id: string | null) => { selectedId = id; },
    edit: (ops: Wire[]) => controller.edit(ops as never) };
}

describe('curve commands against the real kernel', { skip: !process.env.CK_WASM, timeout: 120000 }, () => {
  it('Project curve: the sketch lies on the picked top face as one curve, a run per line, with the corner kept', async () => {
    const w = await world(box());
    w.select(['F2.C1'], 'face');
    await w.run('add-project-curve');
    expect(w.last()).toMatchObject({ type: 'projectCurve', sketch: 'F3', faces: ['F2.C1'], degree: 3, direction: 'both' });
    expect((await w.stats()).errors).toEqual([]);
    const id = String(w.last().id);
    const pts = w.curve(id)!.pts;
    expect(pts.length).toBeGreaterThan(10);
    expect(pts.every((p) => Math.abs(p[2] - 10) < 1e-3)).toBe(true);
    expect(w.marker(id)).toMatchObject({ pieces: 2, corners: 1, closed: false });
  });

  it('Project curve: direction reverse from the sketch plane misses a face behind it, and the form can change it', async () => {
    const w = await world(box());
    w.select(['F2.C1'], 'face');
    await w.run('add-project-curve');
    const id = String(w.last().id);
    const r = await w.edit([{ op: 'set', id, path: 'direction', value: 'reverse' }]);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.hints)).toContain('projectCurveMisses');
    expect(w.last()).toMatchObject({ direction: 'both' });   // refused: the feature is unchanged
    expect((await w.edit([{ op: 'set', id, path: 'direction', value: 'forward' }])).ok).toBe(true);
    expect((await w.stats()).errors).toEqual([]);
  });

  it('Project curve: a degree outside 2 to 9 is the structured editCurveDegree error', async () => {
    const w = await world(box());
    w.select(['F2.C1'], 'face');
    await w.run('add-project-curve');
    const r = await w.edit([{ op: 'set', id: String(w.last().id), path: 'degree', value: 12 }]);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.hints)).toContain('editCurveDegree');
  });

  it('Edit curve: rebuilds the sketch as one curve, and a control point edit moves it', async () => {
    const w = await world(box());
    w.setSelected('F3');
    await w.run('add-edit-curve');
    expect(w.last()).toMatchObject({ type: 'editCurve', method: 'tolerance', degree: 3, keepEnds: true, keepCorners: true });
    expect((w.last().curves as unknown[]).length).toBe(2);
    expect((await w.stats()).errors).toEqual([]);
    const id = String(w.last().id);
    const before = w.curve(id)!.pts;
    expect(w.marker(id)).toMatchObject({ degree: 3, corners: 1 });
    expect(w.marker(id)!.count as number).toBeGreaterThan(2);
    await w.edit([{ op: 'set', id, path: 'entries', value: [{ cv: 2, dx: 0, dy: 0, dz: 6 }] }]);
    expect((await w.stats()).errors).toEqual([]);
    expect(w.marker(id)!.entries).toMatchObject([{ cv: 2, applied: true }]);
    const after = w.curve(id)!.pts;
    expect(Math.max(...before.map((p) => Math.abs(p[2])))).toBeLessThan(1e-6);
    expect(Math.max(...after.map((p) => p[2]))).toBeGreaterThan(1);
  });

  it('Edit curve: a curve picked from an earlier Project curve, tolerance method, planar flattening', async () => {
    const w = await world(box());
    w.select(['F2.C1'], 'face');
    await w.run('add-project-curve');
    const proj = String(w.last().id);
    w.setSelected(proj);
    await w.run('add-edit-curve');
    expect(w.last()).toMatchObject({ type: 'editCurve', curves: [{ kind: 'curve', id: proj }] });
    const id = String(w.last().id);
    await w.edit([{ op: 'set', id, path: 'method', value: 'tolerance' }, { op: 'set', id, path: 'tolerance', value: 0.05 }, { op: 'set', id, path: 'planar', value: true }, { op: 'set', id, path: 'plane', value: { kind: 'std', id: 'front' } }]);
    expect((await w.stats()).errors).toEqual([]);
    expect(w.curve(id)!.pts.every((p) => Math.abs(p[2]) < 1e-6)).toBe(true);
  });

  it('Edit curve: a degree outside 2 to 9 is the structured editCurveDegree error', async () => {
    const w = await world(box());
    w.setSelected('F3');
    await w.run('add-edit-curve');
    const r = await w.edit([{ op: 'set', id: String(w.last().id), path: 'degree', value: 1 }]);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.hints)).toContain('editCurveDegree');
  });

  it('Freeform: rebuilds the top face as a 5 x 5 net, and a point move lifts it by the closed-form volume', async () => {
    const w = await world(box());
    w.select(['F2.C1'], 'face');
    expect((await w.stats()).volume).toBeCloseTo(10000, 3);
    await w.run('add-freeform');
    expect(w.last()).toMatchObject({ type: 'freeform', faces: ['F2.C1'], degreeU: 3, spansU: 2, edits: [] });
    const rebuilt = await w.stats();
    expect(rebuilt.errors).toEqual([]);
    expect(rebuilt.volume!).toBeCloseTo(10000, 0);
    const id = String(w.last().id);
    expect((w.marker(id)!.faces as Array<{ net: unknown[] }>)[0].net).toHaveLength(25);
    await w.edit([{ op: 'set', id, path: 'edits', value: [{ points: [[2, 2]], dz: 2 }] }]);
    const moved = await w.stats();
    expect(moved.errors).toEqual([]);
    expect(moved.volume!).toBeCloseTo(10000 + (2 * 1000) / 16, 0);
  });

  it('Freeform: moves on two faces are the structured freeformOneFace error', async () => {
    const w = await world(box());
    w.select(['F2.C1', 'F2.C0'], 'face');
    await w.run('add-freeform');
    const r = await w.edit([{ op: 'set', id: String(w.last().id), path: 'edits', value: [{ points: [[2, 2]], dz: 2 }] }]);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.hints)).toContain('freeformOneFace');
  });
});
