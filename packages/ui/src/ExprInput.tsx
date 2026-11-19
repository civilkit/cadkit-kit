import { createContext } from 'preact';
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { t } from './i18n';
import { EMPTY_SCOPE, ERROR_TEXT, completions, evalExpr, isExprValue, parseAssignment, parseFieldText, type ExprCode, type Scope } from './expr';

/** The variables in scope for every expression field below (the app provides it). */
export const VarsContext = createContext<Scope>(EMPTY_SCOPE);
export const useScope = (): Scope => useContext(VarsContext);

/** Pixel width for a monospace value box holding `text`: the usual 64 px, then one character at a time up to a cap. */
export const growWidth = (text: string): number => Math.min(320, Math.max(64, Math.ceil(text.length * 8 + 16)));

/** Where the completion list goes: below the field unless it does not fit there and there is more room above (then it flips up), and shifted left when its width would run past the right edge.
 *  `field` is the box's rect, `list` the list's size, `view` the viewport size. */
export function placePopup(field: { left: number; top: number; bottom: number }, list: { width: number; height: number }, view: { width: number; height: number }, margin = 8): { up: boolean; shiftX: number; maxHeight: number } {
  const below = view.height - field.bottom - margin, above = field.top - margin;
  const up = list.height > below && above > below;
  const room = up ? above : below;
  const over = field.left + list.width - (view.width - margin);
  return { up, shiftX: over > 0 ? -Math.min(over, Math.max(0, field.left - margin)) : 0, maxHeight: Math.max(60, Math.min(180, room)) };
}

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
/** Change a field's soft keyboard. iOS reads `inputmode` only when a field gains focus, so a change on the focused field does nothing until the field is left and entered again:
 *  set the attribute, then blur and focus in the same tap (a later focus() would lose the tap and the keyboard would stay shut). */
export function switchKeyboard(el: HTMLInputElement | null, mode: 'text' | 'decimal' | 'numeric'): void {
  if (!el) return;
  el.inputMode = mode;
  el.blur();
  el.focus();
}

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
  /** Whole numbers only (a count): the keypad is the digit pad, `numeric`, and there is no sign key. */
  integer?: boolean;
  /** The Enter key's label on a phone keyboard: `next` when another field follows, else `done`. */
  enterKeyHint?: 'done' | 'next' | 'go' | 'enter';
  /** Widen the box with what is typed, so a formula is not cut off (a box whose width the stylesheet fixes, like the sketch's value fields). */
  grow?: boolean;
}): JSX.Element {
  const scope = useScope();
  const [text, setText] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const [open, setOpen] = useState(false);
  // The digit keypad has no letters, so a formula or a variable name needs the full keyboard: "ƒ" switches to it (a driven field starts there).
  const [full, setFull] = useState(() => isExprValue(p.value) && !p.plain);
  const input = useRef<HTMLInputElement>(null);
  const switching = useRef(false);
  const driven = isExprValue(p.value) && !p.plain;
  const shown = text ?? (typeof p.value === 'number' ? fmt(p.value) : String(p.value));
  const parsed = parseFieldText(shown);
  const asg = p.assign && !p.plain ? parseAssignment(shown) : null;
  const res = asg ? evalExpr(asg.expr, scope.values) : parsed.kind === 'expr' ? evalExpr(parsed.expr, scope.values) : null;
  const err = p.plain && parsed.kind === 'expr' ? t('expr.error.plain', undefined, 'This field takes a plain number') : res && !res.ok ? errorText(res.code, res.name) : null;
  const value = res && res.ok ? res.value : null;
  const wantList = open && /^=|[A-Za-z_]$/.test(shown.trim());
  const items = wantList ? completions(shown, scope).slice(0, 8) : [];
  const list = useRef<HTMLUListElement>(null);
  // keep the list on screen (flip above near the bottom edge, shift left near the right edge) and the active row in view
  useLayoutEffect(() => {
    const ul = list.current, host = ul?.parentElement;
    if (!ul || !host || typeof innerWidth !== 'number') return;
    ul.style.transform = ''; ul.classList.remove('up'); ul.style.maxHeight = '';
    const f = host.getBoundingClientRect(), l = ul.getBoundingClientRect();
    if (!l.width) return;
    const pl = placePopup(f, { width: l.width, height: ul.scrollHeight + 8 }, { width: innerWidth, height: innerHeight });
    ul.style.maxHeight = pl.maxHeight + 'px';
    if (pl.up) ul.classList.add('up');
    if (pl.shiftX) ul.style.transform = `translateX(${pl.shiftX}px)`;
  }, [items.length, items[0]?.name, shown]);
  useEffect(() => { (list.current?.children[sel] as HTMLElement | undefined)?.scrollIntoView?.({ block: 'nearest' }); }, [sel, items.length]);
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
  // The digit keypad of many phones lacks a minus: this key flips the sign of the number (or of the whole expression) at the caret-free level.
  const flip = (): void => {
    const cur = shown.trim();
    apply(cur.startsWith('-') ? cur.slice(1) : cur === '' ? '-' : '-' + cur);
    input.current?.focus();
  };
  const canNegate = p.min === undefined || p.min < 0;
  const keep = (e: Event): void => e.preventDefault();   // a key beside the field must not take the focus (the keyboard would close)
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
        <span class="expr-box">
          <input
            ref={input} type="text" inputMode={full ? 'text' : p.integer ? 'numeric' : 'decimal'} enterKeyHint={p.enterKeyHint ?? 'done'} spellcheck={false} autocomplete="off"
            aria-label={p.label} aria-invalid={err ? 'true' : undefined} disabled={p.disabled}
            value={shown}
            style={p.grow ? { width: growWidth(shown) + 'px' } : undefined}
            onInput={(e) => apply((e.currentTarget as HTMLInputElement).value)}
            onChange={(e) => apply((e.currentTarget as HTMLInputElement).value)}
            onFocus={() => setOpen(true)}
            onBlur={() => { if (switching.current) return; setText(null); setOpen(false); }}
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
        {p.plain ? null : <button type="button" class={'expr-kb' + (full ? ' on' : '')} tabIndex={-1} disabled={p.disabled} aria-pressed={full} data-testid="expr-kb"
          aria-label={full ? t('expr.kb.digits', undefined, 'Number keypad') : t('expr.kb.full', undefined, 'Full keyboard (formulas and variables)')}
          onMouseDown={keep} onClick={() => { const next = !full; setFull(next); switching.current = true; switchKeyboard(input.current, next ? 'text' : p.integer ? 'numeric' : 'decimal'); switching.current = false; }}>{full ? '123' : 'ƒ'}</button>}
        {p.integer || !canNegate || full ? null : <button type="button" class="expr-sign" tabIndex={-1} disabled={p.disabled} data-testid="expr-sign"
          aria-label={t('expr.sign', undefined, 'Change sign')} onMouseDown={keep} onClick={flip}>{'±'}</button>}
      </span>
      {items.length ? (
        <ul ref={list} class="expr-ac" role="listbox">
          {items.map((it, i) => (
            <li key={it.name} role="option" aria-selected={i === sel} class={i === sel ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); pick(it.name); }}>
              <span class="expr-ac-name" title={it.name}>{it.name}{it.kind === 'fn' ? '(' : ''}</span>
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
