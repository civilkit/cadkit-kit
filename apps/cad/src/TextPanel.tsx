import { useEffect, useRef, useState } from 'preact/hooks';
import { TEXT_FONTS, TEXT_H, TEXT_V, TEXT_MIN_HEIGHT, type TextFields, type TextPatch } from '@kit/sketch';
import { t } from './i18n';

/** What the Text panel needs: the entity's fields, the kernel's notes about it (warnings, a failed outline) and the callbacks. */
export interface TextPanelProps {
  fields: TextFields;
  notes: Array<{ key: string; params?: Record<string, string> }>;
  /** an edit: applied to the sketch (the preview follows) */
  onPatch(patch: TextPatch): void;
  /** the text is drawn: leave the panel (Select mode, nothing selected) */
  onDone(): void;
  onDelete(): void;
  /** ask the sketch for the next click as the arc centre */
  onPickCentre(): void;
  picking: boolean;
}

const DEBOUNCE_MS = 160;

/** A number input that applies while typing (debounced) and on Enter / blur; an empty or invalid entry is not applied. */
function NumField(p: { id: string; label: string; value: number; min?: number; step?: number; onValue(v: number): void; unit?: string }) {
  const [text, setText] = useState(String(round(p.value)));
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { if (!focused.current) setText(String(round(p.value))); }, [p.value]);
  const flush = (s: string) => { const n = Number(s.trim().replace(',', '.')); if (s.trim() !== '' && Number.isFinite(n) && (p.min === undefined || n >= p.min)) p.onValue(n); };
  return (
    <label class="tp-field" data-field={p.id}>
      <span>{p.label}{p.unit ? ' (' + p.unit + ')' : ''}</span>
      <input type="text" inputMode="decimal" value={text} aria-label={p.label}
        onFocus={(e) => { focused.current = true; (e.target as HTMLInputElement).select(); }}
        onInput={(e) => { const v = (e.target as HTMLInputElement).value; setText(v); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => flush(v), DEBOUNCE_MS); }}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { if (timer.current) clearTimeout(timer.current); flush((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).blur(); } }}
        onBlur={(e) => { focused.current = false; if (timer.current) clearTimeout(timer.current); flush((e.target as HTMLInputElement).value); setText(String(round(p.value))); }} />
    </label>
  );
}
const round = (v: number) => Math.round(v * 1000) / 1000;

