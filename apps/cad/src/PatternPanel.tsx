import { useEffect, useRef, useState } from 'preact/hooks';
import type { PanelRow, PanelSpec } from '@kit/sketch';
import { t } from './i18n';

export interface PatternPanelProps {
  panel: PanelSpec;
  /** a row was edited: the tool's `field` event (a number row sends its value, a choice row the index, a pick row 1 or 0) */
  onField(id: string, value: number | null, commit: boolean): void;
  /** Escape typed in a row, OK clicked */
  onKey(key: 'Enter' | 'Escape'): void;
  onCancel(): void;
}

const DEBOUNCE_MS = 160;
const round = (v: number) => Math.round(v * 1000) / 1000;

/** A number row: applies while typing (debounced) and on Enter or blur; an empty or invalid entry is not applied. Enter ends the edit, a second Enter (or OK) makes the pattern. */
function NumRow(p: { row: Extract<PanelRow, { kind: 'number' }>; onField: PatternPanelProps['onField']; onKey: PatternPanelProps['onKey'] }) {
  const { row } = p;
  const [text, setText] = useState(String(round(row.value)));
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { if (!focused.current) setText(String(round(row.value))); }, [row.value]);
  const flush = (s: string) => { const n = Number(s.trim().replace(',', '.')); if (s.trim() !== '' && Number.isFinite(n)) p.onField(row.id, n, true); };
  const unit = row.unit === 'length' ? ' (mm)' : row.unit === 'angle' ? ' (deg)' : '';
  return (
    <label class={'tp-field' + (row.locked ? ' locked' : '')} data-field={row.id}>
      <span>{t(row.label) + unit}</span>
      <input type="text" inputMode={row.unit === 'count' ? 'numeric' : 'decimal'} value={text} aria-label={t(row.label)}
        onFocus={(e) => { focused.current = true; (e.target as HTMLInputElement).select(); }}
        onInput={(e) => { const v = (e.target as HTMLInputElement).value; setText(v); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => flush(v), DEBOUNCE_MS); }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') { e.preventDefault(); if (timer.current) clearTimeout(timer.current); flush((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).blur(); }
          else if (e.key === 'Escape') { e.preventDefault(); if (timer.current) clearTimeout(timer.current); (e.target as HTMLInputElement).blur(); p.onKey('Escape'); }
        }}
        onBlur={(e) => { focused.current = false; if (timer.current) clearTimeout(timer.current); flush((e.target as HTMLInputElement).value); setText(String(round(row.value))); }} />
    </label>
  );
}

function Row(p: { row: PanelRow; onField: PatternPanelProps['onField']; onKey: PatternPanelProps['onKey'] }) {
  const { row } = p;
  if (row.kind === 'number') return <NumRow row={row} onField={p.onField} onKey={p.onKey} />;
  if (row.kind === 'choice') {
    return (
      <div class="tp-field" data-field={row.id}>
        <span>{t(row.label)}</span>
        <div class="pp-seg" role="radiogroup" aria-label={t(row.label)}>
          {row.options.map((o, i) => (
            <button type="button" role="radio" aria-checked={row.value === i} class={'pp-opt' + (row.value === i ? ' on' : '')} data-value={i} onClick={() => p.onField(row.id, i, true)}>{t(o)}</button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div class="tp-field" data-field={row.id}>
      <span>{t(row.label)}</span>
      <button type="button" class={'tp-btn' + (row.active ? ' on' : '')} aria-pressed={row.active} onClick={() => p.onField(row.id, row.active ? 0 : 1, false)}>{t(row.button)}</button>
    </div>
  );
}

/** The pattern tools' panel, in the style of the feature editors: titled groups of rows, OK and Cancel. Every edit goes to the tool at once (the copies on the canvas follow). */
export function PatternPanel(p: PatternPanelProps) {
  const { panel } = p;
  return (
    <div class="text-panel pattern-panel" role="group" aria-label={t(panel.title)} data-testid="pattern-panel"
      onKeyDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onPointerEnter={() => p.onField('freeze', 1, false)}>
      <div class="tp-head"><strong>{t(panel.title)}</strong></div>
      {panel.groups.map((g) => (
        <fieldset class="pp-group" key={g.id} data-group={g.id}>
          {g.title ? <legend>{t(g.title)}</legend> : null}
          {g.rows.map((r) => <Row key={r.id} row={r} onField={p.onField} onKey={p.onKey} />)}
        </fieldset>
      ))}
      {panel.note ? <div class="tp-note">{t(panel.note)}</div> : null}
      <div class="tp-row tp-foot">
        <button type="button" class="tp-btn" data-testid="pattern-cancel" onClick={p.onCancel}>{t('app.sketch.pattern.cancel')}</button>
        <button type="button" class="tp-btn on" data-testid="pattern-ok" disabled={!panel.canApply} onClick={() => p.onKey('Enter')}>{t('app.sketch.pattern.ok')}</button>
      </div>
    </div>
  );
}
