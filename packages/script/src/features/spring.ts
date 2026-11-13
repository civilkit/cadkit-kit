// Compression springs: a round wire swept along a helix, as a body of its own, placed by an origin and an axis. Mixed into PartBuilder by features/index.ts.
// Sizes are given in the usual spring terms (outer diameter, wire diameter, free length, turns); the wizard in the app (apps/cad/src/spring.ts) adds the checks that need no kernel.
//
// Plain ends: a helix (a circle sketch and a `helix` feature) and a sweep of the wire circle along it, so it patterns, mirrors and copies like any swept feature.
// Closed ends (and ground ends): the same wire swept along ONE spline through points on a helix whose pitch is the wire diameter for `closedTurns` turns at each end
// (the turns touch) and the active pitch between them, eased over half a turn at each change. Ground ends also cut both ends flat with a slab each, restricted
// to the spring's own body (`name`, so two springs in a document need two names; the wizard numbers them).
// Extension springs (extensionSpring): one wire along one spline, a tight body of touching turns and a machine-hook loop at each end (see extensionPath).
// NOT modelled yet: a variable pitch along the body, other hook shapes, torsion (leg) springs. The section of a compression spring is carried in the plane through the axis.
import { at, type Num, type OffsetPlane, type PartBuilder, type Plane } from '../recorder';
import { H, applyNewBody, sketchOps } from './h';
import { dot3, norm, type V3 } from './screw';

export type SpringHand = 'right' | 'left';
/** a torsion spring: a close-wound coil with a straight leg tangent to each end */
export interface TorsionOpts {
  /** outside diameter of the coil, mm */ outer: Num;
  /** wire diameter, mm */ wire: Num;
  /** turns of the coil; the fraction sets the angle between the legs (a quarter more than a whole number is a right angle) */ coils: Num;
  /** length of the first leg, from where it leaves the coil, mm (default 3 times the outer diameter / 2) */ leg1?: Num;
  /** length of the second leg, mm (default: the first leg's length) */ leg2?: Num;
  /** 'right' (default) or 'left' */ hand?: SpringHand;
  /** the centre of the first end of the coil, default [0, 0, 0] */ origin?: [Num, Num, Num];
  /** the direction the coil extends from that end: along x, y or z, either way. Default [0, 0, 1] */ axis?: [Num, Num, Num];
  /** feature name in the tree, default 'Torsion spring' */ name?: string;
}
/** a machine hook: an open loop standing on the end of the coil, centred on the axis */
export interface ExtensionOpts {
  /** outside diameter of the coil, mm */ outer: Num;
  /** wire diameter, mm */ wire: Num;
  /** turns of the tight body between the two hooks; fractions turn the hooks against each other */ coils: Num;
  /** 'right' (default) or 'left' */ hand?: SpringHand;
  /** the centre of the lower end of the lower hook, default [0, 0, 0] */ origin?: [Num, Num, Num];
  /** the direction the spring extends from that end: along x, y or z, either way. Default [0, 0, 1] */ axis?: [Num, Num, Num];
  /** feature name in the tree, default 'Extension spring' */ name?: string;
}
/** plain: the wire just stops; closed: tight turns at both ends; ground: closed turns, both ends then ground flat */
export type SpringEnds = 'plain' | 'closed' | 'ground';
export interface SpringOpts {
  /** outside diameter of the coil, mm */ outer: Num;
  /** wire diameter, mm */ wire: Num;
  /** free length, end to end including the wire, mm */ length: Num;
  /** number of turns, closed ones included (the wire goes round this many times; fractions are fine) */ coils: Num;
  /** 'right' (default) or 'left' */ hand?: SpringHand;
  /** 'plain' (default), 'closed' or 'ground' */ ends?: SpringEnds;
  /** closed ends: turns at each end that touch (default 1) */ closedTurns?: Num;
  /** outside diameter at the far end, mm: a different value makes the coil a cone (default: `outer`, a cylinder) */ topOuter?: Num;
  /** the pitch of the body at the far end divided by the pitch at the first end (default 1): below 1 the turns close up towards the far end, above 1 they open */ progression?: Num;
  /** the centre of the first end (the middle of the coil's first face), default [0, 0, 0] */ origin?: [Num, Num, Num];
  /** the direction the spring extends from that end: along x, y or z, either way. Default [0, 0, 1] */ axis?: [Num, Num, Num];
  /** feature name in the tree, default 'Spring'; also the body name of a ground spring */ name?: string;
}

