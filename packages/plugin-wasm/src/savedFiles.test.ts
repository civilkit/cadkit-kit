import { describe, it, expect } from 'vitest';
import { checkSaved, savedName, MAX_SAVED_FILE } from './sandbox';

const ok = new Set(['cutlists']);
const f = (path: unknown, data: unknown = new Uint8Array([1, 2]), grant: unknown = 'cutlists') => ({ grant, path, data });

describe('files a plugin saves (checked by the page, not the Worker)', () => {
  it('accepts a plain name on a granted name and copies the bytes', () => {
    const r = checkSaved([f('kitchen.csv')], ok);
    expect(r).toEqual([{ grant: 'cutlists', name: 'kitchen.csv', data: new Uint8Array([1, 2]) }]);
    expect(checkSaved(undefined, ok)).toEqual([]);
  });
  it('refuses a grant the manifest does not name', () => {
    expect(checkSaved([f('a.csv', undefined, 'other')], ok)).toMatch(/does not ask for/);
    expect(checkSaved([f('a.csv')], new Set())).toMatch(/does not ask for/);
  });
  it('refuses a name with folders, dots at the start, or odd characters', () => {
    for (const bad of ['../x.csv', 'a/b.csv', '/etc/passwd', '.hidden', 'a..b', 'a\\b', '', 'x'.repeat(130), 5, null]) expect(savedName(bad)).toBeNull();
    expect(checkSaved([f('../x.csv')], ok)).toMatch(/no folders/);
    expect(savedName('Kitchen (v2) 2026.csv')).toBe('Kitchen (v2) 2026.csv');
  });
  it('refuses a file that is too large, too many files, or something that is not bytes', () => {
    expect(checkSaved([f('big.csv', new Uint8Array(MAX_SAVED_FILE + 1))], ok)).toMatch(/more than/);
    expect(checkSaved(Array.from({ length: 17 }, (_, i) => f(`a${i}.csv`)), ok)).toMatch(/too many/);
    expect(checkSaved([f('a.csv', 'text')], ok)).toMatch(/without data/);
    expect(checkSaved('nope', ok)).toMatch(/too many/);
  });
});
