import { Fragment, type JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { FeatureStatus } from '@kit/store';
import { t } from './i18n';
import { Icon, featureIconName } from './icons';
import { InlineName } from './InlineName';

export interface RefRow { id: string; label: string; icon: string; /** small muted text at the right, e.g. the axes a plane contains */ tag?: string; /** a plane or the origin can be chosen; the material row is only information */ choosable?: boolean; /** the row opens an editor (click, double-click, Enter or the pencil): the material row */ editable?: boolean; /** tooltip and name of the pencil on an editable row */ editLabel?: string; /** a colour chip after the label (CSS colour), e.g. the part's colour on the material row */ swatch?: string }

export interface FeatureRow { id: string; type: string; name?: string; op?: string; suppressed?: boolean; /** ids of the sketches this feature is built from; they are shown tucked under it */ uses?: string[]; /** a feature this row hangs under (a thread under its hole); ignored unless that row exists */ under?: string; /** small muted text after the name, e.g. `patterned by F7` */ note?: string }

const isSketch = (type: string) => type === 'sketch' || type === 'sketch3d';
/** Lists longer than this render only the rows near the viewport; a row is at least this tall (px). */
const VIRT_MIN = 120, ROW_H = 34, OVERSCAN = 12;
const COLLAPSED_KEY = 'cad.treeCollapsed';
const loadCollapsed = (): string[] => { try { return JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]') as string[]; } catch { return []; } };

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
}): JSX.Element {
  const dragId = useRef<string | null>(null);
  const dragBar = useRef(false);
  const [ownRenaming, setOwnRenaming] = useState<string | null>(null);
  const renaming = p.renaming !== undefined ? p.renaming : ownRenaming;
  const setRenaming = (v: string | null) => { setOwnRenaming(v); p.onRenamingChange?.(v); };
  const [collapsed, setCollapsed] = useState<string[]>(loadCollapsed);
  const toggle = (id: string) => setCollapsed((c) => { const n = c.includes(id) ? c.filter((x) => x !== id) : [...c, id]; try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(n)); } catch { /* private window */ } return n; });
  const owner = sketchOwners(p.rows);
  const childrenOf = new Map<string, FeatureRow[]>();
  for (const r of p.rows) { const o = owner.get(r.id); if (o) childrenOf.set(o, [...(childrenOf.get(o) ?? []), r]); }
  const failedCount = p.status.filter((s) => !s.ok && !s.blockedBy).length;   // the causes; the rest are only blocked by them
  const top = p.rows.filter((r) => !owner.has(r.id));
  const rowIndex = new Map<string, number>(); p.rows.forEach((x, i) => { if (!rowIndex.has(x.id)) rowIndex.set(x.id, i); });
  const statusById = new Map<string, FeatureStatus>(); for (const x of p.status) if (!statusById.has(x.id)) statusById.set(x.id, x);
  const indexOf = (id: string) => rowIndex.get(id) ?? -1;
  const topIndex = new Map<string, number>(); top.forEach((x, i) => topIndex.set(x.id, i));
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
    const el = [...(root.current?.querySelectorAll<HTMLElement>('.row[data-id]') ?? [])].find((e) => e.dataset.id === p.selectedId);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [p.selectedId]);
  const picked = new Set([...(p.selectedIds ?? []), ...(p.selectedId ? [p.selectedId] : [])]);
  /** Marker position as a number of top-level rows above it, and the feature count that position means. */
  const slot = top.filter((r) => indexOf(r.id) < upTo).length;
  /** The last history position of a row and everything nested under it (a thread listed after its hole). */
  const span = (id: string): number => Math.max(indexOf(id), ...(childrenOf.get(id) ?? []).map((c) => span(c.id)));
  const countAt = (k: number): number | null => (k >= top.length ? null : k <= 0 ? 0 : span(top[k - 1].id) + 1);
  const moveMarker = (k: number) => p.onRollback?.(countAt(Math.max(0, Math.min(top.length, k))));
  const renderRow = (r: FeatureRow, depth: number): JSX.Element => {
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
          title={dep.has(r.id) ? t('ui.tree.dependsOn', undefined, 'Depends on the selected feature') : undefined}
          draggable={!renamingThis}
          onMouseEnter={() => p.onHoverFeature?.(r.id)}
          onMouseLeave={() => p.onHoverFeature?.(null)}
          onClick={(e) => p.onSelect(r.id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })}
          onDblClick={() => p.onEdit?.(r.id)}
          onDragStart={() => { dragId.current = r.id; }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            if (dragBar.current) {
              dragBar.current = false;
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              moveMarker(topOf(r.id) + (e.clientY >= rect.top + rect.height / 2 ? 1 : 0));
              return;
            }
            if (dragId.current !== null) p.onMove(dragId.current, i);
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
            : <span class="row-name" title={t('feature.' + r.type, undefined, r.type)}>{label}</span>}
          {r.name && !renamingThis ? <span class="row-type">{t('feature.' + r.type, undefined, r.type)}</span> : null}
          {r.note && !renamingThis ? <span class="row-note" data-note={r.note}>{r.note}</span> : null}
          {!failed && p.warnings?.[r.id] ? <span class="row-warn" data-warning={p.warnings[r.id].code} title={p.warnings[r.id].hint ?? p.warnings[r.id].code} aria-label={p.warnings[r.id].hint ?? p.warnings[r.id].code}>!</span> : null}
          <span class="row-id">{r.id}</span>
          <span class="row-actions">
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

  type Entry = { kind: 'row'; r: FeatureRow; depth: number } | { kind: 'marker' };
  const flat: Entry[] = [];
  const walk = (r: FeatureRow, depth: number) => {
    flat.push({ kind: 'row', r, depth });
    if (!collapsed.includes(r.id)) for (const k of childrenOf.get(r.id) ?? []) walk(k, depth + 1);
  };
  top.forEach((r, k) => { if (p.onRollback && k === slot) flat.push({ kind: 'marker' }); walk(r, 0); });
  if (p.onRollback && slot >= top.length) flat.push({ kind: 'marker' });
  // Only the rows near the viewport are in the DOM when the list is long (a part with 500 features is 18 000 nodes otherwise).
  const virtual = flat.length > VIRT_MIN;
  /** Top edge of the whole list in viewport coordinates: the lead spacer, or else the first row (the window then starts at 0). */
  const listTop = (): number | null => root.current?.querySelector('.tree-pad, .row[data-id]')?.getBoundingClientRect().top ?? null;
  const [win, setWin] = useState<[number, number]>([0, 60]);
  const winRef = useRef(win); winRef.current = win;
  const scroller = (): HTMLElement | null => root.current?.closest<HTMLElement>('.tree-wrap') ?? root.current?.parentElement ?? null;
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
  const from = virtual ? Math.min(win[0], flat.length) : 0, to = virtual ? Math.min(Math.max(win[1], from + 1), flat.length) : flat.length;

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
    <div class="tree" ref={root}>
      {p.partName !== undefined ? (
        <div class="tree-head">
          <Icon name="feature-part" size={18} />
          {renaming === '@part' && p.onRenamePart
            ? <InlineName class="tree-part" value={p.partName} onCommit={(n) => { setRenaming(null); p.onRenamePart!(n); }} onCancel={() => setRenaming(null)} />
            : <b class="tree-part" onDblClick={() => { if (p.onRenamePart) setRenaming('@part'); }} title={p.onRenamePart ? t('ui.tree.rename', undefined, 'Rename') + ' (F2)' : undefined}>{p.partName}</b>}
          <span class="tree-count">{t('ui.tree.count', { n: p.rows.length }, String(p.rows.length))}</span>
          {failedCount ? <span class="tree-bad" title={t('ui.tree.failed', { n: failedCount }, String(failedCount))}>{failedCount}</span> : null}
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
          {r.editable ? <button type="button" class="ref-edit" aria-label={r.editLabel ?? 'Edit'} title={r.editLabel ?? 'Edit'} onClick={(e) => { e.stopPropagation(); p.onOpenRef?.(r.id); }}><Icon name="edit" size={14} /></button> : null}
        </div>
      ))}
      <>
        {virtual && from > 0 ? <div class="tree-pad" style={{ height: from * ROW_H + 'px' }} /> : null}
        {flat.slice(from, to).map((e) => (e.kind === 'marker' ? <Fragment key="@marker">{marker}</Fragment> : <Fragment key={e.r.id}>{renderRow(e.r, e.depth)}</Fragment>))}
        {virtual && to < flat.length ? <div class="tree-pad" style={{ height: (flat.length - to) * ROW_H + 'px' }} /> : null}
      </>
      {p.onRollback && p.rows.length ? (
        <div class="rb-end" onDragOver={(e) => e.preventDefault()} onDrop={() => { if (dragBar.current) { dragBar.current = false; moveMarker(top.length); } }} />
      ) : null}
    </div>
  );
}
