// The Offset curve, Composite curve, procedural Project curve and N-sided Fill forms, and the intersection check, against the real kernel:
// the features the forms write must build, the refusals must be the kernel's structured codes (the ones the diagnostics text knows), and the
// Inspect card's check must get the shape of reply it reads.
import { afterEach, describe, expect, it } from 'vitest';
import { Session, type EditResult } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import type { Ctx, FeatureActions } from './featureCommands';
import { creatorCommands } from './featureCreators';
import { patchChoice } from './surfaceRules';
import { proceduralPatch, patchAlong, patchOffsetIn } from './curveRules';

type Wire = Record<string, unknown>;
const front = { kind: 'std', id: 'front' };
const lines = (ids: string[][]) => ids.map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b }));
const rect = (id: string, x1: number, y1: number): Wire => ({
  type: 'sketch', id, plane: front,
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p2', x: x1, y: 0 }, { id: 'p3', x: x1, y: y1 }, { id: 'p4', x: 0, y: y1 }],
  entities: lines([['e1', 'O', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'O']]), constraints: [],
});
/** Two lines with a corner in the middle, and a single straight line, and a line followed by a quarter arc (tangent), all on the front plane. */
const polyline: Wire = { type: 'sketch', id: 'F3', plane: front, points: [{ id: 'a', x: 5, y: 5 }, { id: 'b', x: 20, y: 20 }, { id: 'c', x: 35, y: 5 }], entities: lines([['k1', 'a', 'b'], ['k2', 'b', 'c']]), constraints: [] };
const straight: Wire = { type: 'sketch', id: 'S1', plane: front, points: [{ id: 'a', x: 0, y: -5 }, { id: 'b', x: 20, y: -5 }], entities: lines([['e1', 'a', 'b']]), constraints: [] };
const lineArc: Wire = {
  type: 'sketch', id: 'S2', plane: front, points: [{ id: 'a', x: 0, y: -5 }, { id: 'b', x: 20, y: -5 }, { id: 'c', x: 20, y: 5 }, { id: 'd', x: 30, y: 5 }],
  entities: [{ id: 'e1', type: 'line', p1: 'a', p2: 'b' }, { id: 'e2', type: 'arc', c: 'c', p1: 'b', p2: 'd' }], constraints: [],
};
const apart: Wire = { type: 'sketch', id: 'S3', plane: front, points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 5, y: 0 }, { id: 'c', x: 20, y: 10 }, { id: 'd', x: 30, y: 10 }], entities: lines([['e1', 'a', 'b'], ['e2', 'c', 'd']]), constraints: [] };
const ring: Wire = { type: 'sketch', id: 'S4', plane: front, points: [{ id: 'c', x: 0, y: 0, fixed: true }], entities: [{ id: 'k1', type: 'circle', c: 'c', r: 10 }], constraints: [] };
const lifted: Wire = { type: 'plane', id: 'P1', mode: 'offset', base: front, offset: 20 };
const small: Wire = { type: 'sketch', id: 'S5', plane: { kind: 'feature', id: 'P1' }, points: [{ id: 'c', x: 20, y: 10 }], entities: [{ id: 'k1', type: 'circle', c: 'c', r: 6 }], constraints: [] };

const plate = (extra: Wire[] = []): PartDoc => ({
  ...emptyPart('Plate'),
  features: [rect('F1', 40, 25), { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 10 }, ...extra],
  seq: 20,
}) as unknown as PartDoc;
/** An open box: the four walls and the floor knitted into one sheet (F4), its rim open. */
const openBox: PartDoc = {
  ...emptyPart('Open box'),
  features: [rect('S1', 20, 10), { type: 'surfaceExtrude', id: 'F2', sketch: 'S1', end: 'blind', depth: 5 }, { type: 'surfacePlanar', id: 'F3', sketch: 'S1' }, { type: 'knit', id: 'F4', surfaces: ['F2', 'F3'] }],
  seq: 10,
} as unknown as PartDoc;

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

