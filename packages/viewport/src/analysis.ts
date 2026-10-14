// Surface analysis, all on the client from the mesh the kernel sends: curvature maps (Gaussian and mean) from the kernel's
// vertex normals, draft analysis against a pull direction, and a curvature comb for edges. Zebra stripes are a shader (see
// viewport.ts); the numbers here are pure so they are tested without WebGL.
import type { FaceRange } from './meshgeom';

export type AnalysisMode = 'off' | 'zebra' | 'gaussian' | 'mean' | 'draft';
export const ANALYSIS_MODES: readonly AnalysisMode[] = ['off', 'zebra', 'gaussian', 'mean', 'draft'];

export interface AnalysisOptions {
  mode: AnalysisMode;
  /** Curvature comb on the edges. */
  comb: boolean;
  /** Comb tooth length multiplier (1 = the longest tooth is 12 percent of the model size). */
  combScale: number;
  /** Pull direction for draft analysis (unit-ish; normalised on use). */
  pull: [number, number, number];
  /** Smallest draft angle in degrees that counts as enough. */
  draftMin: number;
  /** Zebra stripes per unit of reflected direction. */
  zebraDensity: number;
}
export const DEFAULT_ANALYSIS: AnalysisOptions = { mode: 'off', comb: false, combScale: 1, pull: [0, 1, 0], draftMin: 1, zebraDensity: 12 };

/** What the legend shows: the colour bar's ends and unit. `bands` lists the discrete classes for draft. */
export interface Legend { mode: AnalysisMode; min: number; max: number; unit: string; bands?: Array<{ color: [number, number, number]; label: string }> }

export function sanitizeAnalysis(raw: unknown): AnalysisOptions {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const pull = Array.isArray(r.pull) && r.pull.length === 3 && r.pull.every((x) => typeof x === 'number' && isFinite(x)) && Math.hypot(...(r.pull as number[])) > 1e-9 ? (r.pull as [number, number, number]) : DEFAULT_ANALYSIS.pull;
  return {
    mode: (ANALYSIS_MODES as readonly unknown[]).includes(r.mode) ? (r.mode as AnalysisMode) : 'off',
    comb: r.comb === true,
    combScale: num(r.combScale, 1, 0.1, 10),
    pull,
    draftMin: num(r.draftMin, 1, 0, 45),
    zebraDensity: num(r.zebraDensity, 12, 2, 60),
  };
}

// ---- curvature ----

/**
 * Principal curvatures at each vertex of a non-indexed triangle soup from its vertex normals. Per triangle the shape operator
 * S (dn = S dp, symmetric 2x2 in the triangle's tangent frame) is solved by least squares from two edges; a vertex takes the
 * area-weighted mean of the triangles that meet at it within the same face (faces are welded by position inside their range).
 * A sphere of radius R with outward normals gives k1 = k2 = 1/R.
 */
