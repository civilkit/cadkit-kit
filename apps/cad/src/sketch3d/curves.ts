// Curves of a 3D sketch as polylines, for drawing: the natural cubic spline through points (chord-length parameter, the curve the
// kernel's `spline` entity and the sweep along it use), the B-spline of a control-vertex spline (clamped uniform knots, the kernel's
// default), and the arc the kernel reads from centre + start + end. Pure numbers, no DOM.

export type P3 = [number, number, number];

export const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: P3, b: P3): P3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a: P3, k: number): P3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: P3, b: P3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: P3, b: P3): P3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: P3): number => Math.hypot(a[0], a[1], a[2]);
export const dist = (a: P3, b: P3): number => len(sub(a, b));
export const unit = (a: P3): P3 | null => { const l = len(a); return l > 1e-12 ? mul(a, 1 / l) : null; };

/** Points closer than this are one point (the kernel merges them too). */
const MERGE = 1e-9;

/** Samples of the natural cubic spline through `input`, `perSpan` samples per span, the data points exact. Empty below two distinct points. */
export function splineSamples(input: P3[], perSpan = 16): P3[] {
  const p: P3[] = [];
  for (const q of input) if (!p.length || dist(p[p.length - 1], q) > MERGE) p.push(q);
  const n = p.length;
  if (n < 2) return [];
  const h = Array.from({ length: n - 1 }, (_, i) => Math.max(dist(p[i], p[i + 1]), 1e-12));
  // second derivatives per coordinate: natural ends, tridiagonal system solved by the Thomas algorithm
  const m: number[][] = [0, 1, 2].map((c) => {
    const M = new Array<number>(n).fill(0);
    if (n === 2) return M;
    const lo = new Array<number>(n).fill(0), di = new Array<number>(n).fill(0), up = new Array<number>(n).fill(0), rhs = new Array<number>(n).fill(0);
    di[0] = 1; di[n - 1] = 1;
    for (let i = 1; i < n - 1; i++) {
      const a = h[i - 1], b = h[i];
      lo[i] = a; di[i] = 2 * (a + b); up[i] = b;
      rhs[i] = 6 * ((p[i + 1][c] - p[i][c]) / b - (p[i][c] - p[i - 1][c]) / a);
    }
    for (let i = 1; i < n; i++) {
      const w = lo[i] / di[i - 1];
      di[i] -= w * up[i - 1];
      rhs[i] -= w * rhs[i - 1];
    }
    M[n - 1] = rhs[n - 1] / di[n - 1];
    for (let i = n - 2; i >= 0; i--) M[i] = (rhs[i] - up[i] * M[i + 1]) / di[i];
    return M;
  });
  const out: P3[] = [];
  for (let s = 0; s < n - 1; s++) {
    const a = h[s];
    for (let j = 0; j < perSpan; j++) {
      if (j === 0) { out.push([...p[s]] as P3); continue; }
      const i = (a * j) / perSpan, l = a - i;
      const at = (c: number) => (m[c][s] * l * l * l + m[c][s + 1] * i * i * i) / (6 * a) + ((p[s][c] / a) - (m[c][s] * a) / 6) * l + ((p[s + 1][c] / a) - (m[c][s + 1] * a) / 6) * i;
      out.push([at(0), at(1), at(2)]);
    }
  }
  out.push([...p[n - 1]] as P3);
  return out;
}

/** The degree a control-vertex spline can have with `n` points: 1..9, and at most n - 1. */
export const clampDegree = (degree: number, n: number): number => Math.max(1, Math.min(Math.round(degree) || 1, 9, Math.max(n - 1, 1)));

/** Samples of the clamped uniform B-spline of `degree` through the control points `pts`, `samples` samples. Empty when there are too few points. */
export function bsplineSamples(pts: P3[], degree: number, samples = 48): P3[] {
  const n = pts.length, p = Math.round(degree);
  if (!(p >= 1 && p <= 9) || n < p + 1) return [];
  const u = [...new Array<number>(p).fill(0), ...Array.from({ length: n - p + 1 }, (_, i) => i), ...new Array<number>(p).fill(n - p)];
  const a = u[p], b = u[n];
  const at = (t: number): P3 => {
    let k = p;
    while (k < n - 1 && t >= u[k + 1]) k++;
    const d = pts.slice(k - p, k + 1).map((q) => [...q] as P3);
    for (let r = 1; r <= p; r++) {
      for (let j = p; j >= r; j--) {
        const lo = u[k - p + j], hi = u[k + 1 + j - r];
        const al = hi - lo === 0 ? 0 : (t - lo) / (hi - lo);
        d[j] = [0, 1, 2].map((c) => (1 - al) * d[j - 1][c] + al * d[j][c]) as P3;
      }
    }
    return d[p];
  };
  const out: P3[] = [];
  for (let i = 0; i <= samples; i++) out.push(at(a + ((b - a) * i) / samples));
  return out;
}

/** Centre of the circle through three points, or null when they are collinear (or two coincide). */
export function circumcentre(a: P3, b: P3, c: P3): { c: P3; r: number; n: P3 } | null {
  const ab = sub(b, a), ac = sub(c, a);
  const w = cross(ab, ac);
  const w2 = dot(w, w);
  if (w2 < 1e-18 * Math.max(1, dot(ab, ab) * dot(ac, ac))) return null;
  // centre = a + ((|ab|^2 ac - |ac|^2 ab) x w) / (2 |w|^2)
  const t = cross(sub(mul(ac, dot(ab, ab)), mul(ab, dot(ac, ac))), w);
  const ctr = add(a, mul(t, 1 / (2 * w2)));
  return { c: ctr, r: dist(ctr, a), n: mul(w, 1 / Math.sqrt(w2)) };
}

/** Samples of the arc the kernel reads from centre `c`, start `p1` and end `p2`: anticlockwise about (p1 - c) x (p2 - c), the way that is at most half a turn. */
export function arcSamples(c: P3, p1: P3, p2: P3, samples = 32): P3[] {
  const r1 = sub(p1, c), r2 = sub(p2, c);
  const l1 = len(r1), l2 = len(r2);
  if (l1 < 1e-9 || l2 < 1e-9) return [];
  const w = cross(r1, r2), lw = len(w);
  if (lw <= 1e-9 * l1 * l2) return [];
  const nn = mul(w, 1 / lw), uu = mul(r1, 1 / l1), vv = cross(nn, uu);
  const ang = Math.atan2(lw, dot(r1, r2));
  const out: P3[] = [];
  for (let i = 0; i <= samples; i++) {
    const th = (ang * i) / samples;
    out.push(add(c, add(mul(uu, l1 * Math.cos(th)), mul(vv, l1 * Math.sin(th)))));
  }
  out[0] = [...p1] as P3; out[samples] = [...p2] as P3;
  return out;
}

/** The sweep (anticlockwise about `n`) from `a` to `c` around the circle of centre `ctr`, in (0, 2 pi). */
export function sweepAngle(ctr: P3, n: P3, a: P3, c: P3): number {
  const ra = sub(a, ctr), rc = sub(c, ctr);
  const u = unit(ra);
  if (!u) return 0;
  const v = cross(n, u);
  let th = Math.atan2(dot(rc, v), dot(rc, u));
  if (th < 0) th += 2 * Math.PI;
  return th;
}
