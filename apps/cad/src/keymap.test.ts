import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildCommands, matchShortcut, type Actions } from './commands';
import {
  EMPTY_KEYMAP, PRESETS, PRESET_IDS, allConflicts, applyPreset, bindError, comboFromEvent, conflictsFor, effectiveBindings, exportKeymap, importKeymap, matchCombo, normalizeCombo, parseCombo,
  resetBinding, sanitizeKeymap, setBinding, setPreset,
} from './keymap';
import { applyKeymap, getBindings, getDefaults, loadKeymap, registerDefaults, resetKeymapForTests, saveKeymap, setKeymapState } from './keymapStore';

const ev = (key: string, o: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean; code: string }> = {}) => ({ key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...o });
const actions = (): Actions => ({
  open: vi.fn(), save: vi.fn(), samples: vi.fn(), undo: vi.fn(), redo: vi.fn(), palette: vi.fn(), toggleDrawer: vi.fn(), settings: vi.fn(), hasDocument: () => true, newPart: vi.fn(), toggleProjection: vi.fn(), sketchHere: vi.fn(), sketchOnFace: vi.fn(), hasFaceSelection: () => false, addExtrude: vi.fn(), newSketch: vi.fn(), toggleLeftPanel: vi.fn(),
  setView: vi.fn(), fit: vi.fn(), setMode: vi.fn(), mode: () => 'face', toggleLayer: vi.fn(), layer: () => true, selectBody: vi.fn(), triball: { toggle: vi.fn(), isOn: () => false, canToggle: () => true }, catalog: vi.fn(), shortcuts: vi.fn(),
  tree: { isSketching: () => false, hasDocument: () => true, selected: () => [], rename: vi.fn(), groupSelected: vi.fn(), deleteSelected: vi.fn(), suppressSelected: vi.fn(), rebuild: vi.fn(), selectAll: vi.fn(), rollForward: vi.fn(), isRolledBack: () => false, redo: vi.fn(), clearSelection: () => false, orbit: vi.fn(), pan: vi.fn(), zoom: vi.fn() },
} as unknown as Actions);

