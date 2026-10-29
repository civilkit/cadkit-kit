// The Propeller generator (airfoil-loft family): parameters, validation, the readout and the feature list for a hub with N lofted blades.
// Pure functions, no framework: the wizard and the tests turn a parameter record into a feature document (hub, one plane + spline sketch per
// blade section, a loft through the sections, a circular pattern of the blade, the bore). The record lives on the hub sketch as `prop` (the kernel
// keeps unknown fields) so reopening the wizard regenerates the same features. Hub size, bore and blade count are NAMED VARIABLES: editing one
// rebuilds the hub, bore and pattern only (the blade sketches are cached). See docs/propellers.md.
//
// Frame: the shaft axis is Z, the blade lies along +X at angle 0 and the sections sit on planes x = r. A section lives on the plane x = r; the plane's
// sketch axes are u = -Z and v = +Y, so a point with tangential T (world Y) and axial A (world Z) is drawn at (u, v) = (-A, T). Viewed from +Z looking down at the XY plane the 'ccw' propeller turns counter-clockwise, so its leading
// edges lead toward +Y and the thrust is toward +Z (the suction side of every section faces +Z). 'cw' is the mirror image (T negated).
import type { EditOp } from '@ck/session';
import { t } from './i18n';
import { groupPatch, wizardGroupName } from './wizardGroup';

export type AirfoilKind = 'naca4' | 'arc' | 'plate';
export const AIRFOIL_KINDS: AirfoilKind[] = ['naca4', 'arc', 'plate'];
export type TwistMode = 'pitch' | 'angle' | 'linear';
export const TWIST_MODES: TwistMode[] = ['pitch', 'angle', 'linear'];

export interface PropParams {
  /** Tip diameter, mm. */
  diameter: number;
  hubDia: number;
  hubLength: number;
  boreDia: number;
  /** 2..8 */
  blades: number;
  /** 'pitch': constant geometric pitch P (mm per revolution), section angle atan(P / 2 pi r). 'angle': the same law, set by the angle at `refRadius`.
   *  'linear': the angle runs linearly from `rootAngle` to `tipAngle`. */
  twist: TwistMode;
  pitch: number;
  /** Section angle (degrees from the plane of rotation) at the reference radius, for twist 'angle'. */
  pitchAngle: number;
  /** Reference radius as a fraction of the tip radius (pitch is quoted there). */
  refRadius: number;
  rootAngle: number;
  tipAngle: number;
  /** Chord (mm) at the blade root, at mid span (s = 0.5 of the way from root to tip after the exponent) and at the tip. */
  chordRoot: number;
  chordMid: number;
  chordTip: number;
  /** s' = s ^ exp reshapes where the mid value sits along the radius (1 = the middle, <1 pulls it toward the root). */
  chordExp: number;
  /** Thickness / chord at root, mid, tip. */
  thickRoot: number;
  thickMid: number;
  thickTip: number;
  thickExp: number;
  airfoil: AirfoilKind;
  /** Maximum camber as a fraction of the chord, and its chordwise position (NACA 4-digit: first two digits / 100 and second digit / 10). */
  camber: number;
  camberPos: number;
  /** Chordwise position (0 = leading edge, 1 = trailing edge) of the point every section turns about and the stacking line runs through. */
  pivot: number;
  /** Backward sweep of the stacking line out of the plane of rotation, degrees (positive = toward -Z, away from the thrust side). */
  rake: number;
  /** Tangential offset of the tip section toward the trailing side, mm (grows with the square of the span fraction). */
  skew: number;
  /** 5..12 */
  sections: number;
  direction: 'ccw' | 'cw';
  /** Where the blade starts inside the hub, as a fraction of the hub radius. */
  rootEmbed: number;
  /** Prefix of the document variables (hub diameter, length, bore, blade count). */
  varPrefix: string;
}

export const DEFAULT_PROP: PropParams = {
  diameter: 120, hubDia: 24, hubLength: 20, boreDia: 6, blades: 3,
  twist: 'pitch', pitch: 90, pitchAngle: 20, refRadius: 0.75, rootAngle: 55, tipAngle: 12,
  chordRoot: 18, chordMid: 20, chordTip: 9, chordExp: 1,
  thickRoot: 0.14, thickMid: 0.1, thickTip: 0.06, thickExp: 1,
  airfoil: 'naca4', camber: 0.04, camberPos: 0.4, pivot: 0.4, rake: 0, skew: 0,
  sections: 7, direction: 'ccw', rootEmbed: 0.6, varPrefix: 'prop',
};

