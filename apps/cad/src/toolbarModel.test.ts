import { describe, it, expect } from 'vitest';
import { resolveLayout } from '@kit/ui';
import { buildCommands } from './commands';
import { fullActions } from './testActions';
import { RIBBON_LAYOUT, RAIL_SECTIONS, SLOTS, notOnRail } from './toolbarModel';
import { contextIds } from './ToolRail';
import { MENU_COMMANDS } from './menuModel';

const cmds = buildCommands(fullActions());
const ids = new Set(cmds.map((c) => c.id));
const idsOf = (entries: Array<string | { ids: string[] }>) => entries.flatMap((e) => (typeof e === 'string' ? [e] : e.ids));

describe('toolbar model', () => {
  it('every slot lists only commands that exist, with no duplicates inside a slot', () => {
    for (const [slot, list] of Object.entries(SLOTS)) {
      expect(list.filter((id) => !ids.has(id)), slot).toEqual([]);
      expect(new Set(list).size, slot).toBe(list.length);
    }
  });
  it('the ribbon layout places every command exactly once and names no command that does not exist', () => {
    const placed = Object.values(RIBBON_LAYOUT).flatMap((gs) => gs.flatMap((g) => idsOf(g.entries)));
    expect(placed.filter((id) => !ids.has(id))).toEqual([]);
    expect([...ids].filter((id) => !placed.includes(id))).toEqual([]);
    expect(placed.filter((id, i) => placed.indexOf(id) !== i)).toEqual([]);
    // resolving adds nothing: no group is made up from leftovers
    const resolved = resolveLayout(cmds, RIBBON_LAYOUT);
    expect(Object.keys(resolved)).toEqual(Object.keys(RIBBON_LAYOUT));
  });
  it('each ribbon tab stays small enough for one row: at most 24 buttons', () => {
    for (const [tab, gs] of Object.entries(RIBBON_LAYOUT)) expect(gs.reduce((n, g) => n + g.entries.length, 0), tab).toBeLessThanOrEqual(24);
  });
  it('the tool palette reaches every command except the file, export, camera and display ones', () => {
    const onRail = RAIL_SECTIONS.flatMap((s) => idsOf(s.entries));
    expect(onRail.filter((id) => !ids.has(id))).toEqual([]);
    expect([...ids].filter((id) => !notOnRail(id) && !onRail.includes(id))).toEqual([]);
    expect(onRail.filter((id, i) => onRail.indexOf(id) !== i)).toEqual([]);
  });
  it('the For selection list is the right-click list without the selection helpers, and empty for nothing selected', () => {
    expect(contextIds('face')).toEqual(['sketch-on-face', 'add-hole', 'add-shell', 'add-lpattern', 'add-cpattern']);
    expect(contextIds('edge')).toEqual(['add-fillet', 'add-chamfer']);
    for (const k of ['face', 'edge', 'corner', 'body'] as const) for (const id of contextIds(k)) expect(MENU_COMMANDS[k]).toContain(id);
  });
});
