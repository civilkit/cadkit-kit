import { describe, it, expect, vi } from 'vitest';
import { buildCommands, SHORTCUTS, type Actions } from './commands';
import { sketchTools } from '@kit/sketch';
import { FIXED_SHORTCUTS, SHORTCUT_GROUPS, shortcutRows, shortcutSections } from './shortcuts';

const actions = (over: Partial<Actions> = {}): Actions => ({
  open: vi.fn(), save: vi.fn(), samples: vi.fn(), undo: vi.fn(), redo: vi.fn(), palette: vi.fn(), toggleDrawer: vi.fn(), settings: vi.fn(), hasDocument: () => true, newPart: vi.fn(), toggleProjection: vi.fn(), sketchHere: vi.fn(), sketchOnFace: vi.fn(), hasFaceSelection: () => false, addExtrude: vi.fn(), newSketch: vi.fn(), toggleLeftPanel: vi.fn(),
  setView: vi.fn(), fit: vi.fn(), setMode: vi.fn(), mode: () => 'face', toggleLayer: vi.fn(), layer: () => true, selectBody: vi.fn(), triball: { toggle: vi.fn(), isOn: () => false, canToggle: () => true }, catalog: vi.fn(), shortcuts: vi.fn(), ...over,
} as unknown as Actions);

const all = (cmds = buildCommands(actions())) => shortcutSections(shortcutRows(cmds)).flatMap((s) => s.rows);

describe('shortcut cheat sheet', () => {
  it('lists every key of the command table, the SHORTCUTS table, the sketch tools and the fixed keys', () => {
    const cmds = buildCommands(actions());
    const rows = all(cmds);
    const keyed = cmds.filter((c) => c.keys);
    expect(keyed.length).toBeGreaterThan(10);
    for (const c of keyed) expect(rows.find((r) => r.id === c.id)?.keys, 'command ' + c.id).toBe(c.keys);
    for (const [id, keys] of Object.entries(SHORTCUTS)) expect(rows.find((r) => r.id === id)?.keys, 'SHORTCUTS ' + id).toBe(keys);
    const toolKeys = sketchTools().filter((x) => x.key);
    expect(toolKeys.length).toBeGreaterThan(5);
    for (const x of toolKeys) expect(rows.find((r) => r.id === 'sketch-tool-' + x.id)?.keys, 'tool ' + x.id).toBe(x.key!.toUpperCase());
    for (const f of FIXED_SHORTCUTS) expect(rows.some((r) => r.id === f.id), 'fixed ' + f.id).toBe(true);
  });
  it('a key added to the command table shows up without touching the sheet', () => {
    const cmds = buildCommands(actions());
    cmds.push({ id: 'zz-new', label: 'Brand new', tab: 'Home', group: 'Edit', keys: 'Ctrl+Q', run: () => {} });
    expect(all(cmds).find((r) => r.id === 'zz-new')?.keys).toBe('Ctrl+Q');
  });
  it('every row has a readable label, keys and one of the four groups', () => {
    for (const r of all()) {
      expect(r.label, r.id).toBeTruthy();
      expect(r.label, r.id).not.toMatch(/^(cmd|shortcuts|app)\./);
      expect(r.keys).toBeTruthy();
      expect(SHORTCUT_GROUPS).toContain(r.group);
    }
    expect(shortcutSections(shortcutRows(buildCommands(actions()))).map((s) => s.title)).toEqual(['General', 'View', 'Sketch tools', 'Modelling']);
  });
  it('no two rows share an id, and the same key is not given to two commands in one group', () => {
    const rows = all();
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });
  it('search matches the name, the key and the group, and a miss leaves no section', () => {
    const rows = shortcutRows(buildCommands(actions()));
    expect(shortcutSections(rows, 'undo').flatMap((s) => s.rows).some((r) => r.id === 'undo')).toBe(true);
    expect(shortcutSections(rows, 'ctrl+s').flatMap((s) => s.rows).some((r) => r.id === 'save')).toBe(true);
    expect(shortcutSections(rows, 'sketch tools').map((s) => s.group)).toEqual(['sketch']);
    expect(shortcutSections(rows, 'zzzz-nothing')).toEqual([]);
  });
});
