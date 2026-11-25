/** The arc length dimension (tool key L) is held by the real kernel: a constraint {type:'arclength', refs:[arc], value}. Needs a kernel with the arclength kind. */
import { afterEach, describe, expect, it } from 'vitest';
import type { SketchDraft } from './index';
import { dimensionTool } from './tools/dimension';
import { DEFAULT_SETTINGS, type Tool, type ToolEvent, type ToolOutput } from './tools/types';
import { closeSessions, solveDraft } from './tools/kernel-fixtures';

afterEach(closeSessions);
const M = { shift: false, ctrl: false, alt: false };
const entity = (id: string): ToolEvent => ({ type: 'click', at: { x: 0, y: 0 }, snap: { kind: 'grid', at: { x: 0, y: 0 }, entityId: id }, mods: M });
const run = <S,>(tool: Tool<S>, events: ToolEvent[], draft: SketchDraft): ToolOutput<S> => {
  let out: ToolOutput<S> = { state: tool.start(), draft, preview: [], fields: [] };
  for (const ev of events) out = tool.step(out.state, ev, out.draft, DEFAULT_SETTINGS);
  return out;
};

describe('arc length dimension in the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('a 90 degree arc of radius 20 dimensioned to 25 mm re-solves to that length (sweep 1.25 rad)', async () => {
    const d: SketchDraft = { id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [], constraints: [],
      points: [{ id: 'c', x: 0, y: 0, fixed: true }, { id: 'a', x: 20, y: 0, fixed: true }, { id: 'b', x: 0, y: 20 }],
      entities: [{ id: 'e1', type: 'arc', c: 'c', p1: 'a', p2: 'b' }, { id: 'e2', type: 'line', p1: 'c', p2: 'a' }, { id: 'e3', type: 'line', p1: 'b', p2: 'c' }] };   // a pie wedge: a closed profile
    const o = run(dimensionTool, [entity('e1'), { type: 'key', key: 'l' }, { type: 'field', id: 'value', value: 25, commit: true }], d);
    expect(o.draft.constraints.at(-1)).toMatchObject({ type: 'arclength', refs: ['e1'], value: 25 });
    const { r, status, pts } = await solveDraft(o.draft, 2, { solve: true });
    expect(r.errors).toEqual([]);
    expect(status?.conflicts).toEqual([]);
    const b = pts.b;
    expect(Math.hypot(b[0], b[1])).toBeCloseTo(20, 4);                       // still on the arc
    expect(Math.atan2(b[1], b[0])).toBeCloseTo(25 / 20, 4);                  // swept 1.25 rad from the +X end
  });
});
