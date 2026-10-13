import { describe, it, expect, beforeEach } from 'vitest';
import { registerCatalog, setLocale, t, missing, resetMissing, locale, PSEUDO } from './index';

beforeEach(() => { setLocale('en'); resetMissing(); });

registerCatalog('en', {
  'a.hello': 'Hello {name}',
  'a.items': { one: '{count} item', other: '{count} items' },
  'a.only_en': 'English only',
});
registerCatalog('de', { 'a.hello': 'Hallo {name}', 'a.items': { one: '{count} Element', other: '{count} Elemente' } });

describe('t', () => {
  it('interpolates parameters and leaves unknown placeholders alone', () => {
    expect(t('a.hello', { name: 'Ada' })).toBe('Hello Ada');
    expect(t('a.hello', { other: 1 })).toBe('Hello {name}');
  });
  it('picks plural forms by count', () => {
    expect(t('a.items', { count: 1 })).toBe('1 item');
    expect(t('a.items', { count: 3 })).toBe('3 items');
    expect(t('a.items', { count: 0 })).toBe('0 items');
  });
  it('switches language and re-reads the locale signal', () => {
    setLocale('de');
    expect(locale.value).toBe('de');
    expect(t('a.hello', { name: 'Ada' })).toBe('Hallo Ada');
    expect(t('a.items', { count: 2 })).toBe('2 Elemente');
  });
  it('falls back to English, then the key, and records what was missing', () => {
    setLocale('de');
    expect(t('a.only_en')).toBe('English only');
    expect(t('a.nowhere')).toBe('a.nowhere');
    expect(missing()).toContain('de:a.only_en');
    expect(missing()).toContain('en:a.nowhere');
  });
  it('an explicit fallback is used without recording a miss', () => {
    expect(t('a.unknown', undefined, 'Plain')).toBe('Plain');
    expect(missing()).toEqual([]);
  });
  it('the pseudo-locale accents text, pads it, and keeps placeholders intact', () => {
    setLocale(PSEUDO);
    const s = t('a.hello', { name: 'Ada' });
    expect(s.startsWith('[!! ')).toBe(true);
    expect(s).toContain('Ada');
    expect(s).toContain('Héllö');
    expect(s.length).toBeGreaterThan('Hello Ada'.length + 6);
  });
});
