import { describe, expect, it } from 'vitest';
import { DEFAULT_NAV_PREFS, loadNavPrefs, sanitizeNavPrefs, saveNavPrefs } from './navPrefs';

describe('navigation prefs', () => {
  it('defaults to Y up, turntable, orbit about the model centre', () => {
    expect(DEFAULT_NAV_PREFS).toEqual({ upAxis: 'y', orbitMode: 'turntable', orbitPivot: 'centre', zoomSpeed: 1 });
    expect(sanitizeNavPrefs(null)).toEqual(DEFAULT_NAV_PREFS);
  });
  it('drops invalid values and keeps valid ones', () => {
    expect(sanitizeNavPrefs({ upAxis: 'x', orbitMode: 'trackball', orbitPivot: 'bogus' })).toEqual({ upAxis: 'y', orbitMode: 'trackball', orbitPivot: 'centre', zoomSpeed: 1 });
  });
  it('keeps only the offered wheel zoom speeds', () => {
    expect(sanitizeNavPrefs({ zoomSpeed: 2 }).zoomSpeed).toBe(2);
    expect(sanitizeNavPrefs({ zoomSpeed: 7 }).zoomSpeed).toBe(1);
    expect(sanitizeNavPrefs({ zoomSpeed: '2' }).zoomSpeed).toBe(1);
  });
  it('round-trips through storage', () => {
    const m = new Map<string, string>();
    const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
    saveNavPrefs({ upAxis: 'z', orbitMode: 'trackball', orbitPivot: 'cursor', zoomSpeed: 2 }, st);
    expect(loadNavPrefs(st)).toEqual({ upAxis: 'z', orbitMode: 'trackball', orbitPivot: 'cursor', zoomSpeed: 2 });
  });
});

describe('docUpAxis', () => {
  it('reads y or z from the document, nothing else', async () => {
    const { docUpAxis } = await import('./navPrefs');
    expect(docUpAxis({ upAxis: 'z' })).toBe('z');
    expect(docUpAxis({ upAxis: 'y' })).toBe('y');
    for (const d of [{}, { upAxis: 'x' }, { upAxis: 1 }, null, undefined, 'z']) expect(docUpAxis(d)).toBeNull();
  });
});
