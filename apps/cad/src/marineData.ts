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
  /** Progressive pitch (-0.15..0.5; further negative values are refused by the kernel's hub fuse for most rake values, see docs/propellers.md): fractional change of the local pitch from the tip to the root, linear in the span fraction: P(r) = P_tip (1 + pitchProgress (1 - x)). Positive = more pitch at the root. 0 = constant pitch. */
  pitchProgress: number;
  /** Chord position of the maximum thickness (0 = leading edge, 1 = trailing edge), 0.2..0.7. */
  maxThickAt: number;
  /** Thickness at the leading and trailing edge as a fraction of the maximum thickness at that radius (0.02..0.5). The absolute edge thickness is never below 0.3 mm (`EDGE_MIN_MM`). */
  edgeThick: number;
  /** Rounding of the blade tip: the outer fraction of the span (0..0.4) over which the chord closes off along an ellipse. 0 = the square-cut tip of the earlier generator. */
  tipRounding: number;
}

export const DEFAULT_MARINE: MarineParams = {
  diameter: 250, hubDia: 50, hubLength: 110, boreDia: 20, blades: 3, pitchRatio: 1, ear: 0.5, peak: 0.45, rootRatio: 0.55, tipRatio: 0.3,
  skew: 15, thickRoot: 0.035, thickTip: 0.005, direction: 'rh', rootEmbed: 0.85, raySpacing: 5, rake: 0, pitchProgress: 0, maxThickAt: 0.45, edgeThick: 0.06, tipRounding: 0.15,
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
  const c = xc <= pk ? p.rootRatio + (1 - p.rootRatio) * smooth(xc / pk) : 1 + (p.tipRatio - 1) * smooth((xc - pk) / (1 - pk));
  // tip rounding: over the outer `tipRounding` of the span the chord closes along an ellipse (vertical tangent at the tip; a 5 % floor keeps the outline from pinching to a point)
  const tr = Math.min(0.4, Math.max(0, p.tipRounding ?? 0));
  if (tr > 0 && xc > 1 - tr) { const q = (xc - (1 - tr)) / tr; return c * Math.sqrt(Math.max(1 - q * q, 0.0025)); }
  return c;
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
const axial0 = (p: MarineParams, phi: number, r: number, foil = true): number => {
  const fr = faceSlopeR(p, phi), ft = pitchAt(p, r) / (2 * Math.PI * r);
  return (foil ? thicknessLocal(p, phi, r) : thicknessAt(p, r)) * Math.sqrt(1 + fr * fr + ft * ft);
};
/** Axial offset (mm) from the face to the back that gives the thickness t NORMAL to the face at (phi, r). The first-order t / n_z is exact only where the back is parallel to the
 *  face; the offset changes with r and phi, and the normal leaves the face sideways by several mm near the root, so one Newton correction follows: march along the exact normal to the
 *  first-order back (bisection), and move the offset by the distance error over n_z. The residual against a numeric march through the corrected back is under 1 % (marineData.test.ts). */
export function axialThickness(p: MarineParams, phi: number, r: number, foil = true): number {
  const a0 = axial0(p, phi, r, foil), t = foil ? thicknessLocal(p, phi, r) : thicknessAt(p, r);
  if (p.rake === 0 && p.pitchProgress === 0) return a0;
  // with the foil the thickness varies along the chord and the march along the normal is ill-conditioned there (it went negative near the trailing edge): the Newton factor of the flat back of
  // the MAXIMUM thickness (the one that is exact where the back is parallel to the face) scales the local first-order offset instead, so the offset stays positive and thin where the foil is thin
  if (foil) return a0 * (axialThickness(p, phi, r, false) / axial0(p, phi, r, false));   // the constant-pitch helicoid keeps the first-order offset (0.7 % thin at the root, see docs)
  const fr = faceSlopeR(p, phi), ft = pitchAt(p, r) / (2 * Math.PI * r);
  const nz = 1 / Math.sqrt(1 + fr * fr + ft * ft), nr = -fr * nz, nt = -ft * nz;
  const zp = faceZ(p, phi, r);
  const gap = (sd: number): number => {
    const x = r + sd * nr, y = sd * nt, rq = Math.hypot(x, y), pq = phi + Math.atan2(y, x);
    return zp + sd * nz - (faceZ(p, pq, rq) + axial0(p, pq, rq, foil));
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
/** The MAXIMUM back thickness (mm) at radius r (normal to the face, at the chord position `maxThickAt`): root to tip, linear. */
export function thicknessAt(p: MarineParams, r: number): number {
  const x = Math.min(1, Math.max(0, spanFraction(p, r)));
  return p.diameter * (p.thickRoot + (p.thickTip - p.thickRoot) * x);
}
/** Smallest thickness at the leading and trailing edge, mm: a zero-thickness sliver is refused by the kernel. */
export const EDGE_MIN_MM = 0.3;
/** Edge thickness as a fraction of the maximum thickness at radius r: `edgeThick`, raised so that the absolute edge thickness stays at `EDGE_MIN_MM` (at most 1: no foil). */
export const edgeFraction = (p: MarineParams, r: number): number => Math.min(1, Math.max(p.edgeThick, EDGE_MIN_MM / Math.max(thicknessAt(p, r), 1e-9)));
/** The chordwise thickness profile f(s) of a section, s the chord fraction (0 leading edge, 1 trailing edge), e the edge fraction: f = e + (1 - e) g(s) with g an ELLIPSE
 *  from the nose to the maximum (g = sqrt(1 - ((m - s) / m)^2), vertical tangent at s = 0: a rounded nose) and a PARABOLA from the maximum to the trailing edge (g = 1 - ((s - m) / (1 - m))^2:
 *  a thin wedge). f(m) = 1, f(0) = f(1) = e, and the slope is continuous at the maximum. */
export function foilProfile(m: number, e: number, s: number): number {
  const x = Math.min(1, Math.max(0, s));
  const g = x <= m ? Math.sqrt(Math.max(0, 1 - ((m - x) / m) ** 2)) : 1 - ((x - m) / (1 - m)) ** 2;
  return e + (1 - e) * g;
}
/** Mean of f over s in [0, 1]: e + (1 - e) (pi m / 4 + 2 (1 - m) / 3). The blade volume per unit planform area is the maximum thickness times this. */
export const foilMean = (m: number, e: number): number => e + (1 - e) * ((Math.PI * m) / 4 + (2 * (1 - m)) / 3);
/** Chord fraction s (0 at the leading edge, 1 at the trailing edge) of the point at angle `phi` (before the direction sign) and radius r, clamped to [0, 1]. */
export function chordFraction(p: MarineParams, phi: number, r: number): number {
  const [le, te] = edgeAngles(p, r);
  return te - le < 1e-12 ? 0.5 : Math.min(1, Math.max(0, (phi - le) / (te - le)));
}
/** Angle (before the direction sign) of the chord fraction s at radius r: the inverse of `chordFraction`. */
export function chordAngle(p: MarineParams, s: number, r: number): number { const [le, te] = edgeAngles(p, r); return le + s * (te - le); }
/** The normal thickness (mm) at angle `phi` and radius r: the maximum thickness there times the foil profile at the chord position of the point. */
export const thicknessLocal = (p: MarineParams, phi: number, r: number): number =>
  thicknessAt(p, r) * foilProfile(p.maxThickAt, edgeFraction(p, r), chordFraction(p, phi, r));

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
    need = Math.max(need, zmax + axialThickness(p, st.phi[i], r0, false));
  });
  return 2 * (need + 2);
}