/** How deep the grinding goes into the end turn, as a fraction of the wire diameter. */
export const GROUND_DEPTH = 0.25;

/** The numbers a spring follows from, shared with the wizard so it can show them. `pitch` is the active pitch (between the closed turns). */
export function springGeometry(o: { outer: number; wire: number; length: number; coils: number; ends?: SpringEnds; closedTurns?: number; topOuter?: number; progression?: number }): {
  meanRadius: number; topRadius: number; pitch: number; minPitch: number; height: number; wireLength: number; volume: number; closedTurns: number; activeCoils: number; grind: number;
} {
  const ends = o.ends ?? 'plain';
  const meanRadius = (o.outer - o.wire) / 2;
  const closedTurns = ends === 'plain' ? 0 : o.closedTurns ?? 1;
  const grind = ends === 'ground' ? o.wire * GROUND_DEPTH : 0;
  const height = o.length - o.wire + 2 * grind;       // between the centres of the two end wire sections (the grinding takes the ends off, so the wire runs `grind` past each end plane)
  const activeCoils = o.coils - 2 * closedTurns;
  const pitch = activeCoils > 0 ? (height - 2 * closedTurns * o.wire * CLOSED_PITCH) / activeCoils : Infinity;   // the mean pitch of the body
  const prog = o.progression ?? 1;
  // the body's pitch runs linearly from p0 to p0 * prog with the mean `pitch`: p0 = pitch * 2 / (1 + prog)
  const minPitch = pitch * 2 * Math.min(1, prog) / (1 + prog);
  const topRadius = o.topOuter === undefined ? meanRadius : (o.topOuter - o.wire) / 2;
  const wireLength = Math.hypot(Math.PI * (meanRadius + topRadius) * o.coils, height);
  return { meanRadius, topRadius, pitch, minPitch, height, wireLength, volume: Math.PI * (o.wire / 2) ** 2 * wireLength, closedTurns, activeCoils, grind };
}

const smooth = (x: number): number => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
/** the pitch of the closed turns as a multiple of the wire diameter: 1 makes the turns touch */
export const CLOSED_PITCH = 1;
const RAMP = 0.5;   // turns over which the pitch changes between the closed and the active turns
const PER_TURN = 24;   // 12 per turn is 0.9% short in volume, 24 is within 0.05%

/** Points (in turns u, angle 2 pi u) of the centre line of a closed-end spring in local coordinates: [cos, sin, z] scaled by the caller. Heights run from 0 to `height`. */
export function closedEndHeights(coils: number, closedTurns: number, height: number, wire: number, progression = 1): { u: number[]; z: number[] } {
  const c = closedTurns, na = coils - 2 * c;
  const pc = wire * CLOSED_PITCH;
  const pa = (height - 2 * c * pc) / na;                               // the mean pitch of the body
  const p0 = (pa * 2) / (1 + progression);                              // the body's pitch at its first end, running linearly to p0 * progression at the far end
  const bodyPitch = (u: number): number => p0 * (1 + (progression - 1) * Math.min(1, Math.max(0, (u - c) / na)));
  const pitchAt = (u: number): number => {
    if (c === 0) return bodyPitch(u);
    const rise = smooth((u - (c - RAMP / 2)) / RAMP), fall = smooth(((coils - c + RAMP / 2) - u) / RAMP);
    return pc + (bodyPitch(u) - pc) * Math.min(rise, fall);
  };
  const n = Math.max(8, Math.ceil(coils * PER_TURN));
  const sub = 20;                                      // integration steps per sample
  const u: number[] = [0], z: number[] = [0];
  let zz = 0;
  for (let i = 1; i <= n; i++) {
    const u0 = ((i - 1) * coils) / n, u1 = (i * coils) / n, h = (u1 - u0) / sub;
    for (let j = 0; j < sub; j++) zz += h * (pitchAt(u0 + j * h) + 4 * pitchAt(u0 + (j + 0.5) * h) + pitchAt(u0 + (j + 1) * h)) / 6;
    u.push(u1); z.push(zz);
  }
  const k = height / zz;                               // the integral is exact up to rounding; this pins the last point to the height
  return { u, z: z.map((v) => v * k) };
}

/** Radians of the open loop that are left out of a hook (the opening of a machine hook). */
export const HOOK_OPENING = 1.0;
const LOOP_PER_TURN = 24;
const BEND_STEPS = 8;