export function vertexCurvatures(positions: ArrayLike<number>, normals: ArrayLike<number>, ranges: FaceRange[]): { k1: Float32Array; k2: Float32Array } {
  const nv = positions.length / 3;
  const k1 = new Float32Array(nv), k2 = new Float32Array(nv);
  const faces = ranges.length ? ranges : [{ name: '', start: 0, count: nv }];
  for (const r of faces) {
    // the tensors of different triangles live in different frames, so they are averaged as 3x3 matrices (6 numbers)
    const acc = new Map<string, { m: number[]; w: number }>();
    const keyOf = (v: number) => `${Math.round(positions[v * 3] * 1e3)},${Math.round(positions[v * 3 + 1] * 1e3)},${Math.round(positions[v * 3 + 2] * 1e3)}`;
    const tri: Array<{ v: number[]; m: number[]; w: number }> = [];
    for (let v = r.start; v + 2 < r.start + r.count; v += 3) {
      const s = shapeOperator(positions, normals, v);
      if (s) tri.push({ v: [v, v + 1, v + 2], m: s.m, w: s.area });
    }
    for (const t of tri) for (const v of t.v) {
      const k = keyOf(v);
      const e = acc.get(k) ?? { m: [0, 0, 0, 0, 0, 0], w: 0 };
      for (let q = 0; q < 6; q++) e.m[q] += t.m[q] * t.w;
      e.w += t.w;
      acc.set(k, e);
    }
    for (const t of tri) for (const v of t.v) {
      const e = acc.get(keyOf(v))!;
      const m = e.m.map((x) => x / e.w);   // xx, xy, xz, yy, yz, zz
      const n = [normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]];
      const nl = Math.hypot(n[0], n[1], n[2]) || 1;
      const nn = n.map((x) => x / nl);
      const h = Math.abs(nn[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      let u = [nn[1] * h[2] - nn[2] * h[1], nn[2] * h[0] - nn[0] * h[2], nn[0] * h[1] - nn[1] * h[0]];
      const ul = Math.hypot(u[0], u[1], u[2]);
      u = u.map((x) => x / ul);
      const w2 = [nn[1] * u[2] - nn[2] * u[1], nn[2] * u[0] - nn[0] * u[2], nn[0] * u[1] - nn[1] * u[0]];
      const quad = (p: number[], q: number[]) => p[0] * (m[0] * q[0] + m[1] * q[1] + m[2] * q[2]) + p[1] * (m[1] * q[0] + m[3] * q[1] + m[4] * q[2]) + p[2] * (m[2] * q[0] + m[4] * q[1] + m[5] * q[2]);
      const a = quad(u, u), b = quad(u, w2), c = quad(w2, w2);
      const mean = (a + c) / 2, d = Math.hypot((a - c) / 2, b);
      k1[v] = mean + d; k2[v] = mean - d;
    }
  }
  return { k1, k2 };
}

/** The shape operator of the triangle starting at vertex `v` as a symmetric 3x3 (xx, xy, xz, yy, yz, zz), and its area; null for a degenerate triangle. */
function shapeOperator(p: ArrayLike<number>, n: ArrayLike<number>, v: number): { m: number[]; area: number } | null {
  const at = (a: ArrayLike<number>, i: number): [number, number, number] => [a[(v + i) * 3], a[(v + i) * 3 + 1], a[(v + i) * 3 + 2]];
  const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const p0 = at(p, 0), e1 = sub(at(p, 1), p0), e2 = sub(at(p, 2), p0);
  const n0 = at(n, 0), dn1 = sub(at(n, 1), n0), dn2 = sub(at(n, 2), n0);
  const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const len = Math.hypot(cr[0], cr[1], cr[2]);
  if (len < 1e-12) return null;
  const fn = [cr[0] / len, cr[1] / len, cr[2] / len];
  const l1 = Math.hypot(e1[0], e1[1], e1[2]);
  const t1 = [e1[0] / l1, e1[1] / l1, e1[2] / l1];
  const t2 = [fn[1] * t1[2] - fn[2] * t1[1], fn[2] * t1[0] - fn[0] * t1[2], fn[0] * t1[1] - fn[1] * t1[0]];
  const a = [[dot(e1, t1), dot(e1, t2)], [dot(e2, t1), dot(e2, t2)]];
  const b = [[dot(dn1, t1), dot(dn1, t2)], [dot(dn2, t1), dot(dn2, t2)]];
  // S a_i = b_i, i = 1, 2, with S = [[A, B], [B, C]]: rows [ax ay 0], [0 ax ay] for the unknowns (A, B, C)
  const rows: number[][] = [], rhs: number[] = [];
  for (let i = 0; i < 2; i++) { rows.push([a[i][0], a[i][1], 0], [0, a[i][0], a[i][1]]); rhs.push(b[i][0], b[i][1]); }
  const ata = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], atb = [0, 0, 0];
  rows.forEach((r, k) => { for (let i = 0; i < 3; i++) { atb[i] += r[i] * rhs[k]; for (let j = 0; j < 3; j++) ata[i][j] += r[i] * r[j]; } });
  const x = solve3(ata, atb);
  if (!x) return null;
  // S = A t1 t1' + B (t1 t2' + t2 t1') + C t2 t2'
  const [A, B, C] = x;
  const m = [
    A * t1[0] * t1[0] + 2 * B * t1[0] * t2[0] + C * t2[0] * t2[0],
    A * t1[0] * t1[1] + B * (t1[0] * t2[1] + t2[0] * t1[1]) + C * t2[0] * t2[1],
    A * t1[0] * t1[2] + B * (t1[0] * t2[2] + t2[0] * t1[2]) + C * t2[0] * t2[2],
    A * t1[1] * t1[1] + 2 * B * t1[1] * t2[1] + C * t2[1] * t2[1],
    A * t1[1] * t1[2] + B * (t1[1] * t2[2] + t2[1] * t1[2]) + C * t2[1] * t2[2],
    A * t1[2] * t1[2] + 2 * B * t1[2] * t2[2] + C * t2[2] * t2[2],
  ];
  return { m, area: len / 2 };
}
function solve3(m: number[][], b: number[]): [number, number, number] | null {
  const a = m.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-14) return null;
    [a[c], a[p]] = [a[p], a[c]];
    for (let r = c + 1; r < 3; r++) { const f = a[r][c] / a[c][c]; for (let k = c; k < 4; k++) a[r][k] -= f * a[c][k]; }
  }
  const x: number[] = [0, 0, 0];
  for (let r = 2; r >= 0; r--) { let s = a[r][3]; for (let k = r + 1; k < 3; k++) s -= a[r][k] * x[k]; x[r] = s / a[r][r]; }
  return x as [number, number, number];
}

export const gaussianOf = (k1: Float32Array, k2: Float32Array): Float32Array => k1.map((k, i) => k * k2[i]);
export const meanOf = (k1: Float32Array, k2: Float32Array): Float32Array => k1.map((k, i) => (k + k2[i]) / 2);

/** The value below which `q` (0..1) of the absolute values lie: the colour scale's end, so a few sharp spots do not wash out the rest. */
export function percentileAbs(values: ArrayLike<number>, q = 0.95): number {
  const a = Array.from(values, (v) => Math.abs(v)).filter((v) => isFinite(v)).sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.floor(q * a.length))] : 0;
}

