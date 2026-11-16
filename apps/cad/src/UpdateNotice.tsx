import { t } from './i18n';

/** The non-blocking "a new version is available" card: a small alert under the top bar, in its own place, not squeezed between the tabs and the
 *  ribbon. It never blocks the work; Later dismisses it. Reload goes through the unsaved-changes guard (see reloadGuarded). */
export function UpdateNotice(p: { version?: string; dirty?: boolean; onReload(): void; onLater(): void }) {
  const text = p.version ? t('app.update.text', { version: p.version }) : t('app.update.generic');
  return (
    <div class="update-note update-card" role="status">
      <div class="uc-text">
        <strong>{text}</strong>
        {p.dirty ? <span class="uc-dirty">{t('app.update.dirty')}</span> : null}
      </div>
      <div class="uc-actions">
        <button class="rb-btn uc-primary" onClick={p.onReload}>{t('app.update.refresh')}</button>
        <button class="rb-btn" onClick={p.onLater}>{t('app.update.later')}</button>
      </div>
    </div>
  );
}