/** Presets for the wizard (all geometry only, no performance claim). */
export const PROP_PRESETS: Record<string, Partial<PropParams>> = {
  drone5: { diameter: 127, hubDia: 18, hubLength: 8, boreDia: 5, blades: 3, pitch: 114, chordRoot: 14, chordMid: 15, chordTip: 7, thickRoot: 0.12, thickMid: 0.08, thickTip: 0.05, camber: 0.05, sections: 8 },
  deskFan: { diameter: 160, hubDia: 36, hubLength: 22, boreDia: 5, blades: 5, pitch: 100, chordRoot: 26, chordMid: 30, chordTip: 18, thickRoot: 0.1, thickMid: 0.08, thickTip: 0.06, camber: 0.07, sections: 7 },
  rcPlane: { diameter: 230, hubDia: 30, hubLength: 24, boreDia: 8, blades: 2, pitch: 150, chordRoot: 24, chordMid: 28, chordTip: 12, thickRoot: 0.14, thickMid: 0.1, thickTip: 0.06, camber: 0.04, sections: 9 },
};

const rad = (d: number): number => (d * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;
const fin = (v: number, d = 0): number => (Number.isFinite(v) ? v : d);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round = (v: number): number => Math.round(v * 1e9) / 1e9;
/** Largest section angle the pitch law may ask for near the root (a section turned past this is nearly along the shaft). */
export const MAX_SECTION_ANGLE = 80;

// ---- validation ----

export interface PropIssue {
  severity: 'error' | 'warning';
  /** Stable code (the wizard looks the text up under prop.issue.<code>). */
  code: string;
  /** The parameter it concerns. */
  field: keyof PropParams | 'geometry';
  message: string;
  /** Numbers for the message: {limit: 12} etc. */
  params?: Record<string, number | string>;
}

const issue = (severity: PropIssue['severity'], code: string, field: PropIssue['field'], message: string, params?: PropIssue['params']): PropIssue => ({ severity, code, field, message, params });

/** Every problem with the record: errors refuse to build, warnings do not. Never throws, NaN and Infinity are errors on their field. */
export function validateProp(p: PropParams): PropIssue[] {
  const out: PropIssue[] = [];
  const num: Array<keyof PropParams> = ['diameter', 'hubDia', 'hubLength', 'boreDia', 'blades', 'pitch', 'pitchAngle', 'refRadius', 'rootAngle', 'tipAngle', 'chordRoot', 'chordMid', 'chordTip', 'chordExp',
    'thickRoot', 'thickMid', 'thickTip', 'thickExp', 'camber', 'camberPos', 'pivot', 'rake', 'skew', 'sections', 'rootEmbed'];
  for (const k of num) if (typeof p[k] !== 'number' || !Number.isFinite(p[k] as number)) out.push(issue('error', 'notNumber', k, `${k} must be a finite number`));
  if (out.length) return out;
  if (!AIRFOIL_KINDS.includes(p.airfoil)) out.push(issue('error', 'badAirfoil', 'airfoil', `unknown airfoil ${String(p.airfoil)}`));
  if (!TWIST_MODES.includes(p.twist)) out.push(issue('error', 'badTwist', 'twist', `unknown twist mode ${String(p.twist)}`));
  if (p.direction !== 'ccw' && p.direction !== 'cw') out.push(issue('error', 'badDirection', 'direction', 'direction is ccw or cw'));
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(p.varPrefix)) out.push(issue('error', 'badPrefix', 'varPrefix', 'variable prefix must be a name'));
  if (p.diameter < 10) out.push(issue('error', 'diameterSmall', 'diameter', 'diameter must be at least 10 mm', { limit: 10 }));
  if (p.hubDia <= 0) out.push(issue('error', 'hubDia', 'hubDia', 'hub diameter must be positive'));
  else if (p.hubDia >= p.diameter) out.push(issue('error', 'hubTooBig', 'hubDia', `hub diameter ${p.hubDia} must be smaller than the propeller diameter ${p.diameter}`, { hub: p.hubDia, diameter: p.diameter }));
  else if (p.hubDia > 0.6 * p.diameter) out.push(issue('error', 'hubTooBig', 'hubDia', `hub diameter ${p.hubDia} leaves too little blade: at most 60 % of the diameter (${round(0.6 * p.diameter)} mm)`, { hub: p.hubDia, limit: round(0.6 * p.diameter) }));
  if (p.hubLength <= 0) out.push(issue('error', 'hubLength', 'hubLength', 'hub length must be positive'));
  if (p.boreDia < 0) out.push(issue('error', 'boreNegative', 'boreDia', 'bore diameter cannot be negative'));
  else if (p.boreDia > 0 && p.hubDia > 0 && p.boreDia > p.hubDia - 2) out.push(issue('error', 'boreTooBig', 'boreDia', `bore ${p.boreDia} leaves less than 1 mm of hub wall (hub ${p.hubDia})`, { bore: p.boreDia, limit: round(Math.max(0, p.hubDia - 2)) }));
  if (!Number.isInteger(p.blades) || p.blades < 2 || p.blades > 8) out.push(issue('error', 'bladeCount', 'blades', 'blade count is a whole number from 2 to 8', { limit: 8 }));
  if (!Number.isInteger(p.sections) || p.sections < 5 || p.sections > 12) out.push(issue('error', 'sectionCount', 'sections', 'sections is a whole number from 5 to 12', { limit: 12 }));
  if (p.twist === 'pitch' && !(p.pitch > 0)) out.push(issue('error', 'pitch', 'pitch', 'pitch must be positive (mm per revolution)'));
  if (p.twist === 'angle' && !(p.pitchAngle > 0 && p.pitchAngle <= MAX_SECTION_ANGLE)) out.push(issue('error', 'pitchAngle', 'pitchAngle', `pitch angle is between 0 and ${MAX_SECTION_ANGLE} degrees`, { limit: MAX_SECTION_ANGLE }));
  if (p.twist !== 'linear' && !(p.refRadius > 0.2 && p.refRadius <= 1)) out.push(issue('error', 'refRadius', 'refRadius', 'reference radius is between 0.2 and 1 of the tip radius'));
  if (p.twist === 'linear') for (const k of ['rootAngle', 'tipAngle'] as const) if (!(p[k] > 0 && p[k] <= MAX_SECTION_ANGLE)) out.push(issue('error', 'angleRange', k, `${k} is between 0 and ${MAX_SECTION_ANGLE} degrees`, { limit: MAX_SECTION_ANGLE }));
  for (const k of ['chordRoot', 'chordMid', 'chordTip'] as const) if (!(p[k] >= 1)) out.push(issue('error', 'chord', k, `${k} must be at least 1 mm`));
  for (const k of ['chordExp', 'thickExp'] as const) if (!(p[k] >= 0.2 && p[k] <= 5)) out.push(issue('error', 'exponent', k, `${k} is between 0.2 and 5`));
  for (const k of ['thickRoot', 'thickMid', 'thickTip'] as const) if (!(p[k] >= 0.02 && p[k] <= 0.4)) out.push(issue('error', 'thickness', k, `${k} (thickness / chord) is between 0.02 and 0.4`));
  if (!(p.camber >= 0 && p.camber <= 0.12)) out.push(issue('error', 'camber', 'camber', 'camber is between 0 and 0.12 of the chord'));
  if (!(p.camberPos >= 0.1 && p.camberPos <= 0.9)) out.push(issue('error', 'camberPos', 'camberPos', 'camber position is between 0.1 and 0.9 of the chord'));
  if (!(p.pivot >= 0 && p.pivot <= 1)) out.push(issue('error', 'pivot', 'pivot', 'pivot is between 0 (leading edge) and 1 (trailing edge)'));
  if (!(Math.abs(p.rake) <= 45)) out.push(issue('error', 'rake', 'rake', 'rake is within 45 degrees'));
  if (!(p.rootEmbed >= 0.3 && p.rootEmbed <= 0.9)) out.push(issue('error', 'rootEmbed', 'rootEmbed', 'root embed is between 0.3 and 0.9 of the hub radius'));
  if (out.length) return out;
  const R = p.diameter / 2, hr = p.hubDia / 2, r0 = p.rootEmbed * hr;
  if (Math.abs(p.skew) > 0.5 * R) out.push(issue('error', 'skew', 'skew', `skew is within half the radius (${round(0.5 * R)} mm)`, { limit: round(0.5 * R) }));
  if (p.boreDia > 0 && p.boreDia / 2 >= r0 - 0.5) out.push(issue('error', 'boreReachesBlade', 'boreDia', `the bore (radius ${round(p.boreDia / 2)}) reaches the blade roots (start at radius ${round(r0)}): use a smaller bore or a larger hub / root embed`, { bore: p.boreDia, root: round(r0) }));
  if (out.length) return out;
  // geometry warnings from the actual sections
  const secs = bladeSections(p);
  const root = secs[0], hubS = sectionAt(p, hr);
  if (root.axialSpan > p.hubLength * 1.05) out.push(issue('warning', 'rootOverhang', 'hubLength', `the blade root is ${round(root.axialSpan)} mm deep along the shaft, more than the hub length ${p.hubLength}: it will stand proud of the hub faces`, { span: round(root.axialSpan), hub: p.hubLength }));
  if (p.blades * hubS.tangentialSpan > 0.98 * 2 * Math.PI * hr) out.push(issue('warning', 'bladesOverlap', 'blades', `at the hub surface the ${p.blades} blades are wider than the circumference: neighbouring blades overlap`, { blades: p.blades }));
  const tipThickness = secs[secs.length - 1].chord * secs[secs.length - 1].thick;
  if (tipThickness < 0.4) out.push(issue('warning', 'thinTip', 'thickTip', `the tip is only ${round(tipThickness)} mm thick: thin sections may not print or machine`, { thickness: round(tipThickness) }));
  if (p.twist === 'pitch' || p.twist === 'angle') {
    const th = rootSectionAngle(p);
    if (th > MAX_SECTION_ANGLE) out.push(issue('warning', 'angleClamped', 'pitch', `near the root the pitch law asks for ${round(th)} degrees: sections are held at ${MAX_SECTION_ANGLE}`, { angle: round(th) }));
  }
  return out;
}

