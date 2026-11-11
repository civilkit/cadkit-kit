import { describe, expect, it } from 'vitest';
import { DEFAULT_WASHER, washerIssue, washerOpts, washerOps, type WasherParams } from './washer';

const P = (o: Partial<WasherParams> = {}): WasherParams => ({ ...DEFAULT_WASHER, ...o });
type Op = { op: string; feature: { id: string; type?: string; group?: string } };

describe('washer wizard rules', () => {
  it('the default record is valid and makes one sketch and one extrude', () => {
    expect(washerIssue(P())).toBeNull();
    const ops = washerOps({ features: [] }, P()) as unknown as Op[];
    expect(ops.length).toBe(2);
    expect(ops.map((o) => o.feature.type)).toEqual(['sketch', 'extrude']);
  });
  it('a spring washer is the same two features', () => {
    expect(washerIssue(P({ kind: 'spring' }))).toBeNull();
    expect((washerOps({ features: [] }, P({ kind: 'spring' })) as unknown[]).length).toBe(2);
  });
  it('maps the axis choice to a vector and gives the gap only to a spring', () => {
    expect(washerOpts(P({ axis: 'px' })).axis).toEqual([1, 0, 0]);
    expect(washerOpts(P())).not.toHaveProperty('gap');
    expect(washerOpts(P({ kind: 'spring', gap: 2 }))).toMatchObject({ kind: 'spring', gap: 2 });
  });
  it('reports bad numbers without the kernel', () => {
    expect(washerIssue(P({ inner: 0 }))?.code).toBe('inner');
    expect(washerIssue(P({ outer: 8 }))?.code).toBe('outer');
    expect(washerIssue(P({ thickness: 0 }))?.code).toBe('thickness');
    expect(washerIssue(P({ kind: 'spring', gap: 0 }))?.code).toBe('gap');
    expect(washerIssue(P({ kind: 'spring', gap: 9 }))?.code).toBe('gap');
    expect(washerIssue(P({ gap: 0 }))).toBeNull();   // a flat washer ignores the gap
  });
  it('numbers the new features from the next free id', () => {
    const ops = washerOps({ features: [{ id: 'F1' }, { id: 'F7' }] }, P()) as unknown as Op[];
    expect(ops[0].feature.id).toBe('F8');
    expect(ops[1].feature.id).toBe('F9');
  });
  it('puts every feature in one folder named Washer, and the next result in Washer 2', () => {
    const ops = washerOps({ features: [] }, P()) as unknown as Op[];
    expect(new Set(ops.map((o) => o.feature.group))).toEqual(new Set(['Washer']));
    const second = washerOps({ features: ops.map((o) => o.feature) }, P({ origin: [30, 0, 0] })) as unknown as Op[];
    expect(new Set(second.map((o) => o.feature.group))).toEqual(new Set(['Washer 2']));
    expect(second[0].feature.id).toBe('F3');
  });
});
