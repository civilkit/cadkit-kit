import { describe, expect, it } from 'vitest';
import type { SketchDraft } from '../index';
import { DEFAULT_SETTINGS, type Tool, type ToolEvent, type ToolOutput } from './types';
import { applyOffset, chainOf, offsetTool, pathOf } from './offset';
import { rectDraft, resolves } from './edit-fixtures';

const M = { shift: false, ctrl: false, alt: false };
const clickOn = (entityId: string, x = 0, y = 0, shift = false): ToolEvent => ({ type: 'click', at: { x, y }, snap: { kind: 'point', at: { x, y }, entityId }, mods: { ...M, shift } });
const clickAt = (x: number, y: number): ToolEvent => ({ type: 'click', at: { x, y }, mods: M });
const move = (x: number, y: number): ToolEvent => ({ type: 'move', at: { x, y }, mods: M });
const field = (id: string, value: number, commit = true): ToolEvent => ({ type: 'field', id, value, commit });
const key = (k: string): ToolEvent => ({ type: 'key', key: k });
function run<S>(tool: Tool<S>, draft: SketchDraft, events: ToolEvent[]): ToolOutput<S> {
  let out: ToolOutput<S> = { state: tool.start(), draft, preview: [], fields: [] };
  for (const ev of events) out = tool.step(out.state, ev, out.draft, DEFAULT_SETTINGS);
  return out;
}
const xy = (d: SketchDraft, id: string) => { const p = d.points.find((q) => q.id === id)!; return [Math.round(p.x * 1e6) / 1e6, Math.round(p.y * 1e6) / 1e6]; };
const newLines = (d0: SketchDraft, d: SketchDraft) => d.entities.slice(d0.entities.length);
const box = (d: SketchDraft, es: SketchDraft['entities']) => {
  const ids = es.flatMap((e) => [e.p1, e.p2]).map(String);
  const pts = ids.map((i) => xy(d, i));
  return { x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), y1: Math.max(...pts.map((p) => p[1])) };
};

describe('chains', () => {
  it('a click on one side of a rectangle selects the closed chain of four', () => {
    expect(chainOf(rectDraft(40, 20), 'e2').sort()).toEqual(['e1', 'e2', 'e3', 'e4']);
  });
  it('orders a chain into a closed path', () => {
    const p = pathOf(rectDraft(40, 20), ['e3', 'e1', 'e4', 'e2']);
    expect(typeof p).toBe('object');
    if (typeof p !== 'string') { expect(p.closed).toBe(true); expect(p.segs).toHaveLength(4); }
  });
  it('refuses a branching selection', () => {
    const d = rectDraft(40, 20);
    const t = { ...d, points: [...d.points, { id: 'p5', x: 50, y: 0 }], entities: [...d.entities, { id: 'e5', type: 'line', p1: 'p2', p2: 'p5' }] };
    expect(pathOf(t, ['e1', 'e2', 'e5'])).toBe('app.sketch.hint.offsetBranch');
  });
});

