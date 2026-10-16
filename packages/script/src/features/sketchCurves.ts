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
};
