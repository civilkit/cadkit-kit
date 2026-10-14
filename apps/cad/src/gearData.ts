// The Gear generator: parameters, the readout (pitch / outside / root / base diameter, contact ratio, minimum teeth), the true involute tooth
// profile as sketch geometry (a spline through involute points per flank, circular arcs for tip and root, a tangent root fillet) and the
// feature list (profile sketch, body extrude, hub, bore, keyway) built from a parameter record. Pure functions: the editor and the commands
// turn a record into edit ops; the record itself lives on the profile sketch as `gear` (the kernel keeps unknown fields), so reopening the
// editor regenerates the same features from it. See docs/gears.md.
import type { EditOp } from '@ck/session';

export type GearType = 'spur' | 'internal' | 'helical' | 'rack';
export const GEAR_TYPES: GearType[] = ['spur', 'internal', 'helical', 'rack'];

/** The second gear of a pair: it takes the module, pressure angle, width, shift and backlash from the first, and is placed at the centre distance. */
export interface GearMate { teeth: number; boreDia: number; hubDia: number; hubLength: number }

export interface GearParams {
  type: GearType;
  sizing: 'module' | 'dp';
  /** Normal module in mm. */
  module: number;
  /** Diametral pitch (teeth per inch); the module is 25.4 / dp when sizing is 'dp'. */
  dp: number;
  /** Tooth count (for a rack: the number of teeth along it). */
  teeth: number;
  pressureAngle: number;
  faceWidth: number;
  boreDia: number;
  keyway: boolean;
  /** 0 = by shaft size (DIN 6885). */
  keyWidth: number;
  /** Depth into the hub beyond the bore, 0 = by shaft size. */
  keyDepth: number;
  hubDia: number;
  /** Overall hub length from the front face; 0 = no hub. */
  hubLength: number;
  /** Addendum and dedendum as multiples of the module. */
  addendum: number;
  dedendum: number;
  /** Root fillet radius as a multiple of the module (0 = sharp). */
  rootFillet: number;
  /** Tooth thickness reduction at the pitch circle, in mm: a pair with 0.1 each has 0.2 mm of backlash... see docs. */
  backlash: number;
  /** Profile shift coefficient x (thickens the tooth by 2 x m tan(alpha), raises the addendum by x m). */
  shift: number;
  helixAngle: number;
  hand: 'right' | 'left';
  /** Ring gear: radial thickness of the rim beyond the tooth roots in mm, 0 = 2.5 m. */
  rimThickness: number;
  center: [number, number];
  /** Rotation of the whole profile about its centre, degrees. */
  phase: number;
  plane: { kind: string; id: string };
  mate?: GearMate;
}

export const DEFAULT_GEAR: GearParams = {
  type: 'spur', sizing: 'module', module: 2, dp: 12.7, teeth: 20, pressureAngle: 20, faceWidth: 10,
  boreDia: 8, keyway: false, keyWidth: 0, keyDepth: 0, hubDia: 0, hubLength: 0,
  addendum: 1, dedendum: 1.25, rootFillet: 0.3, backlash: 0, shift: 0, helixAngle: 15, hand: 'right', rimThickness: 0,
  center: [0, 0], phase: 0, plane: { kind: 'std', id: 'top' },
};

const rad = (d: number): number => (d * Math.PI) / 180;
const inv = (a: number): number => Math.tan(a) - a;
export const gearModule = (p: Pick<GearParams, 'sizing' | 'module' | 'dp'>): number => (p.sizing === 'dp' ? 25.4 / Math.max(p.dp, 0.01) : p.module);

