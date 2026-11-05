// The history tree's behaviour for the app: multi-select, rename, delete with an Undo toast, suppress, the rollback
// marker, dependency marks, select all, and the double-click on a face. The pure parts are in treeActions.ts and
// treeCommands.ts; this hook only wires them to the controller, the store and the viewport.
import { useRef, useState } from 'preact/hooks';
import type { EditOp } from '@ck/session';
import type { Store } from '@kit/store';
import type { FeatureRow, TreeDrop } from '@kit/ui';
import type { Controller } from './controller';
import { t } from './i18n';
import { isShapeFeature } from './handles/sizeBox';
import { dependentsOf, faceOwner, nextSelection, renameOps, suppressOps } from './treeActions';
import { folderToggleOps } from './historyFolder';
import type { TreeActions } from './treeCommands';
import type { MenuItem } from './menuModel';
import { dropPlan, folderIds, folderOf, groupPlan, patchOf, removeFromFolderPlan, renameFolderPlan, ungroupPlan, type Plan, type Refusal } from './treeFolders';

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
  /** The rows the tree shows (read when an action runs, so it may be built later in the render). */
  rows(): FeatureRow[];
  /** Write the geometry of a folder (the bodies its features made or changed) to a file. */
  exportFolder(name: string, ids: string[], format: 'step' | 'stl' | 'ckpart'): void;
  /** Open the folder's features as a part of its own in a new document. */
  extractFolder(name: string, ids: string[]): void;
}

/** The short message for a refused folder action. */
function refusal(r: Refusal, detail = ''): string {
  switch (r) {
    case 'needTwo': return t('app.folder.refuse.needTwo');
    case 'notContiguous': return t('app.folder.refuse.notContiguous');
    case 'order': return t('app.folder.refuse.order', { detail });
    case 'nameTaken': return t('app.folder.refuse.nameTaken', { detail });
    case 'nameEmpty': return t('app.folder.refuse.nameEmpty');
    case 'splits': return t('app.folder.refuse.splits', { detail });
    case 'noFolder': return t('app.folder.refuse.noFolder');
  }
}

