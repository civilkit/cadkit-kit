// Selectors resolved against the CURRENT body (faces from the mesh, edges from the view edges). Pure functions, no kernel.
export type Vec = [number, number, number];
export interface Mesh { positions: ArrayLike<number>; normals: ArrayLike<number>; triFace: ArrayLike<number>; faceIds: string[] }
export interface EdgeInfo { key?: string; faces?: string[]; mid?: number[]; pts?: number[][] }
export interface Geometry { mesh: Mesh | null; edges: EdgeInfo[]; box: { min: number[]; max: number[] } | null; /** with several bodies: face id -> index of the body (lump) it belongs to, in the order of the kernel's body list */ faceLumps?: Record<string, number> }
export type SurfaceKind = 'plane' | 'cylinder' | 'sphere' | 'cone' | 'torus' | 'other';
export interface FaceInfo {
  id: string; normal: Vec; centroid: Vec; area: number; planar: boolean;
  /** surface type fitted from the display mesh: plane, cylinder, sphere, other (cone, torus, free-form) */
  kind: SurfaceKind;
  /** cylinder / sphere radius in mm */
  radius?: number;
  /** cylinder axis direction */
  axis?: Vec;
  /** a point on the cylinder axis / the sphere centre */
  center?: Vec;
  /** the feature that created the face (from its persistent name) */
  owner: string;
}

