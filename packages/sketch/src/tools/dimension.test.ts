import { describe, expect, it } from 'vitest';
import type { SketchDraft } from '../index';
import { dimensionTool, orientFromCursor } from './dimension';
import { DEFAULT_SETTINGS, type SnapHit, type Tool, type ToolEvent, type ToolOutput } from './types';

const M = { shift: false, ctrl: false, alt: false };
const draft: SketchDraft = { id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [], entities: [], constraints: [],
  points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 10, y: 6 }] };
const run = <S,>(tool: Tool<S>, events: ToolEvent[], d = draft): ToolOutput<S> => {
  let out: ToolOutput<S> = { state: tool.start(), draft: d, preview: [], fields: [] };
  for (const ev of events) out = tool.step(out.state, ev, out.draft, DEFAULT_SETTINGS);
  return out;
};
const point = (id: string): ToolEvent => { const snap: SnapHit = { kind: 'point', at: { x: 0, y: 0 }, pointId: id }; return { type: 'click', at: snap.at, snap, mods: M }; };
const move = (x: number, y: number): ToolEvent => ({ type: 'move', at: { x, y }, mods: M });
const key = (k: string): ToolEvent => ({ type: 'key', key: k });
const typed = (value: number): ToolEvent => ({ type: 'field', id: 'value', value, commit: true });

describe('orientFromCursor', () => {
  const u = { x: 0, y: 0 }, v = { x: 10, y: 6 };
  it('above or below the points\' box is horizontal, beside it vertical', () => {
    expect(orientFromCursor(u, v, { x: 5, y: 12 })).toBe('horizontal');
    expect(orientFromCursor(u, v, { x: 5, y: -3 })).toBe('horizontal');
    expect(orientFromCursor(u, v, { x: -4, y: 3 })).toBe('vertical');
    expect(orientFromCursor(u, v, { x: 14, y: 3 })).toBe('vertical');
  });
  it('inside the box, or off a corner, is aligned', () => {
    expect(orientFromCursor(u, v, { x: 5, y: 3 })).toBe('aligned');
    expect(orientFromCursor(u, v, { x: 14, y: 9 })).toBe('aligned');
  });
  it('does not depend on which point was picked first', () => {
    expect(orientFromCursor(v, u, { x: 5, y: 12 })).toBe('horizontal');
  });
});

describe('dimension between two points follows the pointer', () => {
  it('moving above the points makes the horizontal distance, beside them the vertical one', () => {
    let o = run(dimensionTool, [point('p1'), point('p2')]);
    expect(o.state.pending?.spec.type).toBe('distance');
    o = dimensionTool.step(o.state, move(5, 12), o.draft, DEFAULT_SETTINGS);
    expect(o.state.pending?.spec.type).toBe('hdist');
    expect(o.fields[0].value).toBe(10);
    o = dimensionTool.step(o.state, move(-4, 3), o.draft, DEFAULT_SETTINGS);
    expect(o.state.pending?.spec.type).toBe('vdist');
    expect(o.fields[0].value).toBe(6);
    o = dimensionTool.step(o.state, typed(8), o.draft, DEFAULT_SETTINGS);
    expect(o.draft.constraints).toMatchObject([{ type: 'vdist', refs: ['p1', 'p2'], value: 8 }]);
  });
  it('a typed value survives pointer moves that keep the orientation', () => {
    let o = run(dimensionTool, [point('p1'), point('p2'), move(5, 12)]);
    o = dimensionTool.step(o.state, { type: 'field', id: 'value', value: 7 }, o.draft, DEFAULT_SETTINGS);
    o = dimensionTool.step(o.state, move(6, 14), o.draft, DEFAULT_SETTINGS);
    expect(o.fields[0].value).toBe(7);
  });
  it('a pressed key wins over the pointer, until the tool is restarted', () => {
    let o = run(dimensionTool, [point('p1'), point('p2'), key('v'), move(5, 12)]);
    expect(o.state.pending?.spec.type).toBe('vdist');
    o = dimensionTool.step(o.state, key('a'), o.draft, DEFAULT_SETTINGS);
    o = dimensionTool.step(o.state, move(-4, 3), o.draft, DEFAULT_SETTINGS);
    expect(o.state.pending?.spec.type).toBe('distance');
  });
  it('a new dimension starts aligned again after an automatic choice', () => {
    let o = run(dimensionTool, [point('p1'), point('p2'), move(5, 12), typed(10)]);
    o = dimensionTool.step(o.state, point('p1'), o.draft, DEFAULT_SETTINGS);
    o = dimensionTool.step(o.state, point('p2'), o.draft, DEFAULT_SETTINGS);
    expect(o.state.pending?.spec.type).toBe('distance');
  });
});
