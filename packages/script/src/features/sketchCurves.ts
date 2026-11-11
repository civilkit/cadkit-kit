// Splines in sketches. Mixed into SketchBuilder by features/index.ts.
import type { SketchBuilder } from '../recorder';

type Pt = [number, number];
type Priv = { pt(x: number, y: number): string; ent(e: Record<string, unknown>): void };

export const sketchCurves = {
  /**
   * Interpolating spline: a smooth curve through the points.
   *
   * Adds a spline that passes through every point (a fit-point spline). closed: true makes it a closed loop through the points (a profile you can extrude); open splines are paths for sweep or lofts guides, or edges of an outline with other entities.
   * @domain sketch
   * @param pts list of [x, y] points the curve passes through, at least 3 (2 for an open one)
   * @param o.closed close the curve into a loop
   * @example
   * part('Blob').sketch('front', (s) => s.spline([[0, 0], [20, 10], [30, 30], [10, 40], [-10, 20]], { closed: true })).extrude(6);
   * @see sketch.cvspline, part.sweep
   */
  spline(this: SketchBuilder, pts: Pt[], o: { closed?: boolean } = {}): SketchBuilder {
    const p = this as unknown as Priv;
    if (!Array.isArray(pts) || pts.length < (o.closed ? 3 : 2)) throw new Error(`spline: needs at least ${o.closed ? 3 : 2} points`);
    const ids = pts.map(([x, y]) => p.pt(x, y));
    p.ent({ type: 'spline', pts: ids, ...(o.closed ? { closed: true } : {}) });
    return this;
  },
  /**
   * Control-vertex spline: the points are the control polygon, not on the curve.
   *
   * Adds a B-spline whose control vertices are the points (the curve is pulled towards them but does not pass through). Degree 3 by default. Use it for fair, smooth outlines where overshoot of an interpolating spline is a problem. closed: true makes a periodic loop.
   * @domain sketch
   * @param pts control points [x, y], at least degree + 1
   * @param o.closed close the curve into a loop
   * @param o.degree curve degree, default 3
   * @example
   * part('Fair').sketch('front', (s) => s.cvspline([[0, 0], [30, 0], [40, 20], [20, 40], [-10, 30]], { closed: true })).extrude(5);
   * @see sketch.spline
   */
  cvspline(this: SketchBuilder, pts: Pt[], o: { closed?: boolean; degree?: number } = {}): SketchBuilder {
    const p = this as unknown as Priv;
    const degree = o.degree ?? 3;
    if (!Array.isArray(pts) || pts.length < degree + 1) throw new Error(`cvspline: needs at least ${degree + 1} control points for degree ${degree}`);
    const ids = pts.map(([x, y]) => p.pt(x, y));
    p.ent({ type: 'cvspline', pts: ids, degree, ...(o.closed ? { closed: true } : {}) });
    return this;
  },
  /**
   * Curve from a JavaScript function t -> [x, y], sampled into a fitted spline.
   *
   * s.curve((t) => [x, y], { from: 0, to: 1, count: 48, closed: false }) calls the function at count equal steps of t from `from` to `to` and draws one interpolating spline through the points (units: mm, JS maths: sin and cos take radians). Open (the default): count + 1 points, the last at t = to. closed: true makes a full loop WITHOUT repeating the end point: t runs from `from` up to but not including `to` (so for a circle use from 0, to 2 * Math.PI), count points, and the spline closes on itself, which is what a loft section or an extrude profile needs. The function may use the script's variables and any JS; it is sampled when the script runs, so for a curve the kernel should keep as formulas (editable, refitted to a tolerance) use s.equation. Fewer than 3 points, a function that does not return two finite numbers, or count above 2000 stops the run with the line. Defaults: from 0, to 1, count 48, points rounded to 0.0001 mm.
   * @domain sketch
   * @param f function of t returning [x, y]
   * @param o.from first t, default 0
   * @param o.to last t (excluded when closed), default 1
   * @param o.count number of steps, default 48 (alias n; from / to are also t0 / t1)
   * @param o.closed close the curve into a loop, default false
   * @example
   * // a closed loft section: an egg shape, 60 points
   * part('Egg').sketch('front', (s) => s.curve((a) => [20 * Math.cos(a), 26 * Math.sin(a) * (1 + 0.15 * Math.cos(a))], { from: 0, to: 2 * Math.PI, count: 60, closed: true })).extrude(8);
   * @see sketch.polar, sketch.equation, sketch.spline
   */
  curve(this: SketchBuilder, f: (t: number) => Pt, o: { from?: number; to?: number; count?: number; closed?: boolean; t0?: number; t1?: number; n?: number } = {}): SketchBuilder {
    if (typeof f !== 'function') throw new Error('curve(): the first argument is a function t => [x, y], e.g. s.curve((t) => [10 * t, 5 * Math.sin(t)], { from: 0, to: 6, count: 40 })');
    const from = o.from ?? o.t0 ?? 0, to = o.to ?? o.t1 ?? 1, count = o.count ?? o.n ?? 48, closed = o.closed ?? false;   // t0 / t1 / n are short names for from / to / count
    if (![from, to].every(Number.isFinite) || from === to) throw new Error('curve(): from and to must be different numbers');
    if (!Number.isInteger(count) || count < (closed ? 3 : 2) || count > 2000) throw new Error(`curve(): count is a whole number of steps from ${closed ? 3 : 2} to 2000 (got ${count})`);
    const n = closed ? count : count + 1, pts: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const t = from + (to - from) * i / count, v = f(t);
      if (!Array.isArray(v) || v.length < 2 || !Number.isFinite(v[0]) || !Number.isFinite(v[1])) throw new Error(`curve(): the function must return [x, y] as finite numbers; at t = ${t} it returned ${JSON.stringify(v)}`);
      pts.push([+v[0].toFixed(4) + 0, +v[1].toFixed(4) + 0]);   // + 0 turns -0 into 0
    }
    return this.spline(pts, closed ? { closed: true } : {});
  },
  /**
   * Polar curve from a function angle -> radius (waves, cams, petals).
   *
   * Call it as s.polar((angle) => radius, o), the same as s.polarCurve: waves, cams, petals, rounded stars. s.polar((angle) => radius, { count: 96, closed: true }) draws r(angle) round the sketch origin (or `center`) as one interpolating spline. The angle is in RADIANS (JS Math.sin / Math.cos), measured from the sketch x axis counter-clockwise, from 0 to 2 * Math.PI by default; closed: true (the default for a full turn) makes a loop without repeating the end point, ready to extrude or to use as a loft section. Give from / to for a sector (open spline, closed: false). The radius must be a finite number (negative values draw on the opposite side). count defaults to 96 points: use about 8 points per wave of the function, more for sharp features; the spline passes through the points, so a coarse count rounds corners. Points are rounded to 0.0001 mm. Use sketch.curve for anything that is not a radius against an angle.
   * @domain sketch
   * @param f function of the angle in radians returning the radius in mm
   * @param o.count number of points, default 96 (alias n)
   * @param o.closed close the loop, default true for a full turn and false when from / to are given
   * @param o.from first angle in radians, default 0
   * @param o.to last angle in radians (excluded when closed), default 2 * Math.PI
   * @param o.center [x, y] centre, default [0, 0]
   * @example
   * // a wavy disc outline: radius 30 with 12 waves 3 mm deep
   * part('Wavy').sketch('front', (s) => s.polar((a) => 30 + 1.5 * Math.cos(12 * a), { count: 120 })).extrude(5);
   * @see sketch.curve, sketch.equation, sketch.polar
   */
  polarCurve(this: SketchBuilder, f: (angle: number) => number, o: { count?: number; n?: number; closed?: boolean; from?: number; to?: number; center?: Pt } = {}): SketchBuilder {
    if (typeof f !== 'function') throw new Error('polar(): the first argument is a function angle => radius, e.g. s.polar((a) => 30 + 2 * Math.cos(8 * a))');
    const sector = o.from !== undefined || o.to !== undefined;
    const [cx, cy] = o.center ?? [0, 0];
    if (![cx, cy].every(Number.isFinite)) throw new Error('polar(): center is [x, y] in mm');
    return this.curve((a) => {
      const r = f(a);
      if (typeof r !== 'number' || !Number.isFinite(r)) throw new Error(`polar(): the function must return a finite radius; at angle ${a} it returned ${JSON.stringify(r)}`);
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    }, { from: o.from ?? 0, to: o.to ?? 2 * Math.PI, count: o.count ?? o.n ?? 96, closed: o.closed ?? !sector });
  },
};
