import { useState } from 'preact/hooks';
import type { FieldSpec } from '@kit/sketch';
import { t } from './i18n';

const round = (v: number) => String(Math.round(v * 100) / 100);
/** Typed text to a number: a comma counts as the decimal point; anything else that is not a number is null. */
export const parseTyped = (text: string): number | null => {
  const n = Number(text.trim().replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(n) ? n : null;
};

/** One field. While it has focus it shows exactly what was typed ("3." and "3.5" included); otherwise the current value. */
function FieldInput(p: { f: FieldSpec; index: number; onField(id: string, value: number | null, commit: boolean): void }) {
  const { f } = p;
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      data-field={f.id}
      inputMode="decimal"
      aria-label={t(f.label)}
      value={text ?? round(f.value)}
      onInput={(e) => {
        const raw = (e.currentTarget as HTMLInputElement).value;
        setText(raw);
        p.onField(f.id, parseTyped(raw), false);
      }}
      onBlur={() => setText(null)}
      onKeyDown={(e) => {
        const el = e.currentTarget as HTMLInputElement;
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          e.stopPropagation();
          const v = parseTyped(el.value);
          if (v !== null) p.onField(f.id, v, true);
          setText(null);
          const next = el.closest('.sketch-fields')?.querySelectorAll<HTMLInputElement>('input')[p.index + 1];
          if (e.key === 'Tab' && next) { next.focus(); next.select(); } else el.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setText(null);
          p.onField(f.id, null, false);
          el.blur();
        }
      }}
    />
  );
}

/** The typed-value fields that follow the pointer while a tool draws (length, angle, radius ...).
 *  Typing changes a live preview; Tab or Enter locks the value as a driving dimension. */
export function SketchFields(p: { fields: FieldSpec[]; x: number; y: number; cls?: string; onField(id: string, value: number | null, commit: boolean): void }) {
  if (!p.fields.length) return null;
  return (
    <div class={'sketch-fields ' + (p.cls ?? '')} style={{ left: p.x + 16 + 'px', top: p.y + 16 + 'px' }} onPointerDown={(e) => e.stopPropagation()}>
      {p.fields.map((f, i) => (
        <label key={f.id} class={f.locked ? 'locked' : ''}>
          <span>{t(f.label)}</span>
          <FieldInput f={f} index={i} onField={p.onField} />
        </label>
      ))}
    </div>
  );
}
