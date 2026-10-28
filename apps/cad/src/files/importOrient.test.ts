import { describe, expect, it } from 'vitest';
import { DOMINANCE, flatAreas, seemsZUp } from './importOrient';

// An axis-aligned box as the viewport's non-indexed triangles (9 numbers per triangle), outward normals.
function box(x: number, y: number, z: number): { positions: Float32Array } {
  const q = (a: number[], b: number[], c: number[], d: number[]) => [...a, ...b, ...c, ...a, ...c, ...d];
  const p = (i: number, j: number, k: number) => [i * x, j * y, k * z];
  return { positions: Float32Array.from([
    ...q(p(0, 0, 0), p(0, 1, 0), p(1, 1, 0), p(1, 0, 0)),   // -Z
    ...q(p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)),   // +Z
    ...q(p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1)),   // -Y
    ...q(p(0, 1, 0), p(0, 1, 1), p(1, 1, 1), p(1, 1, 0)),   // +Y
    ...q(p(0, 0, 0), p(0, 0, 1), p(0, 1, 1), p(0, 1, 0)),   // -X
    ...q(p(1, 0, 0), p(1, 1, 0), p(1, 1, 1), p(1, 0, 1)),   // +X
  ]) };
}

describe('flatAreas', () => {
  it('sums the area of the faces turned down Z, down Y and up Y', () => {
    expect(flatAreas(box(10, 4, 2))).toEqual({ zDown: 40, yDown: 20, yUp: 20 });
  });
  it('counts a face tilted inside the tolerance, ignores one outside it', () => {
    const tri = (deg: number) => {   // a 50 mm2 triangle facing -Z, turned about Y
      const r = (deg * Math.PI) / 180;
      const pts = [[0, 0, 0], [0, 10, 0], [10, 0, 0]].flatMap(([x, y, z]) => [x * Math.cos(r) + z * Math.sin(r), y, -x * Math.sin(r) + z * Math.cos(r)]);
      return { positions: Float32Array.from(pts) };
    };
    expect(flatAreas(tri(0)).zDown).toBeCloseTo(50);
    expect(flatAreas(tri(8)).zDown).toBeCloseTo(50);
    expect(flatAreas(tri(12)).zDown).toBe(0);
  });
});

describe('seemsZUp', () => {
  it('a part standing on its Z bottom (wide in X and Y, low in Z) is Z up', () => {
    expect(seemsZUp(box(40, 20, 5))).toBe(true);
  });
  it('a part standing on its Y bottom (wide in X and Z, low in Y) is already right', () => {
    expect(seemsZUp(box(40, 5, 20))).toBe(false);
  });
  it('an ambiguous part is left alone: equal bottoms, or the Z bottom below the ratio', () => {
    expect(seemsZUp(box(10, 10, 10))).toBe(false);
    expect(seemsZUp(box(20, 14, 10))).toBe(false);   // 280 against 200: 1.4
    expect(seemsZUp(box(20, 15, 10))).toBe(true);    // 300 against 200: exactly the ratio
    expect(DOMINANCE).toBe(1.5);
  });
  it('nothing flat (or no mesh) is not offered', () => {
    expect(seemsZUp(null)).toBe(false);
    expect(seemsZUp({ positions: new Float32Array(0) })).toBe(false);
  });
});
