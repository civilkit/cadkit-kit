// The Sweep surface and Blend surface tools against the real kernel: the features the creators and forms write must build, the areas and
// volumes must be the closed-form ones, and each refusal must be the kernel's structured code (the ones the diagnostics text knows).
import { afterEach, describe, expect, it } from 'vitest';
import { Session, type EditResult } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { adviceOf, reasonOf } from '@kit/viewdata';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import type { Ctx, FeatureActions } from './featureCommands';
import { creatorCommands } from './featureCreators';
import { blendSpanFromFaces, flipSide, spanPatch, sidesInForce, sweepPathPatch, varyPatch } from './procSurfaceRules';

type Wire = Record<string, unknown>;
const front = { kind: 'std', id: 'front' };
const lines = (ids: string[][]) => ids.map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b }));
const rect = (id: string, x1: number, y1: number): Wire => ({
  type: 'sketch', id, plane: front,
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p2', x: x1, y: 0 }, { id: 'p3', x: x1, y: y1 }, { id: 'p4', x: 0, y: y1 }],
  entities: lines([['e1', 'O', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'O']]), constraints: [],
});
/** A plane with its own axes through `o`, and a sketch on it. */
const onFrame = (id: string, o: number[], x: number[], y: number[], points: Wire[], entities: Wire[]): Wire[] => [
  { type: 'plane', id: 'P' + id, mode: 'frame', origin: o, xDir: x, yDir: y },
  { type: 'sketch', id, plane: { kind: 'feature', id: 'P' + id }, points, entities, constraints: [] },
];
/** A circle of radius 2 about the origin on the front plane (S1), and a line of 25 along z (S2), the circle square to it. */
const tubeInputs = (): Wire[] => [
  { type: 'sketch', id: 'S1', plane: front, points: [{ id: 'c', x: 0, y: 0, fixed: true }], entities: [{ id: 'k', type: 'circle', c: 'c', r: 2 }], constraints: [] },
  ...onFrame('S2', [0, 0, 0], [0, 0, 1], [1, 0, 0], [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 25, y: 0 }], lines([['e1', 'a', 'b']])),
];
/** A circle of radius 1.5 about (5, 0, 0) square to y (S3), and a quarter arc of radius 6 about the origin (S4) that an offset of -1 turns into radius 5 (O1). */
const bendInputs = (): Wire[] => [
  ...onFrame('S3', [5, 0, 0], [1, 0, 0], [0, 0, 1], [{ id: 'c', x: 0, y: 0 }], [{ id: 'k', type: 'circle', c: 'c', r: 1.5 }]),
  { type: 'sketch', id: 'S4', plane: front, points: [{ id: 'c', x: 0, y: 0 }, { id: 'a', x: 6, y: 0 }, { id: 'b', x: 0, y: 6 }], entities: [{ id: 'k', type: 'arc', c: 'c', p1: 'a', p2: 'b' }], constraints: [] },
  { type: 'offsetCurve', id: 'O1', sketch: 'S4', distance: -1, tolerance: 0.001 },
];
const plate = (extra: Wire[] = []): PartDoc => ({
  ...emptyPart('Plate'),
  features: [rect('F1', 40, 25), { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 10 }, ...extra],
  seq: 20,
}) as unknown as PartDoc;
const part = (features: Wire[]): PartDoc => ({ ...emptyPart('Procedural surfaces'), features, seq: 30 }) as unknown as PartDoc;

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

type Body = { markers?: Array<[string, Wire]> } | null;
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
  return { controller, run, errors, last, marker: (id: string) => (body as Body)?.markers?.find((m) => m[0] === id)?.[1],
    select: (names: string[], mode: 'face' | 'edge') => { store.mode.value = mode; store.select(names); }, setSelected: (id: string | null) => { selectedId = id; },
    edit: (ops: Wire[]) => controller.edit(ops as never) };
}
const set = (id: string, patch: Wire): Wire[] => Object.entries(patch).map(([path, value]) => ({ op: 'set', id, path, value }));
/** The first error of a refused edit: its code and the structured parameters the kernel gave (what the diagnostics text reads). */
const rootOf = (r: EditResult): { code: string; params: Wire } => { const e = r.errors![0][1] as unknown as { code: string; params?: Wire }; return { code: e.code, params: e.params ?? {} }; };
const faceIds = (w: Awaited<ReturnType<typeof world>>): string[] => [...new Set(w.controller.bodyFaces()?.faceIds ?? [])];

