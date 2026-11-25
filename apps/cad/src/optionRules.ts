// Pure rules of the per-feature option forms (FeatureOptions.tsx): which end conditions, chamfer types and fillet profiles
// the kernel really reads, which fields each choice shows, and the draft patches a control makes. No DOM, so the rules are
// tested without a browser (optionRules.test.ts) and against the kernel (optionRules.kernel.test.ts).
// A patch value of null means "remove this field" (the same protocol as holeData.ts and main.tsx opsFromDraft).

import { planeName, viewPlaneIds } from './planeNames';
import { t } from './i18n';
import { sheetManagedPaths } from './sheet/options';
import { featureLabel } from './featureLabels';
import { curveManaged } from './curveRules';
import { procSurfaceManaged } from './procSurfaceRules';
import { axisChoices } from './revolveAxis';

type Wire = Record<string, unknown>;

/**
 * `toObject` ends the extrusion at any reference in `endRef` (a face, a plane, a corner or point, a named body), read again on
 * every rebuild so the end follows it; `endOffset` moves it along the extrusion. `start: 'fromObject'` with `startRef` and
 * `startOffset` starts it there instead of on the sketch plane (with a blind or To object end). The kernel refuses a lost
 * reference with a hint and never guesses (extrude_object.rs). The older upToFace / offsetFromFace / upToPoint ends are not
 * offered (To object covers them); a feature that has one still shows it.
 */
export type EndCondition = 'blind' | 'mid' | 'through' | 'throughBoth' | 'upToNext' | 'toObject' | 'upToFace' | 'offsetFromFace' | 'upToPoint';
const EXTRUDE_ENDS: EndCondition[] = ['blind', 'mid', 'through', 'throughBoth', 'upToNext', 'toObject'];

/** Extrude (and cut) end conditions on offer. Revolve has only blind (an angle) and mid (symmetric about the sketch). */
export function endsFor(type: string): EndCondition[] {
  if (type === 'revolve') return ['blind', 'mid'];
  return EXTRUDE_ENDS;
}

export const endOf = (eff: Wire): EndCondition => (typeof eff.end === 'string' ? (eff.end as EndCondition) : 'blind');
/** Depth: blind and mid. Through, through-both and up-to-next take their length from the body. */
export const endNeedsDepth = (end: string): boolean => end === 'blind' || end === 'mid';
/** The end that names a reference (`endRef`). */
export const endNeedsObject = (end: string): boolean => end === 'toObject';
/** From object works with a blind or To object end. */
export const startAllowed = (end: string): boolean => end === 'blind' || end === 'toObject';
export type StartCondition = 'sketch' | 'fromObject';
export const startOf = (eff: Wire): StartCondition => (eff.start === 'fromObject' ? 'fromObject' : 'sketch');
/** Patch for choosing the start: the sketch plane drops the reference and its offset. */
export const patchStart = (start: StartCondition): Wire => (start === 'fromObject' ? { start } : { start: null, startRef: null, startOffset: null });
/** Draft is cut for one-sided ends only (the kernel refuses a drafted mid-plane or through-both extrude). */
export const endAllowsDraft = (end: string): boolean => end !== 'mid' && end !== 'throughBoth';

/** End scale (the whole outline grows or shrinks over the depth) works for a blind or a mid-plane extrude; the kernel refuses it with a draft angle, a twist, through, up to next and a body or slanted end. */
export const endAllowsEndScale = (end: string): boolean => end === 'blind' || end === 'mid';
/** End scale as a factor (1 = none). */
export const endScaleOf = (eff: Wire): number | string => (typeof eff.endScale === 'number' || (typeof eff.endScale === 'string' && eff.endScale !== '') ? eff.endScale : 1);
/** Setting 1 removes the field; an end scale drops the draft angle and the twist (the kernel takes one taper at a time). */
export function patchEndScale(deg: number | string): Wire {
  if (deg === 1 || deg === '' || deg === null) return { endScale: null };
  return { endScale: deg, draft: null, draftOut: null, twist: null, twistCentre: null };
}

