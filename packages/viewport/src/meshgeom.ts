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

/** The triangles of the named faces (positions and normals, three numbers per vertex). */
export function facesGeometry(g: Grouped, names: Iterable<string>): { positions: number[]; normals: number[] } {
  const want = new Set(names);
  const positions: number[] = [], normals: number[] = [];
  for (const r of g.ranges) {
    if (!want.has(r.name)) continue;
    for (let i = r.start * 3; i < (r.start + r.count) * 3; i++) { positions.push(g.positions[i]); normals.push(g.normals[i]); }
  }
  return { positions, normals };
}

/** The box around the named faces and edges (null when none of the names is on the body). */
export function namesBox(g: Grouped | null, edges: Array<{ key?: string; pts: number[][] }>, names: string[]): { min: number[]; max: number[] } | null {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const add = (x: number, y: number, z: number) => { const v = [x, y, z]; for (let k = 0; k < 3; k++) { if (v[k] < min[k]) min[k] = v[k]; if (v[k] > max[k]) max[k] = v[k]; } };
  const want = new Set(names);
  if (g) for (const r of g.ranges) if (want.has(r.name)) for (let i = r.start; i < r.start + r.count; i++) add(g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2]);
  edges.forEach((e, i) => { if (want.has(e.key ?? `edge#${i}`)) for (const p of e.pts) add(p[0], p[1], p[2]); });
  return min[0] === Infinity ? null : { min, max };
}
