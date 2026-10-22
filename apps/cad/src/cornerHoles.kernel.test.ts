// Corner holes against the real kernel: a filleted plate (rounded sketch, or a box with its vertical edges filleted) gets four holes
// at an inset equal to the fillet radius in one flow (face -> outline -> placement -> point sketch -> hole), and changing the inset
// moves them. Skipped without a kernel (CK_WASM).
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { classifyCurve, flatten } from '@kit/sketch';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import { DEFAULT_PREFS, holeDiameter } from './holeData';
import { edgeRefs, holeOps } from './featureCommands';
import { DEFAULT_CORNER, effectiveInset, faceOutline, placeCornerHoles, readCornerHoles, withCornerHoles, type CornerRecord } from './cornerHoles';
import './locales/en';

const W = 60, H = 40, T = 10, R = 8;
const pt = (id: string, x: number, y: number) => ({ id, x, y });
const rectSketch = (id: string) => ({
  type: 'sketch', id, plane: { kind: 'std', id: 'front' },
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, pt('p1', 0, 0), pt('p2', W, 0), pt('p3', W, H), pt('p4', 0, H)],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b })), constraints: [],
});
/** A W x H rectangle with rounded corners of radius R: four lines and four arcs. */
const roundedSketch = (id: string) => {
  const points = [{ id: 'O', x: 0, y: 0, fixed: true }, pt('a1', R, 0), pt('a2', W - R, 0), pt('a3', W, R), pt('a4', W, H - R), pt('a5', W - R, H), pt('a6', R, H), pt('a7', 0, H - R), pt('a8', 0, R), pt('c1', W - R, R), pt('c2', W - R, H - R), pt('c3', R, H - R), pt('c4', R, R)];
  const entities = [
    { id: 'e1', type: 'line', p1: 'a1', p2: 'a2' }, { id: 'e2', type: 'arc', c: 'c1', p1: 'a2', p2: 'a3' }, { id: 'e3', type: 'line', p1: 'a3', p2: 'a4' }, { id: 'e4', type: 'arc', c: 'c2', p1: 'a4', p2: 'a5' },
    { id: 'e5', type: 'line', p1: 'a5', p2: 'a6' }, { id: 'e6', type: 'arc', c: 'c3', p1: 'a6', p2: 'a7' }, { id: 'e7', type: 'line', p1: 'a7', p2: 'a8' }, { id: 'e8', type: 'arc', c: 'c4', p1: 'a8', p2: 'a1' },
  ];
  return { type: 'sketch', id, plane: { kind: 'std', id: 'front' }, points, entities, constraints: [] };
};
const plate = (sk: unknown): PartDoc => ({ ...emptyPart('Plate'), features: [sk, { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: T }], seq: 3 }) as unknown as PartDoc;

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function world(doc: PartDoc) {
  const store = createStore();
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSelection() {}, setSketchEdit() {} } as ViewSink;
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view, kernel });
  await controller.load(doc);
  const volume = async () => ((await sessions.at(-1)!.massProps()) as { volume: number }).volume;
  const errors = async () => (await sessions.at(-1)!.verify()).regen.errors.map(([id, e]) => `${id}:${e.code}`);
  return { controller, volume, errors };
}
type World = Awaited<ReturnType<typeof world>>;

/** The cap face the plate's top: the one whose edges are the plate outline at the far end of the extrusion. */
function topFace(w: World): string {
  const caps = ['F2.C1', 'F2.C0'];
  const best = caps.map((f) => ({ f, z: Math.max(...w.controller.bodyEdges().filter((e) => e.faces?.includes(f)).flatMap((e) => (e.pts ?? []).map((p) => Math.abs(p[2])))) }));
  return best.sort((a, b) => b.z - a.z)[0].f;
}

