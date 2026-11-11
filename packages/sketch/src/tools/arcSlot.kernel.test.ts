import { afterEach, describe, expect, it } from 'vitest';
import { toFeature, type SketchDraft } from '../index';
import { DEFAULT_SETTINGS, type Tool, type ToolEvent, type ToolOutput } from './types';
import { arcSlotTool } from './arcSlot';
import { closeSessions, solveDraft } from './kernel-fixtures';

const M = { shift: false, ctrl: false, alt: false };
const click = (x: number, y: number): ToolEvent => ({ type: 'click', at: { x, y }, mods: M });
const move = (x: number, y: number): ToolEvent => ({ type: 'move', at: { x, y }, mods: M });
const field = (id: string, value: number): ToolEvent => ({ type: 'field', id, value, commit: true });
const draft0 = (): SketchDraft => ({ id: 'F1', plane: { kind: 'std', id: 'front' }, points: [], entities: [], constraints: [], temp: [] });
function run<S>(tool: Tool<S>, events: ToolEvent[]): ToolOutput<S> {
  let out: ToolOutput<S> = { state: tool.start(), draft: draft0(), preview: [], fields: [] };
  for (const ev of events) out = tool.step(out.state, ev, out.draft, DEFAULT_SETTINGS);
  return out;
}
afterEach(closeSessions);

const area = (w: number, R: number, sweep: number) => w * R * sweep + Math.PI * (w / 2) ** 2;

describe('arc slot draws sketches the real kernel accepts', { skip: !process.env.CK_WASM }, () => {
  it('counter-clockwise: one valid solid of area w R sweep + pi (w/2)^2, solver happy, 6 degrees of freedom', async () => {
    const o = run(arcSlotTool, [click(0, 0), click(12, 16), click(-20, 0), click(0, 24)]);       // R 20, sweep 126.87 degrees, w 8
    const sweep = Math.PI - Math.atan2(16, 12);
    const { r, facts, status } = await solveDraft(o.draft, 3, { solve: true });
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(facts.solids).toBe(1);
    expect(facts.volume).toBeCloseTo(area(8, 20, sweep) * 3, 2);
    expect(status).toMatchObject({ solved: true, conflicts: [] });
    expect(status!.dof).toBe(6);                                                                   // centre x, y, R, start angle, sweep, width
  });

  it('clockwise pointer: same area for the mirrored sweep', async () => {
    const o = run(arcSlotTool, [click(0, 0), click(12, 16), move(20, 0), click(14, -14), click(0, 24)]);
    const sweep = Math.atan2(16, 12) + Math.PI / 4;
    const { r, facts, status } = await solveDraft(o.draft, 2, { solve: true });
    expect(r.ok).toBe(true);
    expect(facts.volume).toBeCloseTo(area(8, 20, sweep) * 2, 2);
    expect(status).toMatchObject({ solved: true, conflicts: [] });
  });

  it('a sweep over half a turn (270 degrees) is still one valid solid', async () => {
    const o = run(arcSlotTool, [click(0, 0), click(14, 14), move(-14, 14), move(-14, -14), move(14, -14), click(14, -14), click(23.799, 0)]);
    expect(o.draft.entities).toHaveLength(4);
    const R = Math.hypot(14, 14);
    const { r, facts, status } = await solveDraft(o.draft, 1, { solve: true });
    expect(r.ok).toBe(true);
    expect(facts.solids).toBe(1);
    expect(facts.volume).toBeCloseTo(area(2 * (23.799 - R), R, (3 * Math.PI) / 2), 1);
    expect(status).toMatchObject({ solved: true, conflicts: [] });
  });

  it('typed radius, sweep and width hold: the dimensions stay and the extrude/cut areas are right', async () => {
    let o = run(arcSlotTool, [click(5, 5), move(12, 5), field('len', 30), field('ang', 0), move(5, 40)]);
    o = { ...o, ...arcSlotTool.step(o.state, field('sweep', 90), o.draft, DEFAULT_SETTINGS) };
    o = { ...o, ...arcSlotTool.step(o.state, field('w', 6), o.draft, DEFAULT_SETTINGS) };
    expect(o.draft.entities).toHaveLength(4);
    const { r, facts, status } = await solveDraft(o.draft, 2, { solve: true });
    expect(r.ok).toBe(true);
    expect(facts.volume).toBeCloseTo(area(6, 30, Math.PI / 2) * 2, 2);
    expect(status).toMatchObject({ solved: true, conflicts: [] });
    expect(status!.dof).toBe(4);                                                                   // radius and width are dimensioned
  });

  it('cuts a curved groove out of a plate: removed volume is the slot area times the depth', async () => {
    const o = run(arcSlotTool, [click(0, 0), click(12, 16), click(-20, 0), click(0, 24)]);
    const sweep = Math.PI - Math.atan2(16, 12);
    const plate: SketchDraft = { ...draft0(), points: [{ id: 'a', x: -40, y: -40 }, { id: 'b', x: 40, y: -40 }, { id: 'c', x: 40, y: 40 }, { id: 'd', x: -40, y: 40 }],
      entities: [{ id: 'e1', type: 'line', p1: 'a', p2: 'b' }, { id: 'e2', type: 'line', p1: 'b', p2: 'c' }, { id: 'e3', type: 'line', p1: 'c', p2: 'd' }, { id: 'e4', type: 'line', p1: 'd', p2: 'a' }] };
    const slot: SketchDraft = { ...o.draft, id: 'F3' };
    const { r, facts } = await solveDraft(plate, 5, {
      extra: [toFeature(slot) as unknown as Record<string, unknown>, { type: 'extrude', op: 'cut', sketch: 'F3', end: 'blind', depth: 2, flip: true, id: 'F4' }],
    });
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(facts.solids).toBe(1);
    expect(facts.volume).toBeCloseTo(80 * 80 * 5 - area(8, 20, sweep) * 2, 1);
  });
});
