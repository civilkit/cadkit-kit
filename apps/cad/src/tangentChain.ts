// Tangent-chain propagation for fillet and chamfer ("select through tangent edges"): from the edges the user picked, add the edges that
// continue them smoothly (G1: they meet at an end vertex and leave it in opposite directions, within about a degree), and for a ring
// that is split into arcs, the sibling arcs (same two faces, same circle). Pure functions on the edges' world-space polylines, so
// they are tested with synthetic data and no kernel.
type V = number[];

export interface ChainEdge { key: string; faces: string[]; pts: V[] }
export interface ChainOptions {
  /** Largest angle (degrees) between one edge's direction and the reverse of the next one's at a shared vertex. Default 1. */
  tolDeg?: number;
  /** Largest distance between two end points that count as one vertex. Default 1e-3. */
  tol?: number;
}

const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V): number => Math.hypot(a[0], a[1], a[2]);
const scale = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
const unit = (a: V): V | null => { const l = len(a); return l < 1e-12 ? null : scale(a, 1 / l); };

/** The polyline without repeated points. */
function clean(pts: V[]): V[] {
  const out: V[] = [];
  for (const p of pts) if (!out.length || len(sub(p, out[out.length - 1])) > 1e-9) out.push(p);
  return out;
}

/** The circle through three points: centre, radius and plane normal, or null when they are (nearly) collinear. */
function circle3(a: V, b: V, c: V): { o: V; r: number; n: V } | null {
  const u = sub(b, a), v = sub(c, a);
  const w = cross(u, v);
  const w2 = dot(w, w);
  if (w2 < 1e-18 * Math.max(1, dot(u, u) * dot(v, v))) return null;
  const rel = scale(cross(sub(scale(v, dot(u, u)), scale(u, dot(v, v))), w), 1 / (2 * w2));
  const n = unit(w);
  return n ? { o: [a[0] + rel[0], a[1] + rel[1], a[2] + rel[2]], r: len(rel), n } : null;
}

/** The direction in which the edge leaves one of its ends, into the edge. Exact for a circular arc however coarsely it is sampled
 *  (the tangent of the circle through the first three points), else the first chord. Null for a degenerate edge. */
export function leaveDirection(pts: V[], atStart: boolean): V | null {
  const p = clean(atStart ? pts : [...pts].reverse());
  if (p.length < 2) return null;
  const chord = unit(sub(p[1], p[0]));
  if (p.length < 3 || !chord) return chord;
  const c = circle3(p[0], p[1], p[2]);
  if (!c) return chord;
  const t = unit(cross(c.n, sub(p[0], c.o)));
  if (!t) return chord;
  return dot(t, chord) >= 0 ? t : scale(t, -1);
}

/** The circle an edge lies on (a closed ring edge included), or null for a line or a free curve. */
function circleOf(pts: V[]): { o: V; r: number; n: V } | null {
  const p = clean(pts);
  if (p.length < 3) return null;
  const k = p.length - 1;
  const c = circle3(p[0], p[Math.floor(k / 3)], p[Math.floor((2 * k) / 3)]);
  if (!c || !Number.isFinite(c.r)) return null;
  // every point must be on it (a spline through three points is not an arc)
  return p.every((x) => Math.abs(len(sub(x, c.o)) - c.r) < 1e-4 * c.r + 1e-6) ? c : null;
}

const shares = (a: string[], b: string[]): boolean => a.some((f) => b.includes(f));
const samePair = (a: string[], b: string[]): boolean => a.length === b.length && a.every((f) => b.includes(f));

/** The keys to round when `seeds` are picked: the seeds (those that are known edges, in the given order), then every edge reached
 *  through tangent continuation (sharing a face with the edge it continues) and the sibling arcs of a split ring. */
export function tangentChain(seeds: string[], edges: ChainEdge[], opts: ChainOptions = {}): string[] {
  const tolDeg = opts.tolDeg ?? 1, tol = opts.tol ?? 1e-3;
  const cosTol = Math.cos((tolDeg * Math.PI) / 180);
  const usable = edges.filter((e) => e.faces.length === 2 && clean(e.pts).length >= 2);
  const byKey = new Map(usable.map((e, i) => [e.key, i]));
  const ends = usable.map((e) => {
    const p = clean(e.pts);
    return [{ at: p[0], dir: leaveDirection(e.pts, true) }, { at: p[p.length - 1], dir: leaveDirection(e.pts, false) }];
  });
  // end points bucketed in a grid so neighbours are found without comparing every pair
  const cell = Math.max(tol * 4, 1e-6);
  const bucket = new Map<string, Array<[number, number]>>();
  const cellKey = (x: number, y: number, z: number) => x + ',' + y + ',' + z;
  ends.forEach((pair, i) => pair.forEach((end, s) => {
    const k = cellKey(Math.floor(end.at[0] / cell), Math.floor(end.at[1] / cell), Math.floor(end.at[2] / cell));
    (bucket.get(k) ?? bucket.set(k, []).get(k)!).push([i, s]);
  }));
  const meeting = (i: number, s: number): Array<[number, number]> => {
    const at = ends[i][s].at;
    const cx = Math.floor(at[0] / cell), cy = Math.floor(at[1] / cell), cz = Math.floor(at[2] / cell);
    const out: Array<[number, number]> = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++)
      for (const [j, t] of bucket.get(cellKey(cx + dx, cy + dy, cz + dz)) ?? []) if (j !== i && len(sub(ends[j][t].at, at)) <= tol) out.push([j, t]);
    return out;
  };
  const circles = usable.map((e) => circleOf(e.pts));

  const seen = new Set<number>();
  const order: number[] = [];
  const queue: number[] = [];
  const take = (i: number) => { if (!seen.has(i)) { seen.add(i); order.push(i); queue.push(i); } };
  for (const k of seeds) { const i = byKey.get(k); if (i !== undefined) take(i); }
  while (queue.length) {
    const i = queue.shift()!;
    for (const s of [0, 1]) {
      const a = ends[i][s].dir;
      if (!a) continue;
      for (const [j, t] of meeting(i, s)) {
        const b = ends[j][t].dir;
        if (!b || seen.has(j) || !shares(usable[i].faces, usable[j].faces)) continue;
        if (-dot(a, b) >= cosTol) take(j);
      }
    }
    // the other arcs of a ring: same two faces and the same circle (found even where the arcs' ends do not quite meet)
    const ci = circles[i];
    if (ci) usable.forEach((e, j) => {
      const cj = circles[j];
      if (j === i || seen.has(j) || !cj || !samePair(usable[i].faces, e.faces)) return;
      if (len(sub(ci.o, cj.o)) <= 1e-3 * ci.r + tol && Math.abs(ci.r - cj.r) <= 1e-3 * ci.r + tol && Math.abs(dot(ci.n, cj.n)) > 1 - 1e-6) take(j);
    });
  }
  return order.map((i) => usable[i].key);
}
