import { describe, it, expect } from 'vitest';
import { resolveLayout } from '@kit/ui';
import { buildCommands } from './commands';
import { fullActions } from './testActions';
import { PLANNED, RIBBON_LAYOUT, RAIL_SECTIONS, SLOTS, notOnRail, isFileCommand, SKETCH_TAB, docKindOf, activeRibbonTab, tabForKindChange, MODEL_COMMANDS, idleDuringEdit, sketchChrome } from './toolbarModel';
import { contextIds } from './ToolRail';
import { MENU_COMMANDS } from './menuModel';

const cmds = buildCommands(fullActions());
const ids = new Set(cmds.map((c) => c.id));
const idsOf = (entries: Array<string | { ids: string[] } | { node: unknown }>) => entries.flatMap((e) => (typeof e === 'string' ? [e] : 'ids' in e ? e.ids : []));

describe('toolbar model', () => {
  it('every slot lists only commands that exist, with no duplicates inside a slot', () => {
    for (const [slot, list] of Object.entries(SLOTS)) {
      expect(list.filter((id) => !ids.has(id) && !PLANNED.includes(id)), slot).toEqual([]);
      expect(new Set(list).size, slot).toBe(list.length);
    }
  });
  it('the ribbon layout places every command exactly once and names no command that does not exist', () => {
    const placed = Object.values(RIBBON_LAYOUT).flatMap((gs) => gs.flatMap((g) => idsOf(g.entries)));
    expect(placed.filter((id) => !ids.has(id) && !PLANNED.includes(id))).toEqual([]);
    expect([...ids].filter((id) => !placed.includes(id) && !isFileCommand(id))).toEqual([]);
    expect(placed.filter((id, i) => placed.indexOf(id) !== i)).toEqual([]);
    // resolving adds nothing: no group is made up from leftovers
    const resolved = resolveLayout(cmds, RIBBON_LAYOUT, new Set([...ids].filter(isFileCommand)));
    expect(Object.keys(resolved)).toEqual(Object.keys(RIBBON_LAYOUT));
  });
  it('the reserved thin-wall ids have icons and sit in the Create groups of the ribbon and the palette', async () => {
    const { hasIcon } = await import('@kit/ui');
    for (const id of PLANNED) expect(hasIcon(id), id).toBe(true);
    expect(JSON.stringify(RIBBON_LAYOUT.Home)).toContain('add-thin-cut');
    expect(JSON.stringify(RAIL_SECTIONS)).toContain('add-thin-cut');
  });
  it('each ribbon tab stays small enough for one row: at most 24 buttons', () => {
    for (const [tab, gs] of Object.entries(RIBBON_LAYOUT)) expect(gs.reduce((n, g) => n + g.entries.length, 0), tab).toBeLessThanOrEqual(24);
  });
  it('the tool palette reaches every command except the file, export, camera and display ones', () => {
    const onRail = RAIL_SECTIONS.flatMap((s) => idsOf(s.entries));
    expect(onRail.filter((id) => !ids.has(id) && !PLANNED.includes(id))).toEqual([]);
    expect([...ids].filter((id) => !notOnRail(id) && !onRail.includes(id))).toEqual([]);
    expect(onRail.filter((id, i) => onRail.indexOf(id) !== i)).toEqual([]);
  });
  it('the For selection list is the right-click list without the selection helpers, and empty for nothing selected', () => {
    expect(contextIds('face')).toEqual(['sketch-on-face', 'add-hole', 'add-shell', 'add-fillet', 'add-chamfer', 'add-lpattern', 'add-cpattern']);
    expect(contextIds('edge')).toEqual(['add-fillet', 'add-chamfer']);
    for (const k of ['face', 'edge', 'corner', 'body'] as const) for (const id of contextIds(k)) expect(MENU_COMMANDS[k]).toContain(id);
  });
});

