import { describe, expect, it } from 'vitest';
import type { SketchDraft } from '../index';
import { DEFAULT_SETTINGS, type Modifiers, type Tool, type ToolEvent, type ToolOutput } from './types';
import { splineTool } from './spline';
import { cvsplineTool } from './cvspline';
import { bsplineCurve, extentOf, fitCurve } from './splineMath';

const M: Modifiers = { shift: false, ctrl: false, alt: false };
const empty = (): SketchDraft => ({ id: 'F1', plane: { kind: 'std', id: 'front' }, points: [], entities: [], constraints: [], temp: [] });
function run<S>(tool: Tool<S>, events: ToolEvent[], draft: SketchDraft = empty()): ToolOutput<S> {
  let out: ToolOutput<S> = { state: tool.start(), draft, preview: [], fields: [] };
  for (const ev of events) out = tool.step(out.state, ev, out.draft, DEFAULT_SETTINGS);
  return out;
}
const click = (x: number, y: number): ToolEvent => ({ type: 'click', at: { x, y }, mods: M });
const move = (x: number, y: number): ToolEvent => ({ type: 'move', at: { x, y }, mods: M });
const onPoint = (type: 'move' | 'click', x: number, y: number, pointId: string): ToolEvent =>
  ({ type, at: { x, y }, snap: { kind: 'point', at: { x, y }, pointId }, mods: M });
const key = (k: string): ToolEvent => ({ type: 'key', key: k });
const ids = (o: ToolOutput<unknown>) => o.draft.points.map((p) => p.id);

describe('fit spline tool', () => {
  it('collects points and finishes on Enter with one spline entity through them', () => {
    const o = run(splineTool, [click(0, 0), click(10, 5), click(20, 0), key('Enter')]);
    expect(o.draft.points.map((p) => [p.x, p.y])).toEqual([[0, 0], [10, 5], [20, 0]]);
    expect(o.draft.entities).toEqual([{ id: 'e1', type: 'spline', pts: ['p1', 'p2', 'p3'] }]);
    expect(o.state.pts).toEqual([]);
  });

  it('writes nothing but points until it is finished', () => {
    const o = run(splineTool, [click(0, 0), click(10, 5), click(20, 0)]);
    expect(o.draft.entities).toEqual([]);
    expect(o.state.pts).toEqual(['p1', 'p2', 'p3']);
  });

  it('a second click on the last point (double click) finishes without adding a point', () => {
    const o = run(splineTool, [click(0, 0), click(10, 5), click(20, 0), click(20, 0)]);
    expect(o.draft.points).toHaveLength(3);
    expect(o.draft.entities[0]).toMatchObject({ type: 'spline', pts: ['p1', 'p2', 'p3'] });
    const snapped = run(splineTool, [click(0, 0), click(10, 5), onPoint('click', 10, 5, 'p2')]);
    expect(snapped.draft.entities[0]).toMatchObject({ pts: ['p1', 'p2'] });
  });

  it('clicking the first point closes the spline and does not duplicate it', () => {
    const o = run(splineTool, [click(0, 0), click(10, 10), click(20, 0), onPoint('click', 0, 0, 'p1')]);
    expect(o.draft.points).toHaveLength(3);
    expect(o.draft.entities).toEqual([{ id: 'e1', type: 'spline', pts: ['p1', 'p2', 'p3'], closed: true }]);
  });

  it('reuses a snapped existing point and keeps it when cancelled', () => {
    const base = run(splineTool, [click(5, 5), click(9, 9), key('Enter')]).draft;
    const o = run(splineTool, [onPoint('click', 5, 5, 'p1'), click(20, 3), click(30, 9), key('Enter')], base);
    expect(o.draft.entities[1]).toMatchObject({ pts: ['p1', 'p3', 'p4'] });
    const c = run(splineTool, [onPoint('click', 5, 5, 'p1'), click(20, 3), key('Escape')], base);
    expect(ids(c)).toEqual(['p1', 'p2']);                 // p1 and p2 belong to the first spline; the new p3 is gone
    expect(c.state.pts).toEqual([]);
  });

  it('Escape cancels: the points it added are removed and no entity is written', () => {
    const o = run(splineTool, [click(0, 0), click(10, 5), key('Escape')]);
    expect(o.draft.points).toEqual([]);
    expect(o.draft.entities).toEqual([]);
  });

  it('degenerate: finishing with a single point says it needs more and keeps the point', () => {
    const o = run(splineTool, [click(0, 0), key('Enter')]);
    expect(o.hint).toBe('app.sketch.hint.needPoints');
    expect(o.draft.entities).toEqual([]);
    expect(o.state.pts).toEqual(['p1']);
    const dbl = run(splineTool, [click(0, 0), click(0, 0)]);   // double click on the very first point
    expect(dbl.hint).toBe('app.sketch.hint.needPoints');
    expect(dbl.draft.points).toHaveLength(1);
  });

  it('degenerate: with two points a closing click cannot close (needs three) and adds nothing', () => {
    const o = run(splineTool, [click(0, 0), click(10, 0), onPoint('click', 0, 0, 'p1')]);
    expect(o.hint).toBe('app.sketch.hint.needPoints');
    expect(o.draft.entities).toEqual([]);
    expect(o.state.pts).toEqual(['p1', 'p2']);
  });

  it('degenerate: a repeated point (by position or by id) is refused with a hint', () => {
    const o = run(splineTool, [click(0, 0), click(10, 0), click(20, 5), click(10, 0)]);
    expect(o.hint).toBe('app.sketch.hint.degenerate');
    expect(o.draft.points).toHaveLength(3);
    const byId = run(splineTool, [click(0, 0), click(10, 0), click(20, 5), onPoint('click', 3, 3, 'p2')]);
    expect(byId.hint).toBe('app.sketch.hint.degenerate');
    expect(byId.state.pts).toEqual(['p1', 'p2', 'p3']);
  });

  it('two points make a valid (straight) spline', () => {
    const o = run(splineTool, [click(0, 0), click(10, 0), key('Enter')]);
    expect(o.draft.entities[0]).toMatchObject({ type: 'spline', pts: ['p1', 'p2'] });
  });

  it('the preview is the interpolating curve through the points and the pointer', () => {
    const o = run(splineTool, [click(0, 0), click(10, 10), move(20, 0)]);
    expect(o.preview.length).toBeGreaterThan(20);        // a real curve, not three chords
    const starts = o.preview.map((s) => (s.kind === 'line' ? s.a : s.c));
    expect(starts[0]).toEqual({ x: 0, y: 0 });
    // it passes through the middle point
    expect(starts.some((q) => Math.hypot(q.x - 10, q.y - 10) < 1e-9)).toBe(true);
    const ends = o.preview.map((s) => (s.kind === 'line' ? s.b : s.c));
    expect(ends[ends.length - 1]).toEqual({ x: 20, y: 0 });
  });

  it('shows nothing before the first click, and just the pointer segment after it', () => {
    expect(run(splineTool, [move(3, 3)]).preview).toEqual([]);
    const o = run(splineTool, [click(0, 0), move(10, 0)]);
    expect(o.preview.length).toBeGreaterThan(0);
  });

  it('reports a pending close while the pointer is on the first point with enough points', () => {
    const o = run(splineTool, [click(0, 0), click(10, 10), click(20, 0), onPoint('move', 0, 0, 'p1')]);
    expect(o.pending).toEqual(['close']);
    const few = run(splineTool, [click(0, 0), click(10, 10), onPoint('move', 0, 0, 'p1')]);
    expect(few.pending).toBeUndefined();
  });

  it('does not mutate the draft it was given', () => {
    const d = empty();
    splineTool.step(splineTool.start(), click(1, 1), d, DEFAULT_SETTINGS);
    expect(d.points).toEqual([]);
  });
});

