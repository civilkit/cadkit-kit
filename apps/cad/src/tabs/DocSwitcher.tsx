import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import { Icon } from '@kit/ui';
import { t } from '../i18n';
import type { TabInfo } from './TabStrip';

/** A phone's document tabs folded into its top bar: the title (with the unsaved dot) is the button, and it opens the list of open documents, each with its close
 *  button, and New part. With one document open the strip it replaces would only waste a row. */
export function DocSwitcher(p: { tabs: readonly TabInfo[]; title: string; dirty: boolean; open: boolean; onOpen(open: boolean): void; onSwitch(id: number): void; onClose(id: number): void; onNew(): void }): JSX.Element {
  useEffect(() => {
    if (!p.open) return;
    const off = (e: Event): void => { if (!(e.target as HTMLElement | null)?.closest?.('.doc-list, .doc-switch')) p.onOpen(false); };
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') p.onOpen(false); };
    addEventListener('pointerdown', off, true); addEventListener('keydown', esc);
    return () => { removeEventListener('pointerdown', off, true); removeEventListener('keydown', esc); };
  }, [p.open]);
  return (
    <>
      <button class="doc-switch" aria-haspopup="true" aria-expanded={p.open} aria-label={t('app.phone.docs')} data-testid="doc-switch" onClick={() => p.onOpen(!p.open)}>
        <b class="doc-name">{p.title}{p.dirty ? <span class="doc-dirty" title={t('app.discard.modified')}> •</span> : null}</b>
        {p.tabs.length > 1 ? <span class="doc-count" aria-hidden="true">{p.tabs.length}</span> : null}
        <Icon name="chevron" size={16} />
      </button>
      {p.open ? (
        <ul class="doc-list" role="menu" aria-label={t('tabs.label')}>
          {p.tabs.map((x) => (
            <li key={x.id} role="none" class={x.active ? 'on' : ''}>
              <button role="menuitem" class="doc-item" data-list-tab={x.id} onClick={() => { p.onOpen(false); p.onSwitch(x.id); }}>
                <span class="tab-name">{x.name}</span>{x.dirty ? <span class="tab-dirty" aria-label={t('tabs.dirty')} /> : null}
              </button>
              <button class="doc-x" aria-label={t('tabs.close', { name: x.name })} onClick={() => { p.onOpen(false); p.onClose(x.id); }}><Icon name="close" size={16} /></button>
            </li>
          ))}
          <li role="none"><button role="menuitem" class="doc-item doc-new" data-action="new-tab" onClick={() => { p.onOpen(false); p.onNew(); }}><Icon name="new-part" size={18} /><span>{t('tabs.new')}</span></button></li>
        </ul>
      ) : null}
    </>
  );
}
