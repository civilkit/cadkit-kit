// The Propeller generator, marine family: parameters, validation, readout and the feature list for a hub with N blades whose FACE lies on a helicoid-like surface
//   z = P(r) phi / 2 pi + tan(rake) (r - hubR),   P(r) = P_tip (1 + pitchProgress (1 - x)),   x the span fraction;
// with rake and pitchProgress both 0 this is the true constant-pitch helicoid. Pure functions, no framework. The blade is ONE loft through closed sections, one per angle
// phi_k, each in a plane through the shaft axis (the kernel cannot thicken a trimmed sheet, so there is no sheet / thicken / trim: docs/propellers.md, "Marine family: probe"):
// a section is the face line (from where the ray enters the expanded outline to where it leaves), the tip end, the back spline (the face plus the axial thickness that gives the
// requested thickness NORMAL to the face, `axialThickness`) and the root end. The loft's side edges are the leading and trailing edge; the blade is fused to the hub,
// patterned, bored. Frame: shaft axis Z; the pressure face is the surface itself, all the thickness is on the back. Geometry only: no hydrodynamics.
import type { EditOp } from '@ck/session';

const round = (v: number, d = 6): number => { const k = 10 ** d; return Math.round(v * k) / k; };

export type MarineDirection = 'rh' | 'lh';

export interface MarineParams {
  /** Tip diameter, mm. */
  diameter: number;
  hubDia: number;
  hubLength: number;
  boreDia: number;
  /** 2..6 */
  blades: number;
  /** Pitch / diameter (P / D) at the tip; with `pitchProgress` = 0 the pitch is constant. */
  pitchRatio: number;
  /** Expanded area ratio: blades' developed area / disc area. */
  ear: number;
  /** Where the widest chord is, as a fraction of the blade span from the root (0 = root, 1 = tip). */
  peak: number;
  /** Chord at the root and at the tip as fractions of the widest chord. */
  rootRatio: number;
  tipRatio: number;
  /** Tip skew of the mid-chord line, degrees (quadratic in span, toward the trailing side). */
  skew: number;
  /** Blade thickness at the root and the tip as fractions of the diameter (t0 / D). */
  thickRoot: number;
  thickTip: number;
  direction: MarineDirection;
  /** Where the blade starts inside the hub, as a fraction of the hub radius. */
  rootEmbed: number;
  /** Angle between neighbouring helicoid sections, degrees (3 to 10): finer follows the outline better, coarser builds faster. */
  raySpacing: number;
  /** Rake, degrees (-20..30): the blade leans aft, the face height gains tan(rake) (r - hubR). 0 = none. */
  rake: number;
  /** Progressive pitch (-0.3..0.5): fractional change of the local pitch from the tip to the root, linear in the span fraction: P(r) = P_tip (1 + pitchProgress (1 - x)). Positive = more pitch at the root. 0 = constant pitch. */
  pitchProgress: number;
}

export const DEFAULT_MARINE: MarineParams = {
  diameter: 250, hubDia: 50, hubLength: 110, boreDia: 20, blades: 3, pitchRatio: 1, ear: 0.5, peak: 0.45, rootRatio: 0.55, tipRatio: 0.3,
  skew: 15, thickRoot: 0.035, thickTip: 0.005, direction: 'rh', rootEmbed: 0.85, raySpacing: 5, rake: 0, pitchProgress: 0,
};

export interface MarineIssue { level: 'error' | 'warning'; code: string; message: string }

const rad = (d: number): number => (d * Math.PI) / 180;
const smooth = (t: number): number => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, t)));
const sgn = (p: MarineParams): number => (p.direction === 'lh' ? -1 : 1);

export interface MarineSpan { R: number; hubR: number; r0: number }
export function marineSpan(p: MarineParams): MarineSpan {
  const R = p.diameter / 2, hubR = p.hubDia / 2;
  return { R, hubR, r0: p.rootEmbed * hubR };
}
/** Blade span fraction of a radius: 0 at the hub surface, 1 at the tip (negative inside the hub). */
export const spanFraction = (p: MarineParams, r: number): number => { const { R, hubR } = marineSpan(p); return (r - hubR) / (R - hubR); };

