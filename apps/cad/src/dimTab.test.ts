import { describe, it, expect } from 'vitest';
import { dimTabOrder, nextDim } from './dimTab';

describe('dimension Tab chain', () => {
  const items = [{ id: 'c1', value: 60 }, { id: 'c2' }, { id: 'c3', value: 40 }, { id: 'c4', value: 30 }];
  it('only the dimensions that have a value, in creation order', () => expect(dimTabOrder(items)).toEqual(['c1', 'c3', 'c4']));
  it('Tab goes forward and wraps, Shift+Tab backward and wraps', () => {
    const o = dimTabOrder(items);
    expect(nextDim(o, 'c1', 1)).toBe('c3');
    expect(nextDim(o, 'c4', 1)).toBe('c1');
    expect(nextDim(o, 'c1', -1)).toBe('c4');
    expect(nextDim(o, 'c3', -1)).toBe('c1');
  });
  it('a lone dimension, or one that is gone, has nowhere to go', () => {
    expect(nextDim(['c1'], 'c1', 1)).toBeNull();
    expect(nextDim(['c1', 'c2'], 'zz', 1)).toBeNull();
  });
});
