// A bounding volume hierarchy over an indexed triangle mesh, for picking: ray casts (where a click lands on the surface) and closest
// point queries (snap a point onto the surface). Flat typed arrays, no object per node or triangle; built by median splits on the
// longest axis, so 500k triangles take about a second.
import type { IndexedMesh } from './stlRead';

export type V3 = [number, number, number];
const LEAF = 8;

export interface Bvh {
  mesh: IndexedMesh;
  /** triangle ids in leaf order */
  order: Uint32Array;
  /** per node: min xyz, max xyz */
  bounds: Float64Array;
  /** internal node: index of the left child (the right one follows it); leaf: first slot in `order` */
  a: Int32Array;
  /** leaf: triangle count; internal: 0 */
  n: Int32Array;
  nodes: number;
}

/** Build in one go. */
export function buildBvh(mesh: IndexedMesh): Bvh {
  const g = bvhSteps(mesh, Infinity);
  for (;;) { const r = g.next(); if (r.done) return r.value; }
}
/** Build without holding the page: slices of about `sliceMs` of work, a turn for the page between them. 500k triangles stay under one
 *  frame per slice instead of one stall of half a second. */
export async function buildBvhAsync(mesh: IndexedMesh, sliceMs = 8): Promise<Bvh> {
  const g = bvhSteps(mesh, sliceMs);
  for (;;) { const r = g.next(); if (r.done) return r.value; await new Promise<void>((res) => setTimeout(res, 0)); }
}

