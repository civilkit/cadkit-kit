import { describe, expect, it } from 'vitest';
import type { SketchDraft } from '../index';
import { annotate } from '../annotations';
import { DEFAULT_SETTINGS, type Tool, type ToolEvent, type ToolOutput } from './types';
import { applyCircular, applyGrid, applyLinear, circularPatternTool, linearPatternTool, type GridSpec } from './pattern';
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
  it('Enter in the set phase with nothing typed and no pointer uses the default spacing (a gap past the shape); Escape steps back', () => {
    const d0 = rectDraft(10, 5);
    let o = run(linearPatternTool, d0, [clickOn('e1'), key('Enter')]);
    expect(o.hint).toBe('app.sketch.hint.patternSetLinear');
    expect(o.fields[1].value).toBeCloseTo(15, 9);                      // 1.5 x the 10 mm line
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

describe('pattern tools: the natural gesture', () => {
  const circleDraft = (): SketchDraft => ({ id: 'F1', plane: {}, temp: [], points: [{ id: 'c', x: 5, y: 5 }], entities: [{ id: 'e1', type: 'circle', c: 'c', r: 2.5 }], constraints: [] });
  const env = (ids: string[]) => ({ entities: ids });

  it('every step carries a hint, so the user is told what to do next', () => {
    let o = run(linearPatternTool, circleDraft(), []);
    o = linearPatternTool.step(o.state, move(1, 1), o.draft, DEFAULT_SETTINGS);
    expect(o.hint).toBe('app.sketch.hint.patternPick');
    o = linearPatternTool.step(o.state, clickOn('e1'), o.draft, DEFAULT_SETTINGS);
    expect(o.hint).toBe('app.sketch.hint.patternPickMore');
    o = linearPatternTool.step(o.state, key('Enter'), o.draft, DEFAULT_SETTINGS);
    expect(o.hint).toBe('app.sketch.hint.patternSetLinear');
    expect(o.fields.map((f) => f.id)).toEqual(['n', 'd', 'a']);
  });
  it('linear: a circle selected in Select mode first goes straight to the copies: fields, preview, click makes them', () => {
    const d = circleDraft();
    let o = linearPatternTool.step(linearPatternTool.start(), move(0, 0), d, DEFAULT_SETTINGS, env(['e1']));
    expect(o.state.phase).toBe('set');
    o = linearPatternTool.step(o.state, move(25, 5), o.draft, DEFAULT_SETTINGS, env(['e1']));
    expect(o.fields.map((f) => f.id)).toEqual(['n', 'd', 'a']);
    expect(o.preview.length).toBeGreaterThan(1);
    o = linearPatternTool.step(o.state, clickAt(25, 5), o.draft, DEFAULT_SETTINGS, env(['e1']));
    expect(o.draft.entities.filter((e) => e.type === 'circle')).toHaveLength(3);
  });
  it('linear: pick the circle, then a click on empty space is the direction (no Enter needed); the next click makes the pattern', () => {
    let o = run(linearPatternTool, circleDraft(), [clickOn('e1'), clickAt(25, 5)]);
    expect(o.state.phase).toBe('set');
    expect(o.preview.length).toBeGreaterThan(1);
    o = linearPatternTool.step(o.state, clickAt(25, 5), o.draft, DEFAULT_SETTINGS);
    expect(o.draft.entities.filter((e) => e.type === 'circle')).toHaveLength(3);
    expect(resolves(o.draft)).toBe(true);
  });
  it('linear: a click on empty space with nothing selected still hints to pick', () => {
    expect(run(linearPatternTool, circleDraft(), [clickAt(25, 5)]).hint).toBe('app.sketch.hint.pickEntity');
  });
  it('circular: preselected goes to the centre; a click on empty space after picking is the centre', () => {
    const d = circleDraft();
    let o = circularPatternTool.step(circularPatternTool.start(), move(0, 0), d, DEFAULT_SETTINGS, env(['e1']));
    expect(o.state.phase).toBe('center');
    expect(o.hint).toBe('app.sketch.hint.pickCenter');
    o = run(circularPatternTool, d, [clickOn('e1'), clickAt(0, 0)]);
    expect(o.state.phase).toBe('set');
    expect(o.fields.map((f) => f.id)).toEqual(['n', 'a']);
    o = circularPatternTool.step(o.state, field('n', 4), o.draft, DEFAULT_SETTINGS);
    o = circularPatternTool.step(o.state, key('Enter'), o.draft, DEFAULT_SETTINGS);
    expect(o.draft.entities.filter((e) => e.type === 'circle')).toHaveLength(4);
  });
});

describe('grid pattern geometry', () => {
  const circle = (): SketchDraft => ({ id: 'F1', plane: {}, temp: [], points: [{ id: 'c', x: 0, y: 0 }], entities: [{ id: 'e1', type: 'circle', c: 'c', r: 3 }], constraints: [] });
  const grid = (over: Partial<GridSpec> = {}): GridSpec => ({ n1: 3, spacing1: 20, angle1: 0, n2: 2, spacing2: 20, angle2: 90, ...over });
  const made = (d: SketchDraft, g: GridSpec) => { const r = applyGrid(d, ['e1'], g); if (!r.ok) throw new Error(r.hint); return r.draft; };

  it('3 columns x 2 rows of a circle: six circles at the grid positions, row by row', () => {
    const d = made(circle(), grid());
    const cs = d.entities.filter((e) => e.type === 'circle').map((e) => pt(d, String(e.c)));
    expect(cs.map((c) => [Math.round(c.x), Math.round(c.y)])).toEqual([[0, 0], [20, 0], [40, 0], [0, 20], [20, 20], [40, 20]]);
    expect(resolves(d)).toBe(true);
  });
  it('writes two spacing dimensions for the first row and ONE for the rows; the rest is parallel + equal to that step', () => {
    const d = made(circle(), grid());
    const visible = d.constraints.filter((c) => !c.hidden);
    expect(visible.filter((c) => c.type === 'hdist').map((c) => c.value)).toEqual([20, 20]);   // spacing 1, one per step
    expect(visible.filter((c) => c.type === 'vdist').map((c) => c.value)).toEqual([20]);       // spacing 2, once
    expect(visible.filter((c) => c.type === 'vertical')).toHaveLength(1);
    expect(d.constraints.filter((c) => c.type === 'parallel')).toHaveLength(2);                 // copies (1,1) and (2,1) repeat step 2
    expect(d.constraints.filter((c) => c.type === 'parallel').every((c) => c.hidden)).toBe(true);
    expect(d.entities.filter((e) => e.construction)).toHaveLength(3);                           // the step itself + one per further copy
  });
  it('rows only (one column) and a three-row stack write the same single spacing dimension', () => {
    const d = made(circle(), grid({ n1: 1, n2: 4, angle2: 90 }));
    expect(d.constraints.filter((c) => !c.hidden && (c.type === 'vdist' || c.type === 'hdist'))).toHaveLength(1);
    expect(d.entities.filter((e) => e.type === 'circle')).toHaveLength(4);
  });
  it('a tilted grid and a second direction off the perpendicular are placed where asked', () => {
    const d = made(circle(), grid({ n1: 2, n2: 2, angle1: 30, angle2: 100 }));
    const cs = d.entities.filter((e) => e.type === 'circle').map((e) => pt(d, String(e.c)));
    expect(cs[3].x).toBeCloseTo(20 * Math.cos(Math.PI / 6) + 20 * Math.cos((100 * Math.PI) / 180), 9);
    expect(cs[3].y).toBeCloseTo(20 * Math.sin(Math.PI / 6) + 20 * Math.sin((100 * Math.PI) / 180), 9);
  });
  it('refuses a single instance, too many, no spacing, and two parallel directions', () => {
    expect(applyGrid(circle(), ['e1'], grid({ n1: 1, n2: 1 }))).toEqual({ ok: false, hint: 'app.sketch.hint.patternCount' });
    expect(applyGrid(circle(), ['e1'], grid({ n1: 20, n2: 20 }))).toEqual({ ok: false, hint: 'app.sketch.hint.patternTooMany' });
    expect(applyGrid(circle(), ['e1'], grid({ spacing2: 0 }))).toEqual({ ok: false, hint: 'app.sketch.hint.degenerate' });
    expect(applyGrid(circle(), ['e1'], grid({ angle2: 180 }))).toEqual({ ok: false, hint: 'app.sketch.hint.patternParallel' });
  });
});

describe('linear pattern tool: the panel', () => {
  const circleDraft = (): SketchDraft => ({ id: 'F1', plane: {}, temp: [], points: [{ id: 'c', x: 5, y: 5 }], entities: [{ id: 'e1', type: 'circle', c: 'c', r: 2.5 }], constraints: [] });
  const rowIds = (o: ToolOutput<unknown>, g: string) => o.panel!.groups.find((x) => x.id === g)!.rows.map((r) => r.id);
  const cnt = (d: SketchDraft) => d.entities.filter((e) => e.type === 'circle').length;

  it('appears once the shapes are picked and Enter pressed: direction 1 in full, direction 2 (rows) off at count 1', () => {
    const o = run(linearPatternTool, circleDraft(), [clickOn('e1'), key('Enter')]);
    expect(o.panel?.canApply).toBe(true);
    expect(rowIds(o, 'dir1')).toEqual(['n', 'a', 'tot1', 'd', 'pick1']);
    expect(rowIds(o, 'dir2')).toEqual(['n2']);
    expect(o.panel!.groups[1].rows[0]).toMatchObject({ value: 1 });
    expect(run(linearPatternTool, circleDraft(), [clickOn('e1')]).panel).toBeUndefined();
  });
  it('rows: a count above 1 shows the second direction, perpendicular by default, and previews the whole grid', () => {
    const o = run(linearPatternTool, circleDraft(), [clickOn('e1'), key('Enter'), field('n2', 2), field('d', 20), field('d2', 20)]);
    expect(rowIds(o, 'dir2')).toEqual(['n2', 'a2', 'tot2', 'd2', 'pick2']);
    expect(o.panel!.groups[1].rows.find((r) => r.id === 'a2')).toMatchObject({ value: 90 });
    expect(o.preview.filter((s) => s.kind === 'circle').length).toBe(6);   // the original (highlighted) and the five copies of a 3 x 2 grid
  });
  it('3 columns x 2 rows at 20 mm: Enter makes six circles with the spacing dimensions', () => {
    const o = run(linearPatternTool, circleDraft(), [clickOn('e1'), key('Enter'), field('n', 3), field('d', 20), field('a', 0), field('n2', 2), field('d2', 20), key('Enter')]);
    expect(cnt(o.draft)).toBe(6);
    expect(o.state).toMatchObject({ phase: 'select', selected: [], n: 3, n2: 1 });
    expect(resolves(o.draft)).toBe(true);
  });
  it('total length: the spacing is the whole run divided by the steps; the toggle keeps the step', () => {
    let o = run(linearPatternTool, circleDraft(), [clickOn('e1'), key('Enter'), field('n', 5), field('d', 8), field('tot1', 1)]);
    expect(o.panel!.groups[0].rows.find((r) => r.id === 'd')).toMatchObject({ value: 32, label: 'app.sketch.pattern.totalLength' });
    o = linearPatternTool.step(o.state, field('d', 40), o.draft, DEFAULT_SETTINGS);
    o = linearPatternTool.step(o.state, key('Enter'), o.draft, DEFAULT_SETTINGS);
    const xs = o.draft.entities.filter((e) => e.type === 'circle').map((e) => pt(o.draft, String(e.c)).x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(40, 9);
    expect(cnt(o.draft)).toBe(5);
  });
  it('a count change in total mode keeps the total (the step follows)', () => {
    const o = run(linearPatternTool, circleDraft(), [clickOn('e1'), key('Enter'), field('tot1', 1), field('d', 30), field('n', 4)]);
    expect(o.panel!.groups[0].rows.find((r) => r.id === 'd')).toMatchObject({ value: 30 });
  });
  it('pick a line of the sketch for the direction: its angle is taken; a click on anything else is refused', () => {
    const d: SketchDraft = { ...circleDraft(), points: [...circleDraft().points, { id: 'a', x: 0, y: 0 }, { id: 'b', x: 10, y: 10 }], entities: [...circleDraft().entities, { id: 'e2', type: 'line', p1: 'a', p2: 'b' }] };
    let o = run(linearPatternTool, d, [clickOn('e1'), key('Enter'), field('pick1', 1)]);
    expect(o.hint).toBe('app.sketch.hint.patternPickLine');
    expect(o.panel!.groups[0].rows.find((r) => r.id === 'pick1')).toMatchObject({ active: true });
    o = linearPatternTool.step(o.state, clickAt(30, 30), o.draft, DEFAULT_SETTINGS);
    expect(o.hint).toBe('app.sketch.hint.patternPickLine');
    expect(cnt(o.draft)).toBe(1);                                     // the click did not make the pattern
    o = linearPatternTool.step(o.state, clickOn('e2'), o.draft, DEFAULT_SETTINGS);
    expect(o.panel!.groups[0].rows.find((r) => r.id === 'a')).toMatchObject({ value: 45, locked: true });
    expect(o.panel!.groups[0].rows.find((r) => r.id === 'pick1')).toMatchObject({ active: false });
    // Escape while picking only stops the picking
    o = run(linearPatternTool, d, [clickOn('e1'), key('Enter'), field('pick1', 1), key('Escape')]);
    expect(o.state.phase).toBe('set');
    expect((o.state as { pick?: number }).pick).toBeUndefined();
  });
  it('the click gesture still works: the pointer sets direction 1 until the panel is used (freeze keeps what it set)', () => {
    let o = run(linearPatternTool, circleDraft(), [clickOn('e1'), key('Enter'), move(25, 5)]);
    expect(o.fields.map((f) => f.value)).toEqual([3, 20, 0]);
    o = linearPatternTool.step(o.state, field('freeze', 1, false), o.draft, DEFAULT_SETTINGS);
    o = linearPatternTool.step(o.state, move(60, 60), o.draft, DEFAULT_SETTINGS);
    expect(o.fields.map((f) => f.value)).toEqual([3, 20, 0]);          // the pointer no longer moves it
    o = linearPatternTool.step(o.state, field('n2', 2), o.draft, DEFAULT_SETTINGS);
    o = linearPatternTool.step(o.state, key('Enter'), o.draft, DEFAULT_SETTINGS);
    expect(cnt(o.draft)).toBe(6);
  });
  it('refuses counts that leave one instance or too many, with a hint, and keeps the state', () => {
    let o = run(linearPatternTool, circleDraft(), [clickOn('e1'), key('Enter'), field('n', 1)]);
    expect(o.hint).toBe('app.sketch.hint.patternCount');
    o = run(linearPatternTool, circleDraft(), [clickOn('e1'), key('Enter'), field('n', 50), field('n2', 50)]);
    expect(o.hint).toBe('app.sketch.hint.patternTooMany');
    expect((o.state as { n2: number }).n2).toBe(1);
  });
  it('Escape clears every typed value, then goes back a step; OK is not offered when nothing would be made', () => {
    let o = run(linearPatternTool, circleDraft(), [clickOn('e1'), key('Enter'), field('d', 20), field('d2', 7), key('Escape')]);
    expect(o.state.phase).toBe('set');
    expect(o.fields[1].locked).toBe(false);
    o = linearPatternTool.step(o.state, key('Escape'), o.draft, DEFAULT_SETTINGS);
    expect(o.state.phase).toBe('select');
  });
});

describe('circular pattern tool: the panel', () => {
  const circleDraft = (): SketchDraft => ({ id: 'F1', plane: {}, temp: [], points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: 20, y: 0 }], entities: [{ id: 'e1', type: 'circle', c: 'p1', r: 3 }], constraints: [] });
  const set = (...e: ToolEvent[]) => run(circularPatternTool, circleDraft(), [clickOn('e1'), key('Enter'), clickAt(0, 0, 'O'), ...e]);
  const row = (o: ToolOutput<unknown>, id: string) => o.panel!.groups[0].rows.find((r) => r.id === id)!;

  it('shows count, angle type and angle once the centre is picked; the angle starts as the step 360 / n', () => {
    const o = set();
    expect(o.panel!.groups[0].rows.map((r) => r.id)).toEqual(['n', 'tot', 'a']);
    expect(row(o, 'a')).toMatchObject({ value: 60, label: 'app.sketch.pattern.stepAngle' });
    expect(o.panel!.canApply).toBe(true);
  });
  it('total angle: 120 degrees over 4 copies is a 40 degree step; 360 spreads the copies round (360 / n)', () => {
    let o = set(field('n', 4), field('tot', 1), field('a', 120));
    expect(row(o, 'a')).toMatchObject({ value: 120, label: 'app.sketch.pattern.totalAngle' });
    o = circularPatternTool.step(o.state, key('Enter'), o.draft, DEFAULT_SETTINGS);
    expect(o.draft.constraints.filter((c) => c.type === 'angle').map((c) => c.value)).toEqual([40, 40, 40]);
    o = set(field('n', 4), field('tot', 1), field('a', 360), key('Enter'));
    expect(o.draft.constraints.filter((c) => c.type === 'angle').map((c) => c.value)).toEqual([90, 90, 90]);
  });
  it('switching to total shows the default as 360 and a typed step keeps its step', () => {
    let o = set(field('n', 4), field('tot', 1));
    expect((row(o, 'a') as { value: number }).value).toBeCloseTo(360, 9);
    o = set(field('n', 4), field('a', 30), field('tot', 1));
    expect((row(o, 'a') as { value: number }).value).toBeCloseTo(90, 9);
    o = circularPatternTool.step(o.state, field('tot', 0), o.draft, DEFAULT_SETTINGS);
    expect((row(o, 'a') as { value: number }).value).toBeCloseTo(30, 9);
  });
  it('has no panel before the centre is picked', () => {
    expect(run(circularPatternTool, circleDraft(), [clickOn('e1'), key('Enter')]).panel).toBeUndefined();
  });
});
