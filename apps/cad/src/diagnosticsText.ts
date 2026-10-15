// Plain-language text for a Diagnosis (English; every string goes through t() so a catalogue can translate it).
import { t } from '@kit/i18n';
import type { DiagConsequence, DiagRoot, Diagnosis } from './errorSummary';

const trimDot = (s: string): string => s.trim().replace(/[.\s]+$/, '');

/** Why the root failed, as a clause: the kernel's own detail when it gave one, else a short phrase for the code. */
export function reasonOf(r: DiagRoot): string {
  const detail = typeof r.params?.detail === 'string' ? r.params.detail : '';
  if (detail) return trimDot(detail);
  const known = t('diag.reason.' + r.code, undefined, '');
  if (known) return known;
  return r.code.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

/** The feature as the summary names it: "F14 Trim barrel and handle". */
export const featureTag = (x: { id: string; label: string }): string => (x.label && x.label !== x.id ? `${x.id} ${x.label}` : x.id);

/** The one-sentence summary: where the model broke, why, and how many later features were left unbuilt because of it. */
export function summaryLine(d: Diagnosis): string {
  const root = d.roots[0];
  if (!root) return '';
  let s = t('diag.summary', { feature: featureTag(root), reason: reasonOf(root) });
  const later = d.consequences.length;
  if (later) s += ' ' + t('diag.summary.later', { count: later });
  if (d.roots.length > 1) s += ' ' + t('diag.summary.others', { count: d.roots.length - 1 });
  return s;
}

/** What to try, for a root error: the advice for its code, else generic advice. */
export function adviceOf(r: DiagRoot): string {
  return t('diag.advice.' + r.code, undefined, t('diag.advice.generic'));
}

/** One consequence as a list item: "F28 Shell 2 mm: removes nothing". */
export function consequenceText(c: DiagConsequence): string {
  return `${featureTag(c)}: ${t('diag.echo.' + c.code, undefined, c.code.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase())}`;
}
