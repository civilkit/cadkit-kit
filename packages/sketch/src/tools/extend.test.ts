import { describe, expect, it } from 'vitest';
import type { SketchDraft } from '../index';
import { DEFAULT_SETTINGS, type ToolEvent } from './types';
import { extendAt, extendTool, planExtend } from './extend';
import { blankDraft, rectDraft, resolves } from './edit-fixtures';

const M = { shift: false, ctrl: false, alt: false };
const clickOn = (entityId: string, x = 0, y = 0): ToolEvent => ({ type: 'click', at: { x, y }, snap: { kind: 'point', at: { x, y }, entityId }, mods: M });
const moveOn = (entityId: string, x = 0, y = 0): ToolEvent => ({ type: 'move', at: { x, y }, snap: { kind: 'point', at: { x, y }, entityId }, mods: M });
const pt = (d: SketchDraft, id: string) => d.points.find((p) => p.id === id)!;

/** A 40 x 20 rectangle plus a vertical stub from (10,5) to (10,12) that stops short of the top edge (y = 20). */
function stubDraft(): SketchDraft {
  const d = rectDraft(40, 20);
  return { ...d, points: [...d.points, { id: 'p5', x: 10, y: 5 }, { id: 'p6', x: 10, y: 12 }], entities: [...d.entities, { id: 'e5', type: 'line', p1: 'p5', p2: 'p6' }],
    constraints: [...d.constraints, { id: 'k5', type: 'vertical', refs: ['e5'] }, { id: 'k6', type: 'distance', refs: ['p5', 'p6'], value: 7 }, { id: 'k7', type: 'equal', refs: ['e5', 'e2'] }] };
}

