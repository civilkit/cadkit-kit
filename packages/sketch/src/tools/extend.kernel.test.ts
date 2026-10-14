import { afterEach, describe, expect, it } from 'vitest';
import type { SketchDraft } from '../index';
import { extendAt, extendTool } from './extend';
import { DEFAULT_SETTINGS, type ToolEvent } from './types';
import { resolves } from './edit-fixtures';
import { boxSize, closeSessions, solveDraft, solveSketchOnly } from './kernel-fixtures';

afterEach(closeSessions);
const M = { shift: false, ctrl: false, alt: false };
const clickOn = (entityId: string, x: number, y: number): ToolEvent => ({ type: 'click', at: { x, y }, snap: { kind: 'point', at: { x, y }, entityId }, mods: M });

describe('extend produces sketches the real kernel solves', { skip: !process.env.CK_WASM }, () => {
  it('two short sides extended up to the top edge close the outline: it extrudes to the full box (shared corner points)', async () => {
    // bottom (0,0)-(40,0), short left (0,0)-(0,14) and right (40,0)-(40,14) sides, top edge (0,20)-(40,20) floating above them
    const d0: SketchDraft = {
      id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [],
      points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 40, y: 0 }, { id: 'p3', x: 40, y: 14 }, { id: 'p4', x: 0, y: 14 }, { id: 'p5', x: 0, y: 20 }, { id: 'p6', x: 40, y: 20 }],
      entities: [{ id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'line', p1: 'p2', p2: 'p3' }, { id: 'e3', type: 'line', p1: 'p6', p2: 'p5' }, { id: 'e4', type: 'line', p1: 'p1', p2: 'p4' }],
      constraints: [{ id: 'k1', type: 'horizontal', refs: ['e1'] }, { id: 'k2', type: 'vertical', refs: ['e2'] }, { id: 'k3', type: 'vertical', refs: ['e4'] }],
    };
    // open: no region, extruding fails
    const open = await solveDraft(d0, 5);
    expect(open.r.errors.length).toBeGreaterThan(0);

    let d = extendTool.step({}, clickOn('e2', 40, 13), d0, DEFAULT_SETTINGS).draft;
    d = extendTool.step({}, clickOn('e4', 0, 13), d, DEFAULT_SETTINGS).draft;
    expect(resolves(d)).toBe(true);
    expect(d.entities.find((e) => e.id === 'e2')).toMatchObject({ p2: 'p6' });
    expect(d.entities.find((e) => e.id === 'e4')).toMatchObject({ p2: 'p5' });
    const { r, facts, status } = await solveDraft(d, 5, { solve: true });
    expect(r.errors).toEqual([]);
    expect(status!.conflicts).toEqual([]);
    expect(status!.solved).toBe(true);
    expect(boxSize(r.body!.box).slice(0, 2)).toEqual([expect.closeTo(40, 6), expect.closeTo(20, 6)]);
    expect(facts.volume!).toBeCloseTo(5 * 40 * 20, 4);
  });

  it('an extended end that lands on a boundary mid-edge is bound with pointOnLine and solves with that constraint holding', async () => {
    // a rectangle and a stub that stops short of the top edge; extending adds a point on the top edge
    const d0: SketchDraft = {
      id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [],
      points: [{ id: 'p1', x: 0, y: 0, fixed: true }, { id: 'p2', x: 40, y: 0 }, { id: 'p3', x: 40, y: 20 }, { id: 'p4', x: 0, y: 20 }, { id: 'p5', x: 10, y: 5 }, { id: 'p6', x: 10, y: 12 }],
      entities: [{ id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'line', p1: 'p2', p2: 'p3' }, { id: 'e3', type: 'line', p1: 'p3', p2: 'p4' }, { id: 'e4', type: 'line', p1: 'p4', p2: 'p1' }, { id: 'e5', type: 'line', p1: 'p5', p2: 'p6' }],
      constraints: [
        { id: 'k1', type: 'horizontal', refs: ['e1'] }, { id: 'k2', type: 'vertical', refs: ['e2'] }, { id: 'k3', type: 'horizontal', refs: ['e3'] }, { id: 'k4', type: 'vertical', refs: ['e4'] },
        { id: 'k5', type: 'vertical', refs: ['e5'] },
      ],
    };
    const r0 = extendAt(d0, 'e5', { x: 10, y: 11 });
    if (!r0.ok) throw new Error(r0.hint);
    const d = r0.draft;
    const { r, status, pts } = await solveDraft(d, 3, { solve: true });
    expect(r.errors).toEqual([]);
    expect(status!.conflicts).toEqual([]);
    expect(status!.solved).toBe(true);
    const end = d.entities.find((e) => e.id === 'e5')!.p2 as string;
    expect(pts[end][1]).toBeCloseTo(20, 6);                       // on the top edge
    expect(pts[end][0]).toBeCloseTo(10, 6);
  });

  it('an arc extended to a line: the new end is on the circle and on the line, kernel agrees', async () => {
    const d0: SketchDraft = {
      id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [],
      points: [{ id: 'c', x: 0, y: 0, fixed: true }, { id: 'p1', x: 10, y: 0 }, { id: 'p2', x: 0, y: 10 }, { id: 'l1', x: -6, y: -20, fixed: true }, { id: 'l2', x: -6, y: 20, fixed: true }],
      entities: [{ id: 'e1', type: 'arc', c: 'c', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'line', p1: 'l1', p2: 'l2' }],
      constraints: [{ id: 'k1', type: 'radius', refs: ['e1'], value: 10 }],
    };
    const r0 = extendAt(d0, 'e1', { x: 1, y: 9.9 });
    if (!r0.ok) throw new Error(r0.hint);
    const d = r0.draft;
    const arc = d.entities.find((e) => e.id === 'e1')!;
    const { r, status, pts } = await solveSketchOnly({ ...d, points: d.points.map((p) => (p.id === 'p1' ? { ...p, fixed: true } : p)) });
    expect(r.errors).toEqual([]);
    expect(status!.conflicts).toEqual([]);
    expect(status!.solved).toBe(true);
    const end = pts[String(arc.p2)];
    expect(Math.hypot(end[0], end[1])).toBeCloseTo(10, 5);
    expect(end[0]).toBeCloseTo(-6, 5);
  });
});
