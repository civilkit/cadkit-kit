import { checkMesh, facetNormal, type MeshCheck, type TriMesh } from './mesh';

export interface StlOptions {
  /** Solid name (the part name). Binary keeps the first 72 ASCII characters in the header. */
  name?: string;
  /** Default true. */
  binary?: boolean;
}

export interface StlResult {
  /** `Uint8Array` for binary, `string` for ASCII. */
  data: Uint8Array | string;
  triangles: number;
  /** Watertight report of the mesh that was written. */
  check: MeshCheck;
}

const safeName = (s: string | undefined) => (s ?? 'part').replace(/\s+/g, ' ').replace(/[^\x20-\x7e]/g, '_').trim() || 'part';

/** STL from the viewer's triangles (millimetres, counter-clockwise outward, as the kernel meshes them). Facet normals are
 *  recomputed from the corners, which is what slicers expect. */
export function meshToStl(m: TriMesh, opts: StlOptions = {}): StlResult {
  const p = m.positions;
  const n = Math.floor(p.length / 9);
  const name = safeName(opts.name);
  const check = checkMesh(m);
  if (opts.binary === false) {
    const out: string[] = [`solid ${name}`];
    for (let t = 0; t < n; t++) {
      const nn = facetNormal(p, t);
      out.push(`  facet normal ${nn.map(num).join(' ')}`, '    outer loop');
      for (let k = 0; k < 3; k++) out.push(`      vertex ${num(p[t * 9 + k * 3])} ${num(p[t * 9 + k * 3 + 1])} ${num(p[t * 9 + k * 3 + 2])}`);
      out.push('    endloop', '  endfacet');
    }
    out.push(`endsolid ${name}`);
    return { data: out.join('\n') + '\n', triangles: n, check };
  }
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  // the header must not start with "solid" or some readers take the file for ASCII
  const head = `binary STL ${name}`.slice(0, 80);
  for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i));
  dv.setUint32(80, n, true);
  for (let t = 0; t < n; t++) {
    const o = 84 + t * 50;
    const nn = facetNormal(p, t);
    for (let k = 0; k < 3; k++) dv.setFloat32(o + k * 4, nn[k], true);
    for (let k = 0; k < 9; k++) dv.setFloat32(o + 12 + k * 4, p[t * 9 + k], true);
    dv.setUint16(o + 48, 0, true);
  }
  return { data: new Uint8Array(buf), triangles: n, check };
}

const num = (v: number) => (Object.is(v, -0) ? 0 : v).toPrecision(9).replace(/\.?0+(e|$)/, '$1');

/** Read an STL (binary or ASCII) back into a triangle soup: the reader used by the tests and by anything that needs to
 *  check a file this package wrote. */
export function parseStl(data: Uint8Array | string): { name: string; positions: Float32Array; normals: Float32Array } {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 84) {
    const n = dv.getUint32(80, true);
    // the exact size is the reliable test: ASCII files can also start with "solid"
    if (84 + n * 50 === bytes.length) {
      const positions = new Float32Array(n * 9), normals = new Float32Array(n * 3);
      for (let t = 0; t < n; t++) {
        const o = 84 + t * 50;
        for (let k = 0; k < 3; k++) normals[t * 3 + k] = dv.getFloat32(o + k * 4, true);
        for (let k = 0; k < 9; k++) positions[t * 9 + k] = dv.getFloat32(o + 12 + k * 4, true);
      }
      const name = new TextDecoder().decode(bytes.subarray(0, 80)).replace(/\0+$/, '').replace(/^binary STL /, '');
      return { name, positions, normals };
    }
  }
  const text = typeof data === 'string' ? data : new TextDecoder().decode(bytes);
  const name = /^\s*solid\s*(.*)$/m.exec(text)?.[1]?.trim() ?? '';
  const pos: number[] = [], nor: number[] = [];
  for (const m of text.matchAll(/facet\s+normal\s+(\S+)\s+(\S+)\s+(\S+)/g)) nor.push(+m[1], +m[2], +m[3]);
  for (const m of text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) pos.push(+m[1], +m[2], +m[3]);
  return { name, positions: Float32Array.from(pos), normals: Float32Array.from(nor) };
}