describe('extend: lines', () => {
  it('carries the clicked end on to the nearest boundary and binds it with pointOnLine', () => {
    const d0 = stubDraft();
    const r = extendAt(d0, 'e5', { x: 10, y: 11 });
    if (!r.ok) throw new Error(r.hint);
    const e = r.draft.entities.find((x) => x.id === 'e5')!;
    expect(pt(r.draft, String(e.p2))).toMatchObject({ x: 10, y: 20 });
    expect(e.p1).toBe('p5');
    expect(r.draft.constraints.find((c) => c.type === 'pointOnLine')).toMatchObject({ refs: [e.p2, 'e3'] });
    expect(resolves(r.draft)).toBe(true);
  });
  it('the other end extends the other way (down to the bottom edge)', () => {
    const r = extendAt(stubDraft(), 'e5', { x: 10, y: 6 });
    if (!r.ok) throw new Error(r.hint);
    const e = r.draft.entities.find((x) => x.id === 'e5')!;
    expect(pt(r.draft, String(e.p1)).x).toBeCloseTo(10, 9);
    expect(pt(r.draft, String(e.p1)).y).toBeCloseTo(0, 9);
    expect(e.p2).toBe('p6');
  });
  it('drops equal/midpoint on the line and the old end point with its distance dimension; keeps vertical', () => {
    const r = extendAt(stubDraft(), 'e5', { x: 10, y: 11 });
    if (!r.ok) throw new Error(r.hint);
    expect(r.draft.points.some((p) => p.id === 'p6')).toBe(false);
    const types = r.draft.constraints.map((c) => c.type);
    expect(types).not.toContain('equal');
    expect(types).not.toContain('distance');
    expect(types).toContain('vertical');
  });
  it('reuses an existing point at the meeting place, so an outline closes with a shared point', () => {
    // bottom edge, a short left side, and a top edge that starts exactly above it
    const d: SketchDraft = {
      id: 'F1', plane: {}, temp: [], constraints: [],
      points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 40, y: 0 }, { id: 'p3', x: 0, y: 12 }, { id: 'p4', x: 0, y: 20 }, { id: 'p5', x: 40, y: 20 }],
      entities: [{ id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'line', p1: 'p1', p2: 'p3' }, { id: 'e3', type: 'line', p1: 'p4', p2: 'p5' }],
    };
    const r = extendAt(d, 'e2', { x: 0, y: 11 });
    if (!r.ok) throw new Error(r.hint);
    expect(r.draft.entities.find((e) => e.id === 'e2')).toMatchObject({ p1: 'p1', p2: 'p4' });
    expect(r.draft.constraints.some((c) => c.type === 'pointOnLine')).toBe(false);
    expect(r.draft.points).toHaveLength(4);                      // p3 dropped, nothing added
  });
  it('a shared end point stays for the other entity', () => {
    // two lines sharing p2; extending e5 from the shared end keeps p2 for the other line
    const d: SketchDraft = {
      id: 'F1', plane: {}, temp: [], constraints: [],
      points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 5, y: 0 }, { id: 'p3', x: 5, y: 5 }, { id: 'p4', x: 20, y: -5 }, { id: 'p5', x: 20, y: 5 }],
      entities: [{ id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'line', p1: 'p2', p2: 'p3' }, { id: 'e3', type: 'line', p1: 'p4', p2: 'p5' }],
    };
    const r = extendAt(d, 'e1', { x: 4, y: 0 });
    if (!r.ok) throw new Error(r.hint);
    expect(r.draft.points.some((p) => p.id === 'p2')).toBe(true);
    expect(r.draft.entities.find((e) => e.id === 'e2')).toMatchObject({ p1: 'p2' });
    expect(pt(r.draft, String(r.draft.entities.find((e) => e.id === 'e1')!.p2))).toMatchObject({ x: 20, y: 0 });
  });
  it('nothing ahead: refuses with a hint; a circle and a missing entity are refused', () => {
    const d = blankDraft();
    const solo: SketchDraft = { ...d, points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 5, y: 0 }, { id: 'p3', x: 0, y: 9 }], entities: [{ id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'circle', c: 'p3', r: 1 }] };
    expect(extendAt(solo, 'e1', { x: 4, y: 0 })).toEqual({ ok: false, hint: 'app.sketch.hint.nothingToExtend' });
    expect(extendAt(solo, 'e2', { x: 0, y: 0 })).toEqual({ ok: false, hint: 'app.sketch.hint.pickExtendable' });
    expect(extendAt(solo, 'zz', { x: 0, y: 0 })).toEqual({ ok: false, hint: 'app.sketch.hint.pickExtendable' });
  });
  it('does not extend backwards: a boundary behind the end is ignored', () => {
    const d = stubDraft();
    const plan = planExtend(d, 'e5', { x: 10, y: 11 });
    expect(typeof plan).toBe('object');
    if (typeof plan === 'object') expect(plan.to.at.y).toBeCloseTo(20, 9);
  });
  it('does not mutate the draft', () => {
    const d = stubDraft(); const copy = JSON.stringify(d);
    extendAt(d, 'e5', { x: 10, y: 11 });
    expect(JSON.stringify(d)).toBe(copy);
  });
});