/** Chord of the widest section as a fraction shape: root ratio at the hub, 1 at the peak, tip ratio at the tip (cosine blends, no kinks). */
function chordShape(p: MarineParams, x: number): number {
  const xc = Math.max(0, x), pk = Math.min(0.95, Math.max(0.05, p.peak));
  return xc <= pk ? p.rootRatio + (1 - p.rootRatio) * smooth(xc / pk) : 1 + (p.tipRatio - 1) * smooth((xc - pk) / (1 - pk));
}
/** Widest chord (mm) that gives the expanded area ratio. */
export function chordMax(p: MarineParams): number {
  const { R, hubR } = marineSpan(p);
  const n = 200; let integral = 0;
  for (let i = 0; i < n; i++) integral += chordShape(p, (i + 0.5) / n) * ((R - hubR) / n);
  return (p.ear * Math.PI * R * R) / (p.blades * integral);
}
/** Developed chord (mm, along the pitch helix) at radius r; inside the hub the root value holds. */
export const chordAt = (p: MarineParams, r: number): number => chordMax(p) * chordShape(p, spanFraction(p, r));

/** Local pitch (mm per revolution) at radius r: the tip pitch times (1 + pitchProgress (1 - x)), x the span fraction (linear, also inside the hub, where x < 0). */
export const pitchAt = (p: MarineParams, r: number): number => p.pitchRatio * p.diameter * (1 + p.pitchProgress * (1 - spanFraction(p, r)));
/** d(pitch)/dr, mm per mm (constant: the pitch is linear in r). */
export const pitchSlope = (p: MarineParams): number => { const { R, hubR } = marineSpan(p); return (-p.pitchRatio * p.diameter * p.pitchProgress) / (R - hubR); };
/** Height (mm, along the shaft) of the pressure face at angle `phi` (before the direction sign) and radius r: P(r) phi / 2 pi + tan(rake) (r - hubR). */
export function faceZ(p: MarineParams, phi: number, r: number): number {
  return (pitchAt(p, r) * phi) / (2 * Math.PI) + Math.tan(rad(p.rake)) * (r - marineSpan(p).hubR);
}
/** Slope of the face along the radius at fixed angle (dz/dr): how the face tilts inside a section plane. */
export const faceSlopeR = (p: MarineParams, phi: number): number => (pitchSlope(p) * phi) / (2 * Math.PI) + Math.tan(rad(p.rake));
/** Pitch angle of the helix on the face at radius r (radians from the plane of rotation): atan(P(r) / 2 pi r). Rake does not change it (the helix runs at constant r); it tilts the face radially (faceSlopeR). */
export const pitchAngleAt = (p: MarineParams, r: number): number => Math.atan(pitchAt(p, r) / (2 * Math.PI * r));
/** First-order axial offset t / n_z, n_z = 1 / sqrt(1 + (dz/dr)^2 + (dz / r dphi)^2): exact where the back is parallel to the face. */
const axial0 = (p: MarineParams, phi: number, r: number): number => {
  const fr = faceSlopeR(p, phi), ft = pitchAt(p, r) / (2 * Math.PI * r);
  return thicknessAt(p, r) * Math.sqrt(1 + fr * fr + ft * ft);
};
/** Axial offset (mm) from the face to the back that gives the thickness t NORMAL to the face at (phi, r). The first-order t / n_z is exact only where the back is parallel to the
 *  face; the offset changes with r and phi, and the normal leaves the face sideways by several mm near the root, so one Newton correction follows: march along the exact normal to the
 *  first-order back (bisection), and move the offset by the distance error over n_z. The residual against a numeric march through the corrected back is under 1 % (marineData.test.ts). */
