// Rolling bearings: a deep-groove ball bearing from its bore, outer diameter and width, placed by an origin and an axis. Mixed into PartBuilder by
// features/index.ts. The sizes and rules are in bearingTable.ts (nominal ISO 15 dimensions, rules of thumb for the rest).
//
// Built only from features the kernel already has: one revolve per ring (the chamfers and the ball groove are part of the profile, the groove a true arc, and a shield or seal is part of the outer
// ring's profile, like the 625-2Z of the NEMA 17 sample), and for an open bearing one revolve of a half disc per ball. Every ring and ball is its own
// body, so the bearing can be assembled and the parts moved or hidden one by one.
import type { Num, OffsetPlane, PartBuilder } from '../recorder';
import type { PlaneBase } from '../planes';
import { bearingModel, bearingPreset, BEARING_SEALS, housingSeat, innerRingPath, outerRingPath, type PathNode, SEAT_FITS, type BearingSeal, type SeatFit } from '../bearingTable';
import { H } from './h';
import { cross3, dot3, norm, Pen, type V3 } from './screw';

export interface BearingOpts {
  /** a preset designation ('608', '6204', 'MR63', 'R2'; a seal suffix such as '608-2RS' also sets seal); bore, od and width below override its sizes */
  designation?: string;
  /** bore diameter, mm */ bore?: Num;
  /** outer diameter, mm */ od?: Num;
  /** width, mm */ width?: Num;
  /** 'open' (visible balls), '2Z' (a flat shield on each side, default) or '2RS' (a seal on each side) */
  seal?: BearingSeal;
  /** ring corner chamfer, mm (default by size, 0 for sharp corners) */
  chamfer?: Num;
  /** open bearing only: number of balls (default: by the race gap) */
  balls?: Num;
  /** open bearing only: ball diameter, mm (default: just under the race gap) */
  ballDiameter?: Num;
  /** where the bearing sits: the centre of its first face, default [0, 0, 0] */
  origin?: [Num, Num, Num];
  /** the direction from the first face through the bearing, default [0, 0, 1] */
  axis?: [Num, Num, Num];
  /** cut a matching pocket for the outer ring into what is there already (true, or { fit, allowance }), before the bearing is added: the pocket starts at the first face and runs along the axis for the width */
  seat?: boolean | { fit?: SeatFit; allowance?: Num };
  /** name prefix of the bodies ('inner ring', 'outer ring', 'ball'), default 'Bearing' (or 'Bearing 608' for a designation) */
  name?: string;
}

const LETTER = ['x', 'y', 'z'] as const;

/** Draws a ring section: straight lines, and the groove as a true arc. */
function drawPath(pen: Pen, path: PathNode[]): void {
  path.forEach((n, i) => {
    const q = path[(i + 1) % path.length].p;
    if (n.arc) pen.arc(n.arc.c, n.p, q, n.arc.ccw); else pen.line(n.p, q);
  });
}

