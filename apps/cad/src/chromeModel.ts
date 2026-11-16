// What chrome the layout draws, as pure rules over the (effective) workspace: nothing here is stored. The tool column's width and place
// follow from these rules on every render, so a reload, or switching a mode off and on, always brings the tools back.
import type { Workspace } from '@kit/store';
import type { Layout } from './layoutMode';

/** The side panel (outliner, features, editor) is out of the way: folded with the edge handle / `[`, or switched off in Settings. */
export const navHidden = (ws: Pick<Workspace, 'leftPanel' | 'leftCollapsed'>): boolean => ws.leftPanel === 'hidden' || ws.leftCollapsed;

/** How the tool column (Plasticity-style) is drawn:
 *  - `full`: labelled or two-icon-wide column, flush against the side panel's right edge (or the window edge when the panel is folded);
 *  - `compact`: one narrow column of icons, used while the side panel is hidden and the column is the ONLY tool surface (ribbon off);
 *  - `hidden`: the panel is hidden and the ribbon carries the tools, so the column goes with it;
 *  - `none`: the workspace has no tool column. */
export type RailMode = 'full' | 'compact' | 'hidden' | 'none';
export function railMode(ws: Pick<Workspace, 'toolRail' | 'ribbon' | 'leftPanel' | 'leftCollapsed'>, layout: Layout): RailMode {
  if (!ws.toolRail || layout === 'phone') return 'none';
  if (!navHidden(ws)) return 'full';
  return ws.ribbon === 'off' ? 'compact' : 'hidden';
}

/** The surfaces that carry the modelling tools right now. A phone always has its tool tray. */
export function toolSurfaces(ws: Pick<Workspace, 'toolRail' | 'ribbon' | 'leftPanel' | 'leftCollapsed'>, layout: Layout): Array<'ribbon' | 'rail' | 'tray'> {
  if (layout === 'phone') return ['tray'];
  const out: Array<'ribbon' | 'rail' | 'tray'> = [];
  if (ws.ribbon !== 'off') out.push('ribbon');
  if (railMode(ws, layout) === 'full' || railMode(ws, layout) === 'compact') out.push('rail');
  return out;
}

/** The small always-visible buttons that bring things back: the edge handle for the side panel (a phone has its bottom bar instead), and "Show tools" in the top bar
 *  while no tool surface is drawn (Minimal on a desktop). Undo and Redo are always drawn on a touch layout; see `undoRedoVisible`. */
export function restoreHandles(ws: Pick<Workspace, 'toolRail' | 'ribbon' | 'leftPanel' | 'leftCollapsed'>, layout: Layout): Array<'nav' | 'show-tools'> {
  const out: Array<'nav' | 'show-tools'> = [];
  if (layout !== 'phone') out.push('nav');
  if (toolSurfaces(ws, layout).length === 0) out.push('show-tools');
  return out;
}

/** Where Undo and Redo are always drawn: a tablet has its own card at the top left of the canvas (whatever the panels do, in a sketch too), a phone has them in its top bar, a desktop on the ribbon and in the tool column. */
export const undoRedoPlace = (layout: Layout): 'card' | 'top-bar' | 'ribbon' => (layout === 'tablet' ? 'card' : layout === 'phone' ? 'top-bar' : 'ribbon');
/** Whether the canvas-left undo card is drawn (a tablet). */
export const undoRedoVisible = (layout: Layout): boolean => undoRedoPlace(layout) === 'card';
