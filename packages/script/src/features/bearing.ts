// Rolling bearings: a deep-groove ball bearing from its bore, outer diameter and width, placed by an origin and an axis. Mixed into PartBuilder by
// features/index.ts. The sizes and rules are in bearingTable.ts (nominal ISO 15 dimensions, rules of thumb for the rest).
//
// Built only from features the kernel already has: one revolve per ring (the chamfers and the ball groove are part of the profile, the groove a true arc, and a shield or seal is part of the outer
// ring's profile, like the 625-2Z of the NEMA 17 sample), and for an open bearing one revolve of a half disc per ball. Every ring and ball is its own
// body, so the bearing can be assembled and the parts moved or hidden one by one.
import type { Ctx, EditOp, Num, OffsetPlane, PartBuilder, PlaneRef } from '../recorder';
import type { PlaneBase } from '../planes';
import { bearingModel, bearingPreset, BEARING_SEALS, housingSeat, innerRingPath, outerRingPath, type PathNode, SEAT_FITS, type BearingSeal, type SeatFit } from '../bearingTable';
import { H } from './h';
import { cross3, dot3, norm, Pen, type V3 } from './screw';
import type { BearingModel } from '../bearingTable';

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
  /** a flange on the outer ring at the first face: { diameter, thickness } in mm; a preset such as 'F625' brings its own, false leaves it off */
  flange?: { diameter: Num; thickness: Num } | false;
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
  /** a persistent face name ('F2.C1', see face()): the face the bearing is seated on. The first face of the bearing lies in it and the bearing extends into the part, so `origin` must be on that face and `axis` along a world axis against its outward normal. The bearing (and its seat) is then built from the face itself, so it moves with the face when the part is edited; without it the bearing is built at the absolute origin and axis. */
  onFace?: string;
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

const STD_OF_AXIS = ['right', 'top', 'front'] as const;   // the standard plane whose normal is world x, y, z
export const r9 = (v: number): number => Math.round(v * 1e9) / 1e9 + 0;

/** The frame of a planar face as the kernel makes it (z the outward normal, x = world Y x z, or world X when z is within 8 degrees of Y, y = z x x): the sketch x and y directions. */
export function faceXY(n: V3): { x: V3; y: V3 } {
  const x: V3 = Math.abs(n[1]) > 0.99 ? [1, 0, 0] : norm(cross3([0, 1, 0], n));
  return { x, y: cross3(n, x) };
}

function drawShifted(pen: Pen, path: PathNode[], dx: number, dy = 0): void {
  drawPath(pen, path.map((n) => ({ p: [n.p[0] + dx, n.p[1] + dy], ...(n.arc ? { arc: { c: [n.arc.c[0] + dx, n.arc.c[1] + dy] as [number, number], ccw: n.arc.ccw } } : {}) })));
}

/**
 * The bearing built from the face it sits on (opts.onFace) instead of from absolute numbers: every plane the bearing is drawn on is derived from that face, so
 * when the part is edited and the face moves along its normal the pocket and the bearing bodies move with it. What the kernel gives to build on:
 *  - the face moved by nothing (turned to face into the part): a plane at the face, the origin of every sketch drawn on a plane made from it lies IN the face;
 *  - a standard plane offset to the bearing centre (this number is across the face, so it does not change when the face moves along its normal), crossed with
 *    the face plane: an axis line lying in the face;
 *  - a plane through that axis perpendicular to the face: the plane the ring and ball profiles are drawn on, its sketch y running into the part from the face.
 */