/** Everything derived from the parameters (transverse values for helical gears). */
export interface GearGeom {
  mn: number; mt: number; beta: number; alphaN: number; alphaT: number;
  z: number; r: number; rb: number; ra: number; rf: number;
  /** Tooth thickness at the pitch circle (transverse, after shift and backlash). For an internal gear the width of the gap. */
  s: number;
  /** Total twist over the face width, degrees (helical only), signed by hand. */
  twist: number;
  pitch: number;
}
export function gearGeom(p: GearParams): GearGeom {
  const mn = gearModule(p);
  const beta = p.type === 'helical' ? rad(p.helixAngle) : 0;
  const alphaN = rad(p.pressureAngle);
  const alphaT = Math.atan(Math.tan(alphaN) / Math.cos(beta));
  const mt = mn / Math.cos(beta);
  const z = Math.max(1, Math.round(p.teeth));
  const r = (mt * z) / 2;
  const rb = r * Math.cos(alphaT);
  const x = p.shift;
  const s0 = mt * (Math.PI / 2 + 2 * x * Math.tan(alphaN));
  const jt = p.backlash / 2 / Math.cos(beta);
  const internal = p.type === 'internal';
  const s = internal ? s0 + jt : s0 - jt;
  const ra = internal ? r - (p.addendum - x) * mn : r + (p.addendum + x) * mn;
  const rf = internal ? r + (p.dedendum + x) * mn : r - (p.dedendum - x) * mn;
  const twist = p.type === 'helical' ? ((p.faceWidth * Math.tan(beta)) / r) * (180 / Math.PI) * (p.hand === 'left' ? -1 : 1) : 0;
  return { mn, mt, beta, alphaN, alphaT, z, r, rb, ra, rf, s, twist, pitch: Math.PI * mt };
}

/** Centre distance of a pair (transverse module). */
export const centreDistance = (p: GearParams): number => (p.mate ? (gearGeom(p).mt * (Math.round(p.teeth) + Math.round(p.mate.teeth))) / 2 : 0);

export interface GearReadout {
  pitchDia: number; outsideDia: number; rootDia: number; baseDia: number;
  /** Transverse contact ratio against a gear of `mateTeeth` (default the same tooth count), and the total including the overlap of helical teeth. */
  contactRatio: number; totalContactRatio: number;
  minTeeth: number;
  undercut: boolean;
  /** Smallest profile shift that avoids undercut at this tooth count (0 when none is needed). */
  minShift: number;
  warnings: string[];
}
export function gearReadout(p: GearParams): GearReadout {
  const g = gearGeom(p);
  const sin2 = Math.sin(g.alphaT) ** 2;
  const minTeeth = Math.ceil((2 * p.addendum * Math.cos(g.beta)) / sin2 - 1e-9);
  const zEff = p.type === 'rack' ? Infinity : g.z;
  const undercut = p.type !== 'internal' && p.type !== 'rack' && g.z < minTeeth && p.shift < p.addendum * (minTeeth - g.z) / minTeeth - 1e-9;
  const minShift = p.type === 'internal' || p.type === 'rack' || zEff >= minTeeth ? 0 : Math.ceil((p.addendum * (minTeeth - g.z) / minTeeth) * 1000 - 1e-9) / 1000;
  const z2 = p.mate ? Math.round(p.mate.teeth) : g.z;
  const r2 = (g.mt * z2) / 2, rb2 = r2 * Math.cos(g.alphaT), ra2 = r2 + (p.addendum + p.shift) * g.mn;
  let eps = 0;
  if (p.type === 'internal') {
    // internal pair with a pinion of the same module: use the standard closed form against a pinion of z/2 teeth
    const zp = Math.max(8, Math.round(g.z / 2)), rp = (g.mt * zp) / 2, rbp = rp * Math.cos(g.alphaT), rap = rp + (p.addendum + p.shift) * g.mn;
    const a = g.r - rp;
    eps = (Math.sqrt(Math.max(0, rap * rap - rbp * rbp)) - Math.sqrt(Math.max(0, g.ra * g.ra - g.rb * g.rb)) + a * Math.sin(g.alphaT)) / (Math.PI * g.mt * Math.cos(g.alphaT));
  } else if (p.type === 'rack') {
    eps = (Math.sqrt(Math.max(0, ra2 * ra2 - rb2 * rb2)) - r2 * Math.sin(g.alphaT) + ((p.addendum + p.shift) * g.mn) / Math.sin(g.alphaT)) / (Math.PI * g.mt * Math.cos(g.alphaT));
  } else {
    const a = g.r + r2;
    eps = (Math.sqrt(Math.max(0, g.ra * g.ra - g.rb * g.rb)) + Math.sqrt(Math.max(0, ra2 * ra2 - rb2 * rb2)) - a * Math.sin(g.alphaT)) / (Math.PI * g.mt * Math.cos(g.alphaT));
  }
  const epsBeta = p.type === 'helical' ? (p.faceWidth * Math.sin(g.beta)) / (Math.PI * g.mn) : 0;
  const warnings: string[] = [];
  if (undercut) warnings.push('undercut');
  const o = outline(p);
  warnings.push(...o.warnings);
  return {
    pitchDia: 2 * g.r, outsideDia: 2 * Math.max(g.ra, g.rf), rootDia: 2 * Math.min(g.ra, g.rf), baseDia: 2 * g.rb,
    contactRatio: Math.max(0, eps), totalContactRatio: Math.max(0, eps) + epsBeta, minTeeth, undercut, minShift, warnings,
  };
}

