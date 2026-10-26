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
  it('starts with planes hidden', () => {
    expect(createStore().display.value.planes).toBe(false);
    expect(createStore({ planes: true }).display.value.planes).toBe(true);
  });
  it('defaults to the full-ribbon floating-panel layout and applies presets', () => {
    const s = createStore();
    expect(s.workspace.value).toMatchObject({ ribbon: 'full', leftPanel: 'floating', leftTabs: true, rightPanel: 'docked', toolRail: false, sketchPalette: false, selectionBar: false, drawerOpen: false, handles: true, toolLabels: 'icons-and-text' });
    s.applyPreset('plasticity');
    expect(s.workspace.value.ribbon).toBe('off');
    expect(s.workspace.value.toolRail).toBe(true);
    s.applyPreset('classic');
    expect(s.workspace.value.ribbon).toBe('full');
    expect(s.workspace.value.rightPanel).toBe('docked');
  });
  it('handles are on by default in every preset, can be switched off, and garbage is ignored', () => {
    const s = createStore();
    expect(s.workspace.value.handles).toBe(true);
    for (const p of ['plasticity', 'classic', 'minimal'] as const) { s.applyPreset(p); expect(s.workspace.value.handles).toBe(true); }
    s.setWorkspace({ handles: false });
    expect(s.workspace.value.handles).toBe(false);
    expect(createStore({}, { handles: false }).workspace.value.handles).toBe(false);
    expect(createStore({}, { handles: 'no' }).workspace.value.handles).toBe(true);
  });
  it('setWorkspace changes only what it is given and clamps bad values', () => {
    const s = createStore();
    s.setWorkspace({ toolRail: true, opacity: 5, blur: -3 });
    expect(s.workspace.value.toolRail).toBe(true);
    expect(s.workspace.value.opacity).toBe(1);
    expect(s.workspace.value.blur).toBe(0);
    expect(s.workspace.value.ribbon).toBe('full');
  });
  it('sanitizeWorkspace ignores stored garbage', () => {
    const w = sanitizeWorkspace({ ribbon: 'weird', toolRail: 'yes', opacity: 'x', leftPanel: 'docked', extra: 1 });
    expect(w.ribbon).toBe('full');
    expect(w.toolRail).toBe(false);
    expect(w.leftPanel).toBe('docked');
    expect(sanitizeWorkspace(null).ribbon).toBe('full');
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

import { matchPreset } from './index';
describe('matchPreset', () => {
  it('names the preset the layout matches, ignoring looks and collapse, and null for a mix', () => {
    expect(matchPreset(WORKSPACE_PRESETS.classic)).toBe('classic');
    expect(matchPreset({ ...WORKSPACE_PRESETS.plasticity, opacity: 0.9, blur: 3, leftCollapsed: true, toolLabels: 'icons' })).toBe('plasticity');
    expect(matchPreset({ ...WORKSPACE_PRESETS.minimal, ribbon: 'full' })).toBeNull();
  });
});

describe('highlight line width', () => {
  it('defaults to 3 px in every preset, is clamped to 1..8, and bad values fall back', () => {
    for (const p of Object.values(WORKSPACE_PRESETS)) expect(p.lineWidth).toBe(3);
    expect(sanitizeWorkspace({ lineWidth: 20 }).lineWidth).toBe(8);
    expect(sanitizeWorkspace({ lineWidth: 0 }).lineWidth).toBe(1);
    expect(sanitizeWorkspace({ lineWidth: 'x' }).lineWidth).toBe(3);
    expect(sanitizeWorkspace({ lineWidth: 1.5 }).lineWidth).toBe(1.5);
  });
});

describe('pick filters and body mode', () => {
  it('every pick type is on to begin with; setFilter switches one', async () => {
    const { createStore, PICK_FILTER_KINDS, MODE_FILTER } = await import('./index');
    const s = createStore();
    expect(PICK_FILTER_KINDS.every((k) => s.filters.value[k])).toBe(true);
    s.setFilter('edges', false);
    expect(s.filters.value.edges).toBe(false);
    expect(s.filters.value.faces).toBe(true);
    expect(MODE_FILTER).toEqual({ face: 'faces', edge: 'edges', vertex: 'vertices', body: 'bodies' });
    s.mode.value = 'body';
    expect(s.mode.value).toBe('body');
  });
});

describe('panel sizes', () => {
  it('are stored, rounded, clamped and survive a reload through sanitizeWorkspace', () => {
    const s = createStore();
    expect(s.workspace.value.leftWidth).toBe(280);
    s.setWorkspace({ leftWidth: 412.6, drawerHeight: 99999, rightWidth: -5 });
    expect(s.workspace.value.leftWidth).toBe(413);
    expect(s.workspace.value.drawerHeight).toBe(4000);
    expect(s.workspace.value.rightWidth).toBe(0);
    const again = createStore({}, JSON.parse(JSON.stringify(s.workspace.value)));
    expect(again.workspace.value.leftWidth).toBe(413);
    expect(createStore({}, { leftWidth: 'wide' }).workspace.value.leftWidth).toBe(280);
  });
  it('a preset keeps the sizes; resetLayout restores the defaults and unfolds the panel', () => {
    const s = createStore();
    s.setWorkspace({ leftWidth: 400, drawerHeight: 300, leftCollapsed: true });
    s.applyPreset('classic');
    expect(s.workspace.value.leftWidth).toBe(400);
    s.resetLayout();
    expect(s.workspace.value.leftWidth).toBe(280);
    expect(s.workspace.value.drawerHeight).toBe(210);
    expect(s.workspace.value.leftCollapsed).toBe(false);
  });
});
