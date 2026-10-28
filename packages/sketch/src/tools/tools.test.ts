import { describe, expect, it } from 'vitest';
import type { SketchDraft } from '../index';
import { DEFAULT_SETTINGS, type Modifiers, type Pt, type Tool, type ToolEvent, type ToolOutput } from './types';
import { lineTool } from './line';
import { rectangleTool } from './rectangle';
import { centerRectangleTool } from './center-rectangle';

const M: Modifiers = { shift: false, ctrl: false, alt: false };
const empty = (): SketchDraft => ({ id: 'F1', plane: { kind: 'std', id: 'front' }, points: [], entities: [], constraints: [], temp: [] });

/** Run a list of events through a tool, threading state and draft. */
function run<S>(tool: Tool<S>, events: ToolEvent[], draft: SketchDraft = empty(), settings = DEFAULT_SETTINGS): ToolOutput<S> {
  let state = tool.start();
  let out: ToolOutput<S> = { state, draft, preview: [], fields: [] };
  for (const ev of events) { out = tool.step(out.state, ev, out.draft, settings); }
  return out;
}
const click = (x: number, y: number): ToolEvent => ({ type: 'click', at: { x, y }, mods: M });
const move = (x: number, y: number): ToolEvent => ({ type: 'move', at: { x, y }, mods: M });

