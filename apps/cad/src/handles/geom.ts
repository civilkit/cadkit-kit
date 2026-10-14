// Geometry the handles need from the body on screen: a face's centre and outward normal, the normal of a face near a
// point, a point on a curved face. Pure functions over the kernel's mesh arrays (positions and normals, three numbers
// per vertex, nine per triangle; `triFace` gives each triangle its face).
import { V, type Vec3 } from '@kit/viewport';

export interface MeshLike { positions: ArrayLike<number>; normals: ArrayLike<number>; triFace: ArrayLike<number>; faceIds: string[] }
export interface FaceInfo { name: string; centroid: Vec3; normal: Vec3; planar: boolean; area: number }

function* trianglesOf(m: MeshLike, name: string): Generator<number> {
  const id = m.faceIds.indexOf(name);
  if (id < 0) return;
  for (let t = 0; t < m.triFace.length; t++) if (m.triFace[t] === id) yield t;
}
const pos = (m: MeshLike, t: number, k: number): Vec3 => [m.positions[t * 9 + k * 3], m.positions[t * 9 + k * 3 + 1], m.positions[t * 9 + k * 3 + 2]];
const nor = (m: MeshLike, t: number, k: number): Vec3 => [m.normals[t * 9 + k * 3], m.normals[t * 9 + k * 3 + 1], m.normals[t * 9 + k * 3 + 2]];

/** Area-weighted centre and mean outward normal of a face; `planar` when every vertex normal agrees. Null when the face is not on the mesh. */
export function faceInfo(m: MeshLike, name: string): FaceInfo | null {
  let area = 0;
  let c: Vec3 = [0, 0, 0], n: Vec3 = [0, 0, 0];
  let any = false;
  for (const t of trianglesOf(m, name)) {
    any = true;
    const a = pos(m, t, 0), b = pos(m, t, 1), d = pos(m, t, 2);
    const ar = V.len(V.cross(V.sub(b, a), V.sub(d, a))) / 2;
    area += ar;
    c = V.add(c, V.mul(V.add(V.add(a, b), d), ar / 3));
    for (let k = 0; k < 3; k++) n = V.add(n, V.mul(nor(m, t, k), ar / 3));
  }
  if (!any || area < 1e-12) return null;
  const normal = V.norm(n);
  let planar = true;
  for (const t of trianglesOf(m, name)) for (let k = 0; k < 3; k++) if (V.dot(V.norm(nor(m, t, k)), normal) < 0.999) planar = false;
  return { name, centroid: V.mul(c, 1 / area), normal, planar, area };
}

/** The vertex of the face nearest to `p` and its normal (the surface normal near that point). */
export function surfaceNear(m: MeshLike, name: string, p: Vec3): { point: Vec3; normal: Vec3 } | null {
  let best: { point: Vec3; normal: Vec3 } | null = null, bd = Infinity;
  for (const t of trianglesOf(m, name)) for (let k = 0; k < 3; k++) {
    const q = pos(m, t, k);
    const d = V.len(V.sub(q, p));
    if (d < bd) { bd = d; best = { point: q, normal: V.norm(nor(m, t, k)) }; }
  }
  return best;
}

/** The outward direction that bisects the faces meeting at an edge point: the sum of their normals there. Null when they cancel (a flat edge). */
export function bisectorAt(m: MeshLike, faces: string[], p: Vec3): Vec3 | null {
  let s: Vec3 = [0, 0, 0];
  for (const f of faces) { const near = surfaceNear(m, f, p); if (near) s = V.add(s, near.normal); }
  return V.len(s) < 1e-6 ? null : V.norm(s);
}

/** Whether a planar face lies on the outside of the body's box (a shell's outer wall) rather than inside it. */
export function onHull(info: FaceInfo, box: { min: number[]; max: number[] }, eps = 1e-3): boolean {
  const corners: Vec3[] = [];
  for (const x of [box.min[0], box.max[0]]) for (const y of [box.min[1], box.max[1]]) for (const z of [box.min[2], box.max[2]]) corners.push([x, y, z]);
  const top = Math.max(...corners.map((c) => V.dot(c, info.normal)));
  return Math.abs(V.dot(info.centroid, info.normal) - top) < eps;
}