export function axialThickness(p: MarineParams, phi: number, r: number): number {
  const a0 = axial0(p, phi, r), t = thicknessAt(p, r);
  if (p.rake === 0 && p.pitchProgress === 0) return a0;   // the constant-pitch helicoid keeps its original first-order offset (0.7 % thin at the root, see docs) so existing models are unchanged
  const fr = faceSlopeR(p, phi), ft = pitchAt(p, r) / (2 * Math.PI * r);
  const nz = 1 / Math.sqrt(1 + fr * fr + ft * ft), nr = -fr * nz, nt = -ft * nz;
  const zp = faceZ(p, phi, r);
  const gap = (sd: number): number => {
    const x = r + sd * nr, y = sd * nt, rq = Math.hypot(x, y), pq = phi + Math.atan2(y, x);
    return zp + sd * nz - (faceZ(p, pq, rq) + axial0(p, pq, rq));
  };
  let lo = 0, hi = 3 * a0;
  if (gap(hi) < 0) return a0;   // the normal never meets the back (cannot happen for a sane blade): keep the first-order value
  for (let k = 0; k < 40; k++) { const m = 0.5 * (lo + hi); if (gap(m) < 0) lo = m; else hi = m; }
  return a0 + (t - lo) / nz;
}
/** Mid-chord angle (radians, before the direction sign) at radius r: the skew grows with the square of the span fraction. */
export const midAngleAt = (p: MarineParams, r: number): number => rad(p.skew) * Math.min(1, Math.max(0, spanFraction(p, r))) ** 2;
/** Half the angular width of the blade at radius r, radians: the developed chord's projection on the cylinder, c cos(theta) / r. */
export const halfWidthAt = (p: MarineParams, r: number): number => (0.5 * chordAt(p, r) * Math.cos(pitchAngleAt(p, r))) / r;
/** Leading and trailing edge angles at radius r (radians, before the direction sign): the leading edge is the lower angle. */
export const edgeAngles = (p: MarineParams, r: number): [number, number] => [midAngleAt(p, r) - halfWidthAt(p, r), midAngleAt(p, r) + halfWidthAt(p, r)];
/** The back thickness (mm) at radius r: root to tip, linear. */
export function thicknessAt(p: MarineParams, r: number): number {
  const x = Math.min(1, Math.max(0, spanFraction(p, r)));
  return p.diameter * (p.thickRoot + (p.thickTip - p.thickRoot) * x);
}

/** Hub length that keeps the root of the blade (the part of the sections inside the hub radius, plus the axial thickness at the embed radius and 2 mm) between the hub's end faces. */
export function hubLengthNeeded(p: MarineParams): number {
  const { hubR, r0 } = marineSpan(p);
  const st = helicoidStations(p);
  let need = 0;
  st.psi.forEach((_x, i) => {
    if (st.rA[i] > hubR) return;
    // the face height is linear in r, so its extremes inside the hub are at the two ends of that part
    let zmax = 0;
    for (const r of [st.rA[i], Math.min(st.rB[i], hubR)]) zmax = Math.max(zmax, Math.abs(faceZ(p, st.phi[i], r)));
    need = Math.max(need, zmax + axialThickness(p, st.phi[i], r0));
  });
  return 2 * (need + 2);
}

