import { afterEach, describe, expect, it } from 'vitest';
import type { SketchDraft } from '../index';
import { makeDriven } from '../refdims';
import { DEFAULT_SETTINGS, type ToolEvent, type ToolSettings } from './types';
import { lineTool } from './line';
import { closeSessions, solveSketchOnly } from './kernel-fixtures';

afterEach(closeSessions);
const M = { shift: false, ctrl: false, alt: false };
const move = (x: number, y: number): ToolEvent => ({ type: 'move', at: { x, y }, mods: M });
const field = (id: string, value: number): ToolEvent => ({ type: 'field', id, value, commit: true });
const typed = (len: number, ang: number): ToolEvent[] => [move(1, 1), field('len', len), field('ang', ang)];
const deg = (r: number) => (r * 180) / Math.PI;

/** The bottle outline drawn only with typed values (a straight shoulder in place of the spline): typed first point, a typed length and angle per segment, the last one back to the start. */
function outline(settings: ToolSettings): SketchDraft {
  const seg = (a: [number, number], b: [number, number]) => typed(Math.hypot(b[0] - a[0], b[1] - a[1]), deg(Math.atan2(b[1] - a[1], b[0] - a[0])));
  const pts: Array<[number, number]> = [[0, 10], [5, 10], [15, 0], [25, 0], [35, 10], [35, 130], [20, 175], [15, 175], [15, 185], [20, 185], [20, 190], [15, 190], [15, 200], [0, 200], [0, 10]];
  const ev: ToolEvent[] = [{ type: 'key', key: 'Tab' }, field('x', 0), field('y', 10)];
  for (let i = 1; i < pts.length; i++) ev.push(...seg(pts[i - 1], pts[i]));
  let state = lineTool.start();
  let draft: SketchDraft = { id: 'F1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }], entities: [], constraints: [], temp: [] };
  for (const e of ev) { const o = lineTool.step(state, e, draft, settings); state = o.state; draft = o.draft; }
  return draft;
}

describe('typed lengths and angles against the real solver', { skip: !process.env.CK_WASM }, () => {
  it('the angle dimensions do not over-constrain the outline, and the degrees of freedom drop', async () => {
    const off = outline({ ...DEFAULT_SETTINGS, typedAngleDims: false });
    const on = outline(DEFAULT_SETTINGS);
    const nAngles = on.constraints.filter((c) => c.type === 'angle').length;
    expect(nAngles).toBeGreaterThan(5);
    expect(off.constraints.filter((c) => c.type === 'angle')).toHaveLength(0);
    const a = await solveSketchOnly(off);
    let b = await solveSketchOnly(on);
    const raw = `${on.entities.length} lines, ${nAngles} angle dimensions; DOF without ${a.status?.dof}, with ${b.status?.dof}; redundant ${JSON.stringify(b.status?.redundant)}, conflicts ${JSON.stringify(b.status?.conflicts)}`;
    // the app turns a dimension the solver finds already given (or in conflict) into a reference dimension at once (`settleDimensions` in main.tsx): the same here
    let settled = on;
    for (let i = 0; i < 4 && (b.status!.redundant.length || b.status!.conflicts.length); i++) {
      for (const id of [...b.status!.redundant, ...b.status!.conflicts]) settled = makeDriven(settled, id) ?? settled;
      b = await solveSketchOnly(settled);
    }
    console.log(`typed outline: ${raw}; after the app's settling: DOF ${b.status?.dof}, redundant ${JSON.stringify(b.status?.redundant)}, conflicts ${JSON.stringify(b.status?.conflicts)}, state ${b.status?.state}`);
    expect(a.status?.conflicts ?? []).toEqual([]);
    expect(b.status?.conflicts ?? []).toEqual([]);
    expect(b.status?.redundant ?? []).toEqual([]);
    expect(b.status!.dof).toBeLessThan(a.status!.dof);
  });
});
