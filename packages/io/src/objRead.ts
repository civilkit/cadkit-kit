// Wavefront OBJ import: vertices and faces (v, v/vt, v//vn, v/vt/vn, negative indices, polygons triangulated), objects and groups
// joined into one mesh, colours from the MTL (Kd, d / Tr) when its text is given, and from the `x y z r g b` vertex extension.
// Normals, texture coordinates, smoothing groups, lines and free-form curves are not kept and are reported.
import { MatTable, MeshReadError, TriSink, finishRead, triangulate, type MeshFileRead, type MeshNote } from './meshRead';
import { UNIT_MM, type StlUnit } from './stlRead';

export interface ObjReadOptions {
  /** The unit the file's numbers are in (OBJ has none); default mm. */
  unit?: StlUnit;
  /** The text of the .mtl file the OBJ names with `mtllib`, if it was opened next to it. Without it the colours are not read. */
  mtl?: string;
  /** A name for the mesh when the file gives none. */
  name?: string;
}

/** What an MTL file says about each material: its Kd colour (0..1) and opacity, and whether it has a texture. */
export function parseMtl(text: string): { mats: Map<string, { rgb: [number, number, number] | null; a: number }>; textures: number } {
  const mats = new Map<string, { rgb: [number, number, number] | null; a: number }>();
  let cur: { rgb: [number, number, number] | null; a: number } | null = null;
  let textures = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    const [key, ...rest] = line.split(/\s+/);
    const k = key.toLowerCase();
    if (k === 'newmtl') { cur = { rgb: null, a: 1 }; mats.set(rest.join(' '), cur); }
    else if (!cur) continue;
    else if (k === 'kd') {
      const v = rest.slice(0, 3).map(Number);
      if (v.length === 3 && v.every(Number.isFinite)) cur.rgb = [v[0] * 255, v[1] * 255, v[2] * 255];
    } else if (k === 'd') { const d = Number(rest[0]); if (Number.isFinite(d)) cur.a = d; }
    else if (k === 'tr') { const d = Number(rest[0]); if (Number.isFinite(d)) cur.a = 1 - d; }
    else if (k === 'map_kd') textures++;
  }
  return { mats, textures };
}

