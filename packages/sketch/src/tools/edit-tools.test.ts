import { describe, expect, it } from 'vitest';
import type { SketchDraft } from '../index';
import { DEFAULT_SETTINGS, type Tool, type ToolEvent, type ToolOutput } from './types';
import { filletTool } from './fillet';
import { chamferTool } from './chamfer';
import { planTrim, trimAt, trimTool } from './trim';
import { mirrorEntities, mirrorTool } from './mirror';
import { blankDraft, rectDraft, resolves } from './edit-fixtures';

const M = { shift: false, ctrl: false, alt: false };
const clickOn = (entityId: string, x = 0, y = 0): ToolEvent => ({ type: 'click', at: { x, y }, snap: { kind: 'point', at: { x, y }, entityId }, mods: M });
const field = (id: string, value: number, commit = true): ToolEvent => ({ type: 'field', id, value, commit });
function run<S>(tool: Tool<S>, draft: SketchDraft, events: ToolEvent[]): ToolOutput<S> {
  let out: ToolOutput<S> = { state: tool.start(), draft, preview: [], fields: [] };
  for (const ev of events) out = tool.step(out.state, ev, out.draft, DEFAULT_SETTINGS);
  return out;
}
const pt = (d: SketchDraft, id: string) => d.points.find((p) => p.id === id)!;
const withExtra = (d: SketchDraft, points: SketchDraft['points'], entities: SketchDraft['entities'], constraints: SketchDraft['constraints'] = []): SketchDraft =>
  ({ ...d, points: [...d.points, ...points], entities: [...d.entities, ...entities], constraints: [...d.constraints, ...constraints] });

