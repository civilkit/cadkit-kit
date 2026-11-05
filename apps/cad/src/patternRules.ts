// Pure rules of the pattern option forms (FeatureOptions.tsx): the linear pattern's two directions, each with its distance type
// (Spacing, Extent, To object), and the path pattern's start point, flip and orientation. A patch value of null means "remove this
// field" (the protocol of optionRules.ts). The kernel reads these fields as pattern_place.rs documents them.

import { t } from './i18n';
import { featureLabel } from './featureCreators';

type Wire = Record<string, unknown>;
export type Sfx = '' | '2';
export type DistanceType = 'spacing' | 'extent' | 'toObject';
export const DISTANCE_TYPES: DistanceType[] = ['spacing', 'extent', 'toObject'];
/** A path pattern measures along the path: no To object. */
export const PATH_DISTANCE_TYPES: DistanceType[] = ['spacing', 'extent'];
export const AXES = ['x', 'y', 'z'] as const;
export type Axis = typeof AXES[number];

const numOr = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function distanceTypeOf(eff: Wire, sfx: Sfx = ''): DistanceType {
  const v = eff['distanceType' + sfx];
  return v === 'extent' || v === 'toObject' ? v : 'spacing';
}

/** Switching the distance type: Extent starts at the span the copies cover now, Spacing at the gap the extent gave; the fields the new type does not read go. */
export function patchDistanceType(eff: Wire, sfx: Sfx, type: DistanceType): Wire {
  const k = (b: string) => b + sfx;
  const count = Math.max(2, Math.round(numOr(eff[k('count')], 2)));
  const cur = distanceTypeOf(eff, sfx);
  const p: Wire = { [k('distanceType')]: type === 'spacing' ? null : type };
  if (type === 'extent') {
    if (typeof eff[k('extent')] !== 'number' && typeof eff[k('extent')] !== 'string') p[k('extent')] = +(numOr(eff[k('spacing')], 10) * (count - 1)).toFixed(6);
  } else p[k('extent')] = null;
  if (type === 'spacing' && cur === 'extent' && typeof eff[k('spacing')] !== 'number' && typeof eff[k('spacing')] !== 'string') p[k('spacing')] = +(numOr(eff[k('extent')], 10) / (count - 1)).toFixed(6);
  if (type !== 'toObject') { p[k('to')] = null; p[k('toOffset')] = null; }
  return p;
}

export function axisOf(eff: Wire, sfx: Sfx = ''): Axis | '' {
  const d = eff['dir' + sfx] as { kind?: string; axis?: string } | undefined;
  return d?.kind === 'axis' && (AXES as readonly string[]).includes(String(d.axis)) ? (d.axis as Axis) : '';
}

/** The second direction: an axis turns it on (count 2, the spacing of direction 1); none removes every field of it. */
export function patchDir2(eff: Wire, axis: Axis | ''): Wire {
  if (!axis) return Object.fromEntries(['dir', 'count', 'spacing', 'reverse', 'distanceType', 'extent', 'to', 'toOffset'].map((b) => [b + '2', null]));
  const p: Wire = { dir2: { kind: 'axis', axis } };
  if (!axisOf(eff, '2')) { p.count2 = 2; p.spacing2 = numOr(eff.spacing, 10); }
  return p;
}

/** The selector value of a To object reference: `std:front`, `feature:F3`, `face:F2.S.e2`, `point` for coordinates, '' for none. */
export function toValue(to: unknown): string {
  if (Array.isArray(to)) return 'point';
  const r = to as { kind?: string; id?: string } | null | undefined;
  return r?.kind && r.id ? `${r.kind}:${r.id}` : '';
}
/** The objects on offer: the standard planes, the Plane features before this one, and what it reaches now (a picked face, a point). */
export function toChoices(doc: { features?: unknown[] } | null | undefined, selfId: string, current: unknown): Array<[string, string]> {
  const out: Array<[string, string]> = [['', t('opt.pattern.toNone')], ['std:front', t('app.ref.front')], ['std:top', t('app.ref.top')], ['std:right', t('app.ref.right')]];
  for (const f of (doc?.features ?? []) as Array<{ id: string; type: string; name?: string }>) {
    if (f.id === selfId) break;
    if (f.type === 'plane') out.push([`feature:${f.id}`, featureLabel(doc, f as never) || f.id]);
  }
  const v = toValue(current);
  if (v.startsWith('face:')) out.push([v, t('opt.plane.face', { id: v.slice(5) })]);
  if (v === 'point') out.push(['point', t('opt.pattern.toPoint', { at: (current as number[]).map((x) => +Number(x).toFixed(3)).join(', ') })]);
  return out;
}
export function toPatch(sfx: Sfx, value: string, current: unknown): Wire {
  if (value === 'point') return { ['to' + sfx]: current };
  if (!value) return { ['to' + sfx]: null };
  const i = value.indexOf(':');
  return { ['to' + sfx]: { kind: value.slice(0, i), id: value.slice(i + 1) } };
}

// ---- path pattern ----

export type StartMode = 'distance' | 'fraction';
export const startModeOf = (eff: Wire): StartMode => (eff.startFraction !== undefined && eff.startFraction !== null ? 'fraction' : 'distance');
export function patchStartMode(mode: StartMode): Wire {
  return mode === 'fraction' ? { start: null, startFraction: 0 } : { startFraction: null, start: 0 };
}
export type Orientation = 'fixed' | 'tangent';
export const ORIENTATIONS: Orientation[] = ['fixed', 'tangent'];
export const orientationOf = (eff: Wire): Orientation => (eff.orientation === 'tangent' ? 'tangent' : 'fixed');