/** Twist cannot go with Up to next (the kernel answers draftUnsupported), nor with a draft angle. */
export const endAllowsTwist = (end: string): boolean => end !== 'upToNext';
/** Twist in degrees over the full depth (0 = none). */
export const twistOf = (eff: Wire): number | string => (typeof eff.twist === 'number' || (typeof eff.twist === 'string' && eff.twist !== '') ? eff.twist : 0);
/** The twist axis through the sketch (x, y); the sketch origin when none is set. */
export function twistCentreOf(eff: Wire): [number, number] {
  const c = Array.isArray(eff.twistCentre) ? eff.twistCentre : [];
  return [typeof c[0] === 'number' ? c[0] : 0, typeof c[1] === 'number' ? c[1] : 0];
}
/** Setting a twist of 0 removes it and its centre; a twist and a draft angle exclude each other (the kernel refuses both), so a twist drops the draft. */
export function patchTwist(eff: Wire, deg: number | string): Wire {
  if (deg === 0 || deg === '' || deg === null) return { twist: null, twistCentre: null };
  return { twist: deg, draft: null, draftOut: null, ...(eff.endScale != null ? { endScale: null } : {}) };
}
/** One coordinate of the twist axis; (0, 0) removes the field. */
export function patchTwistCentre(eff: Wire, index: 0 | 1, value: number): Wire {
  const c = twistCentreOf(eff);
  c[index] = value;
  return { twistCentre: c[0] === 0 && c[1] === 0 ? null : c };
}

/** The fields a form of this feature type owns; the generic editor hides them. */
export function managedPaths(type: string): Set<string> {
  switch (type) {
    case 'extrude': return new Set(['end', 'depth', 'flip', 'draft', 'draftOut', 'endRef', 'endOffset', 'start', 'startRef', 'startOffset', 'twist', 'twistCentre', 'endScale', 'thin', 'op', 'body', 'target']);
    case 'revolve': return new Set(['end', 'angle', 'flip', 'thin', 'op', 'body', 'target']);
    case 'chamfer': return new Set(['chamferType', 'distance', 'distance2', 'angle']);
    case 'fillet': return new Set(['radius', 'filletType', 'radii', 'profile', 'rho', 'shape', 'side1', 'center', 'side2']);
    case 'shell': return new Set(['thickness', 'outward', 'inside']);
    case 'rib': return new Set(['side', 'fillet', 'draft', 'target']);
    case 'loft': return new Set(['sketches', 'guides', 'surface', 'op', 'body', 'target', 'startNormal', 'endNormal', 'centreLine', 'connectors', 'railSmoothing']);
    case 'sweep': return new Set(['sketch', 'path', 'guides', 'twist', 'op', 'body', 'target']);
    case 'sphere': return new Set(['center', 'radius', 'op', 'body']);
    case 'combine': return new Set(['op', 'keepTools']);
    case 'moveFace': return new Set(['continue', 'taper']);   // the Continue choice (and, once Straight, the taper) sit in the Press Pull form; Offset keeps the generic fields
    case 'pressPull': return new Set(['continue', 'distance', 'taper', 'mode', 'translate', 'flip']);
    case 'moveBody': return new Set(['copy', 'body']);
    case 'scale': return new Set(['factor', 'factors', 'about', 'at', 'origin']);
    case 'split': return new Set(['offset', 'flip', 'names', 'keep', 'target']);
    case 'lipJoint': return new Set(['offset', 'flip', 'names', 'target', 'tongue', 'height', 'width', 'widthRatio', 'inset', 'clearance']);
    case 'deleteBody': return new Set(['bodies']);
    case 'fill': return new Set(['continuity', 'fairing', 'merge', 'patch', 'patchTolerance']);
    case 'extend': return new Set(['distance', 'shape', 'end']);
    case 'lpattern': return new Set(['carryThreads', ...['dir', 'count', 'spacing', 'reverse', 'distanceType', 'extent', 'to', 'toOffset'].flatMap((b) => [b, b + '2'])]);
    case 'curvepattern': return new Set(['carryThreads', 'path', 'count', 'spacing', 'distanceType', 'extent', 'start', 'startFraction', 'flip', 'orientation']);
    case 'cpattern': return new Set(['carryThreads', 'axis']);
    case 'mirror': return new Set(['carryThreads']);
    case 'knit': return new Set(['surfaces', 'solid']);
    case 'trimSurface': return new Set(['surface', 'toolSurface', 'flip', 'mutual', 'deleteTool']);
    case 'plane': return new Set(['base', 'offset', 'flip', 'axis', 'angle', 'base2']);
    case 'connector': return new Set(['anchor', 'offset', 'flip', 'rotateZ', 'frozenFrame']);
    case 'thicken': return new Set(['thickness', 'thicknessAt']);
    default: { const sheet = sheetManagedPaths(type); if (sheet.size) return sheet; const curve = curveManaged(type); return curve.size ? curve : procSurfaceManaged(type); }
  }
}
export const hasOptions = (type: string): boolean => managedPaths(type).size > 0;

