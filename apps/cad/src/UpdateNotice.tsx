import { t } from './i18n';

/** The non-blocking "a new version is available" note in the top bar. Reload goes through the unsaved-changes guard (see reloadGuarded). */
export function UpdateNotice(p: { version?: string; dirty?: boolean; onReload(): void; onLater(): void }) {
  const text = (p.version ? t('app.update.text', { version: p.version }) : t('app.update.generic')) + (p.dirty ? ` ${t('app.update.dirty')}` : '');
  return (
    <span class="update-note" role="status">
      <span title={text}>{text}</span>
      <button class="rb-btn" onClick={p.onReload}>{t('app.update.refresh')}</button>
      <button class="rb-btn" onClick={p.onLater}>{t('app.update.later')}</button>
    </span>
  );
}
