// The selection model: topology and shape questions answered from the mesh and the edge list the viewer already has
// (no kernel call). Faces are the mesh's face ids, edges the kernel's edge records (`faces` = the two faces an edge
// separates, `pts` = its polyline), bodies are the connected sets of faces (faces joined by a shared edge).
import { add, angleDeg, cross, dist, dot, len, polylineLength, scale, sub, unit, type V3 } from '../inspect/geometry';

export interface SelMesh { positions: ArrayLike<number>; normals: ArrayLike<number>; triFace: ArrayLike<number>; faceIds: string[] }
export interface SelEdge { key?: string; faces?: string[]; pts?: number[][] }
export interface SelData { mesh: SelMesh | null; edges: SelEdge[]; /** the surface body (feature id) that owns a face or edge name; null for the solid */ surfaceOf?(name: string): string | null }

/** Selection name of one body: the smallest face name in it, so it survives rebuilds that keep the face names. */
export const BODY_PREFIX = '@body:';
export const bodyNameOf = (faces: string[]): string => BODY_PREFIX + [...faces].sort()[0];
export const isBodyName = (n: string): boolean => n.startsWith(BODY_PREFIX);
export const edgeNameOf = (e: SelEdge, i: number): string => e.key ?? `edge#${i}`;

export type FaceKind = { type: 'plane'; normal: V3 } | { type: 'cylinder'; radius: number; axis: V3 } | { type: 'other' };
export type EdgeKind = { type: 'line'; dir: V3 } | { type: 'circle' | 'arc'; radius: number; normal: V3 } | { type: 'curve' };

export interface Body { name: string; faces: string[]; edges: string[]; surface: boolean }

const TOL_PARALLEL_DEG = 0.5;
const rel = (a: number, b: number, tol = 1e-3): boolean => Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b)) + 1e-9;

/** A circle through three points: radius, centre, plane normal; null when they are collinear. */
function circum(a: V3, b: V3, c: V3): { r: number; c: V3; n: V3 } | null {
  const ab = sub(b, a), ac = sub(c, a);
  const n = cross(ab, ac), nn = dot(n, n);
  if (nn < 1e-18) return null;
  const centre = add(a, scale(add(scale(cross(n, ab), dot(ac, ac)), scale(cross(ac, n), dot(ab, ab))), 1 / (2 * nn)));
  return { r: dist(centre, a), c: centre, n: unit(n) };
}

export class SelModel {
  readonly faces: string[];
  private edgeInfo = new Map<string, { e: SelEdge; i: number }>();
  private facesOfEdge = new Map<string, string[]>();
  private edgesOfFace = new Map<string, string[]>();
  private adj = new Map<string, Set<string>>();
  private triIndex = new Map<number, number[]>();
  private areaCache: Map<string, number> | null = null;
  private bodyCache: Body[] | null = null;
  private faceKindCache = new Map<string, FaceKind>();
  private edgeKindCache = new Map<string, EdgeKind>();
  private vtxCache = new Map<string, string[]>();

  constructor(readonly data: SelData) {
    const m = data.mesh;
    this.faces = [...new Set(m?.faceIds ?? [])];
    if (m) for (let t = 0; t < m.triFace.length; t++) { const l = this.triIndex.get(m.triFace[t]); if (l) l.push(t); else this.triIndex.set(m.triFace[t], [t]); }
    data.edges.forEach((e, i) => {
      const name = edgeNameOf(e, i);
      this.edgeInfo.set(name, { e, i });
      const fs = [...new Set(e.faces ?? [])];
      this.facesOfEdge.set(name, fs);
      for (const f of fs) { const l = this.edgesOfFace.get(f); if (l) l.push(name); else this.edgesOfFace.set(f, [name]); }
      if (fs.length === 2) {
        (this.adj.get(fs[0]) ?? this.adj.set(fs[0], new Set()).get(fs[0])!).add(fs[1]);
        (this.adj.get(fs[1]) ?? this.adj.set(fs[1], new Set()).get(fs[1])!).add(fs[0]);
      }
    });
  }

