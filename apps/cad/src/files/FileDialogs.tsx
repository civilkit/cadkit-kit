import { useEffect, useState } from 'preact/hooks';
import { t } from '../i18n';
import { ago } from './strings';
import { fileNameFor, isCompressedName } from './names';
import type { Snapshot } from './snapshots';
import './files.css';

const useEscape = (f: () => void) => useEffect(() => {
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') f(); };
  addEventListener('keydown', onKey);
  return () => removeEventListener('keydown', onKey);
}, []);

/** On start: a session was left that was never saved to a file. */
export function RestoreDialog(p: { name: string; savedAt: number; now?: number; onRestore(): void; onNew(): void; onVersions?(): void }) {
  // no Escape here: dismissing must not throw the stored session away by accident
  return (
    <div class="dlg-back">
      <div class="dlg discard-dlg" role="alertdialog" aria-label={t('files.restore.title')}>
        <div class="dlg-head"><b>{t('files.restore.title')}</b></div>
        <div class="discard-body">{t('files.restore.text', { name: p.name, when: ago(p.savedAt, p.now ?? Date.now(), t) })}</div>
        <div class="discard-actions">
          {p.onVersions ? <button class="rb-btn" onClick={p.onVersions}>{t('files.restore.versions')}</button> : null}
          <button class="rb-btn" onClick={p.onNew}>{t('files.restore.new')}</button>
          <button class="rb-btn ok" autofocus onClick={p.onRestore}>{t('files.restore.restore')}</button>
        </div>
      </div>
    </div>
  );
}

/** The snapshots kept of the open part, newest first: restore any of them. */
export function RecoverDialog(p: { load(): Promise<Snapshot[]>; now?: number; onRestore(s: Snapshot): void; onClose(): void }) {
  const [list, setList] = useState<Snapshot[] | null>(null);
  useEffect(() => { void p.load().then(setList); }, []);
  useEscape(p.onClose);
  const now = p.now ?? Date.now();
  return (
    <div class="dlg-back" onMouseDown={(e) => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div class="dlg discard-dlg" role="dialog" aria-label={t('files.recover.title')}>
        <div class="dlg-head"><b>{t('files.recover.title')}</b></div>
        <div class="discard-body recover-list">
          {list === null ? null : list.length === 0 ? t('files.recover.empty') : list.map((s) => (
            <div class="recover-row" key={s.id}>
              <span>{t('files.recover.row', { name: s.name || '-', features: s.features, when: ago(s.time, now, t) })} <small>({t('files.recover.reason.' + s.reason)})</small></span>
              <button class="rb-btn ok" onClick={() => p.onRestore(s)}>{t('files.recover.restore')}</button>
            </div>
          ))}
        </div>
        <div class="discard-actions"><button class="rb-btn" autofocus onClick={p.onClose}>{t('files.recover.close')}</button></div>
      </div>
    </div>
  );
}

/** Save As: asks for the name. `.ckpart` is added, `.gz` too when compressed. */
export function SaveAsDialog(p: { initial: string; /** the "keep the built geometry in the file" box starts like this */ geometry?: boolean; onSave(fileName: string, o: { geometry: boolean }): void; onCancel(): void }) {
  const [v, setV] = useState(p.initial);
  const [geo, setGeo] = useState(!!p.geometry);
  const [gz, setGz] = useState(isCompressedName(p.initial));
  useEscape(p.onCancel);
  const file = fileNameFor(v, gz);
  const submit = () => { if (file) p.onSave(file, { geometry: geo }); };
  return (
    <div class="dlg-back" onMouseDown={(e) => { if (e.target === e.currentTarget) p.onCancel(); }}>
      <div class="dlg discard-dlg" role="dialog" aria-label={t('files.saveAs.title')}>
        <div class="dlg-head"><b>{t('files.saveAs.title')}</b></div>
        <form class="saveas-body" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <label>{t('files.saveAs.label')}
            <input autofocus value={v} aria-label={t('files.saveAs.label')} onInput={(e) => setV((e.target as HTMLInputElement).value)} />
          </label>
          <small>{file ? t('files.saveAs.hint', { file }) : ' '}</small>
          <label class="saveas-gz"><input type="checkbox" checked={gz} onChange={(e) => setGz((e.target as HTMLInputElement).checked)} />{t('files.saveAs.compress')}</label>
          <label class="saveas-gz"><input type="checkbox" checked={geo} onChange={(e) => setGeo((e.target as HTMLInputElement).checked)} />{t('files.saveAs.geometry')}</label>
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
