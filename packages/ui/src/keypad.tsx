import { useEffect, useState } from 'preact/hooks';
import { t } from './i18n';

/** How a number box asks the phone or tablet keyboard to look.
 *  - `signed`: a number that may be negative (a position, an offset, an angle, a rotation). The digit pad of many phones has no minus key,
 *    so the box carries `data-sign` and the one {@link SignKey} the app mounts shows a `±` key while it has the focus.
 *  - `positive`: a size, a count of mm, a density: the decimal pad.
 *  - `integer`: a count (teeth, copies): the digit pad. */
export type NumberKind = 'signed' | 'positive' | 'integer';

export function numberAttrs(kind: NumberKind, enterKeyHint: 'done' | 'next' | 'go' | 'enter' = 'done'): { inputMode: 'decimal' | 'numeric'; enterKeyHint: 'done' | 'next' | 'go' | 'enter'; autocomplete: 'off'; 'data-sign'?: '' } {
  return kind === 'integer' ? { inputMode: 'numeric', enterKeyHint, autocomplete: 'off' }
    : kind === 'signed' ? { inputMode: 'decimal', enterKeyHint, autocomplete: 'off', 'data-sign': '' }
      : { inputMode: 'decimal', enterKeyHint, autocomplete: 'off' };
}

/** The kind a box with this lower bound is: a number that cannot go below zero has no use for a minus key. */
export const kindForMin = (min?: number | string | null): NumberKind => (min !== undefined && min !== null && min !== '' && Number(min) >= 0 ? 'positive' : 'signed');

/** A name or a line of free text: no auto-capital, no auto-correct, no spell-check squiggles, no autofill. */
export const textAttrs = { autocapitalize: 'off', autocorrect: 'off', spellcheck: false, autocomplete: 'off' } as const;

/** A search box: the keyboard's key says Search, and the field clears with the platform's own clear control. */
export const searchAttrs = { type: 'search', enterKeyHint: 'search', ...textAttrs } as const;

/** The text with its sign flipped: a number or an expression (`-` in front, or taken away). */
export function flipSign(text: string): string {
  const s = text.trim();
  return s.startsWith('-') ? s.slice(1) : s === '' ? '-' : '-' + s;
}

/** Whether `el` is a box that wants the sign key. */
export const wantsSign = (el: Element | null): el is HTMLInputElement => !!el && el.tagName === 'INPUT' && el.hasAttribute('data-sign') && !(el as HTMLInputElement).disabled && !(el as HTMLInputElement).readOnly;

/** Put `text` in the input the way typing would (the framework hears an `input` event). */
function setText(el: HTMLInputElement, text: string): void {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (set) set.call(el, text); else el.value = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Flip the sign of the focused number box. A `number` box that holds nothing readable is left as it is (it cannot hold a lone minus). */
export function flipFocusedSign(doc: Document = document): boolean {
  const el = doc.activeElement;
  if (!wantsSign(el)) return false;
  if (el.type === 'number') { if (el.value === '' || el.validity?.badInput) return false; }
  setText(el, flipSign(el.value));
  try { el.setSelectionRange(el.value.length, el.value.length); } catch { /* a number box has no selection */ }
  return true;
}

/** The `±` key for the number boxes marked `data-sign`: it shows on a finger device while one has the focus, above the keyboard, and flips the sign of what is typed
 *  (the digit pad of many phones has no minus). A press on it must not take the focus, or the keyboard would close. Mount it once. */
export function SignKey(): preact.JSX.Element | null {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const coarse = () => !!window.matchMedia?.('(pointer: coarse)').matches;
    const check = () => setOn(coarse() && wantsSign(document.activeElement));
    const focusin = () => check();
    const focusout = () => setTimeout(check, 0);   // the next box has the focus a moment after the last one lost it
    document.addEventListener('focusin', focusin);
    document.addEventListener('focusout', focusout);
    return () => { document.removeEventListener('focusin', focusin); document.removeEventListener('focusout', focusout); };
  }, []);
  if (!on) return null;
  return (
    <button type="button" class="sign-key" data-testid="sign-key" tabIndex={-1} aria-label={t('expr.sign', undefined, 'Change sign')}
      onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()}
      onClick={() => { flipFocusedSign(); }}>{'±'}</button>
  );
}