export function validateMarine(p: MarineParams): MarineIssue[] {
  const out: MarineIssue[] = [];
  const err = (code: string, message: string): void => { out.push({ level: 'error', code, message }); };
  const warn = (code: string, message: string): void => { out.push({ level: 'warning', code, message }); };
  const nums: Array<keyof MarineParams> = ['diameter', 'hubDia', 'hubLength', 'boreDia', 'blades', 'pitchRatio', 'ear', 'peak', 'rootRatio', 'tipRatio', 'skew', 'thickRoot', 'thickTip', 'rootEmbed', 'raySpacing', 'rake', 'pitchProgress'];
  for (const k of nums) if (!Number.isFinite(p[k] as number)) err('notNumber', `${k} is not a number`);
  if (out.length) return out;
  const { R, hubR, r0 } = marineSpan(p);
  if (p.diameter <= 0) err('diameter', 'The diameter must be above 0');
  if (hubR <= 0 || hubR >= 0.6 * R) err('hubDia', 'The hub diameter must be above 0 and below 60 % of the diameter');
  if (p.hubLength <= 0) err('hubLength', 'The hub length must be above 0');
  if (p.boreDia < 0 || p.boreDia >= p.hubDia * 0.9) err('bore', 'The bore must leave a wall in the hub');
  if (!(Number.isInteger(p.blades) && p.blades >= 2 && p.blades <= 6)) err('blades', 'The blade count must be a whole number from 2 to 6');
  if (p.pitchRatio < 0.4 || p.pitchRatio > 2) err('pitch', 'The pitch / diameter ratio must be between 0.4 and 2');
  if (p.ear < 0.25 || p.ear > 1.2) err('ear', 'The expanded area ratio must be between 0.25 and 1.2');
  if (p.rootRatio <= 0 || p.tipRatio <= 0) err('chord', 'The root and tip chord ratios must be above 0');
  if (p.thickRoot <= 0 || p.thickTip <= 0) err('thick', 'The thickness must be above 0');
  if (p.raySpacing < 3 || p.raySpacing > 10) err('raySpacing', 'The section spacing must be between 3 and 10 degrees');
  if (p.rake < -20 || p.rake > 30) err('rake', 'The rake must be between -20 and 30 degrees');
  if (p.pitchProgress < -0.3 || p.pitchProgress > 0.5) err('pitchProgress', 'The progressive pitch must be between -0.3 and 0.5');
  if (p.rootEmbed <= 0.3 || p.rootEmbed >= 1) err('rootEmbed', 'The root embed must be between 0.3 and 1 of the hub radius');
  if (out.length) return out;
  if (p.thickTip * p.diameter < 0.3) warn('thinTip', 'The blade tip is thinner than 0.3 mm');
  if (p.thickTip > p.thickRoot) warn('thickTip', 'The tip is thicker than the root');
  // the blades touch at the root when their angular widths add to a full turn
  const [le, te] = edgeAngles(p, hubR);
  if ((p.blades * (te - le)) > 2 * Math.PI * 0.95) warn('overlap', 'The blades overlap at the hub: lower the area ratio or the root chord ratio');
  const need = hubLengthNeeded(p);
  if (p.hubLength < need) err('hubShort', `The hub is too short for the root: the blade root spans ${round(need, 1)} mm along the shaft (hub length at least that)`);
  // the hub fuse is the touchy step: a low pitch near the hub (constant 0.7 to 0.8, or a falling pitch toward the root) is refused for most section spacings (docs/propellers.md)
  if ((pitchAt(p, hubR) / p.diameter) < 0.75) warn('rootPitch', 'The pitch at the hub is below 0.75 D: the hub fuse often fails; the build then retries finer section spacings');
  if (Math.abs(p.skew) > 45) warn('skew', 'A skew above 45 degrees is unusual');
  void r0;
  return out;
}
export const marineErrors = (p: MarineParams): MarineIssue[] => validateMarine(p).filter((i) => i.level === 'error');
export class MarineError extends Error {
  constructor(public issues: MarineIssue[]) { super(issues.map((i) => i.message).join('; ')); }
}

export interface MarineReadout {
  /** pitch is the tip pitch; pitchRoot the pitch at the hub surface. */
  pitchRoot: number; rake: number;
  radius: number; hubRadius: number; pitch: number; pitchRatio: number; ear: number; chordMax: number;
  /** Pitch angle at the root, 0.7 R and tip (degrees). */
  angleRoot: number; angle70: number; angleTip: number;
  /** Projected-disc blade area ratio is not computed; the developed (expanded) area ratio is the input. */
  bladeArea: number;
  issues: MarineIssue[];
}
export function marineReadout(p: MarineParams): MarineReadout {
  const { R, hubR } = marineSpan(p);
  let area = 0; const n = 100;
  for (let i = 0; i < n; i++) { const r = hubR + ((R - hubR) * (i + 0.5)) / n; area += chordAt(p, r) * ((R - hubR) / n); }
  const deg = (r: number): number => (pitchAngleAt(p, r) * 180) / Math.PI;
  return { pitchRoot: pitchAt(p, hubR), rake: p.rake, radius: R, hubRadius: hubR, pitch: p.pitchRatio * p.diameter, pitchRatio: p.pitchRatio, ear: (p.blades * area) / (Math.PI * R * R), chordMax: chordMax(p), angleRoot: deg(hubR), angle70: deg(0.7 * R), angleTip: deg(R), bladeArea: area, issues: validateMarine(p) };
}