/** Patch for choosing an end condition: it drops the fields the new end does not read, and gives the new ones a value. */
export function patchEnd(eff: Wire, end: EndCondition): Wire {
  const p: Wire = { end };
  const depth = typeof eff.depth === 'number' ? eff.depth : 10;
  if (endNeedsDepth(end)) { if (typeof eff.depth !== 'number') p.depth = depth; } else p.depth = null;
  if (!endAllowsDraft(end)) { p.draft = null; p.draftOut = null; }
  if (!endAllowsTwist(end)) { p.twist = null; p.twistCentre = null; }
  if (!endAllowsEndScale(end)) p.endScale = null;
  if (!endNeedsObject(end)) { p.endRef = null; p.endOffset = null; }
  if (!startAllowed(end)) { p.start = null; p.startRef = null; p.startOffset = null; }
  return p;
}

/** Through all can go one way (with Flip) or both ways from the sketch plane (`throughBoth`): the Both directions box switches between them. */
export const endHasBothWays = (end: string): boolean => end === 'through' || end === 'throughBoth';
export const bothWaysOf = (eff: Wire): boolean => eff.end === 'throughBoth';
/** Both directions on: a through-both end with no flip (it has no direction). Off: Through all one way again. */
export function patchBothWays(eff: Wire, on: boolean): Wire {
  return on ? { ...patchEnd(eff, 'throughBoth'), flip: null } : patchEnd(eff, 'through');
}
/** Which side of the sketch plane the body is on, seen from the cut: the way the cut goes, the other way, on both sides, or not known. */
export type CutBodySide = 'toward' | 'away' | 'both' | null;
/** What the "cut does not reach any body" note offers besides Add: Flip direction for an end that goes one way, unless the whole
 *  body lies the way the cut already goes (flipping would cut air), and for Through all also Both directions. */
export function cutMissOffers(eff: Wire, side: CutBodySide): { flip: boolean; both: boolean } {
  const end = endOf(eff);
  const flip = (end === 'blind' || end === 'through' || end === 'upToNext') && side !== 'toward';
  return { flip, both: flip && end === 'through' };
}

/** Draft angle (degrees, 0 = none) and its direction: setting 0 removes both fields. */
export function patchDraft(eff: Wire, angle: number): Wire {
  return angle > 0 ? { draft: angle, ...(eff.endScale != null ? { endScale: null } : {}) } : { draft: null, draftOut: null };
}

export type ChamferType = 'equal' | 'distances' | 'angle';
/** The wire names are the ones chamfer_legs reads (blends.rs): `distances` and `angle`, not the angleDistance / distanceDistance of the type enum, which the kernel answers `unsupported`. `vertex` needs a corner pick and is not offered. */
export const CHAMFER_TYPES: ChamferType[] = ['equal', 'distances', 'angle'];
export const chamferTypeOf = (eff: Wire): ChamferType => (eff.chamferType === 'distances' || eff.chamferType === 'angle' ? eff.chamferType : 'equal');

