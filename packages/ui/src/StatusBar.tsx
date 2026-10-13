import type { JSX } from 'preact';
import type { Notice } from '@kit/store';
import { t } from './i18n';

export interface StatusItem { label: string; value: string; tone?: 'ok' | 'warn' | 'err' }

export function StatusBar(p: {
  notices: Notice[]; hover: string | null; busy: boolean;
  items?: StatusItem[]; drawerOpen?: boolean; onToggleDrawer?(): void; right?: string;
}): JSX.Element {
  const last = p.notices.at(-1);
  return (
    <div class="status">
      {p.busy ? <span class="st-busy">{t('ui.status.busy')}</span> : <span class="ready"><span class="dot" />{t('ui.status.ready')}</span>}
      {p.hover ? <span class="st-hover">{p.hover}</span> : null}
      {last ? <span class={'st-notice ' + last.level}>{last.text}</span> : null}
      {(p.items ?? []).map((i) => <span key={i.label} class="st-item">{i.label} <b class={i.tone ?? ''}>{i.value}</b></span>)}
      <span class="sp" />
      {p.onToggleDrawer ? <button class="st-drawer" aria-pressed={!!p.drawerOpen} onClick={p.onToggleDrawer}>{t('ui.status.drawer')}</button> : null}
      {p.right ? <span class="st-right">{p.right}</span> : null}
    </div>
  );
}
