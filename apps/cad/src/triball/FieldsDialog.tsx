import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../i18n';
import { numberAttrs } from '@kit/ui';

export interface DialogField {
  key: string;
  label: string;
  /** A number field (default) or a choice. */
  type?: 'number' | 'choice';
  value: number | string;
  unit?: string;
  disabled?: boolean;
  options?: Array<{ value: string; label: string }>;
  /** Smallest value accepted (default none). */
  min?: number;
  integer?: boolean;
}

/** A small modal of number fields and choices: Edit Distance, Repeated Copy, Snap Increments, Edit Position. OK returns the values by key. */
export function FieldsDialog(p: { title: string; fields: DialogField[]; onOk(values: Record<string, number | string>): void; onCancel(): void; note?: string }) {
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(p.fields.map((f) => [f.key, String(f.value)])));
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus(); first.current?.select(); }, []);
  const parsed = (f: DialogField): number | null => {
    const n = Number(vals[f.key]);
    if (vals[f.key].trim() === '' || !Number.isFinite(n)) return null;
    if (f.min !== undefined && n < f.min) return null;
    if (f.integer && !Number.isInteger(n)) return null;
    return n;
  };
  const valid = p.fields.every((f) => f.type === 'choice' || f.disabled || parsed(f) !== null);
  const ok = () => {
    if (!valid) return;
    p.onOk(Object.fromEntries(p.fields.map((f) => [f.key, f.type === 'choice' ? vals[f.key] : f.disabled ? Number(f.value) : parsed(f)!])));
  };
  const key = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); ok(); } else if (e.key === 'Escape') { e.preventDefault(); p.onCancel(); }
  };
  let firstNumber = true;
  return (
    <div class="dlg-back" onMouseDown={(e) => { if (e.target === e.currentTarget) p.onCancel(); }}>
      <div class="dlg tb-dlg" role="dialog" aria-label={p.title} onKeyDown={key}>
        <div class="dlg-head"><b>{p.title}</b></div>
        <div class="set-body">
          {p.fields.map((f) => f.type === 'choice' ? (
            <label class="set-row" key={f.key}><span>{f.label}</span>
              <select value={vals[f.key]} onChange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; setVals((o) => ({ ...o, [f.key]: v })); }}>
                {f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          ) : (
            <label class="set-row" key={f.key}><span>{f.label}</span>
              <span class="tb-field">
                <input {...numberAttrs('signed')} type="text" aria-label={f.label} disabled={f.disabled} value={vals[f.key]} ref={!f.disabled && firstNumber ? ((firstNumber = false), first) : undefined}
                  aria-invalid={!f.disabled && parsed(f) === null} onInput={(e) => { const v = (e.currentTarget as HTMLInputElement).value; setVals((o) => ({ ...o, [f.key]: v })); }} />
                {f.unit ? <span class="tb-unit">{f.unit}</span> : null}
              </span>
            </label>
          ))}
          {p.note ? <div class="tb-note">{p.note}</div> : null}
        </div>
        <div class="dlg-foot">
          <button class="rb-btn" onClick={p.onCancel}>{t('triball.cancel')}</button>
          <button class="rb-btn tb-ok" disabled={!valid} onClick={ok}>{t('triball.ok')}</button>
        </div>
      </div>
    </div>
  );
}