/** The errors only. */
export const propErrors = (p: PropParams): PropIssue[] => validateProp(p).filter((i) => i.severity === 'error');

// ---- distributions ----

/** Value at fraction s (0 root, 1 tip) of the three-point curve root / mid / tip: a parabola through them in s^exp, so mid sits at s^exp = 0.5. Safe for any s. */
export function threePoint(a: number, b: number, c: number, s: number, exp: number): number {
  const u = Math.pow(clamp(fin(s), 0, 1), clamp(fin(exp, 1), 0.2, 5));
  // Lagrange through (0, a) (0.5, b) (1, c)
  return a * (1 - u) * (1 - 2 * u) + b * 4 * u * (1 - u) + c * u * (2 * u - 1);
}

/** Radial station of the root section and of the tip. */
export function bladeSpan(p: PropParams): { r0: number; R: number; hubR: number } {
  const R = p.diameter / 2, hubR = p.hubDia / 2;
  return { r0: p.rootEmbed * hubR, R, hubR };
}

/** s = 0 at the hub surface, 1 at the tip (clamped, so a radius inside the hub is s = 0: no negative bases for the fractional powers). */
const spanFraction = (p: PropParams, r: number): number => {
  const { R, hubR } = bladeSpan(p);
  return clamp(fin((r - hubR) / Math.max(R - hubR, 1e-9)), 0, 1);
};

