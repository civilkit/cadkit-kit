import { useEffect, useState } from 'preact/hooks';
import { t } from '../i18n';
import { ago } from './strings';
import { fileNameFor } from './names';
import './files.css';

const useEscape = (f: () => void) => useEffect(() => {
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') f(); };
  addEventListener('keydown', onKey);
  return () => removeEventListener('keydown', onKey);
}, []);

/** On start: a session was left that was never saved to a file. */
export function RestoreDialog(p: { name: string; savedAt: number; now?: number; onRestore(): void; onNew(): void }) {
  // no Escape here: dismissing must not throw the stored session away by accident
  return (
    <div class="dlg-back">
      <div class="dlg discard-dlg" role="alertdialog" aria-label={t('files.restore.title')}>
        <div class="dlg-head"><b>{t('files.restore.title')}</b></div>
        <div class="discard-body">{t('files.restore.text', { name: p.name, when: ago(p.savedAt, p.now ?? Date.now(), t) })}</div>
        <div class="discard-actions">
          <button class="rb-btn" onClick={p.onNew}>{t('files.restore.new')}</button>
          <button class="rb-btn ok" autofocus onClick={p.onRestore}>{t('files.restore.restore')}</button>
        </div>
      </div>
    </div>
  );
}

/** Save As: asks for the name. `.ckpart` is added. */
export function SaveAsDialog(p: { initial: string; onSave(fileName: string): void; onCancel(): void }) {
  const [v, setV] = useState(p.initial);
  useEscape(p.onCancel);
  const file = fileNameFor(v);
  const submit = () => { if (file) p.onSave(file); };
  return (
    <div class="dlg-back" onMouseDown={(e) => { if (e.target === e.currentTarget) p.onCancel(); }}>
      <div class="dlg discard-dlg" role="dialog" aria-label={t('files.saveAs.title')}>
        <div class="dlg-head"><b>{t('files.saveAs.title')}</b></div>
        <form class="saveas-body" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <label>{t('files.saveAs.label')}
            <input autofocus value={v} aria-label={t('files.saveAs.label')} onInput={(e) => setV((e.target as HTMLInputElement).value)} />
          </label>
          <small>{file ? t('files.saveAs.hint', { file }) : ' '}</small>
          <div class="discard-actions">
            <button type="button" class="rb-btn" onClick={p.onCancel}>{t('ui.cancel')}</button>
            <button type="submit" class="rb-btn ok" disabled={!file}>{t('files.saveAs.save')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Dashed overlay while a file is dragged over the window. */
export function DropOverlay() {
  return (
    <div class="drop-overlay" aria-hidden="true">
      <div class="drop-box"><b>{t('files.drop.title')}</b><span>{t('files.drop.hint')}</span></div>
    </div>
  );
}
