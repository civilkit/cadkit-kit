import { describe, expect, it } from 'vitest';
import { constrainTypedPoint, newPointAt, parseTypedPoint, type SketchDraft } from './index';

const ev = (vars: Record<string, number> = {}) => (src: string): number | null => {
  const s = src.trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  // a tiny stand-in for the expression evaluator: names, and a name over a number
  const m = /^(-?)([a-z]+)(?:\/(\d+))?$/.exec(s);
  if (m && m[2] in vars) return (m[1] ? -1 : 1) * vars[m[2]] / (m[3] ? Number(m[3]) : 1);
  return null;
};
const base = (): SketchDraft => ({ id: 's', plane: {}, points: [{ id: 'O', x: 0, y: 0, fixed: true }], entities: [], constraints: [], temp: [] } as never);

describe('parseTypedPoint', () => {
  it('reads x,y, with spaces, and @x,y as the same thing (the origin is the reference)', () => {
    expect(parseTypedPoint('-30,0', ev())).toEqual({ x: -30, y: 0 });
    expect(parseTypedPoint(' 12.5 , -4 ', ev())).toEqual({ x: 12.5, y: -4 });
    expect(parseTypedPoint('@5,7', ev())).toEqual({ x: 5, y: 7 });
  });
  it('keeps the expression of a coordinate that is not a plain number', () => {
    expect(parseTypedPoint('w/2,0', ev({ w: 60 }))).toEqual({ x: 30, y: 0, xExpr: 'w/2' });
    expect(parseTypedPoint('0,-h', ev({ h: 8 }))).toEqual({ x: 0, y: -8, yExpr: '-h' });
  });
  it('splits at the top-level comma only', () => {
    const e = (s: string) => (s === 'min(2,3)' ? 2 : s === '4' ? 4 : null);
    expect(parseTypedPoint('min(2,3),4', e)).toEqual({ x: 2, y: 4, xExpr: 'min(2,3)' });
  });
  it('refuses anything that is not two values', () => {
    expect(parseTypedPoint('5', ev())).toBeNull();
    expect(parseTypedPoint('1,2,3', ev())).toBeNull();
    expect(parseTypedPoint('1,zz', ev())).toBeNull();
    expect(parseTypedPoint('', ev())).toBeNull();
  });
});

describe('constrainTypedPoint', () => {
  const with1 = (x: number, y: number): { d: SketchDraft; id: string } => ({ d: { ...base(), points: [...base().points, { id: 'p1', x, y }] } as SketchDraft, id: 'p1' });
  it('fixes x and y with hdist / vdist from the origin', () => {
    const { d, id } = with1(-30, 12);
    const r = constrainTypedPoint(d, id, { x: -30, y: 12 });
    expect(r.constraints.map((c) => [c.type, c.refs, c.value])).toEqual([['hdist', ['O', 'p1'], 30], ['vdist', ['O', 'p1'], 12]]);
  });
  it('uses an on-axis constraint instead of a zero dimension', () => {
    const { d, id } = with1(-30, 0);
    const r = constrainTypedPoint(d, id, { x: -30, y: 0 });
    expect(r.constraints.map((c) => [c.type, c.refs, c.value])).toEqual([['hdist', ['O', 'p1'], 30], ['horizontal', ['O', 'p1'], undefined]]);
    const r2 = constrainTypedPoint(with1(0, 9).d, 'p1', { x: 0, y: 9 });
    expect(r2.constraints.map((c) => c.type)).toEqual(['vertical', 'vdist']);
  });
  it('coincident with the origin when both are zero', () => {
    const { d, id } = with1(0, 0);
    expect(constrainTypedPoint(d, id, { x: 0, y: 0 }).constraints.map((c) => [c.type, c.refs])).toEqual([['coincident', ['p1', 'O']]]);
  });
  it('links the dimension to the typed expression; a negative coordinate keeps the sign in the expression', () => {
    const { d, id } = with1(-30, 0);
    const r = constrainTypedPoint(d, id, { x: -30, y: 0, xExpr: '-w/2' });
    expect(r.constraints[0]).toMatchObject({ type: 'hdist', value: 30, expr: '-(-w/2)' });
    const r2 = constrainTypedPoint(with1(30, 1).d, 'p1', { x: 30, y: 1, xExpr: 'w/2' });
    expect(r2.constraints[0]).toMatchObject({ value: 30, expr: 'w/2' });
  });
  it('does nothing without an origin, or for a fixed point', () => {
    const noO = { ...base(), points: [{ id: 'p1', x: 3, y: 3 }] } as SketchDraft;
    expect(constrainTypedPoint(noO, 'p1', { x: 3, y: 3 })).toBe(noO);
    const fx = { ...base(), points: [...base().points, { id: 'p1', x: 3, y: 3, fixed: true }] } as SketchDraft;
    expect(constrainTypedPoint(fx, 'p1', { x: 3, y: 3 })).toBe(fx);
  });
});

describe('newPointAt', () => {
  it('finds the point the tool just made at the typed place, not an old one', () => {
    const before = base();
    const after = { ...before, points: [...before.points, { id: 'p1', x: 5, y: 5 }, { id: 'p2', x: 9, y: 9 }] } as SketchDraft;
    expect(newPointAt(before, after, { x: 9, y: 9 })).toBe('p2');
    expect(newPointAt(before, after, { x: 0, y: 0 })).toBeUndefined();
    expect(newPointAt(after, after, { x: 9, y: 9 })).toBeUndefined();
  });
});
