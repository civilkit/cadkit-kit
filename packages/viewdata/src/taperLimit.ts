// The tip of a tapered extrude. A drafted extrude of one circle (the Cone) closes to a point at some depth; the kernel reports
// it as `limits: [[featureId, { maxHeight }]]` in the regen reply and refuses a deeper one with `draftTooLarge { maxHeight }`.
// Everything here is pure: the controller, the handle sessions and the tests share it.
import type { EditOp } from '@ck/session';

/** Slack when comparing a depth with the tip: a depth equal to `maxHeight` builds the exact cone. */
export const TIP_EPS = 1e-6;

export interface Tip { feature: string; maxHeight: number }

/** `limits` of a regen reply as a map from feature id to `maxHeight`. Anything that is not a positive finite number is dropped. */
export function limitsOf(raw: unknown): Map<string, number> {
  const out = new Map<string, number>();
  if (!Array.isArray(raw)) return out;
  for (const e of raw) {
    if (!Array.isArray(e) || typeof e[0] !== 'string') continue;
    const h = (e[1] as { maxHeight?: unknown } | undefined)?.maxHeight;
    if (typeof h === 'number' && Number.isFinite(h) && h > 0) out.set(e[0], h);
  }
  return out;
}

/** The value limited to the tip: `max` when it is past it (or `max` is absent, the value). */
export function clampToTip(value: number, max: number | undefined): { value: number; clamped: boolean; atTip: boolean } {
  if (max === undefined || !(max > 0)) return { value, clamped: false, atTip: false };
  if (value > max + TIP_EPS) return { value: max, clamped: true, atTip: true };
  return { value, clamped: false, atTip: value >= max - TIP_EPS };
}

/** The `draftTooLarge` errors of a regen that carry `maxHeight` (a polygon's plain draftTooLarge has none and is left alone). */
export function tipErrors(errors: ReadonlyArray<readonly [string, { code?: string; params?: Record<string, unknown> }]> | undefined): Tip[] {
  const out: Tip[] = [];
  for (const [feature, e] of errors ?? []) {
    const h = e?.params?.maxHeight;
    if (e?.code === 'draftTooLarge' && typeof h === 'number' && Number.isFinite(h) && h > 0) out.push({ feature, maxHeight: h });
  }
  return out;
}

/** Whether any feature can have a tip (a drafted extrude): only then is the kernel asked for limits. */
export const mayHaveTip = (features: ReadonlyArray<{ type?: string; draft?: unknown }>): boolean =>
  features.some((f) => f.type === 'extrude' && typeof f.draft === 'number' && f.draft !== 0);

/** `set depth` ops past the limit of their feature are lowered to it. Returns the ops (same array when nothing changed) and the tips hit. */
export function clampDepthOps(ops: EditOp[], limit: (id: string) => number | undefined): { ops: EditOp[]; tips: Tip[] } {
  const tips: Tip[] = [];
  const out = ops.map((o) => {
    const s = o as { op: string; id?: string; path?: string; value?: unknown };
    if (s.op !== 'set' || s.path !== 'depth' || typeof s.value !== 'number' || !s.id) return o;
    const c = clampToTip(s.value, limit(s.id));
    if (!c.clamped) return o;
    tips.push({ feature: s.id, maxHeight: c.value });
    return { ...s, value: c.value } as EditOp;
  });
  return { ops: tips.length ? out : ops, tips };
}

/** Whether the ops set the draft angle of the feature (then the height is kept and the limit reported). */
export const editsDraft = (ops: EditOp[], id: string): boolean => ops.some((o) => { const s = o as { op: string; id?: string; path?: string }; return s.op === 'set' && s.id === id && s.path === 'draft'; });
