// The Washer wizard's rules: the parameter record with its defaults, the checks that need no kernel, and the ops. The ops come from the script's washer()
// helper (packages/script/src/features/washer.ts), so the wizard and the Script tab build the same washer. Nothing here touches the DOM or the kernel.
import type { EditOp } from '@ck/session';
import { t } from './i18n';
import { groupOps, wizardGroupName } from './wizardGroup';
import { washerEditOps, type WasherOpts } from '@kit/script';
import type { WasherHole } from './washerHole';
import { findWasherSize, sizeForHole, type HoleSize } from './washerSizes';

export const WASHER_KINDS = ['flat', 'spring'] as const;
/** The way the thickness extends from the first face. */
export const WASHER_AXES = ['nz', 'pz', 'nx', 'px', 'ny', 'py'] as const;
const AXIS_VEC: Record<(typeof WASHER_AXES)[number], [number, number, number]> = { 'nz': [0, 0, -1], 'pz': [0, 0, 1], 'nx': [-1, 0, 0], 'px': [1, 0, 0], 'ny': [0, -1, 0], 'py': [0, 1, 0] };

export interface WasherParams {
  kind: (typeof WASHER_KINDS)[number];
  inner: number;
  outer: number;
  thickness: number;
  /** spring only: the width of the split */
  gap: number;
  /** the centre of the first (bearing) face */
  origin: [number, number, number];
  axis: (typeof WASHER_AXES)[number];
  /** the hole the washer was placed on (origin and axis follow it), see washerHole.ts */
  hole?: WasherHole | null;
  /** with a hole: the distance from its seat along the axis, mm (0 = touching) */
  offset?: number;
}
/** M8 flat washer, ISO 7089 */
export const DEFAULT_WASHER: WasherParams = { kind: 'flat', inner: 8.4, outer: 16, thickness: 1.6, gap: 1.6, origin: [0, 0, 0], axis: 'nz' };

export function washerOpts(p: WasherParams): WasherOpts {
  return { kind: p.kind, inner: p.inner, outer: p.outer, thickness: p.thickness, ...(p.kind === 'spring' ? { gap: p.gap } : {}), origin: p.origin, axis: AXIS_VEC[p.axis] };
}

export type WasherIssueCode = 'inner' | 'outer' | 'thickness' | 'gap' | 'kernel';
export interface WasherIssue { code: WasherIssueCode; params: Record<string, string | number>; message: string }

/** The first problem with the parameters (none when the ops can be made). */
export function washerIssue(p: WasherParams): WasherIssue | null {
  const bad = (code: WasherIssueCode, message: string, params: Record<string, string | number> = {}): WasherIssue => ({ code, params, message });
  if (!(p.inner > 0)) return bad('inner', 'The inner diameter must be more than 0');
  if (!(p.outer > p.inner)) return bad('outer', 'The outer diameter must be larger than the inner', { inner: p.inner });
  if (!(p.thickness > 0)) return bad('thickness', 'The thickness must be more than 0');
  if (p.kind === 'spring' && !(p.gap > 0 && p.gap < p.inner)) return bad('gap', 'The gap must be more than 0 and smaller than the hole', { inner: p.inner });
  try { washerOps({ features: [] }, p); } catch (e) { return bad('kernel', (e as Error).message.replace(/^washer\(\): /, '')); }
  return null;
}

/** The ops that append the washer to the document (all in one tree folder named after the wizard, see wizardGroup.ts), numbered from the document's next feature id. Throws with the helper's message. */
export function washerOps(doc: { features: Array<{ id?: string }>; seq?: number }, p: WasherParams): EditOp[] {
  let n = doc.seq ?? 1;
  for (const f of doc.features) { const m = /^F(\d+)$/.exec(String(f.id ?? '')); if (m) n = Math.max(n, Number(m[1]) + 1); }
  return groupOps(washerEditOps(washerOpts(p), n) as unknown as EditOp[], wizardGroupName(doc.features, t('washer.title')));
}

const unit = (a: WasherParams['axis']): [number, number, number] => AXIS_VEC[a];

/** Where the washer sits for the hole's chosen seat and the offset: the seat's hole centre moved `offset` along the axis. */
export function holePlacement(hole: WasherHole, offset: number): Pick<WasherParams, 'origin' | 'axis'> {
  const s = hole.seats[hole.seat] ?? hole.seats[0];
  const u = unit(s.axis);
  return { origin: [0, 1, 2].map((i) => Math.round((s.origin[i] + u[i] * offset) * 1000) / 1000 + 0) as WasherParams['origin'], axis: s.axis };
}

/** The standard the size comes from: the one of the size now on screen, else ISO 7089 (flat) or DIN 127 B (spring). */
export function holeStandard(p: WasherParams): string {
  return findWasherSize(p.kind, p.inner, p.outer, p.thickness)?.standard ?? (p.kind === 'spring' ? 'DIN 127 B' : 'ISO 7089');
}

/** The washer for a hole: the standard size whose clearance hole the hole contains (`size`, with fit 'nearest' when none does), placed coaxial on the seat. */
export function washerOnHole(p: WasherParams, hole: WasherHole, offset = p.offset ?? 0, standard = holeStandard(p)): { params: WasherParams; size: HoleSize | null } {
  const size = sizeForHole(standard, hole.diameter);
  const w = size?.size;
  return {
    size,
    params: { ...p, ...(w ? { inner: w.inner, outer: w.outer, thickness: w.thickness, gap: w.thickness } : {}), ...holePlacement(hole, offset), hole, offset },
  };
}
