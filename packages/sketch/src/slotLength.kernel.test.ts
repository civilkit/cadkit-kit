/** The overall-length dimension on a slot's caps is accepted by the real kernel: a centre-distance constraint carrying the extra `overall` field. */
import { afterEach, describe, expect, it } from 'vitest';
import type { SketchDraft } from './index';
import { slotTool } from './tools/slot';
import { dimensionTool } from './tools/dimension';
import { DEFAULT_SETTINGS, type Tool, type ToolEvent, type ToolOutput } from './tools/types';
import { closeSessions, solveDraft } from './tools/kernel-fixtures';

afterEach(closeSessions);
const M = { shift: false, ctrl: false, alt: false };
const click = (x: number, y: number): ToolEvent => ({ type: 'click', at: { x, y }, mods: M });
const entity = (id: string): ToolEvent => ({ type: 'click', at: { x: 0, y: 0 }, snap: { kind: 'grid', at: { x: 0, y: 0 }, entityId: id }, mods: M });
const run = <S,>(tool: Tool<S>, events: ToolEvent[], draft: SketchDraft): ToolOutput<S> => {
  let out: ToolOutput<S> = { state: tool.start(), draft, preview: [], fields: [] };
  for (const ev of events) out = tool.step(out.state, ev, out.draft, DEFAULT_SETTINGS);
  return out;
};
const empty = (): SketchDraft => ({ id: 'F1', plane: { kind: 'std', id: 'front' }, points: [], entities: [], constraints: [], temp: [] });

describe('slot overall length in the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('the dimensioned slot solves, and re-solves to the typed overall length', async () => {
    const slot = run(slotTool, [click(0, 0), click(20, 0), click(20, 4)], empty()).draft;
    const [a, b] = slot.entities.filter((e) => e.type === 'arc').map((e) => e.id);
    const o = run(dimensionTool, [entity(a), entity(b), { type: 'field', id: 'value', value: 40, commit: true }], slot);
    const k = o.draft.constraints.find((c) => c.overall === true)!;
    expect(k).toMatchObject({ type: 'distance', value: 32 });
    const { r, status, pts } = await solveDraft(o.draft, 2, { solve: true });
    expect(r.errors).toEqual([]);
    expect(status?.conflicts).toEqual([]);
    const xs = Object.values(pts).map((p) => p[0]);
    const c1 = o.draft.entities.find((e) => e.id === a)!.c as string, c2 = o.draft.entities.find((e) => e.id === b)!.c as string;
    expect(Math.hypot(pts[c1][0] - pts[c2][0], pts[c1][1] - pts[c2][1])).toBeCloseTo(32, 4);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(30);
  });
});