// ---- geometry ----

export interface HelicoidStations {
  /** Angle (radians, world, direction sign applied), height and radial extent of each line section. */
  psi: number[]; z: number[]; rA: number[]; rB: number[];
  /** The same angles before the direction sign is applied (the face height is a function of phi). */
  phi: number[];
}
/** The radial interval of the blade at angle `phi` (before the direction sign), or null when the ray misses the outline. The outline is
 *  { r in [r0, R], leading edge <= phi <= trailing edge }; the interval is the first and last radius found on a fine scan, refined by bisection. */
export function rayInterval(p: MarineParams, phi: number): [number, number] | null {
  const { R, r0 } = marineSpan(p);
  const inside = (r: number): number => { const [a, b] = edgeAngles(p, r); return Math.min(phi - a, b - phi); };
  const n = 600;
  let first = -1, last = -1;
  for (let i = 0; i <= n; i++) if (inside(r0 + ((R - r0) * i) / n) >= 0) { if (first < 0) first = i; last = i; }
  if (first < 0) return null;
  const rAt = (i: number): number => r0 + ((R - r0) * i) / n;
  const refine = (rOut: number, rIn: number): number => { let o = rOut, q = rIn; for (let k = 0; k < 40; k++) { const m = 0.5 * (o + q); if (inside(m) >= 0) q = m; else o = m; } return q; };
  const ra = first === 0 ? r0 : refine(rAt(first - 1), rAt(first));
  const rb = last === n ? R : refine(rAt(last + 1), rAt(last));
  return [ra, rb];
}
/** Radial line sections of the helicoid: they cover the blade's angular range with at most `stepDeg` between neighbours (the end rays sit half a step inside the range,
 *  so each has a finite length). */
export function helicoidStations(p: MarineParams, stepDeg = p.raySpacing): HelicoidStations {
  const { R, hubR, r0 } = marineSpan(p);
  let lo = Infinity, hi = -Infinity;
  const n = 80;
  for (let i = 0; i <= n; i++) {
    const [le, te] = edgeAngles(p, r0 + ((R - r0) * i) / n);
    lo = Math.min(lo, le); hi = Math.max(hi, te);
  }
  const count = Math.max(8, Math.ceil((hi - lo) / rad(stepDeg)) + 1);
  const step = (hi - lo) / count;
  const s = sgn(p);
  const psi: number[] = [], z: number[] = [], rA: number[] = [], rB: number[] = [], phis: number[] = [];
  for (let k = 0; k < count; k++) {
    const phi = lo + step * (k + 0.5);
    const iv = rayInterval(p, phi);
    if (!iv || iv[1] - iv[0] < 1e-3) continue;
    // an end of a ray lying on the hub surface touches the hub cylinder tangentially and the kernel's boolean fails there: move it 0.6 mm off
    let [a, b] = iv;
    if (Math.abs(a - hubR) < 0.6) a = hubR - 0.6;
    if (Math.abs(b - hubR) < 0.6) b = hubR + 0.6;
    if (b - a < 1e-3) continue;
    psi.push(s * phi); z.push(faceZ(p, phi, hubR)); rA.push(a); rB.push(b); phis.push(phi);
  }
  return { psi, z, rA, rB, phi: phis };
}

/** The point of the face (a helicoid when rake and progressive pitch are 0) at angle `phi` (before the direction sign) and radius r: the face the blade must lie on. */
export function helicoidPoint(p: MarineParams, phi: number, r: number): [number, number, number] {
  const s = sgn(p);
  return [r * Math.cos(s * phi), r * Math.sin(s * phi), faceZ(p, phi, r)];
}

/** Section spacings the build tries, in order: the requested one, then 7, 6 and 4 degrees, and 3 as the last resort (it builds the lowest root pitches, in about 15 s). */
export const marineSpacings = (sp: number): number[] => [sp, ...[7, 6, 4, 3].filter((x) => x !== sp)];

