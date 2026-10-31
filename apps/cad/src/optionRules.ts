// Pure rules of the per-feature option forms (FeatureOptions.tsx): which end conditions, chamfer types and fillet profiles
// the kernel really reads, which fields each choice shows, and the draft patches a control makes. No DOM, so the rules are
// tested without a browser (optionRules.test.ts) and against the kernel (optionRules.kernel.test.ts).
// A patch value of null means "remove this field" (the same protocol as holeData.ts and main.tsx opsFromDraft).

import { t } from './i18n';
import { featureLabel } from './featureCreators';

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

/** The fields a form of this feature type owns; the generic editor hides them. */
export function managedPaths(type: string): Set<string> {
  switch (type) {
    case 'extrude': return new Set(['end', 'depth', 'flip', 'draft', 'draftOut', 'endRef', 'endOffset', 'start', 'startRef', 'startOffset', 'thin', 'op', 'body', 'target']);
    case 'revolve': return new Set(['end', 'angle', 'flip', 'thin', 'op', 'body', 'target']);
    case 'chamfer': return new Set(['chamferType', 'distance', 'distance2', 'angle']);
    case 'fillet': return new Set(['radius', 'filletType', 'radii', 'profile', 'rho', 'shape']);
    case 'shell': return new Set(['thickness', 'outward', 'inside']);
    case 'loft': return new Set(['sketches', 'guides', 'surface', 'op', 'body', 'target', 'startNormal', 'endNormal']);
    case 'sweep': return new Set(['sketch', 'path', 'guides', 'twist', 'op', 'body', 'target']);
    case 'sphere': return new Set(['center', 'radius', 'op', 'body']);
    case 'combine': return new Set(['op', 'keepTools']);
    case 'moveBody': return new Set(['copy', 'body']);
    case 'scale': return new Set(['factor', 'factors', 'about', 'at', 'origin']);
    case 'deleteBody': return new Set(['bodies']);
    case 'fill': return new Set(['continuity', 'fairing', 'merge']);
    case 'extend': return new Set(['distance', 'shape', 'end']);
    case 'lpattern': case 'cpattern': case 'mirror': return new Set(['carryThreads']);
    case 'knit': return new Set(['surfaces', 'solid']);
    case 'trimSurface': return new Set(['surface', 'toolSurface', 'flip', 'mutual', 'deleteTool']);
    case 'plane': return new Set(['base']);
    default: return new Set();
  }
}
export const hasOptions = (type: string): boolean => managedPaths(type).size > 0;

/** Patch for choosing an end condition: it drops the fields the new end does not read, and gives the new ones a value. */
export function patchEnd(eff: Wire, end: EndCondition): Wire {
  const p: Wire = { end };
  const depth = typeof eff.depth === 'number' ? eff.depth : 10;
  if (endNeedsDepth(end)) { if (typeof eff.depth !== 'number') p.depth = depth; } else p.depth = null;
  if (!endAllowsDraft(end)) { p.draft = null; p.draftOut = null; }
  if (!endNeedsObject(end)) { p.endRef = null; p.endOffset = null; }
  if (!startAllowed(end)) { p.start = null; p.startRef = null; p.startOffset = null; }
  return p;
}

/** Draft angle (degrees, 0 = none) and its direction: setting 0 removes both fields. */
export function patchDraft(eff: Wire, angle: number): Wire {
  return angle > 0 ? { draft: angle } : { draft: null, draftOut: null };
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
/** The two radii of a variable fillet (near, far); the constant radius for a missing one. */
export function radiiOf(eff: Wire): [number, number] {
  const r = typeof eff.radius === 'number' ? eff.radius : 1;
  const a = Array.isArray(eff.radii) ? eff.radii : [];
  return [typeof a[0] === 'number' ? a[0] : r, typeof a[1] === 'number' ? a[1] : r];
}

/** Variable radius on or off. Off keeps the first radius as the constant one. */
export function patchFilletVariable(eff: Wire, on: boolean): Wire {
  if (on) return { filletType: 'variable', radii: radiiOf(eff) };
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
  const out: Array<[string, string]> = [['std:front', t('app.ref.front')], ['std:top', t('app.ref.top')], ['std:right', t('app.ref.right')]];
  for (const f of (doc?.features ?? []) as Array<{ id: string; type: string; name?: string }>) {
    if (f.id === selfId) break;
    if (f.type === 'plane') out.push([`feature:${f.id}`, featureLabel(doc, f as never) || f.id]);
  }
  const cur = current as RefLike;
  if (cur?.kind === 'face' && cur.id) out.push([`face:${cur.id}`, t('opt.plane.face', { id: cur.id })]);
  return out;
}

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
    case 'std': return r.id ? t('app.ref.' + r.id) : '';
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
  const out: Array<[string, string]> = [['std:front', t('app.ref.front')], ['std:top', t('app.ref.top')], ['std:right', t('app.ref.right')]];
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
