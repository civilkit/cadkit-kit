import { describe, expect, it } from 'vitest';
import type { SketchDraft } from './index';
import { snapAt } from './snap';

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
  it('aligns with other points in x, y or both', () => {
    expect(snapAt(draft(), { x: 10.2, y: 20 }, { tolerance: 0.5 })).toEqual({ kind: 'align', at: { x: 10, y: 20 }, alignTo: { x: 'p1' } });
    expect(snapAt(draft(), { x: 30, y: 8.2 }, { tolerance: 0.5 })).toEqual({ kind: 'align', at: { x: 30, y: 8 }, alignTo: { y: 'p2' } });
    expect(snapAt(draft(), { x: 10.1, y: 0.2 }, { tolerance: 0.05 })).toBeUndefined();
  });
  it('returns nothing far from everything, and skips ignored points', () => {
    expect(snapAt(draft(), { x: 40, y: 40 }, { tolerance: 0.5 })).toBeUndefined();
    expect(snapAt(draft(), { x: 10, y: 0 }, { tolerance: 0.5, skip: new Set(['p1']), midpoints: false, align: false })).toBeUndefined();
  });
  it('lands on the grid when nothing else snaps, and not when the pointer is between grid points', () => {
    expect(snapAt(draft(), { x: 24.9, y: 35.2 }, { tolerance: 0.5, grid: 5 })).toEqual({ kind: 'grid', at: { x: 25, y: 35 } });
    expect(snapAt(draft(), { x: 22.5, y: 37.5 }, { tolerance: 0.5, grid: 5 })).toBeUndefined();
  });
  it('a point beats the grid', () => {
    expect(snapAt(draft(), { x: 10.1, y: 0.1 }, { tolerance: 0.5, grid: 5 })?.kind).toBe('point');
  });
});
