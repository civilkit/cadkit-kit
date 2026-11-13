import { useEffect, useRef, useState } from 'preact/hooks';
import { EQUATION_PRESETS, equationNotes, type EquationFields, type EquationResult } from '@kit/sketch';
import { t } from './i18n';
import { numberAttrs, textAttrs } from '@kit/ui';

/** What the Equation panel needs: the curve's fields, the kernel's answer for what is typed (null while it is asked) and the callbacks. */
export interface EquationPanelProps {
  fields: EquationFields;
  /** the `equationCurve` reply for the fields being typed: the point count, warnings, or the refusal */
  result: EquationResult | null;
  /** an edit (debounced while typing): the app asks the kernel and applies it to the sketch when it fits */
  onChange(fields: EquationFields): void;
  onDone(): void;
  onDelete(): void;
}

const DEBOUNCE_MS = 250;

/** The Equation curve panel of the sketch editor: x(t), y(t), the range of t and the tolerance, with the kernel's verdict under them. */
export function EquationPanel(p: EquationPanelProps) {
  const [f, setF] = useState<EquationFields>(p.fields);
  const [tolText, setTolText] = useState(String(p.fields.tol));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editing = useRef(false);
  // another curve picked, or the sketch changed under the panel: show its fields unless the user is typing
  useEffect(() => { if (!editing.current) { setF(p.fields); setTolText(String(p.fields.tol)); } }, [p.fields.x, p.fields.y, p.fields.t0, p.fields.t1, p.fields.tol]);
  const send = (next: EquationFields, now = false) => {
    if (timer.current) clearTimeout(timer.current);
    if (now) { p.onChange(next); return; }
    timer.current = setTimeout(() => p.onChange(next), DEBOUNCE_MS);
  };
  const set = (k: 'x' | 'y' | 't0' | 't1', v: string) => { const next = { ...f, [k]: v }; setF(next); send(next); };
  const setTol = (s: string) => {
    setTolText(s);
    const v = Number(s.trim().replace(',', '.'));
    if (s.trim() !== '' && Number.isFinite(v) && v > 0) { const next = { ...f, tol: v }; setF(next); send(next); }
  };
  const field = (k: 'x' | 'y' | 't0' | 't1', wide: boolean) => (
    <label class={'tp-field' + (wide ? ' tp-wide' : '')} data-field={k}>
      <span>{t('app.sketch.equation.' + k)}</span>
      <input {...textAttrs} type="text" value={f[k]} aria-label={t('app.sketch.equation.' + k)}
        onFocus={() => { editing.current = true; }}
        onBlur={() => { editing.current = false; }}
        onInput={(e) => set(k, (e.target as HTMLInputElement).value)}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') send({ ...f, [k]: (e.target as HTMLInputElement).value }, true); }} />
    </label>
  );
  const notes = equationNotes(p.result);
  return (
    <div class="text-panel equation-panel" role="group" aria-label={t('app.sketch.equation.title')} data-testid="equation-panel" onKeyDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <div class="tp-head"><strong>{t('app.sketch.equation.title')}</strong>
        <button type="button" class="tp-x" onClick={p.onDone} aria-label={t('app.sketch.equation.done')} title={t('app.sketch.equation.done')}>{t('app.sketch.equation.done')}</button></div>
      <label class="tp-field tp-wide" data-field="preset"><span>{t('app.sketch.equation.preset')}</span>
        <select aria-label={t('app.sketch.equation.preset')} value="" onChange={(e) => {
          const pr = EQUATION_PRESETS.find((x) => x.id === (e.target as HTMLSelectElement).value);
          if (!pr) return;
          const next = { ...pr.fields }; setF(next); setTolText(String(next.tol)); send(next, true);
        }}>
          <option value="">{t('app.sketch.equation.preset.none')}</option>
          {EQUATION_PRESETS.map((x) => <option value={x.id}>{t('app.sketch.equation.preset.' + x.id)}</option>)}
        </select></label>
      {field('x', true)}
      {field('y', true)}
      <div class="tp-row">
        {field('t0', false)}
        {field('t1', false)}
        <label class="tp-field" data-field="tol"><span>{t('app.sketch.equation.tol')} (mm)</span>
          <input {...numberAttrs('positive')} type="text" value={tolText} aria-label={t('app.sketch.equation.tol')}
            onInput={(e) => setTol((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.stopPropagation()} /></label>
      </div>
      <div class="tp-note" data-note="about">{t('app.sketch.equation.about')}</div>
      {p.result === null ? <div class="tp-note" role="status" data-note="checking">{t('app.sketch.equation.checking')}</div> : null}
      {notes.map((n) => <div class={'tp-note' + (n.key.includes('.err.') ? ' err' : n.key.includes('.warn.') ? ' warn' : '')} role="status" data-note={n.key}>{t(n.key, n.params ?? {})}</div>)}
      <div class="tp-row tp-foot"><button type="button" class="tp-btn" data-act="delete" onClick={p.onDelete}>{t('app.sketch.equation.delete')}</button></div>
    </div>
  );
}
