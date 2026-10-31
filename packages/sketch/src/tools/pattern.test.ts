import { describe, expect, it } from 'vitest';
import type { SketchDraft } from '../index';
import { annotate } from '../annotations';
import { DEFAULT_SETTINGS, type Tool, type ToolEvent, type ToolOutput } from './types';
import { applyCircular, applyLinear, circularPatternTool, linearPatternTool } from './pattern';
import { rectDraft, resolves } from './edit-fixtures';

const M = { shift: false, ctrl: false, alt: false };
const clickOn = (entityId: string): ToolEvent => ({ type: 'click', at: { x: 0, y: 0 }, snap: { kind: 'point', at: { x: 0, y: 0 }, entityId }, mods: M });
const clickAt = (x: number, y: number, pointId?: string): ToolEvent => ({ type: 'click', at: { x, y }, ...(pointId ? { snap: { kind: 'point' as const, at: { x, y }, pointId } } : {}), mods: M });
const move = (x: number, y: number): ToolEvent => ({ type: 'move', at: { x, y }, mods: M });
const field = (id: string, value: number, commit = true): ToolEvent => ({ type: 'field', id, value, commit });
const key = (k: string): ToolEvent => ({ type: 'key', key: k });
function run<S>(tool: Tool<S>, draft: SketchDraft, events: ToolEvent[]): ToolOutput<S> {
  let out: ToolOutput<S> = { state: tool.start(), draft, preview: [], fields: [] };
  for (const ev of events) out = tool.step(out.state, ev, out.draft, DEFAULT_SETTINGS);
  return out;
}
const pt = (d: SketchDraft, id: string) => d.points.find((p) => p.id === id)!;
const all4 = ['e1', 'e2', 'e3', 'e4'];

describe('linear pattern geometry', () => {
  it('copies a rectangle n-1 times along the direction, sharing corners inside each copy', () => {
    const d0 = rectDraft(10, 5);
    const r = applyLinear(d0, all4, { n: 3, spacing: 15, angleDeg: 0 });
    if (!r.ok) throw new Error(r.hint);
    expect(r.draft.entities).toHaveLength(12);
    expect(r.draft.points).toHaveLength(12);
    const copy1 = r.draft.entities.slice(4, 8);
    const xs = copy1.flatMap((e) => [e.p1, e.p2]).map((i) => pt(r.draft, String(i)).x);
    expect(Math.min(...xs)).toBeCloseTo(15, 9);
    expect(Math.max(...xs)).toBeCloseTo(25, 9);
    const copy2 = r.draft.entities.slice(8, 12);
    expect(Math.max(...copy2.flatMap((e) => [e.p1, e.p2]).map((i) => pt(r.draft, String(i)).x))).toBeCloseTo(40, 9);
    expect(resolves(r.draft)).toBe(true);
  });
  it('the spacing is a visible driving dimension per copy: H + hdist for a horizontal pattern, the rest hidden', () => {
    const r = applyLinear(rectDraft(10, 5), all4, { n: 3, spacing: 15, angleDeg: 0 });
    if (!r.ok) throw new Error(r.hint);
    const added = r.draft.constraints.slice(4);
    const visible = added.filter((c) => !c.hidden);
    expect(visible.filter((c) => c.type === 'hdist').map((c) => c.value)).toEqual([15, 15]);
    expect(visible.filter((c) => c.type === 'horizontal')).toHaveLength(2);
    expect(visible.filter((c) => c.type === 'vdist')).toHaveLength(0);
    expect(added.filter((c) => c.hidden).length).toBeGreaterThan(0);
    // the canvas annotations show the two spacing labels and no hidden ones
    const labels = annotate(r.draft).filter((a) => a.kind === 'dimension' && !['k1', 'k2', 'k3', 'k4'].includes(a.id));
    expect(labels.map((a) => a.text)).toEqual(['15 mm', '15 mm']);
  });
  it('an oblique pattern gets hdist + vdist', () => {
    const r = applyLinear(rectDraft(10, 5), all4, { n: 2, spacing: 10, angleDeg: 30 });
    if (!r.ok) throw new Error(r.hint);
    const vis = r.draft.constraints.slice(4).filter((c) => !c.hidden);
    expect(vis.map((c) => c.type)).toEqual(['hdist', 'vdist']);
    expect(vis[0].value).toBeCloseTo(10 * Math.cos(Math.PI / 6), 9);
    expect(vis[1].value).toBeCloseTo(5, 9);
  });
  it('circles copy with equal radius; refuses a bad count, no selection and no spacing', () => {
    const d0: SketchDraft = { id: 'F1', plane: {}, temp: [], points: [{ id: 'p1', x: 0, y: 0 }], entities: [{ id: 'e1', type: 'circle', c: 'p1', r: 3 }], constraints: [] };
    const r = applyLinear(d0, ['e1'], { n: 4, spacing: 10, angleDeg: 90 });
    if (!r.ok) throw new Error(r.hint);
    expect(r.draft.entities.filter((e) => e.type === 'circle')).toHaveLength(4);
    expect(r.draft.constraints.filter((c) => c.type === 'equal')).toHaveLength(3);
    expect(applyLinear(d0, ['e1'], { n: 1, spacing: 10, angleDeg: 0 })).toEqual({ ok: false, hint: 'app.sketch.hint.patternCount' });
    expect(applyLinear(d0, [], { n: 2, spacing: 10, angleDeg: 0 })).toEqual({ ok: false, hint: 'app.sketch.hint.nothingToPattern' });
    expect(applyLinear(d0, ['e1'], { n: 2, spacing: 0, angleDeg: 0 })).toEqual({ ok: false, hint: 'app.sketch.hint.degenerate' });
  });
  it('does not mutate the draft', () => {
    const d = rectDraft(10, 5); const copy = JSON.stringify(d);
    applyLinear(d, all4, { n: 3, spacing: 15, angleDeg: 0 });
    expect(JSON.stringify(d)).toBe(copy);
  });
});

