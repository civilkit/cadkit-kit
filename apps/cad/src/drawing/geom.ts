// Picking and measuring on a projected view: which edge a click is on, whether it is straight or round, the dimensions
// that follow, and how a dimension finds its edge again after the part is rebuilt.
import type { DDim, DView, KEdge, KLine, V2, V3, ViewData } from './model';

export const dist2 = (a: V2, b: V2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Lines a view shows: hidden and tangent edges follow the view's toggles. */
export function shownLines(g: ViewData, v: Pick<DView, 'hidden' | 'tangent'>): KLine[] {
  return g.lines.filter((l) => (l.v || v.hidden) && (l.k !== 't' || v.tangent));
}

/** Distance from a point to a polyline given flat [u,v,u,v...]. */
export function distToPoly(p: V2, pts: number[]): number {
  let best = Infinity;
  for (let i = 2; i < pts.length; i += 2) best = Math.min(best, distToSeg(p, [pts[i - 2], pts[i - 1]], [pts[i], pts[i + 1]]));
  if (pts.length === 2) best = dist2(p, [pts[0], pts[1]]);
  return best;
}
export function distToSeg(p: V2, a: V2, b: V2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  const t = L < 1e-18 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** The edge nearest to a point (view coordinates) within `tol`, among the lines the view shows. */
export function pickEdge(g: ViewData, v: Pick<DView, 'hidden' | 'tangent'>, p: V2, tol: number): { e: number; line: KLine; d: number } | null {
  let best: { e: number; line: KLine; d: number } | null = null;
  for (const l of shownLines(g, v)) {
    if (l.e === undefined || l.k === 'h') continue;
    const d = distToPoly(p, l.p);
    if (d <= tol && (!best || d < best.d)) best = { e: l.e, line: l, d };
  }
  return best;
}

export type EdgeShape =
  | { kind: 'line'; a: V2; b: V2 }
  | { kind: 'circle'; c: V2; r: number; full: boolean; a0: number; a1: number };

function circle3(p: V2, q: V2, r: V2): { c: V2; r: number } | null {
  const ax = p[0], ay = p[1], bx = q[0], by = q[1], cx = r[0], cy = r[1];
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-12) return null;
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  return { c: [ux, uy], r: Math.hypot(ax - ux, ay - uy) };
}

/** The shape of an edge of a view: its pieces joined and tested for a straight line or a circle (ellipses, edge-on edges and others: null). */
export function edgeShape(g: ViewData, e: number): EdgeShape | null {
  const pieces = g.lines.filter((l) => l.e === e && (l.k === 'e' || l.k === 'o') && l.p.length >= 4);
  if (!pieces.length) return null;
  const pts: V2[] = [];
  for (const l of pieces) for (let i = 0; i < l.p.length; i += 2) pts.push([l.p[i], l.p[i + 1]]);
  const ext = Math.max(...pts.map((p) => Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1])));
  if (ext < 1e-9) return null;
  // straight: every point within a hair of the chord of the two farthest points
  let far = pts[0], best = 0;
  for (const p of pts) { const d = dist2(p, pts[0]); if (d > best) { best = d; far = p; } }
  let far2 = pts[0]; best = 0;
  for (const p of pts) { const d = dist2(p, far); if (d > best) { best = d; far2 = p; } }
  if (pts.every((p) => distToSeg(p, far, far2) < 1e-6 * Math.max(1, best))) return { kind: 'line', a: far, b: far2 };
  if (pts.length < 8) return null;
  const n = pts.length;
  const cc = circle3(pts[0], pts[Math.floor(n / 3)], pts[Math.floor((2 * n) / 3)]) ?? circle3(pts[0], pts[Math.floor(n / 2)], pts[n - 1]);
  if (!cc || !(cc.r > 1e-9)) return null;
  const tol = Math.max(1e-4 * cc.r, 5e-4);
  if (!pts.every((p) => Math.abs(dist2(p, cc.c) - cc.r) < tol)) return null;
  const ang = pts.map((p) => Math.atan2(p[1] - cc.c[1], p[0] - cc.c[0]));
  // coverage: largest empty gap between sorted angles
  const s = [...ang].sort((a, b) => a - b);
  let gap = 0, gi = 0;
  for (let i = 0; i < s.length; i++) { const d = (i + 1 < s.length ? s[i + 1] : s[0] + 2 * Math.PI) - s[i]; if (d > gap) { gap = d; gi = i; } }
  const full = gap < 0.5;
  const a1 = s[gi], a0 = s[(gi + 1) % s.length];
  return { kind: 'circle', c: cc.c, r: cc.r, full, a0, a1: a1 < a0 ? a1 + 2 * Math.PI : a1 };
}

