// What the OBJ, GLB and 3MF readers share: a triangle collector, the colour table, the result a reference mesh is made from, and the
// notices for what a file held that the mesh does not keep. Vertices come out welded and in millimetres, Z up, like readStl's.
import { checkIndexed, type MeshCheck } from './mesh';
import { indexMesh, type IndexedMesh, type StlUnit } from './stlRead';

export type MeshFormat = 'obj' | 'glb' | '3mf';

/** Something a file held that did not come in, or something done to it. `n` is a count where one helps. Keys: `mesh.note.<code>` in the app. */
export type MeshNoteCode =
  | 'normals' | 'textures' | 'smoothing' | 'curves' | 'lines'            // not kept: the reference mesh has no normals, textures or lines
  | 'animation' | 'skins' | 'vertexColours' | 'colourGradients'
  | 'mtlMissing'                                                         // OBJ names a .mtl that was not opened, so there are no colours
  | 'partsMerged'                                                        // n objects, groups or build items became one mesh
  | 'primitiveMode'                                                      // GLB primitives that are not triangle lists (n)
  | 'badFaces'                                                           // faces with an index outside the file (n), dropped
  | 'supportObjects'                                                     // 3MF print supports (n), left out
  | 'externalParts'                                                      // 3MF components in a file that is not in the package (n)
  | 'upAxisConverted'                                                    // GLB: Y up and metres converted to Z up and millimetres
  | 'unitConverted'                                                      // 3MF: the file's unit converted to millimetres
  | 'colourLimit';                                                       // more than 65 000 colours: colours dropped
export interface MeshNote { code: MeshNoteCode; n?: number; /** the unit name for `unitConverted` */ text?: string }

export type MeshReadErrorCode =
  | 'empty' | 'notObj' | 'noFaces' | 'badNumber'
  | 'notGlb' | 'glbVersion' | 'glbTruncated' | 'externalBuffer' | 'draco' | 'meshopt' | 'sparse' | 'noTriangles' | 'badAccessor'
  | 'notZip' | 'no3mfModel' | 'badXml' | 'noMesh' | 'allDegenerate';
export class MeshReadError extends Error {
  constructor(readonly code: MeshReadErrorCode, message: string) { super(message); this.name = 'MeshReadError'; }
}

/** A colour of the file as the reference mesh keeps it: `#rrggbb` and an opacity 0..1. */
export interface ReadMat { c: string; o: number }

export interface MeshFileRead {
  format: MeshFormat;
  name: string;
  /** Welded vertices in millimetres and triangle corners. */
  mesh: IndexedMesh;
  /** Colours used, and the colour index of each triangle (0xFFFF: none). Triangles are grouped by colour. Both absent when the file had no colours. */
  mats?: ReadMat[];
  tm?: Uint16Array;
  /** The unit the file's numbers were in (information; the vertices are millimetres). */
  unit: StlUnit;
  /** True when the file states its unit (GLB, 3MF), false when it does not (OBJ): then the reader's `unit` option scaled it. */
  unitFromFile: boolean;
  /** Objects, groups, nodes or build items that were joined into the one mesh. */
  parts: number;
  triangles: number;
  fileTriangles: number;
  degenerate: number;
  bbox: { min: [number, number, number]; max: [number, number, number] };
  check: MeshCheck;
  notes: MeshNote[];
}

/** Growable list of triangles (9 floats each, millimetres) with the colour index of each (-1: none). */
export class TriSink {
  pos = new Float32Array(3000);
  mat = new Int32Array(1000);
  n = 0;
  add(a: ArrayLike<number>, ao: number, b: ArrayLike<number>, bo: number, c: ArrayLike<number>, co: number, mat: number): void {
    if (this.n * 9 + 9 > this.pos.length) {
      const p = new Float32Array(this.pos.length * 2); p.set(this.pos); this.pos = p;
      const m = new Int32Array(this.mat.length * 2); m.set(this.mat); this.mat = m;
    }
    const o = this.n * 9;
    for (let k = 0; k < 3; k++) { this.pos[o + k] = a[ao + k]; this.pos[o + 3 + k] = b[bo + k]; this.pos[o + 6 + k] = c[co + k]; }
    this.mat[this.n++] = mat;
  }
}

