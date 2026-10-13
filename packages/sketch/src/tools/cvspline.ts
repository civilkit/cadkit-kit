/**
 * Control-point spline (B-spline). Click control points in turn; Enter or a second click on the last point
 * finishes; clicking the first point closes it; Escape cancels. The degree defaults to 3 and is switched by the
 * state field `degree` (a `field` event with id 'degree', value 1..9, null restores 3), also mid-draw.
 *
 * Kernel convention (ck-model sketch/spline.rs `bs_def`, confirmed by the real-kernel test): entity
 * `{type:'cvspline', pts:[pointIds], degree, knots?, closed?:true}`. The tool always writes `degree`: the kernel
 * reads a missing degree as 1. Knots are left out so the kernel uses its defaults (clamped uniform when open,
 * periodic uniform when closed). Open needs at least degree+1 points, closed needs max(3, degree+1); finishing
 * with fewer returns the hint `app.sketch.hint.needPoints` and keeps drawing. The curve passes through the
 * first and last control point only (open), so those are the points other shapes join to.
 *
 * Preview order: the control polygon's segments first (one per consecutive control-point pair, including the
 * pending cursor point), then the sampled curve's segments. The preview type has no line styles yet, so the
 * viewport can tell them apart by count: the polygon has `pts - 1` segments (`pts` counting the cursor point).
 */
import { bsplineCurve, clampDegree, minCvPoints } from './splineMath';
import { pointListTool, type PointListState } from './pointListTool';
import type { PreviewShape, Pt, Tool } from './types';

export type CvSplineState = PointListState & { degree: number };
export const DEFAULT_DEGREE = 3;

const segments = (pts: Pt[]): PreviewShape[] => pts.slice(1).map((b, i) => ({ kind: 'line' as const, a: pts[i], b }));
const deg = (s: PointListState) => s.degree ?? DEFAULT_DEGREE;

const tool = pointListTool({
  id: 'cvspline',
  init: { degree: DEFAULT_DEGREE },
  minOpen: (s) => minCvPoints(deg(s), false),
  minClosed: (s) => minCvPoints(deg(s), true),
  entity: (s, closed) => ({ type: 'cvspline', pts: [...s.pts], degree: deg(s), ...(closed ? { closed: true } : {}) }),
  field: (s, id, value) => {
    if (id !== 'degree') return undefined;
    if (value === null || !Number.isFinite(value)) return { ...s, degree: DEFAULT_DEGREE };
    return { ...s, degree: Math.min(9, Math.max(1, Math.round(value))) };
  },
  preview: (s, at, cursor, closing) => {
    const polygon = cursor ? [...at, cursor] : at;
    // while there are too few points for the chosen degree, preview the highest degree that fits
    const p = clampDegree(deg(s), polygon.length);
    const curve = bsplineCurve(polygon, p, closing && !cursor, 64);
    const poly = closing ? [...polygon, polygon[0]] : polygon;
    return [...segments(poly), ...segments(curve)];
  },
});

export const cvsplineTool = tool as unknown as Tool<CvSplineState>;