// ---- profile geometry ----

export interface Pt { id: string; x: number; y: number }
export interface Ent { type: string; id: string; [k: string]: unknown }
export interface Outline { points: Pt[]; entities: Ent[]; warnings: string[] }

/** Builds points / entities with fresh ids. */
class Draw {
  points: Pt[] = [];
  entities: Ent[] = [];
  private cx: number; private cy: number; private cs: number; private sn: number;
  constructor(center: [number, number], phaseDeg: number) { this.cx = center[0]; this.cy = center[1]; this.cs = Math.cos(rad(phaseDeg)); this.sn = Math.sin(rad(phaseDeg)); }
  /** A point at polar (rho, angle) about the gear centre, rotated by the phase. */
  polar(rho: number, ang: number): string { return this.xy(rho * Math.cos(ang), rho * Math.sin(ang)); }
  xy(x: number, y: number): string {
    const id = 'p' + (this.points.length + 1);
    this.points.push({ id, x: round(this.cx + x * this.cs - y * this.sn), y: round(this.cy + x * this.sn + y * this.cs) });
    return id;
  }
  ent(type: string, extra: Record<string, unknown>): void { this.entities.push({ type, id: 'e' + (this.entities.length + 1), ...extra }); }
}
const round = (v: number): number => Math.round(v * 1e9) / 1e9;

interface Flank { rho: number; ang: number }
/** One flank of a tooth centred on angle 0 (the flank at +angle), as polar points from the root side to the tip. `smooth`: the first point is where a
 *  fillet leaves the root circle tangentially, so the root arc continues the same smooth curve; otherwise there is a corner at the root. */
interface FlankPlan { pts: Flank[]; smooth: boolean }

const arcPts = (cx: number, cy: number, rad0: number, a1: number, da: number, k: number): Flank[] => {
  const out: Flank[] = [];
  for (let i = 0; i < k; i++) {
    const a = a1 + (da * i) / k;
    const px = cx + rad0 * Math.cos(a), py = cy + rad0 * Math.sin(a);
    out.push({ rho: Math.hypot(px, py), ang: Math.atan2(py, px) });
  }
  return out;
};

