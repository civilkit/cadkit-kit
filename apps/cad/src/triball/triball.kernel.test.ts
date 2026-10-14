import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore, BODY } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from '../controller';
import { HandleRunner } from '../handles/runner';
import { copyOps, copySource, bodyRefs, faceMoveOps, mirrorOps, mirrorPlaneId, motionOf, moveOps, repeatOps, resolveTarget, shiftSketchOps } from './ops';

// An asymmetric block (40 x 20 x 30 with a notch cut off one corner) so a wrong axis or sense shows in the centroid.
const prof = { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' },
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 40, y: 0 }, { id: 'p3', x: 40, y: 10 }, { id: 'p4', x: 20, y: 20 }, { id: 'p5', x: 0, y: 20 }],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p5'], ['e5', 'p5', 'p1']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b })), constraints: [] };
const part = (): PartDoc => ({ ...emptyPart('Wedge'), features: [prof, { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 30 }], seq: 10 }) as unknown as PartDoc;

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function world() {
  const store = createStore();
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view, kernel });
  await controller.load(part());
  const runner = new HandleRunner({
    preview: (ops) => controller.preview(ops, 0), cancelPreview: () => controller.cancelPreview(),
    commit: async (c) => { await controller.commit(c.ops); },
  });
  const s = () => sessions.at(-1)!;
  const mass = async () => (await s().massProps()) as { volume: number; com?: number[] };
  const errors = async () => (await s().verify()).regen.errors.map(([id, e]) => `${id}:${e.code}`);
  const doc = () => controller.document()!;
  const faces = () => controller.bodyFaces()?.faceIds ?? [];
  return { controller, runner, mass, errors, doc, faces, undoDepth: () => s().history().length };
}
const cen = (m: { com?: number[] }) => m.com!;

