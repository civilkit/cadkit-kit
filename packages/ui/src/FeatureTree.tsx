import type { JSX } from 'preact';
import type { FeatureStatus } from '@kit/store';
import { t } from './i18n';
import { Icon, featureIconName } from './icons';

export interface FeatureRow { id: string; type: string; name?: string; op?: string; suppressed?: boolean }

/** The history tree: one row per feature with its kind icon, a name, the id muted at the right, and (on hover or
 *  selection) icon buttons to edit, suppress and remove. A failed feature is red with its hint underneath. */
export function FeatureTree(p: {
  rows: FeatureRow[];
  status: FeatureStatus[];
  selectedId: string | null;
  onSelect(id: string): void;
  onMove(id: string, to: number): void;
  onRemove(id: string): void;
  onToggleSuppress(id: string): void;
  onEdit?(id: string): void;
  partName?: string;
}): JSX.Element {
  let dragId: string | null = null;
  const failedCount = p.status.filter((s) => !s.ok).length;
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
      {p.rows.map((r, i) => {
        const st = p.status.find((s) => s.id === r.id);
        const failed = st !== undefined && !st.ok;
        const label = r.name ?? t('feature.' + r.type, undefined, r.type);
        return (
          <div
            key={r.id}
            class={
              'row' +
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
            {failed ? <span class="row-hint">{st.hint ?? st.code}</span> : null}
          </div>
        );
      })}
    </div>
  );
}
