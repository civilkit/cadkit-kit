import { describe, expect, it } from 'vitest';
import type { SketchDraft } from '../index';
import { rectangleTool } from './rectangle';
import { DEFAULT_SETTINGS } from './types';

const draft = (): SketchDraft => ({ id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [], constraints: [], points: [], entities: [] });
const mods = { shift: false, ctrl: false, alt: false };
const val = (o: { fields: { id: string; value: number }[] }, id: string) => o.fields.find((f) => f.id === id)!.value;

describe('rectangle: dragging is free, typing is optional', () => {
  const start = () => rectangleTool.step(rectangleTool.start(), { type: 'click', at: { x: 0, y: 0 }, mods }, draft(), DEFAULT_SETTINGS);
  it('the W and H fields follow every pointer position, fractions included', () => {
    let o = start();
    for (const [x, y] of [[7.37, 30.11], [7.38, 30.12], [12.5, 3.25]]) {
      o = rectangleTool.step(o.state, { type: 'move', at: { x, y }, mods }, o.draft, DEFAULT_SETTINGS);
      expect(val(o, 'w')).toBeCloseTo(x, 9);
      expect(val(o, 'h')).toBeCloseTo(y, 9);
      expect(o.fields.every((f) => !f.locked)).toBe(true);
    }
  });
  it('typing a width (not yet committed) fixes only the width; the height keeps following the pointer', () => {
    let o = start();
    o = rectangleTool.step(o.state, { type: 'move', at: { x: 7, y: 30 }, mods }, o.draft, DEFAULT_SETTINGS);
    o = rectangleTool.step(o.state, { type: 'field', id: 'w', value: 20 }, o.draft, DEFAULT_SETTINGS);
    o = rectangleTool.step(o.state, { type: 'move', at: { x: 9, y: 31.5 }, mods }, o.draft, DEFAULT_SETTINGS);
    expect(val(o, 'w')).toBe(20);
    expect(val(o, 'h')).toBeCloseTo(31.5, 9);
    o = rectangleTool.step(o.state, { type: 'key', key: 'Escape' }, o.draft, DEFAULT_SETTINGS);
    o = rectangleTool.step(o.state, { type: 'move', at: { x: 9, y: 31.5 }, mods }, o.draft, DEFAULT_SETTINGS);
    expect(val(o, 'w')).toBeCloseTo(9, 9);
  });
  it('a click places the corner where the pointer is when no snap applies', () => {
    const o = start();
    const c = rectangleTool.step(o.state, { type: 'click', at: { x: 7.37, y: 30.11 }, mods }, o.draft, DEFAULT_SETTINGS);
    const xs = c.draft.points.map((p) => p.x);
    expect(xs).toContain(7.37);
  });
});
