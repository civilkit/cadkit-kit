import { describe, expect, it } from 'vitest';
import { classify, diffMeasures, expectedOf, gate, totalsLine, type Cls, type ModelResult, type Measure } from './corpusOracle';

const m = (volume: number, com = [1, 2, 3], box = { min: [0, 0, 0], max: [2, 4, 6] }): Measure => ({ volume, area: 100, com, box, solids: 1, faces: 6 });
const res = (model: string, cls: Cls): ModelResult => ({ model, cls, problem: '', volDiff: null, targets: [{ name: 'Body', kind: 'body', cls, problem: '', volDiff: null }] });

describe('corpus oracle helpers', () => {
  it('classes by tolerance: relative 1e-5 / 1e-3 / 1e-2 on volume, mm on centre; a different solid count is a mismatch', () => {
    const want = m(1000);
    expect(classify(diffMeasures(m(1000 * (1 + 1e-7)), want))).toBe('EXACT');
    expect(classify(diffMeasures(m(1000 * (1 + 1e-4)), want))).toBe('CLOSE');
    expect(classify(diffMeasures(m(1000 * (1 + 5e-3)), want))).toBe('APPROX');
    expect(classify(diffMeasures(m(1000 * 1.05), want))).toBe('MISMATCH');
    expect(classify(diffMeasures(m(1000, [1.0005, 2, 3]), want))).toBe('CLOSE');
    expect(classify(diffMeasures({ ...m(1000), solids: 2 }, want))).toBe('MISMATCH');
  });
  it('the box counts one-sided: a tight box inside the loose one of FreeCAD is fine, one sticking out is not', () => {
    const want = m(1000);
    expect(classify(diffMeasures(m(1000, [1, 2, 3], { min: [0.5, 0, 0], max: [1.5, 4, 6] }), want))).toBe('EXACT');
    expect(classify(diffMeasures(m(1000, [1, 2, 3], { min: [0, 0, 0], max: [2.2, 4, 6] }), want))).toBe('MISMATCH');
  });
  it('the gate fails on a worse class, notes a better one, fails on a model missing from expected.json and on a must-be-good model that is not', () => {
    const exp = expectedOf([res('a', 'EXACT'), res('b', 'UNSUPPORTED'), res('c', 'CLOSE')], { mustBeGood: ['a', 'c'] });
    expect(gate([res('a', 'EXACT'), res('b', 'UNSUPPORTED'), res('c', 'CLOSE')], exp)).toEqual({ failures: [], improved: [], missing: [] });
    expect(gate([res('a', 'MISMATCH')], exp).failures.join()).toMatch(/a: MISMATCH is worse than expected EXACT/);
    expect(gate([res('b', 'CLOSE')], exp).improved.join()).toMatch(/b: UNSUPPORTED -> CLOSE/);
    expect(gate([res('d', 'EXACT')], exp).missing).toContain('d');
    expect(gate([res('c', 'APPROX')], expectedOf([res('c', 'APPROX')], { mustBeGood: ['c'] })).failures.join()).toMatch(/must be EXACT or CLOSE/);
    // an honest refusal ranks above a silently different shape
    expect(gate([res('b', 'MISMATCH')], exp).failures.join()).toMatch(/b: MISMATCH is worse than expected UNSUPPORTED/);
  });
  it('totals line', () => {
    expect(totalsLine('models', ['EXACT', 'EXACT', 'FAILED'])).toBe('models: 3 total, 2 EXACT, 0 CLOSE, 0 APPROX, 0 UNSUPPORTED, 0 MISMATCH, 1 FAILED');
  });
});