/** A feature given by id ('F4'), or a handle from part.handle() (its id is filled in when the script runs). */
export type FeatureRefLike = string | { id: string | null };
/** A rule over the live faces: keys AND together. */
export interface FaceRule {
  /** the faces furthest along a direction: '>X' '<X' '>Y' '<Y' '>Z' '<Z' ('#top' '#bottom') among the other filters */
  dir?: string;
  /** planar faces whose outward normal is this direction */
  normal?: Vec;
  /** true: planar faces only; false: curved faces only */
  planar?: boolean;
  /** the face passes through this point (planar: the point lies on its plane; curved: centroid within `within`, default 1 mm) */
  at?: Vec;
  /** surface kind: 'plane' | 'cylinder' | 'sphere' | 'other' */
  kind?: SurfaceKind | 'planar';
  /** cylinder or sphere radius in mm */
  radius?: number;
  /** only faces created by this feature (also spelled `of`) */
  createdBy?: FeatureRefLike;
  of?: FeatureRefLike;
  areaGreater?: number; areaLess?: number;
  /** centroid within `within` of the point; without `within` only the nearest face is kept */
  near?: Vec; within?: number;
  not?: FaceSel | FacesSel;
  union?: Array<FaceSel | FacesSel>; intersect?: Array<FaceSel | FacesSel>;
  /** first minus all the others */
  difference?: Array<FaceSel | FacesSel>;
  /** order the matches by their centroid along a direction (see PosKey); .nth / .first / .last then count in that order */
  sortBy?: PosKey;
  /** keep one group of faces at the same position (see GroupSpec) */
  group?: GroupSpec;
}
export type FacePick = 'largest' | 'smallest' | 'first' | 'last' | { nth: number } | { near: Vec };
/** One face: a direction ('>Z'), a persistent name ('F3.C1') or a FaceRule; `of` restricts to the faces of one feature; `pick` chooses among several matches. */
export type FaceSel = { kind: 'face'; sel: string | FaceRule; line: number; of?: FeatureRefLike; pick?: FacePick };
/** Several faces: same specs as face(), returns every match. Chain nth / largest / smallest / first / last / near to get one FaceSel. */
export interface FacesSel {
  kind: 'faces'; sel: string | FaceRule; line: number; of?: FeatureRefLike;
  nth(i: number): FaceSel; largest(): FaceSel; smallest(): FaceSel; first(): FaceSel; last(): FaceSel; near(p: Vec): FaceSel;
  /** the same faces ordered by their centroid along key (see PosKey); .nth / .first / .last then count in that order */
  sortBy(key: PosKey): FacesSel;
  /** the faces at the same position along key, in the order of the key: choose a group with .nth(i) / .first() / .last() / .at(position) */
  groupBy(key: PosKey, o?: { tol?: number }): FaceGroups;
}
/** The groups of faces at the same position; each choice is a faces() of that group. */
export interface FaceGroups { nth(i: number): FacesSel; first(): FacesSel; last(): FacesSel; at(position: number): FacesSel }
/** The result of edges(): an EdgeSel with chained choices by position. */
export interface EdgesSel extends EdgeSel {
  /** the same edges ordered by their midpoint along key (see PosKey) */
  sortBy(key: PosKey): EdgesSel;
  /** the edges at the same position along key, in the order of the key: choose a group with .nth(i) / .first() / .last() / .at(position) */
  groupBy(key: PosKey, o?: { tol?: number }): EdgeGroups;
  /** the i-th edge of the order (0 is the first, -1 the last); needs sortBy or groupBy before it */
  nth(i: number): EdgesSel;
  /** the first n edges of the order (default 1) */
  first(n?: number): EdgesSel;
  /** the last n edges of the order (default 1) */
  last(n?: number): EdgesSel;
}
/** The groups of edges at the same position; each choice is an edges() of that group. */
export interface EdgeGroups { nth(i: number): EdgesSel; first(): EdgesSel; last(): EdgesSel; at(position: number): EdgesSel }
/** A rule over the live edges: keys AND together. */
export interface EdgeRule {
  parallel?: 'X' | 'Y' | 'Z';
  /** edge midpoint outside / inside the box [[x0,y0,z0],[x1,y1,z1]] */
  outside?: [Vec, Vec]; inside?: [Vec, Vec];
  not?: EdgeSel;
  onFace?: FaceSel | FacesSel;
  /** edges that bound at least one face created by this feature */
  createdBy?: FeatureRefLike;
  lengthGreater?: number; lengthLess?: number;
  near?: Vec; within?: number;
  union?: EdgeSel[]; intersect?: EdgeSel[];
  /** first minus all the others */
  difference?: EdgeSel[];
  /** order the matches by their midpoint along a direction (see PosKey); `pick` then counts in that order */
  sortBy?: PosKey;
  /** keep one group of edges at the same position (see GroupSpec) */
  group?: GroupSpec;
  /** keep the n-th edge ({nth: i}, negative counts from the end), the first n ({first: n}) or the last n ({last: n}) of the order (needs sortBy or group) */
  pick?: EdgePick;
}
export type EdgeSel = { kind: 'edges'; sel: string | EdgeRule; line: number };
/** What an order or a group is measured along: '>Z' (highest first), '<Z' or 'Z' (lowest first), likewise X and Y; a direction [x, y, z] (smallest first); or { along: edges(...) } (the distance along a rail edge from its start; the selection must be one edge). */
export type PosKey = string | Vec | { along: EdgeSel };
/** Items at the same position along a key (within tol mm, default 0.001), in the order of the key. Choose one group by index (nth, negative counts from the end) or by its position (at: the coordinate along the key, in mm, e.g. the height). */
export interface GroupSpec { by: PosKey; tol?: number; nth?: number; at?: number }
export type EdgePick = { nth: number } | { first: number } | { last: number };

const AXES: Record<string, Vec> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
const TOL = 1e-3;

export class SelectorError extends Error {
  constructor(message: string, public line = 0) { super(message); }
}

/** Per-face area, area-weighted centroid and normal, and whether every triangle shares the normal. */
export function faceInfos(mesh: Mesh): FaceInfo[] {
  const acc = new Map<string, { a: number; c: Vec; n: Vec; first: Vec | null; planar: boolean; samples: Array<[Vec, Vec]> }>();
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
    if (!e) { e = { a: 0, c: [0, 0, 0], n: [0, 0, 0], first: n, planar: true, samples: [] }; acc.set(id, e); }
    if (e.first && n[0] * e.first[0] + n[1] * e.first[1] + n[2] * e.first[2] < 1 - 1e-4) e.planar = false;
    e.a += area;
    for (let k = 0; k < 3; k++) { e.c[k] += area * (a[k] + b[k] + c[k]) / 3; e.n[k] += area * n[k]; }
    if (e.samples.length < 240) for (let i = 0; i < 3; i++) e.samples.push([[P[t * 9 + i * 3], P[t * 9 + i * 3 + 1], P[t * 9 + i * 3 + 2]], [N[t * 9 + i * 3] ?? 0, N[t * 9 + i * 3 + 1] ?? 0, N[t * 9 + i * 3 + 2] ?? 0]]);
  }
  return [...acc].map(([id, e]) => {
    const nl = Math.hypot(...e.n) || 1;
    const fit = e.planar ? { kind: 'plane' as SurfaceKind } : fitCurved(e.samples);
    return { id, normal: [e.n[0] / nl, e.n[1] / nl, e.n[2] / nl] as Vec, centroid: [e.c[0] / e.a, e.c[1] / e.a, e.c[2] / e.a] as Vec, area: e.a, planar: e.planar, ...fit, owner: ownerOf(id) };
  });
}

