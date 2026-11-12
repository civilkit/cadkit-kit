import { describe, expect, it } from 'vitest';
import { filesEn } from './strings';
import { importTimingsLine } from './importTimings';

const t = (key: string, p: Record<string, string | number> = {}) => (filesEn as Record<string, string>)[key].replace(/\{(\w+)\}/g, (_, k) => String(p[k]));

describe('importTimingsLine', () => {
  it('names each phase, the question count and the total', () => {
    const line = importTimingsLine(t, 'a.solidcraft', [{ phase: 'read', ms: 400 }, { phase: 'kernel', ms: 2500, count: 310 }, { phase: 'map', ms: 300 }], 3200, 0);
    expect(line).toBe('Imported a.solidcraft in 3.2 s: read 0.4, kernel 2.5 (310 questions), mapping 0.3, rebuild 0.0.');
  });
  it('adds the kernel rebuild to the total', () => {
    expect(importTimingsLine(t, 'p', [{ phase: 'read', ms: 100 }, { phase: 'kernel', ms: 0, count: 0 }, { phase: 'map', ms: 100 }], 200, 1800)).toContain('in 2.0 s');
  });
  it('falls back to the read/rebuild split without phases', () => {
    expect(importTimingsLine(t, 'p', undefined, 1500, 2500)).toBe('Import of p: read in 1.5 s, rebuilt in 2.5 s.');
  });
});
