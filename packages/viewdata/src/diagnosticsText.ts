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

/** A rounding refused because the rim is a smooth free-form curve (the kernel's words are "closed smooth free-form curve" / "smooth closed spline rim"). */
const smoothRim = (r: DiagRoot): boolean => r.code === 'blendUnsupported' && /free-?form|spline/i.test(`${String(r.params?.detail ?? '')} ${String(r.params?.hint ?? '')}`);

export function reasonOf(r: DiagRoot): string {
  if (smoothRim(r)) return t('diag.reason.blendUnsupported.spline');
  if (r.seat) return r.seat === 'fixed' ? t('diag.reason.seat.fixed') : t('diag.reason.seat.face');
  if (r.knurl) return r.knurl === 'fixed' ? t('diag.reason.knurl.fixed') : t('diag.reason.knurl.face');
  if (r.openLine) return t('diag.reason.noClosedProfile.openLine');
  if (r.planeInput) return t('diag.reason.plane.missing.' + r.planeInput);
  // the kernel's sweepPathInvalid says which case it is in `message` ("the path has 2 splines", "a gap between pieces") and what to do in `hint`
  const detail = typeof r.params?.detail === 'string' ? r.params.detail : r.code === 'sweepPathInvalid' && typeof r.params?.message === 'string' ? r.params.message : '';
  const tip = r.code === 'draftTooLarge' ? tipHeight(r.params) : null;   // the kernel's own sentence carries the height to 15 digits
  if (tip !== null) return t('diag.reason.draftTooLarge.height', { h: String(tip) });
  const known = t('diag.reason.' + r.code, undefined, '');
  const detailP = plainify(detail);
  if (detail && known && ROUNDING.test(r.code) && plainEnough(detailP)) return `${known} (${trimDot(detailP)})`;
  // the kernel's own words are developer text (ids, algorithm terms): they only reach the sentence when they read as plain English, else they stay in Details
  const advice = typeof r.params?.hint === 'string' ? trimDot(plainify(r.params.hint)) : '';
  if (detail && plainEnough(detailP)) return advice && plainEnough(advice) && !detailP.includes(advice) ? `${trimDot(detailP)}; ${advice}` : trimDot(detailP);
  if (known) return known;
  return t('diag.reason.unknown');
}

/** The kernel's words with the developer parts turned into plain ones, so useful advice is kept: a face or edge id becomes "the picked face", an API word ("endScale",
 *  "compositeCurve") becomes words, backticks and braces go, and a number to 4 or more places is rounded. The result still has to pass plainEnough. */