describe('control-point spline tool', () => {
  const four = [click(0, 0), click(10, 10), click(20, 10), click(30, 0)];

  it('defaults to degree 3 and writes it explicitly', () => {
    expect(cvsplineTool.start().degree).toBe(3);
    const o = run(cvsplineTool, [...four, key('Enter')]);
    expect(o.draft.entities).toEqual([{ id: 'e1', type: 'cvspline', pts: ['p1', 'p2', 'p3', 'p4'], degree: 3 }]);
  });

  it('the degree field switches it, also mid-draw, and null restores 3', () => {
    let o = run(cvsplineTool, [click(0, 0), click(10, 10), click(20, 0), { type: 'field', id: 'degree', value: 2 }]);
    expect(o.state.degree).toBe(2);
    o = cvsplineTool.step(o.state, key('Enter'), o.draft, DEFAULT_SETTINGS);
    expect(o.draft.entities[0]).toMatchObject({ type: 'cvspline', degree: 2, pts: ['p1', 'p2', 'p3'] });
    expect(o.state.degree).toBe(2);                      // the choice survives into the next curve
    o = cvsplineTool.step(o.state, { type: 'field', id: 'degree', value: null }, o.draft, DEFAULT_SETTINGS);
    expect(o.state.degree).toBe(3);
    o = cvsplineTool.step(o.state, { type: 'field', id: 'degree', value: 42 }, o.draft, DEFAULT_SETTINGS);
    expect(o.state.degree).toBe(9);                      // clamped to the kernel's range
    o = cvsplineTool.step(o.state, { type: 'field', id: 'other', value: 5 }, o.draft, DEFAULT_SETTINGS);
    expect(o.state.degree).toBe(9);
  });

  it('degenerate: too few points for the degree keeps drawing with a hint', () => {
    const o = run(cvsplineTool, [click(0, 0), click(10, 10), click(20, 0), key('Enter')]);
    expect(o.hint).toBe('app.sketch.hint.needPoints');
    expect(o.draft.entities).toEqual([]);
    expect(o.state.pts).toHaveLength(3);
    const one = run(cvsplineTool, [click(0, 0), key('Enter')]);
    expect(one.hint).toBe('app.sketch.hint.needPoints');
  });

  it('degenerate: repeated points are refused', () => {
    const o = run(cvsplineTool, [click(0, 0), click(10, 10), click(10, 10)]);
    expect(o.draft.entities).toEqual([]);                // second click on the last point is a finish request
    expect(o.hint).toBe('app.sketch.hint.needPoints');
    const r = run(cvsplineTool, [click(0, 0), click(10, 10), click(20, 0), click(10, 10)]);
    expect(r.hint).toBe('app.sketch.hint.degenerate');
    expect(r.state.pts).toHaveLength(3);
  });

  it('closes on the first point once it has max(3, degree+1) points', () => {
    const o = run(cvsplineTool, [...four, click(15, -10), onPoint('click', 0, 0, 'p1')]);
    expect(o.draft.points).toHaveLength(5);
    expect(o.draft.entities[0]).toMatchObject({ type: 'cvspline', degree: 3, closed: true, pts: ['p1', 'p2', 'p3', 'p4', 'p5'] });
    const few = run(cvsplineTool, [click(0, 0), click(10, 10), click(20, 0), onPoint('click', 0, 0, 'p1')]);
    expect(few.hint).toBe('app.sketch.hint.needPoints');
    expect(few.draft.entities).toEqual([]);
    const quad = run(cvsplineTool, [{ type: 'field', id: 'degree', value: 2 }, click(0, 0), click(10, 10), click(20, 0), onPoint('click', 0, 0, 'p1')]);
    expect(quad.draft.entities[0]).toMatchObject({ degree: 2, closed: true });
  });

  it('Escape cancels and removes what it added', () => {
    const o = run(cvsplineTool, [...four, key('Escape')]);
    expect(o.draft.points).toEqual([]);
    expect(o.state.degree).toBe(3);
  });

  it('the preview is the control polygon first, then the sampled curve', () => {
    const o = run(cvsplineTool, [...four.slice(0, 3), move(30, 0)]);
    const segs = o.preview.filter((s) => s.kind === 'line');
    expect(segs.length).toBe(3 + 64);                    // 4 polygon points (3 picked + pointer), then 64 curve segments
    const poly = segs.slice(0, 3) as Array<{ a: { x: number; y: number }; b: { x: number; y: number } }>;
    expect(poly[0].a).toEqual({ x: 0, y: 0 });
    expect(poly[2].b).toEqual({ x: 30, y: 0 });
    const curve = segs.slice(3) as typeof poly;
    expect(curve[0].a).toEqual({ x: 0, y: 0 });          // clamped: starts on the first control point
    expect(curve[curve.length - 1].b.x).toBeCloseTo(30, 9);
  });

  it('with fewer points than the degree allows, the preview drops to the degree that fits', () => {
    const o = run(cvsplineTool, [click(0, 0), move(10, 0)]);
    expect(o.preview.length).toBe(1 + 64);               // polygon of one segment, curve is the straight degree-1 line
  });
});

