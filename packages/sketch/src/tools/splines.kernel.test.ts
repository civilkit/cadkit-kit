import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { toFeature, type SketchDraft } from '../index';
import { DEFAULT_SETTINGS, type Pt, type Tool, type ToolEvent, type ToolOutput } from './types';
import { splineTool } from './spline';
import { cvsplineTool } from './cvspline';
import { lineTool } from './line';
import { bsplineCurve, extentOf, fitCurve } from './splineMath';

const M = { shift: false, ctrl: false, alt: false };
const click = (x: number, y: number): ToolEvent => ({ type: 'click', at: { x, y }, mods: M });
const onPoint = (x: number, y: number, pointId: string): ToolEvent => ({ type: 'click', at: { x, y }, snap: { kind: 'point', at: { x, y }, pointId }, mods: M });
const draft0 = (): SketchDraft => ({ id: 'F1', plane: { kind: 'std', id: 'front' }, points: [], entities: [], constraints: [], temp: [] });

function run<S>(tool: Tool<S>, events: ToolEvent[], draft: SketchDraft = draft0()): ToolOutput<S> {
  let out: ToolOutput<S> = { state: tool.start(), draft, preview: [], fields: [] };
  for (const ev of events) out = tool.step(out.state, ev, out.draft, DEFAULT_SETTINGS);
  return out;
}

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function build(draft: SketchDraft, depth = 5) {
  const doc = { ...emptyPart('Drawn'), features: [toFeature(draft), { type: 'extrude', op: 'add', sketch: 'F1', end: 'blind', depth, id: 'F2' }], seq: 3 } as unknown as PartDoc;
  const s = await Session.open(doc);
  sessions.push(s);
  return s.preview([], { sketchStatus: true });
}

const posOf = (d: SketchDraft, ids: string[]): Pt[] => ids.map((id) => { const p = d.points.find((q) => q.id === id)!; return { x: p.x, y: p.y }; });
/** Preview extent of whatever curve the preview shows, to compare with the kernel's solid. */
const previewExtent = (pts: Pt[]) => extentOf(pts);

describe('drawn splines are valid for the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('an open fit spline closed by a line extrudes; the kernel box matches the preview curve', async () => {
    const s = run(splineTool, [click(0, 0), click(10, 8), click(25, -4), click(40, 6), { type: 'key', key: 'Enter' }]);
    const o = run(lineTool, [onPoint(40, 6, 'p4'), onPoint(0, 0, 'p1')], s.draft);
    const r = await build(o.draft, 5);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.body!.sketches[0].status?.conflicts).toEqual([]);
    const ext = previewExtent(fitCurve(posOf(o.draft, ['p1', 'p2', 'p3', 'p4']), false, 64));
    const box = r.body!.box;
    expect(box.min[0]).toBeCloseTo(ext.min.x, 2);
    expect(box.max[0]).toBeCloseTo(ext.max.x, 2);
    expect(box.min[1]).toBeCloseTo(ext.min.y, 2);
    expect(box.max[1]).toBeCloseTo(ext.max.y, 2);
    expect(box.max[2] - box.min[2]).toBeCloseTo(5, 6);
  });

  it('a closed fit spline (closed by clicking the first point) extrudes and matches the preview', async () => {
    const o = run(splineTool, [click(0, 0), click(20, 5), click(30, 25), click(5, 30), onPoint(0, 0, 'p1')]);
    expect(o.draft.entities[0]).toMatchObject({ type: 'spline', closed: true });
    const r = await build(o.draft, 3);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.body!.sketches[0].status?.conflicts).toEqual([]);
    expect(r.body!.box.max[2] - r.body!.box.min[2]).toBeCloseTo(3, 6);
    const ext = previewExtent(fitCurve(posOf(o.draft, ["p1", "p2", "p3", "p4"]), true, 1024));
    const box = r.body!.box;
    // the kernel's box comes from a tessellated outline, which cuts curve extremes by up to ~0.01; the exact
    // sampled extent of the preview is the outer bound, so compare to one decimal
    for (const [k, v] of [[0, ext.min.x], [1, ext.min.y]] as const) { expect(box.min[k]).toBeCloseTo(v, 1); expect(box.min[k]).toBeGreaterThanOrEqual(v - 1e-6); }
    for (const [k, v] of [[0, ext.max.x], [1, ext.max.y]] as const) { expect(box.max[k]).toBeCloseTo(v, 1); expect(box.max[k]).toBeLessThanOrEqual(v + 1e-6); }
  });

  it('an open cubic control-point spline closed by a line extrudes; box matches the preview curve', async () => {
    const s = run(cvsplineTool, [click(0, 0), click(10, 20), click(25, 20), click(35, 0), { type: 'key', key: 'Enter' }]);
    const o = run(lineTool, [onPoint(35, 0, 'p4'), onPoint(0, 0, 'p1')], s.draft);
    const r = await build(o.draft, 4);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.body!.sketches[0].status?.conflicts).toEqual([]);
    const ext = previewExtent(bsplineCurve(posOf(o.draft, ['p1', 'p2', 'p3', 'p4']), 3, false, 256));
    const box = r.body!.box;
    expect(box.min[0]).toBeCloseTo(ext.min.x, 2);
    expect(box.max[0]).toBeCloseTo(ext.max.x, 2);
    expect(box.max[1]).toBeCloseTo(ext.max.y, 2);       // 15: three quarters of the hull, not the control points' 20
    expect(box.max[1]).toBeLessThan(19);
  });

  it('a closed periodic cubic control-point spline extrudes to a solid inside the control hull', async () => {
    const o = run(cvsplineTool, [click(0, 0), click(30, 0), click(30, 30), click(0, 30), onPoint(0, 0, 'p1')]);
    expect(o.draft.entities[0]).toMatchObject({ type: 'cvspline', degree: 3, closed: true });
    const r = await build(o.draft, 2);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.body!.sketches[0].status?.conflicts).toEqual([]);
    const ext = previewExtent(bsplineCurve(posOf(o.draft, ['p1', 'p2', 'p3', 'p4']), 3, true, 256));
    const box = r.body!.box;
    expect(box.min[0]).toBeCloseTo(ext.min.x, 2);
    expect(box.max[0]).toBeCloseTo(ext.max.x, 2);
    expect(box.min[1]).toBeCloseTo(ext.min.y, 2);
    expect(box.max[1]).toBeCloseTo(ext.max.y, 2);
  });

  it('a quadratic one (degree switched by the state field) is valid too', async () => {
    const s = run(cvsplineTool, [{ type: 'field', id: 'degree', value: 2 }, click(0, 0), click(15, 18), click(30, 0), { type: 'key', key: 'Enter' }]);
    const o = run(lineTool, [onPoint(30, 0, 'p3'), onPoint(0, 0, 'p1')], s.draft);
    const r = await build(o.draft, 4);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.body!.box.max[1]).toBeCloseTo(9, 2);       // a parabola peaks half way to the middle control point
  });
});