describe('extend: arcs', () => {
  // a quarter arc about the origin from (10,0) to (0,10), and a vertical line x = -6 and a horizontal line y = -4 as boundaries
  const arcDraft = (): SketchDraft => ({
    id: 'F1', plane: {}, temp: [],
    points: [{ id: 'c', x: 0, y: 0 }, { id: 'p1', x: 10, y: 0 }, { id: 'p2', x: 0, y: 10 }, { id: 'l1', x: -6, y: -20 }, { id: 'l2', x: -6, y: 20 }, { id: 'm1', x: -20, y: -4 }, { id: 'm2', x: 20, y: -4 }],
    entities: [{ id: 'e1', type: 'arc', c: 'c', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'line', p1: 'l1', p2: 'l2' }, { id: 'e3', type: 'line', p1: 'm1', p2: 'm2' }],
    constraints: [{ id: 'k1', type: 'radius', refs: ['e1'], value: 10 }],
  });
  it('the end near the click carries on counter-clockwise to the next boundary: pointOnCircle... no, on the line', () => {
    const r = extendAt(arcDraft(), 'e1', { x: 1, y: 9.9 });          // near p2
    if (!r.ok) throw new Error(r.hint);
    const e = r.draft.entities.find((x) => x.id === 'e1')!;
    expect(e.p1).toBe('p1');
    const end = pt(r.draft, String(e.p2));
    expect(end.x).toBeCloseTo(-6, 9);
    expect(end.y).toBeCloseTo(8, 9);                                  // sqrt(100 - 36)
    expect(r.draft.constraints.find((c) => c.type === 'pointOnLine')).toMatchObject({ refs: [e.p2, 'e2'] });
    expect(r.draft.constraints.find((c) => c.type === 'radius')).toBeDefined();
  });
  it('the start end carries on clockwise', () => {
    const r = extendAt(arcDraft(), 'e1', { x: 9.9, y: 1 });          // near p1
    if (!r.ok) throw new Error(r.hint);
    const e = r.draft.entities.find((x) => x.id === 'e1')!;
    expect(e.p2).toBe('p2');
    const start = pt(r.draft, String(e.p1));
    expect(start.y).toBeCloseTo(-4, 9);
    expect(start.x).toBeCloseTo(Math.sqrt(84), 9);
  });
  it('the arc never wraps past its own other end', () => {
    // a nearly full arc (gap of 20 degrees) with a boundary only on the far side of its own span
    const d: SketchDraft = {
      id: 'F1', plane: {}, temp: [], constraints: [],
      points: [{ id: 'c', x: 0, y: 0 }, { id: 'p1', x: 10, y: 0 }, { id: 'p2', x: 9.396926, y: -3.420201 }, { id: 'a', x: -20, y: 5 }, { id: 'b', x: 20, y: 5 }],
      entities: [{ id: 'e1', type: 'arc', c: 'c', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'line', p1: 'a', p2: 'b' }],
    };
    expect(extendAt(d, 'e1', { x: 9.4, y: -3.4 })).toEqual({ ok: false, hint: 'app.sketch.hint.nothingToExtend' });
  });
  it('a boundary that is a circle works (arc extended onto a crossing circle)', () => {
    const d = arcDraft();
    const withCircle: SketchDraft = { ...d, points: [...d.points, { id: 'q', x: 0, y: 14 }], entities: [{ id: 'e1', type: 'arc', c: 'c', p1: 'p1', p2: 'p2' }, { id: 'e4', type: 'circle', c: 'q', r: 6 }] };
    const r = extendAt(withCircle, 'e1', { x: 1, y: 9.9 });
    if (!r.ok) throw new Error(r.hint);
    expect(r.draft.constraints.find((c) => c.type === 'pointOnCircle')).toMatchObject({ refs: [expect.any(String), 'e4'] });
  });
});

describe('extend tool', () => {
  it('hovering previews the added piece; a click extends and leaves the tool ready', () => {
    const d = stubDraft();
    const mv = extendTool.step({}, moveOn('e5', 10, 11), d, DEFAULT_SETTINGS);
    expect(mv.preview).toEqual([{ kind: 'line', a: { x: 10, y: 12 }, b: { x: 10, y: 20 } }]);
    expect(mv.draft).toBe(d);
    const c = extendTool.step({}, clickOn('e5', 10, 11), d, DEFAULT_SETTINGS);
    expect(c.draft).not.toBe(d);
    expect(c.state).toEqual({});
  });
  it('a click on nothing, or on something with nothing ahead, hints', () => {
    const d = stubDraft();
    expect(extendTool.step({}, { type: 'click', at: { x: 1, y: 1 }, mods: M }, d, DEFAULT_SETTINGS).hint).toBe('app.sketch.hint.pickExtendable');
    expect(extendTool.step({}, clickOn('e1', 20, 0), d, DEFAULT_SETTINGS).hint).toBe('app.sketch.hint.nothingToExtend');
  });
});
