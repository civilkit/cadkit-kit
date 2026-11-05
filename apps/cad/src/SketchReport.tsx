import { Sheet, type SheetSnap } from '@kit/ui';
import { t } from './i18n';
import type { ReportState, SketchReportData } from './reportData';

const stateText = (r: SketchReportData): string => {
  switch (r.state) {
    case 'full': return t('app.sketch.status.full');
    case 'under': return t('app.sketch.status.under', { count: r.dof ?? 0 });
    case 'over': return t('app.sketch.status.over');
    case 'conflict': return t('app.sketch.report.conflict');
    case 'unsolved': return t('app.sketch.status.unsolved');
    default: return t('app.sketch.report.unknown');
  }
};
const tone = (s: ReportState): string => (s === 'full' ? 'ok' : s === 'under' ? 'warn' : s === 'unknown' ? '' : 'bad');

const kindName = (type: string) => t('app.sketch.constraint.' + type, undefined, type);

/** The report itself: the same body in the floating window (desktop) and in the sheet (phone, tablet). It follows the sketch while open. */
export function SketchReportBody(p: { report: SketchReportData; onSelect(constraintId: string): void }) {
  const r = p.report;
  const row = (id: string, label: string, n: number | string) => <tr data-testid={'report-' + id}><th scope="row">{label}</th><td>{n}</td></tr>;
  return (
    <div class="sk-report" data-testid="sketch-report">
      <p class={'sr-state ' + tone(r.state)} data-testid="report-state" data-state={r.state}>
        <b>{r.name || t('app.sketch.newName')}</b> <span class="chip">{stateText(r)}</span>
      </p>
      <table>
        <tbody>
          {row('points', t('app.sketch.report.points'), r.points)}
          {row('lines', t('app.sketch.report.lines'), r.lines)}
          {row('arcs', t('app.sketch.report.arcs'), r.arcs)}
          {row('circles', t('app.sketch.report.circles'), r.circles)}
          {row('splines', t('app.sketch.report.splines'), r.splines)}
          {r.other ? row('other', t('app.sketch.report.other'), r.other) : null}
          {row('construction', t('app.sketch.report.construction'), r.construction)}
          {row('profiles', t('app.sketch.report.profiles'), r.profiles)}
          {row('open', t('app.sketch.report.open'), r.openChains)}
          {row('constraints', t('app.sketch.report.constraints'), r.constraints)}
          {row('driving', t('app.sketch.report.driving'), r.driving)}
          {row('driven', t('app.sketch.report.driven'), r.driven)}
        </tbody>
      </table>
      {r.byKind.length ? (
        <>
          <h4>{t('app.sketch.report.byKind')}</h4>
          <ul class="sr-kinds" data-testid="report-kinds">{r.byKind.map((k) => <li key={k.type}><span>{kindName(k.type)}</span><span>{k.count}</span></li>)}</ul>
        </>
      ) : null}
      <h4>{t('app.sketch.report.issues')}</h4>
      {r.issues.length === 0 && r.problems.length === 0 ? <p class="none" data-testid="report-none">{t('app.sketch.report.noIssues')}</p> : null}
      {r.issues.length ? (
        <ul class="sr-issues" data-testid="report-issues">
          {r.issues.map((i) => (
            <li key={i.id} class={i.kind === 'conflict' ? 'bad' : 'warn'}>
              <button class="sr-item" data-issue={i.id} onClick={() => p.onSelect(i.id)}>
                <b>{t(i.kind === 'conflict' ? 'app.sketch.report.kind.conflict' : 'app.sketch.report.kind.redundant')}</b> {kindName(i.type)} <span class="crefs">{i.refs.join(' · ')}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {r.problems.length ? <ul class="sr-problems">{r.problems.map((m, n) => <li key={n}>{m}</li>)}</ul> : null}
    </div>
  );
}

/** Desktop: a small window over the viewport (not modal: the sketch stays editable and the report follows it). */
export function SketchReportWindow(p: { report: SketchReportData; onSelect(id: string): void; onClose(): void }) {
  return (
    <aside class="sketch-report-win" role="dialog" aria-label={t('app.sketch.report')} data-testid="sketch-report-window">
      <header><b>{t('app.sketch.report')}</b><button class="sheet-close" aria-label={t('ui.sheet.close')} onClick={p.onClose}>{'✕'}</button></header>
      <SketchReportBody report={p.report} onSelect={p.onSelect} />
    </aside>
  );
}

/** Phone and tablet: the same body in the shared bottom sheet, left non-modal so a tap on an item shows the geometry above it. */
export function SketchReportSheet(p: { report: SketchReportData; onSelect(id: string): void; onClose(): void; snap: SheetSnap; onSnap(s: SheetSnap): void; bottom?: number }) {
  return (
    <Sheet open onClose={p.onClose} snap={p.snap} onSnap={p.onSnap} title={t('app.sketch.report')} {...(p.bottom ? { bottom: p.bottom } : {})}>
      <SketchReportBody report={p.report} onSelect={p.onSelect} />
    </Sheet>
  );
}
