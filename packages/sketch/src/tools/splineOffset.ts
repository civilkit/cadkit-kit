/**
 * Offset of a fit spline (the kernel's `spline`: a C2 cubic through its points) by a signed distance.
 *
 * The true offset of a cubic is not a cubic, so the result is a new fit spline through points taken on the exact
 * offset curve: the source curve is sampled densely (`fitCurve`), every sample is moved along its left normal by
 * `delta` (positive = left of the walking direction, the same convention as lines and arcs), the offset polyline is
 * resampled by arc length and a fit spline through those points is checked against the polyline; more points are
 * used until it stays within `fitTol` of it (or the point budget runs out).
 *
 * Collapse: an offset towards the inside of a bend whose radius is smaller than the distance folds over itself.
 * It is detected from the curvature (distance x curvature reaches 1) and from the offset polyline crossing itself
 * (two sides of a narrow neck meeting); either returns the hint key `app.sketch.hint.offsetSplineCollapsed`.
 */
import { distinctPoints, fitCurve, fitSplineValid } from './splineMath';
import type { Pt } from './types';

export const SPLINE_COLLAPSED = 'app.sketch.hint.offsetSplineCollapsed';

const PER_SPAN = 24;
const MAX_POINTS = 48;

export interface SplineSamples { pts: Pt[]; closed: boolean }

/** Dense samples of the spline (a closed one without the repeated first point). */
export function sampleSpline(pts: Pt[], closed: boolean, perSpan = PER_SPAN): Pt[] {
  const s = fitCurve(pts, closed, perSpan);
  if (closed && s.length > 1) s.pop();
  return s;
}

function tangents(p: Pt[], closed: boolean): Pt[] {
  const n = p.length;
  return p.map((_, i) => {
    const a = closed ? p[(i + n - 1) % n] : p[Math.max(0, i - 1)];
    const b = closed ? p[(i + 1) % n] : p[Math.min(n - 1, i + 1)];
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    return { x: dx / l, y: dy / l };
  });
}

/** Signed area of the closed polyline: positive when it runs counter-clockwise (then the left side is the inside). */
export function signedArea(p: Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i].x * q.y - q.x * p[i].y; }
  return a / 2;
}

function segCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Does the polyline cross itself (non-neighbouring segments)? */
export function selfIntersects(p: Pt[], closed: boolean): boolean {
  const n = p.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    for (let j = i + 2; j < segs; j++) {
      if (closed && i === 0 && j === segs - 1) continue;
      if (segCross(p[i], p[(i + 1) % n], p[j], p[(j + 1) % n])) return true;
    }
  }
  return false;
}

function resample(p: Pt[], closed: boolean, m: number): Pt[] {
  const n = p.length;
  const segs = closed ? n : n - 1;
  const cum = [0];
  for (let i = 0; i < segs; i++) cum.push(cum[i] + Math.hypot(p[(i + 1) % n].x - p[i].x, p[(i + 1) % n].y - p[i].y));
  const total = cum[segs];
  const out: Pt[] = [];
  let k = 0;
  for (let j = 0; j < m; j++) {
    const target = closed ? (total * j) / m : (total * j) / (m - 1);
    while (k < segs - 1 && cum[k + 1] < target) k++;
    const l = cum[k + 1] - cum[k] || 1;
    const t = Math.min(1, Math.max(0, (target - cum[k]) / l));
    const a = p[k], b = p[(k + 1) % n];
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

function distToPolyline(q: Pt, p: Pt[], closed: boolean): number {
  let best = Infinity;
  const n = p.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = p[i], b = p[(i + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const t = l2 < 1e-18 ? 0 : Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2));
    best = Math.min(best, Math.hypot(q.x - (a.x + t * dx), q.y - (a.y + t * dy)));
  }
  return best;
}

/** The fit points of the offset spline, or the hint key of why there is none. */
export function offsetSplinePoints(input: Pt[], closed: boolean, delta: number): Pt[] | string {
  const src = distinctPoints(input, closed);
  if (!fitSplineValid(src, closed)) return 'app.sketch.hint.pickCurve';
  const dense = sampleSpline(src, closed);
  const n = dense.length;
  const tg = tangents(dense, closed);
  // curvature towards the left (turning left is positive) from the change of direction between neighbours
  for (let i = 0; i < n; i++) {
    const j = closed ? (i + 1) % n : Math.min(i + 1, n - 1), h = closed ? (i + n - 1) % n : Math.max(i - 1, 0);
    if (j === i || h === i) continue;
    const ds = Math.hypot(dense[j].x - dense[h].x, dense[j].y - dense[h].y) / 2 || 1;
    const turn = Math.atan2(tg[h].x * tg[j].y - tg[h].y * tg[j].x, tg[h].x * tg[j].x + tg[h].y * tg[j].y);
    const kappa = turn / (2 * ds);                         // signed, per unit length (the two-step span is 2 ds)
    if (delta * kappa >= 0.98) return SPLINE_COLLAPSED;
  }
  const off = dense.map((q, i) => ({ x: q.x - tg[i].y * delta, y: q.y + tg[i].x * delta }));
  if (selfIntersects(off, closed)) return SPLINE_COLLAPSED;
  const xs = off.map((q) => q.x), ys = off.map((q) => q.y);
  const size = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const tol = Math.max(1e-3, size * 5e-4);
  let m = Math.min(MAX_POINTS, Math.max(src.length, 12));
  for (;;) {
    const cand = resample(off, closed, m);
    const fit = fitCurve(cand, closed, 8);
    const dev = fit.reduce((w, q) => Math.max(w, distToPolyline(q, off, closed)), 0);
    if (dev <= tol || m >= MAX_POINTS) return fitSplineValid(cand, closed) ? cand : SPLINE_COLLAPSED;
    m = Math.min(MAX_POINTS, Math.ceil(m * 1.5));
  }
}

/** Which side of the spline a point is on (+1 left of the walk, -1 right) and how far it is from the curve. */
export function sideOfSpline(pts: Pt[], closed: boolean, p: Pt): { side: 1 | -1; dist: number } {
  const dense = sampleSpline(pts, closed, 12);
  const n = dense.length;
  const segs = closed ? n : n - 1;
  let best = { side: 1 as 1 | -1, dist: Infinity };
  for (let i = 0; i < segs; i++) {
    const a = dense[i], b = dense[(i + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const t = l2 < 1e-18 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    if (d < best.dist) best = { side: dx * (p.y - a.y) - dy * (p.x - a.x) >= 0 ? 1 : -1, dist: d };
  }
  return best;
}
