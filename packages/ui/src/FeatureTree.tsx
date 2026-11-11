import { Fragment, type JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { FeatureStatus } from '@kit/store';
import { t } from './i18n';
import { Icon, featureIconName } from './icons';
import { InlineName } from './InlineName';

export interface RefRow { id: string; label: string; icon: string; /** small muted text at the right, e.g. the axes a plane contains */ tag?: string; /** a plane or the origin can be chosen; the material row is only information */ choosable?: boolean; /** the row opens an editor (click, double-click, Enter or the pencil): the material row */ editable?: boolean; /** tooltip and name of the pencil on an editable row */ editLabel?: string; /** a colour chip after the label (CSS colour), e.g. the part's colour on the material row */ swatch?: string; /** shown or hidden: an eye on the row (needs `onToggleRef`); absent: no eye */ shown?: boolean }

export interface FeatureRow { id: string; type: string; name?: string; op?: string; suppressed?: boolean; /** ids of the sketches this feature is built from; they are shown tucked under it */ uses?: string[]; /** a feature this row hangs under (a thread under its hole); ignored unless that row exists */ under?: string; /** folder name: consecutive rows with the same group are shown under one collapsible folder row */ group?: string; /** small muted text after the name, e.g. `patterned by F7` */ note?: string }

const isSketch = (type: string) => type === 'sketch' || type === 'sketch3d';
/** Lists longer than this render only the rows near the viewport; a row is at least this tall (px). */
const VIRT_MIN = 120, ROW_H = 34, OVERSCAN = 12;
const COLLAPSED_KEY = 'cad.treeCollapsed';
const loadCollapsed = (): string[] => { try { return JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]') as string[]; } catch { return []; } };
/** Folder open / closed choices per document (the part name), remembered between sessions. A folder the user never touched is closed in a list longer than FOLDER_AUTO_CLOSE rows. */
const FOLDERS_KEY = 'cad.treeFolders';
export const FOLDER_AUTO_CLOSE = 40;
const loadFolders = (doc: string): Record<string, boolean> => { try { return (JSON.parse(localStorage.getItem(FOLDERS_KEY) ?? '{}') as Record<string, Record<string, boolean>>)[doc] ?? {}; } catch { return {}; } };
const saveFolders = (doc: string, map: Record<string, boolean>): void => {
  try {
    const all = JSON.parse(localStorage.getItem(FOLDERS_KEY) ?? '{}') as Record<string, Record<string, boolean>>;
    delete all[doc]; all[doc] = map;
    for (const k of Object.keys(all).slice(0, Math.max(0, Object.keys(all).length - 40))) delete all[k];   // keep the 40 documents used last
    localStorage.setItem(FOLDERS_KEY, JSON.stringify(all));
  } catch { /* private window */ }
};
const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The rows whose name, kind, id or folder contains every word of `query` (case-insensitive); all rows when the query is blank. */
export function matchRows(rows: FeatureRow[], query: string, kindLabel: (type: string) => string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return rows.map((r) => r.id);
  return rows.filter((r) => {
    const hay = [r.name ?? '', kindLabel(r.type), r.type, r.id, r.group ?? ''].join('\n').toLowerCase();
    return words.every((w) => hay.includes(w));
  }).map((r) => r.id);
}

/** Which feature owns each sketch: the first later feature that uses it. A sketch nobody uses stays at the top level. */
export function sketchOwners(rows: FeatureRow[]): Map<string, string> {
  const sketches = new Set(rows.filter((r) => isSketch(r.type)).map((r) => r.id));
  const owner = new Map<string, string>();
  for (const r of rows) {
    if (isSketch(r.type)) continue;
    for (const id of r.uses ?? []) if (sketches.has(id) && !owner.has(id)) owner.set(id, r.id);
  }
  // rows that hang under another feature (a thread under its hole); never under themselves or a row that is itself nested under them
  const ids = new Set(rows.map((r) => r.id));
  for (const r of rows) if (r.under && r.under !== r.id && ids.has(r.under) && !owner.has(r.id) && owner.get(r.under) !== r.id) owner.set(r.id, r.under);
  return owner;
}

/** A row or a folder named in a drag, a drop or a context menu. */
export type TreeDrop = { kind: 'row'; id: string } | { kind: 'folder'; name: string };

/** The history tree: one row per feature with its kind icon, a name, the id muted at the right, and (on hover or
 *  selection) icon buttons to edit, suppress and remove. A failed feature is red with its hint underneath. */
export function FeatureTree(p: {
  rows: FeatureRow[];
  status: FeatureStatus[];
  /** Regen warnings by feature id (amber hint under the row; the feature still works). */
  warnings?: Record<string, { code: string; hint: string }>;
  selectedId: string | null;
  /** Every selected row when several are (Ctrl/Shift click); `selectedId` is then the one clicked last. */
  selectedIds?: string[];
  /** A click; `mods` says whether Ctrl/Cmd or Shift was held, for multi-select. */
  onSelect(id: string, mods?: { ctrl: boolean; shift: boolean }): void;
  onMove(id: string, to: number): void;
  /** A drag dropped on a row or a folder. When given it replaces `onMove` for row-on-row drops and also covers dragging a folder (its header is draggable) and dropping on a folder. */
  onDropOn?(drag: TreeDrop, target: TreeDrop): void;
  /** Right click on a row or a folder; the app opens its menu. The browser's own menu is suppressed when this is given. */
  onContextMenu?(target: TreeDrop, x: number, y: number): void;
  /** Rename a folder in place (double click on it, or the app sets `renaming` to `'@g:' + name`). */
  onRenameFolder?(name: string, to: string): void;
  onRemove(id: string): void;
  onToggleSuppress(id: string): void;
  /** Feature ids hidden in the view only (the eye); the row is dimmed with a closed eye. Nothing is rebuilt. */
  hiddenIds?: string[];
  onToggleHide?(id: string): void;
  /** The pointer is over a feature row (id) or left it (null): the app tints what that feature made. */
  onHoverFeature?(id: string | null): void;
  /** The feature under the pointer in the 3D view; its row gets a hover mark and is scrolled into view. */
  hoverId?: string | null;
  onEdit?(id: string): void;
  /** Click on the row's warning mark: show the full warning (the app opens its diagnostics). */
  onWarning?(id: string): void;
  /** Rows to mark as depending on the selection (a quiet marker at the left edge). */
  dependents?: string[];
  /** Rename a feature / the part in place. A feature id, `'@part'` or null for none; leave `renaming` out to let the tree keep it. */
  onRename?(id: string, name: string): void;
  onRenamePart?(name: string): void;
  renaming?: string | null;
  onRenamingChange?(id: string | null): void;
  /** Rollback marker: the number of features the model is built from (0..n-1), null for all of them. */
  rollback?: number | null;
  onRollback?(count: number | null): void;
  partName?: string;
  /** Fixed rows above the features: material, the three planes, the origin. */
  refs?: RefRow[];
  selectedRef?: string | null;
  onSelectRef?(id: string | null): void;
  onHoverRef?(id: string | null): void;
  onOpenRef?(id: string): void;
  /** The eye of a reference row that has one (`shown` set): show or hide what it stands for. */
  onToggleRef?(id: string): void;
  /** Show a feature: the app asks for it when a face / edge / corner is picked in the view (or the chip's name is clicked, `force`). The row, and `also` (a pattern that repeats it), get a calm marker and a short pulse; the tree opens what hides them and scrolls only if the row is out of view and the pointer is not on the tree. `n` changes with every request. */
  reveal?: { id: string; also?: string[]; n: number; force?: boolean } | null;
  /** A folder's "select all faces of this group" button; leave out to hide it. Gets the ids of the folder's features (and the sketches tucked under them). */
  onSelectGroup?(ids: string[], name: string): void;
  /** A folder's switch (the eye on its row): suppress the whole folder, or bring it back when all of it is suppressed. Gets the ids of the folder's features (and the sketches tucked under them). Leave out to hide it. */
  onToggleFolder?(ids: string[], name: string): void;
  /** A row's "select in viewport" button: pick the faces the feature made (not offered on sketches and planes). */
  onSelectFaces?(id: string): void;
}): JSX.Element {
  const dragId = useRef<string | null>(null);
  const dragBar = useRef(false);
  const dragFolder = useRef<string | null>(null);
  const [ownRenaming, setOwnRenaming] = useState<string | null>(null);
  const renaming = p.renaming !== undefined ? p.renaming : ownRenaming;
  const setRenaming = (v: string | null) => { setOwnRenaming(v); p.onRenamingChange?.(v); };
  const [collapsed, setCollapsed] = useState<string[]>(loadCollapsed);
  const persist = (n: string[]) => { try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(n)); } catch { /* private window */ } };
  const toggle = (id: string) => setCollapsed((c) => { const n = c.includes(id) ? c.filter((x) => x !== id) : [...c, id]; persist(n); return n; });
  const owner = sketchOwners(p.rows);
  const childrenOf = new Map<string, FeatureRow[]>();
  for (const r of p.rows) { const o = owner.get(r.id); if (o) childrenOf.set(o, [...(childrenOf.get(o) ?? []), r]); }
  const failedCount = p.status.filter((s) => !s.ok && !s.blockedBy).length;   // the causes; the rest are only blocked by them
  const top = p.rows.filter((r) => !owner.has(r.id));
  const rowIndex = new Map<string, number>(); p.rows.forEach((x, i) => { if (!rowIndex.has(x.id)) rowIndex.set(x.id, i); });
  const statusById = new Map<string, FeatureStatus>(); for (const x of p.status) if (!statusById.has(x.id)) statusById.set(x.id, x);
  const indexOf = (id: string) => rowIndex.get(id) ?? -1;
  const topIndex = new Map<string, number>(); top.forEach((x, i) => topIndex.set(x.id, i));
  // folders: consecutive top-level rows with the same group (two or more) sit under one collapsible row; the choice is remembered per document
  const docKey = p.partName ?? '';
  const [folderSt, setFolderSt] = useState<{ key: string; map: Record<string, boolean> }>(() => ({ key: docKey, map: loadFolders(docKey) }));
  const folderMap = folderSt.key === docKey ? folderSt.map : loadFolders(docKey);
  const defaultOpen = p.rows.length <= FOLDER_AUTO_CLOSE;
  const setFolder = (name: string, open: boolean) => { const map = { ...folderMap, [name]: open }; saveFolders(docKey, map); setFolderSt({ key: docKey, map }); };
  type Run = { group?: string; rows: FeatureRow[]; start: number };
  const runs: Run[] = [];
  top.forEach((r, k) => { const last = runs.at(-1); if (last && last.group !== undefined && last.group === r.group) last.rows.push(r); else runs.push({ group: r.group, rows: [r], start: k }); });
  /** A run is a folder when it has two rows, or one row with a sketch tucked under it (a folder of two features, like a sketch and the extrude made from it). */
  const isFolder = (run: Run): boolean => run.group !== undefined && (run.rows.length >= 2 || (run.rows.length === 1 && (childrenOf.get(run.rows[0].id)?.length ?? 0) > 0));
  const folderOfTop = new Map<string, string>();
  for (const run of runs) if (isFolder(run)) for (const r of run.rows) folderOfTop.set(r.id, run.group!);
  /** Open whatever hides a row: the sketch parents it is tucked under, and its folder. */
  const expandFor = (id: string) => {
    const chain: string[] = [];
    for (let o = owner.get(id), g = 0; o && g < 8; o = owner.get(o), g++) chain.push(o);
    const topId = chain.at(-1) ?? id;
    if (chain.some((c) => collapsed.includes(c))) setCollapsed((c) => { const n = c.filter((x) => !chain.includes(x)); persist(n); return n; });
    const fo = folderOfTop.get(topId);
    if (fo !== undefined && !(folderMap[fo] ?? defaultOpen)) setFolder(fo, true);
  };
  // search: rows matching every word of the query (and the parents that hold them) are all that is listed
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matchPos, setMatchPos] = useState(-1);
  const searchInput = useRef<HTMLInputElement>(null);
  const filtering = query.trim() !== '';
  const kindLabel = (ty: string) => t('feature.' + ty, undefined, ty);
  const matchIds = filtering ? matchRows(p.rows, query, kindLabel) : [];
  const matchSet = new Set(matchIds);
  const shown = new Set<string>();
  for (const id of matchIds) { shown.add(id); for (let o = owner.get(id), g = 0; o && g < 8; o = owner.get(o), g++) shown.add(o); }
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hl = (text: string): JSX.Element | string => {
    if (!words.length) return text;
    const parts = text.split(new RegExp('(' + words.map(escapeRe).join('|') + ')', 'ig'));
    return parts.length === 1 ? text : <>{parts.map((x, i) => (i % 2 ? <mark key={i}>{x}</mark> : x))}</>;
  };
  // reveal: the rows a picked face belongs to carry a calm marker for as long as the pick lasts, and pulse once when it changes
  const revealIds = new Set(p.reveal ? [p.reveal.id, ...(p.reveal.also ?? [])] : []);
  const [pulse, setPulse] = useState<string[]>([]);
  const pulseTimer = useRef(0);
  const pointerIn = useRef(false);
  const lastUser = useRef(0);
  const pendingReveal = useRef<{ id: string; force: boolean; tries: number } | null>(null);
  const upTo = p.rollback ?? p.rows.length;
  const dep = new Set(p.dependents ?? []);
  const hid = new Set(p.hiddenIds ?? []);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!p.hoverId) return;
    const el = [...(root.current?.querySelectorAll<HTMLElement>('.row[data-id]') ?? [])].find((e) => e.dataset.id === p.hoverId);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [p.hoverId]);
  useEffect(() => {
    if (!p.selectedId) return;
    expandFor(p.selectedId);
    const el = [...(root.current?.querySelectorAll<HTMLElement>('.row[data-id]') ?? [])].find((e) => e.dataset.id === p.selectedId);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [p.selectedId]);
  useEffect(() => {
    const rv = p.reveal;
    if (!rv || !p.rows.some((r) => r.id === rv.id)) return;
    const busy = !rv.force && (pointerIn.current || Date.now() - lastUser.current < 1500);
    if (!busy) expandFor(rv.id);
    setPulse([rv.id, ...(rv.also ?? [])]);
    window.clearTimeout(pulseTimer.current);
    pulseTimer.current = window.setTimeout(() => setPulse([]), 1500);
    if (!busy) pendingReveal.current = { id: rv.id, force: !!rv.force, tries: 0 };
    return () => window.clearTimeout(pulseTimer.current);
  }, [p.reveal?.n, p.reveal?.id]);
  const picked = new Set([...(p.selectedIds ?? []), ...(p.selectedId ? [p.selectedId] : [])]);
  /** Marker position as a number of top-level rows above it, and the feature count that position means. */
  const slot = top.filter((r) => indexOf(r.id) < upTo).length;
  /** The last history position of a row and everything nested under it (a thread listed after its hole). */
  const span = (id: string): number => Math.max(indexOf(id), ...(childrenOf.get(id) ?? []).map((c) => span(c.id)));
  const countAt = (k: number): number | null => (k >= top.length ? null : k <= 0 ? 0 : span(top[k - 1].id) + 1);
  const moveMarker = (k: number) => p.onRollback?.(countAt(Math.max(0, Math.min(top.length, k))));
  const renderRow = (r: FeatureRow, depth: number, grp = false): JSX.Element => {
    const i = indexOf(r.id);
    const st = statusById.get(r.id);
    const failed = st !== undefined && !st.ok && !st.blockedBy;
    const blocked = st !== undefined && !st.ok ? st.blockedBy : undefined;   // only follows from an earlier failure: muted, not red
    const label = r.name ?? t('feature.' + r.type, undefined, r.type);
    const kids = childrenOf.get(r.id) ?? [];
    const open = !collapsed.includes(r.id);
    const renamingThis = renaming === r.id && !!p.onRename;
    const topOf = (id: string): number => { const o = owner.get(id) ?? id; return topIndex.get(o) ?? -1; };
    return (
      <>
        <div
          key={r.id}
          class={
            'row' +
            (depth ? ' child' : '') +
            (grp ? ' ingroup' : '') +
            (revealIds.has(r.id) ? ' owns' : '') +
            (pulse.includes(r.id) ? ' pulse' : '') +
            (filtering && matchSet.has(r.id) ? ' match' : '') +
            (failed ? ' err' : '') +
            (blocked ? ' blocked' : '') +
            (r.suppressed ? ' suppressed' : '') +
            (picked.has(r.id) ? ' sel' : '') +
            (dep.has(r.id) ? ' dep' : '') +
            (hid.has(r.id) ? ' hidden' : '') +
            (p.hoverId === r.id ? ' hov' : '') +
            (i >= upTo ? ' rolled' : '')
          }
          data-id={r.id}
          data-testid={'tree-row-' + r.id}
          title={dep.has(r.id) ? t('ui.tree.dependsOn', undefined, 'Depends on the selected feature') : undefined}
          draggable={!renamingThis}
          onMouseEnter={() => p.onHoverFeature?.(r.id)}
          onMouseLeave={() => p.onHoverFeature?.(null)}
          onClick={(e) => p.onSelect(r.id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })}
          onDblClick={() => p.onEdit?.(r.id)}
          onContextMenu={p.onContextMenu ? (e: MouseEvent) => { e.preventDefault(); p.onContextMenu!({ kind: 'row', id: r.id }, e.clientX, e.clientY); } : undefined}
          onDragStart={() => { dragId.current = r.id; dragFolder.current = null; }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            if (dragBar.current) {
              dragBar.current = false;
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              moveMarker(topOf(r.id) + (e.clientY >= rect.top + rect.height / 2 ? 1 : 0));
              return;
            }
            if (dragFolder.current !== null) { if (p.onDropOn) p.onDropOn({ kind: 'folder', name: dragFolder.current }, { kind: 'row', id: r.id }); dragFolder.current = null; return; }
            if (dragId.current !== null) { if (p.onDropOn) p.onDropOn({ kind: 'row', id: dragId.current }, { kind: 'row', id: r.id }); else p.onMove(dragId.current, i); }
            dragId.current = null;
          }}
        >
          {kids.length ? (
            <button class="row-chev" aria-expanded={open} aria-label={open ? t('ui.tree.collapse', undefined, 'Collapse') : t('ui.tree.expand', undefined, 'Expand')}
              onClick={(e) => { e.stopPropagation(); toggle(r.id); }}><Icon name="chevron" size={12} /></button>
          ) : <span class="row-chev-space" />}
          <Icon name={featureIconName(r.type, r.op)} size={18} class="row-icon" />
          {renamingThis
            ? <InlineName class="row-name" value={r.name ?? label} onCommit={(n) => { setRenaming(null); p.onRename!(r.id, n); }} onCancel={() => setRenaming(null)} />
            : <span class="row-name" title={t('feature.' + r.type, undefined, r.type)}>{hl(label)}</span>}
          {r.name && !renamingThis && !r.name.toLowerCase().startsWith(kindLabel(r.type).toLowerCase()) ? <span class="row-type">{hl(t('feature.' + r.type, undefined, r.type))}</span> : null}
          {r.note && !renamingThis ? <span class="row-note" data-note={r.note}>{r.note}</span> : null}
          {!failed && p.warnings?.[r.id] ? <span class="row-warn" data-warning={p.warnings[r.id].code} title={p.warnings[r.id].hint ?? p.warnings[r.id].code} aria-label={p.warnings[r.id].hint ?? p.warnings[r.id].code} role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); p.onWarning?.(r.id); }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); p.onWarning?.(r.id); } }}>!</span> : null}
          <span class="row-id">{hl(r.id)}</span>
          <span class="row-actions">
            {p.onSelectFaces && !isSketch(r.type) && r.type !== 'plane' ? (
              <button class="row-selfaces row-act" title={t('ui.tree.selectFaces', undefined, 'Select in viewport')} aria-label={t('ui.tree.selectFaces', undefined, 'Select in viewport')}
                onClick={(e) => { e.stopPropagation(); p.onSelectFaces!(r.id); }}><Icon name="sel-box" size={15} /></button>
            ) : null}
            {p.onEdit ? (
              <button class="row-edit row-act" title={t('ui.tree.edit', undefined, 'Edit')} aria-label={t('ui.tree.edit', undefined, 'Edit')}
                onClick={(e) => { e.stopPropagation(); p.onEdit!(r.id); }}><Icon name="edit" size={15} /></button>
            ) : null}
            {p.onRollback ? (
              <button class="row-rb row-act" title={t('ui.tree.rollbackHere', undefined, 'Roll back to here')} aria-label={t('ui.tree.rollbackHere', undefined, 'Roll back to here')}
                onClick={(e) => { e.stopPropagation(); moveMarker(topOf(r.id) + 1); }}><Icon name="rollback" size={15} /></button>
            ) : null}
            {p.onToggleHide ? (
              <button class={'row-hide row-act' + (hid.has(r.id) ? ' on' : '')} aria-pressed={hid.has(r.id)}
                title={hid.has(r.id) ? t('ui.tree.show', undefined, 'Show') : t('ui.tree.hide', undefined, 'Hide (view only)')}
                aria-label={hid.has(r.id) ? t('ui.tree.show', undefined, 'Show') : t('ui.tree.hide', undefined, 'Hide (view only)')}
                onClick={(e) => { e.stopPropagation(); p.onToggleHide!(r.id); }}><Icon name={hid.has(r.id) ? 'eye-off' : 'eye'} size={15} /></button>
            ) : null}
            <button class="row-sup row-act" title={r.suppressed ? t('ui.tree.unsuppress') : t('ui.tree.suppress')} aria-label={r.suppressed ? t('ui.tree.unsuppress') : t('ui.tree.suppress')}
              onClick={(e) => { e.stopPropagation(); p.onToggleSuppress(r.id); }}><Icon name={p.onToggleHide ? 'pause' : r.suppressed ? 'eye-off' : 'eye'} size={15} /></button>
            <button class="row-del row-act" title={t('ui.tree.remove')} aria-label={t('ui.tree.remove')}
              onClick={(e) => { e.stopPropagation(); p.onRemove(r.id); }}><Icon name="trash" size={15} /></button>
          </span>
          {failed ? <span class="row-hint">{st.hint ?? st.code}</span> : null}
          {blocked ? (
            <span class="row-blocked-line"><button type="button" class="row-blocked" data-blocked-by={blocked} title={t('ui.tree.blockedByTitle', { id: blocked }, 'Only fails because {id} failed. Select {id}.')}
              onClick={(e) => { e.stopPropagation(); p.onSelect(blocked); }}>
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>
              {t('ui.tree.blockedBy', { id: blocked }, 'blocked by {id}')}
            </button></span>
          ) : null}
        </div>
      </>
    );
  };

  type Entry = { kind: 'row'; r: FeatureRow; depth: number; grp: boolean } | { kind: 'folder'; name: string; ids: string[]; count: number; open: boolean } | { kind: 'marker' };
  const flat: Entry[] = [];
  const walk = (r: FeatureRow, depth: number, grp: boolean) => {
    flat.push({ kind: 'row', r, depth, grp });
    if (filtering || !collapsed.includes(r.id)) for (const k of childrenOf.get(r.id) ?? []) if (!filtering || shown.has(k.id)) walk(k, depth + 1, grp);
  };
  const marks = !!p.onRollback && !filtering;   // while searching the rollback marker is not shown
  for (const run of runs) {
    const rows = filtering ? run.rows.filter((r) => shown.has(r.id)) : run.rows;
    if (!rows.length) continue;
    if (marks && slot === run.start) flat.push({ kind: 'marker' });
    if (run.group !== undefined && isFolder(run)) {
      // a folder holding the rollback marker stays open so the marker is never hidden in it
      const holdsMarker = marks && slot > run.start && slot < run.start + run.rows.length;
      const open = filtering || holdsMarker || (folderMap[run.group] ?? defaultOpen);
      flat.push({ kind: 'folder', name: run.group, count: run.rows.reduce((n, r) => n + 1 + (childrenOf.get(r.id)?.length ?? 0), 0), open, ids: run.rows.flatMap((r) => [r.id, ...(childrenOf.get(r.id) ?? []).map((c) => c.id)]) });
      if (open) rows.forEach((r) => { if (marks && r !== run.rows[0] && slot === run.start + run.rows.indexOf(r)) flat.push({ kind: 'marker' }); walk(r, 0, true); });
    } else rows.forEach((r) => walk(r, 0, false));
  }
  if (marks && slot >= top.length) flat.push({ kind: 'marker' });
  // Only the rows near the viewport are in the DOM when the list is long (a part with 500 features is 18 000 nodes otherwise).
  const virtual = flat.length > VIRT_MIN;
  /** Top edge of the whole list in viewport coordinates: the lead spacer, or else the first row (the window then starts at 0). */
  const listTop = (): number | null => root.current?.querySelector('.tree-pad, .row[data-id]')?.getBoundingClientRect().top ?? null;
  const [win, setWin] = useState<[number, number]>([0, 60]);
  const winRef = useRef(win); winRef.current = win;
  /** The box that scrolls the list: the nearest ancestor with its own vertical scrolling (the tab body when the panel is tabbed, else the panel). */
  const scroller = (): HTMLElement | null => {
    for (let el = root.current?.parentElement ?? null; el; el = el.parentElement) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === 'auto' || oy === 'scroll') return el;
    }
    return root.current?.closest<HTMLElement>('.tree-wrap') ?? root.current?.parentElement ?? null;
  };
  const measure = () => {
    const sc = scroller(), lt = listTop();
    if (!sc || lt === null) return;
    const top0 = sc.getBoundingClientRect().top - lt;
    const h = sc.clientHeight || 800;
    const a = Math.max(0, Math.floor(top0 / ROW_H) - OVERSCAN), b = Math.min(flatLen.current, Math.ceil((top0 + h) / ROW_H) + OVERSCAN);
    if (Math.abs(a - winRef.current[0]) >= 4 || Math.abs(b - winRef.current[1]) >= 4 || b > winRef.current[1] && a < winRef.current[0]) setWin([a, Math.max(b, a + 1)]);
  };
  const flatLen = useRef(0); flatLen.current = flat.length;
  useEffect(() => {
    if (!virtual) return;
    const sc = scroller();
    if (!sc) return;
    let raf = 0;
    const on = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; measure(); }); };
    sc.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    measure();
    return () => { sc.removeEventListener('scroll', on); window.removeEventListener('resize', on); if (raf) cancelAnimationFrame(raf); };
  }, [virtual]);
  // a row that is wanted on screen but not rendered: scroll to where it will be
  const flatIndexOf = (id: string) => flat.findIndex((e) => e.kind === 'row' && e.r.id === id);
  useEffect(() => {
    if (!virtual || !p.selectedId) return;
    const i = flatIndexOf(p.selectedId), sc = scroller(), lt = listTop();
    if (i < 0 || !sc || lt === null) return;
    if (i >= winRef.current[0] + OVERSCAN && i < winRef.current[1] - OVERSCAN) return;
    sc.scrollTop += lt - sc.getBoundingClientRect().top + i * ROW_H - sc.clientHeight / 2;
  }, [p.selectedId]);
  // a requested reveal: once the row is in the DOM, scroll it to the middle if it is out of view (or when forced); a row the window has not rendered is brought near first
  useEffect(() => {
    const pr = pendingReveal.current;
    if (!pr) return;
    const el = [...(root.current?.querySelectorAll<HTMLElement>('.row[data-id]') ?? [])].find((e) => e.dataset.id === pr.id);
    const sc = scroller();
    if (el) {
      pendingReveal.current = null;
      const a = el.getBoundingClientRect(), b = sc?.getBoundingClientRect();
      const inView = !b || (a.top >= b.top && a.bottom <= b.bottom);
      if (pr.force || !inView) el.scrollIntoView?.({ block: 'center' });
      return;
    }
    if (pr.tries++ > 4) { pendingReveal.current = null; return; }
    const i = flatIndexOf(pr.id), lt = listTop();
    if (i < 0 || !sc || lt === null) return;   // still hidden by a parent that is opening: the next render tries again
    sc.scrollTop += lt - sc.getBoundingClientRect().top + i * ROW_H - sc.clientHeight / 2;
  });
  const from = virtual ? Math.min(win[0], flat.length) : 0, to = virtual ? Math.min(Math.max(win[1], from + 1), flat.length) : flat.length;

  const renderFolder = (e: Extract<Entry, { kind: 'folder' }>): JSX.Element => {
    const holdsReveal = e.ids.some((id) => revealIds.has(id));
    const renamingThis = renaming === '@g:' + e.name && !!p.onRenameFolder;
    const target: TreeDrop = { kind: 'folder', name: e.name };
    const members = p.rows.filter((r) => e.ids.includes(r.id));
    const off = members.length > 0 && members.every((r) => r.suppressed);   // the whole folder is switched off
    const head = (
      <>
        <span class="row-chev" aria-hidden="true"><Icon name="chevron" size={12} /></span>
        <Icon name={e.open ? 'folder-open' : 'folder'} size={18} class="row-icon" />
        {renamingThis
          ? <InlineName class="row-name" value={e.name} onCommit={(n) => { setRenaming(null); const was = folderMap[e.name]; if (was !== undefined) setFolder(n, was); p.onRenameFolder!(e.name, n); }} onCancel={() => setRenaming(null)} />
          : <span class="row-name">{hl(e.name)}</span>}
        <span class="row-type">{t('ui.tree.folderCount', { n: e.count }, String(e.count))}</span>
      </>
    );
    return (
      <div
        class={'row folder' + (off ? ' suppressed' : '') + (holdsReveal && !e.open ? ' owns' : '') + (holdsReveal && pulse.length ? ' pulse' : '')}
        data-group={e.name}
        draggable={!renamingThis && !!p.onDropOn}
        onClick={() => { if (!filtering && !renamingThis) setFolder(e.name, !e.open); }}
        onDblClick={() => { if (p.onRenameFolder) setRenaming('@g:' + e.name); }}
        onContextMenu={p.onContextMenu ? (ev: MouseEvent) => { ev.preventDefault(); p.onContextMenu!(target, ev.clientX, ev.clientY); } : undefined}
        onDragStart={() => { dragFolder.current = e.name; dragId.current = null; }}
        onDragOver={(ev) => ev.preventDefault()}
        onDrop={() => {
          if (!p.onDropOn) return;
          if (dragFolder.current !== null) p.onDropOn({ kind: 'folder', name: dragFolder.current }, target);
          else if (dragId.current !== null) p.onDropOn({ kind: 'row', id: dragId.current }, target);
          dragFolder.current = null; dragId.current = null;
        }}
      >
        {renamingThis
          ? <div class="folder-toggle">{head}</div>
          : <button type="button" class="folder-toggle" aria-expanded={e.open} aria-label={`${e.name}, ${t('ui.tree.folderCount', { n: e.count }, String(e.count))}`}>{head}</button>}
        {(p.onSelectGroup || p.onToggleFolder) && !renamingThis ? (
          <span class="row-actions">
            {p.onSelectGroup ? <button class="row-act" title={t('ui.tree.selectGroup', undefined, 'Select all faces of this group')} aria-label={t('ui.tree.selectGroup', undefined, 'Select all faces of this group')}
              onClick={(ev) => { ev.stopPropagation(); p.onSelectGroup!(e.ids, e.name); }}><Icon name="sel-box" size={15} /></button> : null}
            {p.onToggleFolder ? <button class="row-sup row-act folder-sup" aria-pressed={off} title={off ? t('ui.tree.folderOn', undefined, 'Switch the folder on') : t('ui.tree.folderOff', undefined, 'Switch the folder off')} aria-label={off ? t('ui.tree.folderOn', undefined, 'Switch the folder on') : t('ui.tree.folderOff', undefined, 'Switch the folder off')}
              onClick={(ev) => { ev.stopPropagation(); p.onToggleFolder!(e.ids, e.name); }}><Icon name={off ? 'eye-off' : 'eye'} size={15} /></button> : null}
          </span>
        ) : null}
      </div>
    );
  };

  /** Next / previous match (Enter / Down, Shift+Enter / Up): selects the row and brings it to the middle. */
  const jump = (dir: 1 | -1) => {
    const ids = flat.flatMap((e) => (e.kind === 'row' && matchSet.has(e.r.id) ? [e.r.id] : []));
    if (!ids.length) return;
    const k = matchPos < 0 ? (dir === 1 ? 0 : ids.length - 1) : (matchPos + dir + ids.length) % ids.length;
    setMatchPos(k);
    p.onSelect(ids[k]);
    pendingReveal.current = { id: ids[k], force: true, tries: 0 };
  };
  const closeSearch = () => { setQuery(''); setMatchPos(-1); setSearchOpen(false); root.current?.focus(); };
  const openSearch = () => { setSearchOpen(true); queueMicrotask(() => { searchInput.current?.focus(); searchInput.current?.select(); }); };

  const marker = (
    <div
      class={'rb-bar' + (slot < top.length ? ' back' : '')}
      role="separator"
      aria-orientation="horizontal"
      aria-valuenow={slot}
      aria-valuemin={0}
      aria-valuemax={top.length}
      aria-label={t('ui.tree.rollbackBar', undefined, 'Rollback marker')}
      tabIndex={0}
      draggable
      onDragStart={() => { dragBar.current = true; dragId.current = null; }}
      onDragEnd={() => { dragBar.current = false; }}
      onDragOver={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        const to = e.key === 'ArrowUp' ? slot - 1 : e.key === 'ArrowDown' ? slot + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? top.length : null;
        if (to !== null) { e.preventDefault(); e.stopPropagation(); moveMarker(to); }
      }}
    >
      <span class="rb-grip" />
      <span class="rb-label">{t('ui.history.here', undefined, 'model is here')}</span>
      {slot < top.length ? (
        <button class="rb-fwd" onClick={(e) => { e.stopPropagation(); p.onRollback?.(null); }}>{t('ui.tree.rollForward', undefined, 'Roll forward')}</button>
      ) : null}
    </div>
  );

  return (
    <div
      class="tree" ref={root} tabIndex={-1}
      onMouseEnter={() => { pointerIn.current = true; }}
      onMouseLeave={() => { pointerIn.current = false; }}
      onWheel={() => { lastUser.current = Date.now(); }}
      onTouchMove={() => { lastUser.current = Date.now(); }}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f' && p.rows.length) { e.preventDefault(); e.stopPropagation(); openSearch(); }
      }}
    >
      {p.partName !== undefined || searchOpen ? (
        <div class="tree-head">
          {p.partName !== undefined ? <>
            <Icon name="feature-part" size={18} />
            {renaming === '@part' && p.onRenamePart
              ? <InlineName class="tree-part" value={p.partName} onCommit={(n) => { setRenaming(null); p.onRenamePart!(n); }} onCancel={() => setRenaming(null)} />
              : <b class="tree-part" onDblClick={() => { if (p.onRenamePart) setRenaming('@part'); }} title={p.onRenamePart ? t('ui.tree.rename', undefined, 'Rename') + ' (F2)' : undefined}>{p.partName}</b>}
            <span class="tree-count">{t('ui.tree.count', { n: p.rows.length }, String(p.rows.length))}</span>
            {failedCount ? <span class="tree-bad" title={t('ui.tree.failed', { n: failedCount }, String(failedCount))}>{failedCount}</span> : null}
            <button type="button" class={'tree-search-btn' + (searchOpen ? ' on' : '')} aria-pressed={searchOpen}
              title={t('ui.tree.search', undefined, 'Search features') + ' (Ctrl+F)'} aria-label={t('ui.tree.search', undefined, 'Search features')}
              onClick={() => { if (searchOpen) closeSearch(); else openSearch(); }}><Icon name="search" size={15} /></button>
          </> : null}
          {searchOpen ? (
            <div class="tree-search" role="search">
              <input
                ref={searchInput} type="text" class="tree-search-input" value={query} autoComplete="off" spellcheck={false}
                placeholder={t('ui.tree.searchPlaceholder', undefined, 'Name, type or id (F62, revolve, lens)')}
                aria-label={t('ui.tree.search', undefined, 'Search features')}
                onInput={(e) => { setQuery((e.currentTarget as HTMLInputElement).value); setMatchPos(-1); }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
                  else if (e.key === 'Enter') { e.preventDefault(); jump(e.shiftKey ? -1 : 1); }
                  else if (e.key === 'ArrowDown') { e.preventDefault(); jump(1); }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); jump(-1); }
                  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); searchInput.current?.select(); }
                }}
              />
              <span class="tree-search-count" aria-live="polite">
                {!filtering ? '' : !matchIds.length ? t('ui.tree.searchNone', undefined, 'No matches')
                  : matchPos >= 0 ? t('ui.tree.searchAt', { i: matchPos + 1, n: matchIds.length }, `${matchPos + 1} of ${matchIds.length}`)
                  : t('ui.tree.searchCount', { n: matchIds.length }, `${matchIds.length} matches`)}
              </span>
              <button type="button" class="tree-search-clear" title={t('ui.tree.searchClear', undefined, 'Clear search (Esc)')} aria-label={t('ui.tree.searchClear', undefined, 'Clear search (Esc)')} onClick={closeSearch}><Icon name="close" size={14} /></button>
            </div>
          ) : null}
        </div>
      ) : null}
      {(p.refs ?? []).map((r) => (
        <div
          key={r.id}
          class={'row ref' + (r.choosable || r.editable ? '' : ' info') + (r.editable ? ' editable' : '') + (p.selectedRef === r.id ? ' sel' : '')}
          data-ref={r.id}
          {...(r.editable ? { role: 'button', tabIndex: 0, onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); p.onOpenRef?.(r.id); } } } : {})}
          onClick={() => { if (r.editable) p.onOpenRef?.(r.id); else if (r.choosable) p.onSelectRef?.(p.selectedRef === r.id ? null : r.id); }}
          onDblClick={() => { if (r.choosable) p.onOpenRef?.(r.id); }}
          onMouseEnter={() => { if (r.choosable) p.onHoverRef?.(r.id); }}
          onMouseLeave={() => p.onHoverRef?.(null)}
        >
          <Icon name={r.icon} size={18} class="row-icon" />
          <span class="row-name">{r.label}{r.swatch ? <span class="ref-chip" data-swatch={r.swatch} style={{ background: r.swatch }} /> : null}</span>
          {r.tag ? <span class="row-id ref-tag">{r.tag}</span> : null}
          {r.shown !== undefined && p.onToggleRef ? <button type="button" class={'ref-eye' + (r.shown ? '' : ' on')} data-act="toggle-ref" aria-pressed={!r.shown} title={r.shown ? t('ui.tree.hide', undefined, 'Hide (view only)') : t('ui.tree.show', undefined, 'Show')} aria-label={r.shown ? t('ui.tree.hide', undefined, 'Hide (view only)') : t('ui.tree.show', undefined, 'Show')} onClick={(e) => { e.stopPropagation(); p.onToggleRef!(r.id); }}><Icon name={r.shown ? 'eye' : 'eye-off'} size={15} /></button> : null}
          {r.editable ? <button type="button" class="ref-edit" aria-label={r.editLabel ?? 'Edit'} title={r.editLabel ?? 'Edit'} onClick={(e) => { e.stopPropagation(); p.onOpenRef?.(r.id); }}><Icon name="edit" size={14} /></button> : null}
        </div>
      ))}
      <>
        {virtual && from > 0 ? <div class="tree-pad" style={{ height: from * ROW_H + 'px' }} /> : null}
        {flat.slice(from, to).map((e) => (e.kind === 'marker' ? <Fragment key="@marker">{marker}</Fragment> : e.kind === 'folder' ? <Fragment key={'@g:' + e.ids[0]}>{renderFolder(e)}</Fragment> : <Fragment key={e.r.id}>{renderRow(e.r, e.depth, e.grp)}</Fragment>))}
        {virtual && to < flat.length ? <div class="tree-pad" style={{ height: (flat.length - to) * ROW_H + 'px' }} /> : null}
      </>
      {p.onRollback && p.rows.length ? (
        <div class="rb-end" onDragOver={(e) => e.preventDefault()} onDrop={() => { if (dragBar.current) { dragBar.current = false; moveMarker(top.length); } }} />
      ) : null}
    </div>
  );
}
