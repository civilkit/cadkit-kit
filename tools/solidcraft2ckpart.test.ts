import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs tool
import { arrangement, findCell, exprOf, mapPlane, scFrame } from './solidcraft2ckpart.mjs';

describe('solidcraft2ckpart helpers', () => {
  it('turns SolidCraft numeric fields into numbers or expressions', () => {
    expect(exprOf('5mm')).toBe(5);
    expect(exprOf('10 mm')).toBe(10);
    expect(exprOf('-TOFDownAngle')).toBe('=-TOFDownAngle');
  });
  it('keeps world geometry when a sketch plane is mapped to a std plane', () => {
    const sc = scFrame({ type: 'origin', name: 'YZ' });
    const mp = mapPlane(sc);
    const [u, v] = [3, 4];
    const world = [sc.o[0] + sc.x[0] * u + sc.y[0] * v, sc.o[1] + sc.x[1] * u + sc.y[1] * v, sc.o[2] + sc.x[2] * u + sc.y[2] * v];
    const [a, b] = mp.map(u, v);
    const f = mp.frame;
    const w2 = [0, 1, 2].map((k) => f.o[k] + f.x[k] * a + f.y[k] * b);
    expect(w2).toEqual(world);
  });
  it('finds the ring inside a circle and its island', () => {
    const arr = arrangement([{ id: 'c2', type: 'circle', c: [0, 0], r: 10 }, { id: 'c1', type: 'circle', c: [0, 0], r: 8 }]);
    const cell = findCell(arr, ['c2']);
    expect(cell?.holes.length).toBe(1);
  });
  it('merges a coincident collinear edge into one cell', () => {
    const arr = arrangement([
      { id: 'l2', type: 'line', a: [10, 0], b: [-10, 0] },
      { id: 'l5', type: 'line', a: [-1, 0], b: [1, 0] },
      { id: 'l6', type: 'line', a: [1, 0], b: [1, 5] },
      { id: 'l7', type: 'line', a: [1, 5], b: [-1, 5] },
      { id: 'l8', type: 'line', a: [-1, 5], b: [-1, 0] },
    ]);
    expect(findCell(arr, ['l2', 'l6', 'l7', 'l8'])).not.toBeNull();
  });
});
