import { describe, expect, it } from 'vitest';
import { addedSummary } from './fullyDefineMsg';

describe('addedSummary', () => {
  it('names what was added, singular or plural, and leaves out a kind that added none', () => {
    expect(addedSummary(3, 1)).toBe('3 relations and 1 dimension');
    expect(addedSummary(1, 2)).toBe('1 relation and 2 dimensions');
    expect(addedSummary(4, 0)).toBe('4 relations');
    expect(addedSummary(0, 1)).toBe('1 dimension');
  });
});