export function useTreeInteraction(d: TreeInteractionDeps) {
  const [multi, setMulti] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [topRename, setTopRename] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[]; run(id: string): void } | null>(null);
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

  /** Run a folder plan as one edit (one undo step); a refused plan says why in a short notice. True when it went through. */
  const apply = async (plan: Plan): Promise<boolean> => {
    if (!plan.ok) { d.store.notify(refusal(plan.reason, plan.detail), 'warn'); return false; }
    if (plan.order) {   // a reorder: one document step (the session's single `move` ops cannot carry a sketch along)
      const r = await d.controller.applyDocPatch(patchOf(feats, plan), 'tree folders');
      d.redraw();
      return r.ok;
    }
    if (plan.ops.length) await d.edit(plan.ops);
    return true;
  };
  const groupInto = async (ids: string[]) => {
    const plan = groupPlan(d.rows(), feats, ids, t('app.folder.default'));
    if (!(await apply(plan)) || !plan.ok || plan.name === undefined) return;
    // the new folder asks for its name in place
    if ((d.controller.document()?.features ?? []).some((f) => (f as { group?: string }).group === plan.name)) setRenaming('@g:' + plan.name);
  };
  const renameFolder = (name: string, to: string) => void apply(renameFolderPlan(feats, name, to));
  const ungroup = (name: string) => void apply(ungroupPlan(feats, name));
  const removeFromFolder = (ids: string[]) => void apply(removeFromFolderPlan(d.rows(), feats, ids));
  const onDropOn = (drag: TreeDrop, target: TreeDrop) => void apply(dropPlan(d.rows(), feats, drag, target));
  const planText = (p: Plan): { enabled: boolean; reason?: string } => (p.ok ? { enabled: true } : { enabled: false, reason: refusal(p.reason, p.detail) });
  const openMenu = (target: TreeDrop, x: number, y: number) => {
    const rows = d.rows();
    if (target.kind === 'folder') {
      const name = target.name;
      setMenu({
        x, y,
        items: [
          { id: 'rename-folder', label: t('app.folder.menu.rename'), enabled: true },
          { id: 'ungroup', label: t('app.folder.menu.ungroup'), enabled: true },
          { id: '-', label: '', enabled: false, separator: true },
          { id: 'export-folder-step', label: t('app.folder.menu.exportStep'), enabled: true },
          { id: 'export-folder-stl', label: t('app.folder.menu.exportStl'), enabled: true },
          { id: 'export-folder-ckpart', label: t('app.folder.menu.exportCkpart'), enabled: true },
          { id: 'extract-folder', label: t('app.folder.menu.extract'), enabled: true },
          { id: '-', label: '', enabled: false, separator: true },
          { id: 'delete-folder', label: t('app.folder.menu.delete'), enabled: true },
        ],
        run: (id) => {
          if (id === 'rename-folder') setRenaming('@g:' + name);
          else if (id === 'ungroup') ungroup(name);
          else if (id.startsWith('export-folder-')) d.exportFolder(name, folderIds(rows, feats, name), id.slice('export-folder-'.length) as 'step' | 'stl' | 'ckpart');
          else if (id === 'extract-folder') d.extractFolder(name, folderIds(rows, feats, name));
          else if (id === 'delete-folder') void deleteIds(folderIds(rows, feats, name));
        },
      });
      return;
    }
    const picked = sel.includes(target.id) ? sel : [target.id];
    if (!sel.includes(target.id)) select(target.id);
    const inFolder = picked.some((id) => folderOf(rows, feats, id) !== undefined);
    setMenu({
      x, y,
      items: [
        { id: 'group', label: t('app.folder.menu.group'), keys: 'Ctrl+G', ...planText(groupPlan(rows, feats, picked, t('app.folder.default'))) },
        ...(inFolder ? [{ id: 'remove-from-folder', label: t('app.folder.menu.remove'), ...planText(removeFromFolderPlan(rows, feats, picked)) }] : []),
        { id: '-', label: '', enabled: false, separator: true },
        { id: 'rename', label: t('app.folder.menu.renameFeature'), keys: 'F2', enabled: picked.length === 1 },
        { id: 'suppress', label: t('app.folder.menu.suppress'), keys: 'Ctrl+Shift+U', enabled: true },
        { id: 'delete', label: t('app.folder.menu.deleteFeature'), keys: 'Delete', enabled: true },
      ],
      run: (id) => {
        if (id === 'group') void groupInto(picked);
        else if (id === 'remove-from-folder') removeFromFolder(picked);
        else if (id === 'rename') setRenaming(picked[0]);
        else if (id === 'suppress') void suppressIds(picked);
        else if (id === 'delete') void deleteIds(picked);
      },
    });
  };

  const actions: TreeActions = {
    isSketching: () => !!d.controller.sketchDraft(),
    hasDocument: () => d.controller.document() !== null,
    selected: () => sel,
    groupSelected: () => void groupInto(sel),
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
      onRenameFolder: renameFolder,
      onDropOn,
      onContextMenu: openMenu,
      onRenamePart: (name: string) => { d.controller.setPartName(name); d.redraw(); },
      rollback: d.controller.rollbackCount(),
      onRollback: (count: number | null) => void d.controller.setRollback(count).then(d.redraw),
      onRemove: (id: string) => void deleteIds(group(id)),
      onToggleSuppress: (id: string) => void suppressIds(group(id)),
      /** The eye on a folder row: the whole folder off or on, and the stand-in body of an imported history the other way (historyFolder.ts). */
      onToggleFolder: (ids: string[], name: string) => void d.edit(folderToggleOps(feats, ids, name)),
    },
    /** The tree's right-click menu (null when closed); main.tsx shows it with <ContextMenu>. */
    menu: menu ? { x: menu.x, y: menu.y, items: menu.items } : null,
    runMenu: (id: string) => { const m = menu; setMenu(null); m?.run(id); },
    closeMenu: () => setMenu(null),
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