describe('fillet tool', () => {
  it('replaces a corner with a tangent counter-clockwise arc and shortens both lines', () => {
    const o = run(filletTool, rectDraft(30, 20), [field('r', 6), clickOn('e1'), clickOn('e2')]);
    const d = o.draft;
    const arc = d.entities.find((e) => e.type === 'arc')!;
    expect(pt(d, String(arc.p1))).toMatchObject({ x: 24, y: 0 });          // bottom tangent point first: counter-clockwise
    expect(pt(d, String(arc.p2))).toMatchObject({ x: 30 });
    expect(pt(d, String(arc.p2)).y).toBeCloseTo(6, 9);
    expect(pt(d, String(arc.c))).toMatchObject({ x: 24 });
    expect(d.entities.find((e) => e.id === 'e1')).toMatchObject({ p1: 'p1', p2: arc.p1 });
    expect(d.entities.find((e) => e.id === 'e2')).toMatchObject({ p1: arc.p2, p2: 'p3' });
    expect(d.points.some((p) => p.id === 'p2')).toBe(false);                // the old corner is gone
    expect(d.constraints.filter((c) => c.type === 'tangent').map((c) => c.refs)).toEqual([['e1', arc.id], ['e2', arc.id]]);
    expect(d.constraints.find((c) => c.type === 'radius')).toMatchObject({ refs: [arc.id], value: 6 });
    expect(resolves(d)).toBe(true);
  });

  it('does not mutate the draft it was given', () => {
    const d0 = rectDraft(30, 20);
    const snapshot = JSON.stringify(d0);
    run(filletTool, d0, [field('r', 5), clickOn('e1'), clickOn('e2')]);
    expect(JSON.stringify(d0)).toBe(snapshot);
  });

  it('waits for confirmation when the radius is only previewed, and previews the arc', () => {
    let o = run(filletTool, rectDraft(30, 20), [field('r', 5, false), clickOn('e1'), clickOn('e2')]);
    expect(o.draft.entities).toHaveLength(4);
    expect(o.preview.length).toBeGreaterThan(3);
    expect(o.fields[0]).toMatchObject({ id: 'r', value: 5, locked: false });
    o = filletTool.step(o.state, { type: 'key', key: 'Enter' }, o.draft, DEFAULT_SETTINGS);
    expect(o.draft.entities.some((e) => e.type === 'arc')).toBe(true);
    expect(o.draft.constraints.some((c) => c.type === 'radius')).toBe(false);   // not committed: no dimension
  });

  it('refuses a radius too large for the shorter line, keeps the corner pending, and applies once a smaller radius is committed', () => {
    let o = run(filletTool, rectDraft(30, 20), [field('r', 25), clickOn('e1'), clickOn('e2')]);
    expect(o.hint).toBe('app.sketch.hint.radiusTooLarge');
    expect(o.draft.entities).toHaveLength(4);
    o = filletTool.step(o.state, field('r', 8), o.draft, DEFAULT_SETTINGS);
    expect(o.hint).toBeUndefined();
    expect(o.draft.entities).toHaveLength(5);
  });

  it('refuses parallel (collinear) lines', () => {
    const d: SketchDraft = { ...rectDraft(10, 10), points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 5, y: 0 }, { id: 'p3', x: 10, y: 0 }], entities: [{ id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'line', p1: 'p2', p2: 'p3' }], constraints: [] };
    const o = run(filletTool, d, [field('r', 1), clickOn('e1'), clickOn('e2')]);
    expect(o.hint).toBe('app.sketch.hint.parallel');
    expect(o.draft.entities).toHaveLength(2);
  });

  it('hints when the picks are not lines, are the same line, or do not meet', () => {
    const d = withExtra(rectDraft(10, 10), [{ id: 'p9', x: 5, y: 5 }], [{ id: 'e9', type: 'circle', c: 'p9', r: 1 }]);
    expect(run(filletTool, d, [clickOn('e9')]).hint).toBe('app.sketch.hint.pickLine');
    expect(run(filletTool, d, [clickOn('e1'), clickOn('e1')]).hint).toBe('app.sketch.hint.pickOtherLine');
    expect(run(filletTool, d, [clickOn('e1'), clickOn('e3')]).hint).toBe('app.sketch.hint.noCorner');
    expect(run(filletTool, d, [{ type: 'click', at: { x: 5, y: 5 }, snap: { kind: 'point', at: { x: 5, y: 5 }, pointId: 'p9' }, mods: M }]).hint).toBe('app.sketch.hint.noCorner');
  });

  it('drops a dimension that referenced the removed corner but keeps unrelated constraints', () => {
    const d0 = rectDraft(30, 20);
    const d = { ...d0, constraints: [...d0.constraints, { id: 'k9', type: 'distance', refs: ['p1', 'p2'], value: 30 }, { id: 'k10', type: 'distance', refs: ['p3', 'p4'], value: 30 }] };
    const o = run(filletTool, d, [field('r', 4), clickOn('e1'), clickOn('e2')]);
    expect(o.draft.constraints.find((c) => c.id === 'k9')).toBeUndefined();
    expect(o.draft.constraints.find((c) => c.id === 'k10')).toBeDefined();
    expect(resolves(o.draft)).toBe(true);
  });

  it('keeps the corner point when a third entity still uses it', () => {
    const d = withExtra(rectDraft(30, 20), [{ id: 'p9', x: 40, y: 10 }], [{ id: 'e9', type: 'line', p1: 'p2', p2: 'p9' }]);
    const o = run(filletTool, d, [field('r', 4), clickOn('e1'), clickOn('e2')]);
    expect(o.draft.points.some((p) => p.id === 'p2')).toBe(true);
  });
});

describe('chamfer tool', () => {
  it('replaces the corner with a line between the cut points', () => {
    const o = run(chamferTool, rectDraft(30, 20), [field('d', 5), clickOn('e2'), clickOn('e3')]);
    const d = o.draft;
    const cut = d.entities.find((e) => e.id === 'e5')!;
    expect(cut.type).toBe('line');
    expect([pt(d, String(cut.p1)).x, pt(d, String(cut.p1)).y]).toEqual([30, 15]);
    expect([pt(d, String(cut.p2)).x, pt(d, String(cut.p2)).y]).toEqual([25, 20]);
    expect(d.points.some((p) => p.id === 'p3')).toBe(false);
    expect(resolves(d)).toBe(true);
  });
  it('refuses a distance as long as a side and parallel lines', () => {
    expect(run(chamferTool, rectDraft(30, 20), [field('d', 20), clickOn('e1'), clickOn('e2')]).hint).toBe('app.sketch.hint.distanceTooLarge');
    expect(run(chamferTool, rectDraft(30, 20), [field('d', 0)]).hint).toBe('app.sketch.hint.degenerate');
  });
  it('uses the last distance as the next default', () => {
    let o = run(chamferTool, rectDraft(30, 20), [field('d', 3), clickOn('e1'), clickOn('e2')]);
    o = chamferTool.step(o.state, clickOn('e2'), o.draft, DEFAULT_SETTINGS);
    expect(o.fields[0].value).toBe(3);
  });
});