/** Everything the Hole-on-face flow does, minus the clicks: open the sketch on the face, read the outline, place, confirm, add the hole. */
async function cornerHolesOnFace(w: World, face: string, rec: CornerRecord) {
  const view = (await w.controller.beginNewSketch({ kind: 'face', id: face }))!;
  expect(view).not.toBeNull();
  const outline = faceOutline(view.frame, w.controller.bodyEdges(), face)!;
  expect(outline).not.toBeNull();
  const placed = placeCornerHoles(outline.rect, { inset: effectiveInset(rec, outline.radius), nx: rec.nx, ny: rec.ny, radius: outline.radius ?? 0, holeDiameter: holeDiameter({ kind: 'simple', size: 'M6', fit: 'normal' }) });
  expect(placed.issues.filter((i) => i.level === 'error')).toEqual([]);
  const d = w.controller.sketchDraft()!;
  const next = withCornerHoles(d, placed.points);
  next.extras = { ...(d.extras ?? {}), cornerHoles: { ...rec, rect: outline.rect, radius: outline.radius } };
  await w.controller.applySketchDraft(next);
  await w.controller.commitSketch();
  await w.controller.edit(holeOps(view.featureId, w.controller.extrudeFlip(view.featureId, 'cut'), DEFAULT_PREFS));
  return { sketchId: view.featureId, outline, frame: view.frame, points: placed.points };
}

/** Centres, in the sketch plane of `frame`, of the closed round edges (hole rims) on the given face. */
function holeCentres(w: World, face: string, frame: { o: number[]; x: number[]; y: number[]; z: number[] }): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (const e of w.controller.bodyEdges()) {
    if (!e.faces?.includes(face) || !e.pts || e.pts.length < 8) continue;
    const c = classifyCurve(flatten(frame, e.pts).pts);
    if (c?.kind === 'circle') out.push(c.c);
  }
  return out;
}
const sameSet = (a: Array<{ x: number; y: number }>, b: Array<{ x: number; y: number }>) => a.length === b.length && a.every((p) => b.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-3));
const AREA = W * H - (4 - Math.PI) * R * R;
const cyl = (d: number) => Math.PI * (d / 2) ** 2 * T;

