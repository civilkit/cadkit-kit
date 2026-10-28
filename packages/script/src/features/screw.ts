// Screws and bolts: a head (pan, button, countersunk, cheese, external hex) with a drive cut into it (slotted, hex socket, cross, Torx, none)
// on a plain shank, placed by an origin and an axis. Mixed into PartBuilder by features/index.ts.
//
// Built only from features the kernel already has: one revolve of the head-and-shank profile as a new body (the hex head is a hex extrude on a
// revolved shank), then one extrude cut for the drive. Sizes come from a small ISO table (rounded nominal values of ISO 1580 / 7380 / 10642 / 1207 /
// 4017, drive sizes of ISO 4762 / ISO 10664); every value can be overridden.
//
// APPROXIMATIONS, deliberately: the CROSS (Phillips) drive is two crossed tapered arms (the bit tip as a tool: one thin profile with a blunt flat tip, copied at 90 degrees and subtracted), not the real wing
// profile; the TORX drive is a six-lobed outline of 12 true tangent arcs between the ISO 10664 tip (A) and valley (B) diameters, with lobe radii chosen
// for tangency rather than taken from the standard. Both fit the right socket loosely and are meant for looks, fit checks and mass, not for toleranced drives.
import type { Num, OffsetPlane, PartBuilder, SketchBuilder } from '../recorder';
import type { PlaneBase } from '../planes';
import { H } from './h';

type Pt = [number, number];
export type V3 = [number, number, number];

export type ScrewHead = 'pan' | 'button' | 'countersunk' | 'cheese' | 'hex';
export type ScrewDrive = 'none' | 'slotted' | 'hex' | 'cross' | 'torx';
const HEADS: ScrewHead[] = ['pan', 'button', 'countersunk', 'cheese', 'hex'];
const DRIVES: ScrewDrive[] = ['none', 'slotted', 'hex', 'cross', 'torx'];

interface Dome { /** head diameter */ dk: number; /** head height */ k: number; /** fraction of the head height that is dome, the rest is a straight wall */ rise: number }
interface Flat { dk: number; k: number }
export interface ScrewSize {
  /** nominal (major) diameter */ d: number;
  /** coarse pitch */ pitch: number;
  pan: Dome; button: Dome; countersunk: Flat; cheese: Flat;
  /** external hex head: dk is the width across flats */ hex: Flat;
  /** hex socket width across flats */ socket: number;
  /** slot width */ slot: number;
  /** overall span of the cross (Phillips) drive */ cross: number;
  /** Torx: tip diameter A and valley diameter B (ISO 10664) */ torx: { A: number; B: number };
}
/** Rounded nominal head dimensions of the metric sizes M2 to M8. */
export const SCREW_SIZES = {
  M2:   { d: 2,   pitch: 0.4,  pan: { dk: 4.0,  k: 1.6, rise: 0.25 }, button: { dk: 3.8,  k: 1.3,  rise: 0.8 }, countersunk: { dk: 3.8,  k: 1.2 },  cheese: { dk: 3.8, k: 1.3 }, hex: { dk: 4,  k: 1.4 }, socket: 1.5, slot: 0.5, cross: 1.8, torx: { A: 1.75, B: 1.27 } },
  'M2.5': { d: 2.5, pitch: 0.45, pan: { dk: 5.0,  k: 2.0, rise: 0.25 }, button: { dk: 4.6,  k: 1.5,  rise: 0.8 }, countersunk: { dk: 5.0,  k: 1.5 },  cheese: { dk: 4.5, k: 1.7 }, hex: { dk: 5,  k: 1.7 }, socket: 2,   slot: 0.6, cross: 2.4, torx: { A: 2.4,  B: 1.75 } },
  M3:   { d: 3,   pitch: 0.5,  pan: { dk: 5.6,  k: 1.8, rise: 0.25 }, button: { dk: 5.7,  k: 1.65, rise: 0.8 }, countersunk: { dk: 6.72, k: 1.86 }, cheese: { dk: 5.5, k: 2.0 }, hex: { dk: 5.5, k: 2.0 }, socket: 2,  slot: 0.8, cross: 3.0, torx: { A: 2.8,  B: 2.05 } },
  M4:   { d: 4,   pitch: 0.7,  pan: { dk: 8.0,  k: 2.4, rise: 0.25 }, button: { dk: 7.6,  k: 2.2,  rise: 0.8 }, countersunk: { dk: 8.96, k: 2.48 }, cheese: { dk: 7.0, k: 2.6 }, hex: { dk: 7,  k: 2.8 }, socket: 2.5, slot: 1.2, cross: 4.0, torx: { A: 3.86, B: 2.75 } },
  M5:   { d: 5,   pitch: 0.8,  pan: { dk: 9.5,  k: 3.0, rise: 0.25 }, button: { dk: 9.5,  k: 2.75, rise: 0.8 }, countersunk: { dk: 11.2, k: 3.1 },  cheese: { dk: 8.5, k: 3.3 }, hex: { dk: 8,  k: 3.5 }, socket: 3,   slot: 1.2, cross: 5.0, torx: { A: 4.43, B: 3.17 } },
  M6:   { d: 6,   pitch: 1,    pan: { dk: 12,   k: 3.6, rise: 0.25 }, button: { dk: 10.5, k: 3.3,  rise: 0.8 }, countersunk: { dk: 13.44, k: 3.72 }, cheese: { dk: 10, k: 3.9 },  hex: { dk: 10, k: 4.0 }, socket: 4,   slot: 1.6, cross: 6.2, torx: { A: 4.99, B: 3.6 } },
  M8:   { d: 8,   pitch: 1.25, pan: { dk: 16,   k: 4.8, rise: 0.25 }, button: { dk: 14,   k: 4.4,  rise: 0.8 }, countersunk: { dk: 17.92, k: 4.96 }, cheese: { dk: 13, k: 5.0 },  hex: { dk: 13, k: 5.3 }, socket: 5,   slot: 2,   cross: 8.0, torx: { A: 6.2,  B: 4.5 } },
} satisfies Record<string, ScrewSize>;

