import { describe, expect, it } from 'vitest';
import { DEFAULT_SKETCH_PREFS, loadSketchPrefs, sanitizeSketchPrefs, saveSketchPrefs, toToolSettings } from './sketchPrefs';

describe('sketch preferences', () => {
  it('defaults match the design: auto constraints on, arc switch on hover, dimensions only, grid snap on', () => {
    expect(DEFAULT_SKETCH_PREFS).toEqual({ autoConstraints: true, arcSwitch: 'hover', onViewValues: 'dimensions', gridSnap: true });
  });
  it('keeps valid values and drops anything else', () => {
    expect(sanitizeSketchPrefs({ autoConstraints: false, arcSwitch: 'keys', onViewValues: 'both', gridSnap: false, junk: 1 }))
      .toEqual({ autoConstraints: false, arcSwitch: 'keys', onViewValues: 'both', gridSnap: false });
    expect(sanitizeSketchPrefs({ arcSwitch: 'sideways', onViewValues: 3, autoConstraints: 'yes' })).toEqual(DEFAULT_SKETCH_PREFS);
    expect(sanitizeSketchPrefs(null)).toEqual(DEFAULT_SKETCH_PREFS);
  });
  it('round-trips through storage, and survives broken or missing storage', () => {
    const mem: Record<string, string> = {};
    const store = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = v; } };
    saveSketchPrefs({ autoConstraints: false, arcSwitch: 'off', onViewValues: 'off', gridSnap: false }, store);
    expect(loadSketchPrefs(store)).toEqual({ autoConstraints: false, arcSwitch: 'off', onViewValues: 'off', gridSnap: false });
    expect(loadSketchPrefs({ getItem: () => '{not json' })).toEqual(DEFAULT_SKETCH_PREFS);
    expect(loadSketchPrefs(null)).toEqual(DEFAULT_SKETCH_PREFS);
    expect(() => saveSketchPrefs(DEFAULT_SKETCH_PREFS, { setItem: () => { throw new Error('quota'); } })).not.toThrow();
  });
  it('maps to the tools settings', () => {
    expect(toToolSettings({ autoConstraints: false, arcSwitch: 'keys', onViewValues: 'both', gridSnap: true })).toEqual({ autoConstraints: false, arcSwitch: 'keys', onViewValues: 'both' });
  });
});
