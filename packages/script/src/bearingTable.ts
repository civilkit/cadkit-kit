// Rolling bearings: the size table and the pure rules behind bearing() (features/bearing.ts) and the Bearing wizard. Nothing here touches the recorder
// or the kernel, so the numbers can be tested and shown without a build.
//
// The table lists NOMINAL boundary dimensions (bore d, outer diameter D, width B) of single-row deep-groove ball bearings as ISO 15 gives them:
// the miniature 6xx series, the MR miniature (1-up) series, the 60xx / 62xx / 63xx series and a few inch (R series) sizes. They are standard facts,
// written down from the standard's tables and checked against each other (bore < D, one series stepping up with the bore); the ring and ball
// sizes below the nominal ones (race gap, ball diameter, ball count, chamfer) are rules of thumb, not a bearing maker's catalogue.

export type BearingSeries = 'miniature' | 'mr' | '60' | '62' | '63' | 'inch';
export interface BearingPreset {
  /** the designation without a seal suffix: '608', '6204', 'MR63', 'R2' */
  designation: string;
  series: BearingSeries;
  /** bore diameter d, mm */ bore: number;
  /** outer diameter D, mm */ od: number;
  /** width B, mm */ width: number;
}

const inch = (v: number): number => Math.round(v * 25.4 * 1000) / 1000;
const row = (series: BearingSeries, designation: string, bore: number, od: number, width: number): BearingPreset => ({ designation, series, bore, od, width });

/** Nominal ISO 15 dimensions (d x D x B in mm) of the common deep-groove ball bearings; inch sizes are the fractions converted at 25.4 mm. */
export const BEARING_PRESETS: readonly BearingPreset[] = [
  // miniature 6xx (the last digit is the bore in mm)
  row('miniature', '602', 2, 7, 3), row('miniature', '603', 3, 9, 5), row('miniature', '604', 4, 12, 4), row('miniature', '605', 5, 14, 5),
  row('miniature', '606', 6, 17, 6), row('miniature', '607', 7, 19, 6), row('miniature', '608', 8, 22, 7), row('miniature', '609', 9, 24, 7),
  row('miniature', '623', 3, 10, 4), row('miniature', '624', 4, 13, 5), row('miniature', '625', 5, 16, 5), row('miniature', '626', 6, 19, 6),
  row('miniature', '627', 7, 22, 7), row('miniature', '628', 8, 24, 8), row('miniature', '629', 9, 26, 8),
  // MR miniature series
  row('mr', 'MR52', 2, 5, 2.5), row('mr', 'MR62', 2, 6, 2.5), row('mr', 'MR63', 3, 6, 2.5), row('mr', 'MR74', 4, 7, 2.5), row('mr', 'MR84', 4, 8, 3),
  row('mr', 'MR85', 5, 8, 2.5), row('mr', 'MR93', 3, 9, 4), row('mr', 'MR95', 5, 9, 3), row('mr', 'MR105', 5, 10, 4), row('mr', 'MR106', 6, 10, 3),
  row('mr', 'MR115', 5, 11, 4), row('mr', 'MR126', 6, 12, 4), row('mr', 'MR128', 8, 12, 3.5), row('mr', 'MR137', 7, 13, 4),
  row('mr', 'MR148', 8, 14, 4), row('mr', 'MR149', 9, 14, 4.5),
  // 60xx (diameter series 0)
  row('60', '6000', 10, 26, 8), row('60', '6001', 12, 28, 8), row('60', '6002', 15, 32, 9), row('60', '6003', 17, 35, 10), row('60', '6004', 20, 42, 12),
  row('60', '6005', 25, 47, 12), row('60', '6006', 30, 55, 13), row('60', '6007', 35, 62, 14), row('60', '6008', 40, 68, 15), row('60', '6009', 45, 75, 16),
  row('60', '6010', 50, 80, 16), row('60', '6011', 55, 90, 18), row('60', '6012', 60, 95, 18),
  // 62xx (diameter series 2)
  row('62', '6200', 10, 30, 9), row('62', '6201', 12, 32, 10), row('62', '6202', 15, 35, 11), row('62', '6203', 17, 40, 12), row('62', '6204', 20, 47, 14),
  row('62', '6205', 25, 52, 15), row('62', '6206', 30, 62, 16), row('62', '6207', 35, 72, 17), row('62', '6208', 40, 80, 18), row('62', '6209', 45, 85, 19),
  row('62', '6210', 50, 90, 20), row('62', '6211', 55, 100, 21), row('62', '6212', 60, 110, 22),
  // 63xx (diameter series 3)
  row('63', '6300', 10, 35, 11), row('63', '6301', 12, 37, 12), row('63', '6302', 15, 42, 13), row('63', '6303', 17, 47, 14), row('63', '6304', 20, 52, 15),
  row('63', '6305', 25, 62, 17), row('63', '6306', 30, 72, 19), row('63', '6307', 35, 80, 21), row('63', '6308', 40, 90, 23), row('63', '6309', 45, 100, 25),
  row('63', '6310', 50, 110, 27), row('63', '6311', 55, 120, 29), row('63', '6312', 60, 130, 31),
  // inch sizes (R series): the 1/8 inch bore is the R2, common on small shafts
  row('inch', 'R2', inch(1 / 8), inch(3 / 8), inch(5 / 32)), row('inch', 'R3', inch(3 / 16), inch(1 / 2), inch(5 / 32)), row('inch', 'R4', inch(1 / 4), inch(5 / 8), inch(0.196)),
  row('inch', 'R6', inch(3 / 8), inch(7 / 8), inch(9 / 32)), row('inch', 'R8', inch(1 / 2), inch(1 + 1 / 8), inch(5 / 16)),
  row('inch', 'R10', inch(5 / 8), inch(1 + 3 / 8), inch(11 / 32)), row('inch', 'R12', inch(3 / 4), inch(1 + 5 / 8), inch(3 / 8)),
];

