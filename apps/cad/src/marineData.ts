// The Propeller generator, marine family: parameters, validation, readout and the feature list for a hub with N blades whose FACE lies on a true constant-pitch helicoid.
// Pure functions, no framework. The blade is built from what the kernel's propeller probe (cap 5 to 7) proved works, with one change forced by the kernel
// (see docs/propellers.md, "Marine family: probe"): the kernel cannot thicken a TRIMMED sheet and a slab cannot be trimmed by an outline prism without an open edge, so
// the sheet is made with the blade outline as its boundary instead of being trimmed:
//   1. a helicoid sheet: a surface loft through radial line sections, one per angle phi_k, each on the plane z = P phi_k / 2 pi (a ruled helicoid); a line runs only
//      from where its ray enters the expanded blade outline to where it leaves, so the loft's side edges ARE the leading and trailing edge;
//   2. the sheet thickened toward the back with a root-to-tip taper (`thicknessAt`) into a closed blade, fused to the hub, patterned, bored.
// Frame: shaft axis Z; the pressure face is the helicoid itself, all the thickness is on the back. Geometry only: no hydrodynamics.
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
  /** Constant pitch / diameter (P / D). */
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
}

export const DEFAULT_MARINE: MarineParams = {
  diameter: 250, hubDia: 50, hubLength: 110, boreDia: 20, blades: 3, pitchRatio: 1, ear: 0.5, peak: 0.45, rootRatio: 0.55, tipRatio: 0.3,
  skew: 15, thickRoot: 0.035, thickTip: 0.005, direction: 'rh', rootEmbed: 0.85, raySpacing: 5,
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

/** Pitch angle of the helicoid at radius r (radians from the plane of rotation). */
export const pitchAngleAt = (p: MarineParams, r: number): number => Math.atan((p.pitchRatio * p.diameter) / (2 * Math.PI * r));
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

/** Hub length that keeps the root of the blade (the part of the sheet inside the hub radius, plus the thickness and 2 mm) between the hub's end faces. */
export function hubLengthNeeded(p: MarineParams): number {
  const { hubR } = marineSpan(p);
  const st = helicoidStations(p);
  let zmax = 0;
  st.psi.forEach((_x, i) => { if (st.rA[i] <= hubR) zmax = Math.max(zmax, Math.abs(st.z[i])); });
  const r0 = marineSpan(p).r0;
  return 2 * (zmax + thicknessAt(p, r0) / Math.cos(pitchAngleAt(p, r0)) + 2);
}

export function validateMarine(p: MarineParams): MarineIssue[] {
  const out: MarineIssue[] = [];
  const err = (code: string, message: string): void => { out.push({ level: 'error', code, message }); };
  const warn = (code: string, message: string): void => { out.push({ level: 'warning', code, message }); };
  const nums: Array<keyof MarineParams> = ['diameter', 'hubDia', 'hubLength', 'boreDia', 'blades', 'pitchRatio', 'ear', 'peak', 'rootRatio', 'tipRatio', 'skew', 'thickRoot', 'thickTip', 'rootEmbed', 'raySpacing'];
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
  if (p.rootEmbed <= 0.3 || p.rootEmbed >= 1) err('rootEmbed', 'The root embed must be between 0.3 and 1 of the hub radius');
  if (out.length) return out;
  if (p.thickTip * p.diameter < 0.3) warn('thinTip', 'The blade tip is thinner than 0.3 mm');
  if (p.thickTip > p.thickRoot) warn('thickTip', 'The tip is thicker than the root');
  // the blades touch at the root when their angular widths add to a full turn
  const [le, te] = edgeAngles(p, hubR);
  if ((p.blades * (te - le)) > 2 * Math.PI * 0.95) warn('overlap', 'The blades overlap at the hub: lower the area ratio or the root chord ratio');
  const need = hubLengthNeeded(p);
  if (p.hubLength < need) err('hubShort', `The hub is too short for the root: the blade root spans ${round(need, 1)} mm along the shaft (hub length at least that)`);
  if (Math.abs(p.skew) > 45) warn('skew', 'A skew above 45 degrees is unusual');
  void r0;
  return out;
}
export const marineErrors = (p: MarineParams): MarineIssue[] => validateMarine(p).filter((i) => i.level === 'error');
export class MarineError extends Error {
  constructor(public issues: MarineIssue[]) { super(issues.map((i) => i.message).join('; ')); }
}

export interface MarineReadout {
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
  return { radius: R, hubRadius: hubR, pitch: p.pitchRatio * p.diameter, pitchRatio: p.pitchRatio, ear: (p.blades * area) / (Math.PI * R * R), chordMax: chordMax(p), angleRoot: deg(hubR), angle70: deg(0.7 * R), angleTip: deg(R), bladeArea: area, issues: validateMarine(p) };
}

// ---- geometry ----

export interface HelicoidStations {
  /** Angle (radians, world, direction sign applied), height and radial extent of each line section. */
  psi: number[]; z: number[]; rA: number[]; rB: number[];
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
  const s = sgn(p), P = p.pitchRatio * p.diameter;
  const psi: number[] = [], z: number[] = [], rA: number[] = [], rB: number[] = [];
  for (let k = 0; k < count; k++) {
    const phi = lo + step * (k + 0.5);
    const iv = rayInterval(p, phi);
    if (!iv || iv[1] - iv[0] < 1e-3) continue;
    // an end of a ray lying on the hub surface touches the hub cylinder tangentially and the kernel's boolean fails there: move it 0.6 mm off
    let [a, b] = iv;
    if (Math.abs(a - hubR) < 0.6) a = hubR - 0.6;
    if (Math.abs(b - hubR) < 0.6) b = hubR + 0.6;
    if (b - a < 1e-3) continue;
    psi.push(s * phi); z.push((P * phi) / (2 * Math.PI)); rA.push(a); rB.push(b);
  }
  return { psi, z, rA, rB };
}

/** The point of the helicoid at angle `phi` (before the direction sign) and radius r: the face the blade must lie on. */
export function helicoidPoint(p: MarineParams, phi: number, r: number): [number, number, number] {
  const s = sgn(p), P = p.pitchRatio * p.diameter;
  return [r * Math.cos(s * phi), r * Math.sin(s * phi), (P * phi) / (2 * Math.PI)];
}

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
  // one closed section per ray, on the plane through the shaft axis at the ray's angle: a thin quadrilateral (radius from rA to rB, the face line at height z, the back line
  // an axial thickness above it, linear in radius). Sketch axes of such a plane: u = world Z, v = the radial direction at the ray's angle (checked against the kernel).
  const { R, hubR } = marineSpan(p);
  // thickness is normal to the face; along the shaft it is t / cos(pitch angle)
  const tAxial = (r: number): number => thicknessAt(p, r) / Math.cos(pitchAngleAt(p, r));
  st.psi.forEach((psi, i) => {
    const z0 = st.z[i], ra = st.rA[i], rb = st.rB[i];
    out.push({ type: 'plane', id: ids['plane' + i], name: `Blade plane ${i + 1}`, mode: 'angle', base: { kind: 'std', id: 'right' }, axis: { kind: 'axis', axis: 'z' }, angle: round(((psi * 180) / Math.PI) + 90, 5) });
    // face line, tip end, back spline (through points that follow the real axial thickness, which is not linear in radius), root end
    const K = 7;
    const back: Array<[number, number]> = [];
    for (let k = 0; k < K; k++) { const r = rb + ((ra - rb) * k) / (K - 1); back.push([z0 + tAxial(r), r]); }
    const pts: Array<{ id: string; x: number; y: number }> = [{ id: 'a', x: round(z0, 6), y: round(ra, 6) }, { id: 'b', x: round(z0, 6), y: round(rb, 6) }];
    back.forEach((c, k) => pts.push({ id: 'h' + k, x: round(c[0], 6), y: round(c[1], 6) }));
    out.push({
      type: 'sketch', id: ids['sec' + i], name: `Blade section ${i + 1}`, plane: { kind: 'feature', id: ids['plane' + i] }, points: pts,
      entities: [
        { type: 'line', id: 'face', p1: 'a', p2: 'b' },
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
