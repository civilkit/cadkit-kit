// A SketchUp import as a reference mesh (the default; the old view-only body is the other choice). The kernel reads the file (units to
// millimetres, hidden geometry, per-face materials); this module turns its answer into the record `doc.meshes` keeps: an indexed mesh
// (vertices welded within a face, so the flat shading of a box stays crisp), the materials the faces use (colour, opacity) and one
// material per triangle. Triangles are sorted by material so every material is one run (the viewport draws a run as one group, the file
// stores the runs as a handful of numbers). The kernel's Z-up model is left as the file has it; "Upright" is the record's rotation.
import { NO_MAT, meshRecFromArrays, type MeshMat, type MeshRec, type V3 } from '../meshes/meshDoc';
import { hexOfRgb, skpFaceIndex, skpNotices, type SkpFacts, type SkpOrient, type SkpSummary } from './skpImport';

/** The rotation (degrees, X then Y then Z, see meshDoc.rotation) that stands the model as `orient` says: the same three views as the
 *  view-only import. 'y': (x,y,z) -> (x,z,-y). 'yFlip': upside down, (x,y,z) -> (-x,-z,-y). 'z': the file's axes. */
export const SKP_ROT: Record<SkpOrient, V3> = { z: [0, 0, 0], y: [-90, 0, 0], yFlip: [-90, 0, 180] };

/** The orientation a record's rotation stands for, or null when the user turned it to something else. */
export function orientOf(rot: readonly number[]): SkpOrient | null {
  const same = (a: V3) => a.every((v, i) => Math.abs(v - (rot[i] ?? 0)) < 1e-6);
  return (['y', 'z', 'yFlip'] as const).find((o) => same(SKP_ROT[o])) ?? null;
}

/** The face limit of the view-only path; the mesh path takes models far larger (a mesh costs the viewer nothing per face). */
export const SKP_MESH_MAX_FACES = 5_000_000;

export interface SkpMeshInput {
  /** the kernel's display mesh: 3 vertices per triangle (xyz each), `triFace[t]` = index into `faceIds` */
  mesh: { positions: Float32Array; triFace: Int32Array; faceIds: string[] };
  materials: ReadonlyArray<{ color: readonly number[]; opacity: number }>;
  /** `faceMaterials[n]` = material of face `skp.F<n>` (-1 or absent: none) */
  faceMaterials: readonly number[];
}

export interface SkpMeshArrays { vertices: Float32Array; indices: Uint32Array; tm: Uint16Array; mats: MeshMat[] }

