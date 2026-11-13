import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { ExprInput, evalExpr, parseAssignment, parseFieldText, useScope } from '@kit/ui';
import type { FieldSpec } from '@kit/sketch';
import { t } from './i18n';

/** The characters typed so far while no field had focus: a new one replaces what was there when the field was first filled (a second '-' or '.' is kept as typed). */
export const appendSeed = (buf: string, ch: string): string => buf + ch;

/** The one id of the hidden box that holds the keyboard open between a finger lifting and the value field appearing. */
export const PRIMER_ID = 'sketch-kb-primer';
/** How long the hidden box keeps the focus while it waits for a field (the solver answers in a moment). */
export const PRIMER_HOLD_MS = 1500;

/** Focus the first typed-value field of the sketch now, selected. Returns false when there is none yet.
 *  iOS raises its on-screen keyboard only for a focus() that runs inside the gesture's own event handler (pointerup, touchend, click), not later from an effect:
 *  call this from the handler that ends the gesture. */
export function focusSketchField(doc: Document = document): boolean {
  const input = doc.querySelector<HTMLInputElement>('.sketch-fields input');
  if (!input) return false;
  input.focus();
  input.select();
  return true;
}

/** The value field a tool is about to show does not exist yet when the finger lifts (the fields render a moment later), so the focus goes to a hidden box that is
 *  always in the page, inside the gesture; the field takes it over as soon as it appears (focus moving from box to box keeps the keyboard up). If no field appears the box lets go.
 *  Only on a touch or pen lift: with a mouse the field's own effect is enough. */
export function primeSketchKeyboard(doc: Document = document, win: Window = window, useField = true): boolean {
  if (useField && focusSketchField(doc)) return true;   // not for a shape that is being finished: its fields go away with the lift, and so would the focus
  const primer = doc.getElementById(PRIMER_ID) as HTMLInputElement | null;
  if (!primer) return false;
  primer.focus();
  win.setTimeout(() => { if (doc.activeElement === primer) primer.blur(); }, PRIMER_HOLD_MS);
  return doc.activeElement === primer;
}

/** A finger or pen lift is followed by the browser's own mousedown, mouseup and click, and that mousedown on the canvas takes the focus away again, so a focus made in pointerup does not last.
 *  This arms a one-shot listener: the focus is made in the `click` that follows the lift (still inside the gesture, and after the focus was taken), or dropped if no click comes within 600 ms. */
export function armKeyboardPrime(doc: Document = document, win: Window = window): void {
  let done = false;
  const off = () => { done = true; doc.removeEventListener('click', onClick, true); };
  const onClick = () => { if (!done) { off(); primeSketchKeyboard(doc, win, false); } };
  doc.addEventListener('click', onClick, true);
  win.setTimeout(() => { if (!done) off(); }, 600);
}

/** The hidden box {@link primeSketchKeyboard} focuses. Mount it once while a sketch is open. */
export function KeyboardPrimer() {
  return <input id={PRIMER_ID} class="kb-primer" type="text" inputMode="decimal" enterKeyHint="done" tabIndex={-1} aria-hidden="true" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck={false} />;
}

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
  const box = useRef<HTMLDivElement>(null);
  // the row follows the pointer; near the right or bottom edge of the drawing (a finger, a docked panel) it moves back inside, or its keys would be cut off
  useLayoutEffect(() => {
    const el = box.current, host = el?.offsetParent as HTMLElement | null;
    if (!el || !host || !host.clientWidth) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    if (p.x + 16 + w > host.clientWidth - 8) el.style.left = Math.max(8, host.clientWidth - w - 8) + 'px';
    if (p.y + 16 + h > host.clientHeight - 8) el.style.top = Math.max(8, host.clientHeight - h - 8) + 'px';
  });
  if (!p.fields.length) return null;
  return (
    <div ref={box} class={'sketch-fields ' + (p.cls ?? '')} style={{ left: p.x + 16 + 'px', top: p.y + 16 + 'px' }} onPointerDown={(e) => e.stopPropagation()}>
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
