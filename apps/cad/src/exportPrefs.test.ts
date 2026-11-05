import { describe, expect, it } from 'vitest';
import { DEFAULT_EXPORT_PREFS, loadExportPrefs, sanitizeExportPrefs, saveExportPrefs } from './exportPrefs';

const store = (init: Record<string, string> = {}) => { const m = { ...init }; return { m, getItem: (k: string) => m[k] ?? null, setItem: (k: string, v: string) => { m[k] = v; } }; };

describe('export preferences', () => {
  it('include cosmetic knurls by default', () => {
    expect(DEFAULT_EXPORT_PREFS).toEqual({ knurl: 'on' });
    expect(loadExportPrefs(store())).toEqual({ knurl: 'on' });
  });
  it('keeps On, Ask and Off, and anything else becomes the default', () => {
    for (const knurl of ['on', 'ask', 'off']) expect(sanitizeExportPrefs({ knurl })).toEqual({ knurl });
    for (const bad of [null, undefined, 7, 'off', {}, { knurl: 'sometimes' }, { knurl: 1 }]) expect(sanitizeExportPrefs(bad)).toEqual({ knurl: 'on' });
  });
  it('is remembered per device and survives bad stored text or no storage', () => {
    const s = store();
    saveExportPrefs({ knurl: 'ask' }, s);
    expect(loadExportPrefs(s)).toEqual({ knurl: 'ask' });
    expect(loadExportPrefs(store({ 'cad.exportPrefs': '{not json' }))).toEqual({ knurl: 'on' });
    expect(() => saveExportPrefs({ knurl: 'off' }, { setItem: () => { throw new Error('private window'); } })).not.toThrow();
    expect(loadExportPrefs(null)).toEqual({ knurl: 'on' });
  });
});
