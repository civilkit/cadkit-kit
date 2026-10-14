import { useEffect } from 'preact/hooks';
import { t } from './i18n';

/** "Save changes first?" before something replaces the open part. Save saves and goes on, Don't save goes on, Cancel stays. */
export function DiscardDialog(p: { name: string; onSave(): void; onDiscard(): void; onCancel(): void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') p.onCancel(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  return (
    <div class="dlg-back" onMouseDown={(e) => { if (e.target === e.currentTarget) p.onCancel(); }}>
      <div class="dlg discard-dlg" role="alertdialog" aria-label={t('app.discard.title')}>
        <div class="dlg-head"><b>{t('app.discard.title')}</b></div>
        <div class="discard-body">{t('app.discard.text', { name: p.name })}</div>
        <div class="discard-actions">
          <button class="rb-btn" onClick={p.onCancel}>{t('ui.cancel')}</button>
          <button class="rb-btn" onClick={p.onDiscard}>{t('app.discard.dont')}</button>
          <button class="rb-btn ok" autofocus onClick={p.onSave}>{t('cmd.save')}</button>
        </div>
      </div>
    </div>
  );
}