function flankPlan(g: { r: number; rb: number; alphaT: number; s: number }, rIn: number, rOut: number, fillet: number, nFlank: number): FlankPlan {
  const { r, rb, alphaT, s } = g;
  const c0 = s / (2 * r) + inv(alphaT);
  const tOf = (rho: number): number => Math.sqrt(Math.max(0, (rho / rb) ** 2 - 1));
  const ang = (t: number): number => c0 - (t - Math.atan(t));
  const rhoOf = (t: number): number => rb * Math.sqrt(1 + t * t);
  const t0 = rIn > rb ? tOf(rIn) : 0;
  const t1 = tOf(rOut);
  const lead: Flank[] = [];
  let tStart = t0;
  let smooth = false;
  const pos = (t: number): [number, number] => { const a = ang(t), rho = rhoOf(t); return [rho * Math.cos(a), rho * Math.sin(a)]; };
  if (fillet > 0 && rIn > 0 && rIn >= rb) {
    // centre of the fillet circle: on the flank offset by the radius into the gap, at distance rIn + fillet from the gear centre
    const norm = (t: number): [number, number] => {
      const h = 1e-5, [x1, y1] = pos(t + h), [x0, y0] = pos(Math.max(0, t - h));
      const tx = x1 - x0, ty = y1 - y0, l = Math.hypot(tx, ty);
      return [-ty / l, tx / l];
    };
    for (let tries = 0, rf = fillet; tries < 6 && !smooth; tries++, rf /= 2) {
      const f = (t: number): number => { const [x, y] = pos(t), [nx, ny] = norm(t); return Math.hypot(x + rf * nx, y + rf * ny) - (rIn + rf); };
      let lo = t0, hi = Math.min(t1, t0 + 2.5);
      if (f(lo) * f(hi) > 0) continue;
      for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (f(lo) * f(mid) <= 0) hi = mid; else lo = mid; }
      const ts = (lo + hi) / 2;
      const [x, y] = pos(ts), [nx, ny] = norm(ts);
      const cx = x + rf * nx, cy = y + rf * ny;
      const a1 = Math.atan2(-cy, -cx), a2 = Math.atan2(-ny, -nx);
      let da = a2 - a1;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      if (Math.abs(da) > 2.2 || ts >= t1 - 1e-6) continue;
      lead.push(...arcPts(cx, cy, rf, a1, da, 4));
      tStart = ts;
      smooth = true;
    }
  } else if (fillet > 0 && rIn > 0) {
    // the involute starts at the base circle above the root circle: a radial line joins them, the fillet is tangent to that line and the root circle
    const rho = Math.min(fillet, (rb * rb - rIn * rIn) / (2 * rIn));
    if (rho >= 0.02 * fillet && rho > 1e-3) {
      const Rc = rIn + rho;
      const cAng = c0 + Math.asin(rho / Rc);
      const cx = Rc * Math.cos(cAng), cy = Rc * Math.sin(cAng);
      const a1 = cAng + Math.PI;                       // from the centre towards the gear centre: the root tangent point
      const a2 = c0 - Math.PI / 2;                     // from the centre perpendicular to the radial line: its tangent point
      let da = a2 - a1;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      lead.push(...arcPts(cx, cy, rho, a1, da, 4));
      smooth = true;
    }
  }
  const pts: Flank[] = [...lead];
  if (!smooth && rIn < rb - 1e-9) pts.push({ rho: rIn, ang: c0 });   // corner at the root; the radial piece is the first span of the spline
  for (let i = 0; i <= nFlank; i++) {
    const t = tStart + ((t1 - tStart) * i) / nFlank;
    pts.push({ rho: rhoOf(t), ang: ang(t) });
  }
  // drop points that coincide with the previous one
  const clean = pts.filter((q, i) => i === 0 || Math.hypot(q.rho * Math.cos(q.ang) - pts[i - 1].rho * Math.cos(pts[i - 1].ang), q.rho * Math.sin(q.ang) - pts[i - 1].rho * Math.sin(pts[i - 1].ang)) > 1e-6);
  return { pts: clean, smooth };
}

/** The closed outline of a gear (spur / helical / ring) or the polygon of a rack in sketch coordinates. One tip arc and one spline per tooth: the spline
 *  runs down the flank, through the fillet and the root and up the next flank (a corner at the root splits it in two with a root arc between). */
