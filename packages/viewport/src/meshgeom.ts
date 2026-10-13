export interface BodyMesh { positions: Float32Array; normals: Float32Array; triFace: Int32Array; faceIds: string[]; }
export interface FaceRange { name: string; start: number; count: number }
export interface Grouped { positions: Float32Array; normals: Float32Array; ranges: FaceRange[]; triOrder: Int32Array }

export function groupByFace(m: BodyMesh): Grouped {
  const nTri = m.triFace.length;
  const order = Array.from({ length: nTri }, (_, i) => i).sort((a, b) => m.triFace[a] - m.triFace[b] || a - b);
  const positions = new Float32Array(nTri * 9);
  const normals = new Float32Array(nTri * 9);
  const ranges: FaceRange[] = [];
  order.forEach((t, k) => {
    positions.set(m.positions.subarray(t * 9, t * 9 + 9), k * 9);
    normals.set(m.normals.subarray(t * 9, t * 9 + 9), k * 9);
    const f = m.triFace[t];
    const last = ranges.at(-1);
    if (last && last.name === m.faceIds[f]) last.count += 3;
    else ranges.push({ name: m.faceIds[f] ?? `face#${f}`, start: k * 3, count: 3 });
  });
  return { positions, normals, ranges, triOrder: Int32Array.from(order) };
}

export function edgeSegments(edges: Array<{ pts: number[][] }>): Float32Array {
  const out: number[] = [];
  for (const e of edges) for (let i = 0; i + 1 < e.pts.length; i++) out.push(...e.pts[i], ...e.pts[i + 1]);
  return Float32Array.from(out);
}

export function faceOfVertexIndex(g: Grouped, vertexIndex: number): string | null {
  for (const r of g.ranges) if (vertexIndex >= r.start && vertexIndex < r.start + r.count) return r.name;
  return null;
}