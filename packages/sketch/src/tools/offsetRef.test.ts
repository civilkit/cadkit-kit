import { describe, expect, it } from 'vitest';
import type { SketchDraft } from '../index';
import { sketchShapes } from '../shapes';
import { DEFAULT_SETTINGS, type BodyEdge, type Pt, type Tool, type ToolEnv, type ToolEvent, type ToolOutput } from './types';
import { applyOffset, faceOuterLoop, OFFSET_FACE_KEY, offsetTool } from './offset';
import { fitCurve } from './splineMath';
import { offsetSplinePoints, SPLINE_COLLAPSED } from './splineOffset';
import { blankDraft, resolves } from './edit-fixtures';
import { sketchReferenceEdges } from './refSketches';
import { toFeature } from '../index';

const M = { shift: false, ctrl: false, alt: false };
const click = (x: number, y: number): ToolEvent => ({ type: 'click', at: { x, y }, mods: M });
const move = (x: number, y: number): ToolEvent => ({ type: 'move', at: { x, y }, mods: M });
const key = (k: string): ToolEvent => ({ type: 'key', key: k });
function run(draft: SketchDraft, events: ToolEvent[], env?: ToolEnv, tool: Tool<never> = offsetTool as never): ToolOutput<unknown> {
  let out: ToolOutput<unknown> = { state: tool.start(), draft, preview: [], fields: [] };
  for (const ev of events) out = (tool as Tool<unknown>).step(out.state, ev, out.draft, DEFAULT_SETTINGS, env);
  return out;
}

/** World frame = the sketch plane XY at z=0 (so plane coords are world x, y). */
const frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const circlePts = (cx: number, cy: number, r: number, n: number, z = 0): number[][] => Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n), z]);
const rectEdges = (x0: number, y0: number, x1: number, y1: number, z: number, face: string): BodyEdge[] => [
  { key: `${face}.a`, faces: [face, 'side'], pts: [[x0, y0, z], [x1, y0, z]] }, { key: `${face}.b`, faces: [face, 'side'], pts: [[x1, y0, z], [x1, y1, z]] },
  { key: `${face}.c`, faces: [face, 'side'], pts: [[x1, y1, z], [x0, y1, z]] }, { key: `${face}.d`, faces: [face, 'side'], pts: [[x0, y1, z], [x0, y0, z]] },
];
const bboxOf = (pts: Pt[]) => ({ x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), y1: Math.max(...pts.map((p) => p.y)) });
const pointsOf = (d: SketchDraft, ids: string[]): Pt[] => ids.map((id) => d.points.find((p) => p.id === id)!);

