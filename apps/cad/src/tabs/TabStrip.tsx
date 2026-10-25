import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { t } from '../i18n';

export interface TabInfo { id: number; name: string; dirty: boolean; active: boolean }

/** The open documents as tabs: click to switch, × (or a middle click) to close, + for a new part. */
export function TabStrip(p: { tabs: readonly TabInfo[]; onSwitch(id: number): void; onClose(id: number): void; onNew(): void }): JSX.Element {
  const activeRef = useRef<HTMLDivElement>(null);
  const active = p.tabs.find((x) => x.active)?.id;
  // the active tab stays in view when there are more tabs than fit
  useEffect(() => { activeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }, [active, p.tabs.length]);
  return (
    <div class="tabstrip" role="tablist" aria-label={t('tabs.label')}>
      {p.tabs.map((x) => (
        <div
          key={x.id}
          ref={x.active ? activeRef : undefined}
          class={'tab' + (x.active ? ' active' : '')}
          role="tab"
          aria-selected={x.active}
          data-tab={x.id}
          title={x.dirty ? t('tabs.unsaved', { name: x.name }) : x.name}
          onClick={() => p.onSwitch(x.id)}
          onAuxClick={(e) => { if ((e as MouseEvent).button === 1) { e.preventDefault(); p.onClose(x.id); } }}
        >
          <span class="tab-name">{x.name}</span>
          {x.dirty ? <span class="tab-dirty" aria-label={t('tabs.dirty')} /> : null}
          <button class="tab-x" aria-label={t('tabs.close', { name: x.name })} onClick={(e) => { e.stopPropagation(); p.onClose(x.id); }}>×</button>
        </div>
      ))}
      <button class="tab-new" aria-label={t('tabs.new')} title={t('tabs.new')} data-action="new-tab" onClick={p.onNew}>+</button>
    </div>
  );
}