/** An open-addressing table over (face, x, y, z) to weld the vertices of one face (a Map of strings would be slow and heavy at a million vertices). */
const scratchF = new Float32Array(3), scratchU = new Uint32Array(scratchF.buffer);
class Welder {
  private slots: Int32Array;
  private mask: number;
  readonly verts: Float32Array;
  private face: Int32Array;
  n = 0;
  /** `cap`: the most vertices that can be added (no growth, so the table never fills) */
  constructor(cap: number) {
    let size = 1024;
    while (size < cap * 2) size <<= 1;
    this.slots = new Int32Array(size).fill(-1);
    this.mask = size - 1;
    this.verts = new Float32Array(Math.max(1, cap) * 3);
    this.face = new Int32Array(Math.max(1, cap));
  }
  add(face: number, x: number, y: number, z: number): number {
    scratchF[0] = x; scratchF[1] = y; scratchF[2] = z;
    let h = Math.imul(face + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(scratchU[0], 0xc2b2ae35) ^ Math.imul(scratchU[1], 0x27d4eb2f) ^ Math.imul(scratchU[2], 0x165667b1);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
    for (let s = h & this.mask; ; s = (s + 1) & this.mask) {
      const v = this.slots[s];
      if (v < 0) {
        this.verts[this.n * 3] = x; this.verts[this.n * 3 + 1] = y; this.verts[this.n * 3 + 2] = z;
        this.face[this.n] = face;
        this.slots[s] = this.n;
        return this.n++;
      }
      if (this.face[v] === face && this.verts[v * 3] === x && this.verts[v * 3 + 1] === y && this.verts[v * 3 + 2] === z) return v;
    }
  }
}

/** The kernel's body as an indexed mesh with a material per triangle (sorted by material, then by face). */
export function skpMeshArrays(inp: SkpMeshInput): SkpMeshArrays {
  const { positions, triFace, faceIds } = inp.mesh;
  const nt = triFace.length;
  // the material of every triangle, then the palette of the ones used (in order of first use)
  const faceMat = new Int32Array(faceIds.length).fill(-1);
  faceIds.forEach((name, f) => {
    const n = skpFaceIndex(name);
    const mi = n === null ? undefined : inp.faceMaterials[n];
    const m = mi === undefined || mi < 0 ? undefined : inp.materials[mi];
    if (m && Array.isArray(m.color)) faceMat[f] = mi!;
  });
  const palette = new Map<number, number>();
  const mats: MeshMat[] = [];
  const triMat = new Uint16Array(nt);
  for (let t = 0; t < nt; t++) {
    const mi = faceMat[triFace[t]];
    if (mi < 0) { triMat[t] = NO_MAT; continue; }
    let k = palette.get(mi);
    if (k === undefined) {
      k = mats.length;
      if (k >= NO_MAT) { triMat[t] = NO_MAT; continue; }
      palette.set(mi, k);
      const m = inp.materials[mi];
      mats.push({ c: hexOfRgb(m.color), o: Math.min(1, Math.max(0.05, typeof m.opacity === 'number' ? m.opacity : 1)) });
    }
    triMat[t] = k;
  }
  // order: material (no material last), then face, then the kernel's order
  const order = new Uint32Array(nt);
  {
    const key = (t: number) => (triMat[t] === NO_MAT ? mats.length : triMat[t]);
    const buckets = new Uint32Array(mats.length + 2);
    for (let t = 0; t < nt; t++) buckets[key(t) + 1]++;
    for (let k = 1; k < buckets.length; k++) buckets[k] += buckets[k - 1];
    for (let t = 0; t < nt; t++) order[buckets[key(t)]++] = t;
    // inside a material the kernel emits the triangles of a face together already, in face order: no second sort
  }
  const w = new Welder(nt * 3);
  const indices = new Uint32Array(nt * 3);
  const tm = new Uint16Array(nt);
  for (let k = 0; k < nt; k++) {
    const t = order[k], f = triFace[t];
    tm[k] = triMat[t];
    for (let c = 0; c < 3; c++) {
      const p = t * 9 + c * 3;
      indices[k * 3 + c] = w.add(f, positions[p], positions[p + 1], positions[p + 2]);
    }
  }
  return { vertices: w.verts.slice(0, w.n * 3), indices, tm, mats };
}

export interface SkpMeshResult { rec: MeshRec; summary: SkpSummary; up: SkpOrient }

/** The record for a SketchUp reply (`importSkp` answer, as importSkpView reads it) at the orientation asked. */
export function skpMeshRecord(r: { view: { mesh: SkpMeshInput['mesh'] }; facts: Pick<SkpFacts, 'materials' | 'faceMaterials'>; summary: SkpSummary }, o: { id: string; name: string; up: SkpOrient }): SkpMeshResult {
  const a = skpMeshArrays({ mesh: r.view.mesh, materials: r.facts.materials, faceMaterials: r.facts.faceMaterials });
  const rec = meshRecFromArrays(a.mats.length ? a : { vertices: a.vertices, indices: a.indices }, { id: o.id, name: o.name, unit: 'mm', watertight: r.summary.closed, mats: a.mats });
  rec.rot = [...SKP_ROT[o.up]] as V3;
  return { rec, summary: r.summary, up: o.up };
}

export { skpNotices };