describe('circular pattern geometry', () => {
  const line: SketchDraft = { id: 'F1', plane: {}, temp: [], points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: 10, y: 0 }, { id: 'p2', x: 20, y: 0 }], entities: [{ id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }], constraints: [] };
  it('rotates a line about the centre, counter-clockwise for a positive step', () => {
    const r = applyCircular(line, ['e1'], { n: 4, stepDeg: 90, center: { at: { x: 0, y: 0 }, pointId: 'O' } });
    if (!r.ok) throw new Error(r.hint);
    const ends = r.draft.entities.slice(1).filter((e) => !e.construction).map((e) => [pt(r.draft, String(e.p1)), pt(r.draft, String(e.p2))]);
    expect(ends).toHaveLength(3);
    expect(ends[0][0].x).toBeCloseTo(0, 9); expect(ends[0][0].y).toBeCloseTo(10, 9);
    expect(ends[0][1].y).toBeCloseTo(20, 9);
    expect(ends[1][0].x).toBeCloseTo(-10, 9);
    expect(ends[2][0].y).toBeCloseTo(-10, 9);
  });
  it('writes one construction radial per instance, equal lengths and angle dimensions between neighbours', () => {
    const r = applyCircular(line, ['e1'], { n: 4, stepDeg: 90, center: { at: { x: 0, y: 0 }, pointId: 'O' } });
    if (!r.ok) throw new Error(r.hint);
    // 4 radials to the anchor (one per instance) + 3 to the line's other end (one per copy)
    expect(r.draft.entities.filter((e) => e.construction)).toHaveLength(7);
    const ang = r.draft.constraints.filter((c) => c.type === 'angle' && !c.hidden);
    expect(ang.map((c) => c.value)).toEqual([90, 90, 90]);
    expect(r.draft.constraints.filter((c) => c.type === 'angle' && c.hidden)).toHaveLength(3);   // each copy's other end, placed by its turn from the anchor
    expect(r.draft.constraints.filter((c) => c.type === 'equal')).toHaveLength(3);
    expect(resolves(r.draft)).toBe(true);
  });
  it('a clockwise step writes the angle pair the other way round with a positive value', () => {
    const r = applyCircular(line, ['e1'], { n: 2, stepDeg: -60, center: { at: { x: 0, y: 0 }, pointId: 'O' } });
    if (!r.ok) throw new Error(r.hint);
    const a = r.draft.constraints.find((c) => c.type === 'angle')!;
    expect(a.value).toBe(60);
    const radials = r.draft.entities.filter((e) => e.construction);
    expect(a.refs).toEqual([radials[1].id, radials[0].id]);
    const p = pt(r.draft, String(r.draft.entities.find((e) => !e.construction && e.id !== 'e1')!.p2));
    expect(p.x).toBeCloseTo(10, 6); expect(p.y).toBeCloseTo(-17.320508, 5);
  });
  it('a centre that is not a point becomes a new fixed point; a point at the centre is shared, not copied', () => {
    const d: SketchDraft = { ...line, points: [{ id: 'p0', x: 5, y: 5 }, { id: 'p1', x: 10, y: 5 }, { id: 'p2', x: 20, y: 5 }], entities: line.entities };
    const r = applyCircular(d, ['e1'], { n: 3, stepDeg: 120, center: { at: { x: 5, y: 5 } } });
    if (!r.ok) throw new Error(r.hint);
    const c = r.draft.points.find((p) => p.fixed)!;
    expect(c).toMatchObject({ x: 5, y: 5 });
    // a line whose first point is the centre: the copies share that centre
    const fan: SketchDraft = { ...line, entities: [{ id: 'e1', type: 'line', p1: 'O', p2: 'p2' }] };
    const f = applyCircular(fan, ['e1'], { n: 3, stepDeg: 120, center: { at: { x: 0, y: 0 }, pointId: 'O' } });
    if (!f.ok) throw new Error(f.hint);
    expect(f.draft.entities.filter((e) => !e.construction && e.id !== 'e1').every((e) => e.p1 === 'O')).toBe(true);
  });
  it('refuses a selection whose every point is the centre', () => {
    const d: SketchDraft = { id: 'F1', plane: {}, temp: [], points: [{ id: 'O', x: 0, y: 0 }], entities: [{ id: 'e1', type: 'point', p: 'O' }], constraints: [] };
    expect(applyCircular(d, ['e1'], { n: 3, stepDeg: 120, center: { at: { x: 0, y: 0 }, pointId: 'O' } })).toEqual({ ok: false, hint: 'app.sketch.hint.degenerate' });
  });
});