/** Blue (negative) through white (zero) to red (positive) for t in [-1, 1]. */
export function diverging(t: number): [number, number, number] {
  const x = Math.max(-1, Math.min(1, t));
  const end = x < 0 ? [0.12, 0.33, 0.85] : [0.88, 0.18, 0.14];
  const u = Math.abs(x);
  return [1 + (end[0] - 1) * u, 1 + (end[1] - 1) * u, 1 + (end[2] - 1) * u];
}

/** Per-vertex colours for a curvature map, and its legend. Zero curvature is white. */
export function curvatureColors(values: ArrayLike<number>, mode: 'gaussian' | 'mean'): { colors: Float32Array; legend: Legend } {
  const range = percentileAbs(values) || 1e-9;
  const colors = new Float32Array(values.length * 3);
  for (let i = 0; i < values.length; i++) {
    const c = diverging(values[i] / range);
    colors[i * 3] = c[0]; colors[i * 3 + 1] = c[1]; colors[i * 3 + 2] = c[2];
  }
  return { colors, legend: { mode, min: -range, max: range, unit: mode === 'mean' ? '1/mm' : '1/mm²' } };
}

// ---- draft ----

export const DRAFT_COLORS = { up: [0.25, 0.7, 0.35], down: [0.25, 0.5, 0.9], low: [0.9, 0.25, 0.2] } as const;

/** Draft angle in degrees of a face with unit normal `n` against pull direction `d` (the angle of the face to the pull; 90 is perpendicular to it). */
export function draftAngle(n: ArrayLike<number>, i: number, d: number[]): number {
  const dot = n[i] * d[0] + n[i + 1] * d[1] + n[i + 2] * d[2];
  const len = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
  return (Math.asin(Math.max(-1, Math.min(1, dot / len))) * 180) / Math.PI;
}
/** Colours by draft: green faces look along the pull with at least `min` degrees, blue the opposite way, red too steep (too little draft). */
export function draftColors(normals: ArrayLike<number>, pull: [number, number, number], min: number): { colors: Float32Array; legend: Legend } {
  const l = Math.hypot(...pull) || 1;
  const d = [pull[0] / l, pull[1] / l, pull[2] / l];
  const nv = normals.length / 3;
  const colors = new Float32Array(nv * 3);
  for (let v = 0; v < nv; v++) {
    const a = draftAngle(normals, v * 3, d);
    const c = a >= min ? DRAFT_COLORS.up : a <= -min ? DRAFT_COLORS.down : DRAFT_COLORS.low;
    colors[v * 3] = c[0]; colors[v * 3 + 1] = c[1]; colors[v * 3 + 2] = c[2];
  }
  return {
    colors,
    legend: { mode: 'draft', min: -90, max: 90, unit: '°', bands: [
      { color: [...DRAFT_COLORS.up], label: `draft ≥ ${min}°` }, { color: [...DRAFT_COLORS.low], label: `|draft| < ${min}°` }, { color: [...DRAFT_COLORS.down], label: `draft ≤ -${min}° (other half)` },
    ] },
  };
}

// ---- curvature comb ----

/**
 * Line segments of a curvature comb over polylines: at each vertex a tooth of length |k| * scale pointing away from the centre
 * of curvature, and a segment joining the tooth tips. The longest tooth is `0.12 * size * scaleFactor`, so any model size reads
 * the same. Straight stretches draw nothing. `step` keeps every n-th vertex.
 */
export function combSegments(polys: number[][][], size: number, scaleFactor = 1, step = 1): { segments: Float32Array; maxCurvature: number } {
  const teeth: Array<{ line: number; i: number; p: number[]; k: number[] }> = [];
  let maxK = 0;
  polys.forEach((pts, line) => {
    for (let i = 1; i + 1 < pts.length; i += step) {
      const a = pts[i - step < 0 ? 0 : i - step], b = pts[i], c = pts[Math.min(pts.length - 1, i + step)];
      const ab = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), bc = Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]);
      if (ab < 1e-9 || bc < 1e-9) continue;
      const f = 2 / (ab + bc);
      const k = [0, 1, 2].map((q) => f * ((c[q] - b[q]) / bc - (b[q] - a[q]) / ab));
      const m = Math.hypot(k[0], k[1], k[2]);
      if (m > maxK) maxK = m;
      teeth.push({ line, i, p: b, k });
    }
  });
  if (maxK < 1e-9) return { segments: new Float32Array(0), maxCurvature: 0 };
  const unit = (0.12 * size * scaleFactor) / maxK;
  const out: number[] = [];
  let prev: { line: number; tip: number[] } | null = null;
  for (const t of teeth) {
    const tip = [t.p[0] - t.k[0] * unit, t.p[1] - t.k[1] * unit, t.p[2] - t.k[2] * unit];
    if (Math.hypot(t.k[0], t.k[1], t.k[2]) > maxK * 1e-3) out.push(...t.p, ...tip);
    if (prev && prev.line === t.line) out.push(...prev.tip, ...tip);
    prev = { line: t.line, tip };
  }
  return { segments: Float32Array.from(out), maxCurvature: maxK };
}