/** Colours by value: `#rrggbb` and opacity share one index. */
export class MatTable {
  list: ReadMat[] = [];
  private by = new Map<string, number>();
  add(rgb: ArrayLike<number>, opacity = 1): number {
    const h = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
    const c = `#${h(rgb[0])}${h(rgb[1])}${h(rgb[2])}`;
    const o = Math.round(Math.min(1, Math.max(0.05, opacity)) * 1000) / 1000;
    const k = c + o;
    let i = this.by.get(k);
    if (i === undefined) { i = this.list.length; this.list.push({ c, o }); this.by.set(k, i); }
    return i;
  }
}

const NO_MAT = 0xffff;
/** `#rrggbb` or `#rrggbbaa` (3MF) as sRGB 0..255 and alpha 0..1; null when it is not one. */
export function parseColorAttr(s: string | undefined): { rgb: [number, number, number]; a: number } | null {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec((s ?? '').trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return { rgb: [(v >> 16) & 255, (v >> 8) & 255, v & 255], a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
}

/** Weld the triangles, drop the empty ones, group by colour, and report: the last step of every reader. */
export function finishRead(sink: TriSink, mats: ReadMat[], o: { format: MeshFormat; name: string; unit: StlUnit; unitFromFile: boolean; parts: number; notes: MeshNote[] }): MeshFileRead {
  const fileTriangles = sink.n;
  const pos = sink.pos.subarray(0, sink.n * 9);
  for (let i = 0; i < pos.length; i++) if (!Number.isFinite(pos[i])) throw new MeshReadError('badNumber', 'a coordinate is not a finite number');
  const keep = new Uint8Array(fileTriangles);
  const { mesh, dropped } = indexMesh(pos, keep);
  if (!mesh.indices.length) throw new MeshReadError(fileTriangles ? 'allDegenerate' : 'noFaces', fileTriangles ? 'every triangle is degenerate' : 'no triangles in the file');
  const notes = [...o.notes];
  let outMats: ReadMat[] | undefined, tm: Uint16Array | undefined;
  const nT = mesh.indices.length / 3;
  const used = new Set<number>();
  const kept = new Int32Array(nT);
  for (let t = 0, k = 0; t < fileTriangles; t++) if (keep[t]) { kept[k++] = sink.mat[t]; }
  for (let t = 0; t < nT; t++) if (kept[t] >= 0) used.add(kept[t]);
  if (used.size) {
    if (used.size >= NO_MAT) { notes.push({ code: 'colourLimit' }); }
    else {
      // renumber the colours that are used, and sort the triangles so that a colour is one run
      const order = [...used].sort((a, b) => a - b);
      const renum = new Map<number, number>(order.map((m, i) => [m, i]));
      outMats = order.map((m) => mats[m]);
      const key = (t: number) => (kept[t] < 0 ? NO_MAT : renum.get(kept[t])!);
      const counts = new Uint32Array(outMats.length + 1);
      for (let t = 0; t < nT; t++) { const k = key(t); counts[k === NO_MAT ? outMats.length : k]++; }
      const start = new Uint32Array(outMats.length + 1);
      for (let i = 1; i <= outMats.length; i++) start[i] = start[i - 1] + counts[i - 1];
      const idx = new Uint32Array(mesh.indices.length);
      tm = new Uint16Array(nT);
      for (let t = 0; t < nT; t++) {
        const k = key(t), slot = start[k === NO_MAT ? outMats.length : k]++;
        idx[slot * 3] = mesh.indices[t * 3]; idx[slot * 3 + 1] = mesh.indices[t * 3 + 1]; idx[slot * 3 + 2] = mesh.indices[t * 3 + 2];
        tm[slot] = k;
      }
      mesh.indices.set(idx);
    }
  }
  const lo: [number, number, number] = [Infinity, Infinity, Infinity], hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const v = mesh.vertices;
  for (let i = 0; i < v.length; i += 3) for (let c = 0; c < 3; c++) { if (v[i + c] < lo[c]) lo[c] = v[i + c]; if (v[i + c] > hi[c]) hi[c] = v[i + c]; }
  const check = checkIndexed(mesh.indices, v.length / 3);
  return {
    format: o.format, name: o.name, mesh, ...(outMats && tm ? { mats: outMats, tm } : {}), unit: o.unit, unitFromFile: o.unitFromFile, parts: o.parts,
    triangles: nT, fileTriangles, degenerate: dropped, bbox: { min: lo, max: hi }, check: { ...check, degenerate: dropped }, notes,
  };
}

/** Triangulate the polygon `idx` (indices into `p`, xyz) into `out` triples: a triangle as it is, anything else by ear clipping in the
 *  polygon's own plane (convex and simple concave faces come out right); when clipping gets stuck on a bad polygon the rest is fanned. */
export function triangulate(p: ArrayLike<number>, idx: readonly number[], out: number[]): void {
  const n = idx.length;
  if (n < 3) return;
  if (n === 3) { out.push(idx[0], idx[1], idx[2]); return; }
  // Newell normal picks the plane to project to
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < n; i++) {
    const a = idx[i] * 3, b = idx[(i + 1) % n] * 3;
    nx += (p[a + 1] - p[b + 1]) * (p[a + 2] + p[b + 2]);
    ny += (p[a + 2] - p[b + 2]) * (p[a] + p[b]);
    nz += (p[a] - p[b]) * (p[a + 1] + p[b + 1]);
  }
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  // project to the two axes other than the dominant one, keeping the polygon counter-clockwise when its normal is positive
  const u = ax >= ay && ax >= az ? 1 : ay >= az ? 2 : 0, w = ax >= ay && ax >= az ? 2 : ay >= az ? 0 : 1;
  const sign = (ax >= ay && ax >= az ? nx : ay >= az ? ny : nz) < 0 ? -1 : 1;
  const X = (i: number) => p[idx[i] * 3 + u], Y = (i: number) => sign * p[idx[i] * 3 + w];
  const cross = (a: number, b: number, c: number) => (X(b) - X(a)) * (Y(c) - Y(a)) - (Y(b) - Y(a)) * (X(c) - X(a));
  const rest: number[] = Array.from({ length: n }, (_, i) => i);
  let guard = 0;
  while (rest.length > 3 && guard++ < n * n) {
    let clipped = false;
    for (let k = 0; k < rest.length; k++) {
      const a = rest[(k + rest.length - 1) % rest.length], b = rest[k], c = rest[(k + 1) % rest.length];
      if (cross(a, b, c) <= 0) continue;   // reflex or flat corner: not an ear
      let inside = false;
      for (const q of rest) {
        if (q === a || q === b || q === c) continue;
        // a vertex of the polygon in the triangle (edges included) stops the ear, unless it is the same point as a corner
        const d1 = cross(a, b, q), d2 = cross(b, c, q), d3 = cross(c, a, q);
        if (d1 >= 0 && d2 >= 0 && d3 >= 0 && !(X(q) === X(a) && Y(q) === Y(a)) && !(X(q) === X(b) && Y(q) === Y(b)) && !(X(q) === X(c) && Y(q) === Y(c))) { inside = true; break; }
      }
      if (inside) continue;
      out.push(idx[a], idx[b], idx[c]);
      rest.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (rest.length === 3) out.push(idx[rest[0]], idx[rest[1]], idx[rest[2]]);
  else for (let i = 1; i + 1 < rest.length; i++) out.push(idx[rest[0]], idx[rest[i]], idx[rest[i + 1]]);
}
