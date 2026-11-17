import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { Notice } from '@kit/store';
import { t } from './i18n';
import { copyText } from './clipboard';

const ICON = { info: 'i', success: '✓', warning: '!', error: '✕' } as const;
const clock = (at: number): string => { try { return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch { return ''; } };

/** The notification history: the last messages, newest first, so an alert that was missed (or closed) can be read again. Opened from the status-bar chip or the command palette. */
export function NotificationHistory(p: { history: Notice[]; onClose(): void; onClear(): void }): JSX.Element {
  const [copied, setCopied] = useState<number | null>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); p.onClose(); } };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [p.onClose]);
  const rows = [...p.history].reverse();
  return (
    <div class="alert-history" role="dialog" aria-label={t('ui.alert.history')} data-testid="alert-history">
      <div class="ah-head">
        <b>{t('ui.alert.history')}</b>
        <span class="sp" />
        {rows.length ? <button type="button" class="ah-btn" onClick={p.onClear}>{t('ui.alert.clear')}</button> : null}
        <button type="button" class="ah-btn ah-close" aria-label={t('ui.alert.close')} onClick={p.onClose}>{'×'}</button>
      </div>
      {rows.length === 0 ? <p class="ah-empty">{t('ui.alert.empty')}</p> : (
        <ul class="ah-list">
          {rows.map((n) => (
            <li key={n.id} class={'ah-row ' + n.level} data-level={n.level}>
              <span class="toast-icon" aria-hidden="true">{ICON[n.level]}</span>
              <span class="ah-text">{n.text}</span>
              {n.count > 1 ? <span class="toast-count">{'×'}{n.count}</span> : null}
              <span class="ah-time">{clock(n.at)}</span>
              <button type="button" class="ah-btn" onClick={async () => { if (await copyText(n.text)) { setCopied(n.id); setTimeout(() => setCopied(null), 1500); } }}>{copied === n.id ? t('ui.alert.copied') : t('ui.alert.copy')}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