/** Chord (mm) at radius r. Finite for every r, never below 1 mm. */
export function chordAt(p: PropParams, r: number): number {
  return Math.max(1, fin(threePoint(p.chordRoot, p.chordMid, p.chordTip, spanFraction(p, r), p.chordExp), p.chordRoot));
}
/** Thickness ratio at radius r (kept within 0.02 .. 0.4). */
export function thicknessAt(p: PropParams, r: number): number {
  return clamp(fin(threePoint(p.thickRoot, p.thickMid, p.thickTip, spanFraction(p, r), p.thickExp), p.thickRoot), 0.02, 0.4);
}

/** The geometric pitch (mm per revolution) the pitch law uses. */
export function effectivePitch(p: PropParams): number {
  if (p.twist === 'angle') return 2 * Math.PI * p.refRadius * (p.diameter / 2) * Math.tan(rad(clamp(p.pitchAngle, 0.1, MAX_SECTION_ANGLE)));
  return p.pitch;
}

/** Unclamped section angle (degrees) the law asks for at radius r. */
export function lawAngle(p: PropParams, r: number): number {
  if (p.twist === 'linear') {
    const s = clamp(fin((r - bladeSpan(p).r0) / Math.max(bladeSpan(p).R - bladeSpan(p).r0, 1e-9)), 0, 1);
    return p.rootAngle + (p.tipAngle - p.rootAngle) * s;
  }
  return deg(Math.atan2(effectivePitch(p), 2 * Math.PI * Math.max(r, 1e-6)));
}
const rootSectionAngle = (p: PropParams): number => lawAngle(p, bladeSpan(p).r0);
/** Section angle used for the geometry at radius r, degrees from the plane of rotation. */
export const sectionAngle = (p: PropParams, r: number): number => clamp(fin(lawAngle(p, r), 20), 0.1, MAX_SECTION_ANGLE);

// ---- airfoil ----

/** NACA 4-digit half thickness (fraction of chord) at x with maximum thickness ratio t; the closed-trailing-edge coefficient makes the tip exactly sharp. */
const nacaHalf = (x: number, t: number): number => 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
const smooth = (a: number): number => { const s = clamp(a, 0, 1); return s * s * (3 - 2 * s); };

/** Camber line height and slope at x for the airfoil kind. */
function camberLine(p: PropParams, x: number): { y: number; dy: number } {
  const m = p.camber, c = clamp(p.camberPos, 0.1, 0.9);
  if (m <= 0) return { y: 0, dy: 0 };
  if (p.airfoil === 'plate') return { y: 0, dy: 0 };
  if (p.airfoil === 'arc') return { y: 4 * m * x * (1 - x), dy: 4 * m * (1 - 2 * x) };
  if (x < c) return { y: (m / (c * c)) * (2 * c * x - x * x), dy: (2 * m / (c * c)) * (c - x) };
  return { y: (m / ((1 - c) ** 2)) * (1 - 2 * c + 2 * c * x - x * x), dy: (2 * m / ((1 - c) ** 2)) * (c - x) };
}
/** Half thickness (fraction of the chord) at x for max thickness ratio t. */
function halfThickness(kind: AirfoilKind, x: number, t: number): number {
  if (kind === 'arc') return 2 * t * x * (1 - x);                                  // biconvex lens: sharp at both edges
  if (kind === 'plate') return (t / 2) * Math.sqrt(Math.min(1, x / 0.03)) * smooth((1 - x) / 0.3);   // round nose, constant middle, taper to a sharp trailing edge
  return nacaHalf(x, t);
}

