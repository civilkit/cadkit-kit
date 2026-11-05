import { useEffect, useState } from 'preact/hooks';
import { t } from './i18n';

export type KnurlExportAnswer = { choice: 'include' | 'plain' | 'cancel'; remember: boolean };

/** Before an export of a part with cosmetic knurls (Settings > General: ask each time): include them as real cuts, write the plain solid, or cancel. The tick keeps the answer for later exports. */
export function KnurlExportAsk(p: { count: number; onAnswer(a: KnurlExportAnswer): void }) {
  const [remember, setRemember] = useState(false);
  const answer = (choice: KnurlExportAnswer['choice']) => p.onAnswer({ choice, remember: choice !== 'cancel' && remember });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') p.onAnswer({ choice: 'cancel', remember: false }); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  return (
    <div class="dlg-back" onMouseDown={(e) => { if (e.target === e.currentTarget) answer('cancel'); }}>
      <div class="dlg discard-dlg" role="alertdialog" aria-label={t('knurl.ask.title')}>
        <div class="dlg-head"><b>{t('knurl.ask.title')}</b></div>
        <div class="discard-body">{t('knurl.ask.text', { count: p.count })}</div>
        <label class="set-row"><input type="checkbox" checked={remember} onChange={(e) => setRemember((e.currentTarget as HTMLInputElement).checked)} /><span>{t('knurl.ask.remember')}</span></label>
        <div class="discard-actions">
          <button class="rb-btn" onClick={() => answer('cancel')}>{t('ui.cancel')}</button>
          <button class="rb-btn" onClick={() => answer('plain')}>{t('knurl.ask.plain')}</button>
          <button class="rb-btn ok" autofocus onClick={() => answer('include')}>{t('knurl.ask.include')}</button>
        </div>
      </div>
    </div>
  );
}

/** The cut of the knurl grooves for an export failed or ran out of time: the reason, then the plain export or nothing (never the plain solid unasked). */
export function KnurlExportFailed(p: { reason: 'timeout' | 'failed'; message: string; onChoose(c: 'plain' | 'cancel'): void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') p.onChoose('cancel'); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  return (
    <div class="dlg-back" onMouseDown={(e) => { if (e.target === e.currentTarget) p.onChoose('cancel'); }}>
      <div class="dlg discard-dlg" role="alertdialog" aria-label={t('knurl.bakeFailed.title')}>
        <div class="dlg-head"><b>{t('knurl.bakeFailed.title')}</b></div>
        <div class="discard-body">{t(p.reason === 'timeout' ? 'knurl.bakeFailed.timeout' : 'knurl.bakeFailed.text', { reason: p.message })}</div>
        <div class="discard-actions">
          <button class="rb-btn" autofocus onClick={() => p.onChoose('cancel')}>{t('ui.cancel')}</button>
          <button class="rb-btn ok" onClick={() => p.onChoose('plain')}>{t('knurl.bakeFailed.plain')}</button>
        </div>
      </div>
    </div>
  );
}
