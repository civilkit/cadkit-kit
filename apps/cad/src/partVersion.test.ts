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

describe('legacy format name', () => {
  it('is recognised, and normalised in place', async () => {
    const { isPartFormat, normalizePartFormat } = await import('./partVersion');
    expect(isPartFormat('ck-part')).toBe(true);
    expect(isPartFormat('fw-part')).toBe(true);
    expect(isPartFormat('formwerk-part')).toBe(true);
    expect(isPartFormat('other')).toBe(false);
    for (const old of ['fw-part', 'formwerk-part']) {
      const d = { format: old };
      normalizePartFormat(d);
      expect(d.format).toBe('ck-part');
    }
  });
});