export function outline(p: GearParams): Outline {
  const warnings: string[] = [];
  if (p.type === 'rack') return rackOutline(p);
  const g = gearGeom(p);
  const internal = p.type === 'internal';
  const z = g.z;
  const tau = (2 * Math.PI) / z;
  const d = new Draw(p.center, p.phase);
  // the tooth shape (or the gap shape of a ring) runs between rIn and rOut
  let rIn = internal ? g.ra : g.rf, rOut = internal ? g.rf : g.ra;
  if (internal && rIn < g.rb * 1.002) { warnings.push('ringTip'); rIn = g.rb * 1.002; }
  const c0 = g.s / (2 * g.r) + inv(g.alphaT);
  const half = (rho: number): number => { const t = Math.sqrt(Math.max(0, (rho / g.rb) ** 2 - 1)); return c0 - (t - Math.atan(t)); };
  // a tooth must keep a land at the outer circle: lower the outer radius where it would be pointed
  const minHalf = (0.04 * g.mn) / Math.max(rOut, 1e-6);
  if (half(rOut) < minHalf) {
    let lo = Math.max(rIn, g.rb), hi = rOut;
    if (half(lo) < minHalf) warnings.push('pointed');
    else { for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (half(mid) >= minHalf) lo = mid; else hi = mid; } warnings.push('tipClamped'); rOut = lo; }
  }
  if (!internal) rIn = Math.max(rIn, 0.05);
  if (!(half(Math.max(rIn, g.rb)) < tau / 2 - 0.002)) warnings.push('tight');
  const nFlank = z > 60 ? 5 : z > 36 ? 6 : 8;
  const plan = flankPlan(g, rIn, rOut, internal ? 0 : p.rootFillet * g.mn, nFlank);
  const cId = d.xy(0, 0);
  // points of every tooth: lower flank (root to tip) and upper flank (root to tip)
  const low: string[][] = [], up: string[][] = [];
  for (let k = 0; k < z; k++) {
    const phi = k * tau;
    low.push(plan.pts.map((q) => d.polar(q.rho, phi - q.ang)));
    up.push(plan.pts.map((q) => d.polar(q.rho, phi + q.ang)));
  }
  const rootA = plan.pts[0].ang;
  const rootArc = tau - 2 * rootA;   // the angle of the root arc between an upper root point and the next lower one
  for (let k = 0; k < z; k++) {
    const n = (k + 1) % z;
    const tipLow = low[k][low[k].length - 1], tipUp = up[k][up[k].length - 1];
    d.ent('arc', { c: cId, p1: tipLow, p2: tipUp });
    if (plan.smooth) {
      // the gap: down the upper flank of tooth k, along the root circle, up the lower flank of tooth n
      const mids: string[] = [];
      const len = rootArc * plan.pts[0].rho;
      const cnt = Math.max(0, Math.min(6, Math.ceil(len / (0.45 * g.mn)) - 1));
      for (let i = 1; i <= cnt; i++) mids.push(d.polar(plan.pts[0].rho, k * tau + rootA + (rootArc * i) / (cnt + 1)));
      d.ent('spline', { pts: [...up[k]].reverse().concat(mids, low[n]) });
    } else {
      d.ent('spline', { pts: [...up[k]].reverse() });
      if (rootArc > 1e-6) d.ent('arc', { c: cId, p1: up[k][0], p2: low[n][0] });
      d.ent('spline', { pts: low[n] });
    }
  }
  return { points: d.points, entities: d.entities, warnings };
}

function rackOutline(p: GearParams): Outline {
  const g = gearGeom(p);
  const warnings: string[] = [];
  const n = Math.max(1, Math.round(p.teeth));
  const pitch = g.pitch;
  const d = new Draw(p.center, p.phase);
  const ha = (p.addendum + p.shift) * g.mn, hf = (p.dedendum - p.shift) * g.mn;
  const t = Math.tan(g.alphaT);
  const sTooth = g.s;   // at the pitch line
  const base = -(hf + Math.max(g.mn * 1.5, 3));
  const ids: string[] = [];
  const push = (x: number, y: number): void => { ids.push(d.xy(x, y)); };
  push(0, base);
  push(n * pitch, base);
  push(n * pitch, -hf);
  for (let k = n - 1; k >= 0; k--) {
    const cx = (k + 0.5) * pitch;
    const wRoot = sTooth / 2 + hf * t, wTip = sTooth / 2 - ha * t;
    if (wTip < 0.02 * g.mn) warnings.push('pointed');
    push(cx + wRoot, -hf);
    push(cx + Math.max(wTip, 0.01), ha);
    push(cx - Math.max(wTip, 0.01), ha);
    push(cx - wRoot, -hf);
  }
  push(0, -hf);
  for (let i = 0; i < ids.length; i++) d.ent('line', { p1: ids[i], p2: ids[(i + 1) % ids.length] });
  return { points: d.points, entities: d.entities, warnings };
}

