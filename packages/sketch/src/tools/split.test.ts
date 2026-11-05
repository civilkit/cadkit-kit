import { describe, expect, it } from 'vitest';
import type { DraftEntity, SketchDraft } from '../index';
import { DEFAULT_SETTINGS, type ToolEvent } from './types';
import { splitAt, splitPoint, splitTool } from './split';
import { rectDraft, resolves } from './edit-fixtures';
import { sketchTools } from '../registry';

const M = { shift: false, ctrl: false, alt: false };
const clickOn = (entityId: string, x: number, y: number, pointId?: string): ToolEvent => ({ type: 'click', at: { x, y }, snap: { kind: 'point', at: { x, y }, entityId, ...(pointId ? { pointId } : {}) }, mods: M });
const pt = (d: SketchDraft, id: string) => d.points.find((p) => p.id === id)!;
const ent = (d: SketchDraft, id: string) => d.entities.find((e) => e.id === id)!;
const ok = (r: ReturnType<typeof splitAt>) => { if (!r.ok) throw new Error(r.hint); return r; };

describe('split: lines', () => {
  it('breaks a line in two at a shared new point; horizontal goes on both halves', () => {
    const d0 = rectDraft(40, 20);
    const r = ok(splitAt(d0, 'e1', { x: 15, y: 0.3 }));
    const a = ent(r.draft, 'e1'), b = r.draft.entities.find((e) => e.id !== 'e1' && e.type === 'line' && e.p1 === a.p2)!;
    expect(a.p1).toBe('p1');
    expect(b.p2).toBe('p2');
    expect(pt(r.draft, String(a.p2))).toMatchObject({ x: 15, y: 0 });
    expect(r.draft.constraints.filter((k) => k.type === 'horizontal' && (k.refs?.[0] === 'e1' || k.refs?.[0] === b.id))).toHaveLength(2);
    expect(r.draft.constraints.some((k) => k.type === 'parallel')).toBe(false);
    expect(r.dropped).toEqual([]);
    expect(resolves(r.draft)).toBe(true);
    expect(d0.entities).toHaveLength(4);   // the input is not touched
  });
  it('a slanted line gets a parallel between its halves; perpendicular / angle stay on the first; equal and midpoint are dropped and named', () => {
    const d0: SketchDraft = {
      id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [],
      points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 30, y: 10 }, { id: 'p3', x: 5, y: 20 }, { id: 'p4', x: 25, y: 20 }, { id: 'p5', x: 15, y: 5 }],
      entities: [{ id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'line', p1: 'p3', p2: 'p4' }],
      constraints: [
        { id: 'k1', type: 'equal', refs: ['e1', 'e2'] }, { id: 'k2', type: 'midpoint', refs: ['p5', 'e1'] }, { id: 'k3', type: 'angle', refs: ['e1', 'e2'], value: 18 },
        { id: 'k4', type: 'distance', refs: ['p1', 'p2'], value: 31.6 }, { id: 'k5', type: 'perpendicular', refs: ['e1', 'e2'] },
      ],
    };
    const r = ok(splitAt(d0, 'e1', { x: 10, y: 3.4 }));
    const types = r.draft.constraints.map((k) => k.type);
    expect(types).toContain('parallel');
    expect(types).toContain('angle');
    expect(types).toContain('perpendicular');
    expect(types).toContain('distance');              // the dimension across both halves still reads true
    expect(types).not.toContain('equal');
    expect(types).not.toContain('midpoint');
    expect([...r.dropped].sort()).toEqual(['equal', 'midpoint']);
    expect(r.draft.constraints.find((k) => k.type === 'parallel')!.refs![0]).toBe('e1');
    expect(resolves(r.draft)).toBe(true);
  });
  it('reuses a sketch point that lies on the line as the joint', () => {
    const d0 = { ...rectDraft(40, 20) };
    d0.points = [...d0.points, { id: 'p9', x: 10, y: 0 }];
    const r = ok(splitAt(d0, 'e1', { x: 10.2, y: 0 }, 'p9'));
    expect(ent(r.draft, 'e1').p2).toBe('p9');
    expect(r.draft.points).toHaveLength(5);
  });
  it('refuses an end, a degenerate line and a click off any curve', () => {
    const d0 = rectDraft(40, 20);
    expect(splitAt(d0, 'e1', { x: 0.0000001, y: 0 })).toMatchObject({ ok: false, hint: 'app.sketch.hint.splitAtEnd' });
    expect(splitAt(d0, 'e1', { x: 40, y: 0 }, 'p2')).toMatchObject({ ok: false, hint: 'app.sketch.hint.splitAtEnd' });
    expect(splitAt(d0, 'nope', { x: 1, y: 1 })).toMatchObject({ ok: false, hint: 'app.sketch.hint.splitPick' });
  });
  it('keeps the construction flag on both halves', () => {
    const d0 = rectDraft(40, 20);
    d0.entities = d0.entities.map((e) => (e.id === 'e3' ? { ...e, construction: true } : e));
    const r = ok(splitAt(d0, 'e3', { x: 20, y: 20 }));
    expect(r.draft.entities.filter((e) => e.construction === true)).toHaveLength(2);
  });
});

