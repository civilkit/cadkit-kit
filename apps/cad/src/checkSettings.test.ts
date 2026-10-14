import { describe, expect, it } from 'vitest';
import type { ProfileInfo } from './designCheck';
import {
  buildPolicy, defaultSettings, isDefault, loadFlag, loadSettings, mergeSettings, modeSeverity, parseParam, saveFlag, saveSettings, settingsToInline,
} from './checkSettings';

const profile: ProfileInfo = {
  id: 'fdm-print', name: 'FDM 3D printing', description: '',
  rules: [
    { id: 'minWall', title: 'Minimum wall', description: '', severity: 'error', params: [{ name: 'min', type: 'number', default: 1.2, value: 1.2, unit: 'mm', min: 0, description: '' }] },
    { id: 'overhang', title: 'Overhang', description: '', severity: 'warn', params: [
      { name: 'angle', type: 'number', default: 45, value: 50, unit: 'deg', min: 0, max: 90, description: '' },
      { name: 'direction', type: 'vec3', default: [0, 1, 0], value: [0, 1, 0], unit: '', description: '' }] },
  ],
};
const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };

describe('settings form <-> params', () => {
  it('defaults come from the profile values; nothing blocks until chosen', () => {
    const s = defaultSettings(profile);
    expect(s.overhang).toEqual({ mode: 'warn', params: { angle: 50, direction: [0, 1, 0] } });
    expect(s.minWall.mode).toBe('warn');
    expect(isDefault(profile, s)).toBe(true);
    expect(buildPolicy(profile, s, false).blocking).toEqual([]);
  });
  it('modes map to severities: info, warn, block -> error, off -> nothing', () => {
    expect(['off', 'info', 'warn', 'block'].map((m) => modeSeverity(m as never))).toEqual([null, 'info', 'warn', 'error']);
  });
  it('inline profile skips Off rules and carries severity and limits', () => {
    const s = defaultSettings(profile);
    s.minWall = { mode: 'block', params: { min: 2 } };
    s.overhang.mode = 'off';
    expect(settingsToInline(profile, s)).toEqual({ id: 'fdm-print', name: 'FDM 3D printing', rules: [{ id: 'minWall', severity: 'error', params: { min: 2 } }] });
    const p = buildPolicy(profile, s, true);
    expect(p.blocking).toEqual(['minWall']);
    expect(p.afterEdit).toBe(true);
    expect(p.titles.minWall).toBe('Minimum wall');
    expect(isDefault(profile, s)).toBe(false);
  });
  it('merge ignores unknown rules, params, wrong types and other versions', () => {
    const s = mergeSettings(profile, { v: 1, rules: { gone: { mode: 'off' }, minWall: { mode: 'bogus', params: { min: 3, nope: 1 } }, overhang: { mode: 'block', params: { angle: 'x', direction: [1, 0] } } } });
    expect(s.gone).toBeUndefined();
    expect(s.minWall).toEqual({ mode: 'warn', params: { min: 3 } });
    expect(s.overhang).toEqual({ mode: 'block', params: { angle: 50, direction: [0, 1, 0] } });
    expect(mergeSettings(profile, 'junk')).toEqual(defaultSettings(profile));
    expect(mergeSettings(profile, { v: 99, rules: { minWall: { mode: 'off' } } })).toEqual(defaultSettings(profile));
  });
  it('remembers per profile in a versioned shape, survives a broken store', () => {
    const st = memory();
    const s = defaultSettings(profile); s.minWall.params.min = 4; s.minWall.mode = 'block';
    saveSettings(profile, s, st);
    expect(JSON.parse(st.getItem('cad.check.fdm-print')!).v).toBe(1);
    expect(loadSettings(profile, st).minWall).toEqual({ mode: 'block', params: { min: 4 } });
    expect(loadSettings({ ...profile, id: 'other' }, st).minWall.params.min).toBe(1.2);
    st.setItem('cad.check.fdm-print', '{bad');
    expect(loadSettings(profile, st)).toEqual(defaultSettings(profile));
    expect(() => saveSettings(profile, s, { getItem: () => null, setItem() { throw new Error('quota'); } })).not.toThrow();
  });
  it('flags default to off', () => {
    const st = memory();
    expect(loadFlag('cad.check.afterEdit', st)).toBe(false);
    saveFlag('cad.check.afterEdit', true, st);
    expect(loadFlag('cad.check.afterEdit', st)).toBe(true);
  });
  it('parseParam clamps and rejects text', () => {
    expect(parseParam('120', { min: 0, max: 90 })).toBe(90);
    expect(parseParam('-1', { min: 0 })).toBe(0);
    expect(parseParam('1,5', {})).toBe(1.5);
    expect(parseParam('', {})).toBeNull();
    expect(parseParam('abc', {})).toBeNull();
  });
});
