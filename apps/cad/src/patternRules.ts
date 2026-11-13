// Pure rules of the pattern option forms (FeatureOptions.tsx): the linear pattern's two directions, each with its distance type
// (Spacing, Extent, To object), and the path pattern's start point, flip and orientation. A patch value of null means "remove this
// field" (the protocol of optionRules.ts). The kernel reads these fields as pattern_place.rs documents them.

import { t } from './i18n';
import { featureLabel } from './featureCreators';
import { fmtNum } from '@kit/ui';

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

// ---- direction of a linear pattern: a world axis, a vector, or an edge / round face picked in the view ----

/** How a direction is given: a world axis, a typed vector, or a picked edge or round face ('ref'); '' when there is none. */
export type DirChoice = Axis | 'vector' | 'ref';
const isVec3 = (v: unknown): v is number[] => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));

export function dirChoiceOf(eff: Wire, sfx: Sfx = ''): DirChoice | '' {
  const d = eff['dir' + sfx] as { kind?: string; axis?: string; dir?: unknown } | undefined;
  if (!d || typeof d !== 'object') return '';
  const a = axisOf(eff, sfx);
  if (a) return a;
  if (d.kind === 'vector') return 'vector';
  return d.kind === 'edge' || d.kind === 'face' || d.kind === 'feature' ? 'ref' : '';
}
/** The vector of a vector direction (1, 0, 0 while there is none). */
export function dirVectorOf(eff: Wire, sfx: Sfx = ''): number[] {
  const d = eff['dir' + sfx] as { dir?: unknown } | undefined;
  return isVec3(d?.dir) ? [...d!.dir as number[]] : [1, 0, 0];
}
/** Words for a picked reference ('Edge ...', 'Round face ...'); the id of a feature axis. */
export function refLabel(r: unknown): { kind: 'edge' | 'face' | 'feature'; text: string } | null {
  const d = r as { kind?: string; id?: string; faces?: unknown[] } | undefined;
  if (d?.kind === 'edge' && Array.isArray(d.faces)) return { kind: 'edge', text: d.faces.map(String).join(' / ') };
  if (d?.kind === 'face' && d.id) return { kind: 'face', text: d.id };
  if (d?.kind === 'feature' && d.id) return { kind: 'feature', text: d.id };
  return null;
}
const unit = (v: number[]): number[] => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return v.map((x) => +(x / l).toFixed(9)); };
const WORLD_VEC: Record<Axis, number[]> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

/** Switching the direction between a world axis and a vector (a vector starts as the axis it replaces). A picked reference is written by the pick, not here. */
export function patchDirChoice(eff: Wire, sfx: Sfx, v: Axis | 'vector'): Wire {
  const p: Wire = {};
  if (v === 'vector') {
    const cur = dirChoiceOf(eff, sfx);
    p['dir' + sfx] = { kind: 'vector', dir: cur === 'vector' ? dirVectorOf(eff, sfx) : cur && cur !== 'ref' ? [...WORLD_VEC[cur]] : [1, 0, 0] };
  } else p['dir' + sfx] = { kind: 'axis', axis: v };
  if (sfx && !dirChoiceOf(eff, '2')) { p.count2 = 2; p.spacing2 = numOr(eff.spacing, 10); }
  return p;
}
/** One component of a typed direction vector; a value that is not a finite number is left alone. */
export function patchDirVector(eff: Wire, sfx: Sfx, i: number, value: number | string): Wire {
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || String(value).trim() === '') return {};
  const v = dirVectorOf(eff, sfx);
  v[i] = n;
  return { ['dir' + sfx]: { kind: 'vector', dir: v } };
}
/** A vector with no length has no direction: the form says so. */
export const vectorIsZero = (v: number[]): boolean => Math.hypot(v[0], v[1], v[2]) < 1e-12;

/** The second direction: a choice turns it on (count 2, the spacing of direction 1); none removes every field of it. */
export function patchDir2(eff: Wire, choice: Axis | 'vector' | ''): Wire {
  if (!choice) return Object.fromEntries(['dir', 'count', 'spacing', 'reverse', 'distanceType', 'extent', 'to', 'toOffset'].map((b) => [b + '2', null]));
  return patchDirChoice(eff, '2', choice);
}

// ---- axis of a circular pattern: a world axis, a point and a direction, or an edge / round face picked in the view ----

/** 'custom' is a typed direction (a point on the axis and a vector). */
export type AxisChoice = Axis | 'custom' | 'ref';
export interface AxisState { choice: AxisChoice; point: number[]; dir: number[] }
const ORIGIN = [0, 0, 0];

/** What a stored axis reads as. `{kind:"axis", axis}` is a world axis through the origin; `{kind:"axis", point, dir}` a world axis away from it when the direction is along x, y or z (positive), else custom. */
export function axisStateOf(eff: Wire): AxisState {
  const a = eff.axis as { kind?: string; axis?: string; point?: unknown; dir?: unknown } | undefined;
  if (!a || typeof a !== 'object') return { choice: 'z', point: ORIGIN, dir: [0, 0, 1] };
  if (a.kind === 'axis' && (AXES as readonly string[]).includes(String(a.axis))) return { choice: a.axis as Axis, point: ORIGIN, dir: WORLD_VEC[a.axis as Axis] };
  if (a.kind === 'axis' && isVec3(a.dir)) {
    const point = isVec3(a.point) ? a.point : ORIGIN;
    const u = unit(a.dir);
    const k = [0, 1, 2].find((i) => u[i] > 1 - 1e-9);
    return { choice: k === undefined ? 'custom' : AXES[k], point, dir: a.dir };
  }
  return refLabel(a) ? { choice: 'ref', point: ORIGIN, dir: [0, 0, 1] } : { choice: 'z', point: ORIGIN, dir: [0, 0, 1] };
}
/** The axis for a choice and a point: a world axis through the origin stays `{kind:"axis", axis}` as ever; anything else carries the point and the direction. */
export function axisFor(choice: Axis | 'custom', point: number[], dir: number[]): Wire {
  const atOrigin = point.every((x) => Math.abs(x) < 1e-12);
  if (choice !== 'custom') return atOrigin ? { kind: 'axis', axis: choice } : { kind: 'axis', point: [...point], dir: [...WORLD_VEC[choice]] };
  return { kind: 'axis', point: [...point], dir: [...dir] };
}
export function patchAxisChoice(eff: Wire, choice: Axis | 'custom'): Wire {
  const s = axisStateOf(eff);
  const dir = choice === 'custom' ? (s.choice === 'custom' ? s.dir : [...s.dir]) : WORLD_VEC[choice];
  return { axis: axisFor(choice, s.choice === 'ref' ? ORIGIN : s.point, dir) };
}
/** One component of the axis point ('point') or of a typed direction ('dir'). */
export function patchAxisPart(eff: Wire, part: 'point' | 'dir', i: number, value: number | string): Wire {
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || String(value).trim() === '') return {};
  const s = axisStateOf(eff);
  if (s.choice === 'ref') return {};
  const point = [...s.point], dir = [...s.dir];
  (part === 'point' ? point : dir)[i] = n;
  return { axis: axisFor(s.choice, point, dir) };
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
  if (v === 'point') out.push(['point', t('opt.pattern.toPoint', { at: (current as unknown[]).map((x) => fmtNum(x)).join(', ') })]);
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
