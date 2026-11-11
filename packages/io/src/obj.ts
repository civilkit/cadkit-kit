import { facetNormal, parseHexColor, weld, type MeshBody, type TriMesh } from './mesh';

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

/**
 * Wavefront OBJ of several bodies (millimetres): one `o` object per body, welded per body. When any body has a colour every vertex line carries the common
 * `x y z r g b` extension (0 to 1, sRGB; a body without a colour is light grey), which Blender, MeshLab and most viewers read; with no colour at all the file is plain.
 */
export function bodiesToObj(bodies: readonly MeshBody[]): { data: string; triangles: number; vertices: number; bodies: number; coloured: boolean } {
  const coloured = bodies.some((b) => parseHexColor(b.color));
  const out: string[] = ['# units: mm'];
  let base = 0, triangles = 0, used = 0;
  for (const b of bodies) {
    const { index, verts } = weld(b.positions);
    const faces: string[] = [];
    const m = { positions: b.positions };
    for (let t = 0; t < Math.floor(index.length / 3); t++) {
      const a = index[t * 3] + 1 + base, c = index[t * 3 + 1] + 1 + base, d = index[t * 3 + 2] + 1 + base;
      if (a === c || c === d || a === d) continue;
      if (facetNormal(m.positions, t).every((v) => v === 0)) continue;
      faces.push(`f ${a} ${c} ${d}`);
    }
    if (!faces.length) continue;
    const rgb = parseHexColor(b.color) ?? [204, 204, 204];
    const tail = coloured ? ` ${+(rgb[0] / 255).toFixed(4)} ${+(rgb[1] / 255).toFixed(4)} ${+(rgb[2] / 255).toFixed(4)}` : '';
    out.push(`o ${(b.name ?? 'body').replace(/\s+/g, '_') || 'body'}`);
    for (let i = 0; i < verts.length; i += 3) out.push(`v ${verts[i]} ${verts[i + 1]} ${verts[i + 2]}${tail}`);
    out.push(...faces);
    base += verts.length / 3;
    triangles += faces.length;
    used++;
  }
  return { data: out.join('\n') + '\n', triangles, vertices: base, bodies: used, coloured };
}
