// Repositioning a shape in its sketch plane: the numbers of a move (snapping, inference guides, grid, one-axis lock),
// the candidates a move snaps to (read from the body on screen with the SAME snap code the Catalog placement uses:
// corners, circle (hole rim) centres, edge midpoints, face centres), and the shared-sketch check. Pure: no DOM, no kernel.
import { circleCentre, snapTo, type EdgeLike, type Snap, type SnapKind, type V3 } from '../catalog/geometry';
import type { Box, Frame3 } from './sizeBox';

export interface MoveMods { shift?: boolean; ctrl?: boolean; alt?: boolean }
/** A point of the sketch plane a move can snap the shape's centre to, or align one of its sides with. */
export interface MovePoint { u: number; v: number; kind: SnapKind }
export interface MoveCands {
  pts: MovePoint[];
  /** The extent of the planar geometry the shape sits on (its host face), for edge alignment and the distance-from-edge helper. */
  host: { u0: number; u1: number; v0: number; v1: number } | null;
}
type Rect = Pick<Box, 'u0' | 'u1' | 'v0' | 'v1'>;
export const NO_CANDS: MoveCands = { pts: [], host: null };

export interface MoveResult {
  du: number; dv: number;
  /** What caught the shape: a point snap (centre on a corner / hole centre / midpoint / face centre / feature), an alignment on one axis, the grid, or nothing. */
  snap: SnapKind | 'align' | 'grid' | 'axis' | null;
  /** Dotted inference lines in the sketch plane, [u0, v0, u1, v1]. */
  guides: Array<[number, number, number, number]>;
}

const inBox = (u: number, v: number, b: Box, e: number): boolean => u >= b.u0 - e && u <= b.u1 + e && v >= b.v0 - e && v <= b.v1 + e;
const COPLANAR = 1e-3;

/**
 * The snap points on the shape's plane: for every edge of the body that lies IN that plane (so a hole's rim or the face's own
 * outline, not an edge of the wall below) its ends, its midpoint and, for a circle, its centre; the centre of the plane's
 * geometry (the face centre); and the centres of other shapes on the same plane. Edges inside the shape's own footprint
 * are skipped, otherwise the shape would snap to itself.
 */
export function moveCandidates(frame: Frame3, own: Box, edges: EdgeLike[], others: Array<{ u: number; v: number }>): MoveCands {
  const toUV = (p: ArrayLike<number>): { u: number; v: number; d: number } => {
    const r = [p[0] - frame.o[0], p[1] - frame.o[1], p[2] - frame.o[2]];
    return { u: r[0] * frame.x[0] + r[1] * frame.x[1] + r[2] * frame.x[2], v: r[0] * frame.y[0] + r[1] * frame.y[1] + r[2] * frame.y[2], d: r[0] * frame.z[0] + r[1] * frame.z[1] + r[2] * frame.z[2] };
  };
  const pts: MovePoint[] = [];
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const e of edges) {
    const poly = e.pts ?? [];
    if (poly.length < 2) continue;
    const uv = poly.map(toUV);
    if (!uv.every((q) => Math.abs(q.d) < COPLANAR)) continue;
    for (const q of uv) { u0 = Math.min(u0, q.u); u1 = Math.max(u1, q.u); v0 = Math.min(v0, q.v); v1 = Math.max(v1, q.v); }
    if (uv.every((q) => inBox(q.u, q.v, own, 1e-3))) continue;           // the shape's own outline
    const c = circleCentre(poly);
    if (c) { const q = toUV(c); pts.push({ u: q.u, v: q.v, kind: 'circle' }); continue; }
    if (e.mid) { const q = toUV(e.mid); pts.push({ u: q.u, v: q.v, kind: 'midpoint' }); }
    for (const q of [uv[0], uv[uv.length - 1]]) pts.push({ u: q.u, v: q.v, kind: 'vertex' });
  }
  const host = Number.isFinite(u0) ? { u0, u1, v0, v1 } : null;
  if (host) pts.push({ u: (host.u0 + host.u1) / 2, v: (host.v0 + host.v1) / 2, kind: 'center' });
  for (const o of others) pts.push({ u: o.u, v: o.v, kind: 'feature' });
  return { pts, host };
}

const GRID = (v: number, step: number): number => (step > 0 ? Math.round(v / step) * step : v);

/**
 * Where a move by (du, dv) lands. Shift keeps the larger component only (one axis); Ctrl rounds the move to the grid step;
 * Alt switches snapping off. Otherwise the shape's centre snaps to a point of `cands` within `tol` (same preference order as
 * the Catalog: corner, circle centre, edge midpoint, face centre); failing that each axis aligns the shape's centre or a side
 * with a candidate's coordinate (an inference guide is returned for it) and with the host face's edges.
 */