describe('trim', () => {
  const cross = () => withExtra(rectDraft(40, 20), [{ id: 'p5', x: 20, y: -6 }, { id: 'p6', x: 20, y: 26 }], [{ id: 'e5', type: 'line', p1: 'p5', p2: 'p6' }]);

  it('a segment with no intersections is deleted whole, with its points and constraints', () => {
    const d = withExtra(rectDraft(10, 10), [{ id: 'p5', x: 50, y: 50 }, { id: 'p6', x: 60, y: 50 }], [{ id: 'e5', type: 'line', p1: 'p5', p2: 'p6' }], [{ id: 'k9', type: 'horizontal', refs: ['e5'] }, { id: 'k10', type: 'distance', refs: ['p5', 'p6'], value: 10 }]);
    const o = run(trimTool, d, [clickOn('e5', 55, 50)]);
    expect(o.draft.entities.map((e) => e.id)).toEqual(['e1', 'e2', 'e3', 'e4']);
    expect(o.draft.points.map((p) => p.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(o.draft.constraints.map((c) => c.id)).toEqual(['k1', 'k2', 'k3', 'k4']);
  });

  it('removes the overhang up to the nearest intersection and binds the cut to the cutter', () => {
    const r = trimAt(cross(), 'e5', { x: 20, y: 23 });
    if (!r.ok) throw new Error(r.hint);
    const e5 = r.draft.entities.find((e) => e.id === 'e5')!;
    expect(e5.p1).toBe('p5');
    expect(pt(r.draft, String(e5.p2))).toMatchObject({ x: 20, y: 20 });
    expect(r.draft.points.some((p) => p.id === 'p6')).toBe(false);
    expect(r.draft.constraints.find((c) => c.type === 'pointOnLine')).toMatchObject({ refs: [e5.p2, 'e3'] });
    expect(resolves(r.draft)).toBe(true);
  });

  it('a click between two intersections splits the line and copies its H/V constraint to the new piece', () => {
    const d = withExtra(rectDraft(40, 20), [{ id: 'p5', x: 10, y: -5 }, { id: 'p6', x: 10, y: 25 }, { id: 'p7', x: 30, y: -5 }, { id: 'p8', x: 30, y: 25 }],
      [{ id: 'e5', type: 'line', p1: 'p5', p2: 'p6' }, { id: 'e6', type: 'line', p1: 'p7', p2: 'p8' }]);
    const r = trimAt(d, 'e1', { x: 20, y: 0 });
    if (!r.ok) throw new Error(r.hint);
    const e1 = r.draft.entities.find((e) => e.id === 'e1')!;
    const piece = r.draft.entities.find((e) => e.id === 'e7')!;
    expect([pt(r.draft, String(e1.p2)).x, pt(r.draft, String(piece.p1)).x, piece.p2]).toEqual([10, 30, 'p2']);
    expect(r.draft.constraints.filter((c) => c.type === 'horizontal').map((c) => c.refs?.[0])).toContain('e7');
    expect(resolves(r.draft)).toBe(true);
  });

  it('reuses an existing point where the cutter ends on the target (shared point ids)', () => {
    const d = withExtra(rectDraft(40, 20), [{ id: 'p5', x: 20, y: 0 }, { id: 'p6', x: 20, y: 30 }], [{ id: 'e5', type: 'line', p1: 'p5', p2: 'p6' }]);
    const r = trimAt(d, 'e1', { x: 5, y: 0 });                         // nothing cuts e1 at p5 except e5's end: cut at x=20 reuses p5
    if (!r.ok) throw new Error(r.hint);
    expect(r.draft.entities.find((e) => e.id === 'e1')).toMatchObject({ p1: 'p5', p2: 'p2' });
    expect(r.draft.points.filter((p) => p.x === 20 && p.y === 0)).toHaveLength(1);
  });

  it('trims an arc to the nearest cut on each side', () => {
    const d = withExtra(blankDraft(), [{ id: 'p5', x: 0, y: 0 }, { id: 'p6', x: 5, y: 0 }, { id: 'p7', x: -5, y: 0 }, { id: 'p8', x: -10, y: 2 }, { id: 'p9', x: 10, y: 2 }],
      [{ id: 'e5', type: 'arc', c: 'p5', p1: 'p6', p2: 'p7' }, { id: 'e6', type: 'line', p1: 'p8', p2: 'p9' }]);
    // upper half circle r=5 crosses y=2 at x=+-4.58; click the top, remove between, keep both feet
    const r = trimAt(d, 'e5', { x: 0, y: 5 });
    if (!r.ok) throw new Error(r.hint);
    const arcs = r.draft.entities.filter((e) => e.type === 'arc');
    expect(arcs).toHaveLength(2);
    expect(arcs[0]).toMatchObject({ p1: 'p6' });
    expect(arcs[1]).toMatchObject({ p2: 'p7', c: 'p5' });
    expect(pt(r.draft, String(arcs[0].p2)).x).toBeCloseTo(Math.sqrt(21), 9);
    expect(r.draft.constraints.filter((c) => c.type === 'pointOnLine')).toHaveLength(2);
    expect(resolves(r.draft)).toBe(true);
  });

  it('a circle needs two cut points: one is refused, none deletes it', () => {
    const d = withExtra(rectDraft(10, 10), [{ id: 'p5', x: 5, y: 0 }], [{ id: 'e5', type: 'circle', c: 'p5', r: 3 }]);
    // the bottom edge crosses it twice: this is fine
    expect(trimAt(d, 'e5', { x: 5, y: 3 }).ok).toBe(true);
    const one = withExtra(rectDraft(10, 10), [{ id: 'p5', x: 5, y: -2 }, { id: 'p6', x: 5, y: 0 }], [{ id: 'e5', type: 'circle', c: 'p5', r: 2 }]);
    const t = trimAt(one, 'e5', { x: 5, y: -4 });                          // tangent to the bottom edge: a single touch point
    expect(t).toEqual({ ok: false, hint: 'app.sketch.hint.trimNeedsTwo' });
    const far = withExtra(rectDraft(10, 10), [{ id: 'p5', x: 50, y: 50 }], [{ id: 'e5', type: 'circle', c: 'p5', r: 2 }]);
    const w = trimAt(far, 'e5', { x: 52, y: 50 });
    if (!w.ok) throw new Error(w.hint);
    expect(w.draft.entities.some((e) => e.id === 'e5')).toBe(false);
    expect(w.draft.points.some((p) => p.id === 'p5')).toBe(false);
  });

  it('tangent-touch: a line tangent to an arc end cuts it where it touches', () => {
    const d = withExtra(rectDraft(10, 10), [{ id: 'p5', x: 20, y: 0 }, { id: 'p6', x: 25, y: 0 }, { id: 'p7', x: 15, y: 0 }, { id: 'p8', x: 10, y: 5 }, { id: 'p9', x: 30, y: 5 }],
      [{ id: 'e5', type: 'arc', c: 'p5', p1: 'p6', p2: 'p7' }, { id: 'e6', type: 'line', p1: 'p8', p2: 'p9' }]);
    const plan = planTrim(d, 'e5', { x: 22, y: 4 });
    expect(typeof plan).toBe('object');
    if (typeof plan === 'string') return;
    expect(plan.lo).toBeUndefined();
    expect(plan.hi!.at.x).toBeCloseTo(20, 6);
    expect(plan.hi!.at.y).toBeCloseTo(5, 6);
  });

  it('drops equal/midpoint on a trimmed line and every constraint that would dangle', () => {
    const d = cross();
    const dd = { ...d, constraints: [...d.constraints, { id: 'k9', type: 'equal', refs: ['e5', 'e1'] }, { id: 'k10', type: 'distance', refs: ['p6', 'p5'], value: 32 }, { id: 'k11', type: 'tangent', refs: ['e5', 'e1'], at: 'p6' }, { id: 'k12', type: 'vertical', refs: ['e5'] }] };
    const r = trimAt(dd, 'e5', { x: 20, y: 23 });
    if (!r.ok) throw new Error(r.hint);
    expect(r.draft.constraints.map((c) => c.id)).toEqual(['k1', 'k2', 'k3', 'k4', 'k12', 'k13']);
    expect(resolves(r.draft)).toBe(true);
  });

  it('hover previews the removed span without touching the draft; hints on non-curves', () => {
    const d = cross();
    let o = trimTool.step(trimTool.start(), { type: 'move', at: { x: 20, y: 23 }, snap: { kind: 'point', at: { x: 20, y: 23 }, entityId: 'e5' }, mods: M }, d, DEFAULT_SETTINGS);
    expect(o.preview).toEqual([{ kind: 'line', a: { x: 20, y: 20 }, b: { x: 20, y: 26 } }]);
    expect(o.draft).toBe(d);
    o = trimTool.step(o.state, { type: 'click', at: { x: 0, y: 0 }, mods: M }, d, DEFAULT_SETTINGS);
    expect(o.hint).toBe('app.sketch.hint.pickCurve');
  });
});

describe('mirror', () => {
  it('copies the geometry across the line, sharing points on the axis, with symmetric [a, b, line] constraints', () => {
    const o = run(mirrorTool, rectDraft(10, 6), [clickOn('e1'), clickOn('e2'), clickOn('e3'), { type: 'key', key: 'Enter' }, clickOn('e4')]);
    const d = o.draft;
    expect(d.points.map((p) => [p.x, p.y])).toEqual([[0, 0], [10, 0], [10, 6], [0, 6], [-10, 0], [-10, 6]]);
    expect(d.entities.slice(4).map((e) => [e.p1, e.p2])).toEqual([['p1', 'p5'], ['p5', 'p6'], ['p6', 'p4']]);
    expect(d.constraints.filter((c) => c.type === 'symmetric').map((c) => c.refs)).toEqual([['p2', 'p5', 'e4'], ['p3', 'p6', 'e4']]);
    expect(resolves(d)).toBe(true);
    expect(o.state).toEqual({ phase: 'select', selected: [] });
  });

  it('mirrors an arc keeping it counter-clockwise, a circle by its centre, and ignores the mirror line itself', () => {
    const d0 = withExtra(rectDraft(10, 10), [{ id: 'p5', x: 3, y: 2 }, { id: 'p6', x: 6, y: 2 }, { id: 'p7', x: 3, y: 5 }, { id: 'p8', x: 8, y: 8 }],
      [{ id: 'e5', type: 'arc', c: 'p5', p1: 'p6', p2: 'p7' }, { id: 'e6', type: 'circle', c: 'p8', r: 1 }]);
    const r = mirrorEntities(d0, ['e5', 'e6', 'e1'], 'e1');            // e1 is the axis (y = 0)
    if (!r.ok) throw new Error(r.hint);
    const arc = r.draft.entities.find((e) => e.id === 'e7')!;
    expect(arc).toMatchObject({ type: 'arc' });
    expect(pt(r.draft, String(arc.c))).toMatchObject({ x: 3, y: -2 });
    expect(pt(r.draft, String(arc.p1))).toMatchObject({ x: 3, y: -5 });  // the mirror of the old p2
    expect(pt(r.draft, String(arc.p2))).toMatchObject({ x: 6, y: -2 });
    expect(r.draft.entities.find((e) => e.id === 'e8')).toMatchObject({ type: 'circle', r: 1 });
    expect(r.draft.entities).toHaveLength(8);
    expect(resolves(r.draft)).toBe(true);
  });

  it('hints: nothing selected, a non-line mirror, picking a non-entity', () => {
    const d = withExtra(rectDraft(10, 10), [{ id: 'p9', x: 5, y: 5 }], [{ id: 'e9', type: 'circle', c: 'p9', r: 1 }]);
    expect(run(mirrorTool, d, [{ type: 'key', key: 'Enter' }]).hint).toBe('app.sketch.hint.nothingToMirror');
    expect(run(mirrorTool, d, [{ type: 'click', at: { x: 1, y: 1 }, mods: M }]).hint).toBe('app.sketch.hint.pickEntity');
    expect(run(mirrorTool, d, [clickOn('e1'), { type: 'key', key: 'Enter' }, clickOn('e9')]).hint).toBe('app.sketch.hint.pickLine');
  });

  it('clicking a selected entity unselects it; Escape clears the selection', () => {
    const d = rectDraft(10, 10);
    expect(run(mirrorTool, d, [clickOn('e1'), clickOn('e1')]).state.selected).toEqual([]);
    expect(run(mirrorTool, d, [clickOn('e1'), clickOn('e2'), { type: 'key', key: 'Escape' }]).state.selected).toEqual([]);
  });
});