export function patchChamferType(eff: Wire, type: ChamferType): Wire {
  const d = typeof eff.distance === 'number' ? eff.distance : 1;
  return {
    chamferType: type,
    distance2: type === 'distances' ? (typeof eff.distance2 === 'number' ? eff.distance2 : d) : null,
    angle: type === 'angle' ? (typeof eff.angle === 'number' ? eff.angle : 45) : null,
  };
}

export type FilletProfile = 'circular' | 'conic' | 'chord' | 'curvature';
export const FILLET_PROFILES: FilletProfile[] = ['circular', 'conic', 'chord', 'curvature'];
export const filletProfileOf = (eff: Wire): FilletProfile => (FILLET_PROFILES as string[]).includes(String(eff.profile)) ? (eff.profile as FilletProfile) : 'circular';
export const filletVariable = (eff: Wire): boolean => eff.filletType === 'variable';
/** Full round: a ball tangent to three planar faces (side, centre, side) rolls between the sides and the centre face vanishes. */
export const filletFullRound = (eff: Wire): boolean => eff.filletType === 'fullRound';
export const FULL_ROUND_FACES = ['side1', 'center', 'side2'] as const;
export type FullRoundFace = (typeof FULL_ROUND_FACES)[number];
const noFullRound: Wire = { side1: null, center: null, side2: null };
/** Full round on or off. On drops the variable radii and the profile (it reads none of them); the radius stays for when it is switched off. */
export function patchFilletFullRound(eff: Wire, on: boolean): Wire {
  if (on) return { filletType: 'fullRound', radii: null, profile: null, rho: null, shape: null };
  return { filletType: null, ...noFullRound };
}
/** The two radii of a variable fillet (near, far); the constant radius for a missing one. */
export function radiiOf(eff: Wire): [number, number] {
  const r = typeof eff.radius === 'number' ? eff.radius : 1;
  const a = Array.isArray(eff.radii) ? eff.radii : [];
  return [typeof a[0] === 'number' ? a[0] : r, typeof a[1] === 'number' ? a[1] : r];
}

/** Variable radius on or off. Off keeps the first radius as the constant one. */
export function patchFilletVariable(eff: Wire, on: boolean): Wire {
  if (on) return { filletType: 'variable', radii: radiiOf(eff), ...(filletFullRound(eff) ? noFullRound : {}) };
  return { filletType: null, radii: null, radius: radiiOf(eff)[0] };
}
export function patchRadii(eff: Wire, index: 0 | 1, value: number): Wire {
  const r = radiiOf(eff);
  r[index] = value;
  return { radii: r };
}
/** Profile choice: conic needs `rho` (0..1 open), curvature needs `shape` (0.1..1); the other profiles carry neither. */
export function patchFilletProfile(eff: Wire, profile: FilletProfile): Wire {
  return {
    profile: profile === 'circular' ? null : profile,
    rho: profile === 'conic' ? (typeof eff.rho === 'number' ? eff.rho : 0.5) : null,
    shape: profile === 'curvature' ? (typeof eff.shape === 'number' ? eff.shape : 0.5) : null,
  };
}

// ---- the base of a reference plane ----

type RefLike = { kind?: string; id?: string } | null | undefined;
/** The selector value of a plane's base: `std:front`, `feature:F3` or `face:F2.S.f1` (Front when it has none). */
export const planeBaseValue = (base: unknown): string => {
  const b = base as RefLike;
  return b?.kind && b.id ? `${b.kind}:${b.id}` : 'std:front';
};
/** The edit that sets the base from a selector value. */
export function planeBasePatch(value: string): Wire {
  const i = value.indexOf(':');
  return { base: { kind: value.slice(0, i), id: value.slice(i + 1) } };
}
/** What a plane may hang on: the three standard planes, the Plane features before it, and the face it is on now. */
export function planeBaseChoices(doc: { features?: unknown[] } | null | undefined, selfId: string, current: unknown): Array<[string, string]> {
  const out: Array<[string, string]> = viewPlaneIds().map((id): [string, string] => ['std:' + id, planeName(id)]);
  for (const f of (doc?.features ?? []) as Array<{ id: string; type: string; name?: string }>) {
    if (f.id === selfId) break;
    if (f.type === 'plane') out.push([`feature:${f.id}`, featureLabel(doc, f as never) || f.id]);
  }
  const cur = current as RefLike;
  if (cur?.kind === 'face' && cur.id) out.push([`face:${cur.id}`, t('opt.plane.face', { id: cur.id })]);
  return out;
}

