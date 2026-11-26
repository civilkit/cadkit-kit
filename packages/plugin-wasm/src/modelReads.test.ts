import { describe, expect, it } from 'vitest';
import { edgeInfo, faceInfo } from './modelReads';

/** A cylinder wall of radius r and height h about the z axis, in `n` facets, each split into two triangles; `wobble` tilts the lower vertices a little the way a real tessellation does. */
function wall(r: number, h: number, n: number, wobble = 0): number[] {
  const t: number[] = [];
  const P = (k: number, z: number) => [r * Math.cos((k / n) * 2 * Math.PI), r * Math.sin((k / n) * 2 * Math.PI), z];
  for (let k = 0; k < n; k++) {
    const a = P(k, 0), b = P(k + 1, 0), c = P(k + 1, h), d = P(k, h + wobble * (k % 2));
    t.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  return t;
}

describe('faceInfo', () => {
  it('recognises a cylinder, and gives the true area (radius x angle x height), not the polygon\'s', () => {
    const tris = wall(2, 8, 48);
    const f = faceInfo(tris, tris.length / 9)!;
    expect(f.exact).toBe(true);
    expect(f.cylinder!.radius).toBeCloseTo(2, 3);
    expect(Math.abs(f.cylinder!.axis[2])).toBeCloseTo(1, 3);
    expect(f.area).toBeCloseTo(2 * Math.PI * 2 * 8, 2);
    expect(f.area_mm2).toBe(f.area);
  });
  it('still recognises it when the facets tilt a tenth of a degree, as a real tessellation does', () => {
    const tris = wall(2, 8, 48, 0.012);
    const f = faceInfo(tris, tris.length / 9)!;
    expect(f.exact).toBe(true);
    expect(f.cylinder).toBeTruthy();
  });
  it('a plane stays a plane', () => {
    const tris = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    expect(faceInfo(tris, 1)).toMatchObject({ exact: true, plane_normal: [0, 0, 1] });
  });
});

describe('edgeInfo', () => {
  it('a circle carries mid and circle { center, diameter } besides point, centre and radius', () => {
    const pts = Array.from({ length: 33 }, (_, k) => [20 + 3 * Math.cos((k / 32) * 2 * Math.PI), 15 + 3 * Math.sin((k / 32) * 2 * Math.PI), 8]);
    const e = edgeInfo(pts)!;
    expect(e.curve).toBe('circle');
    expect(e.mid).toEqual(e.point);
    expect(e.circle).toEqual({ center: [20, 15, 8], diameter: 6 });
  });
});
