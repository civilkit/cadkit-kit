import { describe, expect, it } from 'vitest';
import { diagnose, isOpenChainSketch } from './errorSummary';
import { registerCatalog } from '@kit/i18n';
import { adviceOf, reasonOf } from './diagnosticsText';
import { diagStrings } from './strings';

registerCatalog('en', diagStrings);

const L = (id: string, p1: string, p2: string) => ({ id, type: 'line', p1, p2 });
describe('isOpenChainSketch', () => {
  it('is true for one line or one chain, whatever the order of the entities', () => {
    expect(isOpenChainSketch({ entities: [L('e1', 'a', 'b')] })).toBe(true);
    expect(isOpenChainSketch({ entities: [L('e2', 'b', 'c'), L('e1', 'a', 'b'), { id: 'e3', type: 'arc', c: 'o', p1: 'c', p2: 'd' }] })).toBe(true);
    expect(isOpenChainSketch({ entities: [L('e1', 'a', 'b'), { id: 'e2', type: 'circle', c: 'o', r: 3, construction: true }] })).toBe(true);   // construction geometry does not count
  });
  it('is false for a loop, a branch, two chains, a circle or nothing', () => {
    expect(isOpenChainSketch({ entities: [L('e1', 'a', 'b'), L('e2', 'b', 'c'), L('e3', 'c', 'a')] })).toBe(false);
    expect(isOpenChainSketch({ entities: [L('e1', 'a', 'b'), L('e2', 'b', 'c'), L('e3', 'b', 'd')] })).toBe(false);
    expect(isOpenChainSketch({ entities: [L('e1', 'a', 'b'), L('e2', 'c', 'd')] })).toBe(false);
    expect(isOpenChainSketch({ entities: [{ id: 'e1', type: 'circle', c: 'o', r: 3 }] })).toBe(false);
    expect(isOpenChainSketch({ entities: [] })).toBe(false);
    expect(isOpenChainSketch(undefined)).toBe(false);
  });
});

describe('noClosedProfile on one open line', () => {
  const features = [{ id: 'F1', type: 'sketch', entities: [L('e1', 'a', 'b')] }, { id: 'F2', type: 'extrude', sketch: 'F1' }];
  it('says to use Rib or Thin wall', () => {
    const d = diagnose([{ id: 'F2', code: 'noClosedProfile' }], features);
    expect(d.roots[0].openLine).toBe(true);
    expect(reasonOf(d.roots[0])).toContain('one open line');
    expect(adviceOf(d.roots[0])).toMatch(/Rib/);
    expect(adviceOf(d.roots[0])).toMatch(/Thin wall/);
  });
  it('keeps the general text for a sketch that is not one open line', () => {
    const d = diagnose([{ id: 'F2', code: 'noClosedProfile' }], [{ id: 'F1', type: 'sketch', entities: [L('e1', 'a', 'b'), L('e2', 'b', 'c'), L('e3', 'c', 'd')].concat([L('e4', 'x', 'y')]) }, features[1]]);
    expect(d.roots[0].openLine).toBeUndefined();
    expect(adviceOf(d.roots[0])).toBe('The sketch is not a closed outline. Close the gaps, then try again.');
  });
});