/** The Text panel of the sketch editor: edits one text entity. Every change goes to the sketch at once (the outlines redraw when the kernel answers). */
export function TextPanel(p: TextPanelProps) {
  const f = p.fields;
  const [str, setStr] = useState(f.string);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { if (document.activeElement?.getAttribute('data-text-string') !== '1') setStr(f.string); }, [f.string]);
  const apply = (s: string) => { if (s.trim() !== '') p.onPatch({ string: s }); };
  const emptyNote: Array<{ key: string; params?: Record<string, string> }> = str.trim() === '' ? [{ key: 'app.sketch.text.err.Empty' }] : [];
  const small = f.height < TEXT_MIN_HEIGHT;
  const notes = [...emptyNote, ...p.notes];
  return (
    <div class="text-panel" role="group" aria-label={t('app.sketch.text.title')} data-testid="text-panel" onKeyDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <div class="tp-head"><strong>{t('app.sketch.text.title')}</strong>
        <button type="button" class="tp-x" onClick={p.onDone} aria-label={t('app.sketch.text.done')} title={t('app.sketch.text.done')}>{t('app.sketch.text.done')}</button></div>
      <label class="tp-field tp-wide" data-field="string">
        <span>{t('app.sketch.text.string')}</span>
        <input type="text" value={str} data-text-string="1" aria-label={t('app.sketch.text.string')} maxLength={500} spellcheck={false}
          onInput={(e) => { const v = (e.target as HTMLInputElement).value; setStr(v); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => apply(v), DEBOUNCE_MS); }}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { if (timer.current) clearTimeout(timer.current); apply((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).blur(); p.onDone(); } }}
          onBlur={(e) => { if (timer.current) clearTimeout(timer.current); apply((e.target as HTMLInputElement).value); }} />
      </label>
      <div class="tp-row">
        <NumField id="height" label={t('app.sketch.text.height')} value={f.height} min={0.01} unit="mm" onValue={(v) => p.onPatch({ height: v })} />
        <label class="tp-field" data-field="font"><span>{t('app.sketch.text.font')}</span>
          <select value={f.font} aria-label={t('app.sketch.text.font')} onChange={(e) => p.onPatch({ font: (e.target as HTMLSelectElement).value as 'gauge' | 'engrave' })}>
            {TEXT_FONTS.map((x) => <option value={x} selected={f.font === x}>{t('app.sketch.text.font.' + x)}</option>)}
          </select></label>
      </div>
      <div class="tp-row">
        <div class="tp-field" data-field="anchor"><span>{t('app.sketch.text.anchor')}</span>
          <div class="tp-grid" role="radiogroup" aria-label={t('app.sketch.text.anchor')}>
            {TEXT_V.map((v) => TEXT_H.map((h) => {
              const on = f.anchor[0] === h && f.anchor[1] === v;
              return <button type="button" role="radio" aria-checked={on} class={'tp-cell' + (on ? ' on' : '')} data-anchor={h + ' ' + v} title={t('app.sketch.text.anchor.' + h) + ', ' + t('app.sketch.text.anchor.' + v)}
                aria-label={t('app.sketch.text.anchor.' + h) + ', ' + t('app.sketch.text.anchor.' + v)} onClick={() => p.onPatch({ anchor: [h, v] })} />;
            }))}
          </div></div>
        <div class="tp-col">
          <NumField id="angle" label={t('app.sketch.text.angle')} value={f.angle} unit="deg" onValue={(v) => p.onPatch({ angle: v })} />
          <NumField id="spacing" label={t('app.sketch.text.spacing')} value={f.spacing} min={0.01} step={0.05} onValue={(v) => { if (v < 20) p.onPatch({ spacing: v }); }} />
        </div>
      </div>
      <label class="tp-check" data-field="mirror"><input type="checkbox" checked={f.mirror} onChange={(e) => p.onPatch({ mirror: (e.target as HTMLInputElement).checked })} /> {t('app.sketch.text.mirror')}</label>
      <label class="tp-check" data-field="onArc"><input type="checkbox" checked={!!f.arc} onChange={(e) => p.onPatch({ arc: (e.target as HTMLInputElement).checked ? {} : false })} /> {t('app.sketch.text.onArc')}</label>
      {f.arc ? (
        <div class="tp-arc" data-field="arc">
          <div class="tp-row">
            <NumField id="radius" label={t('app.sketch.text.radius')} value={f.arc.radius} min={0.01} unit="mm" onValue={(v) => p.onPatch({ arc: { radius: v } })} />
            <NumField id="angleCentre" label={t('app.sketch.text.direction')} value={f.arc.angleCentre} unit="deg" onValue={(v) => p.onPatch({ arc: { angleCentre: v } })} />
          </div>
          <div class="tp-row">
            <NumField id="cx" label={t('app.sketch.text.centreX')} value={f.arc.centre.x} onValue={(v) => p.onPatch({ arc: { centre: { x: v, y: f.arc!.centre.y } } })} />
            <NumField id="cy" label={t('app.sketch.text.centreY')} value={f.arc.centre.y} onValue={(v) => p.onPatch({ arc: { centre: { x: f.arc!.centre.x, y: v } } })} />
          </div>
          <div class="tp-row">
            <button type="button" class={'tp-btn' + (p.picking ? ' on' : '')} data-act="pick" onClick={p.onPickCentre}>{t(p.picking ? 'app.sketch.text.picking' : 'app.sketch.text.pickCentre')}</button>
            <label class="tp-field" data-field="side"><span>{t('app.sketch.text.side')}</span>
              <select value={f.arc.side} aria-label={t('app.sketch.text.side')} onChange={(e) => p.onPatch({ arc: { side: (e.target as HTMLSelectElement).value as 'outside' | 'inside' } })}>
                <option value="outside" selected={f.arc.side === 'outside'}>{t('app.sketch.text.side.outside')}</option>
                <option value="inside" selected={f.arc.side === 'inside'}>{t('app.sketch.text.side.inside')}</option>
              </select></label>
          </div>
        </div>
      ) : null}
      {small && !notes.some((n) => n.key === 'app.sketch.text.warn.TooSmall') ? <div class="tp-note warn" role="status">{t('app.sketch.text.warn.TooSmall', { detail: '' })}</div> : null}
      {notes.map((n) => <div class={'tp-note ' + (n.key.includes('.err.') ? 'err' : 'warn')} role="status" data-note={n.key}>{t(n.key, n.params ?? {})}</div>)}
      <div class="tp-row tp-foot"><button type="button" class="tp-btn" data-act="delete" onClick={p.onDelete}>{t('app.sketch.text.delete')}</button></div>
    </div>
  );
}