export interface ScrewOpts {
  /** metric size designation: M2, M2.5, M3, M4, M5, M6 or M8 (fills in every dimension below) */
  size: keyof typeof SCREW_SIZES | string;
  /** shank length in mm, measured from the bearing face to the tip (a countersunk screw: from the flat top, the head included) */
  length: Num;
  /** 'pan' | 'button' | 'countersunk' | 'cheese' | 'hex' (default 'pan') */
  head?: ScrewHead;
  /** 'slotted' | 'hex' | 'cross' | 'torx' | 'none'; default 'cross' for pan, 'hex' for button, countersunk and cheese; a hex head takes none */
  drive?: ScrewDrive;
  /** where the screw sits: the centre of the bearing face (the underside of the head; the flat top of a countersunk head), default [0, 0, 0] */
  origin?: [Num, Num, Num];
  /** the direction the shank points, default [0, 0, -1] (head up, shank down); any non-zero vector */
  axis?: [Num, Num, Num];
  /** not available yet: true is refused (the shank is a plain cylinder) */
  thread?: boolean;
  /** overrides of the table values */
  diameter?: Num; headDiameter?: Num; headHeight?: Num;
  /** hex socket: width across flats; slotted: slot width; cross: span of the cross; torx: tip diameter A */
  driveSize?: Num;
  /** depth of the drive below the top of the head */
  driveDepth?: Num;
}

// ---- Torx outline: 12 tangent arcs ----
export interface OutlineArc { centre: Pt; radius: number; from: Pt; to: Pt; /** true for a lobe (counter-clockwise about its centre), false for a valley */ ccw: boolean }
/**
 * The outline of a six-lobed (Torx) drive with tip diameter A and valley diameter B, counter-clockwise: for each lobe, a convex arc of radius
 * 0.09 A about a centre on the lobe's axis, then a concave arc about a centre beyond the valley, tangent to both neighbours. Real Torx lobe radii
 * differ a little (ISO 10664 gives them by size); this keeps the standard A and B and is tangent everywhere.
 */