  get edgeNames(): string[] { return [...this.edgeInfo.keys()]; }
  edge(name: string): SelEdge | undefined { return this.edgeInfo.get(name)?.e; }
  isEdge(name: string): boolean { return this.edgeInfo.has(name); }
  isFace(name: string): boolean { return this.triIndex.size > 0 && this.faceSet.has(name); }
  private faceSetCache: Set<string> | null = null;
  private get faceSet(): Set<string> { return this.faceSetCache ??= new Set(this.faces); }
  edgesOf(face: string): string[] { return this.edgesOfFace.get(face) ?? []; }

  // ---- bodies ----
  bodies(): Body[] {
    if (this.bodyCache) return this.bodyCache;
    const seen = new Set<string>();
    const out: Body[] = [];
    for (const f of this.faces) {
      if (seen.has(f)) continue;
      const comp = [f]; seen.add(f);
      for (let k = 0; k < comp.length; k++) for (const g of this.adj.get(comp[k]) ?? []) if (!seen.has(g)) { seen.add(g); comp.push(g); }
      const edges = [...new Set(comp.flatMap((x) => this.edgesOf(x)))];
      out.push({ name: bodyNameOf(comp), faces: comp, edges, surface: !!this.data.surfaceOf?.(f) });
    }
    return this.bodyCache = out.sort((a, b) => (a.name < b.name ? -1 : 1));
  }
  bodyByName(name: string): Body | undefined { return this.bodies().find((b) => b.name === name); }
  bodyOfFace(face: string): Body | undefined { return this.bodies().find((b) => b.faces.includes(face)); }
  /** Face names of a selection entry that names a body (one body, or the whole part for BODY). */
  facesOfBody(name: string): string[] { return this.bodyByName(name)?.faces ?? []; }

  // ---- measures ----
  private tri(t: number): [V3, V3, V3] {
    const P = this.data.mesh!.positions, o = t * 9;
    return [[P[o], P[o + 1], P[o + 2]], [P[o + 3], P[o + 4], P[o + 5]], [P[o + 6], P[o + 7], P[o + 8]]];
  }
  areas(): Map<string, number> {
    if (this.areaCache) return this.areaCache;
    const out = new Map<string, number>();
    const m = this.data.mesh;
    if (m) for (const [fi, tris] of this.triIndex) {
      let a = 0;
      for (const t of tris) { const [p, q, r] = this.tri(t); a += len(cross(sub(q, p), sub(r, p))) / 2; }
      out.set(m.faceIds[fi], (out.get(m.faceIds[fi]) ?? 0) + a);
    }
    return this.areaCache = out;
  }
  area(face: string): number { return this.areas().get(face) ?? 0; }
  edgeLength(name: string): number { return polylineLength(this.edge(name)?.pts ?? []); }

  private trisOf(face: string): number[] {
    const m = this.data.mesh;
    if (!m) return [];
    const out: number[] = [];
    m.faceIds.forEach((id, fi) => { if (id === face) out.push(...(this.triIndex.get(fi) ?? [])); });
    return out;
  }
  /** The outward normal of a face at the mesh vertex nearest to p (the mesh keeps one normal per vertex per face). */
  normalAt(face: string, p: V3): V3 | null {
    const m = this.data.mesh;
    if (!m) return null;
    let best = Infinity, n: V3 | null = null;
    for (const t of this.trisOf(face)) for (let k = 0; k < 3; k++) {
      const o = t * 9 + k * 3;
      const d = Math.hypot(m.positions[o] - p[0], m.positions[o + 1] - p[1], m.positions[o + 2] - p[2]);
      if (d < best) { best = d; n = [m.normals[o], m.normals[o + 1], m.normals[o + 2]]; }
    }
    return n && len(n) > 0 ? unit(n) : null;
  }