export interface AirfoilSide { x: number[]; y: number[] }
/** The airfoil in unit chord coordinates: upper (suction) from the leading edge (0,0) to the trailing edge (1,0), lower from leading to trailing edge.
 *  `perSide` points per side including both ends, cosine spaced. */
export function airfoilShape(p: PropParams, t: number, perSide: number): { upper: AirfoilSide; lower: AirfoilSide } {
  const up: AirfoilSide = { x: [], y: [] }, lo: AirfoilSide = { x: [], y: [] };
  const n = Math.max(3, Math.round(perSide));
  for (let i = 0; i < n; i++) {
    const x = i === 0 ? 0 : i === n - 1 ? 1 : (1 - Math.cos((Math.PI * i) / (n - 1))) / 2;
    const yt = i === 0 || i === n - 1 ? 0 : halfThickness(p.airfoil, x, t);
    const { y: yc, dy } = camberLine(p, x);
    const th = Math.atan(dy);
    if (i === 0 || i === n - 1) { up.x.push(x); up.y.push(yc); lo.x.push(x); lo.y.push(yc); continue; }
    up.x.push(x - yt * Math.sin(th)); up.y.push(yc + yt * Math.cos(th));
    lo.x.push(x + yt * Math.sin(th)); lo.y.push(yc - yt * Math.cos(th));
  }
  return { upper: up, lower: lo };
}

/** Points per airfoil side in the sketches. */
export const PTS_PER_SIDE = 12;

// ---- sections ----

export interface BladeSection {
  r: number;
  chord: number;
  thick: number;
  /** Section angle used, degrees from the plane of rotation. */
  angle: number;
  /** Stacking-line offsets applied (mm). */
  rakeOffset: number;
  skewOffset: number;
  /** World (T, A) = (y, z) points: the suction side leading edge to trailing edge, then the pressure side leading to trailing edge (the two splines share both end points). */
  upper: Array<[number, number]>;
  lower: Array<[number, number]>;
  tangentialSpan: number;
  axialSpan: number;
}

/** One section at radius r. */
export function sectionAt(p: PropParams, r: number): BladeSection {
  const { r0, R } = bladeSpan(p);
  const chord = chordAt(p, r), thick = thicknessAt(p, r), angle = sectionAngle(p, r);
  const th = rad(angle), cs = Math.cos(th), sn = Math.sin(th);
  const sSpan = clamp(fin((r - r0) / Math.max(R - r0, 1e-9)), 0, 1);
  const rakeOffset = -(r - r0) * Math.tan(rad(p.rake));
  const skewOffset = p.skew * sSpan * sSpan;
  const mirror = p.direction === 'cw' ? -1 : 1;
  const shape = airfoilShape(p, thick, PTS_PER_SIDE);
  // chord direction runs trailing edge -> leading edge as (cos, sin) in (T, A); the normal toward the suction side is (-sin, cos)
  const map = (x: number, y: number): [number, number] => {
    const a = (p.pivot - x) * chord, b = y * chord;
    const T = a * cs - b * sn + skewOffset, A = a * sn + b * cs + rakeOffset;
    return [round(mirror * T), round(A)];
  };
  const upper = shape.upper.x.map((x, i) => map(x, shape.upper.y[i]));
  const lower = shape.lower.x.map((x, i) => map(x, shape.lower.y[i]));
  const all = [...upper, ...lower];
  const Ts = all.map((q) => q[0]), As = all.map((q) => q[1]);
  return { r, chord, thick, angle, rakeOffset, skewOffset, upper, lower, tangentialSpan: Math.max(...Ts) - Math.min(...Ts), axialSpan: Math.max(...As) - Math.min(...As) };
}

/** Radii of the sections, root to tip, denser at both ends where the twist and the planform change fastest. */
export function sectionRadii(p: PropParams): number[] {
  const { r0, R } = bladeSpan(p);
  const n = Math.max(2, Math.round(p.sections));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const s = 0.5 * u + 0.5 * ((1 - Math.cos(Math.PI * u)) / 2);
    out.push(i === n - 1 ? R : round(r0 + (R - r0) * s));
  }
  return out;
}
export const bladeSections = (p: PropParams): BladeSection[] => sectionRadii(p).map((r) => sectionAt(p, r));

/** Area of a section polygon (shoelace over the dense outline: upper then lower reversed). */
export function sectionArea(s: BladeSection): number {
  const loop = [...s.upper, ...[...s.lower].reverse().slice(1, -1)];
  let a = 0;
  for (let i = 0; i < loop.length; i++) { const [x0, y0] = loop[i], [x1, y1] = loop[(i + 1) % loop.length]; a += x0 * y1 - x1 * y0; }
  return Math.abs(a) / 2;
}

// ---- readout ----

