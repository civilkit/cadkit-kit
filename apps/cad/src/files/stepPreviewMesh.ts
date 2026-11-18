// Mesh-only preview of a STEP file: the triangles occt-import-js (OpenCascade) makes, flattened into the viewport's mesh layout.
// No kernel solids are built, so a large assembly shows in seconds-to-minutes instead of never; the result is view only.

/** The part of occt-import-js's `ReadStepFile` result this reads. */
export interface OcctMesh {
  name?: string;
  attributes: { position: { array: ArrayLike<number> }; normal?: { array: ArrayLike<number> } };
  index: { array: ArrayLike<number> };
  brep_faces?: Array<{ first: number; last: number }>;
}
export interface OcctNode { name?: string; meshes?: number[]; children?: OcctNode[] }
export interface OcctResult { success: boolean; meshes: OcctMesh[]; root?: OcctNode }

/** One row of the assembly tree: a product (a named node of the file) or one body (one mesh) of a product. The viewport hides by the
 *  owner id of a face name (`F<id>.<n>`), so hiding a row means hiding its id and the ids of everything under it. */
export interface PreviewNode { id: number; name: string; parent: number; kind: 'product' | 'body'; triangles: number }

/** Flat triangles (9 floats per triangle, like the kernel's body mesh), one face id per triangle. */
export interface PreviewMesh {
  positions: Float32Array;
  normals: Float32Array;
  triFace: Int32Array;
  faceIds: string[];
  box: { min: number[]; max: number[] };
  triangles: number;
  nodes: PreviewNode[];
  /** Meshes (one per colour or surface group of a product) and products (named assembly nodes that own meshes). */
  meshes: number;
  products: number;
}

/** Owner id of a node, as the face names carry it. */
export const nodeOwner = (id: number): string => `F${id}`;

/** The nodes of the file's product tree: named nodes become products (unnamed wrappers are skipped), every mesh a body under the
 *  product that lists it. Meshes no product lists go under an "Other" product. `bodyOf[i]` is the body node of mesh i. */
function buildNodes(r: OcctResult): { nodes: PreviewNode[]; bodyOf: number[] } {
  const nodes: PreviewNode[] = [];
  const bodyOf: number[] = new Array(r.meshes.length).fill(0);
  const add = (name: string, parent: number, kind: PreviewNode['kind']): number => { const id = nodes.length + 1; nodes.push({ id, name, parent, kind, triangles: 0 }); return id; };
  const bodies = (product: number, ids: number[]) => ids.forEach((mi, k) => {
    if (bodyOf[mi] || !r.meshes[mi]) return;
    bodyOf[mi] = add(r.meshes[mi].name || `Body ${k + 1}`, product, 'body');
  });
  const walk = (n: OcctNode | undefined, parent: number) => {
    if (!n) return;
    let here = parent;
    if (n.name || n.meshes?.length) { here = add(n.name || 'Product', parent, 'product'); bodies(here, n.meshes ?? []); }
    n.children?.forEach((c) => walk(c, here));
  };
  walk(r.root, 0);
  const loose = r.meshes.map((_, i) => i).filter((i) => !bodyOf[i]);
  if (loose.length) bodies(add('Other', 0, 'product'), loose);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  r.meshes.forEach((m, i) => { const tris = Math.floor(m.index.array.length / 3); for (let n = byId.get(bodyOf[i]); n; n = byId.get(n.parent)) n.triangles += tris; });
  return { nodes, bodyOf };
}

export function buildPreviewMesh(r: OcctResult): PreviewMesh {
  const { nodes, bodyOf } = buildNodes(r);
  let tris = 0;
  for (const m of r.meshes) tris += Math.floor(m.index.array.length / 3);
  const positions = new Float32Array(tris * 9), normals = new Float32Array(tris * 9), triFace = new Int32Array(tris);
  const faceIds: string[] = [];
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let t = 0;
  r.meshes.forEach((m, mi) => {
    const pos = m.attributes.position.array, nor = m.attributes.normal?.array, idx = m.index.array;
    const n = Math.floor(idx.length / 3);
    const base = faceIds.length;
    const ranges = m.brep_faces?.length ? m.brep_faces : [{ first: 0, last: n - 1 }];
    ranges.forEach((_, k) => faceIds.push(`${nodeOwner(bodyOf[mi])}.${k}`));
    const faceOf = new Int32Array(n);
    ranges.forEach((f, k) => { for (let i = Math.max(0, f.first); i <= Math.min(n - 1, f.last); i++) faceOf[i] = base + k; });
    for (let i = 0; i < n; i++, t++) {
      const v = [idx[3 * i], idx[3 * i + 1], idx[3 * i + 2]];
      for (let c = 0; c < 3; c++) for (let a = 0; a < 3; a++) {
        const x = pos[3 * v[c] + a];
        positions[9 * t + 3 * c + a] = x;
        if (x < min[a]) min[a] = x;
        if (x > max[a]) max[a] = x;
        if (nor) normals[9 * t + 3 * c + a] = nor[3 * v[c] + a];
      }
      if (!nor) { // flat normal when the file gave none
        const o = 9 * t, ux = positions[o + 3] - positions[o], uy = positions[o + 4] - positions[o + 1], uz = positions[o + 5] - positions[o + 2];
        const wx = positions[o + 6] - positions[o], wy = positions[o + 7] - positions[o + 1], wz = positions[o + 8] - positions[o + 2];
        let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
        const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        for (let c = 0; c < 3; c++) { normals[o + 3 * c] = nx; normals[o + 3 * c + 1] = ny; normals[o + 3 * c + 2] = nz; }
      }
      triFace[t] = faceOf[i];
    }
  });
  if (!tris) { min.fill(0); max.fill(0); }
  const products = nodes.filter((n) => n.kind === 'product' && nodes.some((b) => b.parent === n.id && b.kind === 'body')).length;
  return { positions, normals, triFace, faceIds, box: { min, max }, triangles: tris, nodes, meshes: r.meshes.length, products };
}

/** Foxtrot's output as the shape the mesh builder reads: one mesh per placed solid (`tris` holds start/end triangle pairs into
 *  the flat arrays), and a product tree made from each solid's path of product names (root first, joined by U+001F). Siblings
 *  with the same name share a node. */
export function resultOfBodies(positions: Float32Array, normals: Float32Array, names: string[], paths: string[], tris: ArrayLike<number>): OcctResult {
  let longest = 0;
  for (let i = 0; i < names.length; i++) longest = Math.max(longest, tris[2 * i + 1] - tris[2 * i]);
  const iota = new Uint32Array(longest * 3);
  for (let i = 0; i < iota.length; i++) iota[i] = i;
  const meshes: OcctMesh[] = [];
  const root: OcctNode = { name: '', children: [] };
  const kids = new Map<OcctNode, Map<string, OcctNode>>();
  names.forEach((name, i) => {
    const a = tris[2 * i], b = tris[2 * i + 1];
    meshes.push({ name, attributes: { position: { array: positions.subarray(a * 9, b * 9) }, normal: { array: normals.subarray(a * 9, b * 9) } }, index: { array: iota.subarray(0, (b - a) * 3) } });
    let node = root;
    for (const seg of paths[i] ? paths[i].split('\u001f') : []) {
      let m = kids.get(node);
      if (!m) kids.set(node, m = new Map());
      let c = m.get(seg);
      if (!c) { c = { name: seg, children: [] }; m.set(seg, c); node.children!.push(c); }
      node = c;
    }
    (node.meshes ??= []).push(i);
  });
  return { success: true, meshes, root };
}
