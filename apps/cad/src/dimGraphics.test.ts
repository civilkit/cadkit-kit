import { describe, expect, it } from 'vitest';
import { linearShape, angleShape, leaderShape } from '@kit/sketch';
import { labelBox, projectShape } from './dimGraphics';
import { arrowPoints } from './SketchAnnotations';

// a plain view: x right, y down on screen, 2 px per unit
const to = (u: number, v: number) => ({ x: u * 2, y: -v * 2 });

describe('projectShape', () => {
  it('a length: extension lines and the dimension line in pixels, arrowheads along it, text on its middle', () => {
    const s = projectShape(linearShape({ x: 0, y: 0 }, { x: 10, y: 0 }, 5)!, to)!;
    expect(s.lines).toHaveLength(3);
    expect(s.main).toEqual([0, -10, 20, -10]);
    expect(s.text).toMatchObject({ x: 10, y: -10, slopeDeg: 0 });
    expect(s.arrows[1][2]).toBeCloseTo(1); expect(s.arrows[0][2]).toBeCloseTo(-1);
  });
  it('the text reads upright for a line running down-left', () => {
    const s = projectShape(linearShape({ x: 10, y: 10 }, { x: 0, y: 0 }, 2)!, to)!;
    expect(Math.abs(s.text.slopeDeg)).toBeLessThanOrEqual(90);
  });
  it('an angle becomes a polyline arc; a leader a line with arrowheads', () => {
    const a = projectShape(angleShape({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }, 4)!, to)!;
    expect(a.arc.length).toBeGreaterThan(5);
    expect(a.arc[0][0]).toBeCloseTo(8);
    const l = projectShape(leaderShape({ x: 0, y: 0 }, 10, true, 5)!, to)!;
    expect(l.arrows).toHaveLength(2);
  });
  it('gives up when a point cannot be projected', () => {
    expect(projectShape(linearShape({ x: 0, y: 0 }, { x: 10, y: 0 }, 5)!, () => null)).toBeNull();
  });
  it('arrowheads and label boxes', () => {
    expect(arrowPoints([10, 10, 1, 0]).split(' ')).toHaveLength(3);
    expect(labelBox('1 500 mm').w).toBeGreaterThan(labelBox('15 mm').w);
  });
});

describe('projectShape for a label outside a short dimension', () => {
  it('arrowheads turn inward, the line runs on past its ends and a leader joins the label', () => {
    const shape = linearShape({ x: 0, y: 0 }, { x: 2, y: 0 }, 5)!;
    const inner = projectShape(shape, to)!;
    const out = projectShape(shape, to, { outside: true, text: { x: 100, y: -10, slopeDeg: 0 } })!;
    expect(out.arrows[1][2]).toBeCloseTo(-inner.arrows[1][2]);
    expect(out.lines.length).toBe(inner.lines.length + 1);
    expect(out.main![2]).toBeGreaterThan(inner.main![2]);
    expect(out.text).toEqual({ x: 100, y: -10, slopeDeg: 0 });
  });
});
