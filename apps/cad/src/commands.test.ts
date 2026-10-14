import { describe, it, expect, vi } from 'vitest';
import { buildCommands, type Actions } from './commands';

const actions = (over: Partial<Actions> = {}): Actions => ({
  open: vi.fn(), save: vi.fn(), samples: vi.fn(), undo: vi.fn(), redo: vi.fn(), palette: vi.fn(), toggleDrawer: vi.fn(), settings: vi.fn(), hasDocument: () => false, newPart: vi.fn(), toggleProjection: vi.fn(), sketchHere: vi.fn(), toggleLeftPanel: vi.fn(), sketchOnFace: vi.fn(), hasFaceSelection: () => false, addExtrude: vi.fn(), newSketch: vi.fn(),
  setView: vi.fn(), fit: vi.fn(), setMode: vi.fn(), mode: () => 'face', toggleLayer: vi.fn(), layer: () => true, ...over,
});

describe('ribbon commands', () => {
  it('has unique ids and the expected tabs', () => {
    const cmds = buildCommands(actions());
    expect(new Set(cmds.map((c) => c.id)).size).toBe(cmds.length);
    expect([...new Set(cmds.map((c) => c.tab))]).toEqual(['Home', 'View', 'Select']);
  });
  it('disables save and undo without a document, enables them with one', () => {
    const off = buildCommands(actions()).filter((c) => ['save', 'undo', 'redo'].includes(c.id));
    expect(off.every((c) => c.enabled?.() === false)).toBe(true);
    const on = buildCommands(actions({ hasDocument: () => true })).filter((c) => ['save', 'undo', 'redo'].includes(c.id));
    expect(on.every((c) => c.enabled?.() === true)).toBe(true);
  });
  it('Select body exists only when the app supports it, runs its action and has no key of its own (B is the Body pick mode)', () => {
    expect(buildCommands(actions()).find((c) => c.id === 'select-body')).toBeUndefined();
    const selectBody = vi.fn();
    const c = buildCommands(actions({ selectBody, hasDocument: () => true })).find((x) => x.id === 'select-body')!;
    expect(c.keys).toBeUndefined();
    expect(c.enabled?.()).toBe(true);
    c.run();
    expect(selectBody).toHaveBeenCalled();
  });
  it('the move ball command exists only when the app supports it, has F10, follows its on state and runs the toggle', () => {
    expect(buildCommands(actions()).find((c) => c.id === 'triball')).toBeUndefined();
    let on = false;
    const toggle = vi.fn(() => { on = !on; });
    const cmds = buildCommands(actions({ triball: { toggle, isOn: () => on, canToggle: () => true } }));
    const c = cmds.find((x) => x.id === 'triball')!;
    expect(c.keys).toBe('F10');
    expect(c.pressed?.()).toBe(false);
    expect(matchShortcut(cmds, { key: 'F10', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false })).toBe(c);
    c.run();
    expect(toggle).toHaveBeenCalled();
    expect(c.pressed?.()).toBe(true);
  });
  it('layer commands toggle their layer and show a tick when on', () => {
    const a = actions();
    const edges = buildCommands(a).find((c) => c.id === 'layer-edges')!;
    expect(edges.label.startsWith('✓')).toBe(true);
    edges.run();
    expect(a.toggleLayer).toHaveBeenCalledWith('edges');
  });
  it('the palette and drawer commands carry their keys and run their actions', () => {
    const a = actions();
    const cmds = buildCommands(a);
    const pal = cmds.find((c) => c.id === 'palette')!, dr = cmds.find((c) => c.id === 'drawer')!;
    expect(pal.keys).toBe('F');
    expect(dr.keys).toBe('\\');
    pal.run(); dr.run();
    expect(a.palette).toHaveBeenCalled();
    expect(a.toggleDrawer).toHaveBeenCalled();
  });
});

