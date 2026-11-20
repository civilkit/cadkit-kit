// Kernel warnings of the committed build as the feature tree and the Diagnostics tab show them: a feature that built
// but is flagged. Generic for any warning code: the text is `diag.reason.<code>` (and `diag.advice.<code>`) when the
// catalogue has it, else a plain "built with a warning" line with the kernel's own sentence, so nothing is dropped.
import { t, type Params } from '@kit/i18n';
import type { FeatureWarning } from '@kit/store';

export interface WarningEntry {
  featureId: string;
  /** The feature's name (or its type) for the link in the Diagnostics tab. */
  label: string;
  code: string;
  /** What is wrong, one sentence. */
  text: string;
  /** What to do about it ('' when there is nothing to add). */
  advice: string;
}

/** Thread warnings carry their own sentences and are acted on in the thread editor (Use M6, the fit line): kept as the kernel wrote them. */
const OWN_TEXT = /^thread/;

const num = (x: number): string => String(Math.round(x * 1000) / 1000);

/** Warning params as i18n values: numbers rounded, lists of numbers as "3 and 2", strings as they are. */
export function paramValues(params: Record<string, unknown> | undefined): Params {
  const out: Params = {};
  for (const [k, v] of Object.entries(params ?? {})) {
    if (typeof v === 'number') out[k] = num(v);
    else if (typeof v === 'string') out[k] = v;
    else if (Array.isArray(v) && v.every((x) => typeof x === 'number')) {
      const s = (v as number[]).map(num);
      out[k] = s.length > 1 ? `${s.slice(0, -1).join(', ')} ${t('diag.warning.and')} ${s[s.length - 1]}` : s.join('');
    }
  }
  return out;
}

const sentence = (s: string): string => { const x = s.trim(); return x ? x[0].toUpperCase() + x.slice(1) + (/[.!?]$/.test(x) ? '' : '.') : ''; };

/** The text of one warning: `hint` is what the store keeps (the kernel's detail / hint / message, or the code). */
export function warningText(w: { code: string; hint?: string; params?: Record<string, unknown> }): { text: string; advice: string } {
  if (OWN_TEXT.test(w.code)) return { text: w.hint || w.code, advice: '' };
  const vals = paramValues(w.params);
  const reason = t('diag.reason.' + w.code, vals, '');
  if (reason) return { text: sentence(reason), advice: t('diag.advice.' + w.code, vals, '') };
  const own = w.hint && w.hint !== w.code ? sentence(w.hint) : '';
  return { text: t('diag.warning.generic', { code: w.code }), advice: own };
}

/** The warnings to show, in feature order: none for a suppressed feature or one after the rollback marker (`rollback`:
 *  number of features that are on, null = all), so a stale warning of a feature that is not built never shows. */
export function warningEntries(byId: Record<string, FeatureWarning>, features: ReadonlyArray<{ id: string; type?: string; name?: string; suppressed?: boolean }>, rollback: number | null = null): WarningEntry[] {
  const out: WarningEntry[] = [];
  features.forEach((f, i) => {
    const w = byId[f.id];
    if (!w || f.suppressed || (rollback !== null && i >= rollback)) return;
    const label = f.name ?? (f.type ? t('feature.' + f.type, undefined, f.type) : f.id);
    for (const one of w.all ?? [w]) out.push({ featureId: f.id, label, code: one.code, ...warningText(one) });
  });
  return out;
}

/** One line per warning: the text, then the advice. */
export const warningLine = (e: WarningEntry): string => (e.advice ? `${e.text}${/[.!?]$/.test(e.text) ? '' : '.'} ${e.advice}` : e.text);

/** The tree's marker data: per feature the first code and every warning one per line (the marker's tooltip). */
export function warningTips(entries: WarningEntry[]): Record<string, { code: string; hint: string }> {
  const out: Record<string, { code: string; hint: string }> = {};
  for (const e of entries) {
    const cur = out[e.featureId];
    if (cur) cur.hint += '\n' + warningLine(e);
    else out[e.featureId] = { code: e.code, hint: warningLine(e) };
  }
  return out;
}
