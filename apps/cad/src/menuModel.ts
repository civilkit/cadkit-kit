// What the right-click menu on the canvas lists. Pure: the selection kind, the command registry and the handle gesture
// that the selection offers go in; the menu rows come out. Running a row runs the registry command, so the menu never
// has behaviour of its own and shows the same shortcuts and enabled rules as the ribbon and the palette.
import { BODY } from '@kit/store';
import { isBodyName } from './select/model';
import type { Command } from '@kit/ui';
import type { GestureKind } from './handles/session';
import { t } from './i18n';

export type SelectionKind = 'none' | 'face' | 'edge' | 'corner' | 'body';

export function selectionKind(selection: string[], mode: string): SelectionKind {
  if (selection.includes(BODY) || (selection.length > 0 && selection.every(isBodyName))) return 'body';
  if (!selection.length) return 'none';
  if (mode === 'vertex' || selection.every((n) => n.startsWith('v:'))) return 'corner';
  if (mode === 'edge') return 'edge';
  return 'face';
}

/** Command ids per selection kind, in menu order; `-` is a separator. */
export const MENU_COMMANDS: Record<SelectionKind, string[]> = {
  edge: ['add-fillet', 'add-chamfer', '-', 'show-in-tree', '-', 'select-tangent', 'select-parallel', 'select-similar', 'select-loop', 'select-connected', '-', 'select-invert', 'select-none'],
  corner: ['add-fillet', 'add-chamfer', '-', 'select-invert', 'select-none'],
  face: ['sketch-on-face', 'add-hole', 'add-shell', '-', 'add-lpattern', 'add-cpattern', '-', 'show-in-tree', '-', 'select-tangent', 'select-parallel', 'select-similar', 'select-loop', 'select-connected', '-', 'select-invert', 'select-none'],
  body: ['select-body', '-', 'move-body', '-', 'add-lpattern', 'add-cpattern', 'add-shell', '-', 'select-invert', 'select-none'],
  none: ['sketch-new-front', 'sketch-new-top', 'sketch-new-right', '-', 'add-extrude', 'add-cut', '-', 'select-body', 'select-all', 'select-invert', '-', 'fit'],
};

export interface MenuItem {
  id: string;
  label: string;
  keys?: string;
  enabled: boolean;
  /** Why a row is disabled (shown as its tooltip). */
  reason?: string;
  separator?: boolean;
}

/** The text line under the rows that tells which drag gesture the selection offers, or null. */
export function gestureHint(kind: GestureKind | null): string | null {
  switch (kind) {
    case 'round-new': return t('ctx.hint.round');
    case 'round-edit': return t('ctx.hint.roundEdit');
    case 'extrude-depth': return t('ctx.hint.depth');
    case 'shell-thickness': return t('ctx.hint.thickness');
    case 'hole-diameter': return t('ctx.hint.diameter');
    default: return null;
  }
}

/** `placementOn`: the kernel can move bodies. Without it the Move body row is listed but disabled with the reason. */
export function menuItems(kind: SelectionKind, commands: Command[], placementOn: boolean, why?: (id: string) => string | null): MenuItem[] {
  const byId = new Map(commands.map((c) => [c.id, c]));
  const out: MenuItem[] = [];
  for (const id of MENU_COMMANDS[kind]) {
    if (id === '-') { if (out.length && !out[out.length - 1].separator) out.push({ id: '-', label: '', enabled: false, separator: true }); continue; }
    if (id === 'move-body') { out.push({ id, label: t('cmd.move-body'), enabled: placementOn, reason: placementOn ? undefined : t('ctx.unsupported.moveBody') }); continue; }
    const c = byId.get(id);
    if (!c) continue;
    const enabled = c.enabled?.() ?? true;
    out.push({ id, label: c.label, keys: c.keys, enabled, ...(!enabled && why?.(id) ? { reason: why(id)! } : {}) });
  }
  while (out.length && out[out.length - 1].separator) out.pop();
  return out;
}