// ---- Reference plane modes: what each needs (the kernel's reading, pinned by refPlane.kernel.test.ts) ----

/** What a plane's mode reads. Offset: base, offset and flip. Angle: base, axis, angle, offset and flip (tilt about the axis, then move along the tilted normal by the offset). Perpendicular: base, axis and flip. Midplane: base and a second plane. */
export interface PlaneNeeds { axis: boolean; angle: boolean; base2: boolean; offset: boolean; flip: boolean }
export function planeNeeds(mode: unknown): PlaneNeeds {
  if (mode === 'angle') return { axis: true, angle: true, base2: false, offset: true, flip: true };
  if (mode === 'perpendicular') return { axis: true, angle: false, base2: false, offset: false, flip: true };
  if (mode === 'mid') return { axis: false, angle: false, base2: true, offset: false, flip: false };
  return { axis: false, angle: false, base2: false, offset: true, flip: true };
}

type SketchLike = { id: string; type: string; name?: string; entities?: Array<{ id: string; type: string }> };
/** The selector value of an axis: `axis:x` (a standard axis), `sketchLine:SK:ent`, `feature:AX1`. */
export function planeAxisValue(axis: unknown): string {
  const a = axis as { kind?: string; axis?: string; sketch?: string; entity?: string; id?: string } | null | undefined;
  if (!a || !a.kind) return '';
  if (a.kind === 'axis' && typeof a.axis === 'string') return 'axis:' + a.axis;
  if (a.kind === 'sketchLine' && a.sketch && a.entity) return `sketchLine:${a.sketch}:${a.entity}`;
  if (a.kind === 'feature' && a.id) return 'feature:' + a.id;
  return 'other';   // an axis given by a point and a direction (or an edge): kept as it is, shown as picked
}
export function planeAxisPatch(value: string): Wire {
  const [kind, a, b] = value.split(':');
  if (kind === 'axis') return { axis: { kind: 'axis', axis: a } };
  if (kind === 'sketchLine') return { axis: { kind: 'sketchLine', sketch: a, entity: b } };
  if (kind === 'feature') return { axis: { kind: 'feature', id: a } };
  return {};
}
/** What a plane can turn about: the X, Y and Z axes, the axis features before it, and every straight line of the sketches before it. */
export function planeAxisChoices(doc: { features?: unknown[] } | null | undefined, selfId: string, current: unknown): Array<[string, string]> {
  const out: Array<[string, string]> = (['x', 'y', 'z'] as const).map((a): [string, string] => ['axis:' + a, t('opt.plane.axis.std', { axis: a.toUpperCase() })]);
  for (const f of (doc?.features ?? []) as SketchLike[]) {
    if (f.id === selfId) break;
    if (f.type === 'axis') out.push([`feature:${f.id}`, featureLabel(doc, f as never) || f.id]);
    else if (f.type === 'sketch') for (const e of axisChoices(f as never)) out.push([`sketchLine:${f.id}:${e[0]}`, `${featureLabel(doc, f as never) || f.id}: ${e[1]}`]);
  }
  const v = planeAxisValue(current);
  if (v === 'other') out.push(['other', t('opt.plane.axis.picked')]);
  return out;
}

// ---- Mate Connector (`type: 'connector'`) ----

export const CONNECTOR_ROTATE_PRESETS = [0, 90, 180, 270] as const;

/** The selector value of a connector's anchor: `std:front`, `feature:P1`, `connector:C1`, `face:F2.C1`, `frame`, or `picked`. */
export function connectorAnchorValue(anchor: unknown): string {
  const a = anchor as { kind?: string; id?: string; face?: string } | null | undefined;
  if (!a || typeof a !== 'object' || !a.kind) return 'std:front';
  if ((a.kind === 'std' || a.kind === 'feature' || a.kind === 'connector' || a.kind === 'face') && a.id) return `${a.kind}:${a.id}`;
  if (a.kind === 'frame') return 'frame';
  return 'picked';
}