export interface PropReadout {
  radius: number;
  hubRadius: number;
  rootRadius: number;
  /** Pitch (mm per revolution) of the law, or the mean implied pitch for a linear twist at 0.7 R. */
  pitch: number;
  pitchRatio: number;
  /** Section angle at the root, 0.7 R and tip (degrees). */
  angleRoot: number;
  angle70: number;
  angleTip: number;
  /** Projected blade area / disc area (the "blade area ratio", from the section chords between hub and tip). */
  areaRatio: number;
  solidity: number;
  issues: PropIssue[];
}
export function propReadout(p: PropParams): PropReadout {
  const issues = validateProp(p);
  const R = p.diameter / 2, hubR = p.hubDia / 2, r0 = p.rootEmbed * hubR;
  const at = (r: number): number => sectionAngle(p, r);
  // developed blade area: integral of chord dr over the visible blade
  let area = 0;
  const steps = 60;
  for (let i = 0; i < steps; i++) { const r = hubR + ((R - hubR) * (i + 0.5)) / steps; area += chordAt(p, r) * ((R - hubR) / steps); }
  const disc = Math.PI * R * R;
  const r70 = 0.7 * R;
  const pitch = p.twist === 'linear' ? 2 * Math.PI * r70 * Math.tan(rad(at(r70))) : effectivePitch(p);
  return { radius: R, hubRadius: hubR, rootRadius: r0, pitch, pitchRatio: pitch / p.diameter, angleRoot: at(r0), angle70: at(r70), angleTip: at(R), areaRatio: (p.blades * area) / disc, solidity: (p.blades * area) / disc, issues };
}

// ---- features ----

type Feat = { id: string; type: string; [k: string]: unknown };
/** Roles in feature order: hub, the blade sections, the loft, the pattern, the bore. */
export function rolesFor(p: Pick<PropParams, 'sections' | 'boreDia'>): string[] {
  const roles = ['hubSketch', 'hub'];
  for (let i = 0; i < p.sections; i++) roles.push('plane' + i, 'sec' + i);
  roles.push('blade', 'pattern');
  if (p.boreDia > 0) roles.push('boreSketch', 'bore');
  return roles;
}

export interface PropVar { name: string; expr: string; comment?: string }
/** The document variables the hub, bore and pattern read. */
export function propVariables(p: PropParams): PropVar[] {
  const n = p.varPrefix;
  return [
    { name: `${n}_hub_d`, expr: String(round(p.hubDia)), comment: 'propeller hub diameter' },
    { name: `${n}_hub_len`, expr: String(round(p.hubLength)), comment: 'propeller hub length' },
    ...(p.boreDia > 0 ? [{ name: `${n}_bore_d`, expr: String(round(p.boreDia)), comment: 'propeller bore diameter' }] : []),
    { name: `${n}_blades`, expr: String(p.blades), comment: 'propeller blade count' },
  ];
}
/** Variable names a record uses (to find a free prefix). */
export const propVariableNames = (prefix: string): string[] => ['hub_d', 'hub_len', 'bore_d', 'blades'].map((k) => `${prefix}_${k}`);

const circleSketch = (id: string, name: string, plane: unknown, diaVar: string | null, dia: number): Feat => ({
  type: 'sketch', id, name, plane, points: [{ id: 'p1', x: 0, y: 0, fixed: true }], entities: [{ type: 'circle', id: 'e1', c: 'p1', r: round(dia / 2) }],
  constraints: [{ id: 'k1', type: 'diameter', refs: ['e1'], value: round(dia), ...(diaVar ? { expr: diaVar } : {}) }],
});

/** The sketch of one blade section: two splines (suction side, pressure side) that share the leading and trailing edge points. */
function sectionSketch(id: string, planeId: string, s: BladeSection, idx: number): Feat {
  const pts: Array<{ id: string; x: number; y: number }> = [];
  // the 'right' plane's sketch axes are u = -Z, v = +Y (checked against the kernel's section frame), so (T, A) goes in as (-A, T)
  const P = (name: string, q: [number, number]): string => { pts.push({ id: name, x: round(-q[1]), y: round(q[0]) }); return name; };
  const n = s.upper.length;
  const le = P('le', s.upper[0]), te = P('te', s.upper[n - 1]);
  const up = [le, ...s.upper.slice(1, -1).map((q, i) => P('u' + (i + 1), q)), te];
  const lo = [le, ...s.lower.slice(1, -1).map((q, i) => P('l' + (i + 1), q)), te];
  return {
    type: 'sketch', id, name: `Blade section ${idx + 1} (r ${round(s.r)})`, plane: { kind: 'feature', id: planeId }, points: pts,
    entities: [{ type: 'spline', id: 'e1', pts: [...up].reverse() }, { type: 'spline', id: 'e2', pts: lo }], constraints: [],
  };
}

/** All features of the propeller with the given ids by role. The hub sketch carries the parameter record and the role map. With `linked` false the hub,
 *  bore and pattern carry plain numbers instead of variable references (for a preview in a document that does not have the variables yet). */
