/**
 * Fit spline: a curve through the clicked points. Click points in turn; Enter or a second click on the last
 * point finishes; clicking the first point closes the curve; Escape cancels (the points it added go away).
 *
 * Kernel convention (ck-model sketch/spline.rs, confirmed by the real-kernel test): entity
 * `{type:'spline', pts:[pointIds], closed?:true}`. A C2 cubic through the points, chord-length parameterised,
 * natural ends (open) or periodic (closed). It needs 2 distinct points open, 3 closed; consecutive duplicate
 * points are dropped by the kernel, so this tool refuses repeats up front. The spline has no constraints of
 * its own; the points are ordinary sketch points and can be dimensioned or constrained afterwards.
 * The preview samples the same cubic (`fitCurve`), so it is the real curve, not an approximation.
 */
import { fitCurve } from './splineMath';
import { pointListTool, type PointListState } from './pointListTool';
import type { PreviewShape, Pt } from './types';

export type SplineState = PointListState;

const segments = (pts: Pt[]): PreviewShape[] => pts.slice(1).map((b, i) => ({ kind: 'line' as const, a: pts[i], b }));

export const splineTool = pointListTool({
  id: 'spline',
  minOpen: () => 2,
  minClosed: () => 3,
  entity: (s, closed) => ({ type: 'spline', pts: [...s.pts], ...(closed ? { closed: true } : {}) }),
  preview: (_s, at, cursor, closing) => {
    const through = cursor ? [...at, cursor] : at;
    return segments(fitCurve(through, closing));
  },
});
