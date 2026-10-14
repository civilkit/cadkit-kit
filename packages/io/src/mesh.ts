/** The part of the viewer's mesh the writers need: three vertices per triangle, xyz per vertex, in millimetres. */
export interface TriMesh { positions: ArrayLike<number> }

export interface MeshCheck {
  triangles: number;
  /** Distinct vertices after welding positions that agree to `tol`. */
  vertices: number;
  /** Edges used by exactly one triangle (a hole in the skin). */
  openEdges: number;
  /** Edges used by more than two triangles. */
  nonManifoldEdges: number;
  /** Edges that two triangles traverse in the same direction (one of them is flipped). */
  inconsistentEdges: number;
  /** Triangles with (nearly) zero area. */
  degenerate: number;
  watertight: boolean;
}

/** Weld the triangle soup: one vertex index per corner (3 per triangle) and the distinct vertex positions. */
export function weld(positions: ArrayLike<number>, tol = 1e-5): { index: Int32Array; verts: number[] } {
  const n = Math.floor(positions.length / 3);
  const index = new Int32Array(n);
  const verts: number[] = [];
  const grid = new Map<string, number>();
  const q = (v: number) => Math.round(v / tol);
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    const qx = q(x), qy = q(y), qz = q(z);
    let found = -1;
    // look in the 27 neighbouring cells so two points a hair apart across a cell border still weld
    outer: for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const k = grid.get(`${qx + dx},${qy + dy},${qz + dz}`);
      if (k === undefined) continue;
      if (Math.abs(verts[k * 3] - x) <= tol && Math.abs(verts[k * 3 + 1] - y) <= tol && Math.abs(verts[k * 3 + 2] - z) <= tol) { found = k; break outer; }
    }
    if (found < 0) {
      found = verts.length / 3;
      verts.push(x, y, z);
      grid.set(`${qx},${qy},${qz}`, found);
    }
    index[i] = found;
  }
  return { index, verts };
}

/** Is the skin closed? Counts the edges used once (open), more than twice (non-manifold) and walked twice in the same direction. */
export function checkMesh(m: TriMesh, tol = 1e-5): MeshCheck {
  const { index, verts } = weld(m.positions, tol);
  const triangles = Math.floor(index.length / 3);
  const edges = new Map<number, { n: number; fwd: number; back: number }>();
  const N = verts.length / 3;
  let degenerate = 0;
  for (let t = 0; t < triangles; t++) {
    const c = [index[t * 3], index[t * 3 + 1], index[t * 3 + 2]];
    const [a, b, d] = c;
    if (a === b || b === d || a === d) { degenerate++; continue; }
    for (let k = 0; k < 3; k++) {
      const u = c[k], v = c[(k + 1) % 3];
      const lo = Math.min(u, v), hi = Math.max(u, v);
      const key = lo * N + hi;
      const e = edges.get(key) ?? { n: 0, fwd: 0, back: 0 };
      e.n++;
      if (u < v) e.fwd++; else e.back++;
      edges.set(key, e);
    }
  }
  let openEdges = 0, nonManifoldEdges = 0, inconsistentEdges = 0;
  for (const e of edges.values()) {
    if (e.n === 1) openEdges++;
    else if (e.n > 2) nonManifoldEdges++;
    else if (e.fwd !== 1) inconsistentEdges++;
  }
  return { triangles, vertices: N, openEdges, nonManifoldEdges, inconsistentEdges, degenerate, watertight: triangles > 0 && openEdges === 0 && nonManifoldEdges === 0 };
}

/** Facet normal of triangle `t` (unit; zero vector for a degenerate triangle). */
export function facetNormal(p: ArrayLike<number>, t: number): [number, number, number] {
  const o = t * 9;
  const ux = p[o + 3] - p[o], uy = p[o + 4] - p[o + 1], uz = p[o + 5] - p[o + 2];
  const vx = p[o + 6] - p[o], vy = p[o + 7] - p[o + 1], vz = p[o + 8] - p[o + 2];
  const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
  const l = Math.hypot(x, y, z);
  return l > 0 ? [x / l, y / l, z / l] : [0, 0, 0];
}