export function propFeatures(p: PropParams, ids: Record<string, string>, linked = true): Feat[] {
  const record = { ...p, roles: Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, Number(v.slice(1))])) };
  const v = (k: string): string => `${p.varPrefix}_${k}`;
  const secs = bladeSections(p);
  const out: Feat[] = [];
  const hubSketch = circleSketch(ids.hubSketch, 'Propeller hub sketch', { kind: 'std', id: 'front' }, linked ? v('hub_d') : null, p.hubDia);
  hubSketch.prop = record;
  out.push(hubSketch);
  // the hub is centred on z = 0 (a mid-plane extrude along the sketch normal)
  out.push({ type: 'extrude', id: ids.hub, name: 'Propeller hub', op: 'add', sketch: ids.hubSketch, end: 'mid', depth: linked ? `=${v('hub_len')}` : round(p.hubLength) });
  secs.forEach((s, i) => {
    out.push({ type: 'plane', id: ids['plane' + i], name: `Blade plane ${i + 1}`, mode: 'offset', base: { kind: 'std', id: 'right' }, offset: round(s.r) });
    out.push(sectionSketch(ids['sec' + i], ids['plane' + i], s, i));
  });
  out.push({ type: 'loft', id: ids.blade, name: 'Propeller blade', op: 'add', sketches: secs.map((_s, i) => ids['sec' + i]) });
  out.push({ type: 'cpattern', id: ids.pattern, name: 'Propeller blades', seeds: [ids.blade], axis: { kind: 'axis', axis: 'z' }, count: linked ? `=${v('blades')}` : p.blades, angle: 360, equal: true });
  if (p.boreDia > 0) {
    out.push(circleSketch(ids.boreSketch, 'Propeller bore sketch', { kind: 'std', id: 'front' }, linked ? v('bore_d') : null, p.boreDia));
    out.push({ type: 'extrude', id: ids.bore, name: 'Propeller bore', op: 'cut', sketch: ids.boreSketch, end: 'throughBoth', depth: 10 });
  }
  return out;
}

/** Reads a propeller record off a feature (the parameters with defaults filled in, and the role map), or null. */
export function readProp(f: unknown): { params: PropParams; roles: Record<string, string> } | null {
  const rec = (f as { prop?: Record<string, unknown> } | null)?.prop;
  if (!rec || typeof rec !== 'object') return null;
  if ((rec as { family?: string }).family === 'marine') return null;   // a marine propeller's record (marineData.ts readMarine)
  const { roles, ...rest } = rec as { roles?: Record<string, number | string> } & Partial<PropParams>;
  return { params: { ...DEFAULT_PROP, ...rest }, roles: Object.fromEntries(Object.entries((roles ?? {}) as Record<string, number | string>).map(([k, x]) => [k, typeof x === 'number' ? `F${x}` : x])) };
}

/** The propeller that owns this feature id (its hub sketch id and roles), or null. */
export function propOwner(features: unknown[], id: string): { hubId: string; params: PropParams; roles: Record<string, string> } | null {
  for (const f of features as Array<{ id: string }>) {
    const g = readProp(f);
    if (g && Object.values(g.roles).includes(id)) return { hubId: f.id, params: g.params, roles: g.roles };
  }
  return null;
}

function nextSeq(doc: { features: Array<{ id?: string }>; seq?: number }): number {
  let n = doc.seq ?? 1;
  for (const f of doc.features) { const m = /^F(\d+)$/.exec(String(f.id ?? '')); if (m) n = Math.max(n, Number(m[1]) + 1); }
  return n;
}

/** Errors as a thrown value for the callers that want an exception; the generator itself returns issues from validateProp. */
export class PropError extends Error {
  constructor(public issues: PropIssue[]) { super(issues.map((i) => i.message).join('; ')); }
}

/** Ops that create (no `existing`) or regenerate a propeller as ONE edit, with plain numbers where the real features use variables: the wizard's live
 *  preview and the tests use these (the document need not have the variables yet); `propPlan` is what gets committed. Features keep their ids across edits; extra section roles are added after the
 *  last section, vanished ones removed (the sketch goes with its plane). Throws PropError when the parameters have errors. */
