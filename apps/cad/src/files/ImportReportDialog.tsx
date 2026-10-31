// The import report: one row per part of the imported file, saying what became of it (solid, surface body that needs repair, or not
// imported) and why, in the kernel's plain words with the faces concerned. Repair (when a part came in as a surface body) adds one
// undoable Repair Part step (see importReport.ts).
import { useEffect } from 'preact/hooks';
import { t } from '../i18n';
import { importSummary, needsRepair, partLine, type ImportPart } from './importReport';
import './files.css';

/** Faces named per reason before "and n more". */
const NAMED = 6;

export function ImportReportDialog(p: { name: string; parts: ImportPart[]; /** the import is view only: Repair makes it an editable part first */ viewOnly?: boolean; onRepair?(): void; onClose(): void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') p.onClose(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  const repair = needsRepair(p.parts) && p.onRepair;
  return (
    <div class="dlg-back" onMouseDown={(e) => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div class="dlg discard-dlg import-report" role="dialog" aria-label={t('import.report.title', { name: p.name })}>
        <div class="dlg-head"><b>{t('import.report.title', { name: p.name })}</b></div>
        <div class="discard-body">
          <p class="import-summary">{importSummary(p.parts, t)}</p>
          <ul class="import-parts">
            {p.parts.map((x, i) => (
              <li key={i} class={`import-part ${x.outcome}`} data-outcome={x.outcome}>
                <div class="import-part-head"><b>{x.label}</b> <span class="import-outcome">{partLine(x, t)}</span></div>
                {x.reasons.length ? (
                  <ul class="import-reasons">
                    {x.reasons.map((r, j) => (
                      <li key={j} data-code={r.code}>
                        {r.message} <code>{r.code}</code>
                        {r.faces.length ? <small> {t('import.report.faces', { faces: r.faces.slice(0, NAMED).join(', ') })}{r.faces.length > NAMED ? ' ' + t('import.report.more', { n: r.faces.length - NAMED }) : ''}</small> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
          {repair && p.viewOnly ? <small class="import-note">{t('import.report.repairEditable')}</small> : null}
        </div>
        <div class="discard-actions">
          {repair ? <button class="rb-btn ok" title={t('import.report.repair.tip')} onClick={() => p.onRepair?.()}>{t('import.report.repair')}</button> : null}
          <button class="rb-btn" autofocus onClick={p.onClose}>{t('import.report.close')}</button>
        </div>
      </div>
    </div>
  );
}