const keyOf = (e: KEdge): string => [...e.faces].sort().join('|');

/** A persistent reference of an edge: the faces it separates and a model point on it. */
export function edgeRef(g: ViewData, e: number): { faces: string[]; at: V3 } | null {
  const k = g.edges[e];
  return k ? { faces: [...k.faces], at: [k.at[0], k.at[1], k.at[2]] } : null;
}
/** The edge index of a reference in (new) view data: same faces, nearest model point. */
export function findRef(g: ViewData, ref: { faces: string[]; at: V3 }): number | null {
  const key = [...ref.faces].sort().join('|');
  let best: number | null = null, bd = Infinity;
  g.edges.forEach((k, i) => {
    if (keyOf(k) !== key) return;
    const d = Math.hypot(k.at[0] - ref.at[0], k.at[1] - ref.at[1], k.at[2] - ref.at[2]);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

/** Bounds of the drawn geometry (without hatch), view coordinates. */
export function bounds(g: ViewData, v: Pick<DView, 'hidden' | 'tangent'>): { min: V2; max: V2 } {
  const min: V2 = [Infinity, Infinity], max: V2 = [-Infinity, -Infinity];
  for (const l of shownLines(g, v)) {
    if (l.k === 'h' || !l.v) continue;
    for (let i = 0; i < l.p.length; i += 2) { min[0] = Math.min(min[0], l.p[i]); max[0] = Math.max(max[0], l.p[i]); min[1] = Math.min(min[1], l.p[i + 1]); max[1] = Math.max(max[1], l.p[i + 1]); }
  }
  return min[0] > max[0] ? { min: g.min, max: g.max } : { min, max };
}

// ---- making dimensions ----------------------------------------------------------------------------------------------------
let seq = 0;
const mk = (view: string, d: Omit<DDim, 'id' | 'view'>): DDim => ({ id: `D${Date.now().toString(36)}${(seq++).toString(36)}`, view, ...d });

/** A dimension from the edges picked (1 or 2): straight -> length; round -> diameter (full) or radius (arc); two straight parallel -> distance; two not -> angle;
 *  two round -> centre distance; round and straight -> distance from the centre. */
export function dimFromPicks(g: ViewData, view: string, picks: number[], opts: { radial?: boolean } = {}): DDim | null {
  const shapes = picks.map((e) => ({ e, s: edgeShape(g, e), ref: edgeRef(g, e) }));
  if (shapes.some((x) => !x.s)) return null;
  const refs = shapes.map((x) => x.ref).filter((r): r is { faces: string[]; at: V3 } => !!r);
  if (shapes.length === 1) {
    const s = shapes[0].s!;
    if (s.kind === 'line') {
      const dx = Math.abs(s.b[0] - s.a[0]), dy = Math.abs(s.b[1] - s.a[1]);
      if (dx < 1e-9 && dy < 1e-9) return null;
      const orient = dy < 1e-6 * dx ? 'h' : dx < 1e-6 * dy ? 'v' : 'aligned';
      return mk(view, { kind: 'linear', a: s.a, b: s.b, orient, offset: orient === 'v' ? -10 : 10, refs });
    }
    return mk(view, { kind: opts.radial || !s.full ? 'radial' : 'diameter', a: s.c, r: s.r, angle: Math.PI / 4, offset: 12, refs });
  }
  const [p, q] = [shapes[0].s!, shapes[1].s!];
  if (p.kind === 'line' && q.kind === 'line') {
    const d1: V2 = [p.b[0] - p.a[0], p.b[1] - p.a[1]], d2: V2 = [q.b[0] - q.a[0], q.b[1] - q.a[1]];
    const n1 = Math.hypot(...d1), n2 = Math.hypot(...d2);
    const sin = Math.abs(d1[0] * d2[1] - d1[1] * d2[0]) / (n1 * n2);
    if (sin < 1e-6) {
      // parallel: distance between the two lines, measured square to them, between the midpoints' projections
      const m1: V2 = [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2];
      const n: V2 = [-d1[1] / n1, d1[0] / n1];
      const t = (q.a[0] - m1[0]) * n[0] + (q.a[1] - m1[1]) * n[1];
      const b: V2 = [m1[0] + n[0] * t, m1[1] + n[1] * t];
      const horiz = Math.abs(n[1]) > 0.999, vert = Math.abs(n[0]) > 0.999;
      return mk(view, { kind: 'linear', a: m1, b, orient: horiz ? 'v' : vert ? 'h' : 'aligned', offset: horiz ? -12 : 12, refs });
    }
    // angle between the lines at their intersection
    const det = d1[0] * d2[1] - d1[1] * d2[0];
    const t = ((q.a[0] - p.a[0]) * d2[1] - (q.a[1] - p.a[1]) * d2[0]) / det;
    const v: V2 = [p.a[0] + d1[0] * t, p.a[1] + d1[1] * t];
    const far = (l: { a: V2; b: V2 }): V2 => (dist2(l.a, v) > dist2(l.b, v) ? l.a : l.b);
    return mk(view, { kind: 'angular', a: v, b: far(p), c: far(q), offset: 14, refs });
  }
  const centre = (s: typeof p): V2 => (s.kind === 'circle' ? s.c : [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2]);
  const a = centre(p), b = centre(q);
  if (p.kind === 'line' || q.kind === 'line') {
    const l = (p.kind === 'line' ? p : q) as Extract<EdgeShape, { kind: 'line' }>;
    const c = (p.kind === 'circle' ? p : q) as Extract<EdgeShape, { kind: 'circle' }>;
    const d: V2 = [l.b[0] - l.a[0], l.b[1] - l.a[1]], n = Math.hypot(...d);
    const nn: V2 = [-d[1] / n, d[0] / n];
    const t = (l.a[0] - c.c[0]) * nn[0] + (l.a[1] - c.c[1]) * nn[1];
    const foot: V2 = [c.c[0] + nn[0] * t, c.c[1] + nn[1] * t];
    const horiz = Math.abs(nn[1]) > 0.999, vert = Math.abs(nn[0]) > 0.999;
    return mk(view, { kind: 'linear', a: c.c, b: foot, orient: horiz ? 'v' : vert ? 'h' : 'aligned', offset: horiz ? -12 : 12, refs });
  }
  const horiz = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
  return mk(view, { kind: 'linear', a, b, orient: horiz ? 'h' : 'v', offset: horiz ? 12 : -12, refs });
}

/** Re-anchor a dimension on the regenerated view data through its references; the dimension is dropped from the sheet (null) when its edges are gone. */
export function refreshDim(d: DDim, g: ViewData, v?: Pick<DView, 'hidden' | 'tangent'>): DDim | null {
  if (d.overall) {
    const b = bounds(g, v ?? { hidden: true, tangent: false });
    return d.overall === 'w' ? { ...d, a: [b.min[0], b.min[1]], b: [b.max[0], b.min[1]] } : { ...d, a: [b.min[0], b.min[1]], b: [b.min[0], b.max[1]] };
  }
  if (!d.refs || !d.refs.length) return d;
  const idx = d.refs.map((r) => findRef(g, r));
  if (idx.some((i) => i === null)) return null;
  const nd = dimFromPicks(g, d.view, idx as number[], { radial: d.kind === 'radial' });
  if (!nd) return null;
  const keep = d.kind === 'callout' || d.kind === 'radial' || d.kind === 'diameter' ? d.kind : nd.kind;
  return { ...d, kind: nd.r !== undefined ? keep : nd.kind, a: nd.a, b: nd.b, c: nd.c, r: nd.r, orient: nd.orient, refs: nd.refs };
}

export interface HoleInfo { feature: string; text: string; faces: string[] }

/** Dimensions for a fresh view: overall width and height, a diameter (or hole / thread callout) for each round hole. */
export function autoDims(g: ViewData, v: DView, holes: HoleInfo[] = []): DDim[] {
  const out: DDim[] = [];
  const b = bounds(g, v);
  {
    const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1];
    if (w > 1e-6) out.push(mk(v.id, { kind: 'linear', a: [b.min[0], b.min[1]], b: [b.max[0], b.min[1]], orient: 'h', offset: 14, overall: 'w' }));
    if (h > 1e-6) out.push(mk(v.id, { kind: 'linear', a: [b.min[0], b.min[1]], b: [b.min[0], b.max[1]], orient: 'v', offset: -14, overall: 'h' }));
  }
  const circles = new Map<string, { e: number; s: Extract<EdgeShape, { kind: 'circle' }> }>();
  const edges = new Set<number>();
  for (const l of shownLines(g, v)) if (l.v && l.e !== undefined && l.k === 'e') edges.add(l.e);
  for (const e of edges) {
    const s = edgeShape(g, e);
    if (!s || s.kind !== 'circle' || !s.full) continue;
    // one dimension per hole position: of concentric circles (countersink, thread) the smallest speaks
    const key = `${s.c[0].toFixed(2)},${s.c[1].toFixed(2)}`;
    const old = circles.get(key);
    if (!old || s.r < old.s.r) circles.set(key, { e, s });
  }
  for (const { e, s } of circles.values()) {
    const faces = g.edges[e].faces;
    const hole = holes.find((hh) => hh.faces.some((f) => faces.some((x) => x === f || x.startsWith(f + '.') || x.startsWith(f + '~'))));
    const ref = edgeRef(g, e);
    out.push(mk(v.id, { kind: hole ? 'callout' : 'diameter', a: s.c, r: s.r, angle: Math.PI / 4 + (out.length % 3) * 0.5, offset: 14, refs: ref ? [ref] : undefined, ...(hole ? { feature: hole.feature } : {}) }));
  }
  return out;
}

export interface BalloonItem { no: number; components: string[] }

/** One balloon per BOM item on a view: attached to a visible edge of the item's component, the number set out from the view's centre so leaders do not cross the part. */
export function autoBalloons(g: ViewData, v: DView, items: BalloonItem[], compOf: (faceName: string) => string | null): Array<{ no: number; at: V2; dir: V2 }> {
  const out: Array<{ no: number; at: V2; dir: V2 }> = [];
  const cx = (g.min[0] + g.max[0]) / 2, cy = (g.min[1] + g.max[1]) / 2;
  for (const it of items) {
    let best: { at: V2; score: number } | null = null;
    for (const l of shownLines(g, v)) {
      if (!l.v || l.e === undefined || l.k === 'h') continue;
      const e = g.edges[l.e];
      const owner = e && e.faces.map((f) => compOf(f)).find((c) => c && it.components.includes(c));
      if (!owner) continue;
      const mid: V2 = [l.p[Math.floor(l.p.length / 4) * 2], l.p[Math.floor(l.p.length / 4) * 2 + 1]];
      // prefer edges near the outline of the view: the leader is short and clear of the part
      const score = Math.hypot(mid[0] - cx, mid[1] - cy);
      if (!best || score > best.score) best = { at: mid, score };
    }
    if (best) {
      const dx = best.at[0] - cx, dy = best.at[1] - cy, L = Math.hypot(dx, dy) || 1;
      out.push({ no: it.no, at: best.at, dir: L < 1e-9 ? [1, 1] : [dx / L, dy / L] });
    }
  }
  return out;
}