export function propOps(doc: { features: Array<{ id?: string }>; seq?: number }, p: PropParams, existing?: Record<string, string>): EditOp[] {
  const errs = propErrors(p);
  if (errs.length) throw new PropError(errs);
  const wanted = rolesFor(p);
  let seq = nextSeq(doc);
  const ids: Record<string, string> = {};
  for (const r of wanted) ids[r] = existing?.[r] ?? `F${seq++}`;
  const feats = propFeatures(p, ids, false);
  const ops: EditOp[] = [];
  const list = doc.features.map((f) => f.id as string);
  if (existing) {
    const gone = Object.keys(existing).filter((r) => !wanted.includes(r));
    for (const r of gone.reverse()) {
      ops.push({ op: 'remove', id: existing[r], cascade: true });
      const at = list.indexOf(existing[r]);
      if (at >= 0) list.splice(at, 1);
    }
  }
  let last = existing && ids.hubSketch ? list.indexOf(existing.hubSketch) - 1 : list.length - 1;
  wanted.forEach((r, i) => {
    const feature = feats[i] as unknown as Record<string, unknown>;
    if (existing?.[r]) {
      ops.push({ op: 'replace', id: ids[r], feature } as EditOp);
      last = list.indexOf(ids[r]);
    } else {
      const index = last + 1;
      ops.push((index >= list.length ? { op: 'add', feature } : { op: 'add', feature, index }) as EditOp);
      list.splice(index, 0, ids[r]);
      last = index;
    }
  });
  const at = ops.findIndex((o) => o.op === 'replace' && (o as { id?: string }).id === ids.hubSketch);
  if (at > 0) ops.unshift(ops.splice(at, 1)[0]);
  return ops;
}

/** The ids a propeller's features use, one per role, numbered from `seq`. */
function idsFor(p: PropParams, seq: number): Record<string, string> {
  const ids: Record<string, string> = {};
  for (const r of rolesFor(p)) ids[r] = `F${seq++}`;
  return ids;
}

export interface PropPatch {
  variables: unknown[];
  /** whole replacement features by id */
  features?: Record<string, Record<string, unknown>>;
  /** features appended at the end, and the document's next feature number after them */
  append?: Array<Record<string, unknown>>;
  seq?: number;
}
export interface PropPlan {
  /** Removals to apply first (as one edit): only when a regeneration changes the feature structure (section count, bore on or off). */
  before: EditOp[];
  /** The document patch (variables and features) that is ONE undo step. */
  patch: PropPatch;
}

/** What to commit: a new propeller appended with its variables, or the regeneration of `existing`. Same structure: one patch replacing the features in place.
 *  Different structure (section count, bore added or removed): the old features are removed first (`before`), then the new ones are appended, so two undo steps.
 *  Throws PropError for parameters with errors. */
export function propPlan(doc: { features: Array<{ id?: string }>; seq?: number; variables?: Array<{ name: string }> }, p: PropParams, existing?: Record<string, string>): PropPlan {
  const errs = propErrors(p);
  if (errs.length) throw new PropError(errs);
  const wanted = rolesFor(p);
  const vars = mergeVariables((doc.variables ?? []) as Array<{ name: string }>, p);
  const same = !!existing && wanted.length === Object.keys(existing).length && wanted.every((r) => existing[r]);
  if (existing && same) {
    const feats = propFeatures(p, existing, true);
    return { before: [], patch: groupPatch({ variables: vars, features: Object.fromEntries(feats.map((f) => [f.id, f as unknown as Record<string, unknown>])) }, wizardGroupName(doc.features, t('prop.title'), existing)) };
  }
  const before: EditOp[] = [];
  let features = doc.features;
  if (existing) {
    const gone = new Set(Object.values(existing));
    for (const id of [...doc.features.map((f) => f.id as string)].reverse()) if (gone.has(id)) before.push({ op: 'remove', id, cascade: true });   // the session checks every op against the document as it is, so each removal cascades
    features = doc.features.filter((f) => !gone.has(f.id as string));
  }
  const start = nextSeq({ features, seq: doc.seq });
  const ids = idsFor(p, start);
  const feats = propFeatures(p, ids, true);
  const group = wizardGroupName(doc.features, t('prop.title'), existing);
  return { before, patch: groupPatch({ variables: vars, append: feats as unknown as Array<Record<string, unknown>>, seq: start + feats.length }, group) };
}

/** The whole part document of a propeller (features and variables), for tests, samples and the script panel. */
export function propDocument(p: PropParams, name = 'Propeller'): Record<string, unknown> {
  const errs = propErrors(p);
  if (errs.length) throw new PropError(errs);
  const ids = idsFor(p, 1);
  return { format: 'ck-part', version: 1, name, variables: propVariables(p), features: propFeatures(p, ids), seq: rolesFor(p).length + 1, rollback: null, material: 'aluminum', counters: {} };
}

/** Variables for a document that already has some: ours replace the propeller's own names (with this prefix), the rest stay. */
export function mergeVariables(existing: Array<{ name: string }>, p: PropParams): unknown[] {
  const ours = propVariables(p);
  const names = new Set(propVariableNames(p.varPrefix));   // all four, so dropping the bore also drops its variable
  return [...existing.filter((x) => !names.has(x.name)), ...ours];
}

/** A variable prefix not used by the document ('prop', 'prop2', ...). */
export function freePrefix(existingVars: Array<{ name: string }>, base = 'prop'): string {
  const taken = new Set(existingVars.map((v) => v.name));
  for (let i = 1; ; i++) {
    const pre = i === 1 ? base : base + i;
    if (!propVariableNames(pre).some((n) => taken.has(n))) return pre;
  }
}
