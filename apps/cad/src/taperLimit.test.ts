import { describe, expect, it } from 'vitest';
import type { EditOp } from '@ck/session';
import { clampDepthOps, clampToTip, editsDraft, limitsOf, mayHaveTip, tipErrors } from './taperLimit';

describe('taper tip', () => {
  it('reads the limits list of a regen reply', () => {
    expect([...limitsOf([['F3', { maxHeight: 12.5 }], ['F4', {}], ['F5', { maxHeight: -1 }], 'x'])]).toEqual([['F3', 12.5]]);
    expect(limitsOf(undefined).size).toBe(0);
  });
  it('clamps a value past the tip and keeps the rest', () => {
    expect(clampToTip(20, 12.5)).toEqual({ value: 12.5, clamped: true, atTip: true });
    expect(clampToTip(12.5, 12.5)).toEqual({ value: 12.5, clamped: false, atTip: true });
    expect(clampToTip(5, 12.5)).toEqual({ value: 5, clamped: false, atTip: false });
    expect(clampToTip(1e9, undefined)).toEqual({ value: 1e9, clamped: false, atTip: false });
  });
  it('finds draftTooLarge only when it carries maxHeight (a polygon has none)', () => {
    expect(tipErrors([['F3', { code: 'draftTooLarge', params: { maxHeight: 7 } }], ['F4', { code: 'draftTooLarge', params: { detail: 'x' } }], ['F5', { code: 'other', params: { maxHeight: 3 } }]])).toEqual([{ feature: 'F3', maxHeight: 7 }]);
  });
  it('lowers a set depth past the limit and leaves other ops alone', () => {
    const ops = [{ op: 'set', id: 'F3', path: 'depth', value: 30 }, { op: 'set', id: 'F4', path: 'depth', value: 30 }, { op: 'set', id: 'F3', path: 'draft', value: 5 }] as EditOp[];
    const r = clampDepthOps(ops, (id) => (id === 'F3' ? 12.5 : undefined));
    expect(r.tips).toEqual([{ feature: 'F3', maxHeight: 12.5 }]);
    expect((r.ops[0] as { value: number }).value).toBe(12.5);
    expect(r.ops[1]).toBe(ops[1]);
    const rest = ops.slice(1);
    expect(clampDepthOps(rest, () => undefined).ops).toBe(rest);
  });
  it('knows a draft-angle edit and which documents can have a tip', () => {
    expect(editsDraft([{ op: 'set', id: 'F3', path: 'draft', value: 5 } as EditOp], 'F3')).toBe(true);
    expect(editsDraft([{ op: 'set', id: 'F3', path: 'depth', value: 5 } as EditOp], 'F3')).toBe(false);
    expect(mayHaveTip([{ type: 'extrude', draft: 10 }])).toBe(true);
    expect(mayHaveTip([{ type: 'extrude', draft: 0 }, { type: 'fillet' }])).toBe(false);
  });
});