describe('offsetting a fit spline', () => {
  const ring = (r: number, n = 8): Pt[] => circlePts(0, 0, r, n).slice(0, n).map((p) => ({ x: p[0], y: p[1] }));
  it('a closed spline offset inward is a smaller, concentric-ish closed spline at the right distance', () => {
    // walked counter-clockwise: left = inside
    const src = ring(20);
    const off = offsetSplinePoints(src, true, 3) as Pt[];
    expect(Array.isArray(off)).toBe(true);
    const curve = fitCurve(off, true, 16);
    const rs = curve.map((p) => Math.hypot(p.x, p.y));
    const srcR = fitCurve(src, true, 16).map((p) => Math.hypot(p.x, p.y));
    expect(Math.min(...rs)).toBeGreaterThan(Math.min(...srcR) - 3.2);
    expect(Math.max(...rs)).toBeLessThan(Math.max(...srcR) - 2.8);
  });
  it('outward is bigger; a distance past the radius of curvature collapses with a clear hint', () => {
    const out = offsetSplinePoints(ring(20), true, -3) as Pt[];
    expect(Math.max(...out.map((p) => Math.hypot(p.x, p.y)))).toBeGreaterThan(22.5);
    expect(offsetSplinePoints(ring(20), true, 25)).toBe(SPLINE_COLLAPSED);
  });
  it('an open spline offsets to one side', () => {
    const src = [{ x: 0, y: 0 }, { x: 10, y: 4 }, { x: 20, y: 0 }, { x: 30, y: 4 }];
    const left = offsetSplinePoints(src, false, 2) as Pt[];
    expect(left.length).toBeGreaterThanOrEqual(4);
    expect(left[0].y).toBeGreaterThan(1.5);   // walking +x, left is +y
  });
  it('applyOffset writes a real (non-construction) closed spline from a spline in the sketch', () => {
    const pts = ring(20);
    const d: SketchDraft = { ...blankDraft(), points: pts.map((p, i) => ({ id: `p${i + 1}`, ...p })), entities: [{ id: 'e1', type: 'spline', pts: pts.map((_, i) => `p${i + 1}`), closed: true, construction: true }] };
    const r = applyOffset(d, ['e1'], 3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const e = r.draft.entities[1];
    expect(e).toMatchObject({ type: 'spline', closed: true, construction: true });   // a construction original stays construction
    expect(resolves(r.draft)).toBe(true);
    const bad = applyOffset(d, ['e1'], 40);
    expect(bad).toEqual({ ok: false, hint: SPLINE_COLLAPSED });
  });
  it('the Offset tool selects a spline of the sketch (hover and click) and offsets it on the pointer side', () => {
    const pts = ring(20);
    const d: SketchDraft = { ...blankDraft(), points: pts.map((p, i) => ({ id: `p${i + 1}`, ...p })), entities: [{ id: 'e1', type: 'spline', pts: pts.map((_, i) => `p${i + 1}`), closed: true }] };
    const snap = { kind: 'grid' as const, at: { x: 20, y: 0 }, entityId: 'e1' };
    const hov = run(d, [{ type: 'move', at: { x: 20, y: 0 }, snap, mods: M }]);
    expect(hov.preview.length).toBeGreaterThan(8);
    const o = run(d, [{ type: 'click', at: { x: 20, y: 0 }, snap, mods: M }, key('Enter'), move(10, 0), field0(2)]);
    expect(o.draft.entities).toHaveLength(2);
    expect(o.draft.entities[1]).toMatchObject({ type: 'spline', closed: true });
  });
});
function field0(v: number): ToolEvent { return { type: 'field', id: 'd', value: v, commit: true }; }

describe('offsetting reference geometry of the body', () => {
  // a 60 x 40 box: top face at z=10 (edges a-d), bottom at z=0
  const top = rectEdges(0, 0, 60, 40, 10, 'F2.C1');
  const bottom = rectEdges(0, 0, 60, 40, 0, 'F2.C0');
  const env: ToolEnv = { body: { frame: { ...frame, o: [0, 0, 10] }, edges: [...top, ...bottom] }, tol: 1, selection: ['F2.C1'] };

  it('hovering the top face boundary highlights the whole outline (four edges) and says so', () => {
    const out = run(blankDraft(), [move(30, 0.2)], env);
    expect(out.preview).toHaveLength(4);
    expect(out.hint).toBe('app.sketch.hint.offsetReference');
  });
  it('clicking it projects the outline as a real fixed loop and selects it; typing a distance and a side makes the inner loop', () => {
    const picked = run(blankDraft(), [click(30, 0.2)], env);
    const d1 = picked.draft;
    expect(d1.entities.filter((e) => e.type === 'line')).toHaveLength(4);
    expect(d1.entities.every((e) => e.ext === true && !e.construction)).toBe(true);
    expect((picked.state as { selected: string[] }).selected).toHaveLength(4);
    // Enter, move inside, type 5: the copy is inside
    const o = run(blankDraft(), [click(30, 0.2), key('Enter'), move(30, 20), field0(5)], env);
    const lines = o.draft.entities.filter((e) => e.type === 'line');
    expect(lines).toHaveLength(8);
    const inner = lines.slice(4);
    const box = bboxOf(pointsOf(o.draft, inner.flatMap((e) => [String(e.p1), String(e.p2)])));
    expect(box).toEqual({ x0: expect.closeTo(5, 6), x1: expect.closeTo(55, 6), y0: expect.closeTo(5, 6), y1: expect.closeTo(35, 6) });
    // outer + inner are two closed shapes: the extrude picker offers the ring
    const shapes = sketchShapes(toFeature(o.draft) as never);
    expect(shapes.filter((s) => s.kind === 'loop')).toHaveLength(2);
  });
  it('one click on the bottom outline also works (the nearest outline in the same plane is the chain)', () => {
    const o = run(blankDraft(), [click(30, 39.9)], { ...env, body: { ...env.body!, edges: [...bottom] } });
    expect((o.state as { selected: string[] }).selected).toHaveLength(4);
  });
  it('away from any edge nothing is picked and the hint names edges', () => {
    const o = run(blankDraft(), [click(30, 20)], env);
    expect(o.hint).toBe('app.sketch.hint.pickCurveOrEdge');
  });
  it('Offset the face outline: with a face selected the outer loop is selected, inward, 1 mm, ready to apply', () => {
    const o = run(blankDraft(), [key(OFFSET_FACE_KEY)], env);
    const st = o.state as { phase: string; live: number; fixedSide: number; selected: string[] };
    expect(st).toMatchObject({ phase: 'side', live: 1 });
    expect(st.selected).toHaveLength(4);
    expect(o.fields).toEqual([expect.objectContaining({ id: 'd', value: 1 })]);
    const done = run(blankDraft(), [key(OFFSET_FACE_KEY), key('Enter')], env);
    const lines = done.draft.entities.filter((e) => e.type === 'line');
    expect(lines).toHaveLength(8);
    const inner = bboxOf(pointsOf(done.draft, lines.slice(4).flatMap((e) => [String(e.p1), String(e.p2)])));
    expect(inner).toEqual({ x0: expect.closeTo(1, 6), x1: expect.closeTo(59, 6), y0: expect.closeTo(1, 6), y1: expect.closeTo(39, 6) });
    // F flips it outward
    const flipped = run(blankDraft(), [key(OFFSET_FACE_KEY), key('f'), key('Enter')], env);
    const fl = flipped.draft.entities.filter((e) => e.type === 'line').slice(4);
    expect(bboxOf(pointsOf(flipped.draft, fl.flatMap((e) => [String(e.p1), String(e.p2)]))).x0).toBeCloseTo(-1, 6);
  });
  it('the face with a hole: the outer loop is the one picked', () => {
    const hole: BodyEdge = { key: 'F2.hole', faces: ['F2.C1', 'wall'], pts: circlePts(30, 20, 5, 48, 10) };
    const e2: ToolEnv = { ...env, body: { ...env.body!, edges: [...top, ...bottom, hole] } };
    const chain = faceOuterLoop(e2)!;
    expect(chain).toHaveLength(4);
    const o = run(blankDraft(), [key(OFFSET_FACE_KEY)], e2);
    expect((o.state as { selected: string[] }).selected).toHaveLength(4);
  });
  it('no face outline known: a hint instead of an empty offset', () => {
    const o = run(blankDraft(), [key(OFFSET_FACE_KEY)], { ...env, selection: [] });
    expect(o.hint).toBe('app.sketch.hint.noFaceOutline');
  });
  it('a smooth outline of several free-form edges is one spline that can be offset', () => {
    const c = circlePts(30, 20, 20, 64, 10);
    const halfA: BodyEdge = { key: 'A', faces: ['F2.C1', 'w'], pts: c.slice(0, 33).map((p, i) => [p[0], p[1] + (i % 2 ? 0.2 : 0), 10]) };
    const halfB: BodyEdge = { key: 'B', faces: ['F2.C1', 'w'], pts: c.slice(32) };
    const o = run(blankDraft(), [key(OFFSET_FACE_KEY)], { body: { frame: { ...frame, o: [0, 0, 10] }, edges: [halfA, halfB] }, tol: 1, selection: ['F2.C1'] });
    expect(o.draft.entities.filter((e) => e.type === 'spline').length + o.draft.entities.filter((e) => e.type === 'circle').length).toBe(1);
  });
});

describe('curves of earlier sketches are reference edges', () => {
  it('turns the pickable curves of other sketches into world polylines and skips projected and construction ones', () => {
    const features = [
      { id: 'F1', type: 'sketch', points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 10, y: 0 }, { id: 'c', x: 5, y: 5 }], entities: [{ id: 'e1', type: 'line', p1: 'a', p2: 'b' }, { id: 'e2', type: 'circle', c: 'c', r: 2 }, { id: 'e3', type: 'line', p1: 'a', p2: 'b', construction: true }, { id: 'e4', type: 'line', p1: 'a', p2: 'b', ext: true }] },
      { id: 'F3', type: 'sketch', points: [], entities: [] },
    ];
    const edges = sketchReferenceEdges(features, () => ({ o: [0, 0, 5], x: [1, 0, 0], y: [0, 1, 0] }), 'F3');
    expect(edges.map((e) => e.key)).toEqual(['F1.e1', 'F1.e2']);
    expect(edges[0].pts).toEqual([[0, 0, 5], [10, 0, 5]]);
    // the sketch being edited is not its own reference; an edge that coincides with a body edge is left to the body
    expect(sketchReferenceEdges(features, () => ({ o: [0, 0, 5], x: [1, 0, 0], y: [0, 1, 0] }), 'F1')).toEqual([]);
    expect(sketchReferenceEdges(features, () => ({ o: [0, 0, 5], x: [1, 0, 0], y: [0, 1, 0] }), 'F3', [{ pts: [[10, 0, 5], [0, 0, 5]] }]).map((e) => e.key)).toEqual(['F1.e2']);
  });
  it('an old sketch curve on another plane is picked, projected and offset like a body edge', () => {
    const old = sketchReferenceEdges([{ id: 'F1', type: 'sketch', points: [{ id: 'c', x: 20, y: 20 }], entities: [{ id: 'e1', type: 'circle', c: 'c', r: 8 }] }], () => ({ o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0] }), 'F9');
    const env: ToolEnv = { body: { frame: { ...frame, o: [0, 0, 10] }, edges: old }, tol: 1 };
    const o = run(blankDraft(), [click(28, 20.1), key('Enter'), move(20, 20), field0(2)], env);
    const circles = o.draft.entities.filter((e) => e.type === 'circle');
    expect(circles.map((c) => c.r).sort()).toEqual([expect.closeTo(6, 5), expect.closeTo(8, 5)]);
  });
});