const arcDraft = (): SketchDraft => ({
  id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [],
  points: [{ id: 'c', x: 0, y: 0, fixed: true }, { id: 'p1', x: 10, y: 0 }, { id: 'p2', x: -10, y: 0 }, { id: 'p3', x: 30, y: 0 }, { id: 'p4', x: 30, y: 12 }],
  entities: [{ id: 'e1', type: 'arc', c: 'c', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'line', p1: 'p2', p2: 'p1' }, { id: 'e3', type: 'line', p1: 'p3', p2: 'p4' }],
  constraints: [{ id: 'k1', type: 'radius', refs: ['e1'], value: 10 }, { id: 'k2', type: 'tangent', refs: ['e1', 'e2'], at: 'p2' }, { id: 'k3', type: 'tangent', refs: ['e3', 'e1'] }, { id: 'k4', type: 'equal', refs: ['e1', 'e3'] }],
});

describe('split: arcs and circles', () => {
  it('breaks an arc about the same centre; radius and equal stay on the first piece; tangent goes with the end it touches', () => {
    const r = ok(splitAt(arcDraft(), 'e1', { x: 5, y: 8.6 }));
    const a = ent(r.draft, 'e1'), b = r.draft.entities.find((e) => e.type === 'arc' && e.id !== 'e1')!;
    expect(a).toMatchObject({ c: 'c', p1: 'p1' });
    expect(b).toMatchObject({ c: 'c', p2: 'p2', p1: a.p2 });
    expect(Math.hypot(pt(r.draft, String(a.p2)).x, pt(r.draft, String(a.p2)).y)).toBeCloseTo(10, 9);
    expect(r.draft.constraints.find((k) => k.id === 'k1')).toMatchObject({ refs: ['e1'] });
    expect(r.draft.constraints.find((k) => k.id === 'k4')).toMatchObject({ refs: ['e1', 'e3'] });
    // e2 shares p2 with the arc's second end: its tangent moves to the second piece; e3 touches neither end: stays on the first
    expect(r.draft.constraints.find((k) => k.id === 'k2')!.refs).toEqual([b.id, 'e2']);
    expect(r.draft.constraints.find((k) => k.id === 'k3')!.refs).toEqual(['e3', 'e1']);
    expect(r.dropped).toEqual([]);
    expect(resolves(r.draft)).toBe(true);
  });
  it('breaks a circle into two arcs between the picked place and its opposite; the radius dimension stays', () => {
    const d0: SketchDraft = {
      id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [],
      points: [{ id: 'c', x: 3, y: 4, fixed: true }], entities: [{ id: 'e1', type: 'circle', c: 'c', r: 8 }],
      constraints: [{ id: 'k1', type: 'diameter', refs: ['e1'], value: 16 }],
    };
    const r = ok(splitAt(d0, 'e1', { x: 3, y: 12.5 }));
    const [a, b] = r.draft.entities;
    expect(a).toMatchObject({ id: 'e1', type: 'arc', c: 'c' });
    expect('r' in a).toBe(false);
    expect(b).toMatchObject({ type: 'arc', c: 'c', p1: a.p2, p2: a.p1 });
    expect(pt(r.draft, String(a.p1))).toMatchObject({ x: 3, y: 12 });
    expect(pt(r.draft, String(a.p2)).x).toBeCloseTo(3, 9);
    expect(pt(r.draft, String(a.p2)).y).toBeCloseTo(-4, 9);
    expect(r.draft.constraints).toEqual([{ id: 'k1', type: 'diameter', refs: ['e1'], value: 16 }]);
  });
});

const splineDraft = (closed = false): SketchDraft => ({
  id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [],
  points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 10, y: 8 }, { id: 'p3', x: 25, y: -4 }, { id: 'p4', x: 40, y: 6 }],
  entities: [{ id: 'e1', type: 'spline', pts: ['p1', 'p2', 'p3', 'p4'], ...(closed ? { closed: true } : {}) }],
  constraints: [{ id: 'k1', type: 'fix', refs: ['p1'], value: [0, 0] }, { id: 'k2', type: 'tangent', refs: ['e1', 'e1'] }],
});