type Body = { curves?: Array<{ id: string; pts: number[][] }>; markers?: Array<[string, Wire]> } | null;
const codes = (r: EditResult): string => JSON.stringify(r.hints ?? r);

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
    holeOnFace: () => {}, addThread: () => {}, holeFlip: () => false, notify: () => {},
  };
  const cmds = creatorCommands(actions);
  const run = async (id: string) => { cmds.find((c) => c.id === id)!.run(); await Promise.all(pending.splice(0)); return results.at(-1)!; };
  const errors = async () => (await sessions.at(-1)!.verify()).regen.errors.map(([id, e]) => `${id}:${e.code}`);
  const last = (): Wire => controller.document()!.features.at(-1) as unknown as Wire;
  return { controller, run, errors, last, curve: (id: string) => (body as Body)?.curves?.find((c) => c.id === id), marker: (id: string) => (body as Body)?.markers?.find((m) => m[0] === id)?.[1],
    select: (names: string[], mode: 'face' | 'edge') => { store.mode.value = mode; store.select(names); }, setSelected: (id: string | null) => { selectedId = id; },
    edit: (ops: Wire[]) => controller.edit(ops as never) };
}
const set = (id: string, patch: Wire): Wire[] => Object.entries(patch).map(([path, value]) => ({ op: 'set', id, path, value }));

