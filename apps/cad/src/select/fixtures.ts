// Small hand-built bodies for the selection tests (no kernel): a box, a block with a rounded edge, and two separate boxes.
import type { SelData, SelEdge } from './model';

type V = number[];
export interface Quad { id: string; n: V; corners: [V, V, V, V] }

/** Mesh arrays from quads (two triangles each, one normal per vertex). */
export function meshOf(quads: Quad[]): { positions: Float32Array; normals: Float32Array; triFace: Int32Array; faceIds: string[] } {
  const positions: number[] = [], normals: number[] = [], triFace: number[] = [];
  const faceIds = quads.map((q) => q.id);
  quads.forEach((q, fi) => {
    const [a, b, c, d] = q.corners;
    for (const tri of [[a, b, c], [a, c, d]]) { for (const p of tri) { positions.push(...p); normals.push(...q.n); } triFace.push(fi); }
  });
  return { positions: Float32Array.from(positions), normals: Float32Array.from(normals), triFace: Int32Array.from(triFace), faceIds };
}

const p = (x: number, y: number, z: number): V => [x, y, z];
/** An axis-aligned box [x0..x1] x [y0..y1] x [z0..z1] with face ids `${pre}+x` ... and its 12 edges. */
export function box(pre: string, o: V, s: V): { quads: Quad[]; edges: SelEdge[] } {
  const [x0, y0, z0] = o, [x1, y1, z1] = [o[0] + s[0], o[1] + s[1], o[2] + s[2]];
  const quads: Quad[] = [
    { id: pre + '+x', n: [1, 0, 0], corners: [p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1), p(x1, y0, z1)] },
    { id: pre + '-x', n: [-1, 0, 0], corners: [p(x0, y0, z0), p(x0, y0, z1), p(x0, y1, z1), p(x0, y1, z0)] },
    { id: pre + '+y', n: [0, 1, 0], corners: [p(x0, y1, z0), p(x0, y1, z1), p(x1, y1, z1), p(x1, y1, z0)] },
    { id: pre + '-y', n: [0, -1, 0], corners: [p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1)] },
    { id: pre + '+z', n: [0, 0, 1], corners: [p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1)] },
    { id: pre + '-z', n: [0, 0, -1], corners: [p(x0, y0, z0), p(x0, y1, z0), p(x1, y1, z0), p(x1, y0, z0)] },
  ];
  const e = (k: string, a: V, b: V, f1: string, f2: string): SelEdge => ({ key: `${pre}${k}`, faces: [pre + f1, pre + f2], pts: [a, b] });
  const edges: SelEdge[] = [
    e('x00|0', p(x0, y0, z0), p(x1, y0, z0), '-y', '-z'), e('x10|0', p(x0, y1, z0), p(x1, y1, z0), '+y', '-z'),
    e('x01|0', p(x0, y0, z1), p(x1, y0, z1), '-y', '+z'), e('x11|0', p(x0, y1, z1), p(x1, y1, z1), '+y', '+z'),
    e('y00|0', p(x0, y0, z0), p(x0, y1, z0), '-x', '-z'), e('y10|0', p(x1, y0, z0), p(x1, y1, z0), '+x', '-z'),
    e('y01|0', p(x0, y0, z1), p(x0, y1, z1), '-x', '+z'), e('y11|0', p(x1, y0, z1), p(x1, y1, z1), '+x', '+z'),
    e('z00|0', p(x0, y0, z0), p(x0, y0, z1), '-x', '-y'), e('z10|0', p(x1, y0, z0), p(x1, y0, z1), '+x', '-y'),
    e('z01|0', p(x0, y1, z0), p(x0, y1, z1), '-x', '+y'), e('z11|0', p(x1, y1, z0), p(x1, y1, z1), '+x', '+y'),
  ];
  return { quads, edges };
}

export function boxData(o: V = [0, 0, 0], s: V = [10, 6, 4]): SelData {
  const b = box('B', o, s);
  return { mesh: meshOf(b.quads), edges: b.edges };
}
/** Two boxes that do not touch: two bodies. */
export function twoBoxes(): SelData {
  const a = box('A', [0, 0, 0], [10, 6, 4]), b = box('C', [30, 0, 0], [2, 2, 2]);
  return { mesh: meshOf([...a.quads, ...b.quads]), edges: [...a.edges, ...b.edges] };
}

/** A quarter-round profile along y: top plane (z=0, x 0..10), a quarter cylinder (r 2, centre (10,*,-2)) and a wall at x=12 going down to z=-8.
 *  Edges: top-to-round (tangent), round-to-wall (tangent), and the top's far edge with the front plate (a sharp 90 degree edge). */
export function roundedData(): SelData {
  const arc = (a: number): V => [10 + 2 * Math.sin(a), 0, -2 + 2 * Math.cos(a)];
  const arcAt = (a: number, y: number): V => { const q = arc(a); return [q[0], y, q[2]]; };
  const N = 8;
  const round: number[] = [], rn: number[] = [], rt: number[] = [];
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI / 2, a1 = ((i + 1) / N) * Math.PI / 2;
    const n0 = [Math.sin(a0), 0, Math.cos(a0)], n1 = [Math.sin(a1), 0, Math.cos(a1)];
    const q = [arcAt(a0, 0), arcAt(a1, 0), arcAt(a1, 5), arcAt(a0, 5)];
    const ns = [n0, n1, n1, n0];
    for (const t of [[0, 1, 2], [0, 2, 3]]) for (const k of t) { round.push(...q[k]); rn.push(...ns[k]); }
    rt.push(2);
  }
  const top = meshOf([{ id: 'T', n: [0, 0, 1], corners: [p(0, 0, 0), p(10, 0, 0), p(10, 5, 0), p(0, 5, 0)] }, { id: 'W', n: [1, 0, 0], corners: [p(12, 0, -2), p(12, 5, -2), p(12, 5, -8), p(12, 0, -8)] }, { id: 'F', n: [0, -1, 0], corners: [p(0, 0, 0), p(0, 0, -8), p(12, 0, -8), p(12, 0, -2)] }]);
  // faces T=0, W=1, F=2, R=3 (the round)
  const positions = [...top.positions, ...round], normals = [...top.normals, ...rn];
  const triFace = [...top.triFace, ...Array(round.length / 9).fill(3)];
  const mesh = { positions: Float32Array.from(positions), normals: Float32Array.from(normals), triFace: Int32Array.from(triFace), faceIds: ['T', 'W', 'F', 'R'] };
  const arcPts = (y: number) => Array.from({ length: N + 1 }, (_, i) => arcAt((i / N) * Math.PI / 2, y));
  const edges: SelEdge[] = [
    { key: 'TR|a#0', faces: ['T', 'R'], pts: [p(10, 0, 0), p(10, 5, 0)] },
    { key: 'RW|a#1', faces: ['R', 'W'], pts: [p(12, 0, -2), p(12, 5, -2)] },
    // the line along the top, the arc of the round and the wall's line, front side: a tangent chain
    { key: 'TF|b#2', faces: ['T', 'F'], pts: [p(0, 0, 0), p(10, 0, 0)] },
    { key: 'RF|b#3', faces: ['R', 'F'], pts: arcPts(0) },
    { key: 'WF|b#4', faces: ['W', 'F'], pts: [p(12, 0, -2), p(12, 0, -8)] },
    { key: 'TF|c#5', faces: ['T', 'F'], pts: [p(0, 0, 0), p(0, 0, -8)] },
  ];
  return { mesh, edges };
}
