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
  const key = (k: string, mods: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({ key: k, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...mods });
  const cmds = buildCommands(actions());
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
