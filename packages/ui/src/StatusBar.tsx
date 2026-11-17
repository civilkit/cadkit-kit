import type { ComponentChildren, JSX } from 'preact';
import { t } from './i18n';
import { Icon } from './icons';

/** The status bar's only part in the alert system: one short chip, never a copy of the message. `unread` counts messages since the history was last opened; the chip turns
 *  red while an unread one is an error. Clicking it opens the notification history. */
export interface AlertsChip { total: number; unread: number; unreadErrors: number; open: boolean; onToggle(): void }

export interface StatusItem { label: string; value: string; tone?: 'ok' | 'warn' | 'err'; /** makes the item a button */ onClick?(): void; title?: string; icon?: string; dim?: boolean; /** counts and timings a narrow screen may leave out */ low?: boolean }

export function StatusBar(p: {
  alerts?: AlertsChip; hover: string | null; busy: boolean;
  items?: StatusItem[]; /** the sketch readout (pointer position, snap, grid): shown while sketching, before the items */ sketch?: ComponentChildren; drawerOpen?: boolean; onToggleDrawer?(): void; right?: string; /** small links at the right end (the published site's Licences and Documentation) */ links?: { label: string; href: string }[]; /** the global help button, at the right end */ help?: ComponentChildren;
}): JSX.Element {
  // every child is keyed: with only the items keyed, the items made after a sketch closes were put after the spacer and the Drawer button
  return (
    <div class="status">
      {p.busy ? <span key="@busy" class="st-busy">{t('ui.status.busy')}</span> : <span key="@ready" class="ready"><span class="dot" />{t('ui.status.ready')}</span>}
      {p.hover ? <span key="@hover" class="st-hover">{p.hover}</span> : null}
      {p.sketch ?? null}
      {p.alerts && p.alerts.total > 0 ? <button key="@alerts" class="st-item st-chip st-alerts" data-testid="alerts-chip" aria-expanded={p.alerts.open} title={t('ui.status.alerts.tip')} onClick={p.alerts.onToggle}>
        {t('ui.status.alerts')} <b class={p.alerts.unreadErrors ? 'err' : p.alerts.unread ? 'warn' : ''}>{p.alerts.unread ? p.alerts.unread : p.alerts.total}</b></button> : null}
      {(p.items ?? []).map((i) => i.onClick
        ? <button key={i.label} class={'st-item st-chip' + (i.dim ? ' dim' : '') + (i.low ? ' st-low' : '')} title={i.title} onClick={i.onClick}>{i.icon ? <Icon name={i.icon} size={14} /> : null}{i.label} <b class={i.tone ?? ''}>{i.value}</b></button>
        : <span key={i.label} class={'st-item' + (i.low ? ' st-low' : '')}>{i.label} <b class={i.tone ?? ''}>{i.value}</b></span>)}
      <span key="@sp" class="sp" />
      {p.links?.length ? <span key="@links" class="st-links">{p.links.map((l) => <a key={l.href} href={l.href} target="_blank" rel="noopener">{l.label}</a>)}</span> : null}
      {p.help ? <span key="@help" class="st-help">{p.help}</span> : null}
      {p.onToggleDrawer ? <button key="@drawer" class="st-drawer" aria-pressed={!!p.drawerOpen} onClick={p.onToggleDrawer}>{t('ui.status.drawer')}</button> : null}
      {p.right ? <span key="@right" class="st-right">{p.right}</span> : null}
    </div>
  );
}