export type BearingSeal = 'open' | '2Z' | '2RS';
export const BEARING_SEALS: readonly BearingSeal[] = ['open', '2Z', '2RS'];

/** Seal suffixes, longest first, with what they mean (the empty suffix last: no seal named). */
const SUFFIXES: Array<[string, BearingSeal | null]> = [['2RSH', '2RS'], ['2RS', '2RS'], ['RSH', '2RS'], ['RS', '2RS'], ['2RZ', '2RS'], ['2Z', '2Z'], ['ZZ', '2Z'], ['Z', '2Z'], ['OPEN', 'open'], ['N', 'open'], ['', null]];
const norm = (s: string): string => s.toUpperCase().replace(/[\s_]/g, '');

/**
 * The preset a designation names. Seal and shield suffixes are accepted and returned as `seal` ('608-2RS', '608ZZ', '6204 2Z', 'mr63zz', '608RS'): 2RS, RS
 * and 2RSH mean a seal, 2Z, ZZ and Z a shield, and N, OPEN or no suffix an open bearing. Null when no preset has that designation.
 */
export function bearingPreset(designation: string): { preset: BearingPreset; seal: BearingSeal | null } | null {
  const q = norm(designation);
  for (const [suffix, seal] of SUFFIXES) {
    if (!q.endsWith(suffix)) continue;
    const name = q.slice(0, q.length - suffix.length).replace(/[-/]$/, '');
    const preset = BEARING_PRESETS.find((p) => p.designation === name);
    if (preset) return { preset, seal };
  }
  return null;
}