/** The feature that created a face, from its persistent name: 'F4.C0' -> F4; a pattern copy 'F8.C0@F10.1' -> F10. */
export function ownerOf(name: string): string {
  const at = name.indexOf('@');
  return at >= 0 ? name.slice(at + 1).split('.')[0] : name.split('.')[0];
}

const sub3 = (a: ArrayLike<number>, b: ArrayLike<number>): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a: ArrayLike<number>, b: ArrayLike<number>): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** Solve the n x n system M x = y by Gaussian elimination (null when singular). */
function solve(M: number[][], y: number[]): number[] | null {
  const n = y.length;
  const A = M.map((r, i) => [...r, y[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k]; }
  }
  return A.map((r, i) => r[n] / r[i]);
}
/** Classify a curved face from (point, outward normal) samples of its mesh: cylinder (axis, radius), sphere (centre, radius) or other. */
function fitCurved(sm: Array<[Vec, Vec]>): { kind: SurfaceKind; radius?: number; axis?: Vec; center?: Vec } {
  if (sm.length < 6) return { kind: 'other' };
  const nm = sm.map(([, n]) => { const l = Math.hypot(n[0], n[1], n[2]) || 1; return [n[0] / l, n[1] / l, n[2] / l] as Vec; });
  // cylinder: every normal is perpendicular to one axis
  let best: Vec | null = null, bl = 0;
  for (let i = 0; i < nm.length; i += 3) for (let j = i + 3; j < nm.length; j += 3) { const c = cross3(nm[i], nm[j]); const l = Math.hypot(...c); if (l > bl) { bl = l; best = c; } }
  if (best && bl > 0.05) {
    const a: Vec = [best[0] / bl, best[1] / bl, best[2] / bl];
    if (nm.every((n) => Math.abs(n[0] * a[0] + n[1] * a[1] + n[2] * a[2]) < 0.02)) {
      const h: Vec = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      const u0 = cross3(a, h), ul = Math.hypot(...u0); const U: Vec = [u0[0] / ul, u0[1] / ul, u0[2] / ul]; const V = cross3(a, U);
      // Kasa circle fit in the plane normal to the axis
      const pts = sm.map(([p]) => [p[0] * U[0] + p[1] * U[1] + p[2] * U[2], p[0] * V[0] + p[1] * V[1] + p[2] * V[2]]);
      let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sz = 0, sxz = 0, syz = 0;
      for (const [x, y] of pts) { sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; const z = x * x + y * y; sz += z; sxz += x * z; syz += y * z; }
      const n = pts.length;
      const sol = solve([[2 * sxx, 2 * sxy, sx], [2 * sxy, 2 * syy, sy], [2 * sx, 2 * sy, n]], [sxz, syz, sz]);
      if (sol) {
        const r2 = sol[2] + sol[0] * sol[0] + sol[1] * sol[1];
        if (r2 > 0) return { kind: 'cylinder', radius: Math.sqrt(r2), axis: a, center: [sol[0] * U[0] + sol[1] * V[0], sol[0] * U[1] + sol[1] * V[1], sol[0] * U[2] + sol[1] * V[2]] };
      }
    }
  }
  // sphere: p . n = c . n + r for every sample
  const M = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], y = [0, 0, 0, 0];
  sm.forEach(([p], i) => { const row = [nm[i][0], nm[i][1], nm[i][2], 1]; const t = p[0] * nm[i][0] + p[1] * nm[i][1] + p[2] * nm[i][2]; for (let r = 0; r < 4; r++) { y[r] += row[r] * t; for (let c = 0; c < 4; c++) M[r][c] += row[r] * row[c]; } });
  const sp = solve(M, y);
  if (sp) {
    const c: Vec = [sp[0], sp[1], sp[2]], r = Math.abs(sp[3]);
    if (r > 1e-6 && sm.every(([p]) => Math.abs(Math.hypot(...sub3(p, c)) - r) < 0.02 * r + 1e-4)) return { kind: 'sphere', radius: r, center: c };
  }
  return { kind: 'other' };
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

