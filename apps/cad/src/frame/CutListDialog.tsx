// The cut list and bill of materials of the part's frames: equal pieces counted together with their stock length (long point to
// long point) and cut angles, then the stock totals and the fittings the profile library calls for. CSV saves both tables.
import { useEffect } from 'preact/hooks';
import { t } from '../i18n';
import { bom, cutList, type FrameReport } from './frameLib';

export function CutListDialog(p: { frames: FrameReport[]; onClose(): void; onCsv(): void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') p.onClose(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  const cl = cutList(p.frames);
  const b = bom(p.frames);
  const kg = (v: number) => (Math.round(v * 1000) / 1000).toString();
  return (
    <div class="dlg-back" onMouseDown={(e) => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div class="dlg cutlist-dlg" role="dialog" aria-label={t('frame.cutlist.title')} data-testid="cutlist-dialog">
        <div class="dlg-head"><b>{t('frame.cutlist.title')}</b></div>
        {!cl.length ? <div class="discard-body">{t('frame.cutlist.empty')}</div> : (
          <div class="cutlist-body">
            <table class="cutlist-table" data-testid="cutlist-table">
              <thead><tr><th>#</th><th>{t('frame.cutlist.profile')}</th><th>{t('frame.cutlist.length')}</th><th>{t('frame.cutlist.angles')}</th><th>{t('frame.cutlist.qty')}</th><th>{t('frame.cutlist.mass')}</th></tr></thead>
              <tbody>
                {cl.map((l, i) => (
                  <tr key={i} title={l.members.join(', ')}><td>{i + 1}</td><td>{l.label}</td><td>{l.length}</td><td>{l.angles[0]} / {l.angles[1]}</td><td>{l.qty}</td><td>{kg(l.massKg / l.qty)}</td></tr>
                ))}
              </tbody>
            </table>
            <div class="dlg-sub"><b>{t('frame.cutlist.bom')}</b></div>
            <table class="cutlist-table" data-testid="bom-table">
              <thead><tr><th>#</th><th>{t('frame.cutlist.part')}</th><th>{t('frame.cutlist.qty')}</th><th>{t('frame.cutlist.detail')}</th></tr></thead>
              <tbody>
                {b.map((l, i) => <tr key={l.id}><td>{i + 1}</td><td>{l.label}</td><td>{l.qty} {l.unit}</td><td>{l.detail}</td></tr>)}
              </tbody>
            </table>
          </div>
        )}
        <div class="discard-actions">
          <button class="rb-btn" onClick={p.onClose}>{t('ui.close', undefined, 'Close')}</button>
          <button class="rb-btn ok" disabled={!cl.length} onClick={p.onCsv} data-testid="cutlist-csv">{t('frame.cutlist.csv')}</button>
        </div>
      </div>
    </div>
  );
}