describe('corner holes against the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('rounded plate: inset matching the fillet radius gives four concentric holes and the volume of plate minus four cylinders', async () => {
    const w = await world(plate(roundedSketch('F1')));
    const base = await w.volume();
    expect(base).toBeCloseTo(AREA * T, 1);
    const face = topFace(w);
    const r = await cornerHolesOnFace(w, face, { ...DEFAULT_CORNER, matchFillet: true });
    expect(r.outline.rectangle).toBe(true);
    expect(r.outline.radius).toBeCloseTo(R, 5);
    expect(await w.errors()).toEqual([]);
    const dia = holeDiameter({ kind: 'simple', size: 'M6', fit: 'normal' })!;
    const after = await w.volume();
    expect(Math.abs((base - after) / (4 * cyl(dia)) - 1)).toBeLessThan(0.005);
    const feats = w.controller.document()!.features as unknown as Array<Record<string, unknown>>;
    expect(feats.filter((f) => f.type === 'hole')).toHaveLength(1);
    expect(readCornerHoles(feats.find((f) => f.id === r.sketchId))).toMatchObject({ inset: 10, matchFillet: true, nx: 2, ny: 2, radius: expect.closeTo(R, 5) });
    // each hole axis sits R from both edges: the centre of each fillet (the plate is at x, y in 0..W, 0..H on the front plane)
    const want = [[R, R], [W - R, R], [R, H - R], [W - R, H - R]];
    const centres = holeCentres(w, face, r.frame);
    expect(centres).toHaveLength(4);
    expect(sameSet(centres, want.map(([x, y]) => ({ x, y })))).toBe(true);
  });

  it('the same flow on a box with its four vertical edges filleted', async () => {
    const doc = plate(rectSketch('F1'));
    const w0 = await world(doc);
    const keys = w0.controller.bodyEdges().filter((e) => e.faces?.length === 2 && e.faces.every((f) => f.startsWith('F2.S.'))).map((e) => e.key!);
    expect(keys).toHaveLength(4);
    const fr = await w0.controller.edit([{ op: 'add', feature: { type: 'fillet', id: 'F3', edges: edgeRefs(keys, w0.controller.bodyEdges()), radius: R } } as never]);
    expect(fr.ok).toBe(true);
    expect(await w0.errors()).toEqual([]);
    const base = await w0.volume();
    expect(base).toBeCloseTo(AREA * T, 1);
    // the cap faces keep their names after the fillet; pick the one that has a sketch-plane-parallel outline of 4 lines and 4 arcs
    const face = topFace(w0);
    const r = await cornerHolesOnFace(w0, face, { ...DEFAULT_CORNER, matchFillet: true });
    expect(r.outline.radius).toBeCloseTo(R, 5);
    expect(await w0.errors()).toEqual([]);
    const dia = holeDiameter({ kind: 'simple', size: 'M6', fit: 'normal' })!;
    expect(Math.abs((base - (await w0.volume())) / (4 * cyl(dia)) - 1)).toBeLessThan(0.005);
    expect(sameSet(holeCentres(w0, face, r.frame), [[R, R], [W - R, R], [R, H - R], [W - R, H - R]].map(([x, y]) => ({ x, y })))).toBe(true);
  });

  it('a plate without fillets: typed inset, sharp rectangle, four holes', async () => {
    const w = await world(plate(rectSketch('F1')));
    const base = await w.volume();
    const face = topFace(w);
    const r = await cornerHolesOnFace(w, face, { ...DEFAULT_CORNER, inset: 5 });
    expect(r.outline).toMatchObject({ rectangle: true, radius: null });
    expect(await w.errors()).toEqual([]);
    const dia = holeDiameter({ kind: 'simple', size: 'M6', fit: 'normal' })!;
    expect(Math.abs((base - (await w.volume())) / (4 * cyl(dia)) - 1)).toBeLessThan(0.005);
    const centres = holeCentres(w, face, r.frame);
    expect(sameSet(centres, r.points)).toBe(true);
    expect(r.points.map((p) => [p.x, p.y]).sort()).toEqual([[5, 5], [5, H - 5], [W - 5, 5], [W - 5, H - 5]].sort());
  });

  it('changing the inset moves the holes, keeps the hole parameters, and is one undo step', async () => {
    const w = await world(plate(roundedSketch('F1')));
    const face = topFace(w);
    const r = await cornerHolesOnFace(w, face, { ...DEFAULT_CORNER, inset: 10 });
    const feats = () => w.controller.document()!.features as unknown as Array<Record<string, unknown>>;
    const holeBefore = feats().find((f) => f.type === 'hole')!;
    expect(sameSet(holeCentres(w, face, r.frame), r.points)).toBe(true);
    // what the Update button does: re-place against the same plate and replace the sketch in one edit
    const sk = feats().find((f) => f.id === r.sketchId) as never as { points: Array<{ id: string }>; entities: Array<{ id: string }> };
    const rec = { ...readCornerHoles(sk)!, inset: 6, nx: 3 };
    const placed = placeCornerHoles(r.outline.rect, { inset: 6, nx: 3, ny: 2, radius: R, holeDiameter: 6.6 });
    expect(placed.points).toHaveLength(6);
    const nHistory = feats().length;
    await w.controller.commit([{ op: 'replace', id: r.sketchId, feature: { ...withCornerHoles(sk, placed.points), cornerHoles: { ...rec, rect: r.outline.rect, radius: R } } as never }], 'corner holes');
    expect(feats()).toHaveLength(nHistory);
    expect(await w.errors()).toEqual([]);
    expect(feats().find((f) => f.type === 'hole')).toEqual(holeBefore);
    expect(readCornerHoles(feats().find((f) => f.id === r.sketchId))).toMatchObject({ inset: 6, nx: 3 });
    const after = holeCentres(w, face, r.frame);
    expect(after).toHaveLength(6);
    expect(sameSet(after, placed.points)).toBe(true);
    // one undo puts the four holes back
    await w.controller.undo();
    const back = holeCentres(w, face, r.frame);
    expect(back).toHaveLength(4);
    expect(sameSet(back, r.points)).toBe(true);
  });
});
