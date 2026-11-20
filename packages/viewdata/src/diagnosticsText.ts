// Plain-language text for a Diagnosis (English; every string goes through t() so a catalogue can translate it).
import { t } from '@kit/i18n';
import type { DiagConsequence, DiagRoot, Diagnosis } from './errorSummary';

const trimDot = (s: string): string => s.trim().replace(/[.\s]+$/, '');

/** The depth at which a taper closes to a point, when the kernel names it (`maxHeight` of a round face), to two decimals. */
const tipHeight = (params: Record<string, unknown> | null | undefined): number | null => {
  const h = params?.maxHeight;
  return typeof h === 'number' && Number.isFinite(h) && h > 0 ? Math.round(h * 100) / 100 : null;
};

/** Why the root failed, as a clause: the kernel's own detail when it gave one, else a short phrase for the code. */
/** Fillet and chamfer refusals: the kernel's detail ("F3.B0: spring leaves its face away from its edges") is jargon alone, so the plain phrase leads and the detail follows. */
const ROUNDING = /^(blend|chamfer)|^filletChamfer$/;

export function reasonOf(r: DiagRoot): string {
  if (r.seat) return r.seat === 'fixed' ? t('diag.reason.seat.fixed') : t('diag.reason.seat.face');
  if (r.knurl) return r.knurl === 'fixed' ? t('diag.reason.knurl.fixed') : t('diag.reason.knurl.face');
  if (r.openLine) return t('diag.reason.noClosedProfile.openLine');
  const detail = typeof r.params?.detail === 'string' ? r.params.detail : '';
  const tip = r.code === 'draftTooLarge' ? tipHeight(r.params) : null;   // the kernel's own sentence carries the height to 15 digits
  if (tip !== null) return t('diag.reason.draftTooLarge.height', { h: String(tip) });
  const known = t('diag.reason.' + r.code, undefined, '');
  if (detail && known && ROUNDING.test(r.code)) return `${known} (${trimDot(detail)})`;
  // the kernel's own advice on a refusal ("use either a draft angle or an end scale") follows its sentence
  const advice = typeof r.params?.hint === 'string' ? trimDot(r.params.hint) : '';
  if (detail) return advice && !detail.includes(advice) ? `${trimDot(detail)}; ${advice}` : trimDot(detail);
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

/** The kernel's `maxSize` on a refusal whose size is too large: the field (`thickness`, a dotted path for a nested one such as `thin.thickness`), the largest value of it that builds, and its unit (`mm`, `deg`). Null when the kernel gave none or it is malformed (older kernels, fillet and chamfer until the blend code names one). */
export interface MaxSize { param: string; value: number; unit: string }
export function maxSizeOf(params: Record<string, unknown> | null | undefined): MaxSize | null {
  // a blend surface names the largest radius that fits as `maxRadius` (a smaller ball rolls, this one does not)
  const r = params?.maxRadius;
  if (typeof r === 'number' && Number.isFinite(r) && r > 0 && !params?.maxSize) return { param: 'radius', value: Math.round(r * 1000) / 1000, unit: 'mm' };
  const m = params?.maxSize as Record<string, unknown> | null | undefined;
  if (!m || typeof m !== 'object') return null;
  const { param, value, unit } = m;
  if (typeof param !== 'string' || !param || typeof value !== 'number' || !Number.isFinite(value) || typeof unit !== 'string') return null;
  return { param, value, unit };
}
/** "9.96 mm", "44.5°". */
export const maxSizeText = (m: MaxSize): string => (m.unit === 'deg' ? `${m.value}°` : `${m.value} ${m.unit}`.trim());

/** What to try, for a root error: the advice for its code, else generic advice; a refusal that names the largest size that builds says it first. */
export function adviceOf(r: DiagRoot): string {
  if (r.seat) return r.seat === 'fixed' ? t('diag.advice.seat.fixed') : t('diag.advice.seat.face');
  if (r.knurl) return r.knurl === 'fixed' ? t('diag.advice.knurl.fixed') : t('diag.advice.knurl.face');
  if (r.openLine) return t('diag.advice.noClosedProfile.openLine');
  const tip = r.code === 'draftTooLarge' ? tipHeight(r.params) : null;
  if (tip !== null) return t('diag.advice.draftTooLarge.height', { h: String(tip) });
  const advice = t('diag.advice.' + r.code, undefined, t('diag.advice.generic'));
  const max = maxSizeOf(r.params);
  return max ? `${t('diag.advice.maxSize', { size: maxSizeText(max) })} ${advice}` : advice;
}

/** One consequence as a list item: "F28 Shell 2 mm: removes nothing". */
export function consequenceText(c: DiagConsequence): string {
  return `${featureTag(c)}: ${t('diag.echo.' + c.code, undefined, c.code.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase())}`;
}