function bearingOnFace(part: PartBuilder, o: BearingOpts, m: BearingModel, name: string, origin: V3, d: V3, line: number, fail: (msg: string) => never): void {
  const face = o.onFace as string;
  if (typeof face !== 'string' || !face.trim()) fail('onFace must be the name of a face such as "F2.C1"');
  const k = [0, 1, 2].find((i) => Math.abs(Math.abs(d[i]) - 1) < 1e-9);
  if (k === undefined) fail('onFace needs the axis along x, y or z: a bearing on a tilted face is built at its absolute position');
  const j = ((k as number) + 1) % 3;   // the standard plane used to place the bearing across the face
  const e: V3 = [0, 0, 0]; e[j] = 1;
  const dl = cross3(d, e);   // sketch x of the planes below: the direction of the axis line (the face plane's normal is d, the guide plane's is e)
  const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const push = (label: string, run: (ctx: Ctx) => EditOp[]): void => { part.steps.push({ line, label, run }); };
  const add = (feature: Record<string, unknown>): EditOp => ({ op: 'add', feature });

  const facePlane = { id: null as string | null };
  const seatPlane = { id: null as string | null };
  const lead = 0.2;   // the pocket starts this far outside the face so it never ends on a face of the housing
  push('bearing face plane', (ctx) => {
    facePlane.id = ctx.nextId();
    const ops = [add({ type: 'plane', id: facePlane.id, mode: 'offset', base: { kind: 'face', id: face }, offset: 0, flip: true, visible: false, name: `${name} face plane` })];
    if (o.seat) {
      seatPlane.id = ctx.nextId();
      ops.push(add({ type: 'plane', id: seatPlane.id, mode: 'offset', base: { kind: 'face', id: face }, offset: lead, visible: false, name: `${name} seat plane` }));
    }
    return ops;
  });

  if (o.seat) {
    const sopt = o.seat === true ? {} : o.seat;
    if (sopt.fit !== undefined && !SEAT_FITS.includes(sopt.fit)) fail(`seat.fit must be one of ${SEAT_FITS.join(', ')}, not ${JSON.stringify(sopt.fit)}`);
    const seat = housingSeat({ od: m.od, width: m.width, fit: sopt.fit, ...(sopt.allowance !== undefined ? { allowance: H.num(sopt.allowance) } : {}) });
    // the pocket's centre in the sketch of the face: the sketch of a face starts at the world origin projected onto it, x and y as faceXY says
    const f = faceXY([-d[0], -d[1], -d[2]]);
    const at: [number, number] = [r9(dot(origin, f.x)), r9(dot(origin, f.y))];
    const on: PlaneRef = { kind: 'planeRef', ref: seatPlane, line };
    part.sketch(on, (s) => { s.circle(seat.diameter / 2, at); }, `${name} seat`)
      .cut(seat.depth + lead, { direction: 'into', name: `${name} seat` });
  }

  /** The plane containing the axis through `p` (a point of the face plane) and the face's inward direction; returns it and the sketch x of `p` on it. */
  const across = (p: V3): { plane: PlaneRef; u: number } => {
    const h = { id: null as string | null };
    push('bearing plane', (ctx) => {
      const q = ctx.nextId(), a = ctx.nextId();
      h.id = ctx.nextId();
      return [
        add({ type: 'plane', id: q, mode: 'offset', base: { kind: 'std', id: STD_OF_AXIS[j] }, offset: r9(p[j]), visible: false, name: `${name} guide plane` }),
        add({ type: 'axis', id: a, refs: [{ kind: 'feature', id: facePlane.id }, { kind: 'feature', id: q }], name: `${name} guide axis` }),
        add({ type: 'plane', id: h.id, mode: 'perpendicular', base: { kind: 'feature', id: facePlane.id }, axis: { kind: 'feature', id: a }, visible: false, name: `${name} profile plane` }),
      ];
    });
    return { plane: { kind: 'planeRef', ref: h, line }, u: r9(dot(p, dl)) };
  };

  const main = across(origin);
  const ring = (path: PathNode[], what: string): void => {
    part.sketch(main.plane, (s) => drawShifted(new Pen(s), path, main.u), `${name} ${what} profile`)
      .revolve(360, { newBody: `${name} ${what}`, name: `${name} ${what}`, axis: { from: [main.u, 0], to: [main.u, 10] } });
  };
  ring(innerRingPath(m), 'inner ring');
  ring(outerRingPath(m), 'outer ring');
  if (m.seal !== 'open') return;

  // balls: each is a half disc revolved about its own axis (parallel to the bearing axis), on a plane through that axis made the same way
  const rb = m.ballDiameter / 2, t = m.width / 2;
  const radial0 = dl, radial90 = cross3(dl, d);
  const planes = new Map<number, { plane: PlaneRef }>();
  for (let i = 0; i < m.balls; i++) {
    const a = (2 * Math.PI * i) / m.balls, c = Math.cos(a), sn = Math.sin(a);
    const b: V3 = [0, 1, 2].map((q) => origin[q] + (radial0[q] * c + radial90[q] * sn) * m.pitchRadius) as V3;
    const key = Math.round(b[j] * 1e6);
    let pl = planes.get(key);
    const u = r9(dot(b, dl));
    if (!pl) { pl = { plane: across(b).plane }; planes.set(key, pl); }
    const label = `${name} ball ${i + 1}`;
    part.sketch(pl.plane, (s) => {
      const pen = new Pen(s);
      pen.arc([u, t], [u, t - rb], [u, t + rb], true);
      pen.line([u, t + rb], [u, t - rb]);
    }, `${name} ball profile`).revolve(360, { newBody: label, name: label, axis: { from: [u, 0], to: [u, 10] } });
  }
}

export const bearingFeatures = {
  /**
   * A ball bearing as separate bodies: two rings (with shields or seals) and, when open, the balls.
   *
   * Give a preset designation ('608', '6204', 'MR63', 'R2' for a 1/8 inch bore) or bore, od and width in mm; the presets are the nominal ISO 15 sizes of the miniature 6xx, MR, 60xx, 62xx and 63xx series and some inch sizes. seal: '2Z' (default) is a flat shield disc on both faces, '2RS' a thicker seal with a sloping lip, 'open' shows the balls (count and diameter from the race gap, or balls and ballDiameter). All four corners of each ring are chamfered (chamfer, default by size). Each race has a ball groove (an arc about the ball centre circle, radius 0.52 ball diameters, 0.27 deep; a plain race when the bearing is too small for one), no cage, so this is for assemblies, fit checks and looks, not for load ratings. origin is the centre of the first face and axis the way the bearing extends from it (default [0, 0, 1]). Each ring and ball is its own body and does not merge with what it touches. onFace: 'F2.C1' builds the bearing from that face instead of from absolute numbers (the origin must lie on the face and the axis point into the part along x, y or z), so a later edit that moves the face moves the bearing and its pocket with it. seat: true first cuts a pocket for the outer ring into the bodies that exist (diameter with an H7 housing allowance, depth the width), seat: { fit: 'press' | 'h7' | 'print', allowance } picks another fit.
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
   * @param o.onFace face name such as 'F2.C1' the bearing is seated on (origin on that face, axis into the part along x, y or z): the pocket and the bearing bodies are built from the face, so they move with it when the part is edited
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
      ...(o.flange ? { flange: { diameter: H.num(o.flange.diameter), thickness: H.num(o.flange.thickness) } } : o.flange === undefined && found?.preset.flange ? { flange: found.preset.flange } : {}),
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
    if (o.onFace !== undefined) { bearingOnFace(this, o, m, name, origin, d, line, fail); return this; }
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
