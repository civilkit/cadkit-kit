import { describe, expect, it } from 'vitest';
import type { SketchDraft } from './index';
import { gridCapture, snapAt } from './snap';

const draft = (): SketchDraft => ({
  id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [], constraints: [],
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: 10, y: 0 }, { id: 'p2', x: 10, y: 8 }],
  entities: [{ id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }],
});

describe('snapAt', () => {
  it('lands on the nearest existing point', () => {
    expect(snapAt(draft(), { x: 10.2, y: 0.1 }, { tolerance: 0.5 })).toMatchObject({ kind: 'point', pointId: 'p1', at: { x: 10, y: 0 } });
  });
  it('prefers a point over a midpoint or alignment', () => {
    expect(snapAt(draft(), { x: 0.1, y: 0.1 }, { tolerance: 0.5 })?.kind).toBe('point');
  });
  it('lands on a line midpoint and names the line', () => {
    expect(snapAt(draft(), { x: 10.1, y: 4.1 }, { tolerance: 0.5 })).toMatchObject({ kind: 'midpoint', entityId: 'e1', at: { x: 10, y: 4 } });
  });
  it('an alignment keeps the other coordinate on the grid when the grid is on and near', () => {
    const at = snapAt(draft(), { x: 10.2, y: 20.04 }, { tolerance: 0.5, grid: 5 });
    expect(at).toEqual({ kind: 'align', at: { x: 10, y: 20 }, alignTo: { x: 'p1' } });
    expect(snapAt(draft(), { x: 10.2, y: 21.5 }, { tolerance: 0.5, grid: 5 })).toEqual({ kind: 'align', at: { x: 10, y: 21.5 }, alignTo: { x: 'p1' } });   // too far from a grid line: raw
    expect(snapAt(draft(), { x: 10.2, y: 20.04 }, { tolerance: 0.5, grid: 5, kinds: { grid: false } })).toEqual({ kind: 'align', at: { x: 10, y: 20.04 }, alignTo: { x: 'p1' } });
  });
  it('aligns with other points in x, y or both', () => {
    expect(snapAt(draft(), { x: 10.2, y: 20 }, { tolerance: 0.5 })).toEqual({ kind: 'align', at: { x: 10, y: 20 }, alignTo: { x: 'p1' } });
    expect(snapAt(draft(), { x: 30, y: 8.2 }, { tolerance: 0.5 })).toEqual({ kind: 'align', at: { x: 30, y: 8 }, alignTo: { y: 'p2' } });
    expect(snapAt(draft(), { x: 10.1, y: 0.2 }, { tolerance: 0.05 })).toBeUndefined();
  });
  it('returns nothing far from everything, and skips ignored points', () => {
    expect(snapAt(draft(), { x: 40, y: 40 }, { tolerance: 0.5 })).toBeUndefined();
    expect(snapAt(draft(), { x: 10, y: 0 }, { tolerance: 0.5, skip: new Set(['p1']), midpoints: false, align: false, kinds: { oncurve: false } })).toBeUndefined();
  });
  it('lands on the grid when nothing else snaps, and not when the pointer is between grid points', () => {
    expect(snapAt(draft(), { x: 24.9, y: 35.2 }, { tolerance: 0.5, grid: 5 })).toEqual({ kind: 'grid', at: { x: 25, y: 35 } });
    expect(snapAt(draft(), { x: 22.5, y: 37.5 }, { tolerance: 0.5, grid: 5 })).toBeUndefined();
  });
  it('a point beats the grid', () => {
    expect(snapAt(draft(), { x: 10.1, y: 0.1 }, { tolerance: 0.5, grid: 5 })?.kind).toBe('point');
  });
});

