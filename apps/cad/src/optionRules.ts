// Pure rules of the per-feature option forms (FeatureOptions.tsx): which end conditions, chamfer types and fillet profiles
// the kernel really reads, which fields each choice shows, and the draft patches a control makes. No DOM, so the rules are
// tested without a browser (optionRules.test.ts) and against the kernel (optionRules.kernel.test.ts).
// A patch value of null means "remove this field" (the same protocol as holeData.ts and main.tsx opsFromDraft).

type Wire = Record<string, unknown>;

/**
 * The kernel parses the end conditions upToFace, offsetFromFace and upToPoint but does not cut them yet
 * (extrude.rs: "TODO(rebuild): extrude up to a reference needs ck-ops"), and it reads no field naming the face or the
 * point. The editor has the pick fields ready (endFace, endOffset, endPoint are the planned wire names) but does not offer
 * the three ends until this is true. optionRules.kernel.test.ts fails when the kernel starts cutting them.
 */
export const KERNEL_END_REFERENCES = false;

export type EndCondition = 'blind' | 'mid' | 'through' | 'throughBoth' | 'upToNext' | 'upToFace' | 'offsetFromFace' | 'upToPoint';
const BASE_ENDS: EndCondition[] = ['blind', 'mid', 'through', 'throughBoth', 'upToNext'];
const REF_ENDS: EndCondition[] = ['upToFace', 'offsetFromFace', 'upToPoint'];

/** Extrude (and cut) end conditions on offer. Revolve has only blind (an angle) and mid (symmetric about the sketch). */
export function endsFor(type: string): EndCondition[] {
  if (type === 'revolve') return ['blind', 'mid'];
  return KERNEL_END_REFERENCES ? [...BASE_ENDS, ...REF_ENDS] : BASE_ENDS;
}

export const endOf = (eff: Wire): EndCondition => (typeof eff.end === 'string' ? (eff.end as EndCondition) : 'blind');
/** Depth: blind and mid. Through, through-both and up-to-next take their length from the body. */
export const endNeedsDepth = (end: string): boolean => end === 'blind' || end === 'mid';
/** The end conditions that name a face, and the one that names a point. */
export const endNeedsFace = (end: string): boolean => end === 'upToFace' || end === 'offsetFromFace';
export const endNeedsPoint = (end: string): boolean => end === 'upToPoint';
/** Draft is cut for one-sided ends only (the kernel refuses a drafted mid-plane or through-both extrude). */
export const endAllowsDraft = (end: string): boolean => end !== 'mid' && end !== 'throughBoth';

/** The fields a form of this feature type owns; the generic editor hides them. */
export function managedPaths(type: string): Set<string> {
  switch (type) {
    case 'extrude': return new Set(['end', 'depth', 'flip', 'draft', 'draftOut', 'endFace', 'endOffset', 'endPoint']);
    case 'revolve': return new Set(['end', 'angle', 'flip']);
    case 'chamfer': return new Set(['chamferType', 'distance', 'distance2', 'angle']);
    case 'fillet': return new Set(['radius', 'filletType', 'radii', 'profile', 'rho', 'shape']);
    case 'shell': return new Set(['thickness', 'outward', 'inside']);
    case 'loft': return new Set(['sketches', 'guides', 'surface', 'op', 'startNormal', 'endNormal']);
    case 'sweep': return new Set(['sketch', 'path', 'guides', 'twist', 'op']);
    case 'fill': return new Set(['continuity', 'fairing', 'merge']);
    case 'extend': return new Set(['distance', 'shape', 'end']);
    case 'knit': return new Set(['surfaces', 'solid']);
    case 'trimSurface': return new Set(['surface', 'toolSurface', 'flip', 'mutual', 'deleteTool']);
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
  if (!endNeedsFace(end)) { p.endFace = null; p.endOffset = null; }
  else if (end === 'offsetFromFace' && typeof eff.endOffset !== 'number') p.endOffset = 0;
  else if (end === 'upToFace') p.endOffset = null;
  if (!endNeedsPoint(end)) p.endPoint = null;
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