describe('linear pattern tool', () => {
  it('select, Enter, move to the second instance, click: copies at that spacing and a snapped angle', () => {
    const d0 = rectDraft(10, 5);
    const o = run(linearPatternTool, d0, [clickOn('e1'), clickOn('e2'), clickOn('e3'), clickOn('e4'), key('Enter'), field('n', 3, false), move(14.5, 0.3), clickAt(14.5, 0.3)]);
    expect(o.draft.entities).toHaveLength(12);
    expect(o.state).toMatchObject({ phase: 'select', selected: [], n: 3 });
    const xs = o.draft.entities.slice(4, 8).flatMap((e) => [e.p1, e.p2]).map((i) => pt(o.draft, String(i)));
    expect(Math.min(...xs.map((p) => p.x))).toBeCloseTo(14.5, 6);
    expect(xs.every((p) => Math.abs(p.y) <= 5 + 1e-9)).toBe(true);     // snapped to horizontal: no y shift
    expect(Math.min(...xs.map((p) => p.y))).toBeCloseTo(0, 9);
  });
  it('typed spacing and angle apply with Enter; the fields are shown while setting', () => {
    const d0 = rectDraft(10, 5);
    let o = run(linearPatternTool, d0, [clickOn('e1'), key('Enter'), field('d', 20), field('a', 90, false)]);
    expect(o.fields.map((f) => f.id)).toEqual(['n', 'd', 'a']);
    expect(o.fields[1]).toMatchObject({ value: 20, locked: true });
    o = linearPatternTool.step(o.state, key('Enter'), o.draft, DEFAULT_SETTINGS);
    expect(o.draft.entities).toHaveLength(4 + 2);                       // e1 only, n = 3 -> two copies
    expect(o.draft.entities.length).toBe(6);
  });
  it('Enter in the set phase with no spacing hints; Escape steps back', () => {
    const d0 = rectDraft(10, 5);
    let o = run(linearPatternTool, d0, [clickOn('e1'), key('Enter'), key('Enter')]);
    expect(o.hint).toBe('app.sketch.hint.patternPlace');
    o = linearPatternTool.step(o.state, key('Escape'), o.draft, DEFAULT_SETTINGS);
    expect(o.state.phase).toBe('select');
    o = linearPatternTool.step(o.state, key('Escape'), o.draft, DEFAULT_SETTINGS);
    expect(o.state.selected).toEqual([]);
  });
  it('a bad count is refused with a hint; a click on nothing in select hints', () => {
    const d0 = rectDraft(10, 5);
    expect(run(linearPatternTool, d0, [clickOn('e1'), key('Enter'), field('n', 1)]).hint).toBe('app.sketch.hint.patternCount');
    expect(run(linearPatternTool, d0, [clickAt(1, 1)]).hint).toBe('app.sketch.hint.pickEntity');
    expect(run(linearPatternTool, d0, [key('Enter')]).hint).toBe('app.sketch.hint.nothingToPattern');
  });
  it('the selection is previewed in select, so the host routes Enter to the tool', () => {
    expect(run(linearPatternTool, rectDraft(10, 5), [clickOn('e1')]).preview.length).toBeGreaterThan(0);
  });
});