// ---- keyway sizes (DIN 6885 form A: shaft range, width b, depth into the hub t2) ----
const KEYS: Array<[number, number, number]> = [[8, 2, 1.0], [10, 3, 1.4], [12, 4, 1.8], [17, 5, 2.3], [22, 6, 2.8], [30, 8, 3.3], [38, 10, 3.3], [44, 12, 3.3], [50, 14, 3.8], [58, 16, 4.3], [65, 18, 4.4], [75, 20, 4.9], [85, 22, 5.4], [95, 25, 5.4], [110, 28, 6.4]];
export function keySize(boreDia: number): { width: number; depth: number } {
  const row = KEYS.find((k) => boreDia <= k[0]) ?? KEYS[KEYS.length - 1];
  return { width: row[1], depth: row[2] };
}

// ---- features ----

type Feat = { id: string; type: string; [k: string]: unknown };
export type Role = 'profile' | 'body' | 'hubSketch' | 'hub' | 'boreSketch' | 'bore' | 'keySketch' | 'key';
export const ROLES: Role[] = ['profile', 'body', 'hubSketch', 'hub', 'boreSketch', 'bore', 'keySketch', 'key'];
const MATE = 'm.';
/** The roles the parameters need, in feature order: the first gear's, then the second gear's (prefixed 'm.'). */
export function rolesFor(p: GearParams): string[] {
  const one = (q: { type: GearType; hubDia: number; hubLength: number; boreDia: number; keyway: boolean }): Role[] => {
    const out: Role[] = ['profile', 'body'];
    const solid = q.type !== 'rack' && q.type !== 'internal';   // a rack has no axis, a ring is empty in the middle
    if (solid && q.hubLength > 0 && q.hubDia > 0) out.push('hubSketch', 'hub');
    if (solid && q.boreDia > 0) { out.push('boreSketch', 'bore'); if (q.keyway) out.push('keySketch', 'key'); }
    return out;
  };
  const roles: string[] = one(p);
  if (p.mate && p.type !== 'rack' && p.type !== 'internal') roles.push(...one({ type: p.type, hubDia: p.mate.hubDia, hubLength: p.mate.hubLength, boreDia: p.mate.boreDia, keyway: p.keyway }).map((r) => MATE + r));
  return roles;
}

/** The second gear of a pair as a plain gear: placed at the centre distance along +x of the first, turned so its teeth meet the first's gaps, opposite hand when helical. */
export function mateParams(p: GearParams): GearParams {
  const m = p.mate!;
  const g = gearGeom(p);
  const z2 = Math.round(m.teeth);
  const a = centreDistance(p);
  const ph = (180 + 180 / z2) % (360 / z2);
  const turn = p.phase;   // the pair turns as a whole
  const c = rad(turn);
  const off: [number, number] = [a * Math.cos(c), a * Math.sin(c)];
  void g;
  return { ...p, teeth: z2, boreDia: m.boreDia, hubDia: m.hubDia, hubLength: m.hubLength, center: [p.center[0] + off[0], p.center[1] + off[1]], phase: turn + ph, hand: p.hand === 'left' ? 'right' : 'left', mate: undefined };
}

const planeOf = (p: GearParams): { kind: string; id: string } => p.plane;

