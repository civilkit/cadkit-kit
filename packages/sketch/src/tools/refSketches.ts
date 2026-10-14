/**
 * Curves of the document's other sketches as reference edges. A sketch that an extrude has used is drawn quietly (or not at
 * all) and has no pickable geometry in the 3D view, yet it is the natural thing to offset or project. This turns the
 * non-construction, non-projected curves of every other sketch into world-space polylines, in the same shape as a body
 * edge (`BodyEdge`), so Offset and Project pick, highlight, chain and project them exactly like the edges of the body.
 *
 * Curves are sampled densely (lines by their two ends, arcs and circles by angle, fit splines by `fitCurve`, control-point
 * splines by `bsplineCurve`). A curve that coincides end for end with an existing body edge is left out so the body edge
 * (the real one) is the only candidate there.
 */
import { arcPolyline } from './builders-arcs';
import { bsplineCurve, fitCurve } from './splineMath';
import type { BodyEdge, Pt } from './types';

export interface SketchFrameLike { o: ArrayLike<number>; x: ArrayLike<number>; y: ArrayLike<number> }
export interface SketchFeatureLike {
  id: string; type: string;
  points?: Array<{ id: string; x: number; y: number }>;
  entities?: Array<{ id: string; type?: string; construction?: boolean; ext?: boolean; [k: string]: unknown }>;
}

const TAU = Math.PI * 2;

function sample(e: NonNullable<SketchFeatureLike['entities']>[number], pt: (id: unknown) => Pt | undefined): Pt[] | null {
  if (e.type === 'line') { const a = pt(e.p1), b = pt(e.p2); return a && b ? [a, b] : null; }
  if (e.type === 'circle') {
    const c = pt(e.c); const r = Number(e.r);
    if (!c || !(r > 0)) return null;
    return Array.from({ length: 97 }, (_, i) => ({ x: c.x + r * Math.cos((TAU * i) / 96), y: c.y + r * Math.sin((TAU * i) / 96) }));
  }
  if (e.type === 'arc') {
    const c = pt(e.c), p1 = pt(e.p1), p2 = pt(e.p2);
    if (!c || !p1 || !p2) return null;
    const r = Math.hypot(p1.x - c.x, p1.y - c.y);
    const a0 = Math.atan2(p1.y - c.y, p1.x - c.x);
    const sw = ((Math.atan2(p2.y - c.y, p2.x - c.x) - a0) % TAU + TAU) % TAU || TAU;
    return arcPolyline(c, r, a0, sw).flatMap((s, i) => (i === 0 ? [(s as { a: Pt }).a, (s as { b: Pt }).b] : [(s as { b: Pt }).b]));
  }
  if (e.type === 'spline' || e.type === 'cvspline') {
    const pts = (Array.isArray(e.pts) ? e.pts : []).map(pt);
    if (pts.some((p) => !p)) return null;
    const closed = e.closed === true;
    const s = e.type === 'spline' ? fitCurve(pts as Pt[], closed, 12) : bsplineCurve(pts as Pt[], Number(e.degree ?? 3), closed, 96);
    return s.length >= 2 ? s : null;
  }
  return null;
}

/** Reference edges (world space) of every sketch in `features` except `excludeId`, using `frameOf` for each sketch's plane. */
export function sketchReferenceEdges(
  features: SketchFeatureLike[], frameOf: (sketchId: string) => SketchFrameLike | null, excludeId: string | null, bodyEdges: BodyEdge[] = [],
): BodyEdge[] {
  const out: BodyEdge[] = [];
  const ends = (pts: number[][]) => [pts[0], pts[pts.length - 1]];
  const same = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= 1e-4;
  for (const f of features) {
    if (f.type !== 'sketch' || f.id === excludeId) continue;
    const fr = frameOf(f.id);
    if (!fr) continue;
    const byId = new Map((f.points ?? []).map((p) => [p.id, { x: p.x, y: p.y }]));
    const pt = (id: unknown) => byId.get(String(id));
    for (const e of f.entities ?? []) {
      if (e.construction || e.ext) continue;
      const poly = sample(e, pt);
      if (!poly) continue;
      const pts = poly.map((p) => [0, 1, 2].map((k) => fr.o[k] + fr.x[k] * p.x + fr.y[k] * p.y));
      const [s, t] = ends(pts);
      if (bodyEdges.some((b) => b.pts.length >= 2 && ((same(b.pts[0], s) && same(b.pts[b.pts.length - 1], t)) || (same(b.pts[0], t) && same(b.pts[b.pts.length - 1], s))))) continue;
      out.push({ key: `${f.id}.${e.id}`, pts });
    }
  }
  return out;
}
