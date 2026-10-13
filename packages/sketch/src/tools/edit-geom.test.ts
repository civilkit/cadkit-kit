import { describe, expect, it } from 'vitest';
import { arcArc, circleArc, circleCircle, cornerGeometry, intersect, lineArc, lineCircle, lineLine, reflect, type ArcG } from './edit-geom';

const close = (p: { x: number; y: number }, x: number, y: number) => { expect(p.x).toBeCloseTo(x, 7); expect(p.y).toBeCloseTo(y, 7); };
const arc = (cx: number, cy: number, r: number, a0: number, a1: number): ArcG => {
  const d = Math.PI / 180;
  return { kind: 'arc', c: { x: cx, y: cy }, r, p1: { x: cx + r * Math.cos(a0 * d), y: cy + r * Math.sin(a0 * d) }, p2: { x: cx + r * Math.cos(a1 * d), y: cy + r * Math.sin(a1 * d) } };
};

describe('line-line', () => {
  it('crossing segments meet at one point', () => { const r = lineLine({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }); expect(r).toHaveLength(1); close(r[0], 5, 5); });
  it('segments that would meet only when extended do not intersect', () => { expect(lineLine({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 5, y: -1 }, { x: 5, y: 1 })).toEqual([]); });
  it('touching at an end counts (T and L junctions)', () => { expect(lineLine({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 })).toHaveLength(1); });
  it('parallel and collinear give none', () => {
    expect(lineLine({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 1 }, { x: 10, y: 1 })).toEqual([]);
    expect(lineLine({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, { x: 15, y: 0 })).toEqual([]);
  });
  it('near-parallel (1e-12 rad) segments give none instead of a wild point; a real shallow angle still intersects', () => {
    expect(lineLine({ x: 0, y: 0 }, { x: 1e6, y: 0 }, { x: 0, y: 1 }, { x: 1e6, y: 1 + 1e-6 })).toEqual([]);
    const r = lineLine({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 1 }, { x: 100, y: -1 });
    expect(r).toHaveLength(1); close(r[0], 50, 0);
  });
});

describe('line-circle', () => {
  const c = { x: 0, y: 0 };
  it('a chord gives two points', () => { const r = lineCircle({ x: -10, y: 3 }, { x: 10, y: 3 }, c, 5); expect(r).toHaveLength(2); close(r[0], -4, 3); close(r[1], 4, 3); });
  it('a tangent touch gives exactly one point', () => { const r = lineCircle({ x: -10, y: 5 }, { x: 10, y: 5 }, c, 5); expect(r).toHaveLength(1); close(r[0], 0, 5); });
  it('a line just outside misses', () => { expect(lineCircle({ x: -10, y: 5.001 }, { x: 10, y: 5.001 }, c, 5)).toEqual([]); });
  it('the segment ends before the circle: no hit; one end inside: one hit', () => {
    expect(lineCircle({ x: 6, y: 0 }, { x: 10, y: 0 }, c, 5)).toEqual([]);
    const r = lineCircle({ x: 0, y: 0 }, { x: 10, y: 0 }, c, 5); expect(r).toHaveLength(1); close(r[0], 5, 0);
  });
});

describe('circle-circle and arcs', () => {
  it('two crossing circles give two points', () => { const r = circleCircle({ x: 0, y: 0 }, 5, { x: 6, y: 0 }, 5); expect(r).toHaveLength(2); close(r[0], 3, 4); close(r[1], 3, -4); });
  it('externally tangent circles give one point', () => { const r = circleCircle({ x: 0, y: 0 }, 5, { x: 8, y: 0 }, 3); expect(r).toHaveLength(1); close(r[0], 5, 0); });
  it('internally tangent circles give one point', () => { const r = circleCircle({ x: 0, y: 0 }, 5, { x: 2, y: 0 }, 3); expect(r).toHaveLength(1); close(r[0], 5, 0); });
  it('nested, separate and concentric give none', () => {
    expect(circleCircle({ x: 0, y: 0 }, 5, { x: 1, y: 0 }, 1)).toEqual([]);
    expect(circleCircle({ x: 0, y: 0 }, 1, { x: 10, y: 0 }, 1)).toEqual([]);
    expect(circleCircle({ x: 0, y: 0 }, 5, { x: 0, y: 0 }, 3)).toEqual([]);
  });
  it('a line meets only the part of a circle that the arc covers (counter-clockwise p1 -> p2)', () => {
    const upper = arc(0, 0, 5, 0, 180);
    const r = lineArc({ x: -10, y: 3 }, { x: 10, y: 3 }, upper); expect(r).toHaveLength(2);
    expect(lineArc({ x: -10, y: -3 }, { x: 10, y: -3 }, upper)).toEqual([]);
    const lower = arc(0, 0, 5, 180, 360);
    expect(lineArc({ x: -10, y: 3 }, { x: 10, y: 3 }, lower)).toEqual([]);
    expect(lineArc({ x: -10, y: -3 }, { x: 10, y: -3 }, lower)).toHaveLength(2);
  });
  it('an arc that wraps through angle zero is handled', () => {
    const a = arc(0, 0, 5, 300, 60);
    expect(lineArc({ x: 0, y: 0 }, { x: 10, y: 0 }, a)).toHaveLength(1);
    expect(lineArc({ x: -10, y: 0 }, { x: 0, y: 0 }, a)).toEqual([]);
  });
  it('arc-arc and circle-arc keep only points on both arcs', () => {
    const a = arc(0, 0, 5, 0, 180), b = arc(6, 0, 5, 90, 270);
    const r = arcArc(a, b); expect(r).toHaveLength(1); close(r[0], 3, 4);
    expect(circleArc({ x: 6, y: 0 }, 5, a)).toHaveLength(1);
    expect(intersect(a, { kind: 'circle', c: { x: 6, y: 0 }, r: 5 })).toHaveLength(1);
  });
  it('arc end touching the other curve counts (inclusive within tolerance)', () => {
    const a = arc(0, 0, 5, 0, 90);
    expect(lineArc({ x: 5, y: -5 }, { x: 5, y: 5 }, a)).toHaveLength(1);
  });
});

describe('corners and reflection', () => {
  it('a 90 degree fillet of r=4 touches both lines 4 from the corner with the centre at (4,4)', () => {
    const g = cornerGeometry({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }, 'fillet', 4);
    expect(typeof g).toBe('object');
    if (typeof g === 'string') return;
    close(g.t1, 4, 0); close(g.t2, 0, 4); close(g.c!, 4, 4);
  });
  it('refusals: parallel, too large, degenerate', () => {
    expect(cornerGeometry({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: -10, y: 0 }, 'fillet', 2)).toBe('parallel');
    expect(cornerGeometry({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }, 'fillet', 10.5)).toBe('tooLarge');
    expect(cornerGeometry({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 3 }, 'chamfer', 3)).toBe('tooLarge');
    expect(cornerGeometry({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 3 }, 'chamfer', 0)).toBe('degenerate');
  });
  it('an acute corner needs a longer reach than the radius', () => {
    const g = cornerGeometry({ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, 'fillet', 2);
    if (typeof g === 'string') throw new Error(g);
    expect(Math.hypot(g.t1.x, g.t1.y)).toBeCloseTo(2 / Math.tan(Math.PI / 8), 9);
  });
  it('reflect over an inclined line', () => { close(reflect({ x: 2, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }), 0, 2); });
});
