import { describe, expect, it } from 'vitest';
import type { SketchDraft } from '../index';
import { DEFAULT_SETTINGS, type ToolEvent, type ToolOutput } from './types';
import { cornerRadius, rectangleTool, roundedRectangleTool, type RectState } from './rectangle';
import { sketchTools } from '../registry';

const M = { shift: false, ctrl: false, alt: false };
const empty = (): SketchDraft => ({ id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [], points: [], entities: [], constraints: [] });
const click = (x: number, y: number): ToolEvent => ({ type: 'click', at: { x, y }, mods: M });
const move = (x: number, y: number): ToolEvent => ({ type: 'move', at: { x, y }, mods: M });
const run = (events: ToolEvent[], state?: RectState, draft = empty()): ToolOutput<RectState> => {
  let o: ToolOutput<RectState> = { state: state ?? roundedRectangleTool.start(), draft, preview: [], fields: [] };
  for (const ev of events) o = roundedRectangleTool.step(o.state, ev, o.draft, DEFAULT_SETTINGS);
  return o;
};
const count = (d: SketchDraft, type: string) => d.entities.filter((e) => e.type === type).length;

describe('rounded rectangle tool', () => {
  it('is in the draw group, next to the rectangle', () => {
    const ids = sketchTools().filter((t) => t.group === 'draw').map((t) => t.id);
    expect(ids).toContain('rounded-rectangle');
    expect(sketchTools().find((t) => t.id === 'rounded-rectangle')?.group).toBe('draw');
  });
  it('two clicks make four lines and four tangent arcs; the radius is not a dimension unless typed', () => {
    const o = run([click(0, 0), move(40, 20), click(40, 20)]);
    expect(count(o.draft, 'line')).toBe(4);
    expect(count(o.draft, 'arc')).toBe(4);
    expect(o.draft.constraints.filter((c) => c.type === 'tangent')).toHaveLength(8);
    expect(o.draft.constraints.filter((c) => c.type === 'radius')).toHaveLength(0);
    expect(o.state.radius).toBeUndefined();
  });
  it('shows the radius field and previews the rounded outline', () => {
    const o = run([click(0, 0), move(40, 20)]);
    expect(o.fields.map((f) => f.id)).toEqual(['w', 'h', 'r']);
    expect(o.fields[2].value).toBe(5);
    expect(o.preview.length).toBeGreaterThan(16);   // the arcs are sampled
    expect(o.preview.every((s) => s.kind === 'line')).toBe(true);
  });
  it('a plain rectangle has no radius field', () => {
    let o: ToolOutput<RectState> = { state: rectangleTool.start(), draft: empty(), preview: [], fields: [] };
    for (const ev of [click(0, 0), move(40, 20)]) o = rectangleTool.step(o.state, ev, o.draft, DEFAULT_SETTINGS);
    expect(o.fields.map((f) => f.id)).toEqual(['w', 'h']);
  });
  it('a typed radius with typed sides becomes a radius dimension on every corner and stays for the next rectangle', () => {
    let o = run([click(0, 0), move(3, 2)]);
    for (const [id, value] of [['r', 4], ['w', 30], ['h', 20]] as const) o = roundedRectangleTool.step(o.state, { type: 'field', id, value, commit: true }, o.draft, DEFAULT_SETTINGS);
    expect(count(o.draft, 'arc')).toBe(4);
    expect(o.draft.constraints.filter((c) => c.type === 'radius').map((c) => c.value)).toEqual([4, 4, 4, 4]);
    expect(o.state.radius).toBe(4);
    expect(cornerRadius(o.state, 100, 100)).toBe(4);
  });
  it('holds an untyped radius under half the shorter side, and refuses a typed one that is too large', () => {
    const small = run([click(0, 0), click(8, 6)]);   // 5 would not fit in 6
    expect(count(small.draft, 'arc')).toBe(4);
    let o = run([click(0, 0), move(3, 2)]);
    o = roundedRectangleTool.step(o.state, { type: 'field', id: 'r', value: 9, commit: true }, o.draft, DEFAULT_SETTINGS);
    o = roundedRectangleTool.step(o.state, click(30, 10), o.draft, DEFAULT_SETTINGS);
    expect(o.hint).toBe('app.sketch.hint.radiusTooLarge');
    expect(o.draft.entities).toHaveLength(0);
  });
  it('never reuses a snapped point as a corner', () => {
    const d: SketchDraft = { ...empty(), points: [{ id: 'p1', x: 0, y: 0 }] };
    const ev: ToolEvent = { type: 'click', at: { x: 0, y: 0 }, snap: { kind: 'point', at: { x: 0, y: 0 }, pointId: 'p1' }, mods: M };
    const o = run([ev, click(30, 20)], undefined, d);
    expect(count(o.draft, 'arc')).toBe(4);
    expect(o.draft.points.find((p) => p.id === 'p1')).toBeTruthy();
  });
});
