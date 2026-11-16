// Reading a rebuild plan out of an imported body's triangle mesh: its volume, and the stock it can be turned from (the tightest prism its
// outline fits, or a plate with a turned body on it). Pure functions of the mesh (positions: 9 floats a triangle), used by the Recognise
// features analysis and by tools/step_features. Slicing is exact on the mesh, so it is only as good as the tessellation.

/** Volume of a closed triangle mesh (positions are 9 floats a triangle): the divergence theorem, so it is approximate on curved faces. */
export function meshVolume(pos: ArrayLike<number>): number {
  let v = 0;
  for (let i = 0; i + 8 < pos.length; i += 9) {
    v += pos[i] * (pos[i + 4] * pos[i + 8] - pos[i + 5] * pos[i + 7]) - pos[i + 1] * (pos[i + 3] * pos[i + 8] - pos[i + 5] * pos[i + 6]) + pos[i + 2] * (pos[i + 3] * pos[i + 7] - pos[i + 4] * pos[i + 6]);
  }
  return Math.abs(v) / 6;
}

type P2 = [number, number];
const other = (ax: number) => [0, 1, 2].filter((i) => i !== ax);

/** Outer loop of the mesh cut by the plane `coord[ax] = h`, in the two other coordinates (low axis first), or null. Loops are chained from shared edge points. */
function allLoops(pos: ArrayLike<number>, ax: number, h: number): { pts: P2[]; area: number }[] {
  const [u, v] = other(ax);
  const segs: [string, string][] = [], at = new Map<string, P2>();
  const key = (p: P2) => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)}`;
  const cut = (a: number[], b: number[]): P2 | null => {
    if ((a[ax] - h) * (b[ax] - h) >= 0) return null;
    if (a[ax] > b[ax] || (a[ax] === b[ax] && a[u] > b[u])) [a, b] = [b, a];   // the same float result from either triangle sharing the edge
    const t = (h - a[ax]) / (b[ax] - a[ax]);
    return [a[u] + t * (b[u] - a[u]), a[v] + t * (b[v] - a[v])];
  };
  for (let i = 0; i + 8 < pos.length; i += 9) {
    const t = [[pos[i], pos[i + 1], pos[i + 2]], [pos[i + 3], pos[i + 4], pos[i + 5]], [pos[i + 6], pos[i + 7], pos[i + 8]]];
    const q = [cut(t[0], t[1]), cut(t[1], t[2]), cut(t[2], t[0])].filter((x): x is P2 => x !== null);
    if (q.length !== 2) continue;
    const k0 = key(q[0]), k1 = key(q[1]);
    if (k0 === k1) continue;
    at.set(k0, q[0]); at.set(k1, q[1]); segs.push([k0, k1]);
  }
  const adj = new Map<string, string[]>();
  for (const [a, b] of segs) { (adj.get(a) ?? adj.set(a, []).get(a)!).push(b); (adj.get(b) ?? adj.set(b, []).get(b)!).push(a); }
  const used = new Set<string>(); const found: { pts: P2[]; area: number }[] = [];
  for (const [a0] of adj) {
    if (used.has(a0)) continue;
    const loop = [a0]; used.add(a0); let cur = a0;
    for (;;) { const nx = adj.get(cur)!.find((n) => !used.has(n)); if (!nx) break; loop.push(nx); used.add(nx); cur = nx; }
    if (loop.length < 3) continue;
    const pts = loop.map((k) => at.get(k)!);
    let area = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; area += p[0] * q[1] - q[0] * p[1]; }
    area = Math.abs(area) / 2;
    found.push({ pts, area });
  }
  return found;
}

function outerLoop(pos: ArrayLike<number>, ax: number, h: number): { pts: P2[]; area: number } | null {
  return allLoops(pos, ax, h).reduce<{ pts: P2[]; area: number } | null>((b, l) => (!b || l.area > b.area ? l : b), null);
}

/** A loop that is a circle: its centre and radius, or null (every point within 0.5 % of the mean radius from the centroid). */
/** Midpoint of the loop's bounding box: unlike the mean of its points it does not drift where the tessellation is denser. */
function bboxMid(pts: P2[]): P2 {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

function circleOf(l: { pts: P2[]; area: number }, tol = 0.005): { c: P2; r: number } | null {
  const c = bboxMid(l.pts);
  const rs = l.pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1])), r = rs.reduce((a, b) => a + b, 0) / rs.length;
  if (process.env.STOCK_LOOPS) console.error('loop', l.pts.length, 'pts r', r.toFixed(3), 'spread', (Math.max(...rs) - Math.min(...rs)).toFixed(3), 'area', l.area.toFixed(1));
  return Math.max(...rs.map((x) => Math.abs(x - r))) < tol * r ? { c, r } : null;
}

/** Radii against height along an axis: at each of `n` levels, the circular loops (outer and inner). The raw material for a revolve profile. */
export function turnedLevels(pos: ArrayLike<number>, box: { min: number[]; max: number[] }, ax: number, n = 36) {
  const out: { h: number; loops: { r: number; c: P2; round: boolean }[] }[] = [];
  for (let i = 0; i < n; i++) {
    const h = box.min[ax] + ((i + 0.5) / n) * (box.max[ax] - box.min[ax]);
    // the radius of the circle with the loop's area: steady under tessellation noise, unlike a mean radius
    const loops = allLoops(pos, ax, h).sort((x, y) => y.area - x.area).map((l) => ({ r: Math.sqrt(l.area / Math.PI), round: circleOf(l, 0.15) !== null, c: bboxMid(l.pts) }));
    out.push({ h, loops });
  }
  return out;
}

/** Drop points that lie within `tol` of the line through their neighbours. */
function simplify(pts: P2[], tol: number): P2[] {
  let out = pts.slice(), changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length && out.length > 3; i++) {
      const a = out[(i + out.length - 1) % out.length], b = out[i], c = out[(i + 1) % out.length];
      const dx = c[0] - a[0], dy = c[1] - a[1], len = Math.hypot(dx, dy) || 1;
      if (Math.abs((b[0] - a[0]) * dy - (b[1] - a[1]) * dx) / len < tol) { out.splice(i, 1); i--; changed = true; }
    }
  }
  return out;
}

/** The tightest prism the body fits in: for each axis, the outer outline at 10 %, 50 % and 90 % of the extent; if all three agree it is a prism along that axis. */
export function prismStock(pos: ArrayLike<number>, box: { min: number[]; max: number[] }) {
  let best: { axis: number; area: number; volume: number; points: P2[]; lo: number; hi: number } | null = null;
  for (let ax = 0; ax < 3; ax++) {
    const lo = box.min[ax], hi = box.max[ax];
    const ls = [0.1, 0.5, 0.9].map((f) => outerLoop(pos, ax, lo + (hi - lo) * f));
    if (ls.some((l) => !l)) continue;
    const areas = ls.map((l) => l!.area);
    if (Math.max(...areas) - Math.min(...areas) > 0.005 * Math.max(...areas)) continue;
    const volume = areas[1] * (hi - lo);
    if (!best || volume < best.volume) best = { axis: ax, area: areas[1], volume, points: simplify(ls[1]!.pts, 1e-3 * Math.max(hi - lo, 1)), lo, hi };
  }
  return best;
}