/** The presets matching a search: a designation prefix ('620' lists 6200 to 6209), or a size ('8x22', '8x22x7'), best match first. */
export function findBearings(query: string): BearingPreset[] {
  const q = norm(query).replace(/[-/]?(2RSH?|RSH?|2Z|ZZ)$/, '');
  if (!q) return [...BEARING_PRESETS];
  const sized = /^(\d+(?:\.\d+)?)X(\d+(?:\.\d+)?)(?:X(\d+(?:\.\d+)?))?$/.exec(q);
  if (sized) {
    const [d, od, b] = [Number(sized[1]), Number(sized[2]), sized[3] === undefined ? null : Number(sized[3])];
    return BEARING_PRESETS.filter((p) => Math.abs(p.bore - d) < 0.01 && Math.abs(p.od - od) < 0.01 && (b === null || Math.abs(p.width - b) < 0.01));
  }
  const exact = BEARING_PRESETS.filter((p) => p.designation === q);
  const prefix = BEARING_PRESETS.filter((p) => p.designation !== q && p.designation.startsWith(q));
  const inner = BEARING_PRESETS.filter((p) => !p.designation.startsWith(q) && p.designation.includes(q));
  return [...exact, ...prefix, ...inner];
}

// ---- the ring and ball model ----

export interface BearingSpec {
  bore: number; od: number; width: number;
  seal?: BearingSeal;
  /** chamfer on the ring corners, mm (default by size); 0 for sharp corners */
  chamfer?: number;
  /** ball count for an open bearing (default by rule) */
  balls?: number;
  /** ball diameter for an open bearing (default from the race gap) */
  ballDiameter?: number;
}

/** The numbers of a bearing section. Radii are from the axis; y is along the axis from the first face (0) to the second (width). */
export interface BearingModel {
  seal: BearingSeal;
  bore: number; od: number; width: number;
  /** inner ring: bore radius and outer (race) radius */ r1: number; r2: number;
  /** outer ring: inner (race) radius and outer radius */ r3: number; R: number;
  /** radial thickness of each ring */ ring: number;
  /** radial gap between the races */ gap: number;
  chamfer: number;
  /** shield or seal: recess of its outer face from the ring face, thickness, inner radius (a small clearance outside the inner ring) */
  recess: number; shieldThickness: number; shieldTip: number;
  /** outer-ring inside corner chamfer when a shield sits there */ innerCornerChamfer: number;
  /** balls (open bearings; 0 otherwise) */ balls: number; ballDiameter: number; pitchRadius: number;
}

/** Ring chamfer by section height (D - d) / 2, after the usual minimum chamfers r_s of ISO 582: small for miniatures, 1 mm from about 13 mm of section up. */
export function defaultChamfer(sectionHeight: number): number {
  return sectionHeight < 3 ? 0.1 : sectionHeight < 4.5 ? 0.15 : sectionHeight < 13 ? (sectionHeight < 9 ? 0.3 : 0.6) : 1;
}

/** How many balls fit around the pitch circle with about 0.6 of a ball between neighbours (7 for a 608 or 625, 9 for a 6204). */
export function defaultBallCount(pitchRadius: number, ballDiameter: number): number {
  return Math.max(3, Math.floor((2 * Math.PI * pitchRadius) / (1.6 * ballDiameter)));
}