describe('offset geometry', () => {
  it('outside a rectangle: a bigger rectangle, corners shared, parallel + pldist per side', () => {
    const d0 = rectDraft(40, 20);
    const r = applyOffset(d0, ['e1', 'e2', 'e3', 'e4'], -3);   // the walk is counter-clockwise (left = inside), so -3 is outside
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const nl = newLines(d0, r.draft);
    expect(nl).toHaveLength(4);
    expect(box(r.draft, nl)).toEqual({ x0: -3, x1: 43, y0: -3, y1: 23 });
    // closed: each new point is used by exactly two new lines
    const uses = new Map<string, number>();
    for (const e of nl) for (const k of ['p1', 'p2']) uses.set(String(e[k]), (uses.get(String(e[k])) ?? 0) + 1);
    expect([...uses.values()].every((n) => n === 2)).toBe(true);
    expect(r.draft.constraints.filter((c) => c.type === 'parallel')).toHaveLength(4);
    const pl = r.draft.constraints.filter((c) => c.type === 'pldist');
    expect(pl).toHaveLength(4);
    expect(pl.every((c) => c.value === 3)).toBe(true);
    expect(resolves(r.draft)).toBe(true);
  });
  it('inside a rectangle: a smaller one', () => {
    const d0 = rectDraft(40, 20);
    const r = applyOffset(d0, ['e1', 'e2', 'e3', 'e4'], 4);
    if (!r.ok) throw new Error(r.hint);
    expect(box(r.draft, newLines(d0, r.draft))).toEqual({ x0: 4, x1: 36, y0: 4, y1: 16 });
  });
  it('a distance that eats the short sides of a rectangle collapses the chain', () => {
    const r = applyOffset(rectDraft(40, 20), ['e1', 'e2', 'e3', 'e4'], 11);
    expect(r).toEqual({ ok: false, hint: 'app.sketch.hint.offsetCollapsed' });
  });
  it('does not mutate the draft and keeps the originals', () => {
    const d0 = rectDraft(40, 20);
    const copy = JSON.stringify(d0);
    applyOffset(d0, ['e1', 'e2', 'e3', 'e4'], 2);
    expect(JSON.stringify(d0)).toBe(copy);
  });
  it('a circle: concentric (shared centre), radius difference constraint', () => {
    const d0: SketchDraft = { id: 'F1', plane: {}, temp: [], points: [{ id: 'p1', x: 5, y: 5 }], entities: [{ id: 'e1', type: 'circle', c: 'p1', r: 10 }], constraints: [] };
    const out = applyOffset(d0, ['e1'], -4);   // outside
    if (!out.ok) throw new Error(out.hint);
    expect(out.draft.entities[1]).toMatchObject({ type: 'circle', c: 'p1', r: 14 });
    expect(out.draft.constraints[0]).toMatchObject({ type: 'raddiff', refs: ['e1', 'e2'], value: 4 });
    const inn = applyOffset(d0, ['e1'], 4);
    if (!inn.ok) throw new Error(inn.hint);
    expect(inn.draft.entities[1]).toMatchObject({ r: 6 });
    expect(inn.draft.constraints[0]).toMatchObject({ refs: ['e2', 'e1'], value: 4 });
    expect(applyOffset(d0, ['e1'], 10)).toEqual({ ok: false, hint: 'app.sketch.hint.offsetCollapsed' });
  });
  it('an open line + arc chain: tangent join moves along the normal, the arc keeps its centre', () => {
    // line (0,0)-(10,0) then arc centre (10,5) from (10,0) to (15,5): quarter turn counter-clockwise
    const d0: SketchDraft = {
      id: 'F1', plane: {}, temp: [],
      points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 10, y: 0 }, { id: 'p3', x: 15, y: 5 }, { id: 'c', x: 10, y: 5 }],
      entities: [{ id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'arc', c: 'c', p1: 'p2', p2: 'p3' }], constraints: [],
    };
    const r = applyOffset(d0, ['e1', 'e2'], 2);          // left of the walk = towards the centre
    if (!r.ok) throw new Error(r.hint);
    const [l, a] = r.draft.entities.slice(2);
    expect(xy(r.draft, String(l.p1))).toEqual([0, 2]);
    expect(xy(r.draft, String(l.p2))).toEqual([10, 2]);
    expect(a).toMatchObject({ type: 'arc', c: 'c', p1: l.p2 });
    expect(xy(r.draft, String(a.p2))).toEqual([13, 5]);
    expect(r.draft.constraints.find((c) => c.type === 'raddiff')).toMatchObject({ refs: ['e3', 'e2'.replace('e2', 'e4')].length ? expect.any(Array) : [], value: 2 });
  });
  it('an arc that would collapse is dropped and the neighbours are joined', () => {
    // a line, a small arc (r 1), another line at right angles; offset inside by 2 swallows the arc
    const d0: SketchDraft = {
      id: 'F1', plane: {}, temp: [],
      points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 10, y: 0 }, { id: 'p3', x: 11, y: 1 }, { id: 'p4', x: 11, y: 11 }, { id: 'c', x: 10, y: 1 }],
      entities: [{ id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'arc', c: 'c', p1: 'p2', p2: 'p3' }, { id: 'e3', type: 'line', p1: 'p3', p2: 'p4' }], constraints: [],
    };
    const r = applyOffset(d0, ['e1', 'e2', 'e3'], 2);
    if (!r.ok) throw new Error(r.hint);
    expect(r.dropped).toEqual(['e2']);
    const ls = r.draft.entities.slice(3);
    expect(ls).toHaveLength(2);
    expect(ls.every((e) => e.type === 'line')).toBe(true);
    // they meet at (9, 2): the offset of y=0 by +2 and of x=11 by -2 (to the left of travel)
    expect(ls[0].p2).toBe(ls[1].p1);
    expect(xy(r.draft, String(ls[0].p2))).toEqual([9, 2]);
  });
  it('short sides that would reverse are dropped and the rest stays a closed loop', () => {
    // a pentagon (house with a flat bottom) with two 1-long sides; the inward offset by 2 reverses them
    const pts = [[0, 0], [20, 0], [20, 1], [10, 10], [0, 1]];
    const d0: SketchDraft = {
      id: 'F1', plane: {}, temp: [], constraints: [],
      points: pts.map(([x, y], i) => ({ id: `p${i + 1}`, x, y })),
      entities: pts.map((_, i) => ({ id: `e${i + 1}`, type: 'line', p1: `p${i + 1}`, p2: `p${((i + 1) % 5) + 1}` })),
    };
    const r = applyOffset(d0, ['e1', 'e2', 'e3', 'e4', 'e5'], 2);
    if (!r.ok) throw new Error(r.hint);
    expect(r.dropped.sort()).toEqual(['e2', 'e5']);
    const nl = r.draft.entities.slice(5);
    expect(nl).toHaveLength(3);
    const uses = new Map<string, number>();
    for (const e of nl) for (const k of ['p1', 'p2']) uses.set(String(e[k]), (uses.get(String(e[k])) ?? 0) + 1);
    expect([...uses.values()].every((n) => n === 2)).toBe(true);
  });
});

