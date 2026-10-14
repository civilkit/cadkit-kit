import { facetNormal, weld, type TriMesh } from './mesh';

/** Wavefront OBJ (millimetres): welded vertices, one `o` object named after the part, counter-clockwise faces. */
export function meshToObj(m: TriMesh, opts: { name?: string } = {}): { data: string; triangles: number; vertices: number } {
  const { index, verts } = weld(m.positions);
  const n = Math.floor(index.length / 3);
  const name = (opts.name ?? 'part').replace(/\s+/g, '_') || 'part';
  let faces = 0;
  const out: string[] = [`# units: mm`, `o ${name}`];
  for (let i = 0; i < verts.length; i += 3) out.push(`v ${verts[i]} ${verts[i + 1]} ${verts[i + 2]}`);
  for (let t = 0; t < n; t++) {
    const a = index[t * 3] + 1, b = index[t * 3 + 1] + 1, c = index[t * 3 + 2] + 1;
    if (a === b || b === c || a === c) continue;
    if (facetNormal(m.positions, t).every((v) => v === 0)) continue;
    out.push(`f ${a} ${b} ${c}`);
    faces++;
  }
  return { data: out.join('\n') + '\n', triangles: faces, vertices: verts.length / 3 };
}
