// Message catalogues and t(). English is the source of truth and the fallback; another language is one more
// catalogue registered under its locale code, so a language file never touches component code.
//
//   registerCatalog('en', { 'ui.close': 'Close', 'ui.items': { one: '{count} item', other: '{count} items' } });
//   t('ui.close');                 // 'Close'
//   t('ui.items', { count: 3 });   // '3 items'  (plural form picked by Intl.PluralRules for the locale)
//
// Missing keys fall back to English, then to the key itself, and are recorded in `missing()` so a test or a
// translator can list them. The pseudo-locale 'en-XA' accents and pads English so hard-coded text and
// truncation show up at a glance.
import { signal } from '@preact/signals-core';

export type Params = Record<string, string | number>;
export type Message = string | Record<string, string>;     // a string, or plural forms {zero, one, two, few, many, other}
export type Catalog = Record<string, Message>;

const catalogs = new Map<string, Catalog>();
const miss = new Set<string>();
/** Current locale; a signal so anything that reads it re-renders when the language changes. */
export const locale = signal('en');
export const FALLBACK = 'en';
export const PSEUDO = 'en-XA';

export function registerCatalog(code: string, strings: Catalog): void {
  catalogs.set(code, { ...(catalogs.get(code) ?? {}), ...strings });
}
export function hasCatalog(code: string): boolean { return catalogs.has(code); }
export function setLocale(code: string): void { locale.value = code; }
export function getLocale(): string { return locale.value; }
export function availableLocales(): string[] { return [...catalogs.keys()]; }
export function missing(): string[] { return [...miss].sort(); }
export function resetMissing(): void { miss.clear(); }

const ACCENT: Record<string, string> = { a: 'à', e: 'é', i: 'ï', o: 'ö', u: 'ü', A: 'Å', E: 'É', I: 'Ï', O: 'Ö', U: 'Ü', c: 'ç', n: 'ñ', y: 'ý', s: 'š' };
function pseudo(text: string): string {
  let out = '';
  let inBrace = false;
  for (const ch of text) {
    if (ch === '{') inBrace = true;
    out += inBrace ? ch : (ACCENT[ch] ?? ch);
    if (ch === '}') inBrace = false;
  }
  return `[!! ${out}${'~'.repeat(Math.ceil(text.length * 0.3))} !!]`;
}

function lookup(code: string, key: string): Message | undefined {
  return catalogs.get(code)?.[key];
}

function pick(msg: Message, code: string, count: number | undefined): string | undefined {
  if (typeof msg === 'string') return msg;
  if (count === undefined) return msg.other ?? Object.values(msg)[0];
  const rule = new Intl.PluralRules(code === PSEUDO ? 'en' : code).select(count);
  return msg[rule] ?? msg.other;
}

function fill(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}

/** Translate `key`. A missing key returns `fallback` when given (no warning), else the key. */
export function t(key: string, params?: Params, fallback?: string): string {
  const code = locale.value;
  const lang = code === PSEUDO ? FALLBACK : code;
  const count = typeof params?.count === 'number' ? params.count : undefined;
  let msg = lookup(lang, key);
  let text = msg === undefined ? undefined : pick(msg, lang, count);
  if (text === undefined && lang !== FALLBACK) {
    msg = lookup(FALLBACK, key);
    text = msg === undefined ? undefined : pick(msg, FALLBACK, count);
    if (text !== undefined || fallback === undefined) miss.add(`${lang}:${key}`);
  }
  if (text === undefined) {
    if (fallback !== undefined) return fill(fallback, params);
    miss.add(`${FALLBACK}:${key}`);
    return key;
  }
  return fill(code === PSEUDO ? pseudo(text) : text, params);   // accent the template, not the values put into it
}
