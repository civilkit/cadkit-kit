import { describe, it, expect, afterEach } from 'vitest';
import { getIconSet, setIconSet } from '@kit/ui';
import { loadIconSet, saveIconSet, chooseIconSet, ICON_SET_KEY } from './iconSetPref';

afterEach(() => { localStorage.clear(); setIconSet('default'); });

describe('icon set preference', () => {
  it('is the default set when nothing is stored, or the stored value is not a known set', () => {
    expect(loadIconSet()).toBe('default');
    localStorage.setItem(ICON_SET_KEY, JSON.stringify('mystery'));
    expect(loadIconSet()).toBe('default');
    localStorage.setItem(ICON_SET_KEY, '{not json');
    expect(loadIconSet()).toBe('default');
  });
  it('persists and reloads the choice, and applies it at once', () => {
    saveIconSet('solidcraft');
    expect(loadIconSet()).toBe('solidcraft');
    chooseIconSet('default');
    expect(loadIconSet()).toBe('default');
    expect(getIconSet()).toBe('default');
    chooseIconSet('solidcraft');
    expect(getIconSet()).toBe('solidcraft');
    expect(localStorage.getItem(ICON_SET_KEY)).toBe('"solidcraft"');
  });
  it('survives storage that throws', () => {
    const bad = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(loadIconSet(bad)).toBe('default');
    expect(() => saveIconSet('solidcraft', bad)).not.toThrow();
  });
});
