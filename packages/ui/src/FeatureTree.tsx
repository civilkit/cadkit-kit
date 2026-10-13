import type { JSX } from 'preact';
import type { FeatureStatus } from '@kit/store';
import { t } from './i18n';

export interface FeatureRow { id: string; type: string; name?: string; suppressed?: boolean }

export function FeatureTree(p: {
  rows: FeatureRow[];
  status: FeatureStatus[];
  selectedId: string | null;
  onSelect(id: string): void;
  onMove(id: string, to: number): void;
  onRemove(id: string): void;
  onToggleSuppress(id: string): void;
}): JSX.Element {
  let dragId: string | null = null;
  return (
    <div class="tree">
      {p.rows.map((r, i) => {
        const st = p.status.find((s) => s.id === r.id);
        const failed = st !== undefined && !st.ok;
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
            onDragStart={() => { dragId = r.id; }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragId !== null) p.onMove(dragId, i);
              dragId = null;
            }}
          >
            <span class="row-id">{r.id}</span>
            <span class="row-type">{t('feature.' + r.type, undefined, r.type)}</span>
            {r.name ? <span class="row-name">{r.name}</span> : null}
            {failed ? <span class="row-hint">{st.hint ?? st.code}</span> : null}
            <button
              class="row-sup"
              title={r.suppressed ? t('ui.tree.unsuppress') : t('ui.tree.suppress')}
              onClick={(e) => { e.stopPropagation(); p.onToggleSuppress(r.id); }}
            >
              {r.suppressed ? '○' : '●'}
            </button>
            <button
              class="row-del"
              title={t('ui.tree.remove')}
              onClick={(e) => { e.stopPropagation(); p.onRemove(r.id); }}
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
