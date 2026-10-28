import { createContext } from 'preact';
import { useContext, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { t } from './i18n';
import { EMPTY_SCOPE, ERROR_TEXT, completions, evalExpr, isExprValue, parseAssignment, parseFieldText, type ExprCode, type Scope } from './expr';

/** The variables in scope for every expression field below (the app provides it). */
export const VarsContext = createContext<Scope>(EMPTY_SCOPE);
export const useScope = (): Scope => useContext(VarsContext);

const fmt = (v: number): string => String(Math.round(v * 1e6) / 1e6);

/** The message for an expression problem, mapped from the kernel's error codes (`expr.error.<code>`). */
export function errorText(code: ExprCode, name?: string): string {
  const base = t('expr.error.' + code, undefined, ERROR_TEXT[code]);
  return name ? `${base}: ${name}` : base;
}

/**
 * A number field that also takes an expression: `=width*2+3`, a variable name, or a number. An expression is
 * stored as the string `=...` (what the kernel reads); a number stays a number. While it is an expression the
 * field is marked driven (the fx badge, click to turn it into its current number) and the evaluated value
 * shows under it; a bad one shows the error and is not applied. Variable names complete as you type.
 */
export function ExprInput(p: {
  value: number | string;
  onValue(v: number | string): void;
  unit?: string;
  label?: string;
  class?: string;
  disabled?: boolean;
  min?: number;
  max?: number;
  /** Numbers only: an expression shows a message and is not applied (fields the app computes with, like a draft angle). */
  plain?: boolean;
  /** Accept `name = value`: it shows the value under the field and applies nothing while typing (the owner defines the parameter on Enter). */
  assign?: boolean;
}): JSX.Element {
  const scope = useScope();
  const [text, setText] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const [open, setOpen] = useState(false);
  const driven = isExprValue(p.value) && !p.plain;
  const shown = text ?? (typeof p.value === 'number' ? fmt(p.value) : String(p.value));
  const parsed = parseFieldText(shown);
  const asg = p.assign && !p.plain ? parseAssignment(shown) : null;
  const res = asg ? evalExpr(asg.expr, scope.values) : parsed.kind === 'expr' ? evalExpr(parsed.expr, scope.values) : null;
  const err = p.plain && parsed.kind === 'expr' ? t('expr.error.plain', undefined, 'This field takes a plain number') : res && !res.ok ? errorText(res.code, res.name) : null;
  const value = res && res.ok ? res.value : null;
  const wantList = open && /^=|[A-Za-z_]$/.test(shown.trim());
  const items = wantList ? completions(shown, scope).slice(0, 8) : [];
  const apply = (raw: string): void => {
    setText(raw);
    setOpen(true);
    setSel(0);
    if (p.assign && parseAssignment(raw)) return;
    const q = parseFieldText(raw);
    if (q.kind === 'number') p.onValue(q.value);
    else if (q.kind === 'expr' && !p.plain && evalExpr(q.expr, scope.values).ok) p.onValue(q.expr);
  };
  const pick = (name: string): void => {
    apply(shown.replace(/([A-Za-z_][A-Za-z0-9_]*)$/, '') + name + (['sqrt', 'sin', 'cos', 'tan', 'abs'].includes(name) ? '(' : ''));
  };
  return (
    <span class={'expr-field' + (driven ? ' driven' : '') + (err ? ' bad' : '') + (p.class ? ' ' + p.class : '')}>
      <span class="expr-row">
        {driven ? (
          <button
            type="button" class="expr-fx" tabIndex={-1} disabled={p.disabled}
            title={t('expr.driven', undefined, 'Driven by an expression. Click to keep the current value as a plain number.')}
            aria-label={t('expr.unlink', undefined, 'Unlink from expression')}
            onClick={() => { if (value !== null) { setText(null); p.onValue(value); } }}
          >fx</button>
        ) : null}
        <input
          type="text" inputMode="decimal" spellcheck={false} autocomplete="off"
          aria-label={p.label} aria-invalid={err ? 'true' : undefined} disabled={p.disabled}
          value={shown}
          onInput={(e) => apply((e.currentTarget as HTMLInputElement).value)}
          onChange={(e) => apply((e.currentTarget as HTMLInputElement).value)}
          onFocus={() => setOpen(true)}
          onBlur={() => { setText(null); setOpen(false); }}
          onKeyDown={(e) => {
            if (items.length) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((sel + 1) % items.length); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel((sel + items.length - 1) % items.length); return; }
              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); pick(items[Math.min(sel, items.length - 1)].name); return; }
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); return; }
            }
          }}
        />
        {p.unit ? <span class="fedit-unit">{p.unit}</span> : null}
      </span>
      {items.length ? (
        <ul class="expr-ac" role="listbox">
          {items.map((it, i) => (
            <li key={it.name} role="option" aria-selected={i === sel} class={i === sel ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); pick(it.name); }}>
              <span class="expr-ac-name">{it.name}{it.kind === 'fn' ? '(' : ''}</span>
              {it.value !== null ? <span class="expr-ac-val">{fmt(it.value)}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {err && !(items.length && /[A-Za-z_]$/.test(shown.trim())) ? <span class="expr-hint err" role="alert">{err}</span>
        : (parsed.kind === 'expr' || asg) && value !== null ? <span class="expr-hint">= {fmt(value)}{p.unit ? ' ' + p.unit : ''}</span> : null}
    </span>
  );
}
