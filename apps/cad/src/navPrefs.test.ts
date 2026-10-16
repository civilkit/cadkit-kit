import { describe, expect, it } from 'vitest';
import { DEFAULT_NAV_PREFS, loadNavPrefs, sanitizeNavPrefs, saveNavPrefs } from './navPrefs';

describe('navigation prefs', () => {
  it('defaults to Y up, turntable, orbit about the model centre', () => {
    expect(DEFAULT_NAV_PREFS).toEqual({ upAxis: 'y', orbitMode: 'turntable', orbitPivot: 'centre' });
    expect(sanitizeNavPrefs(null)).toEqual(DEFAULT_NAV_PREFS);
  });
  it('drops invalid values and keeps valid ones', () => {
    expect(sanitizeNavPrefs({ upAxis: 'x', orbitMode: 'trackball', orbitPivot: 'bogus' })).toEqual({ upAxis: 'y', orbitMode: 'trackball', orbitPivot: 'centre' });
  });
  it('round-trips through storage', () => {
    const m = new Map<string, string>();
    const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
    saveNavPrefs({ upAxis: 'z', orbitMode: 'trackball', orbitPivot: 'cursor' }, st);
    expect(loadNavPrefs(st)).toEqual({ upAxis: 'z', orbitMode: 'trackball', orbitPivot: 'cursor' });
  });
});
