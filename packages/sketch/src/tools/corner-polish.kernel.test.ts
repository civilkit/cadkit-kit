import { afterEach, describe, expect, it } from 'vitest';
import { applyCorners, cornerAtPoint } from './corner';
import { extendToMeet } from './extend';
import { filletTool } from './fillet';
import { DEFAULT_SETTINGS, type ToolEvent } from './types';
import { rectDraft } from './edit-fixtures';
import { boxSize, closeSessions, solveDraft } from './kernel-fixtures';
import type { SketchDraft } from '../index';

afterEach(closeSessions);
const M = { shift: false, ctrl: false, alt: false };
const clickOn = (entityId: string): ToolEvent => ({ type: 'click', at: { x: 0, y: 0 }, snap: { kind: 'point', at: { x: 0, y: 0 }, entityId }, mods: M });

describe('corner / extend polish produces sketches the real kernel solves', { skip: !process.env.CK_WASM }, () => {
  it('a radius of half a side: a 10 x 10 square becomes a circle of r 5 (four tangent arcs, no lines)', async () => {
    const d0 = rectDraft(10, 10);
    const r0 = applyCorners(d0, ['p1', 'p2', 'p3', 'p4'].map((p) => cornerAtPoint(d0, p)!), 'fillet', 5, true);
    if (!r0.ok) throw new Error(r0.hint);
    const { r, facts, status } = await solveDraft(r0.draft, 3, { solve: true });
    expect(r.errors).toEqual([]);
    expect(status!.conflicts).toEqual([]);
    expect(status!.solved).toBe(true);
    expect(facts.volume!).toBeCloseTo(3 * 25 * Math.PI, 3);
  });

  it('a 20 x 10 rectangle with r = 5 at every corner is a stadium: area 10 x 10 + 25 pi', async () => {
    const d0 = rectDraft(20, 10);
    const r0 = applyCorners(d0, ['p1', 'p2', 'p3', 'p4'].map((p) => cornerAtPoint(d0, p)!), 'fillet', 5, true);
    if (!r0.ok) throw new Error(r0.hint);
    const { r, facts, status } = await solveDraft(r0.draft, 2, { solve: true });
    expect(r.errors).toEqual([]);
    expect(status!.conflicts).toEqual([]);
    expect(facts.volume!).toBeCloseTo(2 * (10 * 10 + 25 * Math.PI), 3);
    expect(boxSize(r.body!.box).slice(0, 2)).toEqual([expect.closeTo(20, 6), expect.closeTo(10, 6)]);
  });

  it('two lines that stop short, rounded by the fillet tool, close an outline the kernel extrudes', async () => {
    // an L whose corner is open: a (0,0)-(0,18) up the left, b (2,20)-(20,20) along the top; plus the closing sides
    const d0: SketchDraft = {
      id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [],
      points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 20, y: 0 }, { id: 'p3', x: 20, y: 20 }, { id: 'p4', x: 3, y: 20 }, { id: 'p5', x: 0, y: 17 }],
      entities: [{ id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'line', p1: 'p2', p2: 'p3' }, { id: 'e3', type: 'line', p1: 'p3', p2: 'p4' }, { id: 'e4', type: 'line', p1: 'p1', p2: 'p5' }],
      constraints: [],
    };
    let o = { state: filletTool.start(), draft: d0, preview: [] as never[], fields: [] as never[] } as ReturnType<typeof filletTool.step>;
    for (const ev of [{ type: 'field', id: 'r', value: 4, commit: true } as ToolEvent, clickOn('e4'), clickOn('e3')]) o = filletTool.step(o.state, ev, o.draft, DEFAULT_SETTINGS);
    expect(o.hint).toBeUndefined();
    const { r, facts, status } = await solveDraft(o.draft, 2, { solve: true });
    expect(r.errors).toEqual([]);
    expect(status!.conflicts).toEqual([]);
    expect(facts.volume!).toBeCloseTo(2 * (400 - (1 - Math.PI / 4) * 16), 3);
  });

  it('extendToMeet on two sides that stop short closes the outline: it extrudes to the full box', async () => {
    const d0: SketchDraft = {
      id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [],
      points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 27, y: 0 }, { id: 'p3', x: 30, y: 3 }, { id: 'p4', x: 30, y: 20 }, { id: 'p5', x: 0, y: 20 }],
      entities: [{ id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'line', p1: 'p3', p2: 'p4' }, { id: 'e3', type: 'line', p1: 'p4', p2: 'p5' }, { id: 'e4', type: 'line', p1: 'p5', p2: 'p1' }],
      constraints: [{ id: 'k1', type: 'horizontal', refs: ['e1'] }, { id: 'k2', type: 'vertical', refs: ['e2'] }],
    };
    expect((await solveDraft(d0, 2)).r.errors.length).toBeGreaterThan(0);          // open: no region
    const m = extendToMeet(d0, 'e1', 'e2');
    if (!m.ok) throw new Error(m.hint);
    const { r, facts, status } = await solveDraft(m.draft, 2, { solve: true });
    expect(r.errors).toEqual([]);
    expect(status!.conflicts).toEqual([]);
    expect(status!.solved).toBe(true);
    expect(boxSize(r.body!.box).slice(0, 2)).toEqual([expect.closeTo(30, 6), expect.closeTo(20, 6)]);
    expect(facts.volume!).toBeCloseTo(2 * 600, 3);
  });
});