/**
 * The centre line of an extension spring in the spring's own frame: x and y across the axis (the helix starts on +x and winds towards +y; `spin` -1 turns it the other way),
 * z along it. A tight body of `coils` touching turns, and at each end a machine hook: the wire bends a quarter circle of radius `bend` out of the last turn to point along the axis,
 * rises `rise` straight, then runs round a circle of radius `loopR` in the plane through the axis and the end of the bend, leaving the opening. The lower hook is the upper one
 * turned over. z of the lowest point of the wire is 0 (the lower loop's lowest point, less the wire radius, is at -wire/2: the caller shifts by that). Returns the points
 * in path order, from the lower hook's tip to the upper hook's tip, and the overall length of the spring.
 */
export function extensionPath(o: { outer: number; wire: number; coils: number; spin: 1 | -1 }): { pts: Array<[number, number, number]>; length: number; bend: number; loopR: number; rise: number; bodyLength: number } {
  const dw = o.wire, R = (o.outer - dw) / 2, spin = o.spin;
  const bend = Math.max(1.5 * dw, 0.25 * R);
  const loopR = Math.hypot(R, bend);                  // the end of the bend lies this far from the axis
  const rise = loopR + 2 * dw - bend;                 // so that the loop clears the coil by a wire
  const pitch = dw * CLOSED_PITCH;
  const th = (u: number): number => 2 * Math.PI * u;
  const body = (u: number): [number, number, number] => [R * Math.cos(th(u)), R * spin * Math.sin(th(u)), pitch * u];
  const tan = (u: number): [number, number] => [-Math.sin(th(u)), spin * Math.cos(th(u))];
  const nBody = Math.max(8, Math.ceil(o.coils * 24));
  const upper: Array<[number, number, number]> = [];   // after the last body point: the bend, the rise, the loop
  const lower: Array<[number, number, number]> = [];   // before the first body point, in path order
  const hook = (u: number, dir: 1 | -1): Array<[number, number, number]> => {
    // dir 1: leaving the end of the body upwards (the upper hook); dir -1: arriving at the start of the body from below (the lower hook), built as the upper one turned over
    const E = body(u), t = tan(u);
    const out: Array<[number, number, number]> = [];
    const tt: [number, number] = [dir * t[0], dir * t[1]];
    const side = dir;                                  // along t going away from the body: forwards for the upper hook, backwards for the lower
    const bendPts: Array<[number, number, number]> = [];
    for (let i = 1; i <= BEND_STEPS; i++) {
      const psi = (Math.PI / 2) * (i / BEND_STEPS);
      bendPts.push([E[0] + tt[0] * bend * Math.sin(psi), E[1] + tt[1] * bend * Math.sin(psi), E[2] + dir * bend * (1 - Math.cos(psi))]);
    }
    const B = bendPts[bendPts.length - 1];
    void side;
    out.push(...bendPts);
    const rr = Math.hypot(B[0], B[1]), ux = B[0] / rr, uy = B[1] / rr;   // the loop plane holds the axis and B
    out.push([B[0], B[1], B[2] + dir * rise * 0.5], [B[0], B[1], B[2] + dir * rise]);
    const zc = B[2] + dir * rise;
    const nLoop = Math.max(12, Math.ceil(LOOP_PER_TURN * (2 * Math.PI - HOOK_OPENING) / (2 * Math.PI)));
    for (let i = 1; i <= nLoop; i++) {
      const phi = (2 * Math.PI - HOOK_OPENING) * (i / nLoop);
      out.push([rr * Math.cos(phi) * ux, rr * Math.cos(phi) * uy, zc + dir * rr * Math.sin(phi)]);
    }
    return out;
  };
  const uEnd = o.coils;
  const bodyPts: Array<[number, number, number]> = [];
  for (let i = 0; i <= nBody; i++) bodyPts.push(body((o.coils * i) / nBody));
  upper.push(...hook(uEnd, 1));
  lower.push(...hook(0, -1));
  // the lower hook was built outwards from the start of the body; the path runs the other way
  const pts = [...lower.reverse(), ...bodyPts, ...upper];
  const zs = pts.map((p) => p[2]);
  const zmin = Math.min(...zs), zmax = Math.max(...zs);
  return { pts: pts.map((p) => [p[0], p[1], p[2] - zmin]), length: zmax - zmin + dw, bend, loopR, rise, bodyLength: pitch * o.coils + dw };
}

/** The pitch of a torsion coil as a multiple of the wire diameter: close wound with a hair of clearance, so the turns do not rub. */
export const TORSION_PITCH = 1.05;