export type WarnFn = (message: string, line: number) => void;
const refId = (r: FeatureRefLike | undefined, line: number, what: string): string | null => {
  if (r === undefined) return null;
  const id = typeof r === 'string' ? r : r.id;
  if (!id) throw new SelectorError(`${what}: the feature handle is not resolved yet (take it with part.handle() AFTER the feature it names)`, line);
  return id;
};
const AXIS_SEL = /^[<>][XYZxyz]$/;
const unit = (v: ArrayLike<number>): Vec => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const faceIdSet = (s: FaceSel | FacesSel, geo: Geometry, all: FaceInfo[], warn?: WarnFn): Set<string> => new Set(s.kind === 'faces' ? matchFaces(s.sel, s.of, geo, all, s.line, warn).map((f) => f.id) : [resolveFaceSel(s, geo, warn).id]);

/** Keep the faces furthest along the direction among the planar faces facing it (all of them when `ties`, else the last of the sorted order is first). */
function extremeFaces(faces: FaceInfo[], key: string): FaceInfo[] {
  const k = key === '#top' ? '>Z' : key === '#bottom' ? '<Z' : key;
  const p = parseAxisSel(k);
  if (!p || p.op === '|') throw new SelectorError(`face('${key}'): unsupported direction (use ${FACE_SELECTORS.map((x) => `'${x}'`).join(', ')})`, 0);
  const sign = p.op === '>' ? 1 : -1;
  const cands = faces.filter((f) => f.planar && dot(f.normal, p.axis) * sign > 1 - TOL);
  if (!cands.length) return [];
  const far = Math.max(...cands.map((f) => dot(f.centroid, p.axis) * sign));
  return cands.filter((f) => dot(f.centroid, p.axis) * sign > far - 1e-3).sort((a, b) => b.area - a.area);
}

