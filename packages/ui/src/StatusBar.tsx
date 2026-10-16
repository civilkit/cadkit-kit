import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { Notice } from '@kit/store';
import { t } from './i18n';
import { Icon } from './icons';

/** How long the newest notice stays in the status bar; the drawer's log keeps all of them. */
export const NOTICE_MS = 8000;

export interface StatusItem { label: string; value: string; tone?: 'ok' | 'warn' | 'err'; /** makes the item a button */ onClick?(): void; title?: string; icon?: string; dim?: boolean }

export function StatusBar(p: {
  notices: Notice[]; hover: string | null; busy: boolean;
  items?: StatusItem[]; /** the sketch readout (pointer position, snap, grid): shown while sketching, before the items */ sketch?: ComponentChildren; drawerOpen?: boolean; onToggleDrawer?(): void; right?: string;
}): JSX.Element {
  const newest = p.notices.at(-1);
  const [, tick] = useState(0);
  const age = newest?.at === undefined ? 0 : Date.now() - newest.at;
  const last = newest && age < NOTICE_MS ? newest : undefined;
  useEffect(() => {
    if (!last || last.at === undefined) return;
    const h = setTimeout(() => tick((n) => n + 1), Math.max(50, NOTICE_MS - (Date.now() - last.at) + 20));
    return () => clearTimeout(h);
  }, [last?.id]);
  return (
    <div class="status">
      {p.busy ? <span class="st-busy">{t('ui.status.busy')}</span> : <span class="ready"><span class="dot" />{t('ui.status.ready')}</span>}
      {p.hover ? <span class="st-hover">{p.hover}</span> : null}
      {p.sketch ?? null}
      {last ? <span class={'st-notice ' + last.level}>{last.text}</span> : null}
      {(p.items ?? []).map((i) => i.onClick
        ? <button key={i.label} class={'st-item st-chip' + (i.dim ? ' dim' : '')} title={i.title} onClick={i.onClick}>{i.icon ? <Icon name={i.icon} size={14} /> : null}{i.label} <b class={i.tone ?? ''}>{i.value}</b></button>
        : <span key={i.label} class="st-item">{i.label} <b class={i.tone ?? ''}>{i.value}</b></span>)}
      <span class="sp" />
      {p.onToggleDrawer ? <button class="st-drawer" aria-pressed={!!p.drawerOpen} onClick={p.onToggleDrawer}>{t('ui.status.drawer')}</button> : null}
      {p.right ? <span class="st-right">{p.right}</span> : null}
    </div>
  );
}
