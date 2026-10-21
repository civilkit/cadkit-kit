// Which edges of a body have no crease: the two faces leave the edge in the same direction (a flat top running into the round of a
// stadium end, a fillet's own seam). Rounding such an edge is meaningless, so the Tangent chain must not walk onto one. The kernel
// reports faces and edge polylines but no dihedral angle, so it is read from the mesh: the vertex normals of each face at the edge.
import type { BodyMesh } from '@kit/viewport';

interface SmoothEdge { key?: string; faces?: string[]; pts?: number[][]; smooth?: boolean }

/** Largest angle (degrees) between the two faces' normals along an edge that still counts as smooth. */
const SMOOTH_DEG = 3;

/** The normal of `face`'s mesh vertex nearest to `p` (null when the face has no triangles). */
function normalNear(m: BodyMesh, tris: number[], p: number[]): number[] | null {
  let best = Infinity, n: number[] | null = null;
  for (const t of tris) for (let v = 0; v < 3; v++) {
    const i = t * 9 + v * 3;
    const d = (m.positions[i] - p[0]) ** 2 + (m.positions[i + 1] - p[1]) ** 2 + (m.positions[i + 2] - p[2]) ** 2;
    if (d < best) { best = d; n = [m.normals[i], m.normals[i + 1], m.normals[i + 2]]; }
  }
  return n;
}

/** `edges` with `smooth` set on every two-face edge whose faces have the same normal along it (first, middle and last point). */
export function markSmoothEdges<E extends SmoothEdge>(mesh: BodyMesh, edges: E[]): Array<E & { smooth?: boolean }> {
  const cosTol = Math.cos((SMOOTH_DEG * Math.PI) / 180);
  const byFace = new Map<string, number[]>();
  const faceIndex = new Map(mesh.faceIds.map((id, i) => [id, i]));
  for (let t = 0; t < mesh.triFace.length; t++) {
    const id = mesh.faceIds[mesh.triFace[t]];
    if (id !== undefined) (byFace.get(id) ?? byFace.set(id, []).get(id)!).push(t);
  }
  return edges.map((e) => {
    if (!e.faces || e.faces.length !== 2 || !e.pts || e.pts.length < 2 || !faceIndex.has(e.faces[0]) || !faceIndex.has(e.faces[1])) return e;
    const a = byFace.get(e.faces[0]), b = byFace.get(e.faces[1]);
    if (!a || !b) return e;
    const k = e.pts.length - 1;
    for (const p of [e.pts[0], e.pts[Math.floor(k / 2)], e.pts[k]]) {
      const na = normalNear(mesh, a, p), nb = normalNear(mesh, b, p);
      if (!na || !nb || na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2] < cosTol) return e;
    }
    return { ...e, smooth: true };
  });
}
