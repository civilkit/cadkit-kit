import { describe, expect, it } from 'vitest';
import { evaluate } from './index';

const xy = (sk: { pointList: Array<Record<string, unknown>> }) => sk.pointList.slice(1).map((p) => [p.x, p.y]);   // [0] is the sketch origin
const spline = (src: string) => {
  const r = evaluate(src);
  expect(r.errors).toEqual([]);
  const sk = r.state.parts[0].steps[0].sk!;
  return { sk, e: sk.entities[0] as { type: string; pts: string[]; closed?: boolean } };
};

describe('s.curve / s.polar (recording)', () => {
  it('curve samples count + 1 points for an open curve, ends included', () => {
    const { sk, e } = spline("part('P').sketch('front', (s) => s.curve((t) => [10 * t, 5 * t * t], { from: 0, to: 2, count: 4 }));");
    expect(e.type).toBe('spline'); expect(e.closed).toBeUndefined(); expect(e.pts).toHaveLength(5);
    expect(xy(sk)).toEqual([[0, 0], [5, 1.25], [10, 5], [15, 11.25], [20, 20]]);
  });
  it('a closed curve does not repeat the end point', () => {
    const { sk, e } = spline("part('P').sketch('front', (s) => s.curve((a) => [10 * Math.cos(a), 10 * Math.sin(a)], { from: 0, to: 2 * Math.PI, count: 8, closed: true }));");
    expect(e.closed).toBe(true); expect(e.pts).toHaveLength(8);
    const pts = xy(sk);
    expect(pts[0]).toEqual([10, 0]);
    expect(pts.some((p) => p[0] === 10 && p[1] === 0 && p !== pts[0])).toBe(false);
  });
  it('polar defaults to a closed full turn of 96 points around the origin or a centre', () => {
    const { sk, e } = spline("part('P').sketch('front', (s) => s.polar((a) => 20 + 2 * Math.cos(6 * a)));");
    expect(e.closed).toBe(true); expect(e.pts).toHaveLength(96);
    expect(xy(sk)[0][0]).toBe(22);
    const c = spline("part('P').sketch('front', (s) => s.polar(() => 5, { count: 4, center: [10, 0] }));");
    expect(xy(c.sk)).toEqual([[15, 0], [10, 5], [5, 0], [10, -5]]);
  });
  it('a sector is open; the pattern form of polar still works', () => {
    expect(spline("part('P').sketch('front', (s) => s.polar((a) => 10, { from: 0, to: Math.PI, count: 6 }));").e.closed).toBeUndefined();
    const r = evaluate("part('P').sketch('front', (s) => s.polar(4, (c) => c.circle(2, [10, 0])));");
    expect(r.errors).toEqual([]);
    expect(r.state.parts[0].steps[0].sk!.entities).toHaveLength(4);
  });
  it('bad input stops the run with the line and a readable message', () => {
    const bad = (src: string, re: RegExp) => { const r = evaluate(src); expect(r.errors[0]?.message).toMatch(re); expect(r.errors[0]?.line).toBe(1); };
    bad("part('P').sketch('front', (s) => s.curve(5));", /function t => \[x, y\]/);
    bad("part('P').sketch('front', (s) => s.curve((t) => [t, NaN]));", /finite numbers/);
    bad("part('P').sketch('front', (s) => s.curve((t) => [t, t], { count: 1 }));", /count/);
    bad("part('P').sketch('front', (s) => s.curve((t) => [t, t], { count: 5000 }));", /count/);
    bad("part('P').sketch('front', (s) => s.polar((a) => Infinity));", /finite radius/);
  });
  it('accepts t0 / t1 / n as short names for from / to / count (curve) and n for polar', () => {
    const a = spline("part('P').sketch('front', (s) => s.curve((t) => [t, t * t], { t0: 0, t1: 2, n: 4 }));");
    const b = spline("part('P').sketch('front', (s) => s.curve((t) => [t, t * t], { from: 0, to: 2, count: 4 }));");
    expect(xy(a.sk)).toEqual(xy(b.sk));
    expect(spline("part('P').sketch('front', (s) => s.polar((a) => 10, { n: 12 }));").e.pts).toHaveLength(12);
  });
});
