// The Analysis section of the Display popover and the colour legend drawn over the viewport (see analysisState.ts).
import type { JSX } from 'preact';
import { ANALYSIS_MODES, diverging, type AnalysisOptions, type Legend } from '@kit/viewport';
import { PULL_DIRECTIONS, pullId } from './analysisState';
import { t } from './i18n';

export function AnalysisSection(p: { opts: AnalysisOptions; onChange(patch: Partial<AnalysisOptions>): void }): JSX.Element {
  const o = p.opts;
  return (
    <div data-section="analysis">
      <div class="display-head">{t('analysis.title')}</div>
      <label class="display-field">
        <span>{t('analysis.mode')}</span>
        <select aria-label={t('analysis.mode')} id="dm-analysis" value={o.mode} onChange={(e) => p.onChange({ mode: (e.currentTarget as HTMLSelectElement).value as AnalysisOptions['mode'] })}>
          {ANALYSIS_MODES.map((m) => <option key={m} value={m}>{t('analysis.mode.' + m)}</option>)}
        </select>
      </label>
      {o.mode === 'zebra' ? (
        <label class="display-field"><span>{t('analysis.density')}</span>
          <input type="range" aria-label={t('analysis.density')} min="4" max="40" step="1" value={o.zebraDensity} onInput={(e) => p.onChange({ zebraDensity: Number((e.currentTarget as HTMLInputElement).value) })} /></label>
      ) : null}
      {o.mode === 'draft' ? (
        <>
          <label class="display-field"><span>{t('analysis.pull')}</span>
            <select aria-label={t('analysis.pull')} id="dm-pull" value={pullId(o.pull)} onChange={(e) => p.onChange({ pull: PULL_DIRECTIONS.find((d) => d.id === (e.currentTarget as HTMLSelectElement).value)!.v })}>
              {PULL_DIRECTIONS.map((d) => <option key={d.id} value={d.id}>{d.id.toUpperCase()}</option>)}
            </select></label>
          <label class="display-field"><span>{t('analysis.draftMin')}</span>
            <input type="number" inputMode="decimal" enterKeyHint="done" aria-label={t('analysis.draftMin')} min="0" max="45" step="0.5" value={o.draftMin} onChange={(e) => p.onChange({ draftMin: Number((e.currentTarget as HTMLInputElement).value) })} /></label>
        </>
      ) : null}
      <label class="display-row">
        <input type="checkbox" id="dm-comb" checked={o.comb} onChange={(e) => p.onChange({ comb: (e.currentTarget as HTMLInputElement).checked })} />
        <span>{t('analysis.comb')}</span>
      </label>
      {o.comb ? (
        <label class="display-field"><span>{t('analysis.combScale')}</span>
          <input type="range" aria-label={t('analysis.combScale')} min="0.25" max="4" step="0.25" value={o.combScale} onInput={(e) => p.onChange({ combScale: Number((e.currentTarget as HTMLInputElement).value) })} /></label>
      ) : null}
    </div>
  );
}

const css = (c: readonly number[]): string => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
const fmt = (v: number): string => (v === 0 ? '0' : Math.abs(v) >= 0.01 && Math.abs(v) < 1000 ? v.toPrecision(2) : v.toExponential(1));

/** The colour bar of the analysis on screen (curvature: blue to red through white; draft: the three classes). */
export function AnalysisLegend(p: { legend: Legend | null }): JSX.Element | null {
  const l = p.legend;
  if (!l) return null;
  if (l.bands) {
    return (
      <div class="analysis-legend" role="img" aria-label={t('analysis.legend.draft')}>
        <b>{t('analysis.legend.draft')}</b>
        {l.bands.map((b) => <div class="analysis-band" key={b.label}><i style={{ background: css(b.color) }} />{b.label}</div>)}
      </div>
    );
  }
  const stops = Array.from({ length: 9 }, (_, i) => css(diverging(1 - i / 4))).join(',');
  return (
    <div class="analysis-legend" role="img" aria-label={t('analysis.mode.' + l.mode)}>
      <b>{t('analysis.mode.' + l.mode)}</b>
      <div class="analysis-bar" style={{ background: `linear-gradient(to bottom, ${stops})` }} />
      <div class="analysis-ticks"><span>{fmt(l.max)}</span><span>0</span><span>{fmt(l.min)}</span></div>
      <small>{l.unit}</small>
    </div>
  );
}