/** Patch that sets `anchor` from a selector value (returns null for read-only `frame` / `picked` entries). */
export function connectorAnchorPatch(value: string): Wire | null {
  const i = value.indexOf(':');
  if (i < 0) return null;
  return { anchor: { kind: value.slice(0, i), id: value.slice(i + 1) } };
}

/** Anchor choices for a Mate Connector: standard planes, earlier Plane and Connector features, plus the current face / frame / geometric anchor. */
export function connectorAnchorChoices(doc: { features?: unknown[] } | null | undefined, selfId: string, current: unknown): Array<[string, string]> {
  const out: Array<[string, string]> = viewPlaneIds().map((id): [string, string] => ['std:' + id, planeName(id)]);
  for (const f of (doc?.features ?? []) as Array<{ id: string; type: string; name?: string }>) {
    if (f.id === selfId) break;
    if (f.type === 'plane') out.push([`feature:${f.id}`, featureLabel(doc, f as never) || f.id]);
    else if (f.type === 'connector') out.push([`connector:${f.id}`, featureLabel(doc, f as never) || f.id]);
  }
  const cur = current as { kind?: string; id?: string } | null | undefined;
  if (cur?.kind === 'face' && cur.id) out.push([`face:${cur.id}`, t('opt.plane.face', { id: cur.id })]);
  else if (cur?.kind === 'frame') out.push(['frame', t('opt.connector.frame')]);
  else if (cur?.kind && !out.some(([v]) => v === connectorAnchorValue(cur))) out.push(['picked', t('opt.connector.picked', { kind: cur.kind })]);
  return out;
}

/** Local `[dx, dy, dz]` offset of a Mate Connector (0 when absent). */
export function connectorOffsetOf(eff: Wire): [number | string, number | string, number | string] {
  const o = Array.isArray(eff.offset) ? eff.offset : [];
  const item = (v: unknown): number | string => (typeof v === 'number' || (typeof v === 'string' && v !== '') ? v : 0);
  return [item(o[0]), item(o[1]), item(o[2])];
}

/** Patch one component of `offset`; all-zero removes the field. */
export function patchConnectorOffset(eff: Wire, index: 0 | 1 | 2, value: number | string): Wire {
  const next = connectorOffsetOf(eff);
  next[index] = value === '' ? 0 : value;
  const zero = next.every((v) => v === 0);
  return { offset: zero ? null : next };
}

/** Local Z rotation in degrees (0 when absent). */
export const connectorRotateZOf = (eff: Wire): number | string =>
  typeof eff.rotateZ === 'number' || (typeof eff.rotateZ === 'string' && eff.rotateZ !== '') ? eff.rotateZ : 0;

/** Patch `rotateZ`; 0 or empty removes the field. */
export const patchConnectorRotateZ = (deg: number | string): Wire =>
  deg === 0 || deg === '' || deg === null ? { rotateZ: null } : { rotateZ: deg };

// ---- To object / From object references ----

type ObjRef = { kind?: string; id?: string; name?: string; sketch?: string; point?: string; faces?: string[]; at?: number[] } | string | null | undefined;
const objOf = (r: unknown): Exclude<ObjRef, string> => (typeof r === 'string' ? (r ? { kind: 'face', id: r } : null) : (r as Exclude<ObjRef, string>));
const num = (v: number): string => String(Math.round(v * 1000) / 1000);