export function plainify(text: string): string {
  return text
    .replace(/\bF\d+(\.[A-Za-z0-9~|#]+)+/g, 'the picked face')
    .replace(/\b(panel|edge) [PE]\d+\b/gi, '$1').replace(/\b[PE]\d+(\.[A-Za-z0-9]+)?\b/g, 'the panel')
    .replace(/[`{}|]/g, '')
    .replace(/\b([a-z]+)([A-Z][A-Za-z]*)\b/g, (_m, a: string, b: string) => `${a} ${b.replace(/([A-Z])/g, ' $1').toLowerCase().trim()}`)
    .replace(/\d+\.\d{4,}/g, (n) => String(Math.round(Number(n) * 1000) / 1000))
    .replace(/\s+/g, ' ').trim();
}

/** Text a person can read: no internal ids, camelCase words, backticks or algorithm terms, and one short sentence. The kernel's `detail` mostly fails this and goes to Details. */
export function plainEnough(text: string): boolean {
  const s = text.trim();
  if (!s || s.length > 140) return false;
  if (/\bF\d+(\.[A-Za-z0-9~|]+)*|\b[PE]\d+\b|\bdocs\/|\.md\b|[a-z]\d+~\d+|edge#\d+|\.[BCSe]\d+|[`{}|]|\b[a-z]+[A-Z][A-Za-z]*\b|[A-Z]{2,}\.[A-Z]{2,}/.test(s)) return false;
  return !/\b(coedge|pcurve|tangent chain|torus|spine|spring|station|knot|weld|euler|manifold|seam|rim|degenerate|periodic|nurbs|kernel|engine|solver|wasm)\b/i.test(s);
}

/** The feature as the summary names it: "F14 Trim barrel and handle". */
export const featureTag = (x: { id: string; label: string }): string => (x.label && x.label !== x.id ? `${x.id} ${x.label}` : x.id);

export type MsgState = 'preview' | 'rejected' | 'failed';
const sentence = (x: string): string => { const v = trimDot(x); return v ? v.charAt(0).toUpperCase() + v.slice(1) + '.' : ''; };

/** What a person sees: a lead for the situation (none for a preview that could not be built), one cause sentence, one action sentence. The code, ids and the later features stay in Details. */
export interface Message { lead: string; cause: string; action: string; code: string; later: number; others: number }
export function composeMessage(d: Diagnosis, state: MsgState): Message {
  const root = d.roots[0];
  if (!root) return { lead: '', cause: '', action: '', code: '', later: 0, others: 0 };
  const name = root.label && root.label !== root.id ? root.label : t('diag.summary.editor.thing');
  const lead = state === 'rejected' ? t('diag.lead.rejected') : state === 'failed' ? t('diag.lead.failed', { name: name.charAt(0).toUpperCase() + name.slice(1) }) : '';
  const kind = (n: string): string => (/chamfer/i.test(root.label) ? n.replace(/\bfillets\b/g, 'chamfers').replace(/\bfillet\b/g, 'chamfer') : n);   // the strings are written for a fillet; a chamfer says chamfer
  const cause = kind(sentence(reasonOf(root)));
  const action = kind(adviceOf(root));
  return { lead, cause, action, code: root.code, later: d.consequences.length, others: Math.max(0, d.roots.length - 1) };
}

/** The same message as one string, for a toast or the status line. */
export function summaryLine(d: Diagnosis, state: MsgState = 'rejected'): string {
  const m = composeMessage(d, state);
  return [m.lead, m.cause, m.action].filter(Boolean).join(' ');
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
/** "thin.thickness" -> "thickness", "endScale" -> "end scale": the field's name in words. */
export const paramWords = (param: string): string => (param.split('.').pop() ?? param).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
/** "9.96 mm", "44.5°". */
export const maxSizeText = (m: MaxSize): string => (m.unit === 'deg' ? `${m.value}°` : `${m.value} ${m.unit}`.trim());

/** What to try, for a root error: the advice for its code, else generic advice; a refusal that names the largest size that builds says it first. */
export function adviceOf(r: DiagRoot): string {
  if (r.seat) return r.seat === 'fixed' ? t('diag.advice.seat.fixed') : t('diag.advice.seat.face');
  if (r.knurl) return r.knurl === 'fixed' ? t('diag.advice.knurl.fixed') : t('diag.advice.knurl.face');
  if (r.openLine) return t('diag.advice.noClosedProfile.openLine');
  if (r.planeInput) return t('diag.advice.plane.missing.' + r.planeInput);
  const tip = r.code === 'draftTooLarge' ? tipHeight(r.params) : null;
  if (tip !== null) return t('diag.advice.draftTooLarge.height', { h: String(tip) });
  // a code without advice of its own: the kernel's hint when it gave one ("make the counterbore narrower than the face"), else the generic line
  const own = smoothRim(r) ? t('diag.advice.blendUnsupported.spline') : t('diag.advice.' + r.code, undefined, '');
  const rawHint = typeof r.params?.hint === 'string' ? plainify(r.params.hint.trim()) : '';
  const hint = plainEnough(rawHint) ? rawHint : '';   // agent-style hints (ids, API words) stay in Details
  // blendUnsupported has a general line of its own, but a hint from the kernel names the actual way out (a ring round on a smooth closed spline), so that wins
  const advice = (r.code === 'blendUnsupported' && !smoothRim(r) && hint) || own || hint || '';
  const max = maxSizeOf(r.params);
  return max ? t('diag.advice.maxSize', { size: maxSizeText(max), param: paramWords(max.param) }) : advice;   // one sentence: the number is the way out
}

/** One consequence as a list item: "F28 Shell 2 mm: removes nothing". */
export function consequenceText(c: DiagConsequence): string {
  return `${featureTag(c)}: ${t('diag.echo.' + c.code, undefined, c.code.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase())}`;
}
