// Selectors resolved against the CURRENT body (faces from the mesh, edges from the view edges). Pure functions, no kernel.
export type Vec = [number, number, number];
export interface Mesh { positions: ArrayLike<number>; normals: ArrayLike<number>; triFace: ArrayLike<number>; faceIds: string[] }
export interface EdgeInfo { key?: string; faces?: string[]; mid?: number[]; pts?: number[][] }
export interface Geometry { mesh: Mesh | null; edges: EdgeInfo[]; box: { min: number[]; max: number[] } | null }
export interface FaceInfo { id: string; normal: Vec; centroid: Vec; area: number; planar: boolean }

export type FaceSel = { kind: 'face'; sel: string; line: number };
/** A rule over the live edges: keys AND together. */
export interface EdgeRule {
  parallel?: 'X' | 'Y' | 'Z';
  /** edge midpoint outside / inside the box [[x0,y0,z0],[x1,y1,z1]] */
  outside?: [Vec, Vec]; inside?: [Vec, Vec];
  not?: EdgeSel;
  onFace?: FaceSel;
  lengthGreater?: number; lengthLess?: number;
  near?: Vec; within?: number;
  union?: EdgeSel[]; intersect?: EdgeSel[];
  /** first minus all the others */
  difference?: EdgeSel[];
}
export type EdgeSel = { kind: 'edges'; sel: string | EdgeRule; line: number };

const AXES: Record<string, Vec> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
const TOL = 1e-3;

export class SelectorError extends Error {
  constructor(message: string, public line = 0) { super(message); }
}

/** Per-face area, area-weighted centroid and normal, and whether every triangle shares the normal. */
export function faceInfos(mesh: Mesh): FaceInfo[] {
  const acc = new Map<string, { a: number; c: Vec; n: Vec; first: Vec | null; planar: boolean }>();
  const P = mesh.positions, N = mesh.normals;
  const tris = Math.floor(P.length / 9);
  for (let t = 0; t < tris; t++) {
    const id = mesh.faceIds[mesh.triFace[t]];
    if (id === undefined) continue;
    const v = (i: number) => [P[t * 9 + i * 3], P[t * 9 + i * 3 + 1], P[t * 9 + i * 3 + 2]];
    const a = v(0), b = v(1), c = v(2);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const area = Math.hypot(cr[0], cr[1], cr[2]) / 2;
    if (area < 1e-12) continue;
    // the mesh normal (it points out of the solid), averaged over the three vertices
    const nn: Vec = [0, 0, 0];
    for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) nn[k] += (N[t * 9 + i * 3 + k] ?? 0) / 3;
    const nl = Math.hypot(nn[0], nn[1], nn[2]) || 1;
    const n: Vec = [nn[0] / nl, nn[1] / nl, nn[2] / nl];
    let e = acc.get(id);
    if (!e) { e = { a: 0, c: [0, 0, 0], n: [0, 0, 0], first: n, planar: true }; acc.set(id, e); }
    if (e.first && n[0] * e.first[0] + n[1] * e.first[1] + n[2] * e.first[2] < 1 - 1e-4) e.planar = false;
    e.a += area;
    for (let k = 0; k < 3; k++) { e.c[k] += area * (a[k] + b[k] + c[k]) / 3; e.n[k] += area * n[k]; }
  }
  return [...acc].map(([id, e]) => {
    const nl = Math.hypot(...e.n) || 1;
    return { id, normal: [e.n[0] / nl, e.n[1] / nl, e.n[2] / nl] as Vec, centroid: [e.c[0] / e.a, e.c[1] / e.a, e.c[2] / e.a] as Vec, area: e.a, planar: e.planar };
  });
}

const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Parse '>Z', '<X', '|Z' (axis selectors) into {op, axis}. */
function parseAxisSel(sel: string): { op: string; axis: Vec } | null {
  const m = /^([<>|])([XYZxyz])$/.exec(sel.trim());
  return m ? { op: m[1], axis: AXES[m[2].toUpperCase()] } : null;
}

export const FACE_SELECTORS = ['>X', '<X', '>Y', '<Y', '>Z', '<Z', '#top', '#bottom'];
export const EDGE_SELECTORS = ['all', '|X', '|Y', '|Z', '>X', '<X', '>Y', '<Y', '>Z', '<Z'];

/** One planar face: the one furthest along (>) or against (<) the axis, among the faces whose normal is that axis. '#top' is '>Z', '#bottom' '<Z'. */
export function resolveFace(sel: string, geo: Geometry, line = 0): FaceInfo {
  if (!geo.mesh) throw new SelectorError(`face('${sel}'): there is no body yet to select a face from`, line);
  const key = sel === '#top' ? '>Z' : sel === '#bottom' ? '<Z' : sel;
  const p = parseAxisSel(key);
  if (!p || p.op === '|') throw new SelectorError(`face('${sel}'): unsupported selector (use ${FACE_SELECTORS.map((s) => `'${s}'`).join(', ')})`, line);
  const sign = p.op === '>' ? 1 : -1;
  const faces = faceInfos(geo.mesh).filter((f) => f.planar && dot(f.normal, p.axis) * sign > 1 - TOL);
  if (!faces.length) throw new SelectorError(`face('${sel}'): no planar face faces that direction`, line);
  // furthest first; ties (several coplanar faces) go to the biggest
  faces.sort((a, b) => (dot(b.centroid, p.axis) - dot(a.centroid, p.axis)) * sign || b.area - a.area);
  return faces[0];
}

