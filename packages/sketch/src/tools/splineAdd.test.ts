import { describe, expect, it } from 'vitest';
import type { SketchDraft } from '../index';
import { fitCurve } from './splineMath';
import { DEFAULT_SETTINGS, type ToolEvent } from './types';
import { addSplinePoint, splineAddTool } from './splineAdd';
import { sketchTools } from '../registry';

const M = { shift: false, ctrl: false, alt: false };
const draft = (closed = false): SketchDraft => ({
  id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [],
  points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 10, y: 8 }, { id: 'p3', x: 25, y: -4 }, { id: 'p4', x: 40, y: 6 }],
  entities: [{ id: 'e1', type: 'spline', pts: ['p1', 'p2', 'p3', 'p4'], ...(closed ? { closed: true } : {}) }, { id: 'e2', type: 'line', p1: 'p1', p2: 'p4' }],
  constraints: [{ id: 'k1', type: 'fix', refs: ['p1'], value: [0, 0] }, { id: 'k2', type: 'tangent', refs: ['e1', 'e2'] }],
});
const pts = (d: SketchDraft) => d.entities.find((e) => e.id === 'e1')!.pts as string[];
const click = (entityId: string, x: number, y: number): ToolEvent => ({ type: 'click', at: { x, y }, snap: { kind: 'point', at: { x, y }, entityId }, mods: M });

describe('add spline point', () => {
  it('is in the draw group of the registry', () => {
    expect(sketchTools().find((t) => t.id === 'spline-add')?.group).toBe('draw');
  });
  it('inserts a point on the curve between the two data points, keeping id and constraints', () => {
    const d0 = draft();
    const near = fitCurve(['p1', 'p2', 'p3', 'p4'].map((id) => d0.points.find((p) => p.id === id)!), false).find((q) => q.x > 14 && q.x < 16)!;
    const r = addSplinePoint(d0, 'e1', { x: near.x + 0.2, y: near.y + 0.2 });
    if (!r.ok) throw new Error(r.hint);
    expect(pts(r.draft)).toEqual(['p1', 'p2', r.pointId, 'p3', 'p4']);
    expect(r.draft.points.find((p) => p.id === r.pointId)).toMatchObject({ x: r.at.x, y: r.at.y });
    expect(Math.hypot(r.at.x - near.x, r.at.y - near.y)).toBeLessThan(0.05);
    expect(r.draft.constraints).toEqual(d0.constraints);
    expect(pts(d0)).toEqual(['p1', 'p2', 'p3', 'p4']);   // the input is not touched
  });
  it('puts a point after the last data point of a closed spline at the end of the list', () => {
    const d0 = draft(true);
    const wrap = fitCurve(d0.points, true);
    const mid = wrap[wrap.length - 9];   // inside the last span, from p4 back to p1
    const r = addSplinePoint(d0, 'e1', mid);
    if (!r.ok) throw new Error(r.hint);
    expect(pts(r.draft)).toHaveLength(5);
    expect(pts(r.draft)[4]).toBe(r.pointId);
  });
  it('refuses a data point, a line and a click on nothing', () => {
    expect(addSplinePoint(draft(), 'e1', { x: 10, y: 8 })).toMatchObject({ ok: false, hint: 'app.sketch.hint.splineAddAtPoint' });
    expect(addSplinePoint(draft(), 'e2', { x: 10, y: 3 })).toMatchObject({ ok: false, hint: 'app.sketch.hint.splineAddPick' });
    const o = splineAddTool.step({}, { type: 'click', at: { x: 5, y: 5 }, mods: M }, draft(), DEFAULT_SETTINGS);
    expect(o.hint).toBe('app.sketch.hint.splineAddPick');
    expect(o.draft.points).toHaveLength(4);
  });
  it('adds through the tool and previews the place on hover', () => {
    const d0 = draft();
    const hov = splineAddTool.step({}, { type: 'move', at: { x: 18, y: 3 }, snap: { kind: 'point', at: { x: 18, y: 3 }, entityId: 'e1' }, mods: M }, d0, DEFAULT_SETTINGS);
    expect(hov.preview).toHaveLength(1);
    const o = splineAddTool.step({}, click('e1', 18, 3), d0, DEFAULT_SETTINGS);
    expect(o.draft.points).toHaveLength(5);
    expect(o.hint).toBe('app.sketch.hint.splineAdded');
  });
});