/** A reference in words: 'Face F2.C1', 'Top Plane', the Plane feature's name, 'Body Lid', 'Corner at (1, 2, 3)'. */
export function objectRefLabel(doc: { features?: unknown[] } | null | undefined, ref: unknown): string {
  const r = objOf(ref);
  if (!r || typeof r !== 'object') return '';
  switch (r.kind) {
    case 'face': return r.id ? t('opt.plane.face', { id: r.id }) : '';
    case 'std': return r.id ? planeName(r.id) : '';
    case 'feature': {
      const f = (doc?.features ?? []).find((x) => (x as { id: string }).id === r.id);
      return (f ? featureLabel(doc, f as never) : '') || t('opt.toObject.plane', { id: String(r.id) });
    }
    case 'body': return t('opt.toObject.body', { name: String(r.name) });
    case 'vertex': case 'point': {
      const a = r.at ?? [];
      return t(r.kind === 'vertex' ? 'opt.toObject.corner' : 'opt.toObject.point', { at: a.map((v) => num(Number(v))).join(', ') });
    }
    case 'sketchPoint': return t('opt.toObject.sketchPoint', { point: String(r.point), sketch: String(r.sketch) });
    default: return '';
  }
}

/** The list value of a reference: `std:top`, `feature:P1`, `body:Lid`; a picked face or point is `picked`; none is ''. */
export function objectRefValue(ref: unknown): string {
  const r = objOf(ref);
  if (!r) return '';
  if ((r.kind === 'std' || r.kind === 'feature') && r.id) return `${r.kind}:${r.id}`;
  if (r.kind === 'body' && r.name) return `body:${r.name}`;
  return 'picked';
}

/** The reference a list value stands for. */
export function objectRefPatch(value: string): Wire | null {
  const i = value.indexOf(':');
  if (i < 0) return null;
  const kind = value.slice(0, i), id = value.slice(i + 1);
  return kind === 'body' ? { kind, name: id } : { kind, id };
}

/** What the To object / From object list offers: the three planes, the Plane features before this feature and (for an end)
 *  the named bodies. The current reference heads the list when it is not one of them (a picked face, corner or point). */
export function objectRefChoices(doc: { features?: unknown[] } | null | undefined, selfId: string, current: unknown, bodies: boolean): Array<[string, string]> {
  const out: Array<[string, string]> = viewPlaneIds().map((id): [string, string] => ['std:' + id, planeName(id)]);
  const names: string[] = [];
  for (const f of (doc?.features ?? []) as Array<{ id: string; type: string; body?: unknown }>) {
    if (f.id === selfId) break;
    if (f.type === 'plane') out.push([`feature:${f.id}`, featureLabel(doc, f as never) || f.id]);
    if (bodies && typeof f.body === 'string' && f.body && !names.includes(f.body)) names.push(f.body);
  }
  for (const n of names) out.push([`body:${n}`, t('opt.toObject.body', { name: n })]);
  const v = objectRefValue(current);
  if (!v) out.unshift(['', t(bodies ? 'opt.toObject.none' : 'opt.fromObject.none')]);
  else if (!out.some(([x]) => x === v)) out.unshift([v, objectRefLabel(doc, current)]);
  return out;
}


// ---- Press Pull: Continue Offset (a moveFace, the faces move along their normals and the neighbours follow) or Straight (a
// pressPull feature: a flat face continued as if it were extruded, joined or cut, with an optional draft or scale taper).

export type PressContinue = 'offset' | 'straight' | 'along';
/** The Continue choices in the order shown; Along the Walls (the end follows a bend in the walls) is shown but the kernel does not build it yet. */
export const PRESS_CONTINUES: PressContinue[] = ['offset', 'straight', 'along'];
/** Along the Walls is marked "later" and cannot be chosen. */
export const pressContinueEnabled = (c: PressContinue): boolean => c !== 'along';
export const pressContinueOf = (eff: Wire): PressContinue => (eff.type === 'pressPull' ? (eff.continue === 'along' ? 'along' : 'straight') : 'offset');
/** Offset works on a moveFace in offset mode (a translate has no distance to carry over, so it has no Continue choice). */
export const pressHasContinue = (eff: Wire): boolean => eff.type === 'pressPull' || (eff.type === 'moveFace' && eff.mode !== 'translate');

