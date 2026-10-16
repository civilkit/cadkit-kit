import { describe, expect, it } from 'vitest';
import { constrainsFromGuides, lookChipNeeded, DEFAULT_SKETCH_PREFS, loadSketchPrefs, sanitizeSketchPrefs, saveSketchPrefs, toToolSettings } from './sketchPrefs';

describe('keep view when entering a sketch', () => {
  it('is on by default, can be turned off, ignores junk', () => {
    expect(DEFAULT_SKETCH_PREFS.keepView).toBe(true);
    expect(sanitizeSketchPrefs({ keepView: false }).keepView).toBe(false);
    expect(sanitizeSketchPrefs({ keepView: 0 }).keepView).toBe(true);
  });
});

describe('auto-constrain from guides', () => {
  it('is off by default and survives sanitising', () => {
    expect(DEFAULT_SKETCH_PREFS.guideConstraints).toBe(false);
    expect(sanitizeSketchPrefs({}).guideConstraints).toBe(false);
    expect(sanitizeSketchPrefs({ guideConstraints: true }).guideConstraints).toBe(true);
    expect(sanitizeSketchPrefs({ guideConstraints: 'yes' }).guideConstraints).toBe(false);
  });
});

describe('a clean profile: guides show but never constrain', () => {
  const store = (v: string | null) => ({ getItem: () => v });
  it('no stored value, a broken one, or one without the key all load as OFF', () => {
    expect(loadSketchPrefs(store(null)).guideConstraints).toBe(false);
    expect(loadSketchPrefs(store('{oops')).guideConstraints).toBe(false);
    expect(loadSketchPrefs(store('{"autoConstraints":true}')).guideConstraints).toBe(false);
    expect(loadSketchPrefs(null).guideConstraints).toBe(false);
  });
  it('the default adds no constraint from a guide click, with or without Shift; the guide snaps themselves stay on', () => {
    const p = loadSketchPrefs(store(null));
    expect(constrainsFromGuides(p, false)).toBe(false);
    expect(constrainsFromGuides({ ...p, guideConstraints: true }, false)).toBe(true);
    expect(constrainsFromGuides({ ...p, guideConstraints: true }, true)).toBe(false);
    expect(constrainsFromGuides({ ...p, guideConstraints: true, autoConstraints: false }, false)).toBe(false);
    expect(p.snaps.align).toBe(true);
  });
});

describe('sketch preferences', () => {
  it('defaults match the design: auto constraints on, arc switch on hover, dimensions only, grid snap on', () => {
    expect(DEFAULT_SKETCH_PREFS).toMatchObject({ autoConstraints: true, arcSwitch: 'hover', onViewValues: 'dimensions', gridSnap: true });
    expect(Object.values(DEFAULT_SKETCH_PREFS.snaps).every(Boolean)).toBe(true);
    expect(Object.values(DEFAULT_SKETCH_PREFS.show).every(Boolean)).toBe(true);
  });
  it('keeps valid values and drops anything else', () => {
    expect(sanitizeSketchPrefs({ autoConstraints: false, arcSwitch: 'keys', onViewValues: 'both', gridSnap: false, junk: 1 }))
      .toEqual({ ...DEFAULT_SKETCH_PREFS, autoConstraints: false, arcSwitch: 'keys', onViewValues: 'both', gridSnap: false });
    const partial = sanitizeSketchPrefs({ snaps: { quadrant: false, bogus: false, midpoint: 'no' }, show: { relations: false } });
    expect(partial.snaps.quadrant).toBe(false);
    expect(partial.snaps.midpoint).toBe(true);
    expect('bogus' in partial.snaps).toBe(false);
    expect(partial.show).toEqual({ ...DEFAULT_SKETCH_PREFS.show, relations: false });
    expect(sanitizeSketchPrefs({ arcSwitch: 'sideways', onViewValues: 3, autoConstraints: 'yes' })).toEqual(DEFAULT_SKETCH_PREFS);
    expect(sanitizeSketchPrefs(null)).toEqual(DEFAULT_SKETCH_PREFS);
  });
  it('round-trips through storage, and survives broken or missing storage', () => {
    const mem: Record<string, string> = {};
    const store = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = v; } };
    const custom = { ...DEFAULT_SKETCH_PREFS, autoConstraints: false, arcSwitch: 'off' as const, onViewValues: 'off' as const, gridSnap: false, snaps: { ...DEFAULT_SKETCH_PREFS.snaps, tangent: false } };
    saveSketchPrefs(custom, store);
    expect(loadSketchPrefs(store)).toEqual(custom);
    expect(loadSketchPrefs({ getItem: () => '{not json' })).toEqual(DEFAULT_SKETCH_PREFS);
    expect(loadSketchPrefs(null)).toEqual(DEFAULT_SKETCH_PREFS);
    expect(() => saveSketchPrefs(DEFAULT_SKETCH_PREFS, { setItem: () => { throw new Error('quota'); } })).not.toThrow();
  });
  it('maps to the tools settings', () => {
    expect(toToolSettings({ ...DEFAULT_SKETCH_PREFS, autoConstraints: false, arcSwitch: 'keys', onViewValues: 'both', gridSnap: true })).toEqual({ autoConstraints: false, arcSwitch: 'keys', onViewValues: 'both' });
  });
});

describe('look normal on entry', () => {
  it('the chip is offered above 5 degrees off the plane normal', () => {
    expect(lookChipNeeded(null)).toBe(false);
    expect(lookChipNeeded(0)).toBe(false);
    expect(lookChipNeeded(5)).toBe(false);
    expect(lookChipNeeded(5.5)).toBe(true);
    expect(lookChipNeeded(55)).toBe(true);
  });
  it('auto look normal is off by default and survives sanitising', () => {
    expect(DEFAULT_SKETCH_PREFS.autoLookNormal).toBe(false);
    expect(sanitizeSketchPrefs({ autoLookNormal: true }).autoLookNormal).toBe(true);
    expect(sanitizeSketchPrefs({ autoLookNormal: 1 }).autoLookNormal).toBe(false);
  });
});
