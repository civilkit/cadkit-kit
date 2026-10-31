/** Extend two curves to where they meet (solidcraft #8392). */
import { describe, expect, it } from 'vitest';
import type { SketchDraft } from '../index';
import { DEFAULT_SETTINGS, type ToolEvent } from './types';
import { extendTool, extendToMeet } from './extend';
import { resolves } from './edit-fixtures';

const M = { shift: false, ctrl: false, alt: false };
const S = { shift: true, ctrl: false, alt: false };
const clickOn = (entityId: string, x: number, y: number, mods = M): ToolEvent => ({ type: 'click', at: { x, y }, snap: { kind: 'point', at: { x, y }, entityId }, mods });
const pt = (d: SketchDraft, id: string) => d.points.find((p) => p.id === id)!;
const blank = (points: SketchDraft['points'], entities: SketchDraft['entities'], constraints: SketchDraft['constraints'] = []): SketchDraft =>
  ({ id: 'F1', plane: { kind: 'std', id: 'front' }, points, entities, constraints, temp: [] });
const ent = (d: SketchDraft, id: string) => d.entities.find((e) => e.id === id)!;
/** A (0,0)-(8,0) and B (10,-6)-(10,-1): both stop short of (10,0). */
const crossed = () => blank([{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 8, y: 0 }, { id: 'p3', x: 10, y: -6 }, { id: 'p4', x: 10, y: -1 }],
  [{ id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'line', p1: 'p3', p2: 'p4' }],
  [{ id: 'k1', type: 'horizontal', refs: ['e1'] }, { id: 'k2', type: 'vertical', refs: ['e2'] }, { id: 'k3', type: 'equal', refs: ['e1', 'e2'] }]);

describe('extendToMeet', () => {
  it('two lines that stop short both grow to the crossing and share one end point', () => {
    const r = extendToMeet(crossed(), 'e1', 'e2');
    if (!r.ok) throw new Error(r.hint);
    const a = ent(r.draft, 'e1'), b = ent(r.draft, 'e2');
    expect(a.p2).toBe(b.p2);
    expect(pt(r.draft, String(a.p2))).toMatchObject({ x: expect.closeTo(10, 9), y: expect.closeTo(0, 9) });
    expect(a.p1).toBe('p1'); expect(b.p1).toBe('p3');
    expect(r.draft.constraints.map((k) => k.type).sort()).toEqual(['horizontal', 'vertical']);   // the equal went: the lengths changed
    expect(r.added).toHaveLength(2);
    expect(resolves(r.draft)).toBe(true);
  });
  it('a curve that already reaches the crossing stays; the other joins its end point', () => {
    const d = crossed();
    const reach = { ...d, points: d.points.map((p) => (p.id === 'p2' ? { ...p, x: 10 } : p)) };
    const r = extendToMeet(reach, 'e1', 'e2');
    if (!r.ok) throw new Error(r.hint);
    expect(ent(r.draft, 'e1').p2).toBe('p2');
    expect(ent(r.draft, 'e2').p2).toBe('p2');
    expect(r.draft.points.some((p) => p.id === 'p4')).toBe(false);
  });
  it('a line and an arc: the crossing needing the least growth is used', () => {
    const d = blank([{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 10, y: 0 }, { id: 'p3', x: Math.SQRT1_2 * 10, y: Math.SQRT1_2 * 10 }, { id: 'p4', x: -3, y: 8 }, { id: 'p5', x: 3, y: 8 }],
      [{ id: 'e1', type: 'arc', c: 'p1', p1: 'p2', p2: 'p3' }, { id: 'e2', type: 'line', p1: 'p4', p2: 'p5' }]);
    const r = extendToMeet(d, 'e1', 'e2');
    if (!r.ok) throw new Error(r.hint);
    const j = pt(r.draft, String(ent(r.draft, 'e1').p2));
    expect(j).toMatchObject({ x: expect.closeTo(6, 6), y: expect.closeTo(8, 6) });
    expect(ent(r.draft, 'e2').p2).toBe(ent(r.draft, 'e1').p2);
    expect(ent(r.draft, 'e1').p1).toBe('p2');
  });
  it('two crossings needing the same growth are refused, and the picked ends choose between them', () => {
    const d = blank([{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 10 * Math.cos(1.2217304764), y: 10 * Math.sin(1.2217304764) }, { id: 'p3', x: 10 * Math.cos(1.9198621772), y: 10 * Math.sin(1.9198621772) }, { id: 'p4', x: -2, y: 5 }, { id: 'p5', x: 2, y: 5 }],
      [{ id: 'e1', type: 'arc', c: 'p1', p1: 'p2', p2: 'p3' }, { id: 'e2', type: 'line', p1: 'p4', p2: 'p5' }]);
    expect(extendToMeet(d, 'e1', 'e2')).toMatchObject({ ok: false, hint: 'app.sketch.hint.meetAmbiguous' });
    const r = extendToMeet(d, 'e1', 'e2', pt(d, 'p2'), { x: 2, y: 5 });
    if (!r.ok) throw new Error(r.hint);
    expect(pt(r.draft, String(ent(r.draft, 'e2').p2)).x).toBeCloseTo(8.660254, 5);
  });
  it('refuses parallel lines, curves that never meet, a crossing on a body or behind an end, the same curve, a circle', () => {
    const par = blank([{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 5, y: 0 }, { id: 'p3', x: 0, y: 3 }, { id: 'p4', x: 5, y: 3 }], [{ id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'line', p1: 'p3', p2: 'p4' }]);
    expect(extendToMeet(par, 'e1', 'e2')).toMatchObject({ ok: false, hint: 'app.sketch.hint.parallel.more' });
    const far = blank([{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 10, y: 0 }, { id: 'p3', x: 0, y: -10 }, { id: 'p4', x: 5, y: 30 }, { id: 'p5', x: 20, y: 30 }, { id: 'p6', x: 0, y: 0 }],
      [{ id: 'e1', type: 'arc', c: 'p1', p1: 'p2', p2: 'p3' }, { id: 'e2', type: 'line', p1: 'p4', p2: 'p5' }]);
    expect(extendToMeet(far, 'e1', 'e2')).toMatchObject({ ok: false, hint: 'app.sketch.hint.noMeet' });
    const body = blank([{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 10, y: 0 }, { id: 'p3', x: 5, y: -6 }, { id: 'p4', x: 5, y: -1 }], [{ id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'line', p1: 'p3', p2: 'p4' }]);
    expect(extendToMeet(body, 'e1', 'e2')).toMatchObject({ ok: false, hint: 'app.sketch.hint.meetBehind' });
    expect(extendToMeet(crossed(), 'e1', 'e1')).toMatchObject({ ok: false, hint: 'app.sketch.hint.pickOtherCurve' });
    const circ = blank([{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 5, y: 5 }, { id: 'p3', x: 9, y: 5 }], [{ id: 'e1', type: 'circle', c: 'p1', r: 3 }, { id: 'e2', type: 'line', p1: 'p2', p2: 'p3' }]);
    expect(extendToMeet(circ, 'e1', 'e2')).toMatchObject({ ok: false, hint: 'app.sketch.hint.pickExtendable' });
    expect(extendToMeet(crossed(), 'e1', 'e9')).toMatchObject({ ok: false, hint: 'app.sketch.hint.pickExtendable' });
  });
});

