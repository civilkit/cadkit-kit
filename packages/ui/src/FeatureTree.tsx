import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { FeatureStatus } from '@kit/store';
import { t } from './i18n';
import { Icon, featureIconName } from './icons';

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
  onSelect(id: string): void;
  onMove(id: string, to: number): void;
  onRemove(id: string): void;
  onToggleSuppress(id: string): void;
  onEdit?(id: string): void;
  partName?: string;
  /** Fixed rows above the features: material, the three planes, the origin. */
  refs?: RefRow[];
  selectedRef?: string | null;
  onSelectRef?(id: string | null): void;
  onHoverRef?(id: string | null): void;
  onOpenRef?(id: string): void;
}): JSX.Element {
  let dragId: string | null = null;
  const [collapsed, setCollapsed] = useState<string[]>(loadCollapsed);
  const toggle = (id: string) => setCollapsed((c) => { const n = c.includes(id) ? c.filter((x) => x !== id) : [...c, id]; try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(n)); } catch { /* private window */ } return n; });
  const owner = sketchOwners(p.rows);
  const childrenOf = new Map<string, FeatureRow[]>();
  for (const r of p.rows) { const o = owner.get(r.id); if (o) childrenOf.set(o, [...(childrenOf.get(o) ?? []), r]); }
  const failedCount = p.status.filter((s) => !s.ok).length;
  const renderRow = (r: FeatureRow, depth: number): JSX.Element => {
    const i = p.rows.findIndex((x) => x.id === r.id);
    const st = p.status.find((x) => x.id === r.id);
    const failed = st !== undefined && !st.ok;
    const label = r.name ?? t('feature.' + r.type, undefined, r.type);
    const kids = childrenOf.get(r.id) ?? [];
    const open = !collapsed.includes(r.id);
    return (
      <>
        <div
          key={r.id}
          class={
            'row' +
            (depth ? ' child' : '') +
            (failed ? ' err' : '') +
            (r.suppressed ? ' suppressed' : '') +
            (p.selectedId === r.id ? ' sel' : '')
          }
          draggable
          onClick={() => p.onSelect(r.id)}
          onDblClick={() => p.onEdit?.(r.id)}
          onDragStart={() => { dragId = r.id; }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (dragId !== null) p.onMove(dragId, i);
            dragId = null;
          }}
        >
          {kids.length ? (
            <button class="row-chev" aria-expanded={open} aria-label={open ? t('ui.tree.collapse', undefined, 'Collapse') : t('ui.tree.expand', undefined, 'Expand')}
              onClick={(e) => { e.stopPropagation(); toggle(r.id); }}><Icon name="chevron" size={12} /></button>
          ) : <span class="row-chev-space" />}
          <Icon name={featureIconName(r.type, r.op)} size={18} class="row-icon" />
          <span class="row-name" title={t('feature.' + r.type, undefined, r.type)}>{label}</span>
          {r.name ? <span class="row-type">{t('feature.' + r.type, undefined, r.type)}</span> : null}
          <span class="row-id">{r.id}</span>
          <span class="row-actions">
            {p.onEdit ? (
              <button class="row-edit row-act" title={t('ui.tree.edit', undefined, 'Edit')} aria-label={t('ui.tree.edit', undefined, 'Edit')}
                onClick={(e) => { e.stopPropagation(); p.onEdit!(r.id); }}><Icon name="edit" size={15} /></button>
            ) : null}
            <button class="row-sup row-act" title={r.suppressed ? t('ui.tree.unsuppress') : t('ui.tree.suppress')} aria-label={r.suppressed ? t('ui.tree.unsuppress') : t('ui.tree.suppress')}
              onClick={(e) => { e.stopPropagation(); p.onToggleSuppress(r.id); }}><Icon name={r.suppressed ? 'eye-off' : 'eye'} size={15} /></button>
            <button class="row-del row-act" title={t('ui.tree.remove')} aria-label={t('ui.tree.remove')}
              onClick={(e) => { e.stopPropagation(); p.onRemove(r.id); }}><Icon name="trash" size={15} /></button>
          </span>
          {failed ? <span class="row-hint">{st.hint ?? st.code}</span> : p.warnings?.[r.id] ? <span class="row-hint warn" data-warning={p.warnings[r.id].code}>{p.warnings[r.id].hint}</span> : null}
        </div>
        {open ? kids.map((k) => renderRow(k, depth + 1)) : null}
      </>
    );
  };

  return (
    <div class="tree">
      {p.partName !== undefined ? (
        <div class="tree-head">
          <Icon name="feature-part" size={18} />
          <b class="tree-part">{p.partName}</b>
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
      {p.rows.filter((r) => !owner.has(r.id)).map((r) => renderRow(r, 0))}
    </div>
  );
}