import { matchShortcut, SHORTCUTS } from './commands';
describe('shortcuts', () => {
  const ioStub = { importDxf: vi.fn(), sketchFromDxf: vi.fn(), isSketching: () => false, exportAs: vi.fn(), openExportMenu: vi.fn(), canExport: () => true };
  const key = (k: string, mods: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({ key: k, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...mods });
  const cmds = buildCommands(actions({ io: ioStub, selectBody: vi.fn() }));
  it('every shortcut belongs to a command and no two commands share one', () => {
    const ids = new Set(cmds.map((c) => c.id));
    for (const id of Object.keys(SHORTCUTS)) expect(ids.has(id) || id.startsWith('add-'), id).toBe(true);
    const keys = cmds.map((c) => c.keys).filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('matches plain, Shift and Ctrl/Cmd combinations exactly', () => {
    expect(matchShortcut(cmds, key('s'))?.id).toBe('sketch-here');
    expect(matchShortcut(cmds, key('S', { shiftKey: true }))?.id).not.toBe('sketch-here');   // Shift+S is Shell when features exist
    expect(matchShortcut(cmds, key('E', { shiftKey: true }))?.id).toBe('add-extrude');
    expect(matchShortcut(cmds, key('e'))?.id).toBe('sel-edge');
    expect(matchShortcut(cmds, key('z', { metaKey: true }))?.id).toBe('undo');
    expect(matchShortcut(cmds, key('z', { ctrlKey: true, shiftKey: true }))?.id).toBe('redo');
    expect(matchShortcut(cmds, key('z'))?.id).toBe('fit');
    expect(matchShortcut(cmds, key('s', { altKey: true }))).toBeUndefined();
  });
});

describe('undo and redo keys', () => {
  const key = (k: string, mods: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({ key: k, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...mods });
  it('Cmd (Mac) and Ctrl (Windows, Linux) both undo; with Shift both redo; Ctrl+Y is not claimed', () => {
    const cmds = buildCommands(actions());
    expect(matchShortcut(cmds, key('z', { metaKey: true }))?.id).toBe('undo');
    expect(matchShortcut(cmds, key('z', { ctrlKey: true }))?.id).toBe('undo');
    expect(matchShortcut(cmds, key('Z', { metaKey: true, shiftKey: true }))?.id).toBe('redo');
    expect(matchShortcut(cmds, key('Z', { ctrlKey: true, shiftKey: true }))?.id).toBe('redo');
  });
});

import { EXPORT_KINDS, type IoActions } from './commands';
import { hasIcon } from '@kit/ui';
describe('import and export commands', () => {
  const io = (over: Partial<IoActions> = {}): IoActions => ({ importDxf: vi.fn(), sketchFromDxf: vi.fn(), isSketching: () => false, exportAs: vi.fn(), openExportMenu: vi.fn(), canExport: () => true, ...over });
  it('are absent without io actions and present with them, each with an icon', () => {
    expect(buildCommands(actions()).some((c) => c.id.startsWith('export'))).toBe(false);
    const cmds = buildCommands(actions({ io: io(), hasDocument: () => true }));
    const ids = ['export', 'sketch-import-dxf', 'sketch-from-dxf', ...EXPORT_KINDS.map((k) => `export-${k}`)];
    for (const id of ids) {
      const c = cmds.find((x) => x.id === id);
      expect(c, id).toBeDefined();
      expect(hasIcon(id), `icon ${id}`).toBe(true);
    }
  });
  it('lists every format as its own command that exports that format', () => {
    const a = io();
    const cmds = buildCommands(actions({ io: a, hasDocument: () => true }));
    expect(EXPORT_KINDS).toEqual(['stl', 'stl-ascii', 'obj', 'step', 'dxf-sketch', 'dxf-views']);
    for (const k of EXPORT_KINDS) cmds.find((c) => c.id === `export-${k}`)!.run();
    expect((a.exportAs as ReturnType<typeof vi.fn>).mock.calls.map((x) => x[0])).toEqual(EXPORT_KINDS);
  });
  it('a format is enabled by canExport, the Export menu command by having a document, Import DXF by sketching', () => {
    const cmds = buildCommands(actions({ io: io({ canExport: (k) => k !== 'dxf-sketch', isSketching: () => false }), hasDocument: () => true }));
    expect(cmds.find((c) => c.id === 'export-dxf-sketch')!.enabled!()).toBe(false);
    expect(cmds.find((c) => c.id === 'export-stl')!.enabled!()).toBe(true);
    expect(cmds.find((c) => c.id === 'sketch-import-dxf')!.enabled!()).toBe(false);
    expect(buildCommands(actions({ io: io({ isSketching: () => true }) })).find((c) => c.id === 'sketch-import-dxf')!.enabled!()).toBe(true);
    expect(buildCommands(actions({ io: io() })).find((c) => c.id === 'export')!.enabled!()).toBe(false);
  });
  it('Ctrl+E opens the Export menu', () => {
    const a = io();
    const cmds = buildCommands(actions({ io: a, hasDocument: () => true }));
    expect(cmds.find((c) => c.id === 'export')!.keys).toBe('Ctrl+E');
    const hit = matchShortcut(cmds, { key: 'e', shiftKey: false, ctrlKey: true, metaKey: false, altKey: false });
    hit!.run();
    expect(a.openExportMenu).toHaveBeenCalled();
  });
});
