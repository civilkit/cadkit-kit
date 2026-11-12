// Compression springs: a round wire swept along a helix, as a body of its own, placed by an origin and an axis. Mixed into PartBuilder by features/index.ts.
// Sizes are given in the usual spring terms (outer diameter, wire diameter, free length, turns); the wizard in the app (apps/cad/src/spring.ts) adds the checks that need no kernel.
//
// Built from a helix (a circle sketch and a `helix` feature) and a sweep of the wire circle along it, so it patterns, mirrors and copies like any swept feature.
// NOT modelled yet: ground (flat) ends, closed ends, a variable pitch, extension (hook) and torsion (leg) springs. The ends are the plain end of the wire,
// cut square across the wire (the section is carried in the plane through the axis).
import { at, type Num, type OffsetPlane, type PartBuilder, type Plane } from '../recorder';
import { H, applyNewBody, sketchOps } from './h';
import { dot3, norm, type V3 } from './screw';

export type SpringHand = 'right' | 'left';
export interface SpringOpts {
  /** outside diameter of the coil, mm */ outer: Num;
  /** wire diameter, mm */ wire: Num;
  /** free length, end to end including the wire, mm */ length: Num;
  /** number of turns (the wire goes round this many times; fractions are fine) */ coils: Num;
  /** 'right' (default) or 'left' */ hand?: SpringHand;
  /** the centre of the first end (the middle of the coil's first face), default [0, 0, 0] */ origin?: [Num, Num, Num];
  /** the direction the spring extends from that end: along x, y or z, either way. Default [0, 0, 1] */ axis?: [Num, Num, Num];
  /** feature name in the tree, default 'Spring' */ name?: string;
}

/** The numbers a spring follows from, shared with the wizard so it can show them. */
export function springGeometry(o: { outer: number; wire: number; length: number; coils: number }): { meanRadius: number; pitch: number; height: number; wireLength: number; volume: number } {
  const meanRadius = (o.outer - o.wire) / 2;
  const height = o.length - o.wire;                 // between the centres of the two end wire sections
  const pitch = o.coils > 0 ? height / o.coils : Infinity;
  const wireLength = Math.hypot(2 * Math.PI * meanRadius * o.coils, height);
  return { meanRadius, pitch, height, wireLength, volume: Math.PI * (o.wire / 2) ** 2 * wireLength };
}

// frames of the standard planes as the kernel makes them: sketch x, sketch y and normal in world axes (see plane(); the same table as washer.ts)
const STD = [
  { base: 'right' as const, x: [0, 0, -1] as V3, y: [0, 1, 0] as V3, n: [1, 0, 0] as V3 },
  { base: 'top' as const, x: [1, 0, 0] as V3, y: [0, 0, -1] as V3, n: [0, 1, 0] as V3 },
  { base: 'front' as const, x: [1, 0, 0] as V3, y: [0, 1, 0] as V3, n: [0, 0, 1] as V3 },
];

