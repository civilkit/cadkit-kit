// A box as the kernel's mesh arrays and edge list, for tests that need face geometry without the kernel.
import type { ViewEdge } from '../featureCommands';
import type { MeshLike } from './geom';

type V3 = [number, number, number];

/** An axis-aligned box whose faces carry the names of an extrude of a front-plane rectangle: C0 at min z, C1 at max z, S.e1..S.e4 on the sides. */
export function boxMesh(min: V3, max: V3, prefix = 'F2'): { mesh: MeshLike; edges: ViewEdge[]; box: { min: number[]; max: number[] } } {
  const [x0, y0, z0] = min, [x1, y1, z1] = max;
  const faces: Array<{ name: string; n: V3; quad: V3[] }> = [
    { name: `${prefix}.C0`, n: [0, 0, -1], quad: [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]] },
    { name: `${prefix}.C1`, n: [0, 0, 1], quad: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]] },
    { name: `${prefix}.S.e1`, n: [0, -1, 0], quad: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]] },
    { name: `${prefix}.S.e2`, n: [1, 0, 0], quad: [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]] },
    { name: `${prefix}.S.e3`, n: [0, 1, 0], quad: [[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]] },
    { name: `${prefix}.S.e4`, n: [-1, 0, 0], quad: [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]] },
  ];
  const positions: number[] = [], normals: number[] = [], triFace: number[] = [];
  faces.forEach((f, i) => {
    for (const tri of [[0, 1, 2], [0, 2, 3]]) { for (const k of tri) { positions.push(...f.quad[k]); normals.push(...f.n); } triFace.push(i); }
  });
  const edges: ViewEdge[] = [];
  for (let i = 0; i < faces.length; i++) for (let j = i + 1; j < faces.length; j++) {
    const a = faces[i], b = faces[j];
    if (a.n[0] * b.n[0] + a.n[1] * b.n[1] + a.n[2] * b.n[2] !== 0) continue;   // opposite faces share no edge
    // the shared edge: the quad corners both faces have in common
    const shared = a.quad.filter((p) => b.quad.some((q) => q[0] === p[0] && q[1] === p[1] && q[2] === p[2]));
    if (shared.length !== 2) continue;
    edges.push({ key: `${a.name}|${b.name}#${edges.length}`, faces: [a.name, b.name], pts: shared, mid: [0, 1, 2].map((k) => (shared[0][k] + shared[1][k]) / 2) });
  }
  return { mesh: { positions, normals, triFace, faceIds: faces.map((f) => f.name) }, edges, box: { min: [...min], max: [...max] } };
}
