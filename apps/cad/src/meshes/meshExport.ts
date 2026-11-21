// Reference meshes in the mesh exports (STL, OBJ, 3MF, GLB): each shown record becomes one export body in world coordinates (its
// placement applied), named as in the tree, in its colour. Pure: no DOM, no kernel.
import type { MeshBody } from '@kit/io';
import { decode, rotation, type MeshRec } from './meshDoc';

/** Whether reference meshes go into the mesh exports. 'none' is the default and what the app did before the choice existed. */
export type RefMeshExport = 'none' | 'included';
export const REF_MESH_EXPORTS: RefMeshExport[] = ['none', 'included'];

/** One record as triangle soup (three corners per triangle, xyz, millimetres), placed in the world. */
export function refMeshPositions(rec: MeshRec): Float32Array {
  const { vertices: v, indices: ix } = decode(rec).mesh;
  const r = rotation(rec.rot), s = rec.scale, [px, py, pz] = rec.pos;
  const out = new Float32Array(ix.length * 3);
  for (let k = 0; k < ix.length; k++) {
    const j = ix[k] * 3, x = v[j], y = v[j + 1], z = v[j + 2], o = k * 3;
    out[o] = px + s * (r[0] * x + r[1] * y + r[2] * z);
    out[o + 1] = py + s * (r[3] * x + r[4] * y + r[5] * z);
    out[o + 2] = pz + s * (r[6] * x + r[7] * y + r[8] * z);
  }
  return out;
}

/** The export bodies of the shown reference meshes (hidden ones are left out), in the order of the tree. */
export function refMeshBodies(recs: readonly MeshRec[]): MeshBody[] {
  return recs.filter((r) => r.visible).map((r) => ({ name: r.name, positions: refMeshPositions(r), color: r.color }));
}

/** The part's triangles followed by the reference meshes' (a format with one mesh: STL). Null when there is neither. */
export function mergeTriangles(part: { positions: ArrayLike<number> } | null, refs: readonly MeshBody[]): { positions: Float32Array } | null {
  const lists = [...(part && part.positions.length ? [part.positions] : []), ...refs.map((b) => b.positions).filter((p) => p.length)];
  if (!lists.length) return null;
  const out = new Float32Array(lists.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of lists) { out.set(p as ArrayLike<number>, at); at += p.length; }
  return { positions: out };
}