  faceKind(face: string): FaceKind {
    const hit = this.faceKindCache.get(face);
    if (hit) return hit;
    let k: FaceKind = { type: 'other' };
    let n: V3 = [0, 0, 0];
    const tris: Array<[V3, number]> = [];
    for (const t of this.trisOf(face)) {
      const [p, q, r] = this.tri(t);
      const nn = cross(sub(q, p), sub(r, p)), a = len(nn) / 2;
      if (a < 1e-12) continue;
      n = add(n, nn); tris.push([unit(nn), a]);
    }
    const total = tris.reduce((x, [, ar]) => x + ar, 0);
    if (tris.length && len(n) >= 1.8 * total) {   // the triangle normals roughly agree: a curved face sums to a short vector
      const normal = unit(n);
      if (tris.every(([u]) => angleDeg(u, normal) <= TOL_PARALLEL_DEG)) k = { type: 'plane', normal };
    }
    if (k.type === 'other') {
      // a cylinder: its boundary has circles of one radius about one axis
      const circles = this.edgesOf(face).map((e) => this.edgeKind(e)).filter((c): c is Extract<EdgeKind, { radius: number }> => c.type === 'circle' || c.type === 'arc');
      const c0 = circles[0];
      if (c0 && circles.every((c) => rel(c.radius, c0.radius, 2e-3) && Math.abs(Math.abs(dot(c.normal, c0.normal)) - 1) < 1e-4)) {
        // flat rings (a hole's rim in a plane) are planes and returned above; two radii would be a cone
        k = { type: 'cylinder', radius: c0.radius, axis: c0.normal };
      }
    }
    this.faceKindCache.set(face, k);
    return k;
  }

  edgeKind(name: string): EdgeKind {
    const hit = this.edgeKindCache.get(name);
    if (hit) return hit;
    const pts = (this.edge(name)?.pts ?? []) as V3[];
    let k: EdgeKind = { type: 'curve' };
    if (pts.length >= 2) {
      const a = pts[0], b = pts[pts.length - 1];
      const chord = dist(a, b);
      const closed = chord < 1e-6 * Math.max(1, len(a));
      if (!closed && chord > 1e-9) {
        const d = unit(sub(b, a));
        if (pts.every((p) => len(cross(sub(p, a), d)) < 1e-4 * chord + 1e-9)) k = { type: 'line', dir: d };
      }
      if (k.type === 'curve' && pts.length >= 4) {
        const mid = pts[Math.floor(pts.length / 2)];
        const q = closed ? pts[Math.floor(pts.length / 4)] : b;
        const c = closed ? circum(a, q, mid) : circum(a, mid, b);
        if (c && c.r > 1e-9 && pts.every((p) => Math.abs(dist(p, c.c) - c.r) < 2e-3 * c.r && Math.abs(dot(sub(p, c.c), c.n)) < 2e-3 * c.r)) {
          k = { type: closed ? 'circle' : 'arc', radius: c.r, normal: c.n };
        }
      }
    }
    this.edgeKindCache.set(name, k);
    return k;
  }

  /** Unit tangent of an edge at its start or end, and whether it is exact (a line or circle) rather than read off the polyline. */
  private endTangent(name: string, atStart: boolean): { t: V3; exact: boolean } | null {
    const pts = (this.edge(name)?.pts ?? []) as V3[];
    if (pts.length < 2) return null;
    const kind = this.edgeKind(name);
    const p = atStart ? pts[0] : pts[pts.length - 1];
    const q = atStart ? pts[1] : pts[pts.length - 2];
    const seg = unit(sub(q, p));
    if (kind.type === 'line') return { t: kind.dir, exact: true };
    if (kind.type === 'circle' || kind.type === 'arc') {
      // the tangent is perpendicular to the radius, in the plane, signed to agree with the polyline direction
      const mid = pts[Math.floor(pts.length / 2)];
      const c = circum(pts[0], mid, pts[pts.length - 1]) ?? circum(pts[0], pts[Math.floor(pts.length / 4)], mid);
      if (c) { const t = unit(cross(c.n, sub(p, c.c))); return { t: dot(t, seg) < 0 ? scale(t, -1) : t, exact: true }; }
    }
    return { t: seg, exact: false };
  }

