import { describe, expect, it } from 'vitest';
import { PART_VERSION, isNewerPart } from './partVersion';

describe('isNewerPart', () => {
  it('is false for this version, older ones and files without a version', () => {
    expect(isNewerPart({ version: PART_VERSION })).toBe(false);
    expect(isNewerPart({ version: 0 })).toBe(false);
    expect(isNewerPart({})).toBe(false);
    expect(isNewerPart({ version: '9' })).toBe(false);
  });
  it('is true for a higher version', () => {
    expect(isNewerPart({ version: PART_VERSION + 1 })).toBe(true);
  });
});
