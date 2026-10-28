// Per-body appearance and visibility in the viewport. A body is a connected set of faces (the app finds them and gives each a stable
// key); this module holds the pure parts: the finishes, which bodies are drawn in the transparent pass and in what order, which
// faces a hidden body takes with it, and which hit of a ray is the one a click means (pass-through below PICK_OPACITY).
import type { BodyMesh } from './meshgeom';
import type { KnurlView } from './knurlview';

export type Finish = 'matte' | 'plastic' | 'chrome' | 'glass' | 'brushed';
export const FINISHES: readonly Finish[] = ['matte', 'plastic', 'chrome', 'glass', 'brushed'];

/** `metallic` and `roughness` (0..1) are the PBR values of the material: they replace the finish's own when set. */
export interface BodyLookSpec { color?: string; opacity?: number; finish?: Finish; metallic?: number; roughness?: number }
export interface ViewBodyDef { key: string; faces: string[]; edges?: string[] }
/** What the viewport needs to draw bodies individually: the bodies, the look of those that have one (keyed by body key), the hidden keys. */
export interface BodyViewSpec {
  bodies: ViewBodyDef[]; looks: Record<string, BodyLookSpec>; hidden: string[];
  /** colour and finish of single faces by face name (they win over their body's; the opacity of a face is ignored) */
  faces?: Record<string, BodyLookSpec>;
  /** cosmetic knurls: shading on the matching cylinders, no geometry (see knurlview.ts) */
  knurls?: KnurlView[];
}

/** Faces of a body whose opacity is below this are skipped by a click when something lies behind them. */
export const PICK_OPACITY = 0.35;
export const MIN_OPACITY = 0.05;

export const clampBodyOpacity = (v: unknown): number => (typeof v === 'number' && isFinite(v) ? Math.min(1, Math.max(MIN_OPACITY, v)) : 1);

export function finishParams(f: Finish | undefined): { roughness: number; metalness: number } {
  switch (f) {
    case 'chrome': return { roughness: 0.06, metalness: 1 };
    case 'brushed': return { roughness: 0.32, metalness: 0.9 };
    case 'glass': return { roughness: 0.04, metalness: 0 };
    case 'plastic': return { roughness: 0.42, metalness: 0 };
    case 'matte': return { roughness: 0.85, metalness: 0 };
    default: return { roughness: 0.24, metalness: 0.45 };   // the part's default satin metal
  }
}

export const clampUnit = (v: unknown): number | undefined => (typeof v === 'number' && isFinite(v) ? Math.min(1, Math.max(0, v)) : undefined);

/** Roughness and metalness a look asks for: the PBR values when set, else its finish's, else null (the part's material stands). */
export function lookMaterial(l: BodyLookSpec | undefined): { roughness: number | null; metalness: number | null } {
  const f = l?.finish ? finishParams(l.finish) : null;
  return { roughness: clampUnit(l?.roughness) ?? f?.roughness ?? null, metalness: clampUnit(l?.metallic) ?? f?.metalness ?? null };
}
/** Whether a look changes the colour or the material at all (opacity is drawn separately). */
export const looksTinted = (l: BodyLookSpec | undefined): boolean => !!l && (l.color !== undefined || l.finish !== undefined || l.metallic !== undefined || l.roughness !== undefined);

/** The opacity a look draws with (1 when it sets none). */
export const lookOpacity = (l: BodyLookSpec | undefined): number => clampBodyOpacity(l?.opacity ?? 1);

/** Faces that belong to a hidden body, and the edge keys with them. */
export function hiddenSets(spec: BodyViewSpec): { faces: Set<string>; edges: Set<string> } {
  const hid = new Set(spec.hidden);
  const faces = new Set<string>(), edges = new Set<string>();
  for (const b of spec.bodies) if (hid.has(b.key)) { for (const f of b.faces) faces.add(f); for (const e of b.edges ?? []) edges.add(e); }
  return { faces, edges };
}

/** The mesh and edges without the given faces and edge keys (a hidden body: nothing is rebuilt, the kernel body is untouched). */
export function withoutFaces<E extends { key?: string }>(mesh: BodyMesh, edges: E[], faces: ReadonlySet<string>, edgeKeys: ReadonlySet<string>): { mesh: BodyMesh; edges: E[] } {
  const keptEdges = edges.filter((e) => !(e.key && edgeKeys.has(e.key)));
  const hide = mesh.faceIds.map((n) => faces.has(n));
  if (!hide.some(Boolean)) return { mesh, edges: keptEdges };
  const keep: number[] = [];
  for (let t = 0; t < mesh.triFace.length; t++) if (!hide[mesh.triFace[t]]) keep.push(t);
  const positions = new Float32Array(keep.length * 9), normals = new Float32Array(keep.length * 9), triFace = new Int32Array(keep.length);
  keep.forEach((t, k) => {
    positions.set(mesh.positions.subarray(t * 9, t * 9 + 9), k * 9);
    normals.set(mesh.normals.subarray(t * 9, t * 9 + 9), k * 9);
    triFace[k] = mesh.triFace[t];
  });
  return { mesh: { positions, normals, triFace, faceIds: mesh.faceIds }, edges: keptEdges };
}

/** The bodies drawn in the transparent pass (visible, opacity below 1), in a fixed order; the face -> 1-based index of that list.
 *  Faces of every other body are not in the map (rank 0: the opaque pass). */
export function transparentBodies(spec: BodyViewSpec): { keys: string[]; rank: Map<string, number> } {
  const hid = new Set(spec.hidden);
  const keys: string[] = [];
  const rank = new Map<string, number>();
  for (const b of spec.bodies) {
    if (hid.has(b.key) || lookOpacity(spec.looks[b.key]) >= 1) continue;
    keys.push(b.key);
    for (const f of b.faces) rank.set(f, keys.length);
  }
  return { keys, rank };
}

/** Indices of `centres` ordered farthest from the camera first: the order transparent bodies must be drawn in. Ties keep their order. */
export function backToFront(centres: ReadonlyArray<readonly [number, number, number]>, cam: readonly [number, number, number]): number[] {
  const d = centres.map((c) => (c[0] - cam[0]) ** 2 + (c[1] - cam[1]) ** 2 + (c[2] - cam[2]) ** 2);
  return centres.map((_, i) => i).sort((a, b) => d[b] - d[a] || a - b);
}

/** Which hit a click means: hits are sorted nearest first; a hit on a body below `threshold` opacity is skipped when anything lies behind
 *  it, but it is taken when it is the only hit (or every hit is that clear). Returns the index into `hits`, or -1 for none. */
export function pickThrough(hits: ReadonlyArray<{ opacity: number }>, threshold = PICK_OPACITY): number {
  if (!hits.length) return -1;
  const i = hits.findIndex((h) => h.opacity >= threshold);
  return i >= 0 ? i : 0;
}

/** The centre of the vertices of one contiguous triangle range of a position array (a transparent body's sort key). */
export function rangeCentre(positions: ArrayLike<number>, startVertex: number, vertexCount: number): [number, number, number] {
  let x = 0, y = 0, z = 0;
  for (let v = startVertex; v < startVertex + vertexCount; v++) { x += positions[v * 3]; y += positions[v * 3 + 1]; z += positions[v * 3 + 2]; }
  const n = Math.max(1, vertexCount);
  return [x / n, y / n, z / n];
}
