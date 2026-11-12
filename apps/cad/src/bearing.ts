// The Bearing wizard's rules: the parameter record with its defaults, the checks that need no kernel, the face a bearing can be seated on, and the ops. The ops
// come from the script's bearing() helper (packages/script/src/features/bearing.ts), so the wizard and the Script tab build the same bearing. Nothing here touches
// the DOM or the kernel.
import type { EditOp } from '@ck/session';
import { t } from './i18n';
import { groupOps, wizardGroupName } from './wizardGroup';
import {
  bearingEditOps, bearingModel, bearingProblem, BEARING_PRESETS, BEARING_SEALS, findBearings, housingSeat, SEAT_FITS,
  type BearingModel, type BearingOpts, type BearingPreset, type BearingSeal, type BearingSpec, type SeatFit,
} from '@kit/script';

export { BEARING_PRESETS, BEARING_SEALS, findBearings, housingSeat, SEAT_FITS };
export type { BearingPreset, BearingSeal, SeatFit };
/** The way the bearing extends from its first face. */
export const BEARING_AXES = ['pz', 'nz', 'px', 'nx', 'py', 'ny'] as const;
const AXIS_VEC: Record<(typeof BEARING_AXES)[number], [number, number, number]> = { 'pz': [0, 0, 1], 'nz': [0, 0, -1], 'px': [1, 0, 0], 'nx': [-1, 0, 0], 'py': [0, 1, 0], 'ny': [0, -1, 0] };

export interface BearingParams {
  /** the preset it started from ('' once a size was typed by hand) */
  designation: string;
  bore: number; od: number; width: number;
  seal: BearingSeal;
  /** null: the default by size */
  chamfer: number | null;
  /** a flange on the outer ring (a flanged preset such as F625 sets it; a size typed by hand clears it) */
  flange: { diameter: number; thickness: number } | null;
  /** open bearings: null is the rule for the count and the race gap for the diameter */
  balls: number | null;
  ballDiameter: number | null;
  /** the centre of the first face */
  origin: [number, number, number];
  axis: (typeof BEARING_AXES)[number];
  /** the fit of the housing seat shown (and cut, when `seat` is on) */
  seatFit: SeatFit;
  /** cut a matching pocket in the face the bearing was placed on */
  seat: boolean;
  /** the face the wizard was opened on and placed the bearing against (null: placed by the numbers) */
  placedOn: string | null;
  /** where the face placed the bearing (the centre of its first face and the axis), when it did: the bearing is built from the face while its axis and its position along the axis are still these, so it follows the face when the part is edited */
  placedAt: { origin: [number, number, number]; axis: (typeof BEARING_AXES)[number] } | null;
}
export const DEFAULT_BEARING: BearingParams = {
  designation: '608', bore: 8, od: 22, width: 7, seal: '2Z', chamfer: null, flange: null, balls: null, ballDiameter: null,
  origin: [0, 0, 0], axis: 'pz', seatFit: 'h7', seat: false, placedOn: null, placedAt: null,
};

/** The record with a preset's sizes (and, for a designation with a seal suffix, its seal). */
export function withPreset(p: BearingParams, preset: BearingPreset, seal?: BearingSeal | null): BearingParams {
  return { ...p, designation: preset.designation, bore: preset.bore, od: preset.od, width: preset.width, ...(seal ? { seal } : {}), flange: preset.flange ?? null, balls: null, ballDiameter: null };
}

/** The sizes and options the model takes for these parameters (balls and ball diameter only apply to an open bearing). */
export function bearingSpec(p: BearingParams): BearingSpec {
  return {
    bore: p.bore, od: p.od, width: p.width, seal: p.seal,
    ...(p.chamfer !== null ? { chamfer: p.chamfer } : {}),
    ...(p.flange ? { flange: p.flange } : {}),
    ...(p.seal === 'open' && p.balls !== null ? { balls: p.balls } : {}),
    ...(p.seal === 'open' && p.ballDiameter !== null ? { ballDiameter: p.ballDiameter } : {}),
  };
}

/** The numbers a valid record gives (chamfer, ball count and diameter with their defaults filled in); null when the record has a problem. */
export function bearingNumbers(p: BearingParams): BearingModel | null {
  return bearingProblem(bearingSpec(p)) ? null : bearingModel(bearingSpec(p));
}

/** The pocket for the outer ring in the fit chosen: diameter, depth and a note for a drawing. */
export const bearingSeat = (p: BearingParams) => housingSeat({ od: p.od, width: p.width, fit: p.seatFit });

/**
 * The face the bearing is built from, so that it moves with the face: the face it was placed on, while it is still where that placement put it along its axis
 * (sliding it across the face keeps it on the face; a different axis, or a different depth, is a position of the user's own, built at those numbers).
 */
export function followedFace(p: BearingParams): string | null {
  const at = p.placedAt;
  if (!p.placedOn || !at || at.axis !== p.axis) return null;
  const k = 'xyz'.indexOf(p.axis[1]);
  return Math.abs(at.origin[k] - p.origin[k]) < 1e-6 ? p.placedOn : null;
}