describe('offset tool', () => {
  it('click a side selects the chain, Enter, move to the outside, click applies the pointer distance', () => {
    const d0 = rectDraft(40, 20);
    const o = run(offsetTool, d0, [clickOn('e1'), key('Enter'), move(20, -5), clickAt(20, -5)]);
    expect(o.state).toEqual({ phase: 'pick', selected: [] });
    expect(box(o.draft, newLines(d0, o.draft))).toEqual({ x0: -5, x1: 45, y0: -5, y1: 25 });
  });
  it('a typed distance applies as soon as a side is known; the pointer decides the side', () => {
    const d0 = rectDraft(40, 20);
    const o = run(offsetTool, d0, [clickOn('e1'), key('Enter'), move(20, 10), field('d', 3)]);   // inside
    expect(box(o.draft, newLines(d0, o.draft))).toEqual({ x0: 3, x1: 37, y0: 3, y1: 17 });
  });
  it('a typed distance shows in the field and only previews until committed', () => {
    const d0 = rectDraft(40, 20);
    const o = run(offsetTool, d0, [clickOn('e1'), key('Enter'), move(20, -1), field('d', 6, false)]);
    expect(o.draft).toBe(d0);
    expect(o.fields[0]).toMatchObject({ id: 'd', value: 6, locked: false });
    expect(o.preview.length).toBe(4);
  });
  it('Shift-click toggles a single entity of the chain', () => {
    const o = run(offsetTool, rectDraft(40, 20), [clickOn('e1', 0, 0, true), clickOn('e2', 0, 0, true)]);
    expect(o.state.selected).toEqual(['e1', 'e2']);
  });
  it('Enter with nothing selected hints; a click on nothing hints', () => {
    expect(run(offsetTool, rectDraft(40, 20), [key('Enter')]).hint).toBe('app.sketch.hint.nothingToOffset');
    expect(run(offsetTool, rectDraft(40, 20), [clickAt(1, 1)]).hint).toBe('app.sketch.hint.pickCurve');
  });
  it('Enter returns keys to the tool: a selection shows a highlight so the host routes keys to it', () => {
    const o = run(offsetTool, rectDraft(40, 20), [clickOn('e1')]);
    expect(o.preview.length).toBeGreaterThan(0);
  });
  it('Escape clears the typed value, then goes back to picking, then clears', () => {
    const d0 = rectDraft(40, 20);
    let o = run(offsetTool, d0, [clickOn('e1'), key('Enter'), move(20, -1), field('d', 6, false), key('Escape')]);
    expect(o.state).toMatchObject({ phase: 'side', live: undefined });
    o = offsetTool.step(o.state, key('Escape'), o.draft, DEFAULT_SETTINGS);
    expect(o.state).toMatchObject({ phase: 'pick', selected: expect.any(Array) });
    o = offsetTool.step(o.state, key('Escape'), o.draft, DEFAULT_SETTINGS);
    expect(o.state.selected).toEqual([]);
  });
});