/** The distance a conversion carries over: a number or an expression; a moveFace `flip` negates it (a number) or becomes `=-(expression)`. */
function carriedDistance(eff: Wire): number | string | undefined {
  const d = eff.distance;
  const flipped = eff.type === 'moveFace' && eff.flip === true;
  if (typeof d === 'number') return flipped ? -d : d;
  if (typeof d === 'string' && d !== '') return flipped ? `=-(${d.replace(/^=/, '')})` : d;
  return undefined;
}
/** Patch for choosing Continue: Offset <-> Straight converts the feature type (moveFace <-> pressPull) and keeps the faces and the distance. Switching to Straight leaves no taper; to Offset drops the taper. Along is not buildable: no patch. */
export function patchContinue(eff: Wire, to: PressContinue): Wire | null {
  if (!pressContinueEnabled(to) || pressContinueOf(eff) === to) return null;
  const distance = carriedDistance(eff);
  if (to === 'straight') return { type: 'pressPull', continue: 'straight', mode: null, translate: null, flip: null, ...(distance !== undefined ? { distance } : {}), taper: null };
  return { type: 'moveFace', mode: 'offset', continue: null, taper: null, ...(distance !== undefined ? { distance } : {}) };
}

export type TaperType = 'none' | 'draft' | 'scale';
export const TAPER_TYPES: TaperType[] = ['none', 'draft', 'scale'];
const taperOf = (eff: Wire): Wire => (eff.taper && typeof eff.taper === 'object' && !Array.isArray(eff.taper) ? (eff.taper as Wire) : {});
export const taperTypeOf = (eff: Wire): TaperType => { const t = taperOf(eff).type; return t === 'draft' || t === 'scale' ? t : 'none'; };
/** Draft angle in degrees (outward positive, the opposite sign of extrude's draft); 0 when there is none. */
export const taperAngleOf = (eff: Wire): number | string => { const a = taperOf(eff).angle; return typeof a === 'number' || (typeof a === 'string' && a !== '') ? a : 0; };
/** End scale as a factor (1 = none). */
export const taperScaleOf = (eff: Wire): number | string => { const e = taperOf(eff).endScale; return typeof e === 'number' || (typeof e === 'string' && e !== '') ? e : 1; };
/** Where a fresh taper starts: 5 degrees outward, or 1.2 times the face. */
export const TAPER_DEFAULTS = { draft: 5, scale: 1.2 } as const;
/** Patch for choosing the taper type: None removes the taper; the others start from a default, or keep the value they already had. */
export function patchTaperType(eff: Wire, type: TaperType): Wire {
  if (type === 'none') return { taper: null };
  if (type === 'draft') return { taper: { type: 'draft', angle: taperTypeOf(eff) === 'draft' ? taperAngleOf(eff) : TAPER_DEFAULTS.draft } };
  return { taper: { type: 'scale', endScale: taperTypeOf(eff) === 'scale' ? taperScaleOf(eff) : TAPER_DEFAULTS.scale } };
}
/** Patch for the draft angle (the kernel takes -85..85; 0 is straight and removes the taper). */
export const patchTaperAngle = (angle: number | string): Wire => (angle === 0 || angle === '' ? { taper: null } : { taper: { type: 'draft', angle } });
/** Patch for the end scale (1 is straight and removes the taper). */
export const patchTaperScale = (scale: number | string): Wire => (scale === 1 || scale === '' ? { taper: null } : { taper: { type: 'scale', endScale: scale } });

/**
 * The angle a scale taper makes with the walls, in degrees: atan(reach * (endScale - 1) / distance) where reach is the face's largest distance from its area
 * centre (the kernel's faceRun). The sign follows the draft's: positive when the outline grows along the run, whichever way the run goes (a cut has a
 * negative distance), so the readout matches the Draft taper's angle. Null when a value is not a number or the distance is 0.
 */
export function scaleTaperAngle(reach: unknown, endScale: unknown, distance: unknown): number | null {
  if (typeof reach !== 'number' || typeof endScale !== 'number' || typeof distance !== 'number') return null;
  if (!(reach > 0) || !(endScale > 0) || !Number.isFinite(distance) || distance === 0) return null;
  return (Math.atan((reach * (endScale - 1)) / Math.abs(distance)) * 180) / Math.PI;
}