/** Every face a spec matches (strings: a direction -> all faces facing it, a persistent name, 'F3.*' prefix; or a FaceRule). */
export function matchFaces(sel: string | FaceRule, of: FeatureRefLike | undefined, geo: Geometry, all: FaceInfo[], line: number, warn?: WarnFn): FaceInfo[] {
  const owner = refId(of, line, 'face({of})');
  let out = owner ? all.filter((f) => f.owner === owner) : all;
  if (typeof sel === 'string') {
    const key = sel.trim();
    if (AXIS_SEL.test(key) || key === '#top' || key === '#bottom') {
      const k = key === '#top' ? '>Z' : key === '#bottom' ? '<Z' : key;
      const p = parseAxisSel(k)!;
      const sign = p.op === '>' ? 1 : -1;
      return out.filter((f) => f.planar && dot(f.normal, p.axis) * sign > 1 - TOL);
    }
    if (key.endsWith('*')) return out.filter((f) => f.id.startsWith(key.slice(0, -1)));
    if (/^[A-Za-z]\w*[.@]/.test(key) || all.some((f) => f.id === key)) return out.filter((f) => f.id === key);
    throw new SelectorError(`face('${sel}'): unsupported selector (use a direction ${FACE_SELECTORS.map((x) => `'${x}'`).join(', ')}, a face name such as 'F3.C1', or a rule object)`, line);
  }
  const r = sel;
  const sub = (list: Array<FaceSel | FacesSel>) => list.map((x) => faceIdSet(x, geo, all, warn));
  const by = refId(r.createdBy, line, 'faces({createdBy})');
  if (by) out = out.filter((f) => f.owner === by);
  const o2 = refId(r.of, line, 'faces({of})');
  if (o2) out = out.filter((f) => f.owner === o2);
  if (r.normal) { const n = unit(r.normal); out = out.filter((f) => f.planar && dot(f.normal, n) > 1 - TOL); }
  if (r.planar !== undefined) out = out.filter((f) => f.planar === r.planar);
  if (r.kind) { const k = r.kind === 'planar' ? 'plane' : r.kind; out = out.filter((f) => f.kind === k); }
  if (r.radius !== undefined) out = out.filter((f) => f.radius !== undefined && Math.abs(f.radius - r.radius!) <= Math.max(1e-3, 2e-3 * r.radius!));
  if (r.at) { const at = r.at; out = out.filter((f) => (f.planar ? Math.abs(dot(f.normal, sub3(at, f.centroid))) < 1e-3 : Math.hypot(...sub3(at, f.centroid)) <= (r.within ?? 1))); }
  if (r.areaGreater !== undefined) out = out.filter((f) => f.area > r.areaGreater!);
  if (r.areaLess !== undefined) out = out.filter((f) => f.area < r.areaLess!);
  if (r.near) {
    const d = (f: FaceInfo) => Math.hypot(...sub3(f.centroid, r.near!));
    if (r.within !== undefined) out = out.filter((f) => d(f) <= r.within!);
    else if (out.length) { const m = Math.min(...out.map(d)); out = out.filter((f) => d(f) <= m + 1e-9); }
  }
  if (r.not) { const ex = faceIdSet(r.not, geo, all, warn); out = out.filter((f) => !ex.has(f.id)); }
  if (r.union) { const u = new Set(sub(r.union).flatMap((x) => [...x])); out = out.filter((f) => u.has(f.id)); }
  if (r.intersect) for (const x of sub(r.intersect)) out = out.filter((f) => x.has(f.id));
  if (r.difference?.length) { const [a, ...rest] = sub(r.difference); const ex = new Set(rest.flatMap((x) => [...x])); out = out.filter((f) => a.has(f.id) && !ex.has(f.id)); }
  if (r.dir) out = extremeFaces(out, r.dir);
  if (r.sortBy !== undefined || r.group) out = orderByPosition(out, (f) => f.centroid, r, geo, line, warn, 'faces(...)');
  return out;
}

const describeSel = (sel: string | FaceRule): string => (typeof sel === 'string' ? `'${sel}'` : '{rule}');
const brief = (f: FaceInfo): string => `${f.id} (${f.kind}${f.radius !== undefined ? ` r=${+f.radius.toFixed(3)}` : ''}, area ${+f.area.toFixed(1)}, feature ${f.owner})`;