/** The features of ONE gear (no mate), by role. */
function oneGear(p: GearParams, ids: Record<string, string>, pre: string, record: unknown | null): Feat[] {
  const roles = rolesFor({ ...p, mate: undefined });
  const label = `${p.type === 'rack' ? 'Rack' : p.type === 'internal' ? 'Ring gear' : p.type === 'helical' ? 'Helical gear' : 'Gear'} ${Math.round(p.teeth)}T`;
  const id = (r: string): string => ids[pre + r];
  const out: Feat[] = [];
  const g = gearGeom(p);
  const plane = planeOf(p);
  const o = outline(p);
  const [cx, cy] = p.center;
  const circle = (sid: string, dia: number, name: string): Feat => ({ type: 'sketch', id: sid, name, plane, points: [{ id: 'p1', x: round(cx), y: round(cy) }], entities: [{ type: 'circle', id: 'e1', c: 'p1', r: round(dia / 2) }], constraints: [] });
  for (const r of roles) {
    switch (r) {
      case 'profile': {
        const ents = [...o.entities];
        const points = [...o.points];
        if (p.type === 'internal') {
          const rim = g.rf + (p.rimThickness > 0 ? p.rimThickness : 2.5 * g.mn);
          const c = 'p' + (points.length + 1);
          points.push({ id: c, x: round(cx), y: round(cy) });
          ents.push({ type: 'circle', id: 'e' + (ents.length + 1), c, r: round(rim) });
        }
        const f: Feat = { type: 'sketch', id: id('profile'), name: `${label} profile`, plane, points, entities: ents, constraints: [] };
        if (record) f.gear = record;
        out.push(f);
        break;
      }
      case 'body': {
        const f: Feat = { type: 'extrude', id: id('body'), name: label, op: 'add', sketch: id('profile'), end: 'blind', depth: p.faceWidth };
        if (g.twist) { f.twist = round(g.twist); f.twistCentre = [round(cx), round(cy)]; }
        out.push(f);
        break;
      }
      case 'hubSketch': out.push(circle(id('hubSketch'), p.hubDia, `${label} hub sketch`)); break;
      case 'hub': out.push({ type: 'extrude', id: id('hub'), name: `${label} hub`, op: 'add', sketch: id('hubSketch'), end: 'blind', depth: p.hubLength }); break;
      case 'boreSketch': out.push(circle(id('boreSketch'), p.boreDia, `${label} bore sketch`)); break;
      case 'bore': out.push({ type: 'extrude', id: id('bore'), name: `${label} bore`, op: 'cut', sketch: id('boreSketch'), end: 'throughBoth', depth: 10 }); break;
      case 'keySketch': {
        const k = keySize(p.boreDia);
        const w = p.keyWidth > 0 ? p.keyWidth : k.width, t2 = p.keyDepth > 0 ? p.keyDepth : k.depth;
        const rb = p.boreDia / 2, y0 = rb - w / 2 * 0.5, y1 = rb + t2;
        const pts = [[-w / 2, y0], [w / 2, y0], [w / 2, y1], [-w / 2, y1]].map(([x, y], i) => ({ id: 'p' + (i + 1), x: round(cx + x), y: round(cy + y) }));
        out.push({ type: 'sketch', id: id('keySketch'), name: `${label} keyway sketch`, plane, points: pts, entities: [[1, 2], [2, 3], [3, 4], [4, 1]].map(([a, b], i) => ({ type: 'line', id: 'e' + (i + 1), p1: 'p' + a, p2: 'p' + b })), constraints: [] });
        break;
      }
      case 'key': out.push({ type: 'extrude', id: id('key'), name: `${label} keyway`, op: 'cut', sketch: id('keySketch'), end: 'throughBoth', depth: 10 }); break;
    }
  }
  return out;
}

/** All features of a gear (and its mate) with the given ids by role. The profile sketch carries the parameter record and the role map. */
export function gearFeatures(p: GearParams, ids: Record<string, string>): Feat[] {
  // ids are kept as numbers: the kernel refuses to remove a feature whose id appears as a string in another feature
  const record = { ...stripPlane(p), roles: Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, Number(v.slice(1))])) };
  const first = oneGear(p, ids, '', record);
  if (!p.mate || p.type === 'rack' || p.type === 'internal') return first;
  return [...first, ...oneGear(mateParams(p), ids, MATE, null)];
}
const stripPlane = (p: GearParams): GearParams => ({ ...p, center: [...p.center] as [number, number], plane: { ...p.plane } });

