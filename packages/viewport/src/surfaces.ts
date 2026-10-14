// Surface bodies (sheets and open face sets from the surface features) next to the solid. The kernel reports them apart
// from the solid (`surfaces` in the regen reply, one body per feature id), with the same face and edge records. The
// viewport draws, picks and highlights everything from one mesh and one edge list, so they are merged here; face and edge
// names are unique across bodies ("F4.S.sp", "F4.S.e1|F4.S.e2#0"), so selection and hover need nothing more.
import type { BodyMesh } from './meshgeom';

export interface SurfaceEdge { key?: string; pts: number[][] }
/** One surface body for the viewer: its feature id, mesh (faceIds are the kernel's face names), edges and box. */
export interface ViewSurface {
  id: string;
  mesh: BodyMesh;
  edges: SurfaceEdge[];
  box?: { min: number[]; max: number[] } | null;
}

export interface MergedBody {
  mesh: BodyMesh;
  edges: SurfaceEdge[];
  /** names of the faces (and edge keys) that belong to a surface body, for the tint */
  surfaceFaces: Set<string>;
}

type Box = { min: number[]; max: number[] };
const isEmptyBox = (b: Box | null | undefined): boolean => !b || b.min.every((v, i) => v === 0 && b.max[i] === 0);

/** The solid and the given surface bodies as one mesh and one edge list. Faces of a later body get their own index range. */
export function mergeBodies(solid: { mesh: BodyMesh; edges: SurfaceEdge[] } | null, surfaces: ViewSurface[]): MergedBody {
  const parts = [solid?.mesh, ...surfaces.map((s) => s.mesh)].filter((m): m is BodyMesh => !!m);
  const surfaceFaces = new Set<string>();
  for (const s of surfaces) { for (const f of s.mesh.faceIds) surfaceFaces.add(f); for (const e of s.edges) if (e.key) surfaceFaces.add(e.key); }
  const edges = [...(solid?.edges ?? []), ...surfaces.flatMap((s) => s.edges)];
  if (parts.length === 1 && !surfaces.length) return { mesh: parts[0], edges, surfaceFaces };
  const tris = parts.reduce((n, m) => n + m.triFace.length, 0);
  const positions = new Float32Array(tris * 9), normals = new Float32Array(tris * 9), triFace = new Int32Array(tris);
  const faceIds: string[] = [];
  let t = 0;
  for (const m of parts) {
    const base = faceIds.length;
    positions.set(m.positions.subarray(0, m.triFace.length * 9), t * 9);
    normals.set(m.normals.subarray(0, m.triFace.length * 9), t * 9);
    for (let i = 0; i < m.triFace.length; i++) triFace[t + i] = m.triFace[i] + base;
    faceIds.push(...m.faceIds);
    t += m.triFace.length;
  }
  return { mesh: { positions, normals, triFace, faceIds }, edges, surfaceFaces };
}

/** The box around the solid (when it has one) and every surface body. */
export function mergedBox(solid: Box | null | undefined, hasSolid: boolean, surfaces: ViewSurface[]): Box {
  const boxes: Box[] = [];
  if (hasSolid && solid && !isEmptyBox(solid)) boxes.push(solid);
  for (const s of surfaces) if (s.box && !isEmptyBox(s.box)) boxes.push(s.box);
  if (!boxes.length) return solid ?? { min: [0, 0, 0], max: [0, 0, 0] };
  return {
    min: [0, 1, 2].map((a) => Math.min(...boxes.map((b) => b.min[a]))),
    max: [0, 1, 2].map((a) => Math.max(...boxes.map((b) => b.max[a]))),
  };
}

/** Colour a surface body is multiplied by, so a sheet reads differently from a solid whatever the part colour is. */
export const SURFACE_TINT: readonly [number, number, number] = [0.5, 0.86, 0.9];

/** Per-vertex colours for a grouped mesh: white for the solid, `SURFACE_TINT` for faces of surface bodies. */
export function vertexTints(ranges: Array<{ name: string; start: number; count: number }>, vertexCount: number, surfaceFaces: Set<string>): Float32Array {
  const out = new Float32Array(vertexCount * 3).fill(1);
  for (const r of ranges) {
    if (!surfaceFaces.has(r.name)) continue;
    for (let v = r.start; v < r.start + r.count; v++) { out[v * 3] = SURFACE_TINT[0]; out[v * 3 + 1] = SURFACE_TINT[1]; out[v * 3 + 2] = SURFACE_TINT[2]; }
  }
  return out;
}

/** Which surface body owns each face name and edge key (for hide / show and the tree). */
export function surfaceOwners(surfaces: Array<Pick<ViewSurface, 'id' | 'mesh' | 'edges'>>): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of surfaces) { for (const f of s.mesh.faceIds) m.set(f, s.id); for (const e of s.edges) if (e.key) m.set(e.key, s.id); }
  return m;
}
