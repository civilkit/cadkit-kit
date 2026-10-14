// The Select tab's commands: pick modes beyond Face / Edge / Corner, the "select more like this" family, invert, none and box select.
import type { Command } from '@kit/ui';
import type { SelectionMode } from '@kit/store';
import { t } from '../i18n';
import { invertSelection, selectConnected, selectLoop, selectParallel, selectSimilar, selectTangent, type Result } from './actions';
import type { SelModel } from './model';

export interface SelectActions {
  model(): SelModel | null;
  selection(): string[];
  mode(): SelectionMode;
  hasDocument(): boolean;
  /** Put the result into the selection (and switch the pick mode when it differs). */
  apply(r: Result): void;
  clear(): void;
  setMode(m: SelectionMode): void;
  box: { isOn(): boolean; toggle(): void };
  notify(text: string, level?: 'info' | 'warn'): void;
}

type Op = (m: SelModel, sel: string[], mode: SelectionMode) => Result | null;

/** Why a "select more" command cannot run now, or null when it can. */
export function whyNot(id: string, mode: SelectionMode, sel: string[]): string | null {
  if (!sel.length) return t('select.need.selection');
  if (id === 'select-tangent' || id === 'select-parallel' || id === 'select-similar') return mode === 'face' || mode === 'edge' ? null : t('select.need.faceOrEdge');
  if (id === 'select-loop') return mode === 'face' || mode === 'edge' ? null : t('select.need.faceOrEdge');
  return null;
}

export function selectCommands(a: SelectActions): Command[] {
  const can = (id: string) => () => a.hasDocument() && !!a.model() && whyNot(id, a.mode(), a.selection()) === null;
  const more = (id: string, key: string, op: Op, keys?: string): Command => ({
    id, label: t('cmd.' + id), tab: 'Select', group: 'Pick', keys, enabled: can(id),
    run: () => {
      const m = a.model();
      if (!m) return;
      const r = op(m, a.selection(), a.mode());
      if (!r) { a.notify(t('select.none'), 'warn'); return; }
      a.apply(r);
      a.notify(t(key, { n: r.added }));
    },
  });
  return [
    { id: 'sel-body', label: t('cmd.sel-body'), tab: 'Select', group: 'Pick', keys: 'B', pressed: () => a.mode() === 'body', enabled: a.hasDocument, run: () => a.setMode('body') },
    { id: 'select-box', label: t('cmd.select-box'), tab: 'Select', group: 'Pick', keys: 'X', pressed: () => a.box.isOn(), enabled: a.hasDocument, run: () => a.box.toggle() },
    more('select-tangent', 'select.found', selectTangent),
    more('select-parallel', 'select.found', selectParallel),
    more('select-similar', 'select.found', selectSimilar),
    more('select-loop', 'select.found', selectLoop),
    more('select-connected', 'select.found', selectConnected),
    {
      id: 'select-invert', label: t('cmd.select-invert'), tab: 'Select', group: 'Pick', keys: 'Ctrl+I', enabled: () => a.hasDocument() && !!a.model(),
      run: () => { const m = a.model(); if (m) a.apply(invertSelection(m, a.selection(), a.mode())); },
    },
    { id: 'select-none', label: t('cmd.select-none'), tab: 'Select', group: 'Pick', keys: 'Ctrl+Shift+A', enabled: () => a.selection().length > 0, run: a.clear },
  ];
}