describe('line tool', () => {
  it('chains segments through shared points', () => {
    const o = run(lineTool, [click(0, 0), move(10, 5), click(10, 5), move(20, 20), click(20, 20)]);
    expect(o.draft.points.map((p) => [p.x, p.y])).toEqual([[0, 0], [10, 5], [20, 20]]);
    expect(o.draft.entities.map((e) => [e.p1, e.p2])).toEqual([['p1', 'p2'], ['p2', 'p3']]);
  });

  it('infers horizontal and vertical within two degrees and records the constraints', () => {
    const o = run(lineTool, [click(0, 0), move(10, 0.1), click(10, 0.1), move(10.05, 8), click(10.05, 8)]);
    const [p1, p2, p3] = o.draft.points;
    expect(p2.y).toBe(0);                 // snapped onto the horizontal
    expect(p2.x).toBeCloseTo(10, 9);      // keeping the pointer's x, not the longer diagonal
    expect(p3.x).toBeCloseTo(p2.x, 9);    // and the vertical
    expect(o.draft.constraints.map((c) => [c.type, c.refs])).toEqual([['horizontal', ['e1']], ['vertical', ['e2']]]);
    expect(p1.x).toBe(0);
  });

  it('shows a pending horizontal before the click, and none when auto constraints are off', () => {
    const on = run(lineTool, [click(0, 0), move(10, 0.1)]);
    expect(on.pending).toEqual(['horizontal']);
    const off = run(lineTool, [click(0, 0), move(10, 0.1)], empty(), { ...DEFAULT_SETTINGS, autoConstraints: false });
    expect(off.pending).toBeUndefined();
  });

  it('a committed length is a distance constraint and moves the end to exactly that length', () => {
    let o = run(lineTool, [click(0, 0), move(7, 1)]);
    o = lineTool.step(o.state, { type: 'field', id: 'len', value: 30, commit: true }, o.draft, DEFAULT_SETTINGS);
    expect(o.fields.find((f) => f.id === 'len')).toMatchObject({ value: 30, locked: true });
    o = lineTool.step(o.state, click(7, 1), o.draft, DEFAULT_SETTINGS);
    const [p1, p2] = o.draft.points;
    expect(Math.hypot(p2.x - p1.x, p2.y - p1.y)).toBeCloseTo(30, 9);
    expect(o.draft.constraints.find((c) => c.type === 'distance')).toMatchObject({ refs: ['p1', 'p2'], value: 30 });
  });

  it('an uncommitted value only previews: no constraint is written', () => {
    let o = run(lineTool, [click(0, 0), move(7, 7)]);
    o = lineTool.step(o.state, { type: 'field', id: 'len', value: 12, commit: false }, o.draft, DEFAULT_SETTINGS);
    expect(o.preview[0]).toMatchObject({ kind: 'line' });
    const b = (o.preview[0] as { b: Pt }).b;
    expect(Math.hypot(b.x, b.y)).toBeCloseTo(12, 9);
    o = lineTool.step(o.state, click(7, 7), o.draft, DEFAULT_SETTINGS);
    expect(o.draft.constraints.find((c) => c.type === 'distance')).toBeUndefined();
  });

  it('committing both length and angle places the segment at once, even with a stale pointer', () => {
    let o = run(lineTool, [click(0, 0), move(1, 1)]);
    o = lineTool.step(o.state, { type: 'field', id: 'len', value: 30, commit: true }, o.draft, DEFAULT_SETTINGS);
    o = lineTool.step(o.state, { type: 'field', id: 'ang', value: 45, commit: true }, o.draft, DEFAULT_SETTINGS);
    const p2 = o.draft.points[1];
    expect(p2.x).toBeCloseTo(30 * Math.cos(Math.PI / 4), 9);
    expect(p2.y).toBeCloseTo(30 * Math.sin(Math.PI / 4), 9);
  });

  it('closes the profile on the first point and ends the chain', () => {
    const o = run(lineTool, [click(0, 0), click(10, 0), click(10, 10),
      { type: 'move', at: { x: 0, y: 0 }, snap: { kind: 'point', at: { x: 0, y: 0 }, pointId: 'p1' }, mods: M },
      { type: 'click', at: { x: 0, y: 0 }, snap: { kind: 'point', at: { x: 0, y: 0 }, pointId: 'p1' }, mods: M }]);
    expect(o.draft.entities.map((e) => [e.p1, e.p2])).toEqual([['p1', 'p2'], ['p2', 'p3'], ['p3', 'p1']]);
    expect(o.draft.points).toHaveLength(3);          // no duplicate point
    expect(o.state.last).toBeUndefined();            // chain ended
  });

  it('Escape clears typed values first, then ends the chain', () => {
    let o = run(lineTool, [click(0, 0), move(5, 5)]);
    o = lineTool.step(o.state, { type: 'field', id: 'len', value: 9, commit: true }, o.draft, DEFAULT_SETTINGS);
    o = lineTool.step(o.state, { type: 'key', key: 'Escape' }, o.draft, DEFAULT_SETTINGS);
    expect(o.state.last).toBe('p1');
    expect(o.state.locked).toEqual({});
    o = lineTool.step(o.state, { type: 'key', key: 'Escape' }, o.draft, DEFAULT_SETTINGS);
    expect(o.state.last).toBeUndefined();
    expect(o.draft.entities).toHaveLength(0);
  });

  it('a zero-length click adds nothing and says why', () => {
    const o = run(lineTool, [click(3, 3), click(3, 3)]);
    expect(o.draft.entities).toHaveLength(0);
    expect(o.hint).toBe('app.sketch.hint.degenerate');
  });

  it('on-view values off returns no fields', () => {
    const o = run(lineTool, [click(0, 0), move(5, 5)], empty(), { ...DEFAULT_SETTINGS, onViewValues: 'off' });
    expect(o.fields).toEqual([]);
  });
});