describe('combos', () => {
  it('normalises spellings and orders the modifiers', () => {
    expect(normalizeCombo('ctrl+shift+z')).toBe('Ctrl+Shift+Z');
    expect(normalizeCombo('Shift+Ctrl+z')).toBe('Ctrl+Shift+Z');
    expect(normalizeCombo('cmd+s')).toBe('Ctrl+S');
    expect(normalizeCombo('f2')).toBe('F2');
    expect(normalizeCombo('esc')).toBe('Escape');
    expect(normalizeCombo('[')).toBe('[');
    expect(normalizeCombo('Ctrl++')).toBe('Ctrl++');
    expect(normalizeCombo('Shift+?')).toBe('?');   // the shift is in the character
    expect(normalizeCombo('')).toBeNull();
    expect(normalizeCombo('Ctrl+')).toBeNull();
    expect(normalizeCombo('Hyper+X')).toBeNull();
    expect(normalizeCombo('Shift')).toBeNull();
    expect(parseCombo('Ctrl+Alt+Shift+K')).toEqual({ ctrl: true, alt: true, shift: true, key: 'K' });
  });
  it('reads a key press as a combo', () => {
    expect(comboFromEvent(ev('z', { metaKey: true, shiftKey: true }))).toBe('Ctrl+Shift+Z');
    expect(comboFromEvent(ev('Shift', { shiftKey: true }))).toBeNull();
    expect(comboFromEvent(ev('?', { shiftKey: true }))).toBe('?');
    expect(comboFromEvent(ev('˙', { altKey: true, code: 'KeyH' }))).toBe('Alt+H');   // macOS dead key
    expect(comboFromEvent(ev('F2'))).toBe('F2');
    expect(comboFromEvent(ev(' '))).toBe('Space');
  });
  it('matches exactly: no extra modifiers', () => {
    expect(matchCombo('Z', ev('z'))).toBe(true);
    expect(matchCombo('Z', ev('Z', { shiftKey: true }))).toBe(false);
    expect(matchCombo('Ctrl+S', ev('s', { ctrlKey: true }))).toBe(true);
    expect(matchCombo('Ctrl+S', ev('s', { metaKey: true }))).toBe(true);
    expect(matchCombo('Ctrl+S', ev('s', { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(matchCombo('?', ev('?', { shiftKey: true }))).toBe(true);
    expect(matchCombo('nonsense+', ev('x'))).toBe(false);
  });
});

describe('bindings, conflicts and presets', () => {
  const defaults = { fit: 'Z', 'view-top': '1', 'view-front': '2', 'sel-edge': 'E', 'add-extrude': 'Shift+E', undo: 'Ctrl+Z', 'sketch-tool-line': 'L', 'sketch-tool-ellipse': 'E', 'sketch-look-normal': 'N' };
  it('lists conflicts only inside a context: a sketch letter and a model letter do not clash', () => {
    expect(conflictsFor(defaults, 'sketch-tool-line', 'E')).not.toContain('sel-edge');
    expect(conflictsFor(defaults, 'sel-edge', 'L')).toEqual([]);
  });
  it('detects a conflict in the same context', () => {
    expect(conflictsFor(defaults, 'fit', 'E')).toEqual(['sel-edge']);
    expect(conflictsFor(defaults, 'sketch-tool-line', 'E')).toEqual(['sketch-tool-ellipse']);
    expect(conflictsFor(defaults, 'sketch-tool-line', 'Z')).toEqual([]);
    expect(conflictsFor(defaults, 'fit', 'z')).toEqual([]);   // its own key is not a conflict
    expect([...allConflicts({ a: 'X', b: 'x', c: 'Y' }).keys()]).toEqual(['X']);
  });
  it('refuses a conflicting bind until it is told to steal, then unbinds the loser', () => {
    const r = setBinding(defaults, EMPTY_KEYMAP, 'fit', 'e');
    expect(r.conflicts).toEqual(['sel-edge']);
    expect(r.state).toBe(EMPTY_KEYMAP);
    const s = setBinding(defaults, EMPTY_KEYMAP, 'fit', 'e', true);
    expect(s.state.overrides).toEqual({ fit: 'E', 'sel-edge': null });
    const eff = effectiveBindings(defaults, s.state);
    expect(eff.fit).toBe('E'); expect(eff['sel-edge']).toBeNull();
    expect(allConflicts(eff).size).toBe(0);
  });
  it('rebinding to the shipped key drops the override; reset removes one', () => {
    const a = setBinding(defaults, EMPTY_KEYMAP, 'fit', 'G').state;
    expect(a.overrides).toEqual({ fit: 'G' });
    expect(setBinding(defaults, a, 'fit', 'z').state.overrides).toEqual({});
    expect(resetBinding(a, 'fit').overrides).toEqual({});
    expect(setBinding(defaults, EMPTY_KEYMAP, 'fit', null).state.overrides).toEqual({ fit: null });
  });
  it('rejects invalid keys, Esc and Ctrl/Alt on a sketch tool', () => {
    expect(bindError('fit', 'Ctrl+')).toBe('invalid');
    expect(bindError('fit', 'Esc')).toBe('reserved');
    expect(bindError('sketch-tool-line', 'Ctrl+L')).toBe('sketchModifier');
    expect(bindError('fit', 'Ctrl+L')).toBeNull();
    expect(setBinding(defaults, EMPTY_KEYMAP, 'sketch-tool-line', 'Alt+L').error).toBe('sketchModifier');
  });
  it('a preset takes its keys, drops the defaults it displaces and never leaves two commands on one key', () => {
    const eff = effectiveBindings(defaults, setPreset(EMPTY_KEYMAP, 'freecad'));
    expect(eff['view-front']).toBe('1'); expect(eff['view-top']).toBe('2');
    const sw = applyPreset({ ...defaults, palette: 'F' }, 'solidworks');
    expect(sw.fit).toBe('F');
    expect(sw.palette).toBe('Ctrl+K');
    expect(applyPreset(defaults, 'default')).toEqual(defaults);
    expect(setPreset({ preset: 'default', overrides: { fit: 'G' } }, 'fusion')).toEqual({ preset: 'fusion', overrides: {} });
  });
  it('overrides win over the preset', () => {
    const s = { preset: 'freecad' as const, overrides: { 'view-front': 'Ctrl+9' } };
    expect(effectiveBindings(defaults, s)['view-front']).toBe('Ctrl+9');
  });
  it('preset tables hold only valid combos', () => {
    for (const [name, set] of Object.entries(PRESETS)) {
      for (const [id, c] of Object.entries(set)) expect(normalizeCombo(c!), `${name} ${id}`).not.toBeNull();
      expect(PRESET_IDS).toContain(name);
      const combos = Object.entries(set).map(([id, c]) => [id, normalizeCombo(c!)] as const);
      expect(allConflicts(Object.fromEntries(combos)).size, name + ' conflicts inside itself').toBe(0);
    }
  });
});

describe('save, import and export', () => {
  it('round-trips through the exported file', () => {
    const s = { preset: 'fusion' as const, overrides: { fit: 'G', 'sel-edge': null } };
    const back = importKeymap(exportKeymap(s));
    expect(back?.state).toEqual(s);
    expect(back?.skipped).toEqual([]);
  });
  it('drops bad entries and refuses a file that is not a keymap', () => {
    expect(importKeymap('not json')).toBeNull();
    expect(importKeymap('{"a":1}')).toBeNull();
    const r = importKeymap(JSON.stringify({ format: 'cadkit-keymap', version: 1, preset: 'nope', overrides: { fit: 'ctrl+g', bad: 'Ctrl+', 'sketch-tool-line': 'Ctrl+L', '../x': 'A', n: 5 } }));
    expect(r?.state).toEqual({ preset: 'default', overrides: { fit: 'Ctrl+G' } });
    expect(r?.skipped.sort()).toEqual(['../x', 'bad', 'n', 'sketch-tool-line']);
    expect(sanitizeKeymap(null).state).toEqual(EMPTY_KEYMAP);
  });
  it('persists and loads, and a broken store gives the defaults', () => {
    const mem: Record<string, string> = {};
    const store = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = v; } };
    saveKeymap({ preset: 'freecad', overrides: { fit: 'G' } }, store);
    expect(loadKeymap(store)).toEqual({ preset: 'freecad', overrides: { fit: 'G' } });
    mem['cad.keymap'] = '{oops';
    expect(loadKeymap(store)).toEqual(EMPTY_KEYMAP);
    expect(loadKeymap({ getItem: () => { throw new Error('blocked'); } })).toEqual(EMPTY_KEYMAP);
  });
});

describe('the keymap on the real command table', () => {
  beforeEach(() => resetKeymapForTests());
  it('the shipped keys have no conflicts (so a conflict shown is always the user\'s doing)', () => {
    buildCommands(actions());
    expect([...allConflicts(getBindings())]).toEqual([]);
  });
  it('with no overrides the table is unchanged', () => {
    const cmds = buildCommands(actions());
    expect(cmds.find((c) => c.id === 'fit')?.keys).toBe('Z');
    expect(cmds.find((c) => c.id === 'view-top')?.keys).toBe('1');
    expect(cmds.find((c) => c.id === 'undo')?.keys).toBe('Ctrl+Z');
    expect(cmds.find((c) => c.id === 'rename')?.keys).toBe('F2');   // a treeCommands key
    expect(getDefaults()['sketch-tool-line']).toBe('L');
  });
  it('a rebound key runs the command on the new key and not the old one', () => {
    buildCommands(actions());
    setKeymapState({ preset: 'default', overrides: { fit: 'G' } }, false);
    const cmds = buildCommands(actions());
    expect(matchShortcut(cmds, ev('g'))?.id).toBe('fit');
    expect(matchShortcut(cmds, ev('z'))?.id).toBeUndefined();
    expect(cmds.find((c) => c.id === 'fit')?.keys).toBe('G');
  });
  it('a tree command can be rebound and unbound', () => {
    buildCommands(actions());
    setKeymapState({ preset: 'default', overrides: { rename: 'Ctrl+R', rebuild: null } }, false);
    const cmds = buildCommands(actions());
    expect(matchShortcut(cmds, ev('r', { ctrlKey: true }))?.id).toBe('rename');
    expect(matchShortcut(cmds, ev('F2'))).toBeUndefined();
    expect(cmds.find((c) => c.id === 'rebuild')?.keys).toBeUndefined();
  });
  it('a command that shipped without a key can be given one', () => {
    buildCommands(actions());
    setKeymapState({ preset: 'default', overrides: { 'roll-forward': 'Ctrl+Alt+F' } }, false);
    const cmds = buildCommands(actions());
    expect(matchShortcut(cmds, ev('f', { ctrlKey: true, altKey: true }))?.id).toBe('roll-forward');
  });
  it('the SolidWorks preset moves the view keys through the command table', () => {
    buildCommands(actions());
    setKeymapState({ preset: 'solidworks', overrides: {} }, false);
    const cmds = buildCommands(actions());
    expect(matchShortcut(cmds, ev('1', { ctrlKey: true }))?.id).toBe('view-front');
    expect(matchShortcut(cmds, ev('1'))).toBeUndefined();
    expect(allConflicts(getBindings()).size).toBe(0);
  });
  it('every preset leaves the app without conflicts', () => {
    buildCommands(actions());
    for (const id of PRESET_IDS) {
      setKeymapState({ preset: id, overrides: {} }, false);
      expect([...allConflicts(getBindings())], id).toEqual([]);
    }
  });
  it('applyKeymap leaves commands it has no binding for alone', () => {
    const cmds = [{ id: 'zz', label: 'z', tab: 'Home', group: 'x', keys: 'Ctrl+Q', run() {} }];
    registerDefaults(cmds);
    applyKeymap(cmds);
    expect(cmds[0].keys).toBe('Ctrl+Q');
    setKeymapState({ preset: 'default', overrides: { zz: 'Ctrl+W' } }, false);
    applyKeymap(cmds);
    expect(cmds[0].keys).toBe('Ctrl+W');
  });
});