  private vertexKey(p: number[]): string { return p.map((x) => Math.round(x * 1e3)).join(','); }
  private edgesAtVertices(): Map<string, string[]> {
    if (this.vtxCache.size) return this.vtxCache;
    for (const [name, { e }] of this.edgeInfo) {
      const pts = e.pts ?? [];
      if (pts.length < 2) continue;
      for (const p of [pts[0], pts[pts.length - 1]]) {
        const k = this.vertexKey(p);
        const l = this.vtxCache.get(k);
        if (l) { if (!l.includes(name)) l.push(name); } else this.vtxCache.set(k, [name]);
      }
    }
    return this.vtxCache;
  }
  private endsOf(name: string): string[] {
    const pts = this.edge(name)?.pts ?? [];
    return pts.length < 2 ? [] : [this.vertexKey(pts[0]), this.vertexKey(pts[pts.length - 1])];
  }

  // ---- the selection operations; each returns the new names (seeds included) ----
  /** Edges joined end to end with a smooth turn (< tolDeg; looser when the tangent is read off a polyline). */
  tangentEdges(seeds: string[], tolDeg = 2): string[] {
    const out = new Set(seeds.filter((s) => this.isEdge(s)));
    const queue = [...out];
    while (queue.length) {
      const cur = queue.pop()!;
      const pts = this.edge(cur)?.pts ?? [];
      for (const atStart of [true, false]) {
        const p = atStart ? pts[0] : pts[pts.length - 1];
        if (!p) continue;
        const a = this.endTangent(cur, atStart);
        if (!a) continue;
        for (const other of this.edgesAtVertices().get(this.vertexKey(p)) ?? []) {
          if (out.has(other)) continue;
          const op = this.edge(other)?.pts ?? [];
          const otherStart = this.vertexKey(op[0]) === this.vertexKey(p);
          const b = this.endTangent(other, otherStart);
          if (!b) continue;
          const tol = a.exact && b.exact ? tolDeg : Math.max(tolDeg, 6);
          const ang = Math.acos(Math.min(1, Math.abs(dot(a.t, b.t)))) * 180 / Math.PI;
          if (ang <= tol) { out.add(other); queue.push(other); }
        }
      }
    }
    return [...out];
  }

  /** Faces reached across a shared edge where the surfaces meet smoothly (the normals agree along the edge). */
  tangentFaces(seeds: string[], tolDeg = 3): string[] {
    const out = new Set(seeds.filter((s) => this.isFace(s)));
    const queue = [...out];
    while (queue.length) {
      const f = queue.pop()!;
      for (const en of this.edgesOf(f)) {
        const fs = this.facesOfEdge.get(en) ?? [];
        const g = fs.find((x) => x !== f);
        if (!g || out.has(g)) continue;
        const pts = this.edge(en)?.pts ?? [];
        if (pts.length < 2) continue;
        const samples = [pts[0], pts[Math.floor(pts.length / 2)], pts[pts.length - 1]] as V3[];
        const smooth = samples.every((p) => {
          const a = this.normalAt(f, p), b = this.normalAt(g, p);
          return a && b && angleDeg(a, b) <= tolDeg;
        });
        if (smooth) { out.add(g); queue.push(g); }
      }
    }
    return [...out];
  }