describe('rectangle tool', () => {
  it('two clicks make four points, four lines and axis-aligned constraints', () => {
    const o = run(rectangleTool, [click(0, 0), move(10, 6), click(10, 6)]);
    expect(o.draft.points.map((p) => [p.x, p.y])).toEqual([[0, 0], [10, 0], [10, 6], [0, 6]]);
    expect(o.draft.entities.map((e) => [e.p1, e.p2])).toEqual([['p1', 'p2'], ['p2', 'p3'], ['p3', 'p4'], ['p4', 'p1']]);
    expect(o.draft.constraints.map((c) => c.type)).toEqual(['horizontal', 'vertical', 'horizontal', 'vertical']);
  });

  it('works toward any corner direction', () => {
    const o = run(rectangleTool, [click(0, 0), click(-4, -3)]);
    expect(o.draft.points.map((p) => [p.x, p.y])).toEqual([[0, 0], [-4, 0], [-4, -3], [0, -3]]);
  });

  it('typed width and height become distance constraints and finish the rectangle', () => {
    let o = run(rectangleTool, [click(0, 0), move(3, 2)]);
    o = rectangleTool.step(o.state, { type: 'field', id: 'w', value: 40, commit: true }, o.draft, DEFAULT_SETTINGS);
    expect(o.draft.points).toHaveLength(0);          // not yet placed
    o = rectangleTool.step(o.state, { type: 'field', id: 'h', value: 25, commit: true }, o.draft, DEFAULT_SETTINGS);
    expect(o.draft.points.map((p) => [p.x, p.y])).toEqual([[0, 0], [40, 0], [40, 25], [0, 25]]);
    const d = o.draft.constraints.filter((c) => c.type === 'distance');
    expect(d.map((c) => [c.refs, c.value])).toEqual([[['p1', 'p2'], 40], [['p2', 'p3'], 25]]);
  });

  it('reuses a snapped existing point as the first corner', () => {
    const base = run(lineTool, [click(5, 5), click(9, 5)]).draft;      // p1 (5,5), p2 (9,5)
    const o = run(rectangleTool, [
      { type: 'click', at: { x: 5, y: 5 }, snap: { kind: 'point', at: { x: 5, y: 5 }, pointId: 'p1' }, mods: M },
      click(15, 12)], base);
    expect(o.draft.points.filter((p) => p.x === 5 && p.y === 5)).toHaveLength(1);
    expect(o.draft.entities.some((e) => e.type === 'line' && e.p1 === 'p1' && e.p2 === 'p3')).toBe(true);
  });

  it('a flat rectangle is refused', () => {
    const o = run(rectangleTool, [click(0, 0), click(8, 0)]);
    expect(o.draft.entities).toHaveLength(0);
    expect(o.hint).toBe('app.sketch.hint.degenerate');
  });
});

describe('rectangle tool with Alt', () => {
  const alt: Modifiers = { shift: false, ctrl: false, alt: true };
  const aclick = (x: number, y: number): ToolEvent => ({ type: 'click', at: { x, y }, mods: alt });
  const amove = (x: number, y: number): ToolEvent => ({ type: 'move', at: { x, y }, mods: alt });
  it('Alt makes a square from the longer pointer offset, toward the pointer', () => {
    const o = run(rectangleTool, [click(0, 0), amove(10, -4), aclick(10, -4)]);
    expect(o.draft.points.map((p) => [p.x, p.y])).toEqual([[0, 0], [10, 0], [10, -10], [0, -10]]);
  });
  it('the preview and the size fields show the square while Alt is held, and go back to the rectangle when it is released', () => {
    let o = run(rectangleTool, [click(0, 0), amove(3, 9)]);
    expect(o.fields.map((f) => f.value)).toEqual([9, 9]);
    o = rectangleTool.step(o.state, move(3, 9), o.draft, DEFAULT_SETTINGS);
    expect(o.fields.map((f) => f.value)).toEqual([3, 9]);
  });
  it('a typed side makes the other side follow', () => {
    let o = run(rectangleTool, [click(0, 0), amove(3, 9)]);
    o = rectangleTool.step(o.state, { type: 'field', id: 'w', value: 5, commit: true }, o.draft, DEFAULT_SETTINGS);
    expect(o.fields.map((f) => f.value)).toEqual([5, 5]);
  });
  it('without Alt the corners are free, as before', () => {
    const o = run(rectangleTool, [click(0, 0), click(10, 6)]);
    expect(o.draft.points.map((p) => [p.x, p.y])).toEqual([[0, 0], [10, 0], [10, 6], [0, 6]]);
  });
});

describe('centre rectangle tool with Alt', () => {
  it('Alt makes a square about the centre', () => {
    const alt: Modifiers = { shift: false, ctrl: false, alt: true };
    const o = run(centerRectangleTool, [click(0, 0), { type: 'move', at: { x: 2, y: 5 }, mods: alt }, { type: 'click', at: { x: 2, y: 5 }, mods: alt }]);
    expect(o.draft.points.map((p) => [p.x, p.y])).toEqual([[0, 0], [-5, -5], [5, -5], [5, 5], [-5, 5]]);
  });
});
