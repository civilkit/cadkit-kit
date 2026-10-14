// Pure geometry for the Catalog: what face is under a ray, whether it is flat, and where a dropped shape snaps.
// Works on the arrays the controller keeps for the body on screen (bodyFaces / bodyEdges), so it needs no DOM and no
// Three.js, and a preview of the shape being placed never feeds back into where the next pointer position lands.

export type V3 = [number, number, number];
export interface MeshArrays { positions: ArrayLike<number>; normals: ArrayLike<number>; triFace: ArrayLike<number>; faceIds: string[] }
export interface EdgeLike { key?: string; faces?: string[]; mid?: number[]; pts?: number[][] }

export interface FaceInfo {
  id: string;
  /** All vertex normals agree: a flat face. */
  planar: boolean;
  /** Outward normal (for a curved face: the normal of its first triangle). */
  normal: V3;
  /** Area-weighted centre of the triangles. */
  centroid: V3;
  area: number;
  /** Extents of the face in its plane (the two largest sides of its box), for sizing a new shape. */
  extent: [number, number];
}
export interface Hit { t: number; point: V3; normal: V3; face: string; tri: number }

const sub = (a: ArrayLike<number>, b: ArrayLike<number>): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a: ArrayLike<number>, b: ArrayLike<number>): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

const cache = new WeakMap<object, Map<string, FaceInfo>>();

/** Per-face facts of a mesh (cached per mesh object). */
export function faceInfos(mesh: MeshArrays): Map<string, FaceInfo> {
  const hit = cache.get(mesh as object);
  if (hit) return hit;
  const out = new Map<string, FaceInfo>();
  const nTri = mesh.triFace.length;
  const acc = new Map<number, { n: V3; planar: boolean; c: V3; area: number; min: V3; max: V3 }>();
  for (let t = 0; t < nTri; t++) {
    const f = mesh.triFace[t];
    const p = mesh.positions;
    const a: V3 = [p[t * 9], p[t * 9 + 1], p[t * 9 + 2]];
    const b: V3 = [p[t * 9 + 3], p[t * 9 + 4], p[t * 9 + 5]];
    const c: V3 = [p[t * 9 + 6], p[t * 9 + 7], p[t * 9 + 8]];
    const cr = cross(sub(b, a), sub(c, a));
    const area = Math.hypot(cr[0], cr[1], cr[2]) / 2;
    const vn = triNormal(mesh, t);
    let e = acc.get(f);
    if (!e) { e = { n: vn, planar: true, c: [0, 0, 0], area: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }; acc.set(f, e); }
    for (let k = 0; k < 3; k++) {
      const nn = mesh.normals;
      if (dot([nn[t * 9 + k * 3], nn[t * 9 + k * 3 + 1], nn[t * 9 + k * 3 + 2]], e.n) < 0.9999) e.planar = false;
    }
    e.area += area;
    for (let i = 0; i < 3; i++) e.c[i] += area * (a[i] + b[i] + c[i]) / 3;
    for (const v of [a, b, c]) for (let i = 0; i < 3; i++) { if (v[i] < e.min[i]) e.min[i] = v[i]; if (v[i] > e.max[i]) e.max[i] = v[i]; }
  }
  for (const [f, e] of acc) {
    const id = mesh.faceIds[f];
    if (id === undefined) continue;
    const d = [0, 1, 2].map((i) => e.max[i] - e.min[i]).sort((x, y) => y - x);
    out.set(id, {
      id, planar: e.planar, normal: e.n,
      centroid: e.area > 0 ? [e.c[0] / e.area, e.c[1] / e.area, e.c[2] / e.area] : [(e.min[0] + e.max[0]) / 2, (e.min[1] + e.max[1]) / 2, (e.min[2] + e.max[2]) / 2],
      area: e.area, extent: [d[0], d[1]],
    });
  }
  cache.set(mesh as object, out);
  return out;
}

function triNormal(mesh: MeshArrays, t: number): V3 {
  const n = mesh.normals;
  return norm([(n[t * 9] + n[t * 9 + 3] + n[t * 9 + 6]) / 3, (n[t * 9 + 1] + n[t * 9 + 4] + n[t * 9 + 7]) / 3, (n[t * 9 + 2] + n[t * 9 + 5] + n[t * 9 + 8]) / 3]);
}