export function resolveMove(box: Box, raw: { du: number; dv: number }, mods: MoveMods, cands: MoveCands, tol: number, step: number): MoveResult {
  let { du, dv } = raw;
  const guides: MoveResult['guides'] = [];
  if (mods.shift) { if (Math.abs(du) >= Math.abs(dv)) dv = 0; else du = 0; }
  if (mods.ctrl) return { du: GRID(du, step), dv: GRID(dv, step), snap: 'grid', guides };
  if (mods.alt) return { du, dv, snap: null, guides };
  const cu = (box.u0 + box.u1) / 2 + du, cv = (box.v0 + box.v1) / 2 + dv;
  if (!mods.shift) {
    const snaps: Snap[] = cands.pts.map((p) => ({ point: [p.u, p.v, 0] as V3, kind: p.kind }));
    const s = snapTo([cu, cv, 0], snaps, tol);
    if (s) return { du: du + (s.point[0] - cu), dv: dv + (s.point[1] - cv), snap: s.kind, guides };
  }
  // per-axis alignment: centre or side against a candidate coordinate / a host edge
  const axis = (lo: number, hi: number, move: number, vals: number[]): { shift: number; at: number } | null => {
    let best: { shift: number; at: number } | null = null;
    for (const ref of [(lo + hi) / 2 + move, lo + move, hi + move]) for (const a of vals) {
      const d = a - ref;
      if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.shift))) best = { shift: d, at: a };
    }
    return best;
  };
  const us = cands.pts.map((p) => p.u), vs = cands.pts.map((p) => p.v);
  if (cands.host) { us.push(cands.host.u0, cands.host.u1); vs.push(cands.host.v0, cands.host.v1); }
  const au = mods.shift && du === 0 ? null : axis(box.u0, box.u1, du, us);
  const av = mods.shift && dv === 0 ? null : axis(box.v0, box.v1, dv, vs);
  if (au) du += au.shift;
  if (av) dv += av.shift;
  const vlo = box.v0 + dv, vhi = box.v1 + dv, ulo = box.u0 + du, uhi = box.u1 + du;
  if (au) {
    const near = cands.pts.filter((p) => Math.abs(p.u - au.at) < 1e-6).map((p) => p.v);
    if (cands.host && (Math.abs(cands.host.u0 - au.at) < 1e-6 || Math.abs(cands.host.u1 - au.at) < 1e-6)) near.push(cands.host.v0, cands.host.v1);
    const a = Math.min(vlo, ...near), b = Math.max(vhi, ...near);
    guides.push([au.at, a, au.at, b]);
  }
  if (av) {
    const near = cands.pts.filter((p) => Math.abs(p.v - av.at) < 1e-6).map((p) => p.u);
    if (cands.host && (Math.abs(cands.host.v0 - av.at) < 1e-6 || Math.abs(cands.host.v1 - av.at) < 1e-6)) near.push(cands.host.u0, cands.host.u1);
    const a = Math.min(ulo, ...near), b = Math.max(uhi, ...near);
    guides.push([a, av.at, b, av.at]);
  }
  return { du, dv, snap: au || av ? 'align' : mods.shift ? 'axis' : null, guides };
}

/** The four edges of the host face as lines in the sketch plane, for "distance from edge": which side of the shape faces each, and how far apart they are now. */
export type EdgeSide = 'left' | 'right' | 'bottom' | 'top';
export const EDGE_SIDES: EdgeSide[] = ['left', 'right', 'bottom', 'top'];
/** Current clear distance from the shape's nearest side to a host edge (null without a host face). */
export function edgeDistance(box: Rect, host: MoveCands['host'], side: EdgeSide): number | null {
  if (!host) return null;
  return side === 'left' ? box.u0 - host.u0 : side === 'right' ? host.u1 - box.u1 : side === 'bottom' ? box.v0 - host.v0 : host.v1 - box.v1;
}
/** The move (du, dv) that puts the shape `dist` away from that edge. */
export function moveToEdgeDistance(box: Rect, host: NonNullable<MoveCands['host']>, side: EdgeSide, dist: number): { du: number; dv: number } {
  const cur = edgeDistance(box, host, side)!;
  const d = dist - cur;
  return side === 'left' ? { du: d, dv: 0 } : side === 'right' ? { du: -d, dv: 0 } : side === 'bottom' ? { du: 0, dv: d } : { du: 0, dv: -d };
}

/** The grid step a nudge or Ctrl move uses: 1 mm for ordinary parts, 5 above 100 mm, 10 above a metre. */
export const gridStep = (box: Box): number => { const m = Math.max(box.u1 - box.u0, box.v1 - box.v0); return m < 100 ? 1 : m < 1000 ? 5 : 10; };
