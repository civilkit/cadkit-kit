// Commands for the history tree and the model: rename, delete, suppress, rebuild, select all, roll forward, and
// the keys that have no command (Ctrl+Y, Backspace, arrows). The handlers come in through `TreeActions`, so this file
// has no DOM or kernel code; main.tsx builds the actions.
import type { Command } from '@kit/ui';
import { t } from './i18n';

export interface TreeActions {
  isSketching(): boolean;
  hasDocument(): boolean;
  /** Features selected in the tree. */
  selected(): string[];
  rename(): void;
  deleteSelected(): void;
  suppressSelected(): void;
  rebuild(): void;
  selectAll(): void;
  rollForward(): void;
  isRolledBack(): boolean;
  redo(): void;
  /** Clear the selection (tree and model). False when nothing was selected. */
  clearSelection(): boolean;
  orbit(dx: number, dy: number): void;
  pan(dx: number, dy: number): void;
}

export function treeCommands(a: TreeActions): Command[] {
  const idle = () => a.hasDocument() && !a.isSketching();
  return [
    { id: 'rename', label: t('cmd.rename'), tab: 'Home', group: 'Edit', keys: 'F2', enabled: idle, run: a.rename },
    { id: 'delete-feature', label: t('cmd.delete-feature'), tab: 'Home', group: 'Edit', keys: 'Delete', enabled: () => idle() && a.selected().length > 0, run: a.deleteSelected },
    { id: 'suppress-selected', label: t('cmd.suppress-selected'), tab: 'Home', group: 'Edit', keys: 'Ctrl+Shift+U', enabled: () => idle() && a.selected().length > 0, run: a.suppressSelected },
    { id: 'rebuild', label: t('cmd.rebuild'), tab: 'Home', group: 'Edit', keys: 'Ctrl+B', enabled: idle, run: a.rebuild },
    { id: 'roll-forward', label: t('cmd.roll-forward'), tab: 'Home', group: 'Edit', enabled: () => idle() && a.isRolledBack(), run: a.rollForward },
    { id: 'select-all', label: t('cmd.select-all'), tab: 'Select', group: 'Pick', keys: 'Ctrl+A', enabled: idle, run: a.selectAll },
  ];
}

/** Degrees the arrow keys turn the view. */
export const ORBIT_STEP_DEG = 15;
/** Pixels an Alt+arrow pans. */
export const PAN_STEP_PX = 40;
/** The viewport turns `0.012` radians per pixel of drag (see Viewport.orbitBy). */
const RAD_PER_PX = 0.012;
export const orbitPixels = (deg: number): number => (deg * Math.PI) / 180 / RAD_PER_PX;

export type KeyLike = { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean };

/** Keys that are not a single command's shortcut. `onCanvas` is true when the key press is not aimed at a field, button
 *  or panel. Returns true when the key was used (the caller then calls preventDefault). */
export function treeKey(e: KeyLike, a: TreeActions, onCanvas: boolean): boolean {
  if (a.isSketching() || !a.hasDocument()) return false;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'y') { a.redo(); return true; }
  if (!ctrl && !e.shiftKey && !e.altKey && e.key === 'Backspace' && a.selected().length) { a.deleteSelected(); return true; }
  if (e.key === 'Escape' && !ctrl && !e.altKey && a.clearSelection()) return true;
  const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (arrow && onCanvas && !ctrl && !e.shiftKey) {
    if (e.altKey) a.pan(arrow[0] * PAN_STEP_PX, arrow[1] * PAN_STEP_PX);
    else a.orbit(arrow[0] * orbitPixels(ORBIT_STEP_DEG), arrow[1] * orbitPixels(ORBIT_STEP_DEG));
    return true;
  }
  return false;
}