/** The reason a bearing cannot be made, or null. Same messages the helper throws (without its prefix). */
export function bearingProblem(s: BearingSpec): string | null {
  const { bore, od, width } = s;
  if (![bore, od, width].every((v) => Number.isFinite(v) && v > 0)) return 'bore, od and width must be positive numbers';
  if (!(bore < od)) return `the bore (${bore}) must be smaller than the outer diameter (${od})`;
  if (s.chamfer !== undefined && !(Number.isFinite(s.chamfer) && s.chamfer >= 0)) return 'chamfer cannot be negative';
  const m = bearingModelUnchecked(s);
  if (!(2 * m.chamfer < m.ring) && m.chamfer > 0) return `the chamfer (${m.chamfer}) must be less than half the ring thickness (${+m.ring.toFixed(3)})`;
  if (!(2 * m.chamfer < width)) return `the chamfer (${m.chamfer}) must be less than half the width (${width})`;
  if (m.seal !== 'open' && !(width - 2 * (m.recess + m.shieldThickness) > 0.1)) return `the width (${width}) is too small for a ${m.seal} shield or seal; use an open bearing`;
  if (m.seal !== 'open' && (s.balls !== undefined || s.ballDiameter !== undefined)) return `balls and ballDiameter apply to an open bearing only (the ${m.seal} cover hides the balls)`;
  if (m.seal === 'open') {
    if (!(m.ballDiameter > 0)) return 'ballDiameter must be positive';
    if (m.ballDiameter > m.gap + 1e-9) return `the balls (${+m.ballDiameter.toFixed(3)}) are larger than the gap between the races (${+m.gap.toFixed(3)})`;
    if (m.ballDiameter > width) return `the balls (${+m.ballDiameter.toFixed(3)}) are wider than the bearing (${width})`;
    if (!Number.isInteger(m.balls) || m.balls < 3) return 'balls must be a whole number, 3 or more';
    if (m.ballDiameter > 2 * m.pitchRadius * Math.sin(Math.PI / m.balls) + 1e-9) return `${m.balls} balls of ${+m.ballDiameter.toFixed(3)} do not fit around the ring (at most ${maxBalls(m.pitchRadius, m.ballDiameter)})`;
  }
  return null;
}

/** The most balls of this diameter that fit side by side (touching) on the pitch circle. */
export function maxBalls(pitchRadius: number, ballDiameter: number): number {
  return Math.floor(Math.PI / Math.asin(Math.min(1, ballDiameter / (2 * pitchRadius))) + 1e-9);
}

function bearingModelUnchecked(s: BearingSpec): BearingModel {
  const { bore, od, width } = s;
  const seal: BearingSeal = s.seal ?? '2Z';
  const H = (od - bore) / 2;
  const ring = 0.22 * H, r1 = bore / 2, r2 = r1 + ring, R = od / 2, r3 = R - ring, gap = r3 - r2;
  const chamfer = s.chamfer ?? Math.min(defaultChamfer(H), 0.45 * ring);
  const recess = Math.min(Math.max(0.2, 0.04 * width), width / 4);
  const shieldThickness = seal === '2RS' ? Math.min(Math.max(0.12 * width, 0.4), 0.9) : Math.min(Math.max(0.07 * width, 0.25), 0.5);
  const clearance = seal === '2RS' ? 0.03 : Math.max(0.05, Math.min(0.2, 0.08 * gap));
  const pitchRadius = (r2 + r3) / 2;
  const ballDiameter = seal === 'open' ? (s.ballDiameter ?? Math.min(0.95 * gap, 0.8 * width)) : 0;
  const balls = seal === 'open' ? (s.balls ?? defaultBallCount(pitchRadius, ballDiameter)) : 0;
  return { seal, bore, od, width, r1, r2, r3, R, ring, gap, chamfer, recess, shieldThickness, shieldTip: r2 + clearance, innerCornerChamfer: Math.min(chamfer, 0.8 * recess), balls, ballDiameter, pitchRadius };
}

/** The model of a bearing. Throws an Error with the reason when `bearingProblem` finds one. */
export function bearingModel(s: BearingSpec): BearingModel {
  const why = bearingProblem(s);
  if (why) throw new Error(why);
  return bearingModelUnchecked(s);
}

