import { describe, expect, it } from 'vitest';
import type { SketchDraft } from '../index';
import { DEFAULT_SETTINGS, type ToolEvent } from './types';
import { mirrorEntities, mirrorTool } from './mirror';
import { rectDraft, resolves } from './edit-fixtures';

const M = { shift: false, ctrl: false, alt: false };
const clickOn = (entityId: string): ToolEvent => ({ type: 'click', at: { x: 0, y: 0 }, snap: { kind: 'point', at: { x: 0, y: 0 }, entityId }, mods: M });

describe('mirror: what the app needs from the tool', () => {
  it('a selection is drawn highlighted, so the app routes Enter to the tool instead of confirming the sketch', () => {
    const o = mirrorTool.step(mirrorTool.start(), clickOn('e1'), rectDraft(10, 10), DEFAULT_SETTINGS);
    expect(o.state.selected).toEqual(['e1']);
    expect(o.preview.length).toBeGreaterThan(0);
    const again = mirrorTool.step(o.state, clickOn('e1'), o.draft, DEFAULT_SETTINGS);   // unselect
    expect(again.preview).toEqual([]);
  });
});

describe('mirror: constraints that keep the copy symmetric without over-constraining', () => {
  const base = (): SketchDraft => ({
    id: 'F1', plane: {}, temp: [],
    points: [{ id: 'a1', x: 0, y: -5, fixed: true }, { id: 'a2', x: 0, y: 25, fixed: true }, { id: 'p1', x: 10, y: 0 }, { id: 'p2', x: 15, y: 5 }, { id: 'c', x: 10, y: 5 }, { id: 'q', x: 20, y: 20 }],
    entities: [{ id: 'axis', type: 'line', p1: 'a1', p2: 'a2' }, { id: 'e1', type: 'arc', c: 'c', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'circle', c: 'q', r: 3 }],
    constraints: [],
  });
  it('a quarter arc: the centre is not mirrored with symmetric; the copy has equal radius instead', () => {
    const r = mirrorEntities(base(), ['e1'], 'axis');
    if (!r.ok) throw new Error(r.hint);
    const sym = r.draft.constraints.filter((c) => c.type === 'symmetric');
    expect(sym).toHaveLength(2);                                  // the two ends
    expect(sym.some((c) => c.refs![0] === 'c')).toBe(false);
    expect(r.draft.constraints.find((c) => c.type === 'equal')).toMatchObject({ refs: ['e1', r.draft.entities[r.draft.entities.length - 1].id] });
    expect(resolves(r.draft)).toBe(true);
  });
  it('a circle copy gets equal radius with the original', () => {
    const r = mirrorEntities(base(), ['e2'], 'axis');
    if (!r.ok) throw new Error(r.hint);
    expect(r.draft.constraints.find((c) => c.type === 'equal')).toMatchObject({ refs: ['e2', expect.any(String)] });
    expect(r.draft.constraints.filter((c) => c.type === 'symmetric')).toHaveLength(1);
  });
  it('a half circle across a vertical axis: one end gets only "same row", not the full symmetric', () => {
    const d = base();
    const half: SketchDraft = { ...d, points: d.points.map((p) => (p.id === 'p1' ? { ...p, x: 7, y: 1 } : p.id === 'p2' ? { ...p, x: 13, y: 9 } : p)), entities: d.entities };
    const r = mirrorEntities(half, ['e1'], 'axis');
    if (!r.ok) throw new Error(r.hint);
    expect(r.draft.constraints.filter((c) => c.type === 'horizontal')).toHaveLength(1);
    expect(r.draft.constraints.filter((c) => c.type === 'symmetric')).toHaveLength(2);    // centre + the other end
  });
  it('the mirrored line and its end points keep their symmetric constraints (the plain case is unchanged)', () => {
    const d0 = rectDraft(10, 10);
    const r = mirrorEntities(d0, ['e1', 'e2', 'e3'], 'e4');
    if (!r.ok) throw new Error(r.hint);
    expect(r.draft.constraints.filter((c) => c.type === 'symmetric')).toHaveLength(2);
  });
});
