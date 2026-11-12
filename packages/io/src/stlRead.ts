// STL import: binary and ASCII, units, welding. Typed arrays throughout (no object per triangle), so a million triangles read in
// well under a second natively. The result is an indexed mesh (welded vertices + triangle corners), what the viewer, the BVH and the
// document store.
import { checkIndexed, type MeshCheck } from './mesh';

export type StlUnit = 'mm' | 'cm' | 'm' | 'in';
export const STL_UNITS: StlUnit[] = ['mm', 'cm', 'm', 'in'];
/** Millimetres per unit. */
export const UNIT_MM: Record<StlUnit, number> = { mm: 1, cm: 10, m: 1000, in: 25.4 };

/** Welded vertices (xyz, millimetres) and triangle corners (3 per triangle, counter-clockwise outward as the file gives them). */
export interface IndexedMesh { vertices: Float32Array; indices: Uint32Array }

export type StlErrorCode = 'empty' | 'tooShort' | 'noFacets' | 'badNumber' | 'allDegenerate';
export class StlError extends Error {
  constructor(readonly code: StlErrorCode, message: string) { super(message); this.name = 'StlError'; }
}
export type StlWarning = 'truncated' | 'degenerate' | 'trailingBytes';

export interface StlRead {
  name: string;
  format: 'binary' | 'ascii';
  mesh: IndexedMesh;
  /** triangles kept (after the degenerate ones were dropped) */
  triangles: number;
  /** triangles the file held */
  fileTriangles: number;
  /** triangles that collapsed to a line or point once vertices were welded, dropped */
  degenerate: number;
  bbox: { min: [number, number, number]; max: [number, number, number] };
  check: MeshCheck;
  warnings: StlWarning[];
}

export interface StlReadOptions {
  /** The unit the file's numbers are in (STL has none); default mm. */
  unit?: StlUnit;
}

/** Positions (9 floats a triangle, millimetres) -> welded indexed mesh. Vertices that are bit-for-bit equal (the case for any STL
 *  a CAD or scanner wrote) are one vertex. Triangles that collapse are dropped; `keep` (one byte per input triangle) is set to 1 for the kept ones. */
export function indexMesh(pos: Float32Array, keep?: Uint8Array): { mesh: IndexedMesh; dropped: number } {
  const corners = pos.length / 3 | 0;
  const bits = new Uint32Array(pos.buffer, pos.byteOffset, pos.length);
  let size = 16;
  while (size < corners * 2) size <<= 1;
  const mask = size - 1;
  const table = new Int32Array(size).fill(-1);
  const verts = new Float32Array(corners * 3);
  let nv = 0;
  const idx = new Uint32Array(corners);
  for (let c = 0; c < corners; c++) {
    // -0 and +0 are one coordinate
    const x = bits[c * 3] === 0x80000000 ? 0 : bits[c * 3], y = bits[c * 3 + 1] === 0x80000000 ? 0 : bits[c * 3 + 1], z = bits[c * 3 + 2] === 0x80000000 ? 0 : bits[c * 3 + 2];
    let h = Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b) ^ Math.imul(z, 0xc2b2ae35);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
    let s = h & mask;
    for (;;) {
      const v = table[s];
      if (v < 0) {
        table[s] = nv;
        verts[nv * 3] = pos[c * 3] === 0 ? 0 : pos[c * 3]; verts[nv * 3 + 1] = pos[c * 3 + 1] === 0 ? 0 : pos[c * 3 + 1]; verts[nv * 3 + 2] = pos[c * 3 + 2] === 0 ? 0 : pos[c * 3 + 2];
        idx[c] = nv++;
        break;
      }
      const ob = v * 3;
      if (verts[ob] === pos[c * 3] && verts[ob + 1] === pos[c * 3 + 1] && verts[ob + 2] === pos[c * 3 + 2]) { idx[c] = v; break; }
      s = (s + 1) & mask;
    }
  }
  const tris = (corners / 3) | 0;
  let kept = 0;
  for (let t = 0; t < tris; t++) {
    const a = idx[t * 3], b = idx[t * 3 + 1], d = idx[t * 3 + 2];
    if (a === b || b === d || a === d) { if (keep) keep[t] = 0; continue; }
    if (keep) keep[t] = 1;
    idx[kept * 3] = a; idx[kept * 3 + 1] = b; idx[kept * 3 + 2] = d;
    kept++;
  }
  return { mesh: { vertices: verts.slice(0, nv * 3), indices: idx.slice(0, kept * 3) }, dropped: tris - kept };
}

const isDigit = (c: number): boolean => c >= 48 && c <= 57;

