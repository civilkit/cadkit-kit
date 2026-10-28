import { useRef } from 'preact/hooks';
import { ExprInput, evalExpr, parseAssignment, parseFieldText, useScope } from '@kit/ui';
import type { FieldSpec } from '@kit/sketch';
import { t } from './i18n';

const round = (v: number) => String(Math.round(v * 100) / 100);
/** Typed text to a number: a comma counts as the decimal point; anything else that is not a number is null. */
export const parseTyped = (text: string): number | null => {
  const n = Number(text.trim().replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(n) ? n : null;
};

/** One field. Takes a number or an expression (`=w*2`, a variable name): while it has focus it shows exactly what was typed;
 *  the evaluated value drives the live preview and, on Enter or Tab, the expression is kept with the dimension.
 *  `name = value` defines the parameter `name` (when the owner takes `onDefine`) and links the field to it. */
function FieldInput(p: { f: FieldSpec; index: number; onField(id: string, value: number | null, commit: boolean, expr?: string): void; onDefine?(name: string, expr: string): Promise<boolean> }) {
  const { f } = p;
  const scope = useScope();
  const emit = (value: number | null, commit: boolean, expr?: string): void => { if (expr !== undefined) p.onField(f.id, value, commit, expr); else p.onField(f.id, value, commit); };
  const latest = useRef<{ value: number; expr?: string } | null>(null);
  const resolve = (v: number | string): { value: number; expr?: string } | null => {
    if (typeof v === 'number') return { value: v };
    const r = evalExpr(v, scope.values);
    return r.ok ? { value: r.value, expr: v.replace(/^\s*=\s*/, '') } : null;
  };
  return (
    <span
      data-field={f.id}
      onKeyDown={(e) => {
        const el = e.target as HTMLInputElement;
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          e.stopPropagation();
          const asg = p.onDefine ? parseAssignment(el.value) : null;
          const val = asg ? evalExpr(asg.expr, scope.values) : null;
          if (asg && val?.ok) {
            const next = el.closest('.sketch-fields')?.querySelectorAll<HTMLInputElement>('input')[p.index + 1];
            void p.onDefine!(asg.name, asg.expr).then((ok) => { if (ok) emit(val.value, true, asg.name); });
            latest.current = null;
            if (e.key === 'Tab' && next) { next.focus(); next.select(); } else el.blur();
            return;
          }
          const q = parseFieldText(el.value);
          const got = q.kind === 'number' ? { value: q.value } : q.kind === 'expr' ? resolve(q.expr) : null;
          if (got) emit(got.value, true, got.expr);
          latest.current = null;
          const next = el.closest('.sketch-fields')?.querySelectorAll<HTMLInputElement>('input')[p.index + 1];
          if (e.key === 'Tab' && next) { next.focus(); next.select(); } else el.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          latest.current = null;
          emit(null, false);
          el.blur();
        }
      }}
    >
      <ExprInput
        value={f.expr ? '=' + f.expr : Math.round(f.value * 100) / 100}
        label={t(f.label)}
        assign={!!p.onDefine}
        onValue={(v) => { const got = resolve(v); latest.current = got; if (got) emit(got.value, false, got.expr); }}
      />
    </span>
  );
}

/** The typed-value fields that follow the pointer while a tool draws (length, angle, radius ...).
 *  Typing changes a live preview; Tab or Enter locks the value as a driving dimension. */
export function SketchFields(p: { fields: FieldSpec[]; x: number; y: number; cls?: string; onField(id: string, value: number | null, commit: boolean, expr?: string): void; /** define the parameter a `name = value` entry names; resolves false when it was refused */ onDefine?(name: string, expr: string): Promise<boolean> }) {
  if (!p.fields.length) return null;
  return (
    <div class={'sketch-fields ' + (p.cls ?? '')} style={{ left: p.x + 16 + 'px', top: p.y + 16 + 'px' }} onPointerDown={(e) => e.stopPropagation()}>
      {p.fields.map((f, i) => (
        <label key={f.id} class={f.locked ? 'locked' : ''}>
          <span>{t(f.label)}</span>
          <FieldInput f={f} index={i} onField={p.onField} onDefine={p.onDefine} />
        </label>
      ))}
    </div>
  );
}
