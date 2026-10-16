// Hand-made meshes for tests: no kernel needed.
import type { SnapshotInput } from './types.js';

/** Axis-aligned box as 12 triangles (outward normals), with its 12 edges. */
export function boxInput(min: [number, number, number], max: [number, number, number], name = 'Box'): SnapshotInput {
  const [x0, y0, z0] = min, [x1, y1, z1] = max;
  const P = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const quads: Array<[number[], number[]]> = [
    [[0, 3, 2, 1], [0, 0, -1]], [[4, 5, 6, 7], [0, 0, 1]], [[0, 1, 5, 4], [0, -1, 0]],
    [[2, 3, 7, 6], [0, 1, 0]], [[1, 2, 6, 5], [1, 0, 0]], [[3, 0, 4, 7], [-1, 0, 0]],
  ];
  const pos: number[] = [], nrm: number[] = [], tf: number[] = [];
  quads.forEach(([q, n], f) => {
    for (const tri of [[q[0], q[1], q[2]], [q[0], q[2], q[3]]]) { for (const i of tri) { pos.push(...P[i]); nrm.push(...n); } tf.push(f); }
  });
  const E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  return {
    mesh: { positions: Float32Array.from(pos), normals: Float32Array.from(nrm), triFace: Int32Array.from(tf), faceIds: ['-z', '+z', '-y', '+y', '+x', '-x'] },
    edges: E.map(([a, b], i) => ({ key: 'e' + i, pts: [P[a], P[b]] })),
    box: { min, max }, name,
  };
}

/** Concatenate meshes (an L shape is two boxes). */
export function union(name: string, ...parts: SnapshotInput[]): SnapshotInput {
  const pos: number[] = [], nrm: number[] = [], tf: number[] = [], faceIds: string[] = [];
  const edges: NonNullable<SnapshotInput['edges']> = [];
  parts.forEach((p, k) => {
    pos.push(...(p.mesh.positions as Float32Array)); nrm.push(...(p.mesh.normals as Float32Array));
    for (const f of p.mesh.triFace as Int32Array) tf.push(f + faceIds.length);
    faceIds.push(...p.mesh.faceIds!.map((s) => `${k}:${s}`));
    edges.push(...(p.edges ?? []));
  });
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], pos[i + a]); max[a] = Math.max(max[a], pos[i + a]); }
  return { mesh: { positions: Float32Array.from(pos), normals: Float32Array.from(nrm), triFace: Int32Array.from(tf), faceIds }, edges, box: { min, max }, name };
}
