import { describe, expect, it } from 'vitest';
import type { SketchDraft } from './index';
import { annotate } from './annotations';
import { layoutDimensions, obbOverlap, LEVEL_PX, type ToPx } from './dimLayout';
import { placementsOf, setDimPlacement, resetDimPlacement, pruneDimPlacement, placementFromPointer } from './dimPlacement';
import { fromFeature, toFeature } from './index';

const draft = (): SketchDraft => ({
  id: 'S', plane: { kind: 'std', id: 'front' }, temp: [],
  points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 40, y: 0 }, { id: 'c', x: 40, y: 20 }],
  entities: [{ id: 'e1', type: 'line', p1: 'a', p2: 'b' }, { id: 'e2', type: 'line', p1: 'b', p2: 'c' }],
  constraints: [{ id: 'k1', type: 'distance', refs: ['a', 'b'], value: 40 }, { id: 'k2', type: 'distance', refs: ['b', 'c'], value: 20 }],
} as unknown as SketchDraft);
const Z = 5;
const to: ToPx = (u, v) => ({ x: 200 + u * Z, y: 400 - v * Z });
const VP = { w: 800, h: 600 };

describe('manual dimension placement', () => {
  it('stores, resets and round-trips through the feature', () => {
    let d = setDimPlacement(draft(), 'k1', { level: 3, side: -1 });
    expect(placementsOf(d)).toEqual({ k1: { level: 3, side: -1 } });
    const back = fromFeature(toFeature(d));
    expect(placementsOf(back)).toEqual({ k1: { level: 3, side: -1 } });
    d = resetDimPlacement(d, 'k1');
    expect(placementsOf(d)).toEqual({});
    expect(d.extras?.dimPlacement).toBeUndefined();
    expect(toFeature(d)).not.toHaveProperty('dimPlacement');
  });
  it('is dropped when its constraint is deleted, kept for others', () => {
    let d = setDimPlacement(setDimPlacement(draft(), 'k1', { level: 2, side: 1 }), 'k2', { level: 4, side: 1 });
    d = { ...d, constraints: d.constraints.filter((c) => c.id !== 'k1') };
    expect(placementsOf(pruneDimPlacement(d))).toEqual({ k2: { level: 4, side: 1 } });
    const keep = setDimPlacement(draft(), 'k1', { level: 2, side: 1 });
    expect(pruneDimPlacement(keep)).toBe(keep);
  });
  it('ignores malformed stored entries', () => {
    const d = { ...draft(), extras: { dimPlacement: { k1: { level: 'x', side: 1 }, k2: { level: 2, side: -1 } } } };
    expect(placementsOf(d)).toEqual({ k2: { level: 2, side: -1 } });
  });
  it('layout uses exactly the stored level and side, even where it overlaps', () => {
    const d = draft();
    const auto = layoutDimensions(d, annotate(d), { to, viewport: VP });
    expect(auto.find((p) => p.id === 'k1')!.level).toBe(1);
    const forced = layoutDimensions(d, annotate(d), { to, viewport: VP, placements: { k1: { level: 4, side: -1 } } });
    const k1 = forced.find((p) => p.id === 'k1')!;
    expect(k1.level).toBe(4); expect(k1.side).toBe(-1); expect(k1.hidden).toBe(false);
    expect(Math.abs(k1.label.y - 400)).toBeCloseTo(4 * LEVEL_PX, 0);
    const viaDraft = layoutDimensions(setDimPlacement(d, 'k1', { level: 4, side: -1 }), annotate(d), { to, viewport: VP });
    expect(viaDraft.find((p) => p.id === 'k1')!.label).toEqual(k1.label);
  });
  it('automatic dimensions avoid a placed one', () => {
    const d = draft();
    const free = layoutDimensions(d, annotate(d), { to, viewport: VP });
    const k2 = free.find((p) => p.id === 'k2')!;
    const pin = placementFromPointer(d, { type: 'distance', refs: ['a', 'b'], value: 40 }, { x: k2.label.x, y: k2.label.y }, { to })!;
    const moved = layoutDimensions(d, annotate(d), { to, viewport: VP, placements: { k1: pin } });
    expect(moved.find((p) => p.id === 'k1')!.level).toBe(pin.level);
    const m1 = moved.find((p) => p.id === 'k1')!, m2 = moved.find((p) => p.id === 'k2')!;
    const box = (p: typeof m1) => ({ x: p.label.x, y: p.label.y, hw: p.label.w / 2, hh: p.label.h / 2, a: (p.label.slopeDeg * Math.PI) / 180 });
    if (!m2.hidden) expect(obbOverlap(box(m1), box(m2))).toBe(false);
  });
  it('level and side from a pointer position', () => {
    const d = draft();
    const dim = { type: 'distance', refs: ['a', 'b'], value: 40 };
    const up = placementFromPointer(d, dim, { x: 300, y: 400 - 2 * LEVEL_PX + 3 }, { to })!;
    expect(up.level).toBe(2);
    const down = placementFromPointer(d, dim, { x: 300, y: 400 + 3 * LEVEL_PX - 4 }, { to })!;
    expect(down.level).toBe(3);
    expect(down.side).toBe(-up.side as 1 | -1);
    expect(placementFromPointer(d, dim, { x: 300, y: -500 }, { to })).toEqual({ level: 6, side: up.side });
    expect(placementFromPointer(d, dim, { x: 300, y: up.side === 1 ? 399 : 401 }, { to })!.level).toBe(1);
  });
});
