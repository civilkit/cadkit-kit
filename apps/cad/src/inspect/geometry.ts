// Pure vector and polyline maths for the Measure tool and the Section view. No DOM, no kernel.
export type V3 = number[];

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const dist = (a: V3, b: V3): number => len(sub(a, b));
export const mid = (a: V3, b: V3): V3 => scale(add(a, b), 0.5);
export const unit = (a: V3): V3 => { const l = len(a); return l > 1e-12 ? scale(a, 1 / l) : [0, 0, 0]; };

/** A closest-approach result: the distance and the point on each shape. */
export interface Closest { d: number; a: V3; b: V3 }

/** Closest point on the segment a-b to p. */
export function closestOnSegment(p: V3, a: V3, b: V3): V3 {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < 1e-24) return a;
  const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / l2));
  return add(a, scale(ab, t));
}

/** Closest points of two segments (Ericson, Real-Time Collision Detection). */
export function segSeg(p1: V3, q1: V3, p2: V3, q2: V3): Closest {
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s: number, t: number;
  if (a < 1e-24 && e < 1e-24) { s = 0; t = 0; }
  else if (a < 1e-24) { s = 0; t = Math.min(1, Math.max(0, f / e)); }
  else {
    const c = dot(d1, r);
    if (e < 1e-24) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
    else {
      const b = dot(d1, d2), denom = a * e - b * b;
      s = denom > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  const pa = add(p1, scale(d1, s)), pb = add(p2, scale(d2, t));
  return { d: dist(pa, pb), a: pa, b: pb };
}

/** Closest approach between a point and a polyline. */
export function pointPolyline(p: V3, line: V3[]): Closest {
  let best: Closest = { d: Infinity, a: p, b: line[0] ?? p };
  if (line.length === 1) return { d: dist(p, line[0]), a: p, b: line[0] };
  for (let i = 0; i + 1 < line.length; i++) {
    const q = closestOnSegment(p, line[i], line[i + 1]);
    const d = dist(p, q);
    if (d < best.d) best = { d, a: p, b: q };
  }
  return best;
}

/** Closest approach between two polylines (each at least one point). */
export function polylinePolyline(A: V3[], B: V3[]): Closest {
  if (A.length === 1) return pointPolyline(A[0], B);
  if (B.length === 1) { const c = pointPolyline(B[0], A); return { d: c.d, a: c.b, b: c.a }; }
  let best: Closest = { d: Infinity, a: A[0], b: B[0] };
  for (let i = 0; i + 1 < A.length; i++) {
    for (let j = 0; j + 1 < B.length; j++) {
      const c = segSeg(A[i], A[i + 1], B[j], B[j + 1]);
      if (c.d < best.d) best = c;
    }
  }
  return best;
}

export function polylineLength(pts: V3[]): number {
  let l = 0;
  for (let i = 0; i + 1 < pts.length; i++) l += dist(pts[i], pts[i + 1]);
  return l;
}

/** Angle between two directions in degrees, 0..180. */
export function angleDeg(u: V3, v: V3): number {
  const lu = len(u), lv = len(v);
  if (lu < 1e-12 || lv < 1e-12) return 0;
  return (Math.acos(Math.min(1, Math.max(-1, dot(u, v) / (lu * lv)))) * 180) / Math.PI;
}

/** Angle between two undirected lines in degrees, 0..90 (an edge has no direction of its own). */
export function lineAngleDeg(u: V3, v: V3): number {
  const a = angleDeg(u, v);
  return a > 90 ? 180 - a : a;
}

/** The mesh of a body as the viewer holds it: triangle soup (three xyz vertices per triangle), the face of each triangle. */
export interface FaceMesh { positions: ArrayLike<number>; triFace: ArrayLike<number>; faceIds: string[] }

function* trianglesOf(mesh: FaceMesh, faceId: string): Generator<[V3, V3, V3]> {
  const fi = mesh.faceIds.indexOf(faceId);
  if (fi < 0) return;
  const P = mesh.positions;
  for (let t = 0; t < mesh.triFace.length; t++) {
    if (mesh.triFace[t] !== fi) continue;
    const o = t * 9;
    yield [[P[o], P[o + 1], P[o + 2]], [P[o + 3], P[o + 4], P[o + 5]], [P[o + 6], P[o + 7], P[o + 8]]];
  }
}

/** Area of a face from its triangles (exact for planar faces, a close estimate for curved ones). */
export function faceAreaFromMesh(mesh: FaceMesh, faceId: string): number {
  let a = 0;
  for (const [p, q, r] of trianglesOf(mesh, faceId)) a += len(cross(sub(q, p), sub(r, p))) / 2;
  return a;
}

/** The plane of a face from its triangles: area-weighted unit normal and centroid, and whether the face is flat (every triangle within `tolDeg`). */
export function facePlane(mesh: FaceMesh, faceId: string, tolDeg = 0.5): { normal: V3; point: V3; flat: boolean } | null {
  let n: V3 = [0, 0, 0], c: V3 = [0, 0, 0], area = 0;
  const tris: Array<[V3, number]> = [];
  for (const [p, q, r] of trianglesOf(mesh, faceId)) {
    const nn = cross(sub(q, p), sub(r, p));
    const a = len(nn) / 2;
    if (a < 1e-12) continue;
    n = add(n, nn);
    c = add(c, scale(add(add(p, q), r), a / 3));
    area += a;
    tris.push([unit(nn), a]);
  }
  if (area <= 0) return null;
  const normal = unit(n);
  const flat = tris.every(([u]) => angleDeg(u, normal) <= tolDeg);
  return { normal, point: scale(c, 1 / area), flat };
}

function pointTriangle(p: V3, a: V3, b: V3, c: V3): V3 {
  // Ericson's closest point on a triangle
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(a, scale(ab, d1 / (d1 - d3)));
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(a, scale(ac, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return add(b, scale(sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6))));
  const denom = 1 / (va + vb + vc);
  return add(a, add(scale(ab, vb * denom), scale(ac, vc * denom)));
}

/** Closest approach between a point and a face (its triangles). Null when the face has none. */
export function pointFace(p: V3, mesh: FaceMesh, faceId: string): Closest | null {
  let best: Closest | null = null;
  for (const [a, b, c] of trianglesOf(mesh, faceId)) {
    const q = pointTriangle(p, a, b, c);
    const d = dist(p, q);
    if (!best || d < best.d) best = { d, a: p, b: q };
  }
  return best;
}

/** Axis-aligned extent of a box along a direction: [min, max] of n . x over the eight corners. */
export function boxRange(box: { min: number[]; max: number[] }, n: V3): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 8; i++) {
    const c = [i & 1 ? box.max[0] : box.min[0], i & 2 ? box.max[1] : box.min[1], i & 4 ? box.max[2] : box.min[2]];
    const d = dot(c, n);
    lo = Math.min(lo, d); hi = Math.max(hi, d);
  }
  return [lo, hi];
}
