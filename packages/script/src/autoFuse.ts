// Implicit boolean fusion helpers: detect intersecting/touching lumps from live geometry
// and emit `combine` (union) features for each overlapping connected component while leaving
// disjoint solids untouched.
import type { Ctx, EditOp } from './core';
import type { Geometry, Vec } from './selectors';

/** Options for `fuseIntersecting()`. */
export interface FuseIntersectingOpts {
  /** Axis-aligned bounding-box overlap tolerance in mm (default 1e-4). */
  tolerance?: number;
}

/** Per-lump face list and 3D axis-aligned bounding box derived from live geometry. */
export interface LumpInfo {
  index: number;
  faces: string[];
  box: { min: Vec; max: Vec };
}

const ADDITIVE_TYPES = new Set([
  'extrude', 'revolve', 'sweep', 'loft',
  'box', 'cylinder', 'sphere', 'cone', 'torus', 'pipe', 'coil',
]);

/**
 * When `autoFuse` is active on an additive solid feature that did not explicitly specify
 * `op` (e.g. `'newBody'` or `'cut'`) or a `body` name, set `op: 'add'` so the kernel unites
 * it with intersecting solids while keeping non-intersecting solids separate.
 */
export function applyAutoFuseOp(feature: Record<string, unknown>): void {
  const type = typeof feature.type === 'string' ? feature.type : '';
  if (!ADDITIVE_TYPES.has(type)) return;
  if (feature.op !== undefined || feature.body !== undefined) return;
  feature.op = 'add';
}

/**
 * True when two 3D axis-aligned bounding boxes overlap or touch within `tol` mm.
 */
export function boxesOverlap(a: { min: Vec; max: Vec }, b: { min: Vec; max: Vec }, tol = 1e-4): boolean {
  return (
    a.min[0] <= b.max[0] + tol && b.min[0] <= a.max[0] + tol &&
    a.min[1] <= b.max[1] + tol && b.min[1] <= a.max[1] + tol &&
    a.min[2] <= b.max[2] + tol && b.min[2] <= a.max[2] + tol
  );
}

/**
 * Extract per-lump face sets and 3D bounding boxes from `geo`.
 * Uses `geo.faceLumps` when available, falling back to face-edge connected components
 * when a host does not supply `faceLumps`.
 */
