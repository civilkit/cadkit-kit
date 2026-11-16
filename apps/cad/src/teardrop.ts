// Teardrop holes for 3D printing. A hole whose axis is horizontal while printing sags at its top, because the roof of a round hole has no support. A
// teardrop adds a peak above the round hole, its two sides at no more than the printer's overhang angle from vertical (45 degrees is the usual
// limit), so every layer rests on the one below. The round hole stays exactly as it is; this adds the peak as a wedge cut along the same axis, so the
// original is still a real Hole feature in the tree and the result is the union of the two.
//
// Pure functions: the picked hole (as read by readFastenHole) and the options go in, the plane, the wedge outline and the script that cuts it come out.
// No DOM, no kernel.
import type { FastenHole } from './fastenHole';

type V3 = [number, number, number];

export interface TeardropOpts {
  /** the world direction the peak points toward (the print-up direction); it is projected onto the plane of the hole's mouth */
  toward: V3;
  /** turn the peak this many degrees about the hole's axis from `toward`, counter-clockwise seen from the mouth (0 by default) */
  rotate?: number;
  /** each side of the peak, in degrees from the peak's axis: 45 gives a 90 degree peak, which prints without support; 20 to 60 */
  halfAngle?: number;
  /** cut the tip off flat (a printed bridge across the top is easier than a sharp tip) */
  flat?: boolean;
  /** with `flat`: the flat's distance from the hole's centre, in mm (default the hole's radius; between the tangent points and the tip) */
  flatAt?: number;
}

export type TeardropIssue =
  /** the print-up direction runs along the hole: it has no "up" in the hole's plane */
  | 'parallel'
  | 'halfAngle'
  | 'flatAt'
  | 'diameter';

export interface TeardropPlan {
  /** the hole's centre on the face it opens on */
  origin: V3;
  /** out of the material: a cut goes against it, into the part */
  normal: V3;
  /** the sketch's x axis: the peak points along it (the outline is symmetric about it, so the sign of y does not matter) */
  xdir: V3;
  /** the wedge outline in the sketch's plane, millimetres: the centre, the tangent points and the tip (or the flat) */
  polygon: Array<[number, number]>;
  /** how far the peak reaches beyond the hole's centre, mm */
  reach: number;
  /** a cut as deep as the hole, or all the way through */
  depth: number | 'through';
  /** the world direction the peak points to */
  apex: V3;
}

const DEG = Math.PI / 180;
const r6 = (v: number): number => Math.round(v * 1e6) / 1e6 + 0;
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };

/** Rotate `v` about the unit vector `k` by `deg` degrees (Rodrigues). */
function rotate(v: V3, k: V3, deg: number): V3 {
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
}

export function planTeardrop(hole: Pick<FastenHole, 'mouth' | 'out' | 'diameter' | 'thickness' | 'through'>, o: TeardropOpts): { ok: true; plan: TeardropPlan } | { ok: false; issue: TeardropIssue } {
  const r = hole.diameter / 2;
  if (!(r > 0)) return { ok: false, issue: 'diameter' };
  const a = o.halfAngle ?? 45;
  if (!(a >= 20 && a <= 60)) return { ok: false, issue: 'halfAngle' };
  const n = unit(hole.out);
  const along = dot(o.toward, n);
  const flatToward = sub(o.toward, scale(n, along));
  if (Math.hypot(...flatToward) < 1e-6 * Math.max(1, Math.hypot(...o.toward))) return { ok: false, issue: 'parallel' };
  const xdir = unit(rotate(unit(flatToward), n, o.rotate ?? 0));
  const sa = Math.sin(a * DEG), ca = Math.cos(a * DEG);
  // the tangent from the tip to the circle touches it at r (sin a, cos a); the tip is r / sin a from the centre
  const tip = r / sa;
  const T: [number, number] = [r * sa, r * ca];
  let polygon: Array<[number, number]>;
  let reach = tip;
  if (o.flat) {
    const f = o.flatAt ?? r;
    if (!(f > T[0] + 1e-9 && f < tip - 1e-9)) return { ok: false, issue: 'flatAt' };
    const half = (tip - f) * Math.tan(a * DEG);
    polygon = [[0, 0], T, [f, half], [f, -half], [T[0], -T[1]]];
    reach = f;
  } else {
    polygon = [[0, 0], T, [tip, 0], [T[0], -T[1]]];
  }
  return {
    ok: true,
    plan: {
      origin: hole.mouth.map(r6) as V3, normal: n.map(r6) as V3, xdir: xdir.map(r6) as V3,
      polygon: polygon.map(([x, y]) => [r6(x), r6(y)] as [number, number]), reach: r6(reach),
      depth: hole.through ? 'through' : r6(hole.thickness), apex: xdir.map(r6) as V3,
    },
  };
}

/** The script that cuts the wedge of each hole: a sketch on a plane at the hole's mouth, cut as deep as the hole. Run in attach mode, so it adds to the part. */
export function teardropScript(plans: TeardropPlan | TeardropPlan[], name = 'Teardrop'): string {
  const v = (a: V3) => `[${a.join(', ')}]`;
  const one = (plan: TeardropPlan): string => `p.sketch(at({ origin: ${v(plan.origin)}, normal: ${v(plan.normal)}, xdir: ${v(plan.xdir)} }), (s) => s.polygon(${JSON.stringify(plan.polygon)})).cut(${plan.depth === 'through' ? 'through()' : String(plan.depth)});\n`;
  return `const p = part(${JSON.stringify(name)});\n${(Array.isArray(plans) ? plans : [plans]).map(one).join('')}`;
}

/** The area of the round hole's teardrop: the circle plus the wedge beyond it (the wedge's kite minus the circle's sector inside it), mm squared. For tests and the preview text. */
export function teardropArea(diameter: number, halfAngleDeg = 45, flat = false, flatAt?: number): number {
  const r = diameter / 2, a = halfAngleDeg * DEG;
  const tip = r / Math.sin(a), L = Math.sqrt(tip * tip - r * r);
  const sector = r * r * (Math.PI / 2 - a);
  let extra = r * L - sector;
  if (flat) {
    const f = flatAt ?? r, half = (tip - f) * Math.tan(a);
    // the part of the peak above the flat: a triangle with its base on the flat
    extra -= half * (tip - f);
  }
  return Math.PI * r * r + extra;
}
