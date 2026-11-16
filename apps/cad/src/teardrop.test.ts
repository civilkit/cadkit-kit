import { describe, expect, it } from 'vitest';
import { planTeardrop, teardropArea, teardropScript } from './teardrop';

const hole = { mouth: [0, 10, 0] as [number, number, number], out: [0, 1, 0] as [number, number, number], diameter: 8, thickness: 10, through: true };

describe('planTeardrop', () => {
  it('points the peak toward the print-up direction, projected onto the hole\'s plane', () => {
    const r = planTeardrop(hole, { toward: [1, 5, 0] });   // the part of "up" along the hole is dropped
    expect(r.ok && r.plan.xdir).toEqual([1, 0, 0]);
    expect(r.ok && r.plan.normal).toEqual([0, 1, 0]);
    expect(r.ok && r.plan.origin).toEqual([0, 10, 0]);
  });
  it('turns the peak about the axis by the rotation, counter-clockwise seen from the mouth (right-hand rule about the way out)', () => {
    const r = planTeardrop(hole, { toward: [1, 0, 0], rotate: 90 });
    expect(r.ok && r.plan.xdir.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 0, -1]);
  });
  it('makes the usual 90 degree peak: tangent points at 45 degrees and the tip r times root two out', () => {
    const r = planTeardrop(hole, { toward: [1, 0, 0] });
    if (!r.ok) throw new Error('refused');
    const [c, t1, tip, t2] = r.plan.polygon;
    expect(c).toEqual([0, 0]);
    expect(t1[0]).toBeCloseTo(4 * Math.SQRT1_2, 5); expect(t1[1]).toBeCloseTo(4 * Math.SQRT1_2, 5);
    expect(tip[0]).toBeCloseTo(4 * Math.SQRT2, 5); expect(tip[1]).toBeCloseTo(0, 9);
    expect(t2[1]).toBeCloseTo(-t1[1], 9);
    expect(r.plan.reach).toBeCloseTo(4 * Math.SQRT2, 5);
  });
  it('a flat top replaces the tip by two points at the flat\'s distance, on the same sides', () => {
    const r = planTeardrop(hole, { toward: [1, 0, 0], flat: true });   // default: at the radius
    if (!r.ok) throw new Error('refused');
    expect(r.plan.polygon.length).toBe(5);
    const [, t1, p1, p2] = r.plan.polygon;
    expect(p1[0]).toBeCloseTo(4, 5); expect(p2[0]).toBeCloseTo(4, 5);
    expect(p1[1]).toBeCloseTo(-p2[1], 9);
    // the side from the tangent point to the flat keeps the 45 degree slope
    expect((p1[1] - t1[1]) / (p1[0] - t1[0])).toBeCloseTo(-1, 5);
    expect(r.plan.reach).toBeCloseTo(4, 5);
  });
  it('refuses a print-up direction along the hole, a bad angle, a flat out of range and a zero diameter', () => {
    expect(planTeardrop(hole, { toward: [0, 1, 0] })).toEqual({ ok: false, issue: 'parallel' });
    expect(planTeardrop(hole, { toward: [1, 0, 0], halfAngle: 10 })).toEqual({ ok: false, issue: 'halfAngle' });
    expect(planTeardrop(hole, { toward: [1, 0, 0], halfAngle: 70 })).toEqual({ ok: false, issue: 'halfAngle' });
    expect(planTeardrop(hole, { toward: [1, 0, 0], flat: true, flatAt: 1 })).toEqual({ ok: false, issue: 'flatAt' });
    expect(planTeardrop(hole, { toward: [1, 0, 0], flat: true, flatAt: 9 })).toEqual({ ok: false, issue: 'flatAt' });
    expect(planTeardrop({ ...hole, diameter: 0 }, { toward: [1, 0, 0] })).toEqual({ ok: false, issue: 'diameter' });
  });
  it('is as deep as a blind hole, or through', () => {
    const blind = planTeardrop({ ...hole, through: false, thickness: 6 }, { toward: [1, 0, 0] });
    expect(blind.ok && blind.plan.depth).toBe(6);
    const thru = planTeardrop(hole, { toward: [1, 0, 0] });
    expect(thru.ok && thru.plan.depth).toBe('through');
  });
});

describe('teardropScript and teardropArea', () => {
  it('writes a sketch on a plane at the mouth, cut as deep as the hole', () => {
    const r = planTeardrop({ ...hole, through: false, thickness: 6 }, { toward: [1, 0, 0] });
    if (!r.ok) throw new Error('refused');
    const s = teardropScript(r.plan, 'Teardrop');
    expect(s).toContain('at({ origin: [0, 10, 0], normal: [0, 1, 0], xdir: [1, 0, 0] })');
    expect(s).toContain('s.polygon(');
    expect(s).toContain('.cut(6)');
    expect(teardropScript({ ...r.plan, depth: 'through' })).toContain('.cut(through())');
  });
  it('the 45 degree teardrop is the circle plus r squared times (1 - pi/4)', () => {
    const r = 4;
    expect(teardropArea(8)).toBeCloseTo(Math.PI * r * r + r * r * (1 - Math.PI / 4), 9);
  });
  it('a flat top has less area than the sharp tip and more than the circle', () => {
    expect(teardropArea(8, 45, true)).toBeLessThan(teardropArea(8));
    expect(teardropArea(8, 45, true)).toBeGreaterThan(Math.PI * 16);
  });
  it('one script for several holes: one part line, one sketch and cut each', () => {
    const a = planTeardrop(hole, { toward: [1, 0, 0] }), b = planTeardrop({ ...hole, mouth: [10, 10, 0] }, { toward: [1, 0, 0] });
    if (!a.ok || !b.ok) throw new Error('refused');
    const s = teardropScript([a.plan, b.plan], 'Teardrop');
    expect(s.match(/part\(/g)?.length).toBe(1);
    expect(s.match(/\.cut\(/g)?.length).toBe(2);
    expect(s).toContain('origin: [10, 10, 0]');
  });
});