const straightAlong = (e: EdgeInfo, axis: Vec): boolean => {
  const pts = e.pts ?? [];
  if (pts.length < 2) return false;
  const a = pts[0], b = pts[pts.length - 1];
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l = Math.hypot(d[0], d[1], d[2]);
  if (l < 1e-9 || Math.abs(dot(d, axis)) / l < 1 - TOL) return false;
  // straight: every point stays on the chord
  return pts.every((q) => { const r = [q[0] - a[0], q[1] - a[1], q[2] - a[2]]; const t = dot(r, d) / (l * l); return Math.hypot(r[0] - t * d[0], r[1] - t * d[1], r[2] - t * d[2]) < 1e-3; });
};
const edgeLength = (e: EdgeInfo): number => { const p = e.pts ?? []; let s = 0; for (let i = 0; i + 1 < p.length; i++) s += Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1], p[i + 1][2] - p[i][2]); return s; };
const inBox = (p: ArrayLike<number>, b: [Vec, Vec]) => [0, 1, 2].every((k) => p[k] >= Math.min(b[0][k], b[1][k]) - 1e-6 && p[k] <= Math.max(b[0][k], b[1][k]) + 1e-6);

/** The usable edges (two faces, a midpoint) that a selector or rule matches; may be empty. */
function matchEdges(sel: string | EdgeRule, geo: Geometry, usable: EdgeInfo[], line: number): EdgeInfo[] {
  if (typeof sel !== 'string') {
    const sub = (s: EdgeSel) => matchEdges(s.sel, geo, usable, line);
    let out = usable;
    if (sel.parallel) { const ax = AXES[String(sel.parallel).toUpperCase()]; if (!ax) throw new SelectorError(`edges({parallel}): use 'X', 'Y' or 'Z'`, line); out = out.filter((e) => straightAlong(e, ax)); }
    if (sel.outside) out = out.filter((e) => !inBox(e.mid!, sel.outside!));
    if (sel.inside) out = out.filter((e) => inBox(e.mid!, sel.inside!));
    if (sel.not) { const ex = new Set(sub(sel.not)); out = out.filter((e) => !ex.has(e)); }
    if (sel.onFace) { const id = resolveFace(sel.onFace.sel, geo, sel.onFace.line).id; out = out.filter((e) => e.faces!.includes(id)); }
    if (sel.lengthGreater !== undefined) out = out.filter((e) => edgeLength(e) > sel.lengthGreater!);
    if (sel.lengthLess !== undefined) out = out.filter((e) => edgeLength(e) < sel.lengthLess!);
    if (sel.near) { const r = sel.within ?? 1; out = out.filter((e) => Math.hypot(e.mid![0] - sel.near![0], e.mid![1] - sel.near![1], e.mid![2] - sel.near![2]) <= r); }
    if (sel.union) { const u = new Set(sel.union.flatMap(sub)); out = out.filter((e) => u.has(e)); }
    if (sel.intersect) for (const s of sel.intersect) { const u = new Set(sub(s)); out = out.filter((e) => u.has(e)); }
    if (sel.difference?.length) { const [a, ...rest] = sel.difference; const base = new Set(sub(a)); const ex = new Set(rest.flatMap(sub)); out = out.filter((e) => base.has(e) && !ex.has(e)); }
    return out;
  }
  if (sel.trim().toLowerCase() === 'all') return usable;
  const p = parseAxisSel(sel);
  if (!p) throw new SelectorError(`edges('${sel}'): unsupported selector (use ${EDGE_SELECTORS.map((s) => `'${s}'`).join(', ')}, or a rule object)`, line);
  if (p.op === '|') return usable.filter((e) => straightAlong(e, p.axis));
  const sign = p.op === '>' ? 1 : -1;
  const best = Math.max(...usable.map((e) => dot(e.mid!, p.axis) * sign));
  return usable.filter((e) => (e.pts ?? []).every((q) => Math.abs(dot(q, p.axis) * sign - best) < 1e-3));
}

/** Edge references ({faces, at}) for the selector or rule. '|Z' straight edges parallel to Z; '>Z' / '<Z' edges lying in the top / bottom plane; 'all'; or a rule object (see EdgeRule). */
export function resolveEdges(sel: string | EdgeRule, geo: Geometry, line = 0): Array<{ faces: string[]; at: number[] }> {
  const label = typeof sel === 'string' ? `'${sel}'` : '{rule}';
  const usable = geo.edges.filter((e) => e.faces && e.faces.length === 2 && e.mid);
  if (!usable.length) throw new SelectorError(`edges(${label}): there is no body yet to select edges from`, line);
  const out = matchEdges(sel, geo, usable, line);
  if (!out.length) throw new SelectorError(`edges(${label}): no edge of the current body matches`, line);
  return out.map((e) => ({ faces: [...e.faces!], at: [...e.mid!] }));
}