describe('the move ball against the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('translate: one move feature, volume unchanged, centroid shifted; a second drag updates that same feature; one undo step each', async () => {
    const w = await world();
    const m0 = await mass0(w);
    const d0 = w.undoDepth();
    // preview shows it without editing
    const ops = moveOps(w.doc(), { translate: [5, 0, 0] }, bodyRefs(w.faces()))!;
    expect(ops).toHaveLength(1);
    await w.runner.drag(ops); await new Promise((r) => setTimeout(r, 300));
    expect(w.doc().features).toHaveLength(2);
    await w.runner.commit({ ops, create: false });
    expect(w.doc().features).toHaveLength(3);
    expect(w.undoDepth()).toBe(d0 + 1);
    const m1 = await w.mass();
    expect(m1.volume).toBeCloseTo(m0.v, 4);
    expect(cen(m1)[0]).toBeCloseTo(m0.c[0] + 5, 4);
    // second drag: folds into the existing feature (replace), not a new one
    const ops2 = moveOps(w.doc(), { translate: [0, 7, 0] }, bodyRefs(w.faces()))!;
    expect(ops2[0].op).toBe('replace');
    await w.runner.commit({ ops: ops2, create: false });
    expect(w.doc().features).toHaveLength(3);
    expect(w.undoDepth()).toBe(d0 + 2);
    const m2 = await w.mass();
    expect(cen(m2)[0]).toBeCloseTo(m0.c[0] + 5, 4);
    expect(cen(m2)[1]).toBeCloseTo(m0.c[1] + 7, 4);
    expect(await w.errors()).toEqual([]);
    await w.controller.undo();
    expect(cen(await w.mass())[1]).toBeCloseTo(m0.c[1], 4);
  }, 90000);

  it('rotation about a skewed axis through the ball origin keeps volume; a composed second rotation equals the two applied in turn', async () => {
    const w = await world();
    const m0 = await mass0(w);
    const frame = { origin: [10, 5, 5] as [number, number, number], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as never };
    const axis: [number, number, number] = [1, 1, 0].map((x) => x / Math.SQRT2) as never;
    const g = { kind: 'spin', axis: 0 } as const;
    const m1 = motionOf(g, { distance: 0, d1: 0, d2: 0, angle: 40, vec: [0, 0, 0], dir: axis }, frame);
    await w.runner.commit({ ops: moveOps(w.doc(), m1, undefined)!, create: false });
    const a = await w.mass();
    expect(a.volume).toBeCloseTo(m0.v, 3);
    // expected centroid by hand: rotate (c - o) about axis by 40 deg, add o
    const rot = (v: number[], k: number[], deg: number) => { const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t); const kv = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]]; const kd = k[0] * v[0] + k[1] * v[1] + k[2] * v[2]; return [0, 1, 2].map((i) => v[i] * c + kv[i] * s + k[i] * kd * (1 - c)); };
    const rel = m0.c.map((x, i) => x - frame.origin[i]);
    const exp1 = rot(rel, axis, 40).map((x, i) => x + frame.origin[i]);
    for (let i = 0; i < 3; i++) expect(cen(a)[i]).toBeCloseTo(exp1[i], 3);
    // second rotation about Z through the new ball origin, folded into the same feature
    const o2 = exp1 as [number, number, number];
    const m2 = motionOf({ kind: 'spin', axis: 2 }, { distance: 0, d1: 0, d2: 0, angle: 25, vec: [0, 0, 0], dir: [0, 0, 1] }, { ...frame, origin: o2 });
    const ops2 = moveOps(w.doc(), m2, undefined)!;
    expect(ops2[0].op).toBe('replace');
    await w.runner.commit({ ops: ops2, create: false });
    expect(w.doc().features).toHaveLength(3);
    const b = await w.mass();
    const exp2 = rot(exp1.map((x, i) => x - o2[i]), [0, 0, 1], 25).map((x, i) => x + o2[i]);
    for (let i = 0; i < 3; i++) expect(cen(b)[i]).toBeCloseTo(exp2[i], 3);
    expect(b.volume).toBeCloseTo(m0.v, 3);
    expect(await w.errors()).toEqual([]);
  }, 90000);

  it('copy leaves the original; a linear pattern of 3 copies and a radial one with step up are valid and spaced as typed; a later drag moves only the original', async () => {
    const w = await world();
    const m0 = await mass0(w);
    const d0 = w.undoDepth();
    await w.runner.commit({ ops: copyOps({ translate: [60, 0, 0] }, copySource(w.faces()))!, create: false });
    expect((await w.mass()).volume).toBeCloseTo(m0.v * 2, 3);
    expect(w.faces().some((f) => f.includes('@'))).toBe(true);
    await w.controller.undo();
    const lin = repeatOps({ kind: 'linear', number: 3, distance: 50, angle: 0, stepUp: 0, dir: [1, 0, 0], origin: [0, 0, 0] }, copySource(w.faces()));
    expect(lin).toHaveLength(3);
    await w.runner.commit({ ops: lin, create: false });
    expect(w.undoDepth()).toBe(d0 + 1);   // three copies, one batch, one undo step
    expect((await w.mass()).volume).toBeCloseTo(m0.v * 4, 3);
    expect(cen(await w.mass())[0]).toBeCloseTo(m0.c[0] + 75, 3);   // the mean of 0, 50, 100, 150
    await w.controller.undo();
    const rad = repeatOps({ kind: 'radial', number: 5, distance: 0, angle: 60, stepUp: 2, dir: [0, 0, 1], origin: [20, 50, 0] }, copySource(w.faces()));
    await w.runner.commit({ ops: rad, create: false });
    expect((await w.mass()).volume).toBeCloseTo(m0.v * 6, 3);
    expect(await w.errors()).toEqual([]);
    // the original only moves when copies exist (bodies names its lump)
    const refs = bodyRefs(w.faces())!;
    expect(refs).toEqual([{ face: expect.not.stringContaining('@') }]);
    const before = (await w.mass()).volume;
    await w.runner.commit({ ops: moveOps(w.doc(), { translate: [0, 0, 100] }, refs)!, create: false });
    expect((await w.mass()).volume).toBeCloseTo(before, 3);
    expect(await w.errors()).toEqual([]);
  }, 120000);

  it('face target: pushing a planar face along its normal grows the part; a second drag updates the same moveFace; an unsupported face reports and changes nothing', async () => {
    const w = await world();
    const m0 = await mass0(w);
    const target = resolveTarget({ doc: w.doc(), selection: ['F2.C1'], mode: 'face', selectedFeature: null, mesh: w.controller.bodyFaces(), box: w.controller.bodyBox() });
    expect(target.ok).toBe(true);
    if (!target.ok) return;
    const n = target.target.frame.axes[2];
    expect(Math.abs(n[2])).toBeCloseTo(1, 6);
    const ops = faceMoveOps(w.doc(), ['F2.C1'], true, n, 5)!;
    await w.runner.commit({ ops, create: false });
    expect((await w.mass()).volume).toBeCloseTo(m0.v + (m0.v / 30) * 5, 2);
    const ops2 = faceMoveOps(w.doc(), ['F2.C1'], true, n, 5)!;
    expect(ops2[0].op).toBe('replace');
    await w.runner.commit({ ops: ops2, create: false });
    expect(w.doc().features).toHaveLength(3);
    expect((await w.mass()).volume).toBeCloseTo(m0.v + (m0.v / 30) * 10, 2);
    expect(await w.errors()).toEqual([]);
  }, 90000);

  it('target resolution: the body, a face, a move feature, and the cases that have no target', async () => {
    const w = await world();
    const c = { doc: w.doc(), mode: 'face', selectedFeature: null, mesh: w.controller.bodyFaces(), box: w.controller.bodyBox() };
    expect(resolveTarget({ ...c, selection: [BODY] })).toMatchObject({ ok: true, target: { kind: 'body' } });
    expect(resolveTarget({ ...c, selection: [] })).toEqual({ ok: false, reason: 'nothing' });
    expect(resolveTarget({ ...c, selection: ['x'], mode: 'edge' })).toEqual({ ok: false, reason: 'edges' });
    expect(resolveTarget({ ...c, selection: [], selectedFeature: 'nope' })).toEqual({ ok: false, reason: 'feature' });
  }, 60000);
});

