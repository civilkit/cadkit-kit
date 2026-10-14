/**
 * Exact curves for free-form body edges. The kernel tessellates a spline edge, so a projection that fits a spline through
 * the tessellation follows the wall only to about a thousandth of a millimetre, which is within the boolean tolerance of a
 * cut that uses the projected outline (the tool wall then crosses the body wall back and forth: the "overlap" failure).
 * An edge made by extruding a sketch spline (wall `<feature>.S.<entity>`) is that sketch's own curve: its fit points, put into
 * world space, reproduce the wall exactly when the projection is a spline through them again.
 */
import { fitCurve } from './splineMath';
import type { BodyEdge, PlaneFrame3 } from './types';

interface Pt { x: number; y: number }
interface FeatureLike {
  id: string; type: string; sketch?: unknown; draft?: unknown; taper?: unknown;
  points?: Array<{ id: string; x: number; y: number }>;
  entities?: Array<{ id: string; type?: string; pts?: unknown; closed?: unknown; construction?: boolean }>;
}

const WALL = /^(.+?)\.S\.([^.~]+)(?:~\d+)?$/;

/** `edges` with `exact` filled for those that are the closed wall edge of an extruded sketch spline. Edges that do not match
 *  (cut by a later feature, tapered, solved to other positions than the sketch holds) stay as they are. */
export function withExactEdges(edges: BodyEdge[], features: FeatureLike[], frameOf: (sketchId: string) => PlaneFrame3 | null): BodyEdge[] {
  const byId = new Map(features.map((f) => [f.id, f]));
  interface Source { fr: PlaneFrame3; fitWorld: number[][]; dense: number[][]; len: number; off: number; group: string }
  const sourceOf = (edge: BodyEdge): Source | null => {
    for (const face of edge.faces ?? []) {
      const m = WALL.exec(face);
      const ext = m ? byId.get(m[1]) : undefined;
      if (!m || !ext || ext.type !== 'extrude' || ext.draft !== undefined || ext.taper !== undefined) continue;
      const sk = byId.get(String(ext.sketch));
      const ent = sk?.entities?.find((e) => e.id === m[2]);
      const fr = sk ? frameOf(sk.id) : null;
      if (!sk || !ent || ent.type !== 'spline' || ent.closed !== true || !Array.isArray(ent.pts) || !fr) continue;
      const pts: Pt[] = [];
      for (const id of ent.pts as string[]) { const p = sk.points?.find((q) => q.id === id); if (p) pts.push({ x: p.x, y: p.y }); }
      if (pts.length !== ent.pts.length || pts.length < 3) continue;
      const world = (p: Pt) => [0, 1, 2].map((k) => fr.o[k] + fr.x[k] * p.x + fr.y[k] * p.y);
      const dense = fitCurve(pts, true, 24).map(world);
      if (dense.length < 8) continue;
      const off = edge.pts[0].reduce((a, v, k) => a + (v - fr.o[k]) * fr.z[k], 0);
      return { fr, fitWorld: pts.map(world), dense, len: polylineLength([...dense, dense[0]]), off, group: `${m[1]}.S.${m[2]}@${Math.round(off * 1e4)}` };
    }
    return null;
  };
  const sources = edges.map((e) => (e.exact || e.pts.length < 4 ? null : sourceOf(e)));
  // the pieces of one outline (same wall, same height) must lie on the fit curve and add up to all of it
  const groups = new Map<string, number[]>();
  sources.forEach((s, i) => { if (s) groups.set(s.group, [...(groups.get(s.group) ?? []), i]); });
  const out = edges.slice();
  for (const idx of groups.values()) {
    const src = sources[idx[0]]!;
    const onCurve = idx.every((i) => edges[i].pts.every((p) => distToLoop(p, src.dense, src.fr.z) <= Math.max(5e-3, 2e-4 * src.len)));
    const total = idx.reduce((a, i) => a + polylineLength(edges[i].pts), 0);
    if (!onCurve || Math.abs(total - src.len) > 2e-3 * src.len) continue;
    const exact = { pts: src.fitWorld, closed: true, pieces: idx.length };
    for (const i of idx) out[i] = { ...edges[i], exact };
  }
  return out;
}

function polylineLength(a: number[][]): number {
  return a.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1], p[2] - a[i - 1][2]) : 0), 0);
}

/** Distance of `p` from the closed polyline `w`, measured in the plane normal to `z` (the wall sits an extrusion height above the sketch). */
function distToLoop(p: number[], w: number[][], z: number[]): number {
  const drop = (v: number[]) => { const d = v[0] * z[0] + v[1] * z[1] + v[2] * z[2]; return [v[0] - z[0] * d, v[1] - z[1] * d, v[2] - z[2] * d]; };
  let best = Infinity;
  for (let i = 0; i < w.length; i++) {
    const a = w[i], b = w[(i + 1) % w.length];
    const ab = drop([b[0] - a[0], b[1] - a[1], b[2] - a[2]]), ap = drop([p[0] - a[0], p[1] - a[1], p[2] - a[2]]);
    const l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1e-12;
    const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / l2));
    best = Math.min(best, Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t));
  }
  return best;
}