/** First triangle a ray crosses (Moller-Trumbore, both sides). */
export function raycast(mesh: MeshArrays, o: ArrayLike<number>, d: ArrayLike<number>): Hit | null {
  const p = mesh.positions;
  let best: Hit | null = null;
  const nTri = mesh.triFace.length;
  for (let t = 0; t < nTri; t++) {
    const i = t * 9;
    const e1: V3 = [p[i + 3] - p[i], p[i + 4] - p[i + 1], p[i + 5] - p[i + 2]];
    const e2: V3 = [p[i + 6] - p[i], p[i + 7] - p[i + 1], p[i + 8] - p[i + 2]];
    const h = cross([d[0], d[1], d[2]], e2);
    const det = dot(e1, h);
    if (Math.abs(det) < 1e-14) continue;
    const inv = 1 / det;
    const s: V3 = [o[0] - p[i], o[1] - p[i + 1], o[2] - p[i + 2]];
    const u = dot(s, h) * inv;
    if (u < 0 || u > 1) continue;
    const q = cross(s, e1);
    const v = dot([d[0], d[1], d[2]], q) * inv;
    if (v < 0 || u + v > 1) continue;
    const tt = dot(e2, q) * inv;
    if (tt <= 1e-9 || (best && tt >= best.t)) continue;
    const name = mesh.faceIds[mesh.triFace[t]];
    if (name === undefined) continue;
    best = { t: tt, point: [o[0] + tt * d[0], o[1] + tt * d[1], o[2] + tt * d[2]], normal: triNormal(mesh, t), face: name, tri: t };
  }
  return best;
}

export type SnapKind = 'center' | 'midpoint' | 'vertex' | 'circle';
export interface Snap { point: V3; kind: SnapKind }

/** The centre of a closed polyline that is (nearly) a circle, e.g. the rim of a hole, else null. */
export function circleCentre(pts: number[][]): V3 | null {
  if (pts.length < 8) return null;
  const a = pts[0], b = pts[pts.length - 1];
  if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 1e-4) return null;
  const ring = pts.slice(0, -1);   // the last point repeats the first
  const c: V3 = [0, 0, 0];
  for (const p of ring) for (let i = 0; i < 3; i++) c[i] += p[i] / ring.length;
  const r = ring.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]));
  const mean = r.reduce((s, x) => s + x, 0) / r.length;
  return mean > 1e-6 && r.every((x) => Math.abs(x - mean) < mean * 0.02) ? c : null;
}

/**
 * Snap candidates of a face: its centre, the centres of circular edges (holes), the midpoints and ends of its edges. Priority
 * runs in that order within the same tolerance; the nearest wins inside a class.
 */
export function snapCandidates(face: FaceInfo, edges: EdgeLike[]): Snap[] {
  const out: Snap[] = [{ point: face.centroid, kind: 'center' }];
  const mine = edges.filter((e) => e.faces?.includes(face.id));
  for (const e of mine) {
    const c = e.pts ? circleCentre(e.pts) : null;
    if (c) out.push({ point: c, kind: 'circle' });
  }
  for (const e of mine) {
    if (e.mid && !(e.pts && circleCentre(e.pts))) out.push({ point: [e.mid[0], e.mid[1], e.mid[2]], kind: 'midpoint' });
  }
  for (const e of mine) {
    if (!e.pts?.length) continue;
    for (const p of [e.pts[0], e.pts[e.pts.length - 1]]) out.push({ point: [p[0], p[1], p[2]], kind: 'vertex' });
  }
  return out;
}

const RANK: Record<SnapKind, number> = { vertex: 0, circle: 1, midpoint: 2, center: 3 };
/** The candidate within `tol` (world units) of `p`; ties inside 15% of the tolerance go to the stronger kind. */
export function snapTo(p: V3, cands: Snap[], tol: number): Snap | null {
  let best: { s: Snap; d: number } | null = null;
  for (const s of cands) {
    const d = Math.hypot(p[0] - s.point[0], p[1] - s.point[1], p[2] - s.point[2]);
    if (d > tol) continue;
    if (!best || d < best.d - tol * 0.15 || (Math.abs(d - best.d) <= tol * 0.15 && RANK[s.kind] < RANK[best.s.kind])) best = { s, d };
  }
  return best ? best.s : null;
}

/** Where a ray meets the plane z = 0 (the Front plane), or null when it is parallel or points away. */
export function rayFrontPlane(o: ArrayLike<number>, d: ArrayLike<number>): V3 | null {
  if (Math.abs(d[2]) < 1e-9) return null;
  const t = -o[2] / d[2];
  return t > 0 ? [o[0] + t * d[0], o[1] + t * d[1], 0] : null;
}
