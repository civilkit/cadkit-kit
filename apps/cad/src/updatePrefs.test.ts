import { describe, expect, it } from 'vitest';
import { loadAutoUpdate, saveAutoUpdate } from './updatePrefs';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
describe('the automatic update setting', () => {
  it('is on by default and remembers a change', () => {
    const s = mem();
    expect(loadAutoUpdate(s)).toBe(true);
    saveAutoUpdate(false, s); expect(loadAutoUpdate(s)).toBe(false);
    saveAutoUpdate(true, s); expect(loadAutoUpdate(s)).toBe(true);
  });
  it('falls back to on for junk or blocked storage', () => {
    const s = mem(); s.setItem('cad.autoUpdate', '"no"'); expect(loadAutoUpdate(s)).toBe(true);
    expect(loadAutoUpdate({ getItem: () => { throw new Error('x'); } })).toBe(true);
    expect(() => saveAutoUpdate(false, { setItem: () => { throw new Error('x'); } })).not.toThrow();
    expect(loadAutoUpdate(null)).toBe(true);
  });
});