// ---- features ----

type Feat = { id: string; type: string; [k: string]: unknown };
/** Roles in feature order: the hub, the helicoid stations, the helicoid loft, the blade (thicken), the pattern, the bore. */
export function marineRoles(p: MarineParams): string[] {
  const roles = ['hubSketch', 'hub'];
  const st = helicoidStations(p);
  st.psi.forEach((_x, i) => roles.push('plane' + i, 'sec' + i));
  roles.push('blade', 'pattern');
  if (p.boreDia > 0) roles.push('boreSketch', 'bore');
  return roles;
}

const circleSketch = (id: string, name: string, dia: number): Feat => ({
  type: 'sketch', id, name, plane: { kind: 'std', id: 'front' }, points: [{ id: 'p1', x: 0, y: 0, fixed: true }], entities: [{ type: 'circle', id: 'e1', c: 'p1', r: round(dia / 2) }],
  constraints: [{ id: 'k1', type: 'diameter', refs: ['e1'], value: round(dia) }],
});

export function marineFeatures(p: MarineParams, ids: Record<string, string>): Feat[] {
  const record = { ...p, family: 'marine', roles: Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, Number(v.slice(1))])) };
  const st = helicoidStations(p);
  const out: Feat[] = [];
  const hub = circleSketch(ids.hubSketch, 'Propeller hub sketch', p.hubDia);
  hub.prop = record;
  out.push(hub);
  out.push({ type: 'extrude', id: ids.hub, name: 'Propeller hub', op: 'add', sketch: ids.hubSketch, end: 'mid', depth: round(p.hubLength) });
  // one closed section per ray, on the plane through the shaft axis at the ray's angle: a thin closed shape (radius from rA to rB, the face line, the back spline an axial
  // thickness above it). Sketch axes of such a plane: u = world Z, v = the radial direction at the ray's angle (checked against the kernel).
  st.psi.forEach((psi, i) => {
    const phi = st.phi[i], ra = st.rA[i], rb = st.rB[i];
    out.push({ type: 'plane', id: ids['plane' + i], name: `Blade plane ${i + 1}`, mode: 'angle', base: { kind: 'std', id: 'right' }, axis: { kind: 'axis', axis: 'z' }, angle: round(((psi * 180) / Math.PI) + 90, 5) });
    // face (a line when it is straight in this plane, which it is for the linear pitch law: z(r) = P(r) phi / 2 pi + tan(rake) (r - hubR) is linear in r; a spline through
    // points when it is not), tip end, back spline (face + the axial thickness that makes the thickness NORMAL to the face, not linear in radius), root end
    const zf = (r: number): number => faceZ(p, phi, r);
    const K = 7;
    const back: Array<[number, number]> = [];
    for (let k = 0; k < K; k++) { const r = rb + ((ra - rb) * k) / (K - 1); back.push([zf(r) + axialThickness(p, phi, r), r]); }
    const KF = 9;
    const face: Array<[number, number]> = [];
    for (let k = 0; k < KF; k++) { const r = ra + ((rb - ra) * k) / (KF - 1); face.push([zf(r), r]); }
    const straight = face.every((c) => Math.abs(c[0] - (zf(ra) + ((zf(rb) - zf(ra)) * (c[1] - ra)) / (rb - ra))) < 1e-9);
    const pts: Array<{ id: string; x: number; y: number }> = [];
    const faceEnt: Record<string, unknown> = straight ? { type: 'line', id: 'face', p1: 'a', p2: 'b' } : { type: 'spline', id: 'face', pts: ['a', ...face.slice(1, -1).map((_c, k) => 'f' + (k + 1)), 'b'] };
    pts.push({ id: 'a', x: round(zf(ra), 6), y: round(ra, 6) });
    if (!straight) face.slice(1, -1).forEach((c, k) => pts.push({ id: 'f' + (k + 1), x: round(c[0], 6), y: round(c[1], 6) }));
    pts.push({ id: 'b', x: round(zf(rb), 6), y: round(rb, 6) });
    back.forEach((c, k) => pts.push({ id: 'h' + k, x: round(c[0], 6), y: round(c[1], 6) }));
    out.push({
      type: 'sketch', id: ids['sec' + i], name: `Blade section ${i + 1}`, plane: { kind: 'feature', id: ids['plane' + i] }, points: pts,
      entities: [
        faceEnt,
        { type: 'line', id: 'tip', p1: 'b', p2: 'h0' },
        { type: 'spline', id: 'back', pts: back.map((_c, k) => 'h' + k) },
        { type: 'line', id: 'root', p1: 'h' + (K - 1), p2: 'a' },
      ], constraints: [],
    });
  });
  out.push({ type: 'loft', id: ids.blade, name: 'Propeller blade', op: 'add', sketches: st.psi.map((_x, i) => ids['sec' + i]) });
  out.push({ type: 'cpattern', id: ids.pattern, name: 'Propeller blades', seeds: [ids.blade], axis: { kind: 'axis', axis: 'z' }, count: p.blades, angle: 360, equal: true });
  if (p.boreDia > 0) {
    out.push(circleSketch(ids.boreSketch, 'Propeller bore sketch', p.boreDia));
    out.push({ type: 'extrude', id: ids.bore, name: 'Propeller bore', op: 'cut', sketch: ids.boreSketch, end: 'throughBoth', depth: 10 });
  }
  return out;
}

