/**
 * Pure curve sampling for the spline tools' PREVIEW. The kernel's own splines are what get solved and
 * extruded; these mirror them so the preview shows the real shape:
 *
 *  - `fitCurve`: the kernel's interpolating `spline`: a C2 cubic through the points, chord-length
 *    parameterised, natural end conditions (open) or periodic (closed), moments from a dense solve.
 *    Consecutive points closer than 1e-9 are dropped, like the kernel does.
 *  - `bsplineCurve`: the kernel's `cvspline`: clamped uniform knots (open) or periodic uniform knots (closed),
 *    degree 1..9, needs at least degree+1 control points (closed: max(3, degree+1)).
 */
import type { Pt } from './types';

const DEDUPE = 1e-9;

/** Dense Gauss-Jordan with partial pivoting; a zero pivot yields 0 for that unknown. */
function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let s = 0; s < n; s++) {
    let piv = s;
    for (let r = s + 1; r < n; r++) if (Math.abs(m[r][s]) > Math.abs(m[piv][s])) piv = r;
    [m[s], m[piv]] = [m[piv], m[s]];
    const d = m[s][s];
    if (Math.abs(d) < 1e-300) continue;
    for (let r = 0; r < n; r++) {
      if (r === s) continue;
      const f = m[r][s] / d;
      if (f !== 0) for (let c = s; c <= n; c++) m[r][c] -= f * m[s][c];
    }
  }
  return m.map((row, i) => (Math.abs(row[i]) > 1e-300 ? row[n] / row[i] : 0));
}

/** Points with consecutive duplicates removed (and a closing duplicate of the first point, when closed). */
export function distinctPoints(pts: Pt[], closed: boolean): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > DEDUPE) out.push(p);
  }
  if (closed && out.length > 2 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) < 1e-12) out.pop();
  return out;
}

/** Whether the kernel would build a fit spline from these points. */
export function fitSplineValid(pts: Pt[], closed: boolean): boolean {
  const n = distinctPoints(pts, closed).length;
  return closed ? n >= 3 : n >= 2;
}

interface FitModel { p: Pt[]; closed: boolean; h: number[]; mx: number[]; my: number[] }

function fitModel(input: Pt[], closed: boolean): FitModel | null {
  const p = distinctPoints(input, closed);
  if (p.length < 2 || (closed && p.length < 3)) return null;
  const o = p.length;
  const spans = closed ? o : o - 1;
  const h = Array.from({ length: spans }, (_, i) => {
    const a = p[i]; const b = p[(i + 1) % o];
    return Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1e-12);
  });
  const moments = (axis: 'x' | 'y'): number[] => {
    if (o === 2 && !closed) return [0, 0];
    const c = p.map((q) => q[axis]);
    const a = Array.from({ length: o }, () => new Array<number>(o).fill(0));
    const d = new Array<number>(o).fill(0);
    for (let u = 0; u < o; u++) {
      if (!closed && (u === 0 || u === o - 1)) { a[u][u] = 1; continue; }
      const mm = (u + o - 1) % o; const nx = (u + 1) % o;
      const g = h[mm]; const k = h[u];
      a[u][mm] += g; a[u][u] += 2 * (g + k); a[u][nx] += k;
      d[u] = 6 * ((c[nx] - c[u]) / k - (c[u] - c[mm]) / g);
    }
    return solve(a, d);
  };
  return { p, closed, h, mx: moments('x'), my: moments('y') };
}

/** Samples of the interpolating spline through `pts`, `perSpan` samples per span, endpoints included. Empty when invalid. */
export function fitCurve(input: Pt[], closed: boolean, perSpan = 16): Pt[] {
  const m = fitModel(input, closed);
  if (!m) return [];
  const { p, h, mx, my } = m;
  const o = p.length;
  const spans = closed ? o : o - 1;
  const out: Pt[] = [];
  for (let s = 0; s < spans; s++) {
    const a = h[s]; const n1 = (s + 1) % o;
    for (let j = 0; j < perSpan; j++) {
      if (j === 0) { out.push({ ...p[s] }); continue; }   // the data points exactly, not their rounded re-evaluation
      const i = (a * j) / perSpan; const l = a - i;
      const at = (d: number, u: number, mc: number, mh: number) =>
        (mc * l * l * l + mh * i * i * i) / (6 * a) + (d / a - (mc * a) / 6) * l + (u / a - (mh * a) / 6) * i;
      out.push({
        x: at(p[s].x, p[n1].x, mx[s], mx[n1]),
        y: at(p[s].y, p[n1].y, my[s], my[n1]),
      });
    }
  }
  out.push({ ...p[closed ? 0 : o - 1] });
  return out;
}

/**
 * First derivative (w.r.t. chord-length parameter) of an OPEN fit spline at its first or last point, exact.
 * Its second derivative there is 0 (natural ends), so the end curvature is 0. Null when the spline is invalid.
 */
export function fitEndDerivative(input: Pt[], which: 'start' | 'end'): Pt | null {
  const m = fitModel(input, false);
  if (!m) return null;
  const { p, h, mx, my } = m;
  const o = p.length;
  const k = which === 'start' ? 0 : o - 2;
  const a = h[k];
  const d = (c: number[], q: 'x' | 'y') => which === 'start'
    ? (p[1][q] - p[0][q]) / a - (a * (2 * c[0] + c[1])) / 6
    : (p[o - 1][q] - p[o - 2][q]) / a + (a * (c[o - 2] + 2 * c[o - 1])) / 6;
  return { x: d(mx, 'x'), y: d(my, 'y') };
}