describe('split: splines', () => {
  it('splits an open fit spline between two data points: the joint is a data point of both halves, a point on the old curve', () => {
    const d0 = splineDraft();
    const r = ok(splitAt(d0, 'e1', { x: 18, y: 2 }));
    const a = ent(r.draft, 'e1'), b = r.draft.entities.find((e) => e.id !== 'e1')!;
    expect(a.pts).toHaveLength(3);
    expect((a.pts as string[]).slice(0, 2)).toEqual(['p1', 'p2']);
    expect((a.pts as string[])[0]).toBe('p1');
    const j = (a.pts as string[]).at(-1)!;
    expect((b.pts as string[])[0]).toBe(j);
    expect((b.pts as string[]).slice(1)).toEqual(['p3', 'p4']);
    expect(j).not.toMatch(/^p[1-4]$/);
    expect(r.dropped).toEqual(['tangent']);       // constraints on a spline cannot carry
    expect(r.draft.constraints.map((k) => k.type)).toEqual(['fix']);
  });
  it('splits at an existing data point without adding one', () => {
    const r = ok(splitAt(splineDraft(), 'e1', { x: 25, y: -4 }));
    expect(ent(r.draft, 'e1').pts).toEqual(['p1', 'p2', 'p3']);
    expect(r.draft.entities[1].pts).toEqual(['p3', 'p4']);
    expect(r.draft.points).toHaveLength(4);
  });
  it('refuses the ends of an open spline', () => {
    expect(splitAt(splineDraft(), 'e1', { x: 0, y: 0 })).toMatchObject({ ok: false, hint: 'app.sketch.hint.splitAtEnd' });
    expect(splitAt(splineDraft(), 'e1', { x: 40, y: 6 })).toMatchObject({ ok: false, hint: 'app.sketch.hint.splitAtEnd' });
  });
  it('a closed spline is cut at the joint and the data point on the far side: two open splines, both ends shared', () => {
    const d0: SketchDraft = { ...splineDraft(true), constraints: [] };
    const r = ok(splitAt(d0, 'e1', { x: 25, y: -4 }));
    const a = ent(r.draft, 'e1'), b = r.draft.entities[1];
    expect(a.closed).toBeUndefined();
    expect(b.closed).toBeUndefined();
    const ends = (e: DraftEntity) => [(e.pts as string[])[0], (e.pts as string[]).at(-1)!];
    expect(new Set([...ends(a), ...ends(b)]).size).toBe(2);
    expect(ends(a)[1]).toBe(ends(b)[0]);
    expect(ends(b)[1]).toBe(ends(a)[0]);
    expect((a.pts as string[]).length + (b.pts as string[]).length).toBe(6);   // 4 data points, two of them shared
    const e = ok(splitAt(d0, 'e1', { x: 17, y: 2 }));
    const [a2, b2] = [ent(e.draft, 'e1'), e.draft.entities[1]];
    expect((a2.pts as string[]).length).toBeGreaterThanOrEqual(2);
    expect((b2.pts as string[]).length).toBeGreaterThanOrEqual(2);
    expect(ends(a2)[1]).toBe(ends(b2)[0]);
    expect(ends(b2)[1]).toBe(ends(a2)[0]);
    expect(e.draft.points).toHaveLength(5);
  });
  it('control-point splines and ellipses are not split', () => {
    const d0: SketchDraft = { ...splineDraft(), entities: [{ id: 'e1', type: 'cvspline', pts: ['p1', 'p2', 'p3', 'p4'], degree: 3 }], constraints: [] };
    expect(splitAt(d0, 'e1', { x: 18, y: 2 })).toMatchObject({ ok: false, hint: 'app.sketch.hint.splitUnsupported' });
  });
});

describe('split tool', () => {
  it('is registered in the edit group', () => {
    expect(sketchTools().find((t) => t.id === 'split')).toMatchObject({ group: 'edit' });
  });
  it('a click splits and reports what it dropped; a hover previews the joint', () => {
    const d0 = rectDraft(40, 20);
    d0.constraints.push({ id: 'k9', type: 'midpoint', refs: ['p1', 'e1'] });
    const o = splitTool.step({}, clickOn('e1', 15, 0), d0, DEFAULT_SETTINGS);
    expect(o.draft.entities).toHaveLength(5);
    expect(o).toMatchObject({ hint: 'app.sketch.hint.splitDropped', dropped: ['midpoint'] });
    const sp = splitTool.step({}, clickOn('e1', 18, 2), splineDraft(), DEFAULT_SETTINGS);
    expect(sp).toMatchObject({ hint: 'app.sketch.hint.splitSplineDropped', dropped: ['tangent'] });
    expect(splitTool.step({}, clickOn('e1', 18, 2), { ...splineDraft(), constraints: [] }, DEFAULT_SETTINGS).hint).toBe('app.sketch.hint.splitSpline');
    const h = splitTool.step({}, { type: 'move', at: { x: 15, y: 1 }, snap: { kind: 'oncurve', at: { x: 15, y: 1 }, entityId: 'e1' }, mods: M }, d0, DEFAULT_SETTINGS);
    expect(h.draft).toBe(d0);
    expect(h.preview).toEqual([{ kind: 'circle', c: { x: 15, y: 0 }, r: expect.any(Number) }]);
    expect(splitPoint(d0, 'e1', { x: 15, y: 1 })).toEqual({ x: 15, y: 0 });
  });
  it('a click on nothing, or on an end, only says so', () => {
    const d0 = rectDraft(40, 20);
    expect(splitTool.step({}, { type: 'click', at: { x: 1, y: 1 }, mods: M }, d0, DEFAULT_SETTINGS)).toMatchObject({ hint: 'app.sketch.hint.splitPick' });
    const o = splitTool.step({}, clickOn('e1', 0, 0, 'p1'), d0, DEFAULT_SETTINGS);
    expect(o.draft).toBe(d0);
    expect(o.hint).toBe('app.sketch.hint.splitAtEnd');
  });
});