describe('procedural curves and N-sided fill against the real kernel', { skip: !process.env.CK_WASM, timeout: 180000 }, () => {
  it('Offset curve: a sketch line offsets exactly by the distance, with the tolerances the form writes', async () => {
    const w = await world(plate([straight]));
    w.setSelected('S1');
    const r = await w.run('add-offset-curve');
    expect(r.ok, codes(r)).toBe(true);
    expect(w.last()).toMatchObject({ type: 'offsetCurve', sketch: 'S1', distance: 5, tolerance: 0.001 });
    expect(await w.errors()).toEqual([]);
    const id = String(w.last().id);
    expect(w.marker(id)).toMatchObject({ kind: 'offset', pieces: 1, length: 20, distance: 5, closed: false, deviation: 0 });
    const pts = w.curve(id)!.pts;
    // a straight line along one axis: the other two coordinates stay the same all along it
    const flat = [0, 1, 2].filter((i) => pts.every((p) => Math.abs(p[i] - pts[0][i]) < 1e-9));
    expect(flat).toHaveLength(2);
  });

  it('Offset curve: a line and a tangent arc offset to a chain of two pieces; the other side of the arc folds past its radius', async () => {
    const w = await world(plate([lineArc]));
    w.setSelected('S2');
    await w.run('add-offset-curve');
    const id = String(w.last().id);
    expect(await w.errors()).toEqual([]);
    expect(w.marker(id)).toMatchObject({ pieces: 2, corners: 0, deviation: 0 });
    expect(w.marker(id)!.length as number).toBeCloseTo(20 + 7.5 * Math.PI, 3);   // the arc of radius 10 grows to 15 on this side
    const folded = await w.edit(set(id, { distance: -12 }));
    expect(folded.ok).toBe(false);
    expect(codes(folded)).toContain('offsetCurveFold');
  });

  it('Offset curve: a corner is refused with the structured offsetCurveCorner code', async () => {
    const w = await world(plate([polyline]));
    w.setSelected('F3');
    const r = await w.run('add-offset-curve');
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('offsetCurveCorner');
  });

  it('Offset curve: a plane chosen in the form (a plane given by its normal, and a reference plane) and a distance of zero', async () => {
    const w = await world(plate([straight]));
    w.setSelected('S1');
    await w.run('add-offset-curve');
    const id = String(w.last().id);
    expect((await w.edit(set(id, patchOffsetIn({}, 'normal')))).ok).toBe(true);
    expect(w.last()).toMatchObject({ normal: [0, 0, 1] });
    expect((await w.edit(set(id, patchOffsetIn({ normal: [0, 0, 1] }, 'plane')))).ok).toBe(true);
    expect((await w.edit(set(id, { distance: 0 }))).ok).toBe(false);
    expect(await w.errors()).toEqual([]);
  });

  it('Composite curve: the two lines of a sketch join into one curve with one corner', async () => {
    const w = await world(plate([polyline]));
    w.setSelected('F3');
    const r = await w.run('add-composite-curve');
    expect(r.ok, codes(r)).toBe(true);
    expect(w.last()).toMatchObject({ type: 'compositeCurve', sketch: 'F3', tolerance: 0.001 });
    expect(await w.errors()).toEqual([]);
    const id = String(w.last().id);
    expect(w.marker(id)).toMatchObject({ kind: 'composite', pieces: 2, corners: 1, closed: false });
    expect(w.marker(id)!.length as number).toBeCloseTo(2 * Math.hypot(15, 15), 6);
  });

  it('Composite curve: curves that do not meet are the structured compositeCurveNotChain / compositeCurveGap codes', async () => {
    const w = await world(plate([apart]));
    w.setSelected('S3');
    const r = await w.run('add-composite-curve');
    expect(r.ok).toBe(false);
    expect(codes(r)).toMatch(/compositeCurveNotChain|compositeCurveGap/);
    // the same two lines listed in order, as the form's curve list writes them: the gap is named
    const id = 'F99';
    const listed = await w.edit([{ op: 'add', feature: { type: 'compositeCurve', id, curves: [{ kind: 'sketchCurve', sketch: 'S3', entity: 'e1' }, { kind: 'sketchCurve', sketch: 'S3', entity: 'e2' }] } }]);
    expect(listed.ok).toBe(false);
    expect(codes(listed)).toContain('compositeCurveGap');
  });

  it('a composite curve can be the source of an offset curve; a straight one has no plane, which is the structured offsetCurvePlane code', async () => {
    const lone = await world(plate([straight]));
    lone.setSelected('S1');
    await lone.run('add-composite-curve');
    lone.setSelected(String(lone.last().id));
    const refused = await lone.run('add-offset-curve');
    expect(refused.ok).toBe(false);
    expect(codes(refused)).toContain('offsetCurvePlane');
    const w = await world(plate([lineArc]));
    w.setSelected('S2');
    await w.run('add-composite-curve');
    const comp = String(w.last().id);
    w.setSelected(comp);
    const r = await w.run('add-offset-curve');
    expect(r.ok, codes(r)).toBe(true);
    expect(w.last()).toMatchObject({ type: 'offsetCurve', curve: comp });
    expect(await w.errors()).toEqual([]);
  });

  it('Project curve, keep exact: the circle above the plate lands on the top face as a projected curve, and needs exactly one face', async () => {
    const w = await world(plate([lifted, small]));
    w.select(['F2.C1'], 'face');
    w.setSelected('S5');
    await w.run('add-project-curve');
    const id = String(w.last().id);
    expect(w.last()).toMatchObject({ type: 'projectCurve', sketch: 'S5', faces: ['F2.C1'] });
    const on = await w.edit(set(id, proceduralPatch(true)));
    expect(on.ok, codes(on)).toBe(true);
    expect(w.last()).toMatchObject({ procedural: true });
    expect(await w.errors()).toEqual([]);
    expect(w.marker(id)).toMatchObject({ kind: 'projected', closed: true });
    expect(w.curve(id)!.pts.every((p) => Math.abs(p[2] - 10) < 1e-6)).toBe(true);
    // nearest point of the face gives the same curve for a face parallel to the sketch plane
    expect((await w.edit(set(id, patchAlong({}, 'normal')))).ok).toBe(true);
    expect(w.marker(id)).toMatchObject({ mode: 'normal' });
    // with no face picked the exact projection is refused
    const none = await w.edit(set(id, { faces: [] }));
    expect(none.ok).toBe(false);
    expect(codes(none)).toContain('invalidValue');
    // and off again: the fitted projection builds with the fields it reads
    expect((await w.edit(set(id, { ...proceduralPatch(false), faces: ['F2.C1'] }))).ok).toBe(true);
    expect(w.marker(id)).toMatchObject({ degree: 3 });
  });

  it('Project curve, keep exact: a list of curves (two lines of a lifted sketch, in chain order) projects as one chain; turning it off drops the list', async () => {
    const vee: Wire = { type: 'sketch', id: 'S6', plane: { kind: 'feature', id: 'P1' }, points: [{ id: 'a', x: 5, y: 5 }, { id: 'b', x: 20, y: 20 }, { id: 'c', x: 35, y: 5 }], entities: lines([['k1', 'a', 'b'], ['k2', 'b', 'c']]), constraints: [] };
    const w = await world(plate([lifted, vee]));
    w.select(['F2.C1'], 'face');
    w.setSelected('S6');
    await w.run('add-project-curve');
    const id = String(w.last().id);
    const listed = await w.edit(set(id, { ...proceduralPatch(true), sketch: null, curves: [{ kind: 'sketchCurve', sketch: 'S6', entity: 'k1' }, { kind: 'sketchCurve', sketch: 'S6', entity: 'k2' }] }));
    expect(listed.ok, codes(listed)).toBe(true);
    expect(await w.errors()).toEqual([]);
    expect(w.marker(id)).toMatchObject({ kind: 'projected', closed: false });
    const pts = w.curve(id)!.pts;
    expect(pts.every((p) => Math.abs(p[2] - 10) < 1e-6)).toBe(true);
    // both lines are there: the chain runs from x 5 to x 35 through the apex at y 20
    expect(Math.min(...pts.map((p) => p[0]))).toBeCloseTo(5, 4);
    expect(Math.max(...pts.map((p) => p[0]))).toBeCloseTo(35, 4);
    expect(Math.max(...pts.map((p) => p[1]))).toBeCloseTo(20, 4);
    // off again: the list goes with the other exact fields, and the spline projection needs its one source back
    const off = await w.edit(set(id, { ...proceduralPatch(false), sketch: 'S6' }));
    expect(off.ok, codes(off)).toBe(true);
    expect(w.last().curves ?? null).toBeNull();   // the editor removes a null field; a raw set leaves it null, which the kernel reads as no list
  });

  it('Fill, N-sided: the four rim edges of an open box fill with four faces; G1 is accepted, G2 is the structured fillContinuity code', async () => {
    const w = await world(openBox);
    const rim = [['F2.S.e1', [10, 0, 5]], ['F2.S.e2', [20, 5, 5]], ['F2.S.e3', [10, 10, 5]], ['F2.S.e4', [0, 5, 5]]].map(([f, at]) => ({ faces: [f], at }));
    const made = await w.edit([{ op: 'add', feature: { type: 'fill', edges: rim, merge: true, continuity: 'G0', fairing: 'meowNURBS' } }]);
    expect(made.ok, codes(made)).toBe(true);
    const id = String(w.last().id);
    expect(w.last()).toMatchObject({ type: 'fill', continuity: 'G0' });
    const on = await w.edit(set(id, patchChoice({}, 'nSided')));
    expect(on.ok, codes(on)).toBe(true);
    expect(w.last()).toMatchObject({ patch: 'nSided', patchTolerance: 1e-4 });
    expect(await w.errors()).toEqual([]);
    const faces = new Set(w.controller.bodyFaces()?.faceIds ?? []);
    expect([...faces].filter((f) => f.startsWith(id + '.N'))).toHaveLength(4);
    expect((await w.edit(set(id, { continuity: 'G1' }))).ok).toBe(true);
    const g2 = await w.edit(set(id, { continuity: 'G2' }));
    expect(g2.ok).toBe(false);
    expect(codes(g2)).toContain('fillContinuity');
    const bad = await w.edit(set(id, { patchTolerance: 0 }));
    expect(bad.ok).toBe(false);
    expect(codes(bad)).toContain('fillInvalid');
    // back to Single: the plain patch builds again
    expect((await w.edit(set(id, { continuity: 'G0', ...patchChoice({ patch: 'nSided' }, 'single') }))).ok).toBe(true);
    expect(await w.errors()).toEqual([]);
  });

  it('Check intersection: a box meets itself in exact lines, so there is nothing to prove; the card gets the fields it reads', async () => {
    const w = await world(plate());
    const r = (await w.controller.intersection([]))!;
    expect(r).toMatchObject({ marched: 0, spans: 0, unresolved: 0 });
    expect(r.pairs).toBeGreaterThan(0);
    expect(r.curves).toBeGreaterThan(0);
    expect(r.issues).toEqual([]);
    const one = (await w.controller.intersection(['F2.C1']))!;
    expect(one.pairs).toBeGreaterThan(0);
    expect(one.pairs).toBeLessThan(r.pairs);
  });

  it('Check intersection: crossing cylinders give marched curves whose spans are proved', async () => {
    const tube = (id: string, plane: Wire, r: number): Wire => ({ type: 'sketch', id, plane, points: [{ id: 'c', x: 0, y: 0, fixed: true }], entities: [{ id: 'k', type: 'circle', c: 'c', r }], constraints: [] });
    const doc = {
      ...emptyPart('Cross'),
      features: [
        tube('A', { kind: 'std', id: 'top' }, 10), { type: 'extrude', id: 'EA', op: 'add', sketch: 'A', end: 'blind', depth: 20, symmetric: true },
        tube('B', front, 6), { type: 'extrude', id: 'EB', op: 'add', sketch: 'B', end: 'blind', depth: 30, symmetric: true },
      ],
      seq: 10,
    } as unknown as PartDoc;
    const w = await world(doc);
    expect(await w.errors()).toEqual([]);
    const r = (await w.controller.intersection([]))!;
    expect(r.marched).toBeGreaterThan(0);
    expect(r.spans).toBeGreaterThan(0);
    expect(r.proved + r.repaired + r.unresolved).toBe(r.spans);
    expect(r.unresolved).toBe(r.issues.filter((i) => !i.repaired).length);
  });
});
