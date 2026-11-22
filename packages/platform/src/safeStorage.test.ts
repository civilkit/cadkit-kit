import { afterEach, describe, expect, it, vi } from 'vitest';
import { safeStorage } from './safeStorage';

const fake = (init: Record<string, string> = {}): Storage => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } } as unknown as Storage;
};
const throwing = (): Storage => ({
  getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('blocked'); },
}) as unknown as Storage;

afterEach(() => { vi.unstubAllGlobals(); });

describe('safeStorage', () => {
  it('reads and writes through a working storage', () => {
    vi.stubGlobal('localStorage', fake());
    expect(safeStorage.get('a')).toBeNull();
    expect(safeStorage.set('a', '1')).toBe(true);
    expect(safeStorage.get('a')).toBe('1');
    safeStorage.remove('a');
    expect(safeStorage.get('a')).toBeNull();
    expect(safeStorage.setJson('j', { x: 1 })).toBe(true);
    expect(safeStorage.getJson('j', {})).toEqual({ x: 1 });
  });
  it('never throws when the storage does', () => {
    vi.stubGlobal('localStorage', throwing());
    expect(safeStorage.get('a')).toBeNull();
    expect(safeStorage.set('a', '1')).toBe(false);
    expect(() => safeStorage.remove('a')).not.toThrow();
    expect(safeStorage.getJson('a', [1])).toEqual([1]);
    expect(safeStorage.setJson('a', { x: 1 })).toBe(false);
  });
  it('never throws when merely touching localStorage throws', () => {
    vi.stubGlobal('localStorage', undefined);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
    expect(safeStorage.get('a')).toBeNull();
    expect(safeStorage.set('a', '1')).toBe(false);
  });
  it('gives the fallback for bad JSON, a missing key and a stored null', () => {
    vi.stubGlobal('localStorage', fake({ bad: '{nope', nul: 'null' }));
    expect(safeStorage.getJson('bad', { ok: true })).toEqual({ ok: true });
    expect(safeStorage.getJson('missing', 7)).toBe(7);
    expect(safeStorage.getJson('nul', 'dflt')).toBe('dflt');
  });
  it('setJson survives a value JSON cannot hold', () => {
    vi.stubGlobal('localStorage', fake());
    const a: Record<string, unknown> = {}; a.self = a;
    expect(safeStorage.setJson('c', a)).toBe(false);
  });
});
