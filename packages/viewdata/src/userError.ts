// A raw exception or importer message as a clause a person can read ("Could not import X: <clause>"). Known failures get their own
// sentence; text that already reads as plain English is kept; everything else becomes one neutral sentence (the raw text stays in
// the console and the Details view, never in a toast).
import { t } from '@kit/i18n';
import { plainEnough } from './diagnosticsText';

const RULES: Array<[RegExp, string]> = [
  [/out of memory|allocation failed|memory access out of bounds|invalid (array|typed array) length|array buffer allocation/i, 'err.reason.memory'],
  [/cancel|abort/i, 'err.reason.cancelled'],
  [/network|failed to fetch|load failed|timeout|timed out|offline|econn|http \d{3}/i, 'err.reason.network'],
  [/unexpected end|truncated|corrupt|invalid (zip|header|signature|magic)|bad (magic|signature)|not a valid|unsupported format|unrecogni[sz]ed|parse error|unexpected token|end of file|\beof\b/i, 'err.reason.damaged'],
  [/unreachable|runtimeerror|panick|wasm|stack overflow|null function|call_indirect/i, 'err.reason.internal'],
];

export function userReason(raw: unknown): string {
  const s = (typeof raw === 'string' ? raw : raw instanceof Error ? raw.message : '').trim();
  if (!s) return t('err.reason.unknown');
  for (const [re, key] of RULES) if (re.test(s)) return t(key);
  const one = s.replace(/[.\s]+$/, '');
  const trace = /\bat \S+ \(|\b[A-Za-z]*Error\b|:\d+:\d+|\.(js|ts|rs|wasm)\b/.test(one);   // an exception's own text or a stack line
  return !trace && plainEnough(one) ? one.charAt(0).toLowerCase() + one.slice(1) : t('err.reason.unknown');
}