/** Facet corners out of ASCII STL text: scans for `vertex` and reads three numbers after each, no regex and no strings per vertex. */
function asciiPositions(text: string): { pos: Float32Array; name: string } {
  const name = /^\s*solid[ \t]*([^\r\n]*)/.exec(text)?.[1]?.trim() ?? '';
  let cap = 3000;
  let out = new Float64Array(cap);
  let n = 0;
  const len = text.length;
  let at = text.indexOf('vertex');
  while (at >= 0) {
    let p = at + 6;
    for (let k = 0; k < 3; k++) {
      while (p < len && text.charCodeAt(p) <= 32) p++;
      const start = p;
      let c = text.charCodeAt(p);
      let sign = 1;
      if (c === 45) { sign = -1; p++; } else if (c === 43) p++;
      let v = 0, any = false;
      while (p < len && isDigit(c = text.charCodeAt(p))) { v = v * 10 + (c - 48); p++; any = true; }
      if (text.charCodeAt(p) === 46) {
        p++;
        let f = 0.1;
        while (p < len && isDigit(c = text.charCodeAt(p))) { v += (c - 48) * f; f /= 10; p++; any = true; }
      }
      if (any && (text.charCodeAt(p) | 32) === 101) {
        let q = p + 1, es = 1;
        if (text.charCodeAt(q) === 45) { es = -1; q++; } else if (text.charCodeAt(q) === 43) q++;
        let e = 0, eany = false;
        while (q < len && isDigit(c = text.charCodeAt(q))) { e = e * 10 + (c - 48); q++; eany = true; }
        if (eany) { v *= Math.pow(10, es * e); p = q; }
      }
      if (!any) {
        // nan / inf / garbage: let parseFloat decide, then fail on non-finite
        let q = start;
        while (q < len && text.charCodeAt(q) > 32) q++;
        v = parseFloat(text.slice(start, q));
        p = q;
        if (!Number.isFinite(v)) throw new StlError('badNumber', `bad number near character ${start}`);
        sign = 1;
      }
      if (n >= cap) { cap *= 2; const g = new Float64Array(cap); g.set(out); out = g; }
      out[n++] = sign * v;
    }
    at = text.indexOf('vertex', p);
  }
  const m = n - (n % 9);
  return { pos: Float32Array.from(out.subarray(0, m)), name };
}

/** Read an STL file's bytes. Binary is recognised by its exact size (84 + 50 per triangle; ASCII files can also start with "solid"). */
export function readStl(input: Uint8Array | ArrayBuffer, opts: StlReadOptions = {}): StlRead {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length === 0) throw new StlError('empty', 'the file is empty');
  const warnings: StlWarning[] = [];
  let format: 'binary' | 'ascii';
  let pos: Float32Array;
  let name = '';
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declared = bytes.length >= 84 ? dv.getUint32(80, true) : 0;
  const exact = bytes.length >= 84 && 84 + declared * 50 === bytes.length;
  const head = bytes.length >= 5 ? String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4]).toLowerCase() : '';
  // text if it starts with "solid" and is not an exact binary size; a "solid" header on a longer or shorter binary file still has to show facets
  let ascii = head === 'solid' && !exact;
  if (ascii && bytes.length >= 84) {
    // the first 1 KB tells a text file from a binary one that has "solid" in its header
    const probe = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 1024)));
    if (!/facet|vertex|endsolid/i.test(probe) && declared > 0) ascii = false;
  }
  if (ascii) {
    format = 'ascii';
    const r = asciiPositions(new TextDecoder().decode(bytes));
    pos = r.pos; name = r.name;
    if (!pos.length) throw new StlError('noFacets', 'no facets found in the file');
  } else {
    format = 'binary';
    if (bytes.length < 84) throw new StlError('tooShort', 'the file is too short to be an STL');
    const room = Math.floor((bytes.length - 84) / 50);
    let n = declared;
    if (n > room) { n = room; warnings.push('truncated'); }
    else if (84 + n * 50 < bytes.length) warnings.push('trailingBytes');
    if (n === 0) throw new StlError('noFacets', 'no facets found in the file');
    pos = new Float32Array(n * 9);
    for (let t = 0; t < n; t++) {
      const o = 84 + t * 50 + 12;
      for (let k = 0; k < 9; k++) pos[t * 9 + k] = dv.getFloat32(o + k * 4, true);
    }
    for (let i = 0; i < pos.length; i++) if (!Number.isFinite(pos[i])) throw new StlError('badNumber', 'a coordinate is not a finite number');
    name = new TextDecoder().decode(bytes.subarray(0, 80)).replace(/\0+$/, '').trim();
    if (/^binary STL /.test(name)) name = name.slice(11);
    else if (/^solid\s/i.test(name)) name = name.replace(/^solid\s*/i, '');
  }
  const k = UNIT_MM[opts.unit ?? 'mm'];
  if (k !== 1) for (let i = 0; i < pos.length; i++) pos[i] *= k;
  const fileTriangles = pos.length / 9;
  const { mesh, dropped } = indexMesh(pos);
  if (dropped) warnings.push('degenerate');
  if (!mesh.indices.length) throw new StlError('allDegenerate', 'every triangle is degenerate');
  const lo: [number, number, number] = [Infinity, Infinity, Infinity], hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const v = mesh.vertices;
  for (let i = 0; i < v.length; i += 3) for (let c = 0; c < 3; c++) { if (v[i + c] < lo[c]) lo[c] = v[i + c]; if (v[i + c] > hi[c]) hi[c] = v[i + c]; }
  const check = checkIndexed(mesh.indices, v.length / 3);
  return { name, format, mesh, triangles: mesh.indices.length / 3, fileTriangles, degenerate: dropped, bbox: { min: lo, max: hi }, check: { ...check, degenerate: dropped }, warnings };
}