  /** Faces (planes, cylinders by axis) or edges (lines, circles by axis) parallel to the seeds. */
  parallel(seeds: string[], mode: 'face' | 'edge'): string[] {
    const out = new Set(seeds);
    const par = (a: V3, b: V3): boolean => Math.acos(Math.min(1, Math.abs(dot(a, b)))) * 180 / Math.PI <= TOL_PARALLEL_DEG;
    if (mode === 'face') {
      const dirs: V3[] = [];
      for (const s of seeds) { const k = this.faceKind(s); if (k.type === 'plane') dirs.push(k.normal); else if (k.type === 'cylinder') dirs.push(k.axis); }
      for (const f of this.faces) {
        const k = this.faceKind(f);
        const d = k.type === 'plane' ? k.normal : k.type === 'cylinder' ? k.axis : null;
        if (d && dirs.some((x) => par(x, d))) out.add(f);
      }
    } else {
      const dirs: V3[] = [];
      for (const s of seeds) { const k = this.edgeKind(s); if (k.type === 'line') dirs.push(k.dir); else if (k.type === 'circle' || k.type === 'arc') dirs.push(k.normal); }
      for (const n of this.edgeNames) {
        const k = this.edgeKind(n);
        const d = k.type === 'line' ? k.dir : k.type === 'circle' || k.type === 'arc' ? k.normal : null;
        if (d && dirs.some((x) => par(x, d))) out.add(n);
      }
    }
    return [...out];
  }

  /** Faces of the same type and size (plane: area; cylinder: radius and area; other: area), or edges of the same type and length (circles: radius too). */
  similar(seeds: string[], mode: 'face' | 'edge'): string[] {
    const out = new Set(seeds);
    if (mode === 'face') {
      for (const s of seeds) {
        const ks = this.faceKind(s), as = this.area(s);
        for (const f of this.faces) {
          const k = this.faceKind(f);
          if (k.type !== ks.type || !rel(this.area(f), as)) continue;
          if (ks.type === 'cylinder' && k.type === 'cylinder' && !rel(k.radius, ks.radius, 2e-3)) continue;
          out.add(f);
        }
      }
    } else {
      for (const s of seeds) {
        const ks = this.edgeKind(s), ls = this.edgeLength(s);
        for (const n of this.edgeNames) {
          const k = this.edgeKind(n);
          const sameType = k.type === ks.type;
          if (!sameType || !rel(this.edgeLength(n), ls, 2e-3)) continue;
          if ((ks.type === 'circle' || ks.type === 'arc') && (k.type === 'circle' || k.type === 'arc') && !rel(k.radius, ks.radius, 2e-3)) continue;
          out.add(n);
        }
      }
    }
    return [...out];
  }

  /** The boundary edges of the faces (every loop of each face). */
  loopsOfFaces(faces: string[]): string[] {
    return [...new Set(faces.flatMap((f) => this.edgesOf(f)))];
  }
  /** The loop of an edge along one of its faces: the face's boundary edges connected to it end to end. `face` picks the side (default: the smaller face). */
  loopOfEdge(edge: string, face?: string): string[] {
    const fs = this.facesOfEdge.get(edge) ?? [];
    const f = face && fs.includes(face) ? face : [...fs].sort((a, b) => this.area(a) - this.area(b))[0];
    if (!f) return [edge];
    const boundary = new Set(this.edgesOf(f));
    const out = new Set([edge]);
    const queue = [edge];
    const atV = this.edgesAtVertices();
    while (queue.length) {
      const cur = queue.pop()!;
      for (const v of this.endsOf(cur)) for (const o of atV.get(v) ?? []) if (boundary.has(o) && !out.has(o)) { out.add(o); queue.push(o); }
    }
    return [...out];
  }

  /** Every face of the bodies the faces belong to. */
  connectedFaces(seeds: string[]): string[] {
    const names = new Set<string>();
    for (const s of seeds) { const b = isBodyName(s) ? this.bodyByName(s) : this.bodyOfFace(s); for (const f of b?.faces ?? []) names.add(f); }
    return [...names];
  }
  /** Every edge connected to the seed edges through shared corners. */
  connectedEdges(seeds: string[]): string[] {
    const out = new Set(seeds.filter((s) => this.isEdge(s)));
    const queue = [...out];
    const atV = this.edgesAtVertices();
    while (queue.length) {
      const cur = queue.pop()!;
      for (const v of this.endsOf(cur)) for (const o of atV.get(v) ?? []) if (!out.has(o)) { out.add(o); queue.push(o); }
    }
    return [...out];
  }
}