/** Read an OBJ file's bytes (UTF-8 text). */
export function readObj(input: Uint8Array | ArrayBuffer | string, opts: ObjReadOptions = {}): MeshFileRead {
  const text = typeof input === 'string' ? input : new TextDecoder().decode(input instanceof Uint8Array ? input : new Uint8Array(input));
  if (!text.trim()) throw new MeshReadError('empty', 'the file is empty');
  const unit = opts.unit ?? 'mm';
  const k = UNIT_MM[unit];
  const mtl = opts.mtl !== undefined ? parseMtl(opts.mtl) : null;
  const table = new MatTable();
  const matOfName = new Map<string, number>();
  const verts: number[] = [];          // xyz, file units
  let vcol: number[] | null = null;  // r g b per vertex (0..255) where the file has the extension, else -1
  let vt = 0, vn = 0, smoothing = 0, lines = 0, curves = 0, badFaces = 0, mtlLib = false, usedMtl = false;
  const names = new Set<string>();
  let firstName = '';
  let cur = -1;                      // colour index of the current usemtl
  const sink = new TriSink();
  const poly: number[] = [];
  const tris: number[] = [];
  let sawKeyword = false;

  // join continuation lines ("\" at the end) before splitting
  const src = text.includes('\\\n') || text.includes('\\\r') ? text.replace(/\\\r?\n/g, ' ') : text;
  let p = 0;
  const len = src.length;
  while (p < len) {
    let e = src.indexOf('\n', p);
    if (e < 0) e = len;
    let line = src.slice(p, e);
    p = e + 1;
    const h = line.indexOf('#');
    if (h >= 0) line = line.slice(0, h);
    line = line.trim();
    if (!line) continue;
    const sp = line.search(/\s/);
    const key = sp < 0 ? line : line.slice(0, sp);
    const arg = sp < 0 ? '' : line.slice(sp + 1).trim();
    switch (key) {
      case 'v': {
        sawKeyword = true;
        const t = arg.split(/\s+/);
        const x = Number(t[0]), y = Number(t[1]), z = Number(t[2]);
        if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) throw new MeshReadError('badNumber', `bad vertex "${line.slice(0, 40)}"`);
        const n = verts.length / 3;
        verts.push(x * k, y * k, z * k);
        if (t.length >= 6) {
          const r = Number(t[3]), g = Number(t[4]), b = Number(t[5]);
          if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
            if (!vcol) vcol = new Array(n * 3).fill(-1);
            vcol.push(r * 255, g * 255, b * 255);
            break;
          }
        }
        if (vcol) vcol.push(-1, -1, -1);
        break;
      }
      case 'vt': vt++; break;
      case 'vn': vn++; break;
      case 's': if (arg && arg !== 'off' && arg !== '0') smoothing++; break;
      case 'l': case 'p': lines++; break;
      case 'curv': case 'curv2': case 'surf': curves++; break;
      case 'o': case 'g': {
        const nm = arg;
        if (nm && !names.has(key + nm)) { names.add(key + nm); if (!firstName && key === 'o') firstName = nm; }
        break;
      }
      case 'mtllib': mtlLib = true; break;
      case 'usemtl': {
        usedMtl = true;
        if (!mtl) { cur = -1; break; }
        let ci = matOfName.get(arg);
        if (ci === undefined) {
          const m = mtl.mats.get(arg);
          ci = m?.rgb ? table.add(m.rgb, m.a) : -1;
          matOfName.set(arg, ci);
        }
        cur = ci;
        break;
      }
      case 'f': {
        sawKeyword = true;
        poly.length = 0;
        const nv = verts.length / 3;
        let bad = false;
        for (const tok of arg.split(/\s+/)) {
          const slash = tok.indexOf('/');
          const i = parseInt(slash < 0 ? tok : tok.slice(0, slash), 10);
          const ix = i > 0 ? i - 1 : i < 0 ? nv + i : -1;
          if (!Number.isFinite(i) || ix < 0 || ix >= nv) { bad = true; break; }
          poly.push(ix);
        }
        if (bad || poly.length < 3) { badFaces++; break; }
        // a colour from the vertices, when there is no material
        let ci = cur;
        if (ci < 0 && vcol) {
          const o = poly[0] * 3;
          if (vcol[o] >= 0) ci = table.add([vcol[o], vcol[o + 1], vcol[o + 2]]);
        }
        tris.length = 0;
        triangulate(verts, poly, tris);
        for (let i = 0; i < tris.length; i += 3) sink.add(verts, tris[i] * 3, verts, tris[i + 1] * 3, verts, tris[i + 2] * 3, ci);
        break;
      }
      default: break;
    }
  }
  if (!sawKeyword) throw new MeshReadError('notObj', 'no vertices or faces: this is not an OBJ file');
  if (!sink.n) throw new MeshReadError('noFaces', 'no faces in the file');
  const notes: MeshNote[] = [];
  if (vn) notes.push({ code: 'normals', n: vn });
  if (vt || (mtl && mtl.textures)) notes.push({ code: 'textures', n: vt });
  if (smoothing) notes.push({ code: 'smoothing', n: smoothing });
  if (lines) notes.push({ code: 'lines', n: lines });
  if (curves) notes.push({ code: 'curves', n: curves });
  if (badFaces) notes.push({ code: 'badFaces', n: badFaces });
  if ((mtlLib || usedMtl) && !mtl) notes.push({ code: 'mtlMissing' });
  const parts = Math.max(1, [...names].filter((n) => n[0] === 'o').length || names.size);
  if (parts > 1) notes.push({ code: 'partsMerged', n: parts });
  return finishRead(sink, table.list, { format: 'obj', name: firstName || opts.name || '', unit, unitFromFile: false, parts, notes });
}
