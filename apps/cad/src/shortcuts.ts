// The keyboard shortcut cheat sheet's data. Nothing here is a hand-written list of the common shortcuts: the rows are read from the
// tables the app itself runs on (the command table's `keys` and SHORTCUTS in commands.ts, the sketch tool registry's keys), so a key
// added there shows up here. Only keys that are handled in code with no table behind them (arrows, Esc, Enter, the tab keys) are
// listed in FIXED_SHORTCUTS below; the test in shortcuts.test.ts fails if a table entry is missing from the sheet.
import type { Command } from '@kit/ui';
import { sketchTools } from '@kit/sketch';
import { SHORTCUTS } from './commands';
import { t } from './i18n';

export type ShortcutGroupId = 'general' | 'view' | 'sketch' | 'model';
export const SHORTCUT_GROUPS: ShortcutGroupId[] = ['general', 'view', 'sketch', 'model'];

export interface ShortcutRow { id: string; label: string; keys: string; group: ShortcutGroupId }

/** Keys handled in code rather than through a table (main.tsx's key handlers, treeCommands.ts `treeKey`). `label` is a catalogue key. */
export const FIXED_SHORTCUTS: { id: string; keys: string; group: ShortcutGroupId; label: string }[] = [
  { id: 'sheet', keys: '?', group: 'general', label: 'shortcuts.fixed.sheet' },
  { id: 'help', keys: 'F1', group: 'general', label: 'shortcuts.fixed.help' },
  { id: 'redo-y', keys: 'Ctrl+Y', group: 'general', label: 'shortcuts.fixed.redoY' },
  { id: 'repeat', keys: 'Enter', group: 'general', label: 'shortcuts.fixed.repeat' },
  { id: 'escape', keys: 'Esc', group: 'general', label: 'shortcuts.fixed.escape' },
  { id: 'tab-next', keys: 'Ctrl+Tab', group: 'general', label: 'shortcuts.fixed.tabNext' },
  { id: 'tab-prev', keys: 'Ctrl+Shift+Tab', group: 'general', label: 'shortcuts.fixed.tabPrev' },
  { id: 'tab-jump', keys: 'Ctrl+Alt+1..9', group: 'general', label: 'shortcuts.fixed.tabJump' },
  { id: 'tab-new', keys: 'Ctrl+Alt+T', group: 'general', label: 'shortcuts.fixed.tabNew' },
  { id: 'tab-close', keys: 'Ctrl+Alt+W', group: 'general', label: 'shortcuts.fixed.tabClose' },
  { id: 'orbit', keys: 'Arrows', group: 'view', label: 'shortcuts.fixed.orbit' },
  { id: 'pan', keys: 'Alt+Arrows', group: 'view', label: 'shortcuts.fixed.pan' },
  { id: 'zoom-in', keys: '+', group: 'view', label: 'shortcuts.fixed.zoomIn' },
  { id: 'zoom-out', keys: '-', group: 'view', label: 'shortcuts.fixed.zoomOut' },
  { id: 'zoom-page', keys: 'PageUp / PageDown', group: 'view', label: 'shortcuts.fixed.zoomPage' },
  { id: 'delete-selected', keys: 'Backspace', group: 'model', label: 'shortcuts.fixed.deleteSelected' },
  { id: 'sketch-look-normal', keys: 'N', group: 'sketch', label: 'app.sketch.lookNormal' },
  { id: 'sketch-constraints', keys: 'Shift+C', group: 'sketch', label: 'shortcuts.fixed.sketchConstraints' },
  { id: 'sketch-select-all', keys: 'Ctrl+A', group: 'sketch', label: 'shortcuts.fixed.sketchSelectAll' },
  { id: 'sketch-delete', keys: 'Delete', group: 'sketch', label: 'shortcuts.fixed.sketchDelete' },
  { id: 'sketch-type-point', keys: 'Tab', group: 'sketch', label: 'shortcuts.fixed.sketchTab' },
  { id: 'sketch-edit-dim', keys: 'Enter / F2', group: 'sketch', label: 'shortcuts.fixed.sketchEditDim' },
  { id: 'sketch-leave-tool', keys: 'Esc', group: 'sketch', label: 'shortcuts.fixed.sketchEsc' },
];

const VIEW_IDS = new Set(['fit', 'toggle-projection', 'toggle-up-axis', 'toggle-left-panel', 'drawer']);

/** The group a command id belongs in. */
export function groupOf(id: string): ShortcutGroupId {
  if (id.startsWith('layer-') || id.startsWith('view-') || VIEW_IDS.has(id)) return 'view';
  if (id.startsWith('sketch')) return 'sketch';
  if (id.startsWith('add-') || id.startsWith('sel-') || id.startsWith('select') || id === 'open-catalog' || id === 'triball') return 'model';
  return 'general';
}

function labelOf(id: string, cmd: Command | undefined): string {
  if (cmd) return cmd.label.replace(/^✓ /, '');
  if (id.startsWith('layer-')) return t('layer.' + id.slice(6));
  return t('cmd.' + id);
}

/** Every shortcut the app has, in one list: the command table (what is built right now), the SHORTCUTS table (even for a command not built in this
 *  session), the sketch tool keys, and the keys handled in code. */
export function shortcutRows(commands: Command[] = []): ShortcutRow[] {
  const byId = new Map(commands.map((c) => [c.id, c]));
  const rows = new Map<string, ShortcutRow>();
  const add = (id: string, keys: string, group: ShortcutGroupId, label: string) => { if (!rows.has(id)) rows.set(id, { id, label, keys, group }); };
  for (const c of commands) if (c.keys) add(c.id, c.keys, groupOf(c.id), labelOf(c.id, c));
  for (const [id, keys] of Object.entries(SHORTCUTS)) add(id, keys, groupOf(id), labelOf(id, byId.get(id)));
  for (const x of sketchTools()) if (x.key) add('sketch-tool-' + x.id, x.key.toUpperCase(), 'sketch', t('app.sketch.tool.' + x.id));
  for (const f of FIXED_SHORTCUTS) add(f.id, f.keys, f.group, t(f.label));
  return [...rows.values()];
}

export interface ShortcutSection { group: ShortcutGroupId; title: string; rows: ShortcutRow[] }

/** The rows that match a search (every word must be in the name, the keys or the group's title), grouped in sheet order; empty groups are left out. */
export function shortcutSections(rows: ShortcutRow[], query = ''): ShortcutSection[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return SHORTCUT_GROUPS.map((group) => {
    const title = t('shortcuts.group.' + group);
    const mine = rows.filter((r) => r.group === group && terms.every((w) => `${r.label} ${r.keys} ${title}`.toLowerCase().includes(w)));
    return { group, title, rows: mine };
  }).filter((s) => s.rows.length > 0);
}
