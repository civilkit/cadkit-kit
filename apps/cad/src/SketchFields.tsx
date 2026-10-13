import type { FieldSpec } from '@kit/sketch';
import { t } from './i18n';

const round = (v: number) => String(Math.round(v * 100) / 100);

/** The typed-value fields that follow the pointer while a tool draws (length, angle, radius ...).
 *  Typing changes a live preview; Tab or Enter locks the value as a driving dimension. */
export function SketchFields(p: { fields: FieldSpec[]; x: number; y: number; onField(id: string, value: number | null, commit: boolean): void }) {
  if (!p.fields.length) return null;
  return (
    <div class="sketch-fields" style={{ left: p.x + 16 + 'px', top: p.y + 16 + 'px' }} onPointerDown={(e) => e.stopPropagation()}>
      {p.fields.map((f, i) => (
        <label key={f.id} class={f.locked ? 'locked' : ''}>
          <span>{t(f.label)}</span>
          <input
            data-field={f.id}
            inputMode="decimal"
            aria-label={t(f.label)}
            value={round(f.value)}
            onInput={(e) => {
              const v = parseFloat((e.currentTarget as HTMLInputElement).value);
              p.onField(f.id, Number.isFinite(v) ? v : null, false);
            }}
            onKeyDown={(e) => {
              const el = e.currentTarget as HTMLInputElement;
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                e.stopPropagation();
                const v = parseFloat(el.value);
                if (Number.isFinite(v)) p.onField(f.id, v, true);
                const next = el.closest('.sketch-fields')?.querySelectorAll<HTMLInputElement>('input')[i + 1];
                if (e.key === 'Tab' && next) { next.focus(); next.select(); } else el.blur();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                p.onField(f.id, null, false);
                el.blur();
              }
            }}
          />
        </label>
      ))}
    </div>
  );
}
