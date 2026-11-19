import { afterEach, describe, expect, it } from 'vitest';
import { constrainTypedPoint, newPointAt, type SketchDraft, type ToolEvent } from './index';
import { circleTool } from './tools/circle';
import { DEFAULT_SETTINGS } from './tools/types';
import { closeSessions, solveSketchOnly } from './tools/kernel-fixtures';

afterEach(closeSessions);
const M = { shift: false, ctrl: false, alt: false };
const click = (x: number, y: number): ToolEvent => ({ type: 'click', at: { x, y }, mods: M });

/** What the coordinate box does for the Circle tool: a click at the typed place, then the point the tool made gets its dimensions. */
function circleAt(x: number, y: number): SketchDraft {
  let draft: SketchDraft = { id: 'F1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }], entities: [], constraints: [], temp: [] };
  let s = circleTool.start();
  s = circleTool.step(s, click(x, y), draft, DEFAULT_SETTINGS).state;
  const o = circleTool.step(s, { type: 'field', id: 'radius', value: 20, commit: true }, draft, DEFAULT_SETTINGS);
  const id = newPointAt(draft, o.draft, { x, y })!;
  return constrainTypedPoint(o.draft, id, { x, y });
}

describe('typed first point against the real solver', { skip: !process.env.CK_WASM }, () => {
  it('a circle at (-30, 0) has a fully fixed centre: no conflicts, no redundancy, only the radius left to be given', async () => {
    const d = circleAt(-30, 0);
    expect(d.constraints.map((c) => c.type).sort()).toEqual(['hdist', 'horizontal', 'radius']);
    const r = await solveSketchOnly(d);
    expect(r.status?.conflicts ?? []).toEqual([]);
    expect(r.status?.redundant ?? []).toEqual([]);
    expect(r.status?.dof).toBe(0);
    const c = d.points.find((p) => p.id !== 'O')!;
    expect(r.pts[c.id]).toEqual([-30, 0]);
  });
  it('a circle at (12, 7) is fixed by two dimensions', async () => {
    const d = circleAt(12, 7);
    const r = await solveSketchOnly(d);
    expect(r.status?.conflicts ?? []).toEqual([]);
    expect(r.status?.dof).toBe(0);
  });
  it('a circle at the origin is coincident with it', async () => {
    const d = circleAt(0, 0);
    expect(d.constraints.map((c) => c.type).sort()).toEqual(['coincident', 'radius']);
    const r = await solveSketchOnly(d);
    expect(r.status?.dof).toBe(0);
  });
});