/** The whole part document of a marine propeller (for tests, samples and the script panel). */
export function marineDocument(p: MarineParams, name = 'Marine propeller'): Record<string, unknown> {
  const errs = marineErrors(p);
  if (errs.length) throw new MarineError(errs);
  const ids: Record<string, string> = {};
  let n = 1;
  for (const r of marineRoles(p)) ids[r] = `F${n++}`;
  return { format: 'ck-part', version: 1, name, features: marineFeatures(p, ids), seq: n, rollback: null, material: 'bronze', counters: {} };
}

// ---- the wizard's edit path: record, owner, ops (live preview), plan (commit) ----

/** Presets (illustrative sizes, not tied to any product). The hub is long enough for the root of each. */
export const MARINE_PRESETS: Record<string, Partial<MarineParams>> = {
  outboard3: { diameter: 250, hubDia: 50, hubLength: 110, boreDia: 20, blades: 3, pitchRatio: 1, ear: 0.5, skew: 15 },
  inboard4: { diameter: 400, hubDia: 80, hubLength: 200, boreDia: 30, blades: 4, pitchRatio: 1.1, ear: 0.7, rootRatio: 0.45, skew: 20, thickRoot: 0.04 },
  quiet5: { diameter: 300, hubDia: 60, hubLength: 150, boreDia: 25, blades: 5, pitchRatio: 1.3, ear: 0.8, rootRatio: 0.4, skew: 25 },
};

/** Reads a marine propeller record off a feature (the parameters with defaults filled in, and the role map), or null. */
export function readMarine(f: unknown): { params: MarineParams; roles: Record<string, string> } | null {
  const rec = (f as { prop?: Record<string, unknown> } | null)?.prop;
  if (!rec || typeof rec !== 'object' || rec.family !== 'marine') return null;
  const { roles, family: _family, ...rest } = rec as { roles?: Record<string, number | string>; family?: string } & Partial<MarineParams>;
  void _family;
  return { params: { ...DEFAULT_MARINE, ...rest }, roles: Object.fromEntries(Object.entries((roles ?? {}) as Record<string, number | string>).map(([k, x]) => [k, typeof x === 'number' ? `F${x}` : x])) };
}
/** The marine propeller that owns this feature id (its hub sketch id and roles), or null. */
export function marineOwner(features: unknown[], id: string): { hubId: string; params: MarineParams; roles: Record<string, string> } | null {
  for (const f of features as Array<{ id: string }>) {
    const g = readMarine(f);
    if (g && Object.values(g.roles).includes(id)) return { hubId: f.id, params: g.params, roles: g.roles };
  }
  return null;
}