export function lumpsFromGeometry(geo: Geometry): LumpInfo[] {
  const mesh = geo.mesh;
  if (!mesh || !mesh.positions.length || !mesh.faceIds.length) return [];

  const faceToLump = new Map<string, number>();
  if (geo.faceLumps && Object.keys(geo.faceLumps).length > 0) {
    for (const [fid, lump] of Object.entries(geo.faceLumps)) {
      faceToLump.set(fid, lump);
    }
  } else {
    // Fallback: partition faces into connected components using edge-face adjacency.
    const adj = new Map<string, Set<string>>();
    for (const fid of mesh.faceIds) {
      if (!adj.has(fid)) adj.set(fid, new Set());
    }
    for (const e of geo.edges ?? []) {
      const fs = e.faces ?? [];
      for (let i = 0; i < fs.length; i++) {
        let s = adj.get(fs[i]);
        if (!s) { s = new Set(); adj.set(fs[i], s); }
        for (let j = i + 1; j < fs.length; j++) {
          s.add(fs[j]);
          let t = adj.get(fs[j]);
          if (!t) { t = new Set(); adj.set(fs[j], t); }
          t.add(fs[i]);
        }
      }
    }
    let nextLump = 0;
    for (const fid of adj.keys()) {
      if (faceToLump.has(fid)) continue;
      const queue = [fid];
      faceToLump.set(fid, nextLump);
      for (let q = 0; q < queue.length; q++) {
        for (const nb of adj.get(queue[q]) ?? []) {
          if (!faceToLump.has(nb)) {
            faceToLump.set(nb, nextLump);
            queue.push(nb);
          }
        }
      }
      nextLump++;
    }
  }

  const byLump = new Map<number, { faces: Set<string>; box: { min: Vec; max: Vec } }>();
  const ensure = (lump: number) => {
    let entry = byLump.get(lump);
    if (!entry) {
      entry = { faces: new Set(), box: { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] } };
      byLump.set(lump, entry);
    }
    return entry;
  };

  const P = mesh.positions;
  const F = mesh.faceIds;
  const T = mesh.triFace;
  const triCount = Math.min(Math.floor(P.length / 9), T.length);
  for (let t = 0; t < triCount; t++) {
    const fid = F[T[t]];
    if (fid === undefined) continue;
    const lump = faceToLump.get(fid);
    if (lump === undefined) continue;
    const entry = ensure(lump);
    entry.faces.add(fid);
    const b = entry.box;
    for (let i = 0; i < 9; i++) {
      const k = i % 3;
      const v = P[t * 9 + i];
      if (v < b.min[k]) b.min[k] = v;
      if (v > b.max[k]) b.max[k] = v;
    }
  }

  // Include edge polyline points so curved faces (cylinders, spheres) reach exact extents.
  for (const e of geo.edges ?? []) {
    const fid = e.faces?.[0];
    if (!fid) continue;
    const lump = faceToLump.get(fid);
    if (lump === undefined) continue;
    const entry = byLump.get(lump);
    if (!entry) continue;
    const b = entry.box;
    for (const pt of e.pts ?? []) {
      for (let k = 0; k < 3; k++) {
        if (pt[k] < b.min[k]) b.min[k] = pt[k];
        if (pt[k] > b.max[k]) b.max[k] = pt[k];
      }
    }
  }

  const out: LumpInfo[] = [];
  for (const [index, entry] of [...byLump.entries()].sort((a, b) => a[0] - b[0])) {
    if (!entry.faces.size || !Number.isFinite(entry.box.min[0])) continue;
    out.push({ index, faces: [...entry.faces], box: entry.box });
  }
  return out;
}

/**
 * Group lumps into connected components of overlapping/touching AABBs (size >= 2).
 * Each group is ordered via BFS so every subsequent tool overlaps an earlier member.
 */
export function intersectingGroups(lumps: LumpInfo[], tol = 1e-4): LumpInfo[][] {
  if (lumps.length < 2) return [];
  const visited = new Array<boolean>(lumps.length).fill(false);
  const groups: LumpInfo[][] = [];

  for (let i = 0; i < lumps.length; i++) {
    if (visited[i]) continue;
    const comp: LumpInfo[] = [];
    const queue = [i];
    visited[i] = true;
    for (let q = 0; q < queue.length; q++) {
      const cur = queue[q];
      comp.push(lumps[cur]);
      for (let j = 0; j < lumps.length; j++) {
        if (!visited[j] && boxesOverlap(lumps[cur].box, lumps[j].box, tol)) {
          visited[j] = true;
          queue.push(j);
        }
      }
    }
    if (comp.length >= 2) groups.push(comp);
  }
  return groups;
}

/**
 * Emit `combine` (union) ops for every connected component of overlapping lumps in `ctx.geo`.
 * Uses persistent face selectors (`{ face }`) so untouched components are unaffected by
 * earlier combines and never suffer lump-index renumbering.
 */
export function fuseIntersectingOps(ctx: Ctx, tol = 1e-4): EditOp[] {
  const lumps = lumpsFromGeometry(ctx.geo);
  const groups = intersectingGroups(lumps, tol);
  if (!groups.length) return [];

  const ops: EditOp[] = [];
  for (const group of groups) {
    const id = ctx.nextId();
    const target = { face: group[0].faces[0] };
    const tools = group.slice(1).map((l) => ({ face: l.faces[0] }));
    ops.push({
      op: 'add',
      feature: { type: 'combine', id, op: 'union', target, tools, name: 'Auto-fuse' },
    });
    ctx.lastFeature = id;
  }
  return ops;
}
