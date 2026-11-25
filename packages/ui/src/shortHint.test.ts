import { describe, expect, it } from 'vitest';
import { shortHint } from './FeatureTree';

describe('shortHint', () => {
  it('cuts a long failure text to its first clause', () => {
    const full = 'F17: the blend was built but its result failed the containment check, so it was not used (the blend was built but its result fails the check: F17.B0 has the point outside the solid) — the result was not used. Try a smaller size';
    const s = shortHint(full);
    expect(s.length).toBeLessThanOrEqual(92);
    expect(s.endsWith('…')).toBe(true);
    expect(s.startsWith('F17: the blend was built')).toBe(true);
  });
  it('keeps a short text whole', () => {
    expect(shortHint('Select a face first')).toBe('Select a face first');
  });
});