describe('spline preview maths', () => {
  it('the fit curve passes through every point and stays inside a sane extent', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 8 }, { x: 25, y: -4 }, { x: 40, y: 6 }];
    const c = fitCurve(pts, false, 16);
    for (const p of pts) expect(c.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-9)).toBe(true);
    expect(c).toHaveLength(3 * 16 + 1);
    const e = extentOf(c);
    expect(e.min.x).toBeCloseTo(0, 9);
    expect(e.max.x).toBeCloseTo(40, 9);
  });

  it('a closed fit curve returns to its start; degenerate input gives no curve', () => {
    const c = fitCurve([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }], true);
    expect(c[c.length - 1]).toEqual(c[0]);
    expect(fitCurve([{ x: 1, y: 1 }], false)).toEqual([]);
    expect(fitCurve([{ x: 1, y: 1 }, { x: 1, y: 1 }], false)).toEqual([]);          // repeated points collapse
    expect(fitCurve([{ x: 0, y: 0 }, { x: 5, y: 0 }], true)).toEqual([]);           // closed needs three
  });

  it('a clamped B-spline starts and ends on its end control points and stays in the hull', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 20 }, { x: 20, y: 20 }, { x: 30, y: 0 }];
    const c = bsplineCurve(pts, 3, false);
    expect(c[0]).toEqual({ x: 0, y: 0 });
    expect(c[c.length - 1].x).toBeCloseTo(30, 9);
    const e = extentOf(c);
    expect(e.max.y).toBeCloseTo(15, 9);                  // a cubic Bezier through these peaks at 0.75 of the hull
    expect(bsplineCurve(pts, 4, false)).toEqual([]);     // degree 4 needs 5 points
    expect(bsplineCurve(pts, 3, true, 8)).toHaveLength(9);
  });
});
