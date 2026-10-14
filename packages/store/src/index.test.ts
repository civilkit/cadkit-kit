import { describe, it, expect } from 'vitest';
import { createStore, sanitizeWorkspace, WORKSPACE_PRESETS } from './index';

describe('store', () => {
  it('selects, toggles and extends the selection', () => {
    const s = createStore();
    s.select(['F2.C1']);
    s.select(['F2.C0'], true);
    expect(s.selection.value).toEqual(['F2.C1', 'F2.C0']);
    s.toggle('F2.C1');
    expect(s.selection.value).toEqual(['F2.C0']);
  });
  it('drops names that no longer exist and says so', () => {
    const s = createStore();
    s.select(['F2.C1', 'F2.C0']);
    const dropped = s.dropMissing(new Set(['F2.C0']));
    expect(dropped).toEqual(['F2.C1']);
    expect(s.selection.value).toEqual(['F2.C0']);
    expect(s.notices.value.at(-1)?.text).toMatch(/F2\.C1/);
  });
  it('toggles display layers without touching the others', () => {
    const s = createStore();
    expect(s.display.value.edges).toBe(true);
    s.setDisplay('edges', false);
    expect(s.display.value.edges).toBe(false);
    expect(s.display.value.sketches).toBe(true);
    expect(createStore({ planes: false }).display.value.planes).toBe(false);
  });
  it('defaults to the Plasticity-style workspace and applies presets', () => {
    const s = createStore();
    expect(s.workspace.value.ribbon).toBe('off');
    expect(s.workspace.value.toolRail).toBe(true);
    s.applyPreset('classic');
    expect(s.workspace.value.ribbon).toBe('full');
    expect(s.workspace.value.rightPanel).toBe('docked');
  });
  it('setWorkspace changes only what it is given and clamps bad values', () => {
    const s = createStore();
    s.setWorkspace({ toolRail: false, opacity: 5, blur: -3 });
    expect(s.workspace.value.toolRail).toBe(false);
    expect(s.workspace.value.opacity).toBe(1);
    expect(s.workspace.value.blur).toBe(0);
    expect(s.workspace.value.ribbon).toBe('off');
  });
  it('sanitizeWorkspace ignores stored garbage', () => {
    const w = sanitizeWorkspace({ ribbon: 'weird', toolRail: 'yes', opacity: 'x', leftPanel: 'floating', extra: 1 });
    expect(w.ribbon).toBe('off');
    expect(w.toolRail).toBe(true);
    expect(w.leftPanel).toBe('floating');
    expect(sanitizeWorkspace(null).ribbon).toBe('off');
  });

  it('toolLabels defaults to icons-and-text in every preset, and round-trips through sanitize and the store', () => {
    for (const p of Object.values(WORKSPACE_PRESETS)) expect(p.toolLabels).toBe('icons-and-text');
    expect(sanitizeWorkspace(undefined).toolLabels).toBe('icons-and-text');
    expect(sanitizeWorkspace({ toolLabels: 'icons' }).toolLabels).toBe('icons');
    expect(sanitizeWorkspace({ toolLabels: 'bogus' }).toolLabels).toBe('icons-and-text');
    expect(sanitizeWorkspace({ toolLabels: 3 }, { ...WORKSPACE_PRESETS.classic, toolLabels: 'icons' }).toolLabels).toBe('icons');
    const s = createStore();
    s.setWorkspace({ toolLabels: 'icons' });
    expect(s.workspace.value.toolLabels).toBe('icons');
    const again = createStore({}, JSON.parse(JSON.stringify(s.workspace.value)));
    expect(again.workspace.value.toolLabels).toBe('icons');
    s.applyPreset('classic');
    expect(s.workspace.value.toolLabels).toBe('icons-and-text');
  });
});

describe('left panel collapse', () => {
  it('is a remembered boolean, off by default in every preset, and bad values fall back', () => {
    for (const p of Object.values(WORKSPACE_PRESETS)) expect(p.leftCollapsed).toBe(false);
    expect(sanitizeWorkspace({ leftCollapsed: true }).leftCollapsed).toBe(true);
    expect(sanitizeWorkspace({ leftCollapsed: 'yes' }).leftCollapsed).toBe(false);
  });
});
