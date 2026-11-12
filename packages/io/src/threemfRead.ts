// 3MF import: the package is a zip (zipRead), the model is 3D/3dmodel.model (found through _rels/.rels when it names another path).
// Read: object meshes, components with transforms, build items with transforms, the model unit (converted to millimetres), colours
// from basematerials and the colour group of the materials extension, models split over several files (the production extension's
// path attribute). Print supports are left out. Not read, and reported: textures, per-vertex colour gradients, the slicer's own data.
import { MatTable, MeshReadError, TriSink, finishRead, parseColorAttr, type MeshFileRead, type MeshNote } from './meshRead';
import { type StlUnit } from './stlRead';
import { zipRead } from './zip';

/** Millimetres per 3MF unit. */
const UNIT_MM3: Record<string, number> = { micron: 0.001, millimeter: 1, centimeter: 10, meter: 1000, inch: 25.4, foot: 304.8 };
const UNIT_APP: Record<string, StlUnit> = { millimeter: 'mm', centimeter: 'cm', meter: 'm', inch: 'in' };

interface ObjDef {
  id: string;
  type: string;
  name: string;
  pid?: string; pindex?: number;
  verts: number[];
  tris: number[];             // v1 v2 v3 per triangle
  triCol: Array<[string | undefined, number, number, number]>;   // pid, p1, p2, p3 per triangle (only when it has a pid)
  comps: Array<{ id: string; path?: string; m: number[] | null }>;
}
interface Model {
  unit: string;
  objects: Map<string, ObjDef>;
  base: Map<string, Array<{ rgb: [number, number, number]; a: number } | null>>;   // basematerials and colorgroup by id
  textured: Set<string>;                                                              // texture2dgroup ids
  build: Array<{ id: string; m: number[] | null }>;
}

const local = (n: string): string => n.slice(n.indexOf(':') + 1);
const unxml = (s: string): string => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, '&');
function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[local(m[1])] = unxml(m[2] ?? m[3]);
  return out;
}
/** A 3MF transform ("m00 m01 m02 m10 ... m32": row vectors, the last three numbers the translation) as 12 numbers; null when absent or not twelve numbers. */
function parseTransform(s: string | undefined): number[] | null {
  if (!s) return null;
  const v = s.trim().split(/\s+/).map(Number);
  return v.length === 12 && v.every(Number.isFinite) ? v : null;
}
const mulT = (a: number[] | null, b: number[] | null): number[] | null => {
  if (!a) return b;
  if (!b) return a;
  // row vectors: x' = x * A * B, with each as a 3x3 block and a translation row
  const o = new Array<number>(12).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  for (let c = 0; c < 3; c++) o[9 + c] = a[9] * b[c] + a[10] * b[3 + c] + a[11] * b[6 + c] + b[9 + c];
  return o;
};
const detT = (m: number[]): number => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);