export const bearingFeatures = {
  /**
   * A ball bearing as separate bodies: two rings (with shields or seals) and, when open, the balls.
   *
   * Give a preset designation ('608', '6204', 'MR63', 'R2' for a 1/8 inch bore) or bore, od and width in mm; the presets are the nominal ISO 15 sizes of the miniature 6xx, MR, 60xx, 62xx and 63xx series and some inch sizes. seal: '2Z' (default) is a flat shield disc on both faces, '2RS' a thicker seal with a sloping lip, 'open' shows the balls (count and diameter from the race gap, or balls and ballDiameter). All four corners of each ring are chamfered (chamfer, default by size). Each race has a ball groove (an arc about the ball centre circle, radius 0.52 ball diameters, 0.27 deep; a plain race when the bearing is too small for one), no cage, so this is for assemblies, fit checks and looks, not for load ratings. origin is the centre of the first face and axis the way the bearing extends from it (default [0, 0, 1]). Each ring and ball is its own body and does not merge with what it touches. seat: true first cuts a pocket for the outer ring into the bodies that exist (diameter with an H7 housing allowance, depth the width), seat: { fit: 'press' | 'h7' | 'print', allowance } picks another fit.
   *
   * @domain features
   * @param o options object { designation | bore, od, width, seal, chamfer, balls, origin, axis, name }, the fields below
   * @param o.designation preset such as '608', '6204', 'MR63', 'R2'; a suffix '-2RS' or 'ZZ' also sets seal
   * @param o.bore bore diameter in mm (overrides the preset)
   * @param o.od outer diameter in mm (overrides the preset)
   * @param o.width width in mm (overrides the preset)
   * @param o.seal 'open' | '2Z' (default) | '2RS'
   * @param o.chamfer ring corner chamfer in mm (default by size, 0 = sharp)
   * @param o.balls ball count, open bearings only (default by rule)
   * @param o.ballDiameter ball diameter in mm, open bearings only (default from the race gap)
   * @param o.origin [x, y, z] of the centre of the first face, default [0, 0, 0]
   * @param o.axis [x, y, z] direction from the first face through the bearing, default [0, 0, 1]
   * @param o.seat true or { fit: 'h7' | 'press' | 'print', allowance } cuts a pocket for the outer ring first (existing bodies only)
   * @param o.name name prefix of the bodies, default 'Bearing'
   * @example
   * part('Wheel hub').bearing({ designation: '608', seal: '2RS', origin: [0, 0, 0], axis: [0, 0, 1] })
   *   .bearing({ bore: 5, od: 16, width: 5, seal: 'open', origin: [30, 0, 0] });
   * @see bearing, part.screw, part.revolve
   */
  bearing(this: PartBuilder, o: BearingOpts): PartBuilder {
    const line = H.callerLine();
    const fail = (m: string): never => { throw new H.SelectorError(`bearing(): ${m}`, line); };
    if (!o || typeof o !== 'object') fail('needs an options object { designation | bore, od, width, seal }');
    const found = o.designation !== undefined ? bearingPreset(o.designation) : null;
    if (o.designation !== undefined && !found) fail(`unknown designation ${JSON.stringify(o.designation)}; use one of the presets (608, 6204, MR63, R2, ...) or give bore, od and width`);
    const pick = (n: Num | undefined, dflt: number | undefined, what: string): number => {
      const v = n !== undefined ? H.num(n) : dflt;
      if (v === undefined) return fail(`give ${what} (or a preset designation)`);
      return v;
    };
    const seal: BearingSeal = o.seal ?? found?.seal ?? '2Z';
    if (!BEARING_SEALS.includes(seal)) fail(`seal must be one of ${BEARING_SEALS.join(', ')}, not ${JSON.stringify(o.seal)}`);
    const spec = {
      bore: pick(o.bore, found?.preset.bore, 'bore'), od: pick(o.od, found?.preset.od, 'od'), width: pick(o.width, found?.preset.width, 'width'), seal,
      ...(o.chamfer !== undefined ? { chamfer: H.num(o.chamfer) } : {}),
      ...(o.balls !== undefined ? { balls: H.num(o.balls) } : {}),
      ...(o.ballDiameter !== undefined ? { ballDiameter: H.num(o.ballDiameter) } : {}),
    };
    let m;
    try { m = bearingModel(spec); } catch (e) { return fail((e as Error).message); }
    const name = o.name ?? (found ? `Bearing ${found.preset.designation}` : 'Bearing');

    const origin: V3 = [H.num(o.origin?.[0] ?? 0), H.num(o.origin?.[1] ?? 0), H.num(o.origin?.[2] ?? 0)];
    const ax: V3 = [H.num(o.axis?.[0] ?? 0), H.num(o.axis?.[1] ?? 0), H.num(o.axis?.[2] ?? 1)];
    if (!(Math.hypot(...ax) > 1e-9)) fail('axis must be a non-zero vector');
    const d = norm(ax);
    const ref: V3 = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const dd = dot3(ref, d);
    const u = norm([ref[0] - dd * d[0], ref[1] - dd * d[1], ref[2] - dd * d[2]]);
    const w = cross3(u, d);
    const offsetPlane = (spec: PlaneBase): OffsetPlane => ({ kind: 'offset', plane: spec, offset: 0, opts: {}, line });
    // a plane containing the axis: sketch x runs along u (the radius), sketch y along the axis
    const axial = offsetPlane({ origin, normal: w, xdir: u });

    if (o.seat) {
      const sopt = o.seat === true ? {} : o.seat;
      if (sopt.fit !== undefined && !SEAT_FITS.includes(sopt.fit)) fail(`seat.fit must be one of ${SEAT_FITS.join(', ')}, not ${JSON.stringify(sopt.fit)}`);
      const seat = housingSeat({ od: m.od, width: m.width, fit: sopt.fit, ...(sopt.allowance !== undefined ? { allowance: H.num(sopt.allowance) } : {}) });
      const lead = 0.2;   // the cut starts this far outside the first face so it never ends on a face of the housing
      const across = offsetPlane({ origin: [origin[0] - d[0] * lead, origin[1] - d[1] * lead, origin[2] - d[2] * lead], normal: [-d[0], -d[1], -d[2]], xdir: u });
      this.sketch(across, (s) => { s.circle(seat.diameter / 2); }, `${name} seat`).cut(seat.depth + lead, { direction: 'into', name: `${name} seat` });
    }
    this.sketch(axial, (s) => drawPath(new Pen(s), innerRingPath(m)), `${name} inner ring profile`).revolve(360, { newBody: `${name} inner ring`, name: `${name} inner ring` });
    this.sketch(axial, (s) => drawPath(new Pen(s), outerRingPath(m)), `${name} outer ring profile`).revolve(360, { newBody: `${name} outer ring`, name: `${name} outer ring` });
    if (m.seal !== 'open') return this;

    // balls: a half disc about its own centre line, revolved. One ball is repeated around the axis when that is a world axis through the origin (the kernel
    // patterns about world axes only); otherwise each ball is built where it sits
    const rb = m.ballDiameter / 2;
    const ballAt = (angle: number, label: string): void => {
      const c = Math.cos(angle), sn = Math.sin(angle);
      const radial: V3 = [u[0] * c + w[0] * sn, u[1] * c + w[1] * sn, u[2] * c + w[2] * sn];
      const t = m.width / 2;
      const centre: V3 = [0, 1, 2].map((i) => origin[i] + d[i] * t + radial[i] * m.pitchRadius) as V3;
      // the sketch plane holds the axis direction (sketch y) and the ball centre; the ball's polar axis is the sketch y axis through its centre
      const plane = offsetPlane({ origin: centre, normal: cross3(radial, d), xdir: radial });
      this.sketch(plane, (s) => {
        const pen = new Pen(s);
        pen.arc([0, 0], [0, -rb], [0, rb], true);
        pen.line([0, rb], [0, -rb]);
      }, `${name} ball profile`).revolve(360, { newBody: label, name: label });
    };
    const k = [0, 1, 2].find((i) => Math.abs(Math.abs(d[i]) - 1) < 1e-9);
    const onWorldAxis = k !== undefined && [0, 1, 2].every((i) => i === k || Math.abs(origin[i]) < 1e-9);
    if (onWorldAxis) {
      ballAt(0, `${name} ball`);
      this.circularPattern({ count: m.balls, axis: LETTER[k] });
    } else {
      for (let i = 0; i < m.balls; i++) ballAt((2 * Math.PI * i) / m.balls, `${name} ball ${i + 1}`);
    }
    return this;
  },
};