type Pt = [number, number];
/** Drops repeated neighbours (a zero chamfer leaves two corner points on one spot). */
const dedupe = (pts: Pt[]): Pt[] => pts.filter((p, i) => { const q = pts[(i + pts.length - 1) % pts.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-9; });

/** The section of the inner ring as a closed polygon: a rectangle with the four corners chamfered. x radial, y along the axis. */
export function innerRingProfile(m: BearingModel): Pt[] {
  const { r1, r2, width: B, chamfer: c } = m;
  return dedupe([[r1 + c, 0], [r2 - c, 0], [r2, c], [r2, B - c], [r2 - c, B], [r1 + c, B], [r1, B - c], [r1, c]]);
}

/**
 * The section of the outer ring as a closed polygon. For a shielded or sealed bearing the cover is part of it (the shield is pressed into the outer ring):
 * a flat disc 2Z, or a thicker seal 2RS with a sloping lip, at both faces, recessed from the face and ending a little outside the inner ring.
 */
export function outerRingProfile(m: BearingModel): Pt[] {
  const { r3, R, width: B, chamfer: c } = m;
  if (m.seal === 'open') return dedupe([[r3 + c, 0], [R - c, 0], [R, c], [R, B - c], [R - c, B], [r3 + c, B], [r3, B - c], [r3, c]]);
  const { recess: e, shieldThickness: ts, shieldTip: rt, innerCornerChamfer: cc } = m;
  // one cover, from the face at y = 0 up; the one at the other face is its mirror image (y -> B - y)
  const lip = (r: number, y: number): Pt[] => {
    const L = r3 - rt;
    return m.seal === '2RS'
      ? [[r, y], [rt, y], [rt, y + 0.5 * ts], [rt + 0.3 * L, y + ts], [r, y + ts]]
      : [[r, y], [rt, y], [rt, y + ts], [r, y + ts]];
  };
  const low: Pt[] = [[R - c, 0], [r3 + cc, 0], [r3, cc], ...lip(r3, e)];
  const high: Pt[] = [...low].map(([x, y]): Pt => [x, B - y]).reverse();
  return dedupe([...low, ...high, [R, B - c], [R, c]]);
}

// ---- the housing seat ----

export type SeatFit = 'press' | 'h7' | 'print';
export const SEAT_FITS: readonly SeatFit[] = ['h7', 'press', 'print'];
/** ISO 286 tolerance grade IT7 in micrometres by nominal size range (upper limit of the range in mm). */
const IT7: Array<[number, number]> = [[3, 10], [6, 12], [10, 15], [18, 18], [30, 21], [50, 25], [80, 30], [120, 35], [180, 40], [250, 46]];
export const it7 = (nominal: number): number => (IT7.find(([upTo]) => nominal <= upTo) ?? IT7[IT7.length - 1])[1];

export interface HousingSeat {
  /** the diameter to cut, mm */ diameter: number;
  /** the pocket depth, mm (the bearing width: the bearing sits flush) */ depth: number;
  fit: SeatFit;
  /** what was added to the bearing's outer diameter, mm */ allowance: number;
  /** the tolerance zone of the fit as text, for a drawing note */ note: string;
}

/**
 * The pocket for a bearing's outer ring. 'h7': a housing bore H7 (zone +IT7 / 0 over the outer diameter, ISO 286), cut at the middle of the zone;
 * 'press': the nominal outer diameter (an interference fit in a stiff housing, the hole is left at the bearing size); 'print': 0.2 mm of clearance
 * for a 3D-printed or rough-milled pocket. `allowance` replaces the fit's own addition.
 */
export function housingSeat(o: { od: number; width: number; fit?: SeatFit; allowance?: number }): HousingSeat {
  const fit = o.fit ?? 'h7';
  const tol = it7(o.od) / 1000;
  const allowance = o.allowance ?? (fit === 'h7' ? tol / 2 : fit === 'print' ? 0.2 : 0);
  const round = (v: number): number => Math.round(v * 1000) / 1000;
  const note = o.allowance !== undefined ? `${round(o.od)} + ${round(o.allowance)}`
    : fit === 'h7' ? `${round(o.od)} H7 (+${round(tol)} / 0)` : fit === 'press' ? `${round(o.od)} nominal` : `${round(o.od)} + 0.2 clearance`;
  return { diameter: round(o.od + allowance), depth: o.width, fit, allowance: round(allowance), note };
}