function parseModel(xml: string): Model {
  const text = xml.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  const model: Model = { unit: 'millimeter', objects: new Map(), base: new Map(), textured: new Set(), build: [] };
  let cur: ObjDef | null = null;
  let group: Array<{ rgb: [number, number, number]; a: number } | null> | null = null;
  let seenModel = false;
  const re = /<(\/?)([\w:.-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const close = m[1] === '/', name = local(m[2]);
    if (close) {
      if (name === 'object') cur = null;
      else if (name === 'basematerials' || name === 'colorgroup') group = null;
      continue;
    }
    const a = m[3].includes('=') ? attrs(m[3]) : {};
    switch (name) {
      case 'model': seenModel = true; model.unit = a.unit ?? 'millimeter'; break;
      case 'object':
        cur = { id: a.id ?? '', type: a.type ?? 'model', name: a.name ?? '', pid: a.pid, pindex: a.pindex !== undefined ? +a.pindex : undefined, verts: [], tris: [], triCol: [], comps: [] };
        if (a.id !== undefined) model.objects.set(a.id, cur);
        if (m[4]) cur = null;
        break;
      case 'vertex': if (cur) cur.verts.push(+a.x, +a.y, +a.z); break;
      case 'triangle':
        if (cur) {
          cur.tris.push(+a.v1, +a.v2, +a.v3);
          if (a.pid !== undefined || a.p1 !== undefined) {
            const p1 = a.p1 !== undefined ? +a.p1 : cur.pindex ?? 0;
            cur.triCol[cur.tris.length / 3 - 1] = [a.pid ?? cur.pid, p1, a.p2 !== undefined ? +a.p2 : p1, a.p3 !== undefined ? +a.p3 : p1];
          }
        }
        break;
      case 'component': if (cur) cur.comps.push({ id: a.objectid ?? '', path: a.path, m: parseTransform(a.transform) }); break;
      case 'basematerials': case 'colorgroup': group = []; if (a.id !== undefined) model.base.set(a.id, group); if (m[4]) group = null; break;
      case 'base': if (group) { const c = parseColorAttr(a.displaycolor); group.push(c ? { rgb: c.rgb, a: c.a } : null); } break;
      case 'color': if (group) { const c = parseColorAttr(a.color); group.push(c ? { rgb: c.rgb, a: c.a } : null); } break;
      case 'texture2dgroup': if (a.id !== undefined) model.textured.add(a.id); break;
      case 'item': model.build.push({ id: a.objectid ?? '', m: parseTransform(a.transform) }); break;
      default: break;
    }
  }
  if (!seenModel) throw new MeshReadError('badXml', 'the model file is not 3MF XML');
  return model;
}

/** Read a 3MF file's bytes. */
export async function readThreeMf(input: Uint8Array | ArrayBuffer, opts: { name?: string } = {}): Promise<MeshFileRead> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length === 0) throw new MeshReadError('empty', 'the file is empty');
  let files;
  try { files = await zipRead(bytes); } catch (e) { throw new MeshReadError('notZip', `not a 3MF package: ${(e as Error).message}`); }
  const byName = new Map(files.map((f) => [f.name.replace(/^\//, ''), f]));
  const text = (n: string): string | null => { const f = byName.get(n.replace(/^\//, '')); return f ? new TextDecoder().decode(f.data) : null; };
  // the root model: the relationship of the 3D model type, else the usual path
  let rootPath = '3D/3dmodel.model';
  const rels = text('_rels/.rels');
  if (rels) {
    for (const m of rels.matchAll(/<Relationship\b([^>]*)>/g)) {
      const a = attrs(m[1]);
      if (/3dmodel$/i.test(a.Type ?? '') && a.Target) { rootPath = a.Target.replace(/^\//, ''); break; }
    }
  }
  const rootXml = text(rootPath);
  if (rootXml === null) throw new MeshReadError('no3mfModel', `no ${rootPath} in the package`);
  const models = new Map<string, Model>();
  const modelOf = (path: string): Model | null => {
    const key = path.replace(/^\//, '');
    let md = models.get(key);
    if (md) return md;
    const x = key === rootPath ? rootXml : text(key);
    if (x === null) return null;
    md = parseModel(x);
    models.set(key, md);
    return md;
  };
  const root = modelOf(rootPath)!;
  const unit = root.unit in UNIT_MM3 ? root.unit : 'millimeter';
  const k = UNIT_MM3[unit];

  const sink = new TriSink();
  const table = new MatTable();
  const notes: MeshNote[] = [];
  let supports = 0, external = 0, textures = 0, gradients = 0, items = 0, objectsWithMesh = 0;
  const colourOf = (md: Model, pid: string | undefined, idx: number): number => {
    if (pid === undefined) return -1;
    if (md.textured.has(pid)) { textures++; return -1; }
    const c = md.base.get(pid)?.[idx];
    return c ? table.add(c.rgb, c.a) : -1;
  };
  const emit = (md: Model, path: string, id: string, parent: number[] | null, depth: number): void => {
    const o = md.objects.get(id);
    if (!o || depth > 32) return;
    if (o.type === 'support' || o.type === 'solidsupport') { supports++; return; }
    if (o.tris.length) {
      objectsWithMesh++;
      const flip = parent ? detT(parent) < 0 : false;
      const w = new Float64Array(o.verts.length);
      for (let i = 0; i < o.verts.length; i += 3) {
        const x = o.verts[i], y = o.verts[i + 1], z = o.verts[i + 2];
        if (parent) {
          w[i] = x * parent[0] + y * parent[3] + z * parent[6] + parent[9];
          w[i + 1] = x * parent[1] + y * parent[4] + z * parent[7] + parent[10];
          w[i + 2] = x * parent[2] + y * parent[5] + z * parent[8] + parent[11];
        } else { w[i] = x; w[i + 1] = y; w[i + 2] = z; }
        w[i] *= k; w[i + 1] *= k; w[i + 2] *= k;
      }
      const objCol = colourOf(md, o.pid, o.pindex ?? 0);
      const nv = o.verts.length / 3;
      for (let t = 0; t < o.tris.length / 3; t++) {
        const a = o.tris[t * 3], b = o.tris[t * 3 + 1], c = o.tris[t * 3 + 2];
        if (!(a >= 0 && b >= 0 && c >= 0 && a < nv && b < nv && c < nv)) throw new MeshReadError('noMesh', 'a triangle points past the vertices');
        const tc = o.triCol[t];
        let mat = objCol;
        if (tc) {
          mat = colourOf(md, tc[0], tc[1]);
          if (tc[1] !== tc[2] || tc[1] !== tc[3]) gradients++;
        }
        if (flip) sink.add(w, a * 3, w, c * 3, w, b * 3, mat); else sink.add(w, a * 3, w, b * 3, w, c * 3, mat);
      }
    }
    for (const c of o.comps) {
      let cm = md, cp = path;
      if (c.path) {
        const other = modelOf(c.path);
        if (!other) { external++; continue; }
        cm = other; cp = c.path;
      }
      emit(cm, cp, c.id, mulT(c.m, parent), depth + 1);
    }
  };
  if (root.build.length) for (const it of root.build) { items++; emit(root, rootPath, it.id, it.m, 0); }
  else {
    // no build section: every object no component refers to
    const refd = new Set<string>();
    for (const o of root.objects.values()) for (const c of o.comps) refd.add(c.id);
    for (const o of root.objects.values()) if (!refd.has(o.id)) { items++; emit(root, rootPath, o.id, null, 0); }
  }
  if (!sink.n) throw new MeshReadError('noMesh', 'no triangle mesh in the 3MF');
  if (textures) notes.push({ code: 'textures' });
  if (gradients) notes.push({ code: 'colourGradients' });
  if (supports) notes.push({ code: 'supportObjects', n: supports });
  if (external) notes.push({ code: 'externalParts', n: external });
  if (unit !== 'millimeter') notes.push({ code: 'unitConverted', text: unit });
  const parts = Math.max(1, items);
  if (items > 1) notes.push({ code: 'partsMerged', n: items });
  const title = /<metadata\b[^>]*\bname="Title"[^>]*>([^<]*)</.exec(rootXml)?.[1];
  const firstObj = [...root.objects.values()].find((o) => o.tris.length && o.name);
  return finishRead(sink, table.list, { format: '3mf', name: (title && unxml(title).trim()) || firstObj?.name || opts.name || '', unit: UNIT_APP[unit] ?? 'mm', unitFromFile: true, parts, notes });
}