/** The options of the script helper for these parameters. */
export function bearingOpts(p: BearingParams): BearingOpts {
  const s = bearingSpec(p);
  return {
    bore: s.bore, od: s.od, width: s.width, seal: p.seal,
    ...(s.chamfer !== undefined ? { chamfer: s.chamfer } : {}),
    ...(s.flange ? { flange: s.flange } : {}),
    ...(s.balls !== undefined ? { balls: s.balls } : {}),
    ...(s.ballDiameter !== undefined ? { ballDiameter: s.ballDiameter } : {}),
    origin: p.origin, axis: AXIS_VEC[p.axis],
    ...(p.designation ? { name: `Bearing ${p.designation}` } : {}),
    ...(followedFace(p) ? { onFace: followedFace(p)! } : {}),
    ...(p.seat && p.placedOn ? { seat: { fit: p.seatFit } } : {}),
  };
}

export type BearingIssueCode = 'size' | 'model';
export interface BearingIssue { code: BearingIssueCode; params: Record<string, string | number>; message: string }

/** The first problem with the parameters (none when the ops can be made). */
export function bearingIssue(p: BearingParams): BearingIssue | null {
  const bad = (code: BearingIssueCode, message: string, params: Record<string, string | number> = {}): BearingIssue => ({ code, params, message });
  if (![p.bore, p.od, p.width].every((v) => Number.isFinite(v) && v > 0)) return bad('size', 'Bore, outer diameter and width must be more than 0');
  if (!(p.bore < p.od)) return bad('size', 'The bore must be smaller than the outer diameter');
  const why = bearingProblem(bearingSpec(p));
  return why ? bad('model', why) : null;
}

/** The ops that append the bearing to the document (all in one tree folder named after the wizard, see wizardGroup.ts), numbered from the document's next feature id. Throws with the helper's message. */
export function bearingOps(doc: { features: Array<{ id?: string }>; seq?: number }, p: BearingParams): EditOp[] {
  let n = doc.seq ?? 1;
  for (const f of doc.features) { const m = /^F(\d+)$/.exec(String(f.id ?? '')); if (m) n = Math.max(n, Number(m[1]) + 1); }
  const opts = bearingOpts(p);
  return groupOps(bearingEditOps({ ...opts, name: freeBodyPrefix(doc.features, opts.name ?? 'Bearing') }, n) as unknown as EditOp[], wizardGroupName(doc.features, t('bearing.title')));
}

/**
 * The name prefix for a new bearing's bodies ("Bearing 608 inner ring", "... outer ring", "... ball"). Body names must be unique in a part, so a second
 * bearing of the same size takes "Bearing 608 2", a third "Bearing 608 3": the first number whose bodies no feature already names.
 */
export function freeBodyPrefix(features: ReadonlyArray<object>, base: string): string {
  const used = new Set<string>();
  for (const f of features as Array<Record<string, unknown>>) for (const k of ['newBody', 'body']) if (typeof f[k] === 'string') used.add(f[k] as string);
  const esc = (v: string): string => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const taken = (c: string): boolean => { const re = new RegExp(`^${esc(c)} (inner ring|outer ring|ball( \\d+)?)$`); return [...used].some((u) => re.test(u)); };
  if (!taken(base)) return base;
  for (let i = 2; ; i++) if (!taken(`${base} ${i}`)) return `${base} ${i}`;
}

// ---- seating on a picked face ----

export interface FaceMesh { positions: ArrayLike<number>; normals: ArrayLike<number>; triFace: ArrayLike<number>; faceIds: string[] }
const round3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;

/**
 * Where a bearing sits on a flat face of the body: the centre of the face's bounding box (its own extent, holes included) and the outward normal, when the normal
 * lies along a world axis. The bearing extends into the body, so the wizard's axis is the opposite of the normal. Null for a curved, tilted or unknown face.
 */
export function seatOnFace(face: string, mesh: FaceMesh | null): { origin: [number, number, number]; axis: (typeof BEARING_AXES)[number] } | null {
  if (!mesh) return null;
  const id = mesh.faceIds.indexOf(face);
  if (id < 0) return null;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], n = [0, 0, 0];
  let tris = 0;
  for (let t = 0; t < mesh.triFace.length; t++) {
    if (mesh.triFace[t] !== id) continue;
    tris++;
    for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) {
      const x = mesh.positions[t * 9 + v * 3 + k];
      lo[k] = Math.min(lo[k], x); hi[k] = Math.max(hi[k], x);
      n[k] += mesh.normals[t * 9 + v * 3 + k];
    }
  }
  if (!tris) return null;
  const len = Math.hypot(n[0], n[1], n[2]);
  if (!(len > 1e-9)) return null;
  const u = n.map((x) => x / len);
  const k = [0, 1, 2].find((i) => Math.abs(Math.abs(u[i]) - 1) < 1e-3);
  if (k === undefined) return null;
  // flat: the face spans nothing along its normal
  if (hi[k] - lo[k] > 1e-4) return null;
  const origin = [0, 1, 2].map((i) => round3((lo[i] + hi[i]) / 2)) as [number, number, number];
  const sign = u[k] > 0 ? 'n' : 'p';   // into the body: the opposite of the outward normal
  return { origin, axis: (sign + 'xyz'[k]) as (typeof BEARING_AXES)[number] };
}
