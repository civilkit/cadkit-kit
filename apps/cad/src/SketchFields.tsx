import { useEffect, useRef } from 'preact/hooks';
import { ExprInput, evalExpr, parseAssignment, parseFieldText, useScope } from '@kit/ui';
import type { FieldSpec } from '@kit/sketch';
import { t } from './i18n';

/** The characters typed so far while no field had focus: a new one replaces what was there when the field was first filled (a second '-' or '.' is kept as typed). */
export const appendSeed = (buf: string, ch: string): string => buf + ch;

const round = (v: number) => String(Math.round(v * 100) / 100);
/** Typed text to a number: a comma counts as the decimal point; anything else that is not a number is null. */
export const parseTyped = (text: string): number | null => {
  const n = Number(text.trim().replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(n) ? n : null;
};

/** ArrowUp / ArrowDown on a value box: the typed number one step up or down (1; Shift 10; Alt 0.1; a count steps by whole numbers, at least 1).
 *  Only a plain number is stepped: an expression or a name is left alone (null). */
export function stepText(text: string, dir: 1 | -1, mod: { shift?: boolean; alt?: boolean } = {}, integer = false): string | null {
  const n = parseTyped(text);
  if (n === null) return null;
  const step = integer ? (mod.shift ? 10 : 1) : mod.shift ? 10 : mod.alt ? 0.1 : 1;
  return String(Math.round((n + dir * step) * 1e9) / 1e9);
}

/** One field. Takes a number or an expression (`=w*2`, a variable name): while it has focus it shows exactly what was typed;
 *  the evaluated value drives the live preview and, on Enter or Tab, the expression is kept with the dimension.
 *  `name = value` defines the parameter `name` (when the owner takes `onDefine`) and links the field to it. */
function FieldInput(p: { f: FieldSpec; index: number; last: boolean; seed?: { n: number; text: string | null }; target: boolean; onField(id: string, value: number | null, commit: boolean, expr?: string): void; onDefine?(name: string, expr: string): Promise<boolean> }) {
  const { f } = p;
  const scope = useScope();
  const emit = (value: number | null, commit: boolean, expr?: string): void => { if (expr !== undefined) p.onField(f.id, value, commit, expr); else p.onField(f.id, value, commit); };
  const latest = useRef<{ value: number; expr?: string } | null>(null);
  const box = useRef<HTMLSpanElement>(null);
  // typing started while nothing had focus: the first field takes the text, whole (it replaces whatever it showed), and the caret goes to the end
  useEffect(() => {
    if (!p.target || !p.seed || p.seed.n === 0) return;
    const input = box.current?.querySelector('input');
    if (!input) return;
    input.focus();
    if (p.seed.text === null) { input.select(); return; }   // focus only: the field offers its value, selected, ready to be typed over
    input.value = p.seed.text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.setSelectionRange(input.value.length, input.value.length);
  }, [p.seed?.n, p.target]);
  const resolve = (v: number | string): { value: number; expr?: string } | null => {
    if (typeof v === 'number') return { value: v };
    const r = evalExpr(v, scope.values);
    return r.ok ? { value: r.value, expr: v.replace(/^\s*=\s*/, '') } : null;
  };
  return (
    <span
      ref={box}
      data-field={f.id}
      onFocusIn={(e) => { const el = e.target as HTMLInputElement; if (el.select) el.select(); }}
      onKeyDown={(e) => {
        const el = e.target as HTMLInputElement;
        if (e.key === 'Enter' || e.keyCode === 13 || e.key === 'Tab') {   // a phone's check key may send keyCode 13 under another key name
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
        } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && el.tagName === 'INPUT') {
          const next = stepText(el.value, e.key === 'ArrowUp' ? 1 : -1, { shift: e.shiftKey, alt: e.altKey }, f.unit === 'count');
          if (next === null) return;   // an expression: the key keeps whatever it did
          e.preventDefault();
          e.stopPropagation();
          el.value = next;
          el.dispatchEvent(new Event('input', { bubbles: true }));   // the live preview follows, as with typing
          el.setSelectionRange(next.length, next.length);
        } else if (e.key === 'Escape' || e.keyCode === 27) {
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
        integer={f.unit === 'count'}
        grow
        enterKeyHint={p.last ? 'done' : 'next'}
        onValue={(v) => { const got = resolve(v); latest.current = got; if (got) emit(got.value, false, got.expr); }}
      />
    </span>
  );
}

/** The typed-value fields that follow the pointer while a tool draws (length, angle, radius ...).
 *  Typing changes a live preview; Tab or Enter locks the value as a driving dimension. */
export function SketchFields(p: { fields: FieldSpec[]; x: number; y: number; cls?: string; /** typing that started with no field focused: the first field takes `text` (bump `n` for each new key) */ seed?: { n: number; text: string | null }; onField(id: string, value: number | null, commit: boolean, expr?: string): void; /** define the parameter a `name = value` entry names; resolves false when it was refused */ onDefine?(name: string, expr: string): Promise<boolean> }) {
  if (!p.fields.length) return null;
  return (
    <div class={'sketch-fields ' + (p.cls ?? '')} style={{ left: p.x + 16 + 'px', top: p.y + 16 + 'px' }} onPointerDown={(e) => e.stopPropagation()}>
      {p.fields.map((f, i) => (
        <label key={f.id} class={f.locked ? 'locked' : ''}>
          <span>{t(f.label)}</span>
          <FieldInput f={f} index={i} last={i === p.fields.length - 1} onField={p.onField} onDefine={p.onDefine} seed={p.seed} target={i === 0} />
          {f.toggle ? <button type="button" class={'fld-toggle' + (f.toggle.on ? ' on' : '')} data-testid={'field-' + f.toggle.id} aria-pressed={f.toggle.on} aria-label={t(f.toggle.tip)} title={t(f.toggle.tip)}
            onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.preventDefault(); p.onField(f.toggle!.id, f.toggle!.on ? 0 : 1, false); }}>{t(f.toggle.label)}</button> : null}
        </label>
      ))}
    </div>
  );
}