describe('snapAt: the richer kinds', () => {
  const rich = (): SketchDraft => ({
    id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [], constraints: [],
    points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 20, y: 0 }, { id: 'c', x: 10, y: -10 }, { id: 'd', x: 10, y: 10 }, { id: 'o', x: 30, y: 30 }, { id: 'q', x: 50, y: 0 }],
    entities: [
      { id: 'e1', type: 'line', p1: 'a', p2: 'b' }, { id: 'e2', type: 'line', p1: 'c', p2: 'd' },
      { id: 'e3', type: 'circle', c: 'o', r: 5 },
      { id: 'e4', type: 'arc', c: 'q', p1: 'b', p2: 'q' },   // degenerate on purpose: skipped by curveOf (zero radius not > 0 is fine)
    ],
  });
  it('names the role of a point: an end, a centre', () => {
    expect(snapAt(rich(), { x: 0.1, y: 0 }, { tolerance: 0.5 })).toMatchObject({ kind: 'point', role: 'endpoint' });
    expect(snapAt(rich(), { x: 30, y: 30.1 }, { tolerance: 0.5 })).toMatchObject({ kind: 'point', role: 'center', pointId: 'o' });
  });
  it('lands on the crossing of two lines and names both', () => {
    expect(snapAt(rich(), { x: 10.2, y: 0.1 }, { tolerance: 0.5 })).toMatchObject({ kind: 'intersection', at: { x: 10, y: 0 }, entityIds: ['e1', 'e2'] });
  });
  it('lands on a quadrant of a circle', () => {
    expect(snapAt(rich(), { x: 35.1, y: 30.1 }, { tolerance: 0.5 })).toMatchObject({ kind: 'quadrant', at: { x: 35, y: 30 }, entityId: 'e3' });
  });
  it('lands on the curve anywhere and names the entity (so clicking a line picks it)', () => {
    expect(snapAt(rich(), { x: 5, y: 0.2 }, { tolerance: 0.5, align: false })).toMatchObject({ kind: 'oncurve', entityId: 'e1', at: { x: 5, y: 0 } });
    expect(snapAt(rich(), { x: 33.5, y: 33.6 }, { tolerance: 0.5 })).toMatchObject({ kind: 'oncurve', entityId: 'e3' });
  });
  it('finds the perpendicular foot from the reference point, and the tangent point on a circle', () => {
    const d = rich();
    expect(snapAt(d, { x: 15.2, y: 0.1 }, { tolerance: 0.5, from: { x: 15, y: 8 }, align: false })).toMatchObject({ kind: 'perpendicular', entityId: 'e1', at: { x: 15, y: 0 } });
    const t = snapAt(d, { x: 33.5, y: 33.5 }, { tolerance: 3, from: { x: 30, y: 40 } });
    expect(t?.kind === 'tangent' || t?.kind === 'oncurve').toBe(true);
  });
  it('a kind that is switched off does not snap', () => {
    const d = rich();
    expect(snapAt(d, { x: 10.2, y: 0.1 }, { tolerance: 0.5, kinds: { intersection: false, oncurve: false, align: false, midpoint: false } })).toBeUndefined();
    expect(snapAt(d, { x: 0.1, y: 0 }, { tolerance: 0.5, kinds: { endpoint: false, oncurve: false, intersection: false, align: false } })).toBeUndefined();
  });

  describe('grid capture radius', () => {
    // a 20 px grid step with the 12 px pick radius: the pick radius reaches past the middle between grid points, so every position snapped
    const upp = 0.05, step = 1, pick = 12 * upp;
    const empty = (): SketchDraft => ({ id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [], constraints: [], points: [], entities: [] });
    const sweep = (opts: Parameters<typeof snapAt>[2]) => { let n = 0, total = 0; for (let x = 3; x < 4; x += 0.013) for (let y = 7; y < 8; y += 0.013) { total++; if (snapAt(empty(), { x, y }, opts)) n++; } return n / total; };
    it('with the pick radius as the grid radius the pointer is locked to the grid everywhere (the old behaviour)', () => {
      expect(sweep({ tolerance: pick, grid: step })).toBe(1);
    });
    it('with the capture radius it catches only near a grid point and is free between them', () => {
      const frac = sweep({ tolerance: pick, grid: step, gridTol: gridCapture(pick, step) });
      expect(frac).toBeGreaterThan(0);
      expect(frac).toBeLessThan(0.2);
      expect(snapAt(empty(), { x: 3.52, y: 7.4 }, { tolerance: pick, grid: step, gridTol: gridCapture(pick, step) })).toBeUndefined();
      expect(snapAt(empty(), { x: 3.03, y: 7.98 }, { tolerance: pick, grid: step, gridTol: gridCapture(pick, step) })).toEqual({ kind: 'grid', at: { x: 3, y: 8 } });
    });
    it('is a third of the pick radius, and a quarter of the step at most', () => {
      expect(gridCapture(12, 100)).toBeCloseTo(4.2);
      expect(gridCapture(12, 8)).toBe(2);
    });
    it('an alignment only rounds the other coordinate when it is within the grid radius', () => {
      const d = draft();
      expect(snapAt(d, { x: 10.1, y: 14.8 }, { tolerance: 0.5, grid: 5, gridTol: 0.1 })).toMatchObject({ kind: 'align', at: { x: 10, y: 14.8 } });
    });
  });
});