export function torxOutline(A: number, B: number): OutlineArc[] {
  const Ao = A / 2, Bo = B / 2, rl = 0.09 * A, cl = Ao - rl, c30 = Math.cos(Math.PI / 6);
  const rv = (rl * rl - cl * cl - Bo * Bo + 2 * cl * Bo * c30) / (2 * (Bo - cl * c30 - rl));
  const cv = Bo + rv;
  const at = (r: number, deg: number): Pt => [r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180)];
  const arcs: OutlineArc[] = [];
  for (let k = 0; k < 6; k++) {
    const th = 60 * k;
    const Pl = at(cl, th), Pvp = at(cv, th + 30), Pvm = at(cv, th - 30);
    const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const t = rl / (rl + rv);
    const Tm = lerp(Pl, Pvm, t), Tp = lerp(Pl, Pvp, t);
    arcs.push({ centre: Pl, radius: rl, from: Tm, to: Tp, ccw: true });
    // the valley between this lobe and the next one, tangent to the next lobe's circle at Tn
    const Pln = at(cl, th + 60);
    const Tn = lerp(Pln, Pvp, t);
    arcs.push({ centre: Pvp, radius: rv, from: Tp, to: Tn, ccw: false });
  }
  return arcs;
}

// ---- geometry helpers ----
export const norm = (v: V3): V3 => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; };
export const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot3 = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

