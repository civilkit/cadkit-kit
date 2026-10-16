// The history tree's behaviour for the app: multi-select, rename, delete with an Undo toast, suppress, the rollback
// marker, dependency marks, select all, and the double-click on a face. The pure parts are in treeActions.ts and
// treeCommands.ts; this hook only wires them to the controller, the store and the viewport.
import { useRef, useState } from 'preact/hooks';
import type { EditOp } from '@ck/session';
import type { Store } from '@kit/store';
import type { Controller } from './controller';
import { t } from './i18n';
import { isShapeFeature } from './handles/sizeBox';
import { dependentsOf, faceOwner, nextSelection, renameOps, suppressOps } from './treeActions';
import type { TreeActions } from './treeCommands';

interface ViewportLike { orbitBy(dx: number, dy: number): void; panBy(dx: number, dy: number): void }

export interface TreeInteractionDeps {
  controller: Controller;
  store: Store;
  viewport(): ViewportLike | null;
  selectedId: string | null;
  setSelectedId(id: string | null): void;
  setRefSel(id: string | null): void;
  redraw(): void;
  /** Run edit ops through the app's edit path (busy state, timing, redraw). */
  edit(ops: EditOp[]): Promise<void>;
  startEditing(id: string): void;
}

export function useTreeInteraction(d: TreeInteractionDeps) {
  const [multi, setMulti] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [topRename, setTopRename] = useState(false);
  const doc = d.controller.document();
  const feats = (doc?.features ?? []) as unknown as Array<{ id: string; [k: string]: unknown }>;
  const ids = feats.map((f) => f.id);
  /** The features selected in the tree: the clicked one, plus any added with Ctrl/Shift. */
  const selected = (): string[] => (d.selectedId && ids.includes(d.selectedId) ? (multi.includes(d.selectedId) ? multi.filter((x) => ids.includes(x)) : [d.selectedId]) : []);
  const sel = selected();

  const dependents = [...new Set(sel.flatMap((id) => dependentsOf(feats, id)))].filter((x) => !sel.includes(x));

  const select = (id: string, mods?: { ctrl: boolean; shift: boolean }) => {
    const r = nextSelection(sel, anchor.current, id, ids, mods ?? {});
    anchor.current = r.anchor;
    setMulti(r.selection);
    d.setSelectedId(r.selection.includes(id) ? id : r.selection.at(-1) ?? null);
    d.setRefSel(null);   // a feature row and a Front / Top / Right row are never both 'the' selection (the Plane tool reads one base)
    // a shape row selects the SHAPE: the faces picked before no longer stand in front of its size box
    if (r.selection.includes(id) && isShapeFeature(doc, id)) d.store.select([]);
  };
  const clearAll = (): boolean => {
    const any = d.store.selection.value.length > 0 || sel.length > 0;
    if (!any) return false;
    d.store.select([]); setMulti([]); d.setSelectedId(null); d.setRefSel(null); anchor.current = null;
    return true;
  };
  const deleteIds = async (list: string[]) => {
    if (!list.length) return;
    const r = await d.controller.deleteFeatures(list);
    d.redraw();
    if (r?.ok) {
      setMulti([]); d.setSelectedId(null);
      d.store.notify(t('app.notice.deleted', { names: list.join(', ') }), 'info', { label: t('app.notice.undo'), run: () => { void d.controller.undo().then(d.redraw); } });
    }
  };
  const suppressIds = (list: string[]) => d.edit(suppressOps(feats, list));
  /** A row's own button acts on the whole selection when the row is part of a multi-selection. */
  const group = (id: string): string[] => (sel.length > 1 && sel.includes(id) ? sel : [id]);

  const actions: TreeActions = {
    isSketching: () => !!d.controller.sketchDraft(),
    hasDocument: () => d.controller.document() !== null,
    selected: () => sel,
    rename: () => { if (sel.length === 1) setRenaming(sel[0]); else setTopRename(true); },
    deleteSelected: () => void deleteIds(sel),
    suppressSelected: () => void suppressIds(sel),
    rebuild: () => void d.controller.rebuild().then(() => { d.store.notify(t('app.notice.rebuilt')); d.redraw(); }),
    selectAll: () => d.store.select(d.controller.pickableNames(d.store.mode.value)),
    rollForward: () => void d.controller.setRollback(null).then(d.redraw),
    isRolledBack: () => d.controller.rollbackCount() !== null,
    redo: () => void d.controller.redo().then(d.redraw),
    clearSelection: clearAll,
    orbit: (dx, dy) => d.viewport()?.orbitBy(dx, dy),
    pan: (dx, dy) => d.viewport()?.panBy(dx, dy),
  };

  return {
    actions,
    selected: sel,
    /** Props for <FeatureTree>. */
    treeProps: {
      selectedIds: sel,
      dependents,
      onSelect: select,
      renaming,
      onRenamingChange: setRenaming,
      onRename: (id: string, name: string) => void d.edit(renameOps(id, name)),
      onRenamePart: (name: string) => { d.controller.setPartName(name); d.redraw(); },
      rollback: d.controller.rollbackCount(),
      onRollback: (count: number | null) => void d.controller.setRollback(count).then(d.redraw),
      onRemove: (id: string) => void deleteIds(group(id)),
      onToggleSuppress: (id: string) => void suppressIds(group(id)),
    },
    /** The part name in the top bar. */
    topRename: { active: topRename, begin: () => setTopRename(true), end: () => setTopRename(false), commit: (name: string) => { d.controller.setPartName(name); setTopRename(false); d.redraw(); } },
    /** A double click on a body face opens the editor of the feature that made it. */
    onBodyDouble: (face: string) => {
      const owner = faceOwner(face);
      if (!owner || !ids.includes(owner)) return;
      anchor.current = owner; setMulti([owner]); d.setSelectedId(owner);
      d.startEditing(owner);
    },
  };
}