describe('contextual ribbon', () => {
  it('file actions are in the top bar only: no File or Export group on any tab', () => {
    const groups = Object.values(RIBBON_LAYOUT).flatMap((gs) => gs.map((g) => g.id));
    expect(groups).not.toContain('File');
    expect(groups).not.toContain('Export');
    const placed = Object.values(RIBBON_LAYOUT).flatMap((gs) => gs.flatMap((g) => idsOf(g.entries)));
    expect(placed.filter(isFileCommand)).toEqual([]);
    const resolved = resolveLayout(cmds, RIBBON_LAYOUT, new Set([...ids].filter(isFileCommand)));
    expect(Object.values(resolved).flatMap((gs) => gs.flatMap((g) => idsOf(g.entries))).filter(isFileCommand)).toEqual([]);
  });
  it('Home carries the model commands: sketch, extrude, revolve, sweep and loft, fillet, shell, pattern, undo/redo', () => {
    const home = JSON.stringify(RIBBON_LAYOUT.Home);
    for (const id of ['sketch-here', 'add-extrude', 'add-revolve', 'add-loft', 'add-fillet', 'add-shell', 'add-lpattern', 'undo', 'redo', 'rebuild']) expect(home, id).toContain(id);
  });
  it('Frame is its own top-level ribbon tab and palette section, not part of the Loft menu', () => {
    expect(idsOf(RIBBON_LAYOUT.Frame.flatMap((g) => g.entries))).toEqual(['add-frame', 'frame-cutlist']);
    expect(RAIL_SECTIONS.find((s) => s.id === 'frame')).toBeTruthy();
    expect(SLOTS['loft-sweep']).toEqual(['add-loft', 'add-sweep']);
    expect(MODEL_COMMANDS.has('add-frame')).toBe(true);
  });
  it('entering a sketch selects the Sketch tab and leaving restores the tab the user was on', () => {
    expect(activeRibbonTab('Surfaces', false)).toBe('Surfaces');
    expect(activeRibbonTab('Surfaces', true)).toBe(SKETCH_TAB);
    expect(activeRibbonTab('Surfaces', false)).toBe('Surfaces');
  });
  it('document kind: inserted components make an assembly, which selects the Assembly tab; a part leaves it', () => {
    expect(docKindOf(null)).toBe('part');
    expect(docKindOf({ features: [{ type: 'sketch' }] })).toBe('part');
    expect(docKindOf({ features: [{ type: 'insertPart' }] })).toBe('assembly');
    expect(tabForKindChange(null, 'assembly', 'Home')).toBe('Assembly');
    expect(tabForKindChange('assembly', 'assembly', 'View')).toBe('View');
    expect(tabForKindChange('part', 'part', 'View')).toBe('View');
    expect(tabForKindChange('assembly', 'part', 'Assembly')).toBe('Home');
    expect(tabForKindChange('assembly', 'part', 'View')).toBe('View');
  });
  it('a feature editor greys the model commands but not undo, redo or the view', () => {
    expect(idleDuringEdit('add-extrude')).toBe(true);
    expect(idleDuringEdit('sketch-here')).toBe(true);
    for (const id of ['undo', 'redo', 'fit', 'view-iso', 'measure']) expect(idleDuringEdit(id), id).toBe(false);
    expect(MODEL_COMMANDS.size).toBeGreaterThan(20);
  });
});

describe('sketch-mode chrome per preset', () => {
  const ws = (ribbon: string, toolRail: boolean, sketchPalette = false) => ({ ribbon, toolRail, sketchPalette });
  it('ribbon preset: the Sketch tab carries the tools, no right palette, the left column (if on) keeps only undo / redo / rebuild', () => {
    expect(sketchChrome(ws('full', false), true)).toEqual({ ribbonTab: true, leftColumn: 'none', rightPalette: false, bar: false });
    expect(sketchChrome(ws('full', true), true).leftColumn).toBe('history');
  });
  it('the Tool palette setting brings the right palette back in a ribbon preset', () => {
    expect(sketchChrome(ws('full', false, true), true).rightPalette).toBe(true);
  });
  it('Plasticity (ribbon off, left column on): the column swaps to the sketch tools, no right palette, no ribbon tab', () => {
    expect(sketchChrome(ws('off', true), true)).toEqual({ ribbonTab: false, leftColumn: 'sketch', rightPalette: false, bar: true });
  });
  it('the floating bar is drawn only when the ribbon is off', () => {
    for (const r of ['full', 'compact']) for (const rail of [true, false]) expect(sketchChrome(ws(r, rail), true).bar, r).toBe(false);
    for (const rail of [true, false]) expect(sketchChrome(ws('off', rail), true).bar).toBe(true);
  });
  it('Minimal (ribbon off, no column): the floating palette is the only home of the tools', () => {
    expect(sketchChrome(ws('off', false), true)).toEqual({ ribbonTab: false, leftColumn: 'none', rightPalette: true, bar: true });
  });
  it('outside a sketch the column is the model column and there is no bar', () => {
    expect(sketchChrome(ws('off', true), false)).toEqual({ ribbonTab: false, leftColumn: 'model', rightPalette: false, bar: false });
  });
});

describe('extrude button', () => {
  it('does not remember the last extrude: the Create tab and the rail always show Extrude', () => {
    const find = (entries: unknown[]) => entries.find((x) => typeof x === 'object' && x && (x as { slot?: string }).slot === 'extrude') as { fixed?: boolean } | undefined;
    const ribbon = find(RIBBON_LAYOUT.Home.flatMap((g) => g.entries));
    const rail = find(RAIL_SECTIONS.flatMap((g) => g.entries));
    expect(ribbon?.fixed).toBe(true);
    expect(rail?.fixed).toBe(true);
  });
});
