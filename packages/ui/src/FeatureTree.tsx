import { Fragment, type JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import type { FeatureStatus } from '@kit/store';
import { t } from './i18n';
import { Icon, featureIconName } from './icons';
import { InlineName } from './InlineName';

export interface RefRow { id: string; label: string; icon: string; /** small muted text at the right, e.g. the axes a plane contains */ tag?: string; /** a plane or the origin can be chosen; the material row is only information */ choosable?: boolean; /** a colour chip after the label (CSS colour), e.g. the part's colour on the material row */ swatch?: string }

export interface FeatureRow { id: string; type: string; name?: string; op?: string; suppressed?: boolean; /** ids of the sketches this feature is built from; they are shown tucked under it */ uses?: string[] }

const isSketch = (type: string) => type === 'sketch' || type === 'sketch3d';
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
  const failedCount = p.status.filter((s) => !s.ok).length;
  const top = p.rows.filter((r) => !owner.has(r.id));
  const indexOf = (id: string) => p.rows.findIndex((x) => x.id === id);
  const upTo = p.rollback ?? p.rows.length;
  const dep = new Set(p.dependents ?? []);
  const picked = new Set([...(p.selectedIds ?? []), ...(p.selectedId ? [p.selectedId] : [])]);
  /** Marker position as a number of top-level rows above it, and the feature count that position means. */
  const slot = top.filter((r) => indexOf(r.id) < upTo).length;
  const countAt = (k: number): number | null => (k >= top.length ? null : k <= 0 ? 0 : indexOf(top[k - 1].id) + 1);
  const moveMarker = (k: number) => p.onRollback?.(countAt(Math.max(0, Math.min(top.length, k))));
  const renderRow = (r: FeatureRow, depth: number): JSX.Element => {
    const i = p.rows.findIndex((x) => x.id === r.id);
    const st = p.status.find((x) => x.id === r.id);
    const failed = st !== undefined && !st.ok;
    const label = r.name ?? t('feature.' + r.type, undefined, r.type);
    const kids = childrenOf.get(r.id) ?? [];
    const open = !collapsed.includes(r.id);
    const renamingThis = renaming === r.id && !!p.onRename;
    const topOf = (id: string): number => { const o = owner.get(id) ?? id; return top.findIndex((x) => x.id === o); };
    return (
      <>
        <div
          key={r.id}
          class={
            'row' +
            (depth ? ' child' : '') +
            (failed ? ' err' : '') +
            (r.suppressed ? ' suppressed' : '') +
            (picked.has(r.id) ? ' sel' : '') +
            (dep.has(r.id) ? ' dep' : '') +
            (i >= upTo ? ' rolled' : '')
          }
          data-id={r.id}
          title={dep.has(r.id) ? t('ui.tree.dependsOn', undefined, 'Depends on the selected feature') : undefined}
          draggable={!renamingThis}
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
            <button class="row-sup row-act" title={r.suppressed ? t('ui.tree.unsuppress') : t('ui.tree.suppress')} aria-label={r.suppressed ? t('ui.tree.unsuppress') : t('ui.tree.suppress')}
              onClick={(e) => { e.stopPropagation(); p.onToggleSuppress(r.id); }}><Icon name={r.suppressed ? 'eye-off' : 'eye'} size={15} /></button>
            <button class="row-del row-act" title={t('ui.tree.remove')} aria-label={t('ui.tree.remove')}
              onClick={(e) => { e.stopPropagation(); p.onRemove(r.id); }}><Icon name="trash" size={15} /></button>
          </span>
          {failed ? <span class="row-hint">{st.hint ?? st.code}</span> : null}
        </div>
        {open ? kids.map((k) => renderRow(k, depth + 1)) : null}
      </>
    );
  };

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
    <div class="tree">
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
          class={'row ref' + (r.choosable ? '' : ' info') + (p.selectedRef === r.id ? ' sel' : '')}
          data-ref={r.id}
          onClick={() => { if (r.choosable) p.onSelectRef?.(p.selectedRef === r.id ? null : r.id); }}
          onDblClick={() => { if (r.choosable) p.onOpenRef?.(r.id); }}
          onMouseEnter={() => { if (r.choosable) p.onHoverRef?.(r.id); }}
          onMouseLeave={() => p.onHoverRef?.(null)}
        >
          <Icon name={r.icon} size={18} class="row-icon" />
          <span class="row-name">{r.label}{r.swatch ? <span class="ref-chip" data-swatch={r.swatch} style={{ background: r.swatch }} /> : null}</span>
          {r.tag ? <span class="row-id ref-tag">{r.tag}</span> : null}
        </div>
      ))}
      {top.map((r, k) => (
        <Fragment key={r.id}>
          {p.onRollback && k === slot ? marker : null}
          {renderRow(r, 0)}
        </Fragment>
      ))}
      {p.onRollback && slot >= top.length ? marker : null}
      {p.onRollback && p.rows.length ? (
        <div class="rb-end" onDragOver={(e) => e.preventDefault()} onDrop={() => { if (dragBar.current) { dragBar.current = false; moveMarker(top.length); } }} />
      ) : null}
    </div>
  );
}