type Priv = { pt(x: number, y: number): string; ent(e: Record<string, unknown>): void };
/** Draws a closed profile whose segments share their end points (a point is reused by position). */
export class Pen {
  private ids = new Map<string, string>();
  private s: Priv;
  constructor(s: SketchBuilder) { this.s = s as unknown as Priv; }
  private id(p: Pt): string {
    const key = `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
    let id = this.ids.get(key);
    if (!id) { id = this.s.pt(p[0], p[1]); this.ids.set(key, id); }
    return id;
  }
  line(a: Pt, b: Pt): void { this.s.ent({ type: 'line', p1: this.id(a), p2: this.id(b) }); }
  /** an arc about `c` from `a` to `b`, counter-clockwise when ccw */
  arc(c: Pt, a: Pt, b: Pt, ccw: boolean): void { this.s.ent({ type: 'arc', c: this.id(c), p1: this.id(ccw ? a : b), p2: this.id(ccw ? b : a) }); }
  /** a closed polygon */
  poly(pts: Pt[]): void { pts.forEach((p, i) => this.line(p, pts[(i + 1) % pts.length])); }
}

export const screwFeatures = {
  /**
   * A screw or bolt as its own body: head, drive and shank, placed by an origin and an axis.
   *
   * Give the metric size (M2 to M8) and the shank length; head and drive sizes come from an ISO table and can be overridden. head: 'pan' (default), 'button', 'countersunk', 'cheese' or 'hex'. drive: 'slotted', 'hex' (socket), 'cross', 'torx' or 'none'. Cross is an approximation (two tapered wings with a small flat tip) and so is torx: fine for looks, fit checks and mass. origin is the centre of the bearing face and axis is the way the shank points (default [0, 0, -1]). The screw is its own body and does not merge with what it touches. thread: true is refused for now.
   *
   * @domain features
   * @param o options object { size, length, head, drive, origin, axis, ... }, the fields below
   * @param o.size 'M2' | 'M2.5' | 'M3' | 'M4' | 'M5' | 'M6' | 'M8'
   * @param o.length shank length in mm from the bearing face to the tip (countersunk: from the flat top)
   * @param o.head 'pan' (default) | 'button' | 'countersunk' | 'cheese' | 'hex'
   * @param o.drive 'slotted' | 'hex' | 'cross' | 'torx' | 'none' (default by head: pan cross, others hex socket, hex head none)
   * @param o.origin [x, y, z] of the bearing face centre, default [0, 0, 0]
   * @param o.axis [x, y, z] direction the shank points, default [0, 0, -1]
   * @param o.thread not available yet: true is refused with an error
   * @param o.diameter shank diameter override
   * @param o.headDiameter head diameter override (across flats for a hex head)
   * @param o.headHeight head height override
   * @param o.driveSize hex socket across flats, slot width, cross span or Torx tip diameter
   * @param o.driveDepth depth of the drive below the top of the head
   * @example
   * part('Plate').sketch('front', (s) => s.rect(30, 30)).extrude(4).hole(face('>Z'), [0, 0], { diameter: 3.4 })
   *   .screw({ size: 'M3', length: 8, head: 'button', drive: 'hex', origin: [0, 0, 4] });
   * @see screw, part.thread, part.revolve
   */
  screw(this: PartBuilder, o: ScrewOpts): PartBuilder {
    const line = H.callerLine();
    const fail = (m: string): never => { throw new H.SelectorError(`screw(): ${m}`, line); };
    if (!o || typeof o !== 'object') fail('needs an options object { size, length, head, drive }');
    const sizes = SCREW_SIZES as Record<string, ScrewSize>;
    const row = sizes[String(o.size)];
    if (!row) return fail(`size must be one of ${Object.keys(sizes).join(', ')} (M2 to M8), not ${JSON.stringify(o.size)}`);
    const head: ScrewHead = o.head ?? 'pan';
    if (!HEADS.includes(head)) fail(`head must be one of ${HEADS.join(', ')}, not ${JSON.stringify(o.head)}`);
    const drive: ScrewDrive = o.drive ?? (head === 'hex' ? 'none' : head === 'pan' ? 'cross' : 'hex');
    if (!DRIVES.includes(drive)) fail(`drive must be one of ${DRIVES.join(', ')}, not ${JSON.stringify(o.drive)}`);
    if (head === 'hex' && drive !== 'none') fail('a hex head takes no drive (it is turned from outside); use drive: "none"');
    const L = H.num(o.length);
    if (!(L > 0)) fail('length must be positive');
    const num = (n: Num | undefined, dflt: number): number => (n === undefined ? dflt : H.num(n));
    const Rs = num(o.diameter, row.d) / 2;
    const hr = row[head];
    const Rh = num(o.headDiameter, hr.dk) / 2, k = num(o.headHeight, hr.k);
    if (!(Rs > 0) || !(Rh > 0) || !(k > 0)) fail('diameter, headDiameter and headHeight must be positive');
    if (head !== 'hex' && !(Rh > Rs)) fail(`the head diameter (${(2 * Rh).toFixed(2)}) must be larger than the shank (${(2 * Rs).toFixed(2)})`);
    if (head === 'countersunk' && !(L > k)) fail(`length (${L}) must exceed the head height (${k.toFixed(2)}) of a countersunk screw: its length includes the head`);
    const pitch = row.pitch;
    const ct = Math.min(pitch, 0.4 * Rs);   // tip chamfer
    const rise = head === 'pan' || head === 'button' ? (row[head] as Dome).rise : 0;

    const origin: V3 = [H.num(o.origin?.[0] ?? 0), H.num(o.origin?.[1] ?? 0), H.num(o.origin?.[2] ?? 0)];
    const ax: V3 = [H.num(o.axis?.[0] ?? 0), H.num(o.axis?.[1] ?? 0), H.num(o.axis?.[2] ?? -1)];
    if (!(Math.hypot(...ax) > 1e-9)) fail('axis must be a non-zero vector');
    const d = norm(ax);
    const ref: V3 = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const dd = dot3(ref, d);
    const u = norm([ref[0] - dd * d[0], ref[1] - dd * d[1], ref[2] - dd * d[2]]);
    const w = cross3(u, d);
    const offsetPlane = (spec: PlaneBase): OffsetPlane => ({ kind: 'offset', plane: spec, offset: 0, opts: {}, line });
    // a plane containing the axis: sketch x runs along u (the radius), sketch y along the shank direction
    const axial = offsetPlane({ origin, normal: w, xdir: u });
    // a plane across the axis at distance t along it, facing away from the shank
    const across = (t: number): OffsetPlane => offsetPlane({ origin: [origin[0] + d[0] * t, origin[1] + d[1] * t, origin[2] + d[2] * t], normal: [-d[0], -d[1], -d[2]], xdir: u });

    // ---- body: head and shank in one revolve (hex head: the shank, overlapping into the hex) ----
    const tip = (pen: Pen, from: number): void => {   // shank outline from t = from down to the tip, then back up the axis
      pen.line([Rs, from], [Rs, L - ct]); pen.line([Rs, L - ct], [Rs - ct, L]); pen.line([Rs - ct, L], [0, L]);
    };
    // a helical thread on the shank is not supported yet
    if (o.thread) fail('thread: true is not available yet: the helical thread on a screw shank does not build reliably. Use a plain shank, or add part.thread() to a cylinder yourself');
    const body = (s: SketchBuilder): void => {
      const pen = new Pen(s);
      if (head === 'hex') {
        pen.line([0, -k / 2], [Rs, -k / 2]); tip(pen, -k / 2); pen.line([0, L], [0, -k / 2]);
      } else if (head === 'countersunk') {
        pen.line([0, 0], [Rh, 0]); pen.line([Rh, 0], [Rs, k]); tip(pen, k); pen.line([0, L], [0, 0]);
      } else if (head === 'cheese') {
        const ch = Math.min(0.3, 0.1 * k);
        pen.line([0, -k], [Rh - ch, -k]); pen.line([Rh - ch, -k], [Rh, -k + ch]); pen.line([Rh, -k + ch], [Rh, 0]); pen.line([Rh, 0], [Rs, 0]);
        tip(pen, 0); pen.line([0, L], [0, -k]);
      } else {
        // pan / button: a straight wall under a spherical dome
        const sH = rise * k, Rr = (Rh * Rh + sH * sH) / (2 * sH);
        pen.arc([0, -k + Rr], [0, -k], [Rh, -(k - sH)], true);   // apex to wall top, counter-clockwise about the sphere centre
        pen.line([Rh, -(k - sH)], [Rh, 0]); pen.line([Rh, 0], [Rs, 0]);
        tip(pen, 0); pen.line([0, L], [0, -k]);
      }
    };
    this.sketch(axial, body, 'Screw profile').revolve(360, { op: 'newBody' as 'add', name: 'Screw' });
    if (head === 'hex') {
      const R = (2 * Rh) / Math.sqrt(3);   // circumradius from the width across flats
      const hexPts: Pt[] = Array.from({ length: 6 }, (_, i) => [R * Math.cos((Math.PI / 3) * i), R * Math.sin((Math.PI / 3) * i)]);
      this.sketch(across(0), (s) => new Pen(s).poly(hexPts), 'Hex head').extrude(k);
      return this;
    }

    // ---- drive ----
    if (drive === 'none') return this;
    const top = head === 'countersunk' ? 0 : -k;   // axial position of the top of the head
    const lead = 0.2;                                // the cut starts this far above the head so it never ends on the top
    const wantDepth = (dflt: number): number => Math.min(num(o.driveDepth, dflt), 0.85 * k);
    const cutDrive = (depth: number, draw: (pen: Pen) => void): void => {
      this.sketch(across(top - lead), (s) => draw(new Pen(s)), `${drive} drive`).cut(depth + lead, { direction: 'into' });
    };
    if (drive === 'hex') {
      const af = num(o.driveSize, row.socket), R = af / Math.sqrt(3);
      cutDrive(wantDepth(Math.min(0.55 * af, 0.6 * k)), (pen) => pen.poly(Array.from({ length: 6 }, (_, i): Pt => [R * Math.cos((Math.PI / 3) * i), R * Math.sin((Math.PI / 3) * i)])));
    } else if (drive === 'slotted') {
      const sw = num(o.driveSize, row.slot), half = 0.6 * Rh * 2;
      cutDrive(wantDepth(0.5 * k), (pen) => pen.poly([[-half, -sw / 2], [half, -sw / 2], [half, sw / 2], [-half, sw / 2]]));
    } else if (drive === 'cross') {
      const span = num(o.driveSize, row.cross), h = span / 2, a = Math.max(0.2, span * 0.1);
      const depth = wantDepth(0.5 * k), flat = 0.1 * span;   // the blunt tip is 0.2 of the span wide (a knife edge makes the kernel's booleans fail)
      // the bit tip as a tool: ONE thin profile (a shoulder starting 1 mm above the head, the full span at the surface, flanks sloping in to a small flat),
      // extruded to the arm width (symmetric about the axis plane), copied at 90 degrees, and both subtracted
      const bit = (s: SketchBuilder): void => { new Pen(s).poly([[-h, top - 1], [h, top - 1], [h, top], [flat, top + depth], [-flat, top + depth], [-h, top]]); };
      const axial90 = offsetPlane({ origin, normal: [-u[0], -u[1], -u[2]], xdir: w });   // the same plane turned 90 degrees about the axis
      this.sketch(axial, bit, 'cross arm 1').cut(2 * a, { direction: 'both' });
      this.sketch(axial90, bit, 'cross arm 2').cut(2 * a, { direction: 'both' });
    } else {
      const A = num(o.driveSize, row.torx.A), B = (A * row.torx.B) / row.torx.A;
      cutDrive(wantDepth(0.5 * k), (pen) => { for (const a of torxOutline(A, B)) pen.arc(a.centre, a.from, a.to, a.ccw); });
    }
    return this;
  },
};