/** The degree a control-point spline of `n` points can use: at most `degree`, at least 1, and n-1 at most. */
export const clampDegree = (degree: number, n: number): number => Math.max(1, Math.min(Math.round(degree), 9, Math.max(n - 1, 1)));

/** Fewest control points the kernel accepts for this degree. */
export const minCvPoints = (degree: number, closed: boolean): number => (closed ? Math.max(3, degree + 1) : degree + 1);

/** Samples of the B-spline with the kernel's default knots. Empty when invalid (too few points, degree outside 1..9). */
export function bsplineCurve(pts: Pt[], degree: number, closed: boolean, samples = 64): Pt[] {
  const n = pts.length; const p = Math.round(degree);
  if (!(p >= 1 && p <= 9) || n < minCvPoints(p, closed)) return [];
  let u: number[]; let c: Pt[];
  if (closed) {
    c = Array.from({ length: n + p }, (_, i) => pts[i % n]);
    u = Array.from({ length: n + 2 * p + 1 }, (_, j) => j - p);
  } else {
    c = pts;
    u = [...new Array<number>(p).fill(0), ...Array.from({ length: n - p + 1 }, (_, i) => i), ...new Array<number>(p).fill(n - p)];
  }
  const a = u[p]; const b = u[c.length];
  const eval1 = (t: number): Pt => {
    // knot span k with u[k] <= t < u[k+1], the last span closed on the right
    let k = p;
    while (k < c.length - 1 && t >= u[k + 1]) k++;
    const d = c.slice(k - p, k + 1).map((q) => ({ ...q }));
    for (let r = 1; r <= p; r++) {
      for (let j = p; j >= r; j--) {
        const lo = u[k - p + j]; const hi = u[k + 1 + j - r];
        const al = hi - lo === 0 ? 0 : (t - lo) / (hi - lo);
        d[j] = { x: (1 - al) * d[j - 1].x + al * d[j].x, y: (1 - al) * d[j - 1].y + al * d[j].y };
      }
    }
    return d[p];
  };
  const out: Pt[] = [];
  for (let i = 0; i <= samples; i++) out.push(eval1(a + ((b - a) * i) / samples));
  return out;
}

/** Axis-aligned extent of a point list. */
export function extentOf(pts: Pt[]): { min: Pt; max: Pt } {
  const xs = pts.map((q) => q.x); const ys = pts.map((q) => q.y);
  return { min: { x: Math.min(...xs), y: Math.min(...ys) }, max: { x: Math.max(...xs), y: Math.max(...ys) } };
}

/**
 * Where on the interpolating spline through `input` the point nearest `at` is. `span` is the span it lies in (the one from data
 * point `span` to the next, wrapping when closed), `pt` the point on the curve, `vertex` the data point's index when `pt` is
 * (within `tol`) one of the data points. Null when the spline is invalid. Dense sampling, then a local refinement.
 */
export function fitLocate(input: Pt[], closed: boolean, at: Pt, tol = 1e-6): { span: number; pt: Pt; vertex?: number; dist: number } | null {
  const m = fitModel(input, closed);
  if (!m || m.p.length !== input.length) return null;   // the caller passes distinct points, so indexes line up
  const { p, h, mx, my } = m;
  const o = p.length;
  const spans = closed ? o : o - 1;
  const evalAt = (s: number, i: number): Pt => {
    const a = h[s]; const n1 = (s + 1) % o; const l = a - i;
    const f = (d: number, u: number, mc: number, mh: number) =>
      (mc * l * l * l + mh * i * i * i) / (6 * a) + (d / a - (mc * a) / 6) * l + (u / a - (mh * a) / 6) * i;
    return { x: f(p[s].x, p[n1].x, mx[s], mx[n1]), y: f(p[s].y, p[n1].y, my[s], my[n1]) };
  };
  const d2 = (q: Pt) => (q.x - at.x) ** 2 + (q.y - at.y) ** 2;
  const N = 64;
  let best = { s: 0, i: 0, d: Infinity };
  for (let s = 0; s < spans; s++) for (let j = 0; j <= N; j++) {
    const i = (h[s] * j) / N;
    const d = d2(evalAt(s, i));
    if (d < best.d) best = { s, i, d };
  }
  let lo = Math.max(0, best.i - h[best.s] / N), hi = Math.min(h[best.s], best.i + h[best.s] / N);
  for (let k = 0; k < 60; k++) {
    const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3;
    if (d2(evalAt(best.s, a)) < d2(evalAt(best.s, b))) hi = b; else lo = a;
  }
  let s = best.s, i = (lo + hi) / 2;
  let pt = evalAt(s, i);
  // on a data point (this span's start or end) within tol: report that vertex, exactly
  const near = (q: Pt) => Math.hypot(q.x - pt.x, q.y - pt.y) <= tol;
  let vertex: number | undefined;
  if (near(p[s])) vertex = s; else if (near(p[(s + 1) % o])) vertex = (s + 1) % o;
  if (vertex !== undefined) { pt = { ...p[vertex] }; s = vertex === s ? s : (s + 1) % o; i = 0; }
  return { span: s, pt, ...(vertex !== undefined ? { vertex } : {}), dist: Math.sqrt(d2(pt)) };
}
