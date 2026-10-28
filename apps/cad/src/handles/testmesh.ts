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

/** A cylinder about the z axis (radius r, z0..z1): the wall `<prefix>.S.c1` as `n` quads with smooth normals, the caps `<prefix>.C0` / `<prefix>.C1`, and the two rim circles as edges. */
export function cylinderMesh(r: number, z0: number, z1: number, prefix = 'F2', n = 48): { mesh: MeshLike; edges: ViewEdge[]; box: { min: number[]; max: number[] } } {
  const wall = `${prefix}.S.c1`, c0 = `${prefix}.C0`, c1 = `${prefix}.C1`;
  const positions: number[] = [], normals: number[] = [], triFace: number[] = [];
  const rim = (z: number): V3[] => Array.from({ length: n + 1 }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n), z]);
  const lo = rim(z0), hi = rim(z1);
  for (let i = 0; i < n; i++) {
    const q = [lo[i], lo[i + 1], hi[i + 1], hi[i]];
    for (const tri of [[0, 1, 2], [0, 2, 3]]) for (const k of tri) { positions.push(...q[k]); normals.push(q[k][0] / r, q[k][1] / r, 0); }
    triFace.push(0, 0);
  }
  for (let i = 0; i < n; i++) {
    for (const [pts, nz, f] of [[lo, -1, 1], [hi, 1, 2]] as Array<[V3[], number, number]>) {
      for (const p of [[0, 0, pts[0][2]] as V3, pts[i], pts[i + 1]]) { positions.push(...p); normals.push(0, 0, nz); }
      triFace.push(f);
    }
  }
  const edges: ViewEdge[] = [
    { key: `${wall}|${c0}#0`, faces: [wall, c0], pts: lo, mid: lo[0] },
    { key: `${wall}|${c1}#1`, faces: [wall, c1], pts: hi, mid: hi[0] },
  ];
  return { mesh: { positions, normals, triFace, faceIds: [wall, c0, c1] }, edges, box: { min: [-r, -r, z0], max: [r, r, z1] } };
}

/** A sphere (centre at the origin) as one face named `<name>`, `n` by `n` quads with smooth normals. */
export function sphereMesh(r: number, name = 'F2.S.s1', n = 24): MeshLike {
  const positions: number[] = [], normals: number[] = [], triFace: number[] = [];
  const at = (i: number, j: number): V3 => { const th = (Math.PI * i) / n, ph = (2 * Math.PI * j) / n; return [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)]; };
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const q = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
    for (const tri of [[0, 1, 2], [0, 2, 3]]) { for (const k of tri) { positions.push(q[k][0] * r, q[k][1] * r, q[k][2] * r); normals.push(...q[k]); } triFace.push(0); }
  }
  return { positions, normals, triFace, faceIds: [name] };
}
