// Display-only changes to the body the viewer draws: hidden components are left out, exploded components are moved. The kernel's
// body, the document and the measure / section / mass queries are untouched; picks keep the kernel's face and edge names.
import { instanceOfName, explodeOffsets, copyTurner, isExploded, type DocLike, type ExplodeState, type V3 } from './model';

interface ViewEdge { key?: string; pts: number[][]; mid?: number[] }
export interface ShowBody {
  mesh: { positions: Float32Array; normals: Float32Array; triFace: Int32Array; faceIds: string[] };
  edges: ViewEdge[];
  box: { min: number[]; max: number[] };
  [k: string]: unknown;
}

export interface DisplayOpts { inserts: ReadonlySet<string>; hidden: ReadonlySet<string>; explode: ExplodeState; /** the document, so a pattern's copies turn a component's drag offset with them */ doc?: DocLike | null }

/** Centre of each component instance's bounding box (a pattern copy is an instance of its own, keyed `F6@F12.1`), and the centre of the box around all of them. Components with no triangles are absent. */
export function componentCentres(body: ShowBody, inserts: ReadonlySet<string>): { centres: Map<string, V3>; middle: V3 } {
  const boxes = new Map<string, { min: V3; max: V3 }>();
  const { positions, triFace, faceIds } = body.mesh;
  const owner = faceIds.map((n) => instanceOfName(n, inserts)?.key ?? null);
  for (let t = 0; t < triFace.length; t++) {
    const c = owner[triFace[t]];
    if (!c) continue;
    let b = boxes.get(c);
    if (!b) boxes.set(c, b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
    for (let v = 0; v < 3; v++) for (let a = 0; a < 3; a++) {
      const x = positions[t * 9 + v * 3 + a];
      if (x < b.min[a]) b.min[a] = x;
      if (x > b.max[a]) b.max[a] = x;
    }
  }
  const centres = new Map<string, V3>();
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const [id, b] of boxes) {
    centres.set(id, [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]);
    for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], b.min[a]); hi[a] = Math.max(hi[a], b.max[a]); }
  }
  return { centres, middle: centres.size ? [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2] : [0, 0, 0] };
}

/** The body as it is shown. Returns the same object when nothing is hidden or exploded. */
export function displayBody<B extends ShowBody>(body: B, o: DisplayOpts): B {
  const moving = isExploded(o.explode);
  if (!o.hidden.size && !moving) return body;
  if (!o.inserts.size) return body;
  const { centres, middle } = componentCentres(body, o.inserts);
  const off = moving ? explodeOffsets(centres, middle, o.explode, o.doc ? copyTurner(o.doc.features) : undefined) : new Map<string, V3>();
  const { positions, normals, triFace, faceIds } = body.mesh;
  const inst = faceIds.map((n) => instanceOfName(n, o.inserts));
  const owner = inst.map((i) => i?.key ?? null);
  const keepTri: number[] = [];
  for (let t = 0; t < triFace.length; t++) { const c = inst[triFace[t]]?.comp; if (!c || !o.hidden.has(c)) keepTri.push(t); }
  const n = keepTri.length;
  const P = new Float32Array(n * 9), N = new Float32Array(n * 9), F = new Int32Array(n);
  keepTri.forEach((t, i) => {
    const d = off.get(owner[triFace[t]] ?? '') ?? [0, 0, 0];
    for (let v = 0; v < 3; v++) for (let a = 0; a < 3; a++) { P[i * 9 + v * 3 + a] = positions[t * 9 + v * 3 + a] + d[a]; N[i * 9 + v * 3 + a] = normals[t * 9 + v * 3 + a]; }
    F[i] = triFace[t];
  });
  const edges: ViewEdge[] = [];
  for (const e of body.edges) {
    const i = e.key ? instanceOfName(e.key, o.inserts) : null;
    if (i && o.hidden.has(i.comp)) continue;
    const d = i ? off.get(i.key) : undefined;
    edges.push(d ? { ...e, pts: e.pts.map((p) => [p[0] + d[0], p[1] + d[1], p[2] + d[2]]), ...(e.mid ? { mid: [e.mid[0] + d[0], e.mid[1] + d[1], e.mid[2] + d[2]] } : {}) } : e);
  }
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], P[i + a]); hi[a] = Math.max(hi[a], P[i + a]); }
  return { ...body, mesh: { positions: P, normals: N, triFace: F, faceIds }, edges, box: n ? { min: lo, max: hi } : body.box };
}