export function validateMarine(p: MarineParams): MarineIssue[] {
  const out: MarineIssue[] = [];
  const err = (code: string, message: string): void => { out.push({ level: 'error', code, message }); };
  const warn = (code: string, message: string): void => { out.push({ level: 'warning', code, message }); };
  const nums: Array<keyof MarineParams> = ['diameter', 'hubDia', 'hubLength', 'boreDia', 'blades', 'pitchRatio', 'ear', 'peak', 'rootRatio', 'tipRatio', 'skew', 'thickRoot', 'thickTip', 'rootEmbed', 'raySpacing', 'rake', 'pitchProgress', 'maxThickAt', 'edgeThick', 'tipRounding'];
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
  if (p.pitchProgress < -0.15 || p.pitchProgress > 0.5) err('pitchProgress', 'The progressive pitch must be between -0.15 and 0.5');
  if (p.maxThickAt < 0.2 || p.maxThickAt > 0.7) err('maxThickAt', 'The position of the maximum thickness must be between 0.2 and 0.7 of the chord');
  if (p.edgeThick < 0.02 || p.edgeThick > 0.5) err('edgeThick', 'The edge thickness must be between 0.02 and 0.5 of the maximum thickness');
  if (p.tipRounding < 0 || p.tipRounding > 0.4) err('tipRounding', 'The tip rounding must be between 0 and 0.4 of the span');
  if (p.rootEmbed <= 0.3 || p.rootEmbed >= 1) err('rootEmbed', 'The root embed must be between 0.3 and 1 of the hub radius');
  if (out.length) return out;
  if (p.thickTip * p.diameter < 0.3) warn('thinTip', 'The blade tip is thinner than 0.3 mm');
  if (p.thickTip > p.thickRoot) warn('thickTip', 'The tip is thicker than the root');
  // the blades touch at the root when their angular widths add to a full turn
  const [le, te] = edgeAngles(p, hubR);
  if ((p.blades * (te - le)) > 2 * Math.PI * 0.95) warn('overlap', 'The blades overlap at the hub: lower the area ratio or the root chord ratio');
  const need = hubLengthNeeded(p);
  if (p.hubLength < need) err('hubShort', `The hub is too short for the root: the blade root spans ${round(need, 1)} mm along the shaft (hub length at least that)`);
  // the hub fuse is the touchy step: a low pitch near the hub (constant 0.7 to 0.8, or a pitch falling toward the root) is refused for most section spacings (docs/propellers.md)
  if ((pitchAt(p, hubR) / p.diameter) <= 0.8 + 1e-9) warn('rootPitch', 'The pitch at the hub is 0.8 D or lower: the hub fuse often fails; the build then retries finer section spacings');
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
  const n = 300;
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
const stationCache = new Map<string, HelicoidStations>();
export function helicoidStations(p: MarineParams, stepDeg = p.raySpacing): HelicoidStations {
  // the build, the roles and the readout ask for the same stations again and again, and each costs a second: the last few are kept
  const key = JSON.stringify([p, stepDeg]);
  const hit = stationCache.get(key);
  if (hit) return hit;
  const out = computeStations(p, stepDeg);
  if (stationCache.size >= 8) stationCache.delete(stationCache.keys().next().value as string);
  stationCache.set(key, out);
  return out;
}
function computeStations(p: MarineParams, stepDeg: number): HelicoidStations {
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
  type Ray = { phi: number; a: number; b: number };
  let rays: Array<Ray | null> = [];
  const make = (phi: number): Ray | null => { const iv = rayInterval(p, phi); return iv && iv[1] - iv[0] >= 1e-3 ? { phi, a: iv[0], b: iv[1] } : null; };
  // a section plane through the hub cylinder's seam (angle 0) makes the kernel's hub fuse fail (an odd number of rays puts one at the blade's middle, which is about 0): shift the grid by up to
  // 0.4 step until every ray is SEAM_DEG off the seam
  let shift = 0;
  for (const d of [0, 0.3, -0.3, 0.15, -0.15, 0.4, -0.4]) {
    if (Array.from({ length: count }, (_x, k) => Math.abs(lo + step * (k + 0.5 + d))).every((a) => a > rad(SEAM_DEG))) { shift = d; break; }
  }
  for (let k = 0; k < count; k++) rays.push(make(lo + step * (k + 0.5 + shift)));
  // smoother outline: where the end radius of a ray jumps by more than `OUTLINE_JUMP` of the tip radius against its neighbour (the corners where the outline switches between the root or tip arc and
  // the leading or trailing edge) a ray is inserted halfway, down to `OUTLINE_MIN_DEG` between rays; the loft's rim then follows the outline through the corner instead of cutting it
  const jump = OUTLINE_JUMP * R, minGap = rad(OUTLINE_MIN_DEG);
  // the turn the outline makes at a ray's end between its neighbours' ends: a rim made of straight pieces shows a kink of this size at each ray; both intervals next to a kinked ray are split
  const tol = OUTLINE_KINK_MM * R / 150;
  const pt = (ph: number, r: number): [number, number] => [r * Math.cos(ph), r * Math.sin(ph)];
  const turnAt = (a: Ray, b: Ray, c: Ray, key: 'a' | 'b'): number => {
    const [x1, y1] = pt(a.phi, a[key]), [x0, y0] = pt(b.phi, b[key]), [x2, y2] = pt(c.phi, c[key]);
    const turn = Math.abs(Math.atan2((x0 - x1) * (y2 - y0) - (y0 - y1) * (x2 - x0), (x0 - x1) * (x2 - x0) + (y0 - y1) * (y2 - y0)));
    return turn * Math.min(Math.hypot(x0 - x1, y0 - y1), Math.hypot(x2 - x0, y2 - y0));
  };
  for (let level = 0; level < 4 && stepDeg >= OUTLINE_MIN_DEG * 2; level++) {
    const split = new Array<boolean>(rays.length).fill(false);
    for (let k = 0; k + 1 < rays.length; k++) {
      const u = rays[k], v = rays[k + 1];
      if (!u || !v) continue;
      if (level < 3 && (Math.abs(u.b - v.b) > jump || Math.abs(u.a - v.a) > jump)) split[k] = true;
    }
    for (let k = 1; k + 1 < rays.length; k++) {
      const u = rays[k - 1], c = rays[k], v = rays[k + 1];
      if (!u || !c || !v) continue;
      if (c.b > OUTER_ZONE * R && turnAt(u, c, v, 'b') > tol) split[k - 1] = split[k] = true;
    }
    const nxt: Array<Ray | null> = [];
    for (let k = 0; k < rays.length; k++) {
      nxt.push(rays[k]);
      const u = rays[k], v = rays[k + 1];
      if (split[k] && u && v && v.phi - u.phi > 2 * minGap) {
        // an extra ray whose end falls close to the hub surface or the hub seam is not added: the kernel's hub fuse fails on those
        const m = make(0.5 * (u.phi + v.phi));
        if (m && Math.abs(m.phi) > rad(SEAM_DEG) && ((m.a <= r0 + 1e-6 && u.a <= r0 + 1e-6 && v.a <= r0 + 1e-6) || Math.abs(m.a - hubR) > HUB_KEEPOUT) && Math.abs(m.b - hubR) > HUB_KEEPOUT) nxt.push(m);
      }
    }
    if (nxt.length === rays.length) break;
    rays = nxt;
  }
  const psi: number[] = [], z: number[] = [], rA: number[] = [], rB: number[] = [], phis: number[] = [];
  for (const ray of rays) {
    if (!ray) continue;
    const phi = ray.phi;
    // an end of a ray lying on the hub surface touches the hub cylinder tangentially and the kernel's boolean fails there: move it 0.6 mm off
    let a = ray.a, b = ray.b;
    if (Math.abs(a - hubR) < 0.6) a = hubR - 0.6;
    if (Math.abs(b - hubR) < 0.6) b = hubR + 0.6;
    // a ray that only just clears the hub (a sliver of a section, which only happens at the first or last ray of a blade) leaves the kernel a near tangent to fuse: dropped
    if (b - a < 1e-3 || b < hubR + SLIVER) continue;
    psi.push(s * phi); z.push(faceZ(p, phi, hubR)); rA.push(a); rB.push(b); phis.push(phi);
  }
  return { psi, z, rA, rB, phi: phis };
}

/** The point of the face (a helicoid when rake and progressive pitch are 0) at angle `phi` (before the direction sign) and radius r: the face the blade must lie on. */
export function helicoidPoint(p: MarineParams, phi: number, r: number): [number, number, number] {
  const s = sgn(p);
  return [r * Math.cos(s * phi), r * Math.sin(s * phi), faceZ(p, phi, r)];
}

/** Outline refinement of `helicoidStations`: the end radius jump (fraction of the tip radius) that triggers an extra ray, and the smallest angle between rays, degrees. */
export const OUTLINE_JUMP = 0.05;
/** The kink the rim may show at a ray's end, as the turn of the outline (radians) times the shorter piece next to it (mm, for a 150 mm tip radius; it scales with the radius): the outline is refined until every ray is below it (or the rays are OUTLINE_MIN_DEG apart). */
export const OUTLINE_KINK_MM = 0.8;
export const OUTLINE_MIN_DEG = 1;
const OUTER_ZONE = 0.6;
const SEAM_DEG = 1.2;
const SLIVER = 4;
const HUB_KEEPOUT = 6;

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

/** Points of the back spline of a section: the foil thickness varies along the ray (nose, maximum, thin tail), so there are many, and they cluster toward both ends of the ray where the profile bends fastest. */
export const BACK_POINTS = 11;
export const backFractions = (n: number): number[] => Array.from({ length: n }, (_x, k) => { const u = k / (n - 1); return 0.5 * u + 0.5 * (0.5 - 0.5 * Math.cos(Math.PI * u)); });

/** Rays that graze the leading or trailing edge (the first and last of a blade, or a ray crossing a notch of the outline) see the thickness jump between the nose and the maximum within a few points,
 *  and a spline through such a jump overshoots below the face (the kernel refuses the profile, `loftProfile`). Where the second difference of the offsets is large against the largest offset the
 *  interior points are relaxed with [1 2 1] / 4 passes; the end points (the edges) and every smooth section are left exactly as they are. */
export function calmOffsets(a: number[]): number[] {
  let cur = a.slice();
  const big = Math.max(...a);
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    const next = cur.slice();
    for (let k = 1; k < cur.length - 1; k++) {
      if (Math.abs(cur[k - 1] - 2 * cur[k] + cur[k + 1]) > CALM_LIMIT * big) { next[k] = 0.25 * cur[k - 1] + 0.5 * cur[k] + 0.25 * cur[k + 1]; changed = true; }
    }
    cur = next;
    if (!changed) break;
  }
  return cur;
}
const CALM_LIMIT = 0.3;

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
    const K = BACK_POINTS;
    const back: Array<[number, number]> = [];
    const rs = backFractions(K).map((u) => rb + (ra - rb) * u);
    const ax = calmOffsets(rs.map((r) => axialThickness(p, phi, r)));
    rs.forEach((r, k) => back.push([zf(r) + ax[k], r]));
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

/** The shipped sample (`marine-propeller`): three blades, mild rake (10 degrees) and progressive pitch (15 % more pitch at the hub than at the tip); the hub is as long as the root needs. */
export const MARINE_SAMPLE: MarineParams = (() => { const p = { ...DEFAULT_MARINE, rake: 10, pitchProgress: 0.15 }; return { ...p, hubLength: Math.max(p.hubLength, Math.ceil(hubLengthNeeded(p)) + 1) }; })();

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