function* bvhSteps(mesh: IndexedMesh, sliceMs: number): Generator<void, Bvh> {
  const { vertices: V, indices: I } = mesh;
  const T = I.length / 3 | 0;
  const cap = Math.max(1, (T >> 1) + 3);
  const bounds = new Float64Array(cap * 6), a = new Int32Array(cap), n = new Int32Array(cap);
  const order = new Uint32Array(T);
  const cen = new Float32Array(T * 3);
  for (let t = 0; t < T; t++) {
    order[t] = t;
    for (let c = 0; c < 3; c++) cen[t * 3 + c] = (V[I[t * 3] * 3 + c] + V[I[t * 3 + 1] * 3 + c] + V[I[t * 3 + 2] * 3 + c]) / 3;
  }
  let count = 1;
  // work stack of (node, start, end)
  const stack: number[] = [0, 0, T];
  let sliceStart = sliceMs === Infinity ? 0 : performance.now(), sinceCheck = 0;
  while (stack.length) {
    if (sliceMs !== Infinity && (++sinceCheck >= 64 || stack[stack.length - 1] - stack[stack.length - 2] > 20000)) {
      sinceCheck = 0;
      if (performance.now() - sliceStart >= sliceMs) { yield; sliceStart = performance.now(); }
    }
    const end = stack.pop()!, start = stack.pop()!, node = stack.pop()!;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    let cx0 = Infinity, cy0 = Infinity, cz0 = Infinity, cx1 = -Infinity, cy1 = -Infinity, cz1 = -Infinity;
    for (let s = start; s < end; s++) {
      const t = order[s];
      for (let k = 0; k < 3; k++) {
        const o = I[t * 3 + k] * 3;
        const x = V[o], y = V[o + 1], z = V[o + 2];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      const x = cen[t * 3], y = cen[t * 3 + 1], z = cen[t * 3 + 2];
      if (x < cx0) cx0 = x; if (x > cx1) cx1 = x; if (y < cy0) cy0 = y; if (y > cy1) cy1 = y; if (z < cz0) cz0 = z; if (z > cz1) cz1 = z;
    }
    bounds.set([x0, y0, z0, x1, y1, z1], node * 6);
    const cnt = end - start;
    if (cnt <= LEAF) { a[node] = start; n[node] = cnt; continue; }
    const dx = cx1 - cx0, dy = cy1 - cy0, dz = cz1 - cz0;
    const axis = dx >= dy && dx >= dz ? 0 : dy >= dz ? 1 : 2;
    if (Math.max(dx, dy, dz) === 0) { a[node] = start; n[node] = cnt; continue; }   // all centroids equal: a (big) leaf
    const mid = (start + end) >> 1;
    select(order, cen, axis, start, end - 1, mid);
    const l = count; count += 2;
    if (count > cap) throw new Error('bvh: node capacity exceeded');
    a[node] = l; n[node] = 0;
    stack.push(l, start, mid, l + 1, mid, end);
  }
  return { mesh, order, bounds, a, n, nodes: count };
}

/** Quickselect: afterwards `order[k]` holds the element that sorts there by centroid coordinate `axis`, smaller ones before it. */
function select(order: Uint32Array, cen: Float32Array, axis: number, lo: number, hi: number, k: number): void {
  const key = (s: number): number => cen[order[s] * 3 + axis];
  while (lo < hi) {
    const pivot = key((lo + hi) >> 1);
    let i = lo, j = hi;
    while (i <= j) {
      while (key(i) < pivot) i++;
      while (key(j) > pivot) j--;
      if (i <= j) { const t = order[i]; order[i] = order[j]; order[j] = t; i++; j--; }
    }
    if (k <= j) hi = j; else if (k >= i) lo = i; else return;
  }
}

export interface RayHit { t: number; tri: number; point: V3; /** unit, facing against the ray */ normal: V3 }

/** Nearest hit of the ray `o + t d` (t from 0 to `maxT`; `d` need not be unit, t is then in units of d). Null for none. */
export function raycast(b: Bvh, o: V3, d: V3, maxT = Infinity): RayHit | null {
  if (!b.mesh.indices.length) return null;
  const { vertices: V, indices: I } = b.mesh;
  const ix = d[0] === 0 ? Infinity : 1 / d[0], iy = d[1] === 0 ? Infinity : 1 / d[1], iz = d[2] === 0 ? Infinity : 1 / d[2];
  let best = maxT, bestTri = -1;
  const stack = [0];
  while (stack.length) {
    const node = stack.pop()!;
    if (!boxHit(b.bounds, node * 6, o, ix, iy, iz, best)) continue;
    if (b.n[node] === 0) { stack.push(b.a[node], b.a[node] + 1); continue; }
    for (let s = b.a[node], e = s + b.n[node]; s < e; s++) {
      const t = b.order[s];
      const i0 = I[t * 3] * 3, i1 = I[t * 3 + 1] * 3, i2 = I[t * 3 + 2] * 3;
      const e1x = V[i1] - V[i0], e1y = V[i1 + 1] - V[i0 + 1], e1z = V[i1 + 2] - V[i0 + 2];
      const e2x = V[i2] - V[i0], e2y = V[i2 + 1] - V[i0 + 1], e2z = V[i2 + 2] - V[i0 + 2];
      const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-18) continue;
      const inv = 1 / det;
      const sx = o[0] - V[i0], sy = o[1] - V[i0 + 1], sz = o[2] - V[i0 + 2];
      const u = (sx * px + sy * py + sz * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (tt >= 0 && tt < best) { best = tt; bestTri = t; }
    }
  }
  if (bestTri < 0) return null;
  const nrm = triNormal(b.mesh, bestTri);
  if (nrm[0] * d[0] + nrm[1] * d[1] + nrm[2] * d[2] > 0) { nrm[0] = -nrm[0]; nrm[1] = -nrm[1]; nrm[2] = -nrm[2]; }
  return { t: best, tri: bestTri, point: [o[0] + d[0] * best, o[1] + d[1] * best, o[2] + d[2] * best], normal: nrm };
}

function boxHit(bo: Float64Array, off: number, o: V3, ix: number, iy: number, iz: number, tMax: number): boolean {
  let t0 = 0, t1 = tMax;
  for (let c = 0; c < 3; c++) {
    const inv = c === 0 ? ix : c === 1 ? iy : iz;
    const lo = bo[off + c], hi = bo[off + 3 + c];
    if (inv === Infinity) { if (o[c] < lo || o[c] > hi) return false; continue; }
    let a = (lo - o[c]) * inv, b = (hi - o[c]) * inv;
    if (a > b) { const t = a; a = b; b = t; }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return false;
  }
  return true;
}

/** Unit normal of triangle `t` (counter-clockwise gives outward); zero for a degenerate one. */
export function triNormal(m: IndexedMesh, t: number): V3 {
  const { vertices: V, indices: I } = m;
  const i0 = I[t * 3] * 3, i1 = I[t * 3 + 1] * 3, i2 = I[t * 3 + 2] * 3;
  const ux = V[i1] - V[i0], uy = V[i1 + 1] - V[i0 + 1], uz = V[i1 + 2] - V[i0 + 2];
  const vx = V[i2] - V[i0], vy = V[i2 + 1] - V[i0 + 1], vz = V[i2 + 2] - V[i0 + 2];
  const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
  const l = Math.hypot(x, y, z);
  return l > 0 ? [x / l, y / l, z / l] : [0, 0, 0];
}

export interface ClosestHit { dist: number; tri: number; point: V3; normal: V3 }

/** The point of the surface nearest to `p` (within `maxDist` when given). */
export function closestPoint(b: Bvh, p: V3, maxDist = Infinity): ClosestHit | null {
  if (!b.mesh.indices.length) return null;
  const { vertices: V, indices: I } = b.mesh;
  let best = maxDist * maxDist, bestTri = -1;
  const bp: V3 = [0, 0, 0], tmp: V3 = [0, 0, 0];
  // depth first, nearer child first
  const stack = [0];
  const boxD2 = (node: number): number => {
    let d2 = 0;
    for (let c = 0; c < 3; c++) {
      const lo = b.bounds[node * 6 + c], hi = b.bounds[node * 6 + 3 + c];
      const v = p[c] < lo ? lo - p[c] : p[c] > hi ? p[c] - hi : 0;
      d2 += v * v;
    }
    return d2;
  };
  while (stack.length) {
    const node = stack.pop()!;
    if (boxD2(node) >= best) continue;
    if (b.n[node] === 0) {
      const l = b.a[node], r = l + 1;
      if (boxD2(l) < boxD2(r)) stack.push(r, l); else stack.push(l, r);
      continue;
    }
    for (let s = b.a[node], e = s + b.n[node]; s < e; s++) {
      const t = b.order[s];
      const i0 = I[t * 3] * 3, i1 = I[t * 3 + 1] * 3, i2 = I[t * 3 + 2] * 3;
      closestOnTriangle(p, V, i0, i1, i2, tmp);
      const dx = tmp[0] - p[0], dy = tmp[1] - p[1], dz = tmp[2] - p[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) { best = d2; bestTri = t; bp[0] = tmp[0]; bp[1] = tmp[1]; bp[2] = tmp[2]; }
    }
  }
  if (bestTri < 0) return null;
  return { dist: Math.sqrt(best), tri: bestTri, point: [bp[0], bp[1], bp[2]], normal: triNormal(b.mesh, bestTri) };
}

/** Closest point of triangle (V at offsets i0, i1, i2) to p, written into `out` (Ericson, Real-Time Collision Detection). */
function closestOnTriangle(p: V3, V: Float32Array, i0: number, i1: number, i2: number, out: V3): void {
  const ax = V[i0], ay = V[i0 + 1], az = V[i0 + 2];
  const abx = V[i1] - ax, aby = V[i1 + 1] - ay, abz = V[i1 + 2] - az;
  const acx = V[i2] - ax, acy = V[i2 + 1] - ay, acz = V[i2 + 2] - az;
  const apx = p[0] - ax, apy = p[1] - ay, apz = p[2] - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  const set = (x: number, y: number, z: number): void => { out[0] = x; out[1] = y; out[2] = z; };
  if (d1 <= 0 && d2 <= 0) return set(ax, ay, az);
  const bpx = p[0] - V[i1], bpy = p[1] - V[i1 + 1], bpz = p[2] - V[i1 + 2];
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return set(V[i1], V[i1 + 1], V[i1 + 2]);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return set(ax + abx * v, ay + aby * v, az + abz * v); }
  const cpx = p[0] - V[i2], cpy = p[1] - V[i2 + 1], cpz = p[2] - V[i2 + 2];
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return set(V[i2], V[i2 + 1], V[i2 + 2]);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return set(ax + acx * w, ay + acy * w, az + acz * w); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return set(V[i1] + (V[i2] - V[i1]) * w, V[i1 + 1] + (V[i2 + 1] - V[i1 + 1]) * w, V[i1 + 2] + (V[i2 + 2] - V[i1 + 2]) * w);
  }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  set(ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w);
}

/** Bounding box of the mesh. */
export function meshBox(m: IndexedMesh): { min: V3; max: V3 } {
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  const v = m.vertices;
  for (let i = 0; i < v.length; i += 3) for (let c = 0; c < 3; c++) { if (v[i + c] < lo[c]) lo[c] = v[i + c]; if (v[i + c] > hi[c]) hi[c] = v[i + c]; }
  return { min: lo, max: hi };
}