/** Resolve a face() spec to ONE face. Direction strings keep their meaning (furthest planar face facing that way, ties: the biggest) and add a WARNING when other faces face the same way but belong to a different feature (the usual trap after a boss or a pocket). */
export function resolveFaceSel(fs: FaceSel, geo: Geometry, warn?: WarnFn): FaceInfo {
  const { sel, line } = fs;
  if (!geo.mesh) throw new SelectorError(`face(${describeSel(sel)}): there is no body yet to select a face from`, line);
  const all = faceInfos(geo.mesh);
  if (typeof sel === 'string' && !fs.pick) {
    const key = sel.trim();
    if (AXIS_SEL.test(key) || key === '#top' || key === '#bottom') {
      const owner = refId(fs.of, line, 'face({of})');
      const pool = owner ? all.filter((f) => f.owner === owner) : all;
      const k = key === '#top' ? '>Z' : key === '#bottom' ? '<Z' : key;
      const p = parseAxisSel(k)!;
      const sign = p.op === '>' ? 1 : -1;
      const cands = pool.filter((f) => f.planar && dot(f.normal, p.axis) * sign > 1 - TOL);
      if (!cands.length) throw new SelectorError(owner ? `face('${sel}', {of: ${owner}}): feature ${owner} has no planar face facing that direction` : `face('${sel}'): no planar face faces that direction`, line);
      cands.sort((a, b) => (dot(b.centroid, p.axis) - dot(a.centroid, p.axis)) * sign || b.area - a.area);
      const win = cands[0];
      if (!owner && warn && cands.some((c) => c.owner !== win.owner)) {
        const others = cands.slice(1).filter((c) => c.owner !== win.owner);
        warn(`face('${sel}') resolved to ${win.id} (feature ${win.owner}, the furthest ${key.startsWith('>') ? 'along' : 'against'} ${key[1]}); other faces point the same way: ${others.slice(0, 4).map((c) => `${c.id} (feature ${c.owner})`).join(', ')}${others.length > 4 ? ', ...' : ''}; use {of: ...} or a face name to choose`, line);
      }
      return win;
    }
  }
  let m = matchFaces(sel, fs.of, geo, all, line, warn);
  if (typeof sel === 'string' && !fs.pick && m.length === 0) {
    const near = all.filter((f) => f.id.split('.')[0] === sel.split('.')[0]).slice(0, 8).map((f) => f.id);
    throw new SelectorError(`face('${sel}'): no such face${near.length ? `; faces of that feature: ${near.join(', ')}` : ''}`, line);
  }
  if (!m.length) throw new SelectorError(`face(${describeSel(sel)}): no face of the current body matches${fs.of !== undefined ? ' (restricted by {of})' : ''}`, line);
  const pk = fs.pick;
  if (pk) {
    if (pk === 'largest') m = [...m].sort((a, b) => b.area - a.area);
    else if (pk === 'smallest') m = [...m].sort((a, b) => a.area - b.area);
    else if (pk === 'last') m = [m[m.length - 1]];
    else if (pk === 'first') m = [m[0]];
    else if ('nth' in pk) { if (pk.nth < 0 || pk.nth >= m.length) throw new SelectorError(`faces(${describeSel(sel)}).nth(${pk.nth}): only ${m.length} face(s) match`, line); m = [m[pk.nth]]; }
    else { const d = (f: FaceInfo) => Math.hypot(...sub3(f.centroid, pk.near)); m = [...m].sort((a, b) => d(a) - d(b)); }
    return m[0];
  }
  if (m.length > 1) {
    // a direction rule leaves the coplanar ties: the biggest wins, as for the plain direction strings
    if (typeof sel !== 'string' && sel.dir) return m[0];
    throw new SelectorError(`face(${describeSel(sel)}) matches ${m.length} faces (${m.slice(0, 5).map(brief).join('; ')}${m.length > 5 ? '; ...' : ''}); narrow the rule, or use faces(...).nth(i) / .largest() / .smallest() / .near([x,y,z])`, line);
  }
  return m[0];
}