describe('Sweep surface and Blend surface against the real kernel', { skip: !process.env.CK_WASM, timeout: 180000 }, () => {
  it('Sweep surface: a circle swept along a line is a tube of area 2 pi r L, one face, open at both ends', async () => {
    const w = await world(part(tubeInputs()));
    w.setSelected('S2');
    const r = await w.run('add-sweep-surface');
    expect(r.ok, codes(r)).toBe(true);
    expect(w.last()).toMatchObject({ type: 'sweepSurface', profile: 'S1', path: 'S2', frame: 'tangent', tolerance: 0.001 });
    expect(await w.errors()).toEqual([]);
    const id = String(w.last().id);
    expect(w.marker(id)).toMatchObject({ kind: 'sweep', frame: 'tangent', closed: [false, true], caps: false });
    expect(w.marker(id)!.area as number).toBeCloseTo(2 * Math.PI * 2 * 25, 6);
    expect(w.marker(id)!.pathLength as number).toBeCloseTo(25, 6);
    expect(faceIds(w).filter((f) => f.startsWith(id + '.'))).toEqual([id + '.W']);
    // the form's other choices all build: keep the orientation (which has no up), and a world axis as the up direction
    expect((await w.edit(set(id, { frame: 'translate' }))).ok).toBe(true);
    expect(w.marker(id)).toMatchObject({ frame: 'translate' });
    expect((await w.edit(set(id, { frame: null, up: [1, 0, 0] }))).ok).toBe(true);
    expect(w.marker(id)!.up).toEqual([1, 0, 0]);
    expect(await w.errors()).toEqual([]);
  });

  it('Sweep surface: with caps the tube is a closed shell with a volume, and knits into a solid of that volume', async () => {
    const w = await world(part(tubeInputs()));
    w.setSelected('S2');
    await w.run('add-sweep-surface');
    const id = String(w.last().id);
    const on = await w.edit(set(id, { caps: true }));
    expect(on.ok, codes(on)).toBe(true);
    expect(w.marker(id)).toMatchObject({ caps: true });
    expect(w.marker(id)!.volume as number).toBeCloseTo(Math.PI * 4 * 25, 6);
    expect(faceIds(w).filter((f) => f.startsWith(id + '.')).sort()).toEqual([id + '.C0', id + '.C1', id + '.W']);
    const knit = await w.edit([{ op: 'add', feature: { type: 'knit', id: 'K1', surfaces: [id], solid: true } }]);
    expect(knit.ok, codes(knit)).toBe(true);
    expect(await w.errors()).toEqual([]);
    expect((await w.controller.massProps())!.volume).toBeCloseTo(Math.PI * 4 * 25, 3);
    // a profile that is not closed cannot be capped: the structured code, which the form avoids by showing Caps only for a closed sketch
    const open = await w.edit(set(id, { profile: 'S2', path: 'S1', frame: 'translate' }));
    expect(open.ok).toBe(false);
    expect(codes(open)).toContain('sweepSurfaceCaps');
  });

  it('Sweep surface: along an offset curve it is swept along the definition (a torus patch of radius 5)', async () => {
    const w = await world(part(bendInputs()));
    w.setSelected('O1');
    const r = await w.run('add-sweep-surface');
    expect(r.ok, codes(r)).toBe(true);
    expect(w.last()).toMatchObject({ type: 'sweepSurface', profile: 'S3', path: 'O1' });
    expect(await w.errors()).toEqual([]);
    const id = String(w.last().id);
    expect(w.marker(id)!.area as number).toBeCloseTo(2 * Math.PI * 1.5 * 5 * (Math.PI / 2), 5);
    expect(w.marker(id)!.deviation as number).toBeLessThanOrEqual(0.001);
    // a list of curve references (what a script may write) is read like the id
    const listed = await w.edit(set(id, { path: [{ kind: 'curve', id: 'O1' }] }));
    expect(listed.ok, codes(listed)).toBe(true);
    expect(w.marker(id)!.area as number).toBeCloseTo(2 * Math.PI * 1.5 * 5 * (Math.PI / 2), 5);
  });

  it('Sweep (solid): along an offset curve selected in the tree, the kernel follows the exact radius-5 arc; the form writes the same curve route', async () => {
    const w = await world(part(bendInputs()));
    w.setSelected('O1');
    const r = await w.run('add-sweep');
    expect(r.ok, codes(r)).toBe(true);
    expect(w.last()).toMatchObject({ type: 'sweep', op: 'add', sketch: 'S3', path: { kind: 'curve', id: 'O1' } });
    expect(await w.errors()).toEqual([]);
    const torus = Math.PI * 1.5 * 1.5 * 5 * (Math.PI / 2);   // Pappus: section area times the path length of its centre
    expect((await w.controller.massProps())!.volume).toBeCloseTo(torus, 3);
    // back to a sketch path and to the curve again with the patches the path drop-down writes
    const id = String(w.last().id);
    const back = await w.edit(set(id, sweepPathPatch('S4')));
    expect(back.ok, codes(back)).toBe(true);
    expect(w.last().path).toEqual({ kind: 'sketch', id: 'S4' });
    const again = await w.edit(set(id, sweepPathPatch('curve:O1')));
    expect(again.ok, codes(again)).toBe(true);
    expect((await w.controller.massProps())!.volume).toBeCloseTo(torus, 3);
  });

  it('Sweep surface: the up direction along the path is the structured sweepSurfaceFrame code, and the reason and advice read', async () => {
    const w = await world(part(tubeInputs()));
    w.setSelected('S2');
    await w.run('add-sweep-surface');
    const id = String(w.last().id);
    const r = await w.edit(set(id, { up: [0, 0, 1] }));
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('sweepSurfaceFrame');
    const root = rootOf(r);
    expect(root.code).toBe('sweepSurfaceFrame');
    expect(Array.isArray(root.params.at)).toBe(true);
    expect(reasonOf(root as never)).toBeTruthy();
    expect(adviceOf(root as never)).toContain('up direction');
    // no path at all is sweepSurfaceNoInput and the field is named
    const none = await w.edit(set(id, { up: null, path: null }));
    expect(none.ok).toBe(false);
    expect(codes(none)).toContain('sweepSurfaceNoInput');
  });

  it('Blend surface: the round of the top front edge of a plate is a quarter cylinder of area pi r L / 2', async () => {
    const w = await world(plate());
    w.select(['F2.C1', 'F2.S.e1'], 'face');
    const r = await w.run('add-blend-surface');
    expect(r.ok, codes(r)).toBe(true);
    expect(w.last()).toMatchObject({ type: 'blendSurface', faces: ['F2.C1', 'F2.S.e1'] });
    const id = String(w.last().id);
    const set3 = await w.edit(set(id, { radius: 3 }));
    expect(set3.ok, codes(set3)).toBe(true);
    expect(await w.errors()).toEqual([]);
    expect(w.marker(id)).toMatchObject({ kind: 'blend', span: 'edge', sides: [-1, -1], radius: [3, 3] });
    expect(w.marker(id)!.area as number).toBeCloseTo((Math.PI * 3 * 40) / 2, 4);
    expect(faceIds(w)).toContain(id + '.R');
    // the app reads the sides the kernel chose from this marker (the Flip button starts from them)
    expect(w.controller.markerOf(id)?.sides).toEqual([-1, -1]);
    expect(sidesInForce(w.last(), w.controller.markerOf(id)?.sides as number[])).toEqual([-1, -1]);
  });

  it('Blend surface: a varying radius, the two-points span and the automatic sides the form writes all build', async () => {
    const w = await world(plate());
    w.select(['F2.C1', 'F2.S.e1'], 'face');
    await w.run('add-blend-surface');
    const id = String(w.last().id);
    const varying = await w.edit(set(id, varyPatch({ radius: 2 }, true)));
    expect(varying.ok, codes(varying)).toBe(true);
    expect(w.marker(id)).toMatchObject({ radius: [2, 2] });
    expect((await w.edit(set(id, { radius: [2, 3] }))).ok).toBe(true);
    expect(w.marker(id)).toMatchObject({ radius: [2, 3] });
    // a linear law: the area is the mean radius times pi/2 times the length
    expect(w.marker(id)!.area as number).toBeCloseTo((Math.PI / 2) * 2.5 * 40, 0);
    const points = await w.edit(set(id, spanPatch({ radius: [2, 3] }, 'points')));
    expect(points.ok, codes(points)).toBe(true);   // the points the switch starts with (a line of 10 along x) are a valid span too
    expect(w.marker(id)).toMatchObject({ span: 'points' });
    const onEdge = await w.edit(set(id, { from: [0, 0, 10], to: [40, 0, 10] }));
    expect(onEdge.ok, codes(onEdge)).toBe(true);
    expect(w.marker(id)).toMatchObject({ span: 'points' });
    // back to the shared edge
    expect((await w.edit(set(id, spanPatch({ from: [0, 0, 10] }, 'edge')))).ok).toBe(true);
    expect(w.marker(id)).toMatchObject({ span: 'edge' });
    // Flip writes both sides; the other side of both faces of a convex edge is refused, and automatic sides build again
    const flipped = flipSide({}, 0, w.controller.markerOf(id)?.sides as number[]);
    expect(flipped).toEqual({ sides: [1, -1] });
    expect((await w.edit(set(id, { sides: [1, 1] }))).ok).toBe(false);
    expect((await w.edit(set(id, { sides: null }))).ok).toBe(true);
    expect(await w.errors()).toEqual([]);
  });

  it('Blend surface: the two points the form derives from the picked faces are their shared edge, and the blend along them is the quarter cylinder', async () => {
    const w = await world(plate());
    const span = blendSpanFromFaces([w.controller.bodyFaces(), ...w.controller.surfaceMeshes()], 'F2.S.e1', 'F2.C1')!;
    expect(span).toEqual({ from: [0, 0, 10], to: [40, 0, 10] });
    w.select(['F2.C1', 'F2.S.e1'], 'face');
    await w.run('add-blend-surface');
    const id = String(w.last().id);
    const r = await w.edit(set(id, { radius: 3, ...spanPatch({}, 'points', span) }));
    expect(r.ok, codes(r)).toBe(true);
    expect(w.marker(id)).toMatchObject({ span: 'points' });
    expect(w.marker(id)!.area as number).toBeCloseTo((Math.PI * 3 * 40) / 2, 3);
    // another pair (top and the right end) gives that edge; a face of the blend sheet is found in the surface meshes
    expect(blendSpanFromFaces([w.controller.bodyFaces(), ...w.controller.surfaceMeshes()], 'F2.C1', 'F2.S.e2')).toEqual({ from: [40, 0, 10], to: [40, 25, 10] });
    expect(blendSpanFromFaces([w.controller.bodyFaces(), ...w.controller.surfaceMeshes()], 'F2.C1', id + '.R')).not.toBeNull();
  });

  it('Blend surface: a radius the faces cannot take is blendSurfaceRadius with the largest one that does', async () => {
    const w = await world(plate());
    w.select(['F2.C1', 'F2.S.e1'], 'face');
    await w.run('add-blend-surface');
    const id = String(w.last().id);
    const r = await w.edit(set(id, { radius: 12 }));
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('blendSurfaceRadius');
    const root = rootOf(r);
    expect(root.code).toBe('blendSurfaceRadius');
    expect(root.params.maxRadius as number).toBeCloseTo(10, 3);
    expect(adviceOf(root as never)).toMatch(/^Set the radius to 10 mm or less\./);
  });

  it('Blend surface: the other side of both faces of a convex edge touches nothing (blendSurfaceNoContact), and a radius of 0 is invalidValue', async () => {
    const w = await world(plate());
    w.select(['F2.C1', 'F2.S.e1'], 'face');
    await w.run('add-blend-surface');
    const id = String(w.last().id);
    const r = await w.edit(set(id, { sides: [1, 1] }));
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('blendSurfaceNoContact');
    const root = rootOf(r);
    expect(root.code).toBe('blendSurfaceNoContact');
    expect(reasonOf(root as never)).toBeTruthy();
    expect(adviceOf(root as never)).toContain('Flip');
    const zero = await w.edit(set(id, { sides: null, radius: 0 }));
    expect(zero.ok).toBe(false);
    expect(codes(zero)).toContain('invalidValue');
    // one face only is refused as an invalid value of faces
    const one = await w.edit(set(id, { radius: 3, faces: ['F2.C1'] }));
    expect(one.ok).toBe(false);
    expect(codes(one)).toContain('invalidValue');
  });
});
