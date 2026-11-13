// Add spline point through the pointer path the app uses (screen position -> sketch position -> snap -> curve pick -> tool), not by handing the tool an entity id.
import { describe, expect, it } from 'vitest';
import { snapAt, withPickedEntity, toolById, type SketchDraft } from './index';
import { DEFAULT_SETTINGS, type Pt, type Tool, type ToolEvent, type ToolOutput } from './tools/types';
import { fitCurve } from './tools/splineMath';

const M = { shift: false, ctrl: false, alt: false };
const SCALE = 6, PICK_PX = 8;   // 6 screen pixels per sketch unit, a pick radius of 8 px
const toSketch = (sx: number, sy: number): Pt => ({ x: sx / SCALE, y: -sy / SCALE });
const toScreen = (p: Pt) => ({ sx: p.x * SCALE, sy: -p.y * SCALE });
const draft = (closed = false): SketchDraft => ({
  id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [],
  points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 10, y: 8 }, { id: 'p3', x: 25, y: -4 }, { id: 'p4', x: 40, y: 6 }, { id: 'p9', x: 5, y: 30 }, { id: 'p10', x: 45, y: 30 }],
  entities: [{ id: 'e1', type: 'spline', pts: ['p1', 'p2', 'p3', 'p4'], ...(closed ? { closed: true } : {}) }, { id: 'e2', type: 'line', p1: 'p9', p2: 'p10' }],
  constraints: [{ id: 'k1', type: 'fix', refs: ['p1'], value: [0, 0] }, { id: 'k2', type: 'dimension', refs: ['p9', 'p10'], value: 40 }],
});

/** What main.tsx does for one pointer event: the snap, the picked curve for this tool, then the tool step. */
function pointer(tool: Tool<unknown>, toolId: string, d: SketchDraft, type: 'move' | 'click', sx: number, sy: number, snapOn: boolean): ToolOutput<unknown> {
  const at = toSketch(sx, sy), tol = PICK_PX / SCALE;
  const kinds = snapOn ? undefined : { grid: true } as never;
  let snap = snapAt(d, at, { tolerance: tol, ...(kinds ? { kinds } : {}) });
  snap = withPickedEntity(toolId, d, at, tol, snap) as typeof snap;
  const ev: ToolEvent = { type, at, snap, mods: M };
  return tool.step(tool.start(), ev, d, DEFAULT_SETTINGS, { tol });
}
const ids = (d: SketchDraft) => d.entities.find((e) => e.id === 'e1')!.pts as string[];
const tool = () => toolById('spline-add')!.tool as unknown as Tool<unknown>;

describe('Add spline point from a click on the curve', () => {
  for (const snapOn of [true, false]) {
    it(`open spline, snapping ${snapOn ? 'on' : 'off'}: a click 2 px off the curve adds a point, id and constraints kept`, () => {
      const d0 = draft();
      const c = fitCurve(d0.points.slice(0, 4), false).find((q) => q.x > 14 && q.x < 16)!;
      const s = toScreen(c);
      const o = pointer(tool(), 'spline-add', d0, 'click', s.sx + 1.5, s.sy + 1.5, snapOn);
      expect(o.hint).toBe('app.sketch.hint.splineAdded');
      expect(ids(o.draft)).toHaveLength(5);
      expect(ids(o.draft)[0]).toBe('p1'); expect(ids(o.draft)[4]).toBe('p4');
      expect(o.draft.entities.find((e) => e.id === 'e1')!.id).toBe('e1');
      expect(o.draft.constraints).toEqual(d0.constraints);
    });
  }
  it('closed spline: a click on the closing span goes at the end of the list', () => {
    const d0 = draft(true);
    const w = fitCurve(d0.points.slice(0, 4), true);
    const s = toScreen(w[w.length - 9]);
    const o = pointer(tool(), 'spline-add', d0, 'click', s.sx, s.sy + 2, true);
    expect(o.hint).toBe('app.sketch.hint.splineAdded');
    expect(ids(o.draft)).toHaveLength(5);
    expect(ids(o.draft)[4]).toMatch(/^p/);
    expect(ids(o.draft).slice(0, 4)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });
  it('a click far from the curve is refused with the pick message and changes nothing', () => {
    const d0 = draft();
    const o = pointer(tool(), 'spline-add', d0, 'click', 15 * SCALE, 200, true);
    expect(o.hint).toBe('app.sketch.hint.splineAddPick');
    expect(o.draft).toBe(d0);
  });
  it('a click on a line is refused, a click on a data point is refused', () => {
    const d0 = draft();
    expect(pointer(tool(), 'spline-add', d0, 'click', 20 * SCALE, -30 * SCALE, true).hint).toBe('app.sketch.hint.splineAddPick');
    expect(pointer(tool(), 'spline-add', d0, 'click', 10 * SCALE, -8 * SCALE, true).hint).toBe('app.sketch.hint.splineAddAtPoint');
  });
  it('hover over the curve previews the place', () => {
    const c = fitCurve(draft().points.slice(0, 4), false).find((q) => q.x > 14 && q.x < 16)!;
    const s = toScreen(c);
    expect(pointer(tool(), 'spline-add', draft(), 'move', s.sx, s.sy + 1, true).preview.length).toBe(1);
    expect(pointer(tool(), 'spline-add', draft(), 'move', 500, 500, true).preview.length).toBe(0);
  });
  it('the offset tool still picks a line through the same path, and other tools get their snap unchanged', () => {
    const d0 = draft();
    const at = { x: 20, y: 30.05 };
    const sn = withPickedEntity('offset', d0, at, 0.5, undefined) as { entityId?: string } | undefined;
    expect(sn?.entityId).toBe('e2');
    const keep = { kind: 'point' as const, at, entityId: 'x' };
    expect(withPickedEntity('line', d0, at, 0.5, keep)).toBe(keep);
    expect(withPickedEntity('line', d0, at, 0.5, undefined)).toBeUndefined();
    // offset does not pick a spline
    const s = fitCurve(d0.points.slice(0, 4), false)[20];
    expect(withPickedEntity('offset', d0, s, 0.5, undefined)).toBeUndefined();
  });
});