/** Every face a faces() spec matches (an error with the line when none does). */
export function resolveFacesSel(fs: FaceSel | FacesSel, geo: Geometry, warn?: WarnFn): FaceInfo[] {
  if (fs.kind === 'face') return [resolveFaceSel(fs, geo, warn)];
  if (!geo.mesh) throw new SelectorError(`faces(${describeSel(fs.sel)}): there is no body yet to select faces from`, fs.line);
  const m = matchFaces(fs.sel, fs.of, geo, faceInfos(geo.mesh), fs.line, warn);
  if (!m.length) throw new SelectorError(`faces(${describeSel(fs.sel)}): no face of the current body matches`, fs.line);
  return m;
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


// ---- order and group by position -------------------------------------------------------------------------------------------------------------
interface Measure { raw: (p: ArrayLike<number>) => number; sign: 1 | -1; label: string }
const fmt = (v: number): string => String(+v.toFixed(3));
function measureOf(key: PosKey, geo: Geometry, line: number, warn: WarnFn | undefined, what: string): Measure {
  if (typeof key === 'string') {
    const m = /^([<>]?)([XYZxyz])$/.exec(key.trim());
    if (!m) throw new SelectorError(`${what}: '${key}' is not a position key (use '>Z' highest first, '<Z' or 'Z' lowest first, likewise X and Y, a direction [x, y, z], or { along: edges(...) })`, line);
    const ax = AXES[m[2].toUpperCase()];
    return { raw: (p) => dot(p, ax), sign: m[1] === '>' ? -1 : 1, label: `${m[1] === '>' ? 'descending ' : ''}${m[2].toUpperCase()}` };
  }
  if (Array.isArray(key)) {
    const l = Math.hypot(key[0], key[1], key[2]);
    if (!(l > 1e-12)) throw new SelectorError(`${what}: a zero vector is not a direction`, line);
    const d: Vec = [key[0] / l, key[1] / l, key[2] / l];
    return { raw: (p) => dot(p, d), sign: 1, label: `along [${key.map(fmt).join(', ')}]` };
  }
  const rail = resolveEdgeInfos(key.along.sel, geo, key.along.line || line, warn);
  if (rail.length !== 1) throw new SelectorError(`${what}: { along } needs one edge, the selection matches ${rail.length} (narrow it, e.g. with a rule or .nth(i) after .sortBy(...))`, line);
  const pts = rail[0].pts ?? [];
  if (pts.length < 2) throw new SelectorError(`${what}: the edge to measure along has no points`, line);
  const a = pts[0], b = pts[pts.length - 1], l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  if (l < 1e-9) throw new SelectorError(`${what}: the edge to measure along is closed (its ends meet); use a straight rail`, line);
  const d: Vec = [(b[0] - a[0]) / l, (b[1] - a[1]) / l, (b[2] - a[2]) / l];
  return { raw: (p) => dot(sub3(p, a), d), sign: 1, label: 'along the rail edge' };
}

/** Order, group and pick items by position. Ties are broken by x, y, z of the position, so the order does not depend on the order the kernel lists edges or faces in (it changes when the model is rebuilt). */
function orderByPosition<T>(items: T[], pos: (t: T) => ArrayLike<number>, spec: { sortBy?: PosKey; group?: GroupSpec; pick?: EdgePick }, geo: Geometry, line: number, warn: WarnFn | undefined, what: string): T[] {
  let out = items;
  const rank = (m: Measure, list: T[]) => list.map((t) => ({ t, v: m.raw(pos(t)) * m.sign, p: pos(t) }))
    .sort((a, b) => (Math.abs(a.v - b.v) > 1e-6 ? a.v - b.v : Math.abs(a.p[0] - b.p[0]) > 1e-6 ? a.p[0] - b.p[0] : Math.abs(a.p[1] - b.p[1]) > 1e-6 ? a.p[1] - b.p[1] : a.p[2] - b.p[2]));
  if (spec.sortBy !== undefined) out = rank(measureOf(spec.sortBy, geo, line, warn, `${what}.sortBy`), out).map((r) => r.t);
  const g = spec.group;
  if (g) {
    const m = measureOf(g.by, geo, line, warn, `${what}.groupBy`);
    const tol = g.tol ?? 1e-3;
    const groups: Array<{ at: number; items: T[] }> = [];
    let first = NaN;
    for (const r of rank(m, out)) {
      const raw = r.v * m.sign;
      if (groups.length && Math.abs(r.v - first) <= tol) groups[groups.length - 1].items.push(r.t);
      else { groups.push({ at: raw, items: [r.t] }); first = r.v; }
    }
    const where = `${groups.length} group(s) at ${m.label} = ${groups.map((x) => fmt(x.at)).join(', ')}`;
    let hit: typeof groups[number] | undefined;
    if (g.at !== undefined) {
      hit = groups.find((x) => Math.abs(x.at - g.at!) <= Math.max(tol, 1e-3));
      if (!hit) throw new SelectorError(`${what}.groupBy(...).at(${fmt(g.at)}): no group there; ${where}`, line);
    } else if (g.nth !== undefined) {
      const i = g.nth < 0 ? groups.length + g.nth : g.nth;
      if (!Number.isInteger(i) || i < 0 || i >= groups.length) throw new SelectorError(`${what}.groupBy(...).nth(${g.nth}): only ${where}`, line);
      hit = groups[i];
    } else throw new SelectorError(`${what}.groupBy(...): say which group (.nth(i), .first(), .last() or .at(position)); ${where}`, line);
    out = hit.items;
  }
  const pk = spec.pick;
  if (pk) {
    if (spec.sortBy === undefined && !g) throw new SelectorError(`${what}: picking by position needs .sortBy(...) first (the kernel's own order changes when the model is rebuilt)`, line);
    if ('nth' in pk) {
      const i = pk.nth < 0 ? out.length + pk.nth : pk.nth;
      if (!Number.isInteger(i) || i < 0 || i >= out.length) throw new SelectorError(`${what}.nth(${pk.nth}): only ${out.length} match(es)`, line);
      out = [out[i]];
    } else if ('first' in pk) out = out.slice(0, Math.max(0, pk.first));
    else out = out.slice(Math.max(0, out.length - Math.max(0, pk.last)));
  }
  return out;
}

/** The usable edges (two faces, a midpoint) that a selector or rule matches; may be empty. */
function matchEdges(sel: string | EdgeRule, geo: Geometry, usable: EdgeInfo[], line: number, warn?: WarnFn): EdgeInfo[] {
  if (typeof sel !== 'string') {
    const sub = (s: EdgeSel) => matchEdges(s.sel, geo, usable, line, warn);
    let out = usable;
    if (sel.parallel) { const ax = AXES[String(sel.parallel).toUpperCase()]; if (!ax) throw new SelectorError(`edges({parallel}): use 'X', 'Y' or 'Z'`, line); out = out.filter((e) => straightAlong(e, ax)); }
    if (sel.outside) out = out.filter((e) => !inBox(e.mid!, sel.outside!));
    if (sel.inside) out = out.filter((e) => inBox(e.mid!, sel.inside!));
    if (sel.not) { const ex = new Set(sub(sel.not)); out = out.filter((e) => !ex.has(e)); }
    if (sel.onFace) {
      const ids = sel.onFace.kind === 'faces' ? new Set(resolveFacesSel(sel.onFace, geo, warn).map((f) => f.id)) : new Set([resolveFaceSel(sel.onFace, geo, warn).id]);
      out = out.filter((e) => e.faces!.some((f) => ids.has(f)));
    }
    if (sel.createdBy !== undefined) { const by = refId(sel.createdBy, line, 'edges({createdBy})'); out = out.filter((e) => e.faces!.some((f) => ownerOf(f) === by)); }
    if (sel.lengthGreater !== undefined) out = out.filter((e) => edgeLength(e) > sel.lengthGreater!);
    if (sel.lengthLess !== undefined) out = out.filter((e) => edgeLength(e) < sel.lengthLess!);
    if (sel.near) { const r = sel.within ?? 1; out = out.filter((e) => Math.hypot(e.mid![0] - sel.near![0], e.mid![1] - sel.near![1], e.mid![2] - sel.near![2]) <= r); }
    if (sel.union) { const u = new Set(sel.union.flatMap(sub)); out = out.filter((e) => u.has(e)); }
    if (sel.intersect) for (const s of sel.intersect) { const u = new Set(sub(s)); out = out.filter((e) => u.has(e)); }
    if (sel.difference?.length) { const [a, ...rest] = sel.difference; const base = new Set(sub(a)); const ex = new Set(rest.flatMap(sub)); out = out.filter((e) => base.has(e) && !ex.has(e)); }
    if (sel.sortBy !== undefined || sel.group || sel.pick) out = orderByPosition(out, (e) => e.mid!, sel, geo, line, warn, 'edges(...)');
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
export function resolveEdgeInfos(sel: string | EdgeRule, geo: Geometry, line = 0, warn?: WarnFn): EdgeInfo[] {
  const label = typeof sel === 'string' ? `'${sel}'` : '{rule}';
  const usable = geo.edges.filter((e) => e.faces && e.faces.length === 2 && e.mid);
  if (!usable.length) throw new SelectorError(`edges(${label}): there is no body yet to select edges from`, line);
  const out = matchEdges(sel, geo, usable, line, warn);
  if (!out.length) throw new SelectorError(`edges(${label}): no edge of the current body matches`, line);
  return out;
}
export function resolveEdges(sel: string | EdgeRule, geo: Geometry, line = 0, warn?: WarnFn): Array<{ faces: string[]; at: number[] }> {
  return resolveEdgeInfos(sel, geo, line, warn).map((e) => ({ faces: [...e.faces!], at: [...e.mid!] }));
}