describe('extend tool: shift-click two curves', () => {
  it('asks for the second curve, then joins both; a plain click still extends one curve', () => {
    let o = extendTool.step(extendTool.start(), clickOn('e1', 7, 0, S), crossed(), DEFAULT_SETTINGS);
    expect(o.hint).toBe('app.sketch.hint.pickSecondCurve');
    expect(o.draft).toEqual(crossed());
    o = extendTool.step(o.state, { type: 'move', at: { x: 10, y: -2 }, snap: { kind: 'point', at: { x: 10, y: -2 }, entityId: 'e2' }, mods: M }, o.draft, DEFAULT_SETTINGS);
    expect(o.preview.length).toBe(2);                       // the two pieces that would be added
    o = extendTool.step(o.state, clickOn('e2', 10, -2, S), o.draft, DEFAULT_SETTINGS);
    expect(o.hint).toBeUndefined();
    expect(ent(o.draft, 'e1').p2).toBe(ent(o.draft, 'e2').p2);
    expect(o.state).toEqual({});
    const single = extendTool.step(extendTool.start(), clickOn('e1', 7, 0), crossed(), DEFAULT_SETTINGS);
    expect(single.hint).toBe('app.sketch.hint.nothingToExtend');       // one curve alone has nothing ahead to reach
    expect(single.draft).toEqual(crossed());
  });
  it('a refused pair names the reason in the status line and keeps the first pick', () => {
    const par = blank([{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 5, y: 0 }, { id: 'p3', x: 0, y: 3 }, { id: 'p4', x: 5, y: 3 }], [{ id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'line', p1: 'p3', p2: 'p4' }]);
    let o = extendTool.step(extendTool.start(), clickOn('e1', 4, 0, S), par, DEFAULT_SETTINGS);
    o = extendTool.step(o.state, clickOn('e2', 4, 3, S), o.draft, DEFAULT_SETTINGS);
    expect(o.hint).toBe('app.sketch.hint.parallel.more');
    expect(o.draft).toEqual(par);
    expect(o.state.first?.id).toBe('e1');
  });
});