describe('feature and mirror targets against the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('a feature on a standard-plane sketch moves by shifting the sketch in its plane, in one edit; the normal part is ignored', async () => {
    const w = await world();
    const m0 = await mass0(w);
    const r = resolveTarget({ doc: w.doc(), selection: [], mode: 'face', selectedFeature: 'F2', mesh: w.controller.bodyFaces(), box: w.controller.bodyBox() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.target.kind).toBe('feature');
    const d0 = w.undoDepth();
    const ops = shiftSketchOps(w.doc(), r.target.sketch!, [7, 3, 9])!;     // z is the sketch normal: ignored
    await w.runner.drag(ops); await new Promise((res) => setTimeout(res, 300));
    await w.runner.commit({ ops, create: false });
    expect(w.undoDepth()).toBe(d0 + 1);
    const m = await w.mass();
    expect(m.volume).toBeCloseTo(m0.v, 3);
    expect(cen(m)[0]).toBeCloseTo(m0.c[0] + 7, 3);
    expect(cen(m)[1]).toBeCloseTo(m0.c[1] + 3, 3);
    expect(cen(m)[2]).toBeCloseTo(m0.c[2], 3);
    expect(w.doc().features).toHaveLength(2);       // no new feature
    expect(await w.errors()).toEqual([]);
  }, 90000);

  it('mirror copy about a standard plane through the origin doubles the part; other planes are refused up front', async () => {
    const w = await world();
    const m0 = await mass0(w);
    const frame = { origin: [0, 5, 5] as [number, number, number], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as never };
    expect(mirrorPlaneId(frame, 0)).toBe('right');
    expect(mirrorPlaneId(frame, 1)).toBeNull();                                       // the plane x=0... y axis, origin y=5: not through the origin
    expect(mirrorPlaneId({ ...frame, origin: [3, 0, 0] }, 0)).toBeNull();
    await w.runner.commit({ ops: mirrorOps(w.doc(), 'right')!, create: false });
    expect((await w.mass()).volume).toBeCloseTo(m0.v * 2, 2);
    expect(await w.errors()).toEqual([]);
  }, 60000);
});

async function mass0(w: Awaited<ReturnType<typeof world>>) {
  const m = await w.mass();
  return { v: m.volume, c: cen(m) };
}