/** The centre line of a torsion spring in its own frame (as extensionPath): the first leg running tangentially into the coil, `coils` close turns and the second leg running tangentially out. */
export function torsionPath(o: { outer: number; wire: number; coils: number; leg1: number; leg2: number; spin: 1 | -1 }): { pts: Array<[number, number, number]>; length: number; legAngle: number } {
  const dw = o.wire, R = (o.outer - dw) / 2, spin = o.spin, pitch = dw * TORSION_PITCH;
  const th = (u: number): number => 2 * Math.PI * u;
  const body = (u: number): [number, number, number] => [R * Math.cos(th(u)), R * spin * Math.sin(th(u)), pitch * u];
  const tan = (u: number): [number, number] => [-Math.sin(th(u)), spin * Math.cos(th(u))];
  const n = Math.max(8, Math.ceil(o.coils * 24));
  const pts: Array<[number, number, number]> = [];
  const t0 = tan(0), E0 = body(0);
  for (const s of [1, 0.5, 0.2]) pts.push([E0[0] - t0[0] * o.leg1 * s, E0[1] - t0[1] * o.leg1 * s, E0[2]]);
  for (let i = 0; i <= n; i++) pts.push(body((o.coils * i) / n));
  const t1 = tan(o.coils), E1 = body(o.coils);
  for (const s of [0.2, 0.5, 1]) pts.push([E1[0] + t1[0] * o.leg2 * s, E1[1] + t1[1] * o.leg2 * s, E1[2]]);
  return { pts, length: pitch * o.coils + dw, legAngle: ((o.coils % 1) + 1) % 1 * 360 };
}

// frames of the standard planes as the kernel makes them: sketch x, sketch y and normal in world axes (see plane(); the same table as washer.ts)
const STD = [
  { base: 'right' as const, x: [0, 0, -1] as V3, y: [0, 1, 0] as V3, n: [1, 0, 0] as V3 },
  { base: 'top' as const, x: [1, 0, 0] as V3, y: [0, 0, -1] as V3, n: [0, 1, 0] as V3 },
  { base: 'front' as const, x: [1, 0, 0] as V3, y: [0, 1, 0] as V3, n: [0, 0, 1] as V3 },
];
const r9 = (v: number): number => Math.round(v * 1e9) / 1e9;

/** The features of a round wire swept along a spline through `pts` (world points): the path as a 3D sketch, a plane normal to it at its start, the wire circle on that plane and the sweep as a body of its own. */
function normalPlaneSweep(ctx: Parameters<typeof sketchOps>[0], ops: Parameters<typeof sketchOps>[2], pts: V3[], dw: number, name: string, line: number): void {
  const named = pts.map((p, i) => ({ id: `p${i + 1}`, x: r9(p[0]), y: r9(p[1]), z: r9(p[2]) }));
  const sid = ctx.nextId();
  ops.push({ op: 'add', feature: { type: 'sketch3d', id: sid, name: 'Spring path', points: named, entities: [{ type: 'spline', id: 'e1', pts: named.map((p) => p.id) }], constraints: [] } });
  const pid = ctx.nextId();
  ops.push({ op: 'add', feature: { type: 'plane', id: pid, name: 'Wire plane', mode: 'normal', path: sid, visible: false } });
  const s = H.newSketch(); s.circle(dw / 2, [0, 0]);
  const skid = ctx.nextId();
  ops.push({ op: 'add', feature: { type: 'sketch', id: skid, name: 'Spring wire', plane: { kind: 'feature', id: pid }, points: s.pointList, entities: s.entities, constraints: [] } });
  const id = ctx.nextId();
  const f: Record<string, unknown> = { type: 'sweep', id, op: 'add', sketch: skid, path: { kind: 'sketch', id: sid }, name };
  applyNewBody(f, 'add', true, 'sweep', line);
  ops.push({ op: 'add', feature: f });
  ctx.lastFeature = id; ctx.lastSketch = null;
}

