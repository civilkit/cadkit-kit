import { describe, expect, it } from 'vitest';
import { combSegments, curvatureColors, diverging, draftAngle, draftColors, gaussianOf, meanOf, percentileAbs, sanitizeAnalysis, vertexCurvatures } from './analysis';

/** A triangle soup of a sphere patch (radius r) with exact outward normals. */
function spherePatch(r: number, n = 8): { positions: number[]; normals: number[] } {
  const positions: number[] = [], normals: number[] = [];
  const pt = (i: number, j: number) => {
    const th = 0.3 + (i / n) * 0.8, ph = 0.2 + (j / n) * 0.8;
    return [r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th)];
  };
  const push = (p: number[]) => { positions.push(...p); normals.push(p[0] / r, p[1] / r, p[2] / r); };
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1);
    [a, b, c, a, c, d].forEach(push);
  }
  return { positions, normals };
}
function cylinderPatch(r: number, n = 12): { positions: number[]; normals: number[] } {
  const positions: number[] = [], normals: number[] = [];
  const pt = (i: number, j: number): [number[], number[]] => { const a = (i / n) * 1.2; return [[r * Math.cos(a), r * Math.sin(a), j * 3], [Math.cos(a), Math.sin(a), 0]]; };
  const push = (q: [number[], number[]]) => { positions.push(...q[0]); normals.push(...q[1]); };
  for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) {
    const a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1);
    [a, b, c, a, c, d].forEach(push);
  }
  return { positions, normals };
}
const ranges = (nv: number) => [{ name: 'F', start: 0, count: nv }];

describe('curvature from vertex normals', () => {
  it('a sphere of radius 10 has both principal curvatures 0.1', () => {
    const s = spherePatch(10);
    const { k1, k2 } = vertexCurvatures(s.positions, s.normals, ranges(s.positions.length / 3));
    for (const v of [5, 100, 200, k1.length - 4]) { expect(k1[v]).toBeCloseTo(0.1, 2); expect(k2[v]).toBeCloseTo(0.1, 2); }
    expect(meanOf(k1, k2)[100]).toBeCloseTo(0.1, 2);
    expect(gaussianOf(k1, k2)[100]).toBeCloseTo(0.01, 3);
  });
  it('a cylinder of radius 5 has one curvature 0.2 and one 0, so Gaussian curvature is zero', () => {
    const c = cylinderPatch(5);
    const { k1, k2 } = vertexCurvatures(c.positions, c.normals, ranges(c.positions.length / 3));
    expect(k1[50]).toBeCloseTo(0.2, 2);
    expect(Math.abs(k2[50])).toBeLessThan(0.01);
    expect(Math.abs(gaussianOf(k1, k2)[50])).toBeLessThan(0.003);
  });
  it('a flat triangle has zero curvature, a degenerate one does not break', () => {
    const p = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], n = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
    const { k1, k2 } = vertexCurvatures(p, n, ranges(6));
    expect([k1[0], k2[0]]).toEqual([0, 0]);
    expect(Number.isFinite(k1[4])).toBe(true);
  });
  it('colour scale: zero is white, the ends are blue and red, the range ignores a few spikes', () => {
    expect(diverging(0)).toEqual([1, 1, 1]);
    expect(diverging(1)[0]).toBeGreaterThan(diverging(1)[2]);
    expect(diverging(-1)[2]).toBeGreaterThan(diverging(-1)[0]);
    const v = [...Array(99).fill(0.1), 50];
    expect(percentileAbs(v, 0.95)).toBeCloseTo(0.1);
    const { colors, legend } = curvatureColors([0, 0.1, -0.1], 'mean');
    expect(Array.from(colors.slice(0, 3))).toEqual([1, 1, 1]);
    expect(legend).toMatchObject({ min: -0.1, max: 0.1, unit: '1/mm' });
  });
});

describe('draft analysis', () => {
  it('the angle of a face to the pull: vertical wall 0, tilted 10, top 90', () => {
    expect(draftAngle([1, 0, 0], 0, [0, 0, 1])).toBeCloseTo(0);
    expect(draftAngle([Math.cos(0.1745), 0, Math.sin(0.1745)], 0, [0, 0, 1])).toBeCloseTo(10, 1);
    expect(draftAngle([0, 0, 1], 0, [0, 0, 1])).toBeCloseTo(90);
    expect(draftAngle([0, 0, -1], 0, [0, 0, 1])).toBeCloseTo(-90);
  });
  it('colours: enough draft green, none red, the other half blue', () => {
    const n = [0, 0, 1, 1, 0, 0, 0, 0, -1, Math.cos(0.1), 0, Math.sin(0.1)];
    const { colors, legend } = draftColors(n, [0, 0, 2], 1);
    const c = (i: number) => Array.from(colors.slice(i * 3, i * 3 + 3));
    expect(c(0)[1]).toBeGreaterThan(0.6);   // top: green
    expect(c(1)[0]).toBeGreaterThan(0.8);   // vertical: red
    expect(c(2)[2]).toBeGreaterThan(0.8);   // bottom: blue
    expect(c(3)[1]).toBeGreaterThan(0.6);   // 5.7 degrees: green
    expect(legend.bands).toHaveLength(3);
  });
});

describe('curvature comb', () => {
  const circle = Array.from({ length: 41 }, (_, i) => [10 * Math.cos((i / 40) * Math.PI * 2), 10 * Math.sin((i / 40) * Math.PI * 2), 0]);
  it('a circle gets a tooth at every vertex pointing outward, all the same length', () => {
    const { segments, maxCurvature } = combSegments([circle], 20);
    expect(maxCurvature).toBeCloseTo(0.1, 2);
    const teeth = [];
    for (let i = 0; i < segments.length; i += 6) if (Math.abs(Math.hypot(segments[i], segments[i + 1]) - 10) < 1e-6) teeth.push(Math.hypot(segments[i + 3] - segments[i], segments[i + 4] - segments[i + 1]));
    expect(teeth.length).toBeGreaterThan(30);
    expect(Math.min(...teeth)).toBeGreaterThan(0.12 * 20 * 0.9);
    // the first tooth starts on the circle and ends farther from the centre
    expect(Math.hypot(segments[3], segments[4])).toBeGreaterThan(Math.hypot(segments[0], segments[1]));
  });
  it('a straight line draws nothing; the scale factor scales the teeth', () => {
    expect(combSegments([[[0, 0, 0], [5, 0, 0], [10, 0, 0]]], 10).segments.length).toBe(0);
    const a = combSegments([circle], 20, 1).segments, b = combSegments([circle], 20, 2).segments;
    expect(Math.hypot(b[3] - b[0], b[4] - b[1])).toBeCloseTo(2 * Math.hypot(a[3] - a[0], a[4] - a[1]), 3);
  });
});

describe('sanitizeAnalysis', () => {
  it('drops what is not valid', () => {
    expect(sanitizeAnalysis({ mode: 'bogus', pull: [0, 0, 0], combScale: 'x', draftMin: 500 })).toMatchObject({ mode: 'off', pull: [0, 0, 1], combScale: 1, draftMin: 45 });
    expect(sanitizeAnalysis({ mode: 'zebra', comb: true, pull: [1, 0, 0] })).toMatchObject({ mode: 'zebra', comb: true, pull: [1, 0, 0] });
  });
});
