import { describe, expect, it } from 'vitest';
import { isClosedSketch, isOpenSketch, loftOps, loftProfileIds } from './featureCreators';
import type { Ctx } from './featureCommands';

const pts = (n: number) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, x: Math.cos(i), y: Math.sin(i) }));
const spline = (id: string, type: 'spline' | 'cvspline', closed: boolean) => ({
  type: 'sketch', id, plane: { kind: 'std', id: 'top' }, points: pts(5),
  entities: [{ id: 's', type, pts: ['p0', 'p1', 'p2', 'p3', 'p4'], ...(closed ? { closed: true } : {}) }], constraints: [],
});
const circle = (id: string) => ({ type: 'sketch', id, points: [{ id: 'c', x: 0, y: 0 }], entities: [{ id: 'e', type: 'circle', c: 'c', r: 5 }], constraints: [] });
const ellipse = (id: string) => ({ type: 'sketch', id, points: [{ id: 'c', x: 0, y: 0 }], entities: [{ id: 'e', type: 'ellipse', c: 'c' }], constraints: [] });
const ctx = (features: unknown[], extra: Partial<Ctx> = {}): Ctx => ({ doc: { features } as never, selection: [], mode: 'body', box: null, edges: [], ...extra });

describe('closed splines are one closed profile', () => {
  it('closed spline and cvspline are closed, open ones are open chains', () => {
    for (const type of ['spline', 'cvspline'] as const) {
      expect(isClosedSketch(spline('a', type, true) as never)).toBe(true);
      expect(isOpenSketch(spline('a', type, true) as never)).toBe(false);
      expect(isClosedSketch(spline('b', type, false) as never)).toBe(false);
      expect(isOpenSketch(spline('b', type, false) as never)).toBe(true);
    }
  });
  it('Loft is available for a closed spline, a circle and an ellipse together', () => {
    const c = ctx([spline('A', 'spline', true), spline('B', 'cvspline', true), circle('C'), ellipse('D')]);
    expect(loftOps(c)).not.toBeNull();
    expect(loftProfileIds(c)).toEqual(['A', 'B', 'C', 'D']);
  });
  it('one closed spline alone is not enough, an open spline is not a loft profile', () => {
    expect(loftOps(ctx([spline('A', 'spline', true)]))).toBeNull();
    expect(loftOps(ctx([spline('A', 'spline', true), spline('B', 'spline', false)]))).toBeNull();
  });
});

describe('loft profile choice', () => {
  const four = [circle('A'), circle('B'), circle('C'), circle('D')];
  it('takes the sketches selected in the tree, in selection order', () => {
    expect(loftProfileIds(ctx(four, { selectedIds: ['C', 'A', 'B'] }))).toEqual(['C', 'A', 'B']);
  });
  it('with no selection takes every sketch since the last loft or extrude', () => {
    const doc = [circle('A'), { type: 'extrude', id: 'X', sketch: 'A' }, circle('B'), circle('C'), circle('D')];
    expect(loftProfileIds(ctx(doc))).toEqual(['B', 'C', 'D']);
  });
  it('falls back to the two newest unused when fewer than two came after the last body feature', () => {
    const doc = [circle('A'), circle('B'), { type: 'extrude', id: 'X', sketch: 'A' }, circle('C')];
    expect(loftProfileIds(ctx(doc))).toEqual(['B', 'C']);
  });
  it('a single selected sketch is ignored (the default list is used)', () => {
    expect(loftProfileIds(ctx(four, { selectedIds: ['B'] }))).toEqual(['A', 'B', 'C', 'D']);
  });
});