export const springFeatures = {
  /**
   * A compression spring as its own body.
   *
   * A round wire wound as a helix, placed by an origin and an axis. Give the outer diameter, wire diameter, free length and number of turns in mm: spring({ outer: 20, wire: 2, length: 40, coils: 10 }). The spring occupies exactly `length` along the axis from `origin`, the pitch is (length - wire) / coils and it must be larger than the wire diameter, or the turns would touch. axis must lie along x, y or z (either direction); a right-hand spring winds counter-clockwise looking against the axis, as every standard spring does whichever way it points. ends 'plain' (default) stops the wire; 'closed' winds closedTurns (default 1) touching turns at each end, and the turns count includes them; 'ground' does the same and then grinds both ends flat (the wire runs a quarter of its diameter past each end before grinding). topOuter and progression make a cone or a progressive spring; those, closed and ground springs are built along a spline and take a few seconds longer; a ground spring takes its `name` as its body name, so give each its own.
   * @domain features
   * @param o options object { outer, wire, length, coils, hand, ends, closedTurns, topOuter, progression, origin, axis, name }, the fields below
   * @param o.outer outside diameter of the coil in mm (20)
   * @param o.wire wire diameter in mm (2)
   * @param o.length free length in mm, end to end (40)
   * @param o.coils number of turns, closed ones included, fractions allowed (10)
   * @param o.hand 'right' (default) | 'left'
   * @param o.ends 'plain' (default) | 'closed' | 'ground'
   * @param o.closedTurns closed and ground: touching turns at each end, default 1
   * @param o.topOuter outside diameter at the far end in mm, default `outer`; a different value makes a cone
   * @param o.progression far-end pitch divided by first-end pitch, default 1 (below 1 the turns close up towards the far end)
   * @param o.origin [x, y, z] of the centre of the first end, default [0, 0, 0]
   * @param o.axis [x, y, z] direction the spring extends, along x, y or z, default [0, 0, 1]
   * @param o.name feature name in the tree, default 'Spring'; the body name of a ground spring
   * @example
   * part('Plunger').sketch('front', (s) => s.circle(8)).extrude(30)
   *   .spring({ outer: 14, wire: 1.2, length: 25, coils: 8, ends: 'ground', origin: [0, 0, 30], axis: [0, 0, 1] });
   * @see washer, screw, part.sweep
   */
  spring(this: PartBuilder, o: SpringOpts): PartBuilder {
    const line = H.callerLine();
    const fail = (m: string): never => { throw new H.SelectorError(`spring(): ${m}`, line); };
    if (!o || typeof o !== 'object') fail('needs an options object { outer, wire, length, coils }');
    const dOut = H.num(o.outer), dw = H.num(o.wire), L = H.num(o.length), N = H.num(o.coils);
    const hand: SpringHand = o.hand ?? 'right';
    if (hand !== 'right' && hand !== 'left') fail(`hand must be 'right' or 'left', not ${JSON.stringify(o.hand)}`);
    const ends: SpringEnds = o.ends ?? 'plain';
    if (ends !== 'plain' && ends !== 'closed' && ends !== 'ground') fail(`ends must be 'plain', 'closed' or 'ground', not ${JSON.stringify(o.ends)}`);
    if (!(dw > 0)) fail('wire must be positive');
    if (!(dOut > 2 * dw)) fail(`outer (${dOut}) must be more than twice the wire (${dw}) or there is no hole in the coil`);
    if (!(N > 0)) fail('coils must be positive');
    if (!(L > dw)) fail(`length (${L}) must be more than the wire (${dw})`);
    const cT = ends === 'plain' ? 0 : o.closedTurns === undefined ? 1 : H.num(o.closedTurns);
    if (ends !== 'plain' && !(cT > 0)) fail('closedTurns must be positive');
    const dTop = o.topOuter === undefined ? dOut : H.num(o.topOuter);
    if (!(dTop > 2 * dw)) fail(`topOuter (${dTop}) must be more than twice the wire (${dw}) or there is no hole in the coil`);
    const prog = o.progression === undefined ? 1 : H.num(o.progression);
    if (!(prog > 0)) fail('progression must be positive (the far-end pitch divided by the first-end pitch)');
    const g = springGeometry({ outer: dOut, wire: dw, length: L, coils: N, ends, closedTurns: cT, topOuter: dTop, progression: prog });
    const shaped = dTop !== dOut || prog !== 1;
    if (ends !== 'plain' && !(g.activeCoils >= 1)) fail(`${N} turns with ${cT} closed at each end leave ${+g.activeCoils.toFixed(3)} for the body: it needs at least 1 (more turns, or fewer closed ones)`);
    if (!(g.minPitch > dw)) fail(`the ${prog === 1 ? '' : 'tightest '}pitch (${+g.minPitch.toFixed(4)}) must be larger than the wire (${dw}): ${ends === 'plain' ? N : g.activeCoils} turns of this wire do not fit in ${L} mm without touching${prog === 1 ? '' : ' (or ease the progression)'}. Fewer turns or a longer spring`);
    const o3: V3 = [H.num(o.origin?.[0] ?? 0), H.num(o.origin?.[1] ?? 0), H.num(o.origin?.[2] ?? 0)];
    const ax: V3 = [H.num(o.axis?.[0] ?? 0), H.num(o.axis?.[1] ?? 0), H.num(o.axis?.[2] ?? 1)];
    if (!(Math.hypot(...ax) > 1e-9)) fail('axis must be a non-zero vector');
    const d = norm(ax);
    const k = [0, 1, 2].find((i) => Math.abs(Math.abs(d[i]) - 1) < 1e-9);
    if (k === undefined) fail('axis must lie along x, y or z for now');
    const base = STD[k as number];
    // a right-hand helix stays right-hand when the axis is turned round, so a spring that extends the other way is the same spring placed from its far end
    const sgn = d[k as number] < 0 ? -1 : 1;
    const oStart = [0, 1, 2].map((i) => o3[i] + (sgn < 0 ? d[i] * L : 0)) as V3;
    // the wire's first centre sits half a wire in from the end plane (a ground spring starts `grind` before it), on the start side of the helix base plane
    const c0 = [0, 1, 2].map((i) => oStart[i] + base.n[i] * (dw / 2 - g.grind)) as V3;
    const Ri = g.meanRadius;
    const helixOn: Plane | OffsetPlane = Math.abs(dot3(c0, base.n)) < 1e-12 ? base.base : at(base.base, dot3(c0, base.n));
    const cx = dot3(c0, base.x), cy = dot3(c0, base.y);
    // the helix starts at the sketch +x of the circle and leaves along sketch +y, so the wire section lies in the standard plane normal to that direction and through the start point
    const start: V3 = [0, 1, 2].map((i) => c0[i] + base.x[i] * Ri) as V3;
    const prof = STD.find((f, i) => i !== k && Math.abs(Math.abs(dot3(f.n, base.y)) - 1) < 1e-9) ?? fail('internal: no wire plane');
    const profOn: Plane | OffsetPlane = Math.abs(dot3(start, prof.n)) < 1e-12 ? prof.base : at(prof.base, dot3(start, prof.n));
    const px = dot3(start, prof.x), py = dot3(start, prof.y);
    const name = o.name ?? 'Spring';
    const spin = hand === 'left' ? -1 : 1;
    this.steps.push({ line, label: 'spring', run: (ctx) => {
      const ops: Parameters<typeof sketchOps>[2] = [];
      let path: Record<string, unknown>;
      if (ends === 'plain' && !shaped) {
        const hs = sketchOps(ctx, { on: helixOn, draw: (s) => { s.circle(Ri, [cx, cy]); }, name: 'Spring axis circle' }, ops);
        const hid = ctx.nextId();
        ops.push({ op: 'add', feature: { type: 'helix', id: hid, name: 'Spring helix', sketch: hs, definedBy: 'heightPitch', pitch: g.pitch, height: g.height, revolutions: N, startAngle: 0, ...(hand === 'left' ? { leftHand: true } : {}) } });
        path = { kind: 'curve', id: hid };
      } else {
        const { u, z } = closedEndHeights(N, cT, g.height, dw, prog);
        const pts = u.map((uu, i) => {
          const th = 2 * Math.PI * uu;
          const rr = Ri + (g.topRadius - Ri) * (uu / N);   // the coil's radius runs linearly from the first end to the far end
          const p = [0, 1, 2].map((j) => c0[j] + base.x[j] * rr * Math.cos(th) + base.y[j] * rr * spin * Math.sin(th) + base.n[j] * z[i]);
          return { id: `p${i + 1}`, x: r9(p[0]), y: r9(p[1]), z: r9(p[2]) };
        });
        const sid = ctx.nextId();
        ops.push({ op: 'add', feature: { type: 'sketch3d', id: sid, name: 'Spring path', points: pts, entities: [{ type: 'spline', id: 'e1', pts: pts.map((p) => p.id) }], constraints: [] } });
        path = { kind: 'sketch', id: sid };
      }
      const ps = sketchOps(ctx, { on: profOn, draw: (s) => { s.circle(dw / 2, [px, py]); }, name: 'Spring wire' }, ops);
      const id = ctx.nextId();
      const f: Record<string, unknown> = { type: 'sweep', id, op: 'add', sketch: ps, path, name };
      applyNewBody(f, 'add', ends === 'ground' ? name : true, 'sweep', line);
      ops.push({ op: 'add', feature: f });
      if (ends === 'ground') {
        // one slab at each end plane, cutting only this spring's body: the bottom slab lies below the start plane, the top slab above the far end
        const slab = (hi: boolean): void => {
          const off = dot3(oStart, base.n) + (hi ? L : 0);
          const on: Plane | OffsetPlane = Math.abs(off) < 1e-12 ? base.base : at(base.base, off);
          const sk = sketchOps(ctx, { on, draw: (s) => { s.circle(Math.max(Ri, g.topRadius) + 2 * dw, [dot3(oStart, base.x), dot3(oStart, base.y)]); }, name: hi ? 'Spring top end' : 'Spring bottom end' }, ops);
          const cid = ctx.nextId();
          ops.push({ op: 'add', feature: { type: 'extrude', id: cid, op: 'cut', sketch: sk, end: 'blind', depth: dw, flip: hi, target: [{ body: name }], name: hi ? 'Grind top end' : 'Grind bottom end' } });
          ctx.lastFeature = cid; ctx.lastSketch = null;
        };
        slab(false); slab(true);
      } else { ctx.lastFeature = id; ctx.lastSketch = null; }
      return ops;
    } });
    return this;
  },
  /**
   * An extension spring as its own body.
   *
   * Wound from touching turns with a machine hook, an open loop centred on the axis, at both ends: extensionSpring({ outer: 12, wire: 1, coils: 15 }). coils counts the turns of the tight body; the overall length follows from it and the hooks. origin is the lowest point of the lower hook and the spring stands along axis (x, y or z, either way). A part fraction of a turn turns the two hooks against each other.
   * @domain features
   * @param o options object { outer, wire, coils, hand, origin, axis, name }
   * @param o.outer outside diameter of the coil in mm (12)
   * @param o.wire wire diameter in mm (1)
   * @param o.coils turns of the tight body (15)
   * @param o.hand 'right' (default) | 'left'
   * @param o.origin [x, y, z] of the lowest point of the lower hook, default [0, 0, 0]
   * @param o.axis [x, y, z] direction the spring extends, along x, y or z, default [0, 0, 1]
   * @param o.name feature name in the tree, default 'Extension spring'
   * @example
   * extensionSpring({ outer: 12, wire: 1, coils: 15, origin: [0, 0, 5] });
   * @see spring, part.sweep
   */
  extensionSpring(this: PartBuilder, o: ExtensionOpts): PartBuilder {
    const line = H.callerLine();
    const fail = (m: string): never => { throw new H.SelectorError(`extensionSpring(): ${m}`, line); };
    if (!o || typeof o !== 'object') fail('needs an options object { outer, wire, coils }');
    const dOut = H.num(o.outer), dw = H.num(o.wire), N = H.num(o.coils);
    const hand: SpringHand = o.hand ?? 'right';
    if (hand !== 'right' && hand !== 'left') fail(`hand must be 'right' or 'left', not ${JSON.stringify(o.hand)}`);
    if (!(dw > 0)) fail('wire must be positive');
    if (!(dOut > 3 * dw)) fail(`outer (${dOut}) must be more than three times the wire (${dw}): the hook bends need room`);
    if (!(N >= 1)) fail('coils must be at least 1');
    const o3: V3 = [H.num(o.origin?.[0] ?? 0), H.num(o.origin?.[1] ?? 0), H.num(o.origin?.[2] ?? 0)];
    const ax: V3 = [H.num(o.axis?.[0] ?? 0), H.num(o.axis?.[1] ?? 0), H.num(o.axis?.[2] ?? 1)];
    if (!(Math.hypot(...ax) > 1e-9)) fail('axis must be a non-zero vector');
    const d = norm(ax);
    const k = [0, 1, 2].find((i) => Math.abs(Math.abs(d[i]) - 1) < 1e-9);
    if (k === undefined) fail('axis must lie along x, y or z for now');
    const base = STD[k as number];
    const spin = hand === 'left' ? -1 : 1;
    const path = extensionPath({ outer: dOut, wire: dw, coils: N, spin });
    const sgn = d[k as number] < 0 ? -1 : 1;
    const oStart = [0, 1, 2].map((i) => o3[i] + (sgn < 0 ? d[i] * path.length : 0)) as V3;
    const c0 = [0, 1, 2].map((i) => oStart[i] + base.n[i] * (dw / 2)) as V3;   // the lowest point of the wire's centre line sits half a wire above the end plane
    const name = o.name ?? 'Extension spring';
    this.steps.push({ line, label: 'extensionSpring', run: (ctx) => {
      const ops: Parameters<typeof sketchOps>[2] = [];
      const world = path.pts.map((p) => [0, 1, 2].map((j) => c0[j] + base.x[j] * p[0] + base.y[j] * p[1] + base.n[j] * p[2]) as V3);
      normalPlaneSweep(ctx, ops, world, dw, name, line);
      return ops;
    } });
    return this;
  },
  /**
   * A torsion spring as its own body.
   *
   * torsionSpring({ outer: 14, wire: 1.2, coils: 5.25 }): the coil is wound close, and each leg leaves it tangentially. The fraction of coils sets the angle between the legs: 5.25 turns leaves them at a right angle, 5.5 opposite each other. leg1 and leg2 are the lengths of the legs in mm (default one and a half outer diameters). origin is the centre of the first end of the coil and the coil extends along axis (x, y or z, either way).
   * @domain features
   * @param o options object { outer, wire, coils, leg1, leg2, hand, origin, axis, name }
   * @param o.outer outside diameter of the coil in mm (14)
   * @param o.wire wire diameter in mm (1.2)
   * @param o.coils turns of the coil; the fraction sets the leg angle (5.25)
   * @param o.leg1 first leg length in mm, default 1.5 x outer
   * @param o.leg2 second leg length in mm, default leg1
   * @param o.hand 'right' (default) | 'left'
   * @param o.origin [x, y, z] of the centre of the first end, default [0, 0, 0]
   * @param o.axis [x, y, z] direction the coil extends, along x, y or z, default [0, 0, 1]
   * @param o.name feature name in the tree, default 'Torsion spring'
   * @example
   * torsionSpring({ outer: 14, wire: 1.2, coils: 5.25, origin: [0, 0, 3] });
   * @see spring, extensionSpring
   */
  torsionSpring(this: PartBuilder, o: TorsionOpts): PartBuilder {
    const line = H.callerLine();
    const fail = (m: string): never => { throw new H.SelectorError(`torsionSpring(): ${m}`, line); };
    if (!o || typeof o !== 'object') fail('needs an options object { outer, wire, coils }');
    const dOut = H.num(o.outer), dw = H.num(o.wire), N = H.num(o.coils);
    const hand: SpringHand = o.hand ?? 'right';
    if (hand !== 'right' && hand !== 'left') fail(`hand must be 'right' or 'left', not ${JSON.stringify(o.hand)}`);
    if (!(dw > 0)) fail('wire must be positive');
    if (!(dOut > 2 * dw)) fail(`outer (${dOut}) must be more than twice the wire (${dw}) or there is no hole in the coil`);
    if (!(N >= 1)) fail('coils must be at least 1');
    const leg1 = o.leg1 === undefined ? 1.5 * dOut : H.num(o.leg1), leg2 = o.leg2 === undefined ? leg1 : H.num(o.leg2);
    if (!(leg1 > 0) || !(leg2 > 0)) fail('leg lengths must be positive');
    const o3: V3 = [H.num(o.origin?.[0] ?? 0), H.num(o.origin?.[1] ?? 0), H.num(o.origin?.[2] ?? 0)];
    const ax: V3 = [H.num(o.axis?.[0] ?? 0), H.num(o.axis?.[1] ?? 0), H.num(o.axis?.[2] ?? 1)];
    if (!(Math.hypot(...ax) > 1e-9)) fail('axis must be a non-zero vector');
    const d = norm(ax);
    const k = [0, 1, 2].find((i) => Math.abs(Math.abs(d[i]) - 1) < 1e-9);
    if (k === undefined) fail('axis must lie along x, y or z for now');
    const base = STD[k as number];
    const path = torsionPath({ outer: dOut, wire: dw, coils: N, leg1, leg2, spin: hand === 'left' ? -1 : 1 });
    const sgn = d[k as number] < 0 ? -1 : 1;
    const oStart = [0, 1, 2].map((i) => o3[i] + (sgn < 0 ? d[i] * path.length : 0)) as V3;
    const c0 = [0, 1, 2].map((i) => oStart[i] + base.n[i] * (dw / 2)) as V3;
    const name = o.name ?? 'Torsion spring';
    this.steps.push({ line, label: 'torsionSpring', run: (ctx) => {
      const ops: Parameters<typeof sketchOps>[2] = [];
      const world = path.pts.map((p) => [0, 1, 2].map((j) => c0[j] + base.x[j] * p[0] + base.y[j] * p[1] + base.n[j] * p[2]) as V3);
      normalPlaneSweep(ctx, ops, world, dw, name, line);
      return ops;
    } });
    return this;
  },
};
