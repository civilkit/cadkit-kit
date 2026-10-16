import { describe, expect, it, vi } from 'vitest';
import { matchShortcut } from './commands';
import { ORBIT_STEP_DEG, orbitPixels, treeCommands, treeKey, type KeyLike, type TreeActions } from './treeCommands';

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: k, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...mods });
const actions = (over: Partial<TreeActions> = {}): TreeActions => ({
  isSketching: () => false, hasDocument: () => true, selected: () => ['F2'], rename: vi.fn(), groupSelected: vi.fn(), deleteSelected: vi.fn(), suppressSelected: vi.fn(),
  rebuild: vi.fn(), selectAll: vi.fn(), rollForward: vi.fn(), isRolledBack: () => false, redo: vi.fn(), clearSelection: () => false, orbit: vi.fn(), pan: vi.fn(), ...over,
});

describe('tree commands', () => {
  it('carry their keys and are found by matchShortcut', () => {
    const cmds = treeCommands(actions());
    const id = (k: string, m: Partial<KeyLike> = {}) => matchShortcut(cmds, key(k, m))?.id;
    expect(id('F2')).toBe('rename');
    expect(id('g', { ctrlKey: true })).toBe('group-selected');
    expect(id('Delete')).toBe('delete-feature');
    expect(id('b', { ctrlKey: true })).toBe('rebuild');
    expect(id('a', { metaKey: true })).toBe('select-all');
    expect(id('U', { ctrlKey: true, shiftKey: true })).toBe('suppress-selected');
  });
  it('delete and suppress need a selection; rename works with or without (the part then); none run while sketching', () => {
    const find = (a: TreeActions, id: string) => treeCommands(a).find((c) => c.id === id)!;
    expect(find(actions({ selected: () => [] }), 'delete-feature').enabled!()).toBe(false);
    expect(find(actions({ selected: () => ['F2'] }), 'group-selected').enabled!()).toBe(false);
    expect(find(actions({ selected: () => ['F2', 'F4'] }), 'group-selected').enabled!()).toBe(true);
    expect(find(actions({ selected: () => [] }), 'rename').enabled!()).toBe(true);
    expect(find(actions({ isSketching: () => true }), 'rename').enabled!()).toBe(false);
    expect(find(actions({ selected: () => ['F1', 'F2'] }), 'suppress-selected').enabled!()).toBe(true);
    expect(find(actions({ isSketching: () => true }), 'rebuild').enabled!()).toBe(false);
    expect(find(actions(), 'roll-forward').enabled!()).toBe(false);
    expect(find(actions({ isRolledBack: () => true }), 'roll-forward').enabled!()).toBe(true);
  });
  it('every tree key is distinct from the existing shortcuts', async () => {
    const { SHORTCUTS } = await import('./commands');
    const used = new Set(Object.values(SHORTCUTS).concat(['F', 'P', 'S', 'Q', 'E', 'V', 'Z']));
    for (const c of treeCommands(actions())) if (c.keys) expect(used.has(c.keys), c.keys).toBe(false);
  });
});

describe('treeKey', () => {
  it('Ctrl/Cmd+Y redoes', () => {
    const a = actions();
    expect(treeKey(key('y', { ctrlKey: true }), a, true)).toBe(true);
    expect(treeKey(key('Y', { metaKey: true }), a, true)).toBe(true);
    expect(a.redo).toHaveBeenCalledTimes(2);
    expect(treeKey(key('y', { ctrlKey: true, shiftKey: true }), a, true)).toBe(false);
  });
  it('Backspace deletes the selection, only when there is one', () => {
    const a = actions();
    expect(treeKey(key('Backspace'), a, true)).toBe(true);
    expect(a.deleteSelected).toHaveBeenCalled();
    const none = actions({ selected: () => [] });
    expect(treeKey(key('Backspace'), none, true)).toBe(false);
  });
  it('arrows turn the view by 15 degrees; Alt+arrow pans; not when a panel has the focus', () => {
    const a = actions();
    const px = orbitPixels(ORBIT_STEP_DEG);
    expect(px * 0.012 * (180 / Math.PI)).toBeCloseTo(15, 6);
    expect(treeKey(key('ArrowRight'), a, true)).toBe(true);
    expect(a.orbit).toHaveBeenCalledWith(px, 0);
    treeKey(key('ArrowUp'), a, true);
    expect(a.orbit).toHaveBeenLastCalledWith(0, -px);
    treeKey(key('ArrowLeft', { altKey: true }), a, true);
    expect(a.pan).toHaveBeenCalledWith(-40, 0);
    expect(treeKey(key('ArrowDown'), a, false)).toBe(false);
  });
  it('is silent while sketching and with no document', () => {
    expect(treeKey(key('ArrowLeft'), actions({ isSketching: () => true }), true)).toBe(false);
    expect(treeKey(key('y', { ctrlKey: true }), actions({ hasDocument: () => false }), true)).toBe(false);
  });
  it('Escape clears the selection first, and passes on when there was none', () => {
    expect(treeKey(key('Escape'), actions({ clearSelection: () => true }), true)).toBe(true);
    expect(treeKey(key('Escape'), actions({ clearSelection: () => false }), true)).toBe(false);
  });
});