export const springFeatures = {
  /**
   * A compression spring as its own body.
   *
   * A round wire wound as a helix, placed by an origin and an axis. Give the outer diameter, wire diameter, free length and number of turns in mm: spring({ outer: 20, wire: 2, length: 40, coils: 10 }). The spring occupies exactly `length` along the axis from `origin` (the wire's end faces touch the two end planes), the pitch is (length - wire) / coils and it must be larger than the wire diameter, or the turns would touch. axis must lie along x, y or z (either direction); a right-hand spring winds counter-clockwise looking against the axis, as every standard spring does whichever way it points. The ends are the plain ends of the wire: there are no ground or closed ends yet.
   * @domain features
   * @param o options object { outer, wire, length, coils, hand, origin, axis, name }, the fields below
   * @param o.outer outside diameter of the coil in mm (20)
   * @param o.wire wire diameter in mm (2)
   * @param o.length free length in mm, end to end (40)
   * @param o.coils number of turns, fractions allowed (10)
   * @param o.hand 'right' (default) | 'left'
   * @param o.origin [x, y, z] of the centre of the first end, default [0, 0, 0]
   * @param o.axis [x, y, z] direction the spring extends, along x, y or z, default [0, 0, 1]
   * @param o.name feature name in the tree, default 'Spring'
   * @example
   * part('Plunger').sketch('front', (s) => s.circle(8)).extrude(30)
   *   .spring({ outer: 14, wire: 1.2, length: 25, coils: 8, origin: [0, 0, 30], axis: [0, 0, 1] });
   * @see washer, screw, part.sweep
   */
  spring(this: PartBuilder, o: SpringOpts): PartBuilder {
    const line = H.callerLine();
    const fail = (m: string): never => { throw new H.SelectorError(`spring(): ${m}`, line); };
    if (!o || typeof o !== 'object') fail('needs an options object { outer, wire, length, coils }');
    const dOut = H.num(o.outer), dw = H.num(o.wire), L = H.num(o.length), N = H.num(o.coils);
    const hand: SpringHand = o.hand ?? 'right';
    if (hand !== 'right' && hand !== 'left') fail(`hand must be 'right' or 'left', not ${JSON.stringify(o.hand)}`);
    if (!(dw > 0)) fail('wire must be positive');
    if (!(dOut > 2 * dw)) fail(`outer (${dOut}) must be more than twice the wire (${dw}) or there is no hole in the coil`);
    if (!(N > 0)) fail('coils must be positive');
    if (!(L > dw)) fail(`length (${L}) must be more than the wire (${dw})`);
    const g = springGeometry({ outer: dOut, wire: dw, length: L, coils: N });
    if (!(g.pitch > dw)) fail(`the pitch (${+g.pitch.toFixed(4)}) must be larger than the wire (${dw}): ${N} turns of this wire do not fit in ${L} mm without touching. Fewer turns or a longer spring`);
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
    // the wire's first centre sits half a wire in from the end plane, on the start side of the helix base plane
    const c0 = [0, 1, 2].map((i) => oStart[i] + base.n[i] * (g.height > 0 ? dw / 2 : 0)) as V3;
    const Ri = g.meanRadius;
    const helixOn: Plane | OffsetPlane = Math.abs(dot3(c0, base.n)) < 1e-12 ? base.base : at(base.base, dot3(c0, base.n));
    const cx = dot3(c0, base.x), cy = dot3(c0, base.y);
    // the helix starts at the sketch +x of the circle and leaves along sketch +y, so the wire section lies in the standard plane normal to that direction and through the start point
    const start: V3 = [0, 1, 2].map((i) => c0[i] + base.x[i] * Ri) as V3;
    const prof = STD.find((f, i) => i !== k && Math.abs(Math.abs(dot3(f.n, base.y)) - 1) < 1e-9) ?? fail('internal: no wire plane');
    const profOn: Plane | OffsetPlane = Math.abs(dot3(start, prof.n)) < 1e-12 ? prof.base : at(prof.base, dot3(start, prof.n));
    const px = dot3(start, prof.x), py = dot3(start, prof.y);
    const name = o.name ?? 'Spring';
    this.steps.push({ line, label: 'spring', run: (ctx) => {
      const ops: Parameters<typeof sketchOps>[2] = [];
      const hs = sketchOps(ctx, { on: helixOn, draw: (s) => { s.circle(Ri, [cx, cy]); }, name: 'Spring axis circle' }, ops);
      const hid = ctx.nextId();
      ops.push({ op: 'add', feature: { type: 'helix', id: hid, name: 'Spring helix', sketch: hs, definedBy: 'heightPitch', pitch: g.pitch, height: g.height, revolutions: N, startAngle: 0, ...(hand === 'left' ? { leftHand: true } : {}) } });
      const ps = sketchOps(ctx, { on: profOn, draw: (s) => { s.circle(dw / 2, [px, py]); }, name: 'Spring wire' }, ops);
      const id = ctx.nextId();
      const f: Record<string, unknown> = { type: 'sweep', id, op: 'add', sketch: ps, path: { kind: 'curve', id: hid }, name };
      applyNewBody(f, 'add', true, 'sweep', line);
      ops.push({ op: 'add', feature: f });
      ctx.lastFeature = id; ctx.lastSketch = null;
      return ops;
    } });
    return this;
  },
};