function nextSeq(doc: { features: Array<{ id?: string }>; seq?: number }): number {
  let n = doc.seq ?? 1;
  for (const f of doc.features) { const m = /^F(\d+)$/.exec(String(f.id ?? '')); if (m) n = Math.max(n, Number(m[1]) + 1); }
  return n;
}

/** Ops that create (no `existing`) or regenerate a marine propeller as ONE edit: the wizard's live preview and the tests use these. When the structure is the same (same section
 *  count and bore) every feature is replaced in place and keeps its id. When it is not (the section count changes with almost every edit of the blade shape) all the old features are
 *  removed, in reverse document order, and the new ones appended: removing single sections would cascade into the loft. Throws MarineError when the parameters have errors. */
export function marineOps(doc: { features: Array<{ id?: string }>; seq?: number }, p: MarineParams, existing?: Record<string, string>): EditOp[] {
  const errs = marineErrors(p);
  if (errs.length) throw new MarineError(errs);
  const wanted = marineRoles(p);
  const same = !!existing && wanted.length === Object.keys(existing).length && wanted.every((r) => existing[r]);
  const ops: EditOp[] = [];
  const ids: Record<string, string> = {};
  if (existing && same) {
    for (const r of wanted) ids[r] = existing[r];
    marineFeatures(p, ids).forEach((f) => ops.push({ op: 'replace', id: f.id, feature: f as unknown as Record<string, unknown> } as EditOp));
    // the hub sketch first: the other features read the record it carries
    const at = ops.findIndex((o) => (o as { id?: string }).id === ids.hubSketch);
    if (at > 0) ops.unshift(ops.splice(at, 1)[0]);
    return ops;
  }
  if (existing) {
    const gone = new Set(Object.values(existing));
    for (const id of [...doc.features.map((f) => f.id as string)].reverse()) if (gone.has(id)) ops.push({ op: 'remove', id, cascade: true });
  }
  let seq = nextSeq(doc);
  for (const r of wanted) ids[r] = `F${seq++}`;
  marineFeatures(p, ids).forEach((f) => ops.push({ op: 'add', feature: f as unknown as Record<string, unknown> } as EditOp));
  return ops;
}

export interface MarinePlan {
  /** Removals to apply first (as one edit): only when a regeneration changes the feature structure (the section count changed, the bore went on or off). */
  before: EditOp[];
  /** The document patch that is ONE undo step. */
  patch: { variables: unknown[]; features?: Record<string, Record<string, unknown>>; append?: Array<Record<string, unknown>>; seq?: number };
}
/** What to commit: a new marine propeller appended, or the regeneration of `existing` (same structure: one patch replacing the features in place; a different structure: the old
 *  features are removed first, then the new ones appended, so two undo steps). Throws MarineError for parameters with errors. */
export function marinePlan(doc: { features: Array<{ id?: string }>; seq?: number; variables?: unknown[] }, p: MarineParams, existing?: Record<string, string>): MarinePlan {
  const errs = marineErrors(p);
  if (errs.length) throw new MarineError(errs);
  const wanted = marineRoles(p);
  const vars = (doc.variables ?? []) as unknown[];
  const same = !!existing && wanted.length === Object.keys(existing).length && wanted.every((r) => existing[r]);
  if (existing && same) {
    const feats = marineFeatures(p, existing);
    return { before: [], patch: { variables: vars, features: Object.fromEntries(feats.map((f) => [f.id, f as unknown as Record<string, unknown>])) } };
  }
  const before: EditOp[] = [];
  let features = doc.features;
  if (existing) {
    const gone = new Set(Object.values(existing));
    for (const id of [...doc.features.map((f) => f.id as string)].reverse()) if (gone.has(id)) before.push({ op: 'remove', id, cascade: true });
    features = doc.features.filter((f) => !gone.has(f.id as string));
  }
  const start = nextSeq({ features, seq: doc.seq });
  const ids: Record<string, string> = {};
  let n = start;
  for (const r of wanted) ids[r] = `F${n++}`;
  const feats = marineFeatures(p, ids);
  return { before, patch: { variables: vars, append: feats as unknown as Array<Record<string, unknown>>, seq: start + feats.length } };
}