describe('circular pattern tool', () => {
  const circleDraft = (): SketchDraft => ({ id: 'F1', plane: {}, temp: [], points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: 20, y: 0 }], entities: [{ id: 'e1', type: 'circle', c: 'p1', r: 3 }], constraints: [] });
  it('select, Enter, centre, type the count, Enter: copies spread over 360 degrees', () => {
    const o = run(circularPatternTool, circleDraft(), [clickOn('e1'), key('Enter'), clickAt(0, 0, 'O'), field('n', 4, false), key('Enter')]);
    const circles = o.draft.entities.filter((e) => e.type === 'circle');
    expect(circles).toHaveLength(4);
    const cs = circles.map((c) => pt(o.draft, String(c.c)));
    expect(cs[1].x).toBeCloseTo(0, 6); expect(cs[1].y).toBeCloseTo(20, 6);
    expect(cs[3].y).toBeCloseTo(-20, 6);
    expect(o.draft.constraints.filter((c) => c.type === 'angle').map((c) => c.value)).toEqual([90, 90, 90]);
  });
  it('a typed step angle overrides 360/n', () => {
    const o = run(circularPatternTool, circleDraft(), [clickOn('e1'), key('Enter'), clickAt(0, 0, 'O'), field('n', 3, false), field('a', 30), key('Enter')]);
    expect(o.draft.constraints.filter((c) => c.type === 'angle').map((c) => c.value)).toEqual([30, 30]);
  });
  it('shows the count and angle fields (angle defaults to 360 / n) and previews the copies', () => {
    const o = run(circularPatternTool, circleDraft(), [clickOn('e1'), key('Enter'), clickAt(0, 0, 'O')]);
    expect(o.fields.map((f) => [f.id, f.value])).toEqual([['n', 6], ['a', 60]]);
    expect(o.preview.filter((s) => s.kind === 'circle').length).toBeGreaterThanOrEqual(6);
  });
  it('Enter before the centre asks for one; Escape walks back', () => {
    let o = run(circularPatternTool, circleDraft(), [clickOn('e1'), key('Enter'), key('Enter')]);
    expect(o.hint).toBe('app.sketch.hint.pickCenter');
    o = circularPatternTool.step(o.state, key('Escape'), o.draft, DEFAULT_SETTINGS);
    expect(o.state.phase).toBe('select');
  });
});