/** Reads a gear record off a feature (the parameters with defaults filled in, and the role map), or null. */
export function readGear(f: unknown): { params: GearParams; roles: Record<string, string> } | null {
  const rec = (f as { gear?: Record<string, unknown> } | null)?.gear;
  if (!rec || typeof rec !== 'object') return null;
  const { roles, ...rest } = rec as { roles?: Record<string, number | string> } & Partial<GearParams>;
  const params: GearParams = { ...DEFAULT_GEAR, ...rest, center: (rest.center as [number, number] | undefined) ?? [0, 0], plane: rest.plane ?? DEFAULT_GEAR.plane };
  if (rest.mate) params.mate = { ...rest.mate };
  return { params, roles: Object.fromEntries(Object.entries((roles ?? {}) as Record<string, number | string>).map(([k, v]) => [k, typeof v === 'number' ? `F${v}` : v])) };
}

/** The gear that owns this feature id (the profile sketch's id and its roles), or null. */
export function gearOwner(features: unknown[], id: string): { profileId: string; params: GearParams; roles: Record<string, string> } | null {
  for (const f of features as Array<{ id: string }>) {
    const g = readGear(f);
    if (g && Object.values(g.roles).includes(id)) return { profileId: f.id, params: g.params, roles: g.roles };
  }
  return null;
}

/** The highest numeric id suffix used, so new ids do not collide. */
function nextSeq(doc: { features: Array<{ id?: string }>; seq?: number }): number {
  let n = doc.seq ?? 1;
  for (const f of doc.features) { const m = /^F(\d+)$/.exec(String(f.id ?? '')); if (m) n = Math.max(n, Number(m[1]) + 1); }
  return n;
}

/** Ops that create (no `existing`) or regenerate a gear from its parameters: one edit, so one undo step. Features keep their ids across edits; roles that
 *  appear are added right after the previous role, roles that vanish are removed (dependents first). */
export function gearOps(doc: { features: Array<{ id?: string; type?: string }>; seq?: number }, p: GearParams, existing?: Record<string, string>): EditOp[] {
  const wanted = rolesFor(p);
  let seq = nextSeq(doc as never);
  const ids: Record<string, string> = {};
  for (const r of wanted) ids[r] = existing?.[r] ?? `F${seq++}`;
  const feats = gearFeatures(p, ids);
  const ops: EditOp[] = [];
  const list = doc.features.map((f) => f.id as string);
  if (existing) {
    // a sketch goes with the extrude that uses it (cascade): only the sketch of such a pair is removed
    const gone = Object.keys(existing).filter((r) => !wanted.includes(r));
    for (const r of gone.reverse()) {
      const sketchGone = gone.includes(r + 'Sketch');   // the extrude of a removed sketch goes with it
      if (!sketchGone) ops.push({ op: 'remove', id: existing[r], cascade: true });
      list.splice(list.indexOf(existing[r]), 1);
    }
  }
  let last = existing && ids.profile ? list.indexOf(existing.profile) - 1 : list.length - 1;
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
  // the profile's record names every role id, so it must be replaced before the features it no longer names are removed
  const at = ops.findIndex((o) => o.op === 'replace' && (o as { id?: string }).id === ids.profile);
  if (at > 0) ops.unshift(ops.splice(at, 1)[0]);
  return ops;
}

/** The default pair: 20 and 40 teeth, module 2, a little backlash so the flanks do not touch. */
export function defaultPair(base: Partial<GearParams> = {}): GearParams {
  const p: GearParams = { ...DEFAULT_GEAR, ...base };
  const mn = gearModule(p);
  return { ...p, teeth: base.teeth ?? 20, backlash: base.backlash ?? Math.round(0.06 * mn * 1000) / 1000, mate: base.mate ?? { teeth: 40, boreDia: 10, hubDia: 0, hubLength: 0 } };
}
