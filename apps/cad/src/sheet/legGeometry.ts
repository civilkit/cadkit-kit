// The built leg of an edge flange, read from the sheet's roles and the body's mesh: what the app needs to put the outline sketch on the flange's
// plane. The kernel names the faces of every panel (`P<k>.front`, `P<k>.tip`, ...) in the regen result; the mesh gives their triangles.
import { faceInfo, type MeshLike } from '../handles/geom';
import type { SheetEntry } from './model';

export interface LegGeometry { panel: number; leg: number[][]; normal: number[]; tip: number[] | null }

const faceOf = (entry: SheetEntry, role: string): string | null => {
  const f = ((entry.roles as { faces?: Array<{ role?: string; face?: string | null }> } | undefined)?.faces ?? []).find((x) => x.role === role);
  return f?.face ?? null;
};
const panelsOf = (entry: SheetEntry | undefined): Set<number> => {
  const out = new Set<number>();
  for (const f of (entry?.roles as { faces?: Array<{ role?: string }> } | undefined)?.faces ?? []) { const m = /^P(\d+)\./.exec(f.role ?? ''); if (m) out.add(+m[1]); }
  return out;
};
/** The vertices of a face on the mesh (every triangle corner; duplicates stay). */
export function faceVertices(m: MeshLike, face: string): number[][] {
  const id = m.faceIds.indexOf(face);
  const out: number[][] = [];
  if (id < 0) return out;
  for (let t = 0; t < m.triFace.length; t++) if (m.triFace[t] === id) for (let k = 0; k < 3; k++) out.push([m.positions[t * 9 + k * 3], m.positions[t * 9 + k * 3 + 1], m.positions[t * 9 + k * 3 + 2]]);
  return out;
}
/** The first panel the feature `featureId` added (entries are the sheet after each sheet feature, in feature order): its flat face's vertices and normal, and the
 *  normal of its end wall (the direction the leg points away from the bend), or null when the feature made no panel or the faces are not on the mesh. */
export function legGeometry(entries: SheetEntry[], featureId: string, mesh: MeshLike | null): LegGeometry | null {
  const at = entries.findIndex((e) => e.id === featureId);
  if (at < 0 || !mesh) return null;
  const before = panelsOf(entries[at - 1]);
  const fresh = [...panelsOf(entries[at])].filter((k) => !before.has(k)).sort((a, b) => a - b);
  for (const k of fresh) {
    const front = faceOf(entries[at], `P${k}.front`) ?? faceOf(entries[at], `P${k}.back`);
    if (!front) continue;
    const fi = faceInfo(mesh, front);
    if (!fi || !fi.planar) continue;
    const tipFace = faceOf(entries[at], `P${k}.tip`);
    const ti = tipFace ? faceInfo(mesh, tipFace) : null;
    return { panel: k, leg: faceVertices(mesh, front), normal: fi.normal, tip: ti?.planar ? ti.normal : null };
  }
  return null;
}
