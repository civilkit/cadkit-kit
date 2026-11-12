import { afterEach, describe, expect, it } from 'vitest';
import type { SketchDraft } from '../index';
import { DEFAULT_SETTINGS, type ToolEvent, type ToolOutput } from './types';
import { roundedRectangleTool, type RectState } from './rectangle';
import { closeSessions, solveDraft } from './kernel-fixtures';

afterEach(closeSessions);
const M = { shift: false, ctrl: false, alt: false };

describe('rounded rectangle makes a sketch the real kernel solves', { skip: !process.env.CK_WASM }, () => {
  it('30 x 20 with r = 4 (typed): solved, no conflicts, area 30 x 20 - (4 - pi) 4 x 4', async () => {
    const d0: SketchDraft = { id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [], points: [], entities: [], constraints: [] };
    let o: ToolOutput<RectState> = { state: roundedRectangleTool.start(), draft: d0, preview: [], fields: [] };
    const evs: ToolEvent[] = [{ type: 'click', at: { x: 0, y: 0 }, mods: M }, { type: 'move', at: { x: 3, y: 2 }, mods: M }, { type: 'field', id: 'r', value: 4, commit: true }, { type: 'field', id: 'w', value: 30, commit: true }, { type: 'field', id: 'h', value: 20, commit: true }];
    for (const ev of evs) o = roundedRectangleTool.step(o.state, ev, o.draft, DEFAULT_SETTINGS);
    const { r, facts, status } = await solveDraft(o.draft, 2, { solve: true });
    expect(r.errors).toEqual([]);
    expect(status!.conflicts).toEqual([]);
    expect(status!.solved).toBe(true);
    expect(facts.volume!).toBeCloseTo(2 * (30 * 20 - (4 - Math.PI) * 16), 3);
  });
  it('an untyped radius (default, pointer-sized) also solves', async () => {
    const d0: SketchDraft = { id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [], points: [], entities: [], constraints: [] };
    let o: ToolOutput<RectState> = { state: roundedRectangleTool.start(), draft: d0, preview: [], fields: [] };
    for (const ev of [{ type: 'click', at: { x: 0, y: 0 }, mods: M }, { type: 'click', at: { x: 40, y: 25 }, mods: M }] as ToolEvent[]) o = roundedRectangleTool.step(o.state, ev, o.draft, DEFAULT_SETTINGS);
    const { r, facts, status } = await solveDraft(o.draft, 2, { solve: true });
    expect(r.errors).toEqual([]);
    expect(status!.conflicts).toEqual([]);
    expect(facts.volume!).toBeCloseTo(2 * (40 * 25 - (4 - Math.PI) * 25), 3);
  });
});
