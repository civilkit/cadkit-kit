/**
 * Model snaps: while sketching, the existing body offers places to land on. The body's edges are projected into the sketch
 * plane (an edge that crosses the plane contributes the point where it pierces it; an edge parallel to the plane keeps its
 * projection) and turned into candidate points (ends, midpoints, circle / arc centres, quadrants, crossings of two edges)
 * and guide lines (the middle of the body's extent in the plane, the mid-plane of an extrusion).
 *
 * Pure. `buildModelSnaps` runs once per sketch session and when the body changes; `modelSnapAt` is the per-pointer query.
 */
import { classifyCurve, flatten, type Projected } from './tools/project';
import { dist, intersect, nearestOn, type CurveG } from './tools/edit-geom';
import { withPoint } from './tools/edit-draft';
import { addConstraintOf } from './tools/builders';
import type { SketchDraft } from './index';
import type { BodyEdge, PlaneFrame3, Pt, SnapHit } from './tools/types';

export const MODEL_SNAP_KINDS = ['modelEndpoint', 'modelMidpoint', 'modelCenter', 'modelExtent'] as const;
export type ModelSnapKind = (typeof MODEL_SNAP_KINDS)[number];
/** The label of a model snap (i18n suffix `app.sketch.snap.<tag>`). */
export type ModelSnapTag = 'modelEndpoint' | 'modelMidpoint' | 'modelCenter' | 'modelQuadrant' | 'modelCrossing' | 'midExtent' | 'bodyCentre' | 'midExtrusion';

export const MAX_MODEL_CANDIDATES = 4000;
const PLANE_EPS = 1e-6;

export interface ModelPoint { kind: ModelSnapKind; tag: ModelSnapTag; at: Pt }
export interface ModelLine { tag: 'midExtent' | 'midExtrusion'; a: Pt; b: Pt }
export interface ModelSnaps {
  points: ModelPoint[];
  /** The projected edge geometry (for crossings with sketch entities and with each other). */
  curves: CurveG[];
  /** Guide lines the cursor can snap onto (the dashed centre lines). */
  lines: ModelLine[];
  /** True when the 4000 cap cut the list short. */
  capped: boolean;
}
export const EMPTY_MODEL_SNAPS: ModelSnaps = { points: [], curves: [], lines: [], capped: false };

/** An extrusion whose mid-plane is offered: the extruded sketch's plane frame, its depth and the sign of its direction along that frame's z. */
export interface ExtrusionSpan { frame: PlaneFrame3; depth: number; dir: 1 | -1; /** symmetric about the sketch plane */ mid?: boolean }

export interface ModelSnapOptions { extrusions?: ExtrusionSpan[]; max?: number }

const near = (a: Pt, b: Pt) => dist(a, b) <= 1e-6;

/** The points where a world polyline crosses the plane of `frame`, in plane coordinates. */
function piercings(frame: PlaneFrame3, pts: number[][]): Pt[] {
  const w = pts.map((p) => (p[0] - frame.o[0]) * frame.z[0] + (p[1] - frame.o[1]) * frame.z[1] + (p[2] - frame.o[2]) * frame.z[2]);
  const out: Pt[] = [];
  const uv = (p: number[]): Pt => ({ x: (p[0] - frame.o[0]) * frame.x[0] + (p[1] - frame.o[1]) * frame.x[1] + (p[2] - frame.o[2]) * frame.x[2], y: (p[0] - frame.o[0]) * frame.y[0] + (p[1] - frame.o[1]) * frame.y[1] + (p[2] - frame.o[2]) * frame.y[2] });
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = w[i], b = w[i + 1];
    if ((a < -PLANE_EPS && b > PLANE_EPS) || (a > PLANE_EPS && b < -PLANE_EPS)) {
      const t = a / (a - b);
      out.push(uv(pts[i].map((v, k) => v + (pts[i + 1][k] - v) * t)));
    }
  }
  return out;
}

const toG = (c: Projected): CurveG | null => (c.kind === 'line' || c.kind === 'circle' || c.kind === 'arc' ? c : null);

/** Candidate points and guide lines of a body, for a sketch on `frame`. */
export function buildModelSnaps(frame: PlaneFrame3, edges: BodyEdge[], opts: ModelSnapOptions = {}): ModelSnaps {
  const max = opts.max ?? MAX_MODEL_CANDIDATES;
  const points: ModelPoint[] = [];
  const curves: CurveG[] = [];
  let capped = false;
  const push = (kind: ModelSnapKind, tag: ModelSnapTag, at: Pt) => {
    if (points.length >= max) { capped = true; return; }
    if (!points.some((p) => p.tag === tag && near(p.at, at))) points.push({ kind, tag, at });
  };
  const extentPts: Pt[] = [];
  const lines: LineInfo[] = [];

  for (const e of edges) {
    if (capped) break;
    if (e.pts.length < 2) continue;
    const flat = flatten(frame, e.pts);
    const through = piercings(frame, e.pts);
    for (const p of through) { push('modelEndpoint', 'modelEndpoint', p); extentPts.push(p); }
    if (flat.off > PLANE_EPS && through.length === 0) {
      // out of the plane: its shadow still tells where the body is (a circle's centre, a line's ends)
    }
    const c = collinear(flat.pts) ?? classifyCurve(flat.pts);
    if (!c) {
      // an edge seen end-on projects to one point
      const p = flat.pts[0];
      if (flat.pts.every((q) => dist(q, p) < 1e-6)) { push('modelEndpoint', 'modelEndpoint', p); extentPts.push(p); }
      continue;
    }
    if (c.kind === 'line') {
      push('modelEndpoint', 'modelEndpoint', c.a); push('modelEndpoint', 'modelEndpoint', c.b);
      push('modelMidpoint', 'modelMidpoint', { x: (c.a.x + c.b.x) / 2, y: (c.a.y + c.b.y) / 2 });
      extentPts.push(c.a, c.b);
      lines.push({ a: c.a, b: c.b });
    } else if (c.kind === 'circle') {
      push('modelCenter', 'modelCenter', c.c);
      for (let k = 0; k < 4; k++) { const t = (k * Math.PI) / 2; push('modelCenter', 'modelQuadrant', { x: c.c.x + c.r * Math.cos(t), y: c.c.y + c.r * Math.sin(t) }); }
      extentPts.push({ x: c.c.x - c.r, y: c.c.y - c.r }, { x: c.c.x + c.r, y: c.c.y + c.r });
    } else if (c.kind === 'arc') {
      push('modelCenter', 'modelCenter', c.c);
      push('modelEndpoint', 'modelEndpoint', c.p1); push('modelEndpoint', 'modelEndpoint', c.p2);
      const a0 = Math.atan2(c.p1.y - c.c.y, c.p1.x - c.c.x), a1 = Math.atan2(c.p2.y - c.c.y, c.p2.x - c.c.x);
      let sw = a1 - a0; while (sw <= 0) sw += Math.PI * 2;
      const tm = a0 + sw / 2;
      push('modelMidpoint', 'modelMidpoint', { x: c.c.x + c.r * Math.cos(tm), y: c.c.y + c.r * Math.sin(tm) });
      extentPts.push(c.p1, c.p2);
    } else {
      push('modelEndpoint', 'modelEndpoint', c.pts[0]); push('modelEndpoint', 'modelEndpoint', c.pts[c.pts.length - 1]);
      extentPts.push(...c.pts);
    }
    const g = toG(c);
    if (g && curves.length < max) curves.push(g);
  }

  // crossings of projected edges with each other
  const cap = Math.min(curves.length, 400);
  for (let i = 0; i < cap && !capped; i++) for (let j = i + 1; j < cap; j++) for (const p of intersect(curves[i], curves[j])) push('modelEndpoint', 'modelCrossing', p);

  // the middle of the body's extent in the plane
  const guide: ModelLine[] = [];
  if (extentPts.length) {
    const xs = extentPts.map((p) => p.x), ys = extentPts.map((p) => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const ext = Math.max(x1 - x0, y1 - y0, 1) ;
    if (x1 - x0 > 1e-6) guide.push({ tag: 'midExtent', a: { x: cx, y: cy - ext }, b: { x: cx, y: cy + ext } });
    if (y1 - y0 > 1e-6) guide.push({ tag: 'midExtent', a: { x: cx - ext, y: cy }, b: { x: cx + ext, y: cy } });
    push('modelExtent', 'bodyCentre', { x: cx, y: cy });
    // the middle between the two outermost parallel edges, for each direction the body has edges in
    for (const g of parallelMids(lines)) guide.push(g);
  }
  for (const x of opts.extrusions ?? []) {
    const g = midExtrusionLine(frame, x);
    if (g) guide.push(g);
  }
  // the guides' own meeting point is a point too
  for (let i = 0; i < guide.length; i++) for (let j = i + 1; j < guide.length; j++) {
    const p = intersect({ kind: 'line', a: guide[i].a, b: guide[i].b }, { kind: 'line', a: guide[j].a, b: guide[j].b })[0];
    if (p && guide[i].tag === 'midExtent' && guide[j].tag === 'midExtent') push('modelExtent', 'bodyCentre', p);
  }
  return { points, curves, lines: dedupeLines(guide), capped };
}

interface LineInfo { a: Pt; b: Pt }

/** For each direction with lines at two or more offsets, the line half way between the outermost two. */
function parallelMids(lines: LineInfo[]): ModelLine[] {
  const groups: Array<{ dx: number; dy: number; len: number; items: Array<{ off: number; a: Pt; b: Pt }> }> = [];
  for (const l of lines) {
    const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y, L = Math.hypot(dx, dy);
    if (L < 1e-6) continue;
    let ux = dx / L, uy = dy / L;
    if (ux < -1e-9 || (Math.abs(ux) <= 1e-9 && uy < 0)) { ux = -ux; uy = -uy; }
    let g = groups.find((q) => Math.abs(q.dx * uy - q.dy * ux) < 1e-6);
    if (!g) { g = { dx: ux, dy: uy, len: 0, items: [] }; groups.push(g); }
    g.len += L;
    g.items.push({ off: l.a.x * -uy + l.a.y * ux, a: l.a, b: l.b });
  }
  groups.sort((p, q) => q.len - p.len);
  const out: ModelLine[] = [];
  for (const g of groups.slice(0, 4)) {
    const offs = g.items.map((i) => i.off);
    const lo = Math.min(...offs), hi = Math.max(...offs);
    if (hi - lo < 1e-6) continue;
    const mid = (lo + hi) / 2;
    const ps = g.items.flatMap((i) => [i.a.x * g.dx + i.a.y * g.dy, i.b.x * g.dx + i.b.y * g.dy]);
    const s0 = Math.min(...ps), s1 = Math.max(...ps);
    const at = (s: number): Pt => ({ x: g.dx * s - g.dy * mid, y: g.dy * s + g.dx * mid });
    out.push({ tag: 'midExtent', a: at(s0), b: at(s1) });
  }
  return out;
}

function dedupeLines(ls: ModelLine[]): ModelLine[] {
  const out: ModelLine[] = [];
  for (const l of ls) if (!out.some((o) => o.tag === l.tag && lineDist(o, l.a) < 1e-6 && lineDist(o, l.b) < 1e-6)) out.push(l);
  return out;
}
function lineDist(l: ModelLine, p: Pt): number {
  const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y, L = Math.hypot(dx, dy) || 1;
  return Math.abs((p.x - l.a.x) * dy - (p.y - l.a.y) * dx) / L;
}

/**
 * The mid-plane of an extrusion seen in the sketch plane: the plane half the depth along the extrusion's normal, cut by the
 * sketch plane. A sketch parallel to the extruded one meets it nowhere (null).
 */
export function midExtrusionLine(frame: PlaneFrame3, x: ExtrusionSpan): ModelLine | null {
  const z = x.frame.z;
  const k = x.mid ? 0 : (x.dir * x.depth) / 2;
  const m = [x.frame.o[0] + z[0] * k, x.frame.o[1] + z[1] * k, x.frame.o[2] + z[2] * k];
  const d = (v: number[]) => v[0] * z[0] + v[1] * z[1] + v[2] * z[2];
  const a = d(frame.x), b = d(frame.y);
  const c = d([frame.o[0] - m[0], frame.o[1] - m[1], frame.o[2] - m[2]]);
  const n = Math.hypot(a, b);
  if (n < 1e-9) return null;
  // a*u + b*v + c = 0 : the foot of the origin, and the direction along the line
  const p: Pt = { x: (-a * c) / (n * n), y: (-b * c) / (n * n) };
  const t: Pt = { x: -b / n, y: a / n };
  const R = Math.max(1, Math.abs(x.depth)) * 10;
  return { tag: 'midExtrusion', a: { x: p.x - t.x * R, y: p.y - t.y * R }, b: { x: p.x + t.x * R, y: p.y + t.y * R } };
}

export interface ModelSnapQuery {
  tolerance: number;
  on: (k: ModelSnapKind) => boolean;
  /** Sketch curves, for the crossings of the body's edges with the sketch's own entities. */
  sketchCurves?: Array<{ id: string; g: CurveG }>;
}

/** Points first (nearest), then crossings with the sketch, then the guide lines. */
export function modelPointAt(m: ModelSnaps, at: Pt, q: ModelSnapQuery): SnapHit | undefined {
  let best: { d: number; p: ModelPoint } | undefined;
  for (const p of m.points) {
    if (!q.on(p.kind)) continue;
    const d = dist(p.at, at);
    if (d <= q.tolerance && (!best || d < best.d - 1e-6)) best = { d, p };
  }
  if (best) return { kind: best.p.kind, at: best.p.at, model: best.p.tag };
  return undefined;
}

export function modelCrossingAt(m: ModelSnaps, at: Pt, q: ModelSnapQuery): SnapHit | undefined {
  if (!q.sketchCurves?.length || !q.on('modelEndpoint')) return undefined;
  let best: { d: number; at: Pt } | undefined;
  for (const g of m.curves) {
    // only curves that come near the pointer can cross there
    const n = nearestOn(g, at);
    if (!n || dist(n, at) > q.tolerance * 3) continue;
    for (const s of q.sketchCurves) for (const p of intersect(g, s.g)) {
      const d = dist(p, at);
      if (d <= q.tolerance && (!best || d < best.d)) best = { d, at: p };
    }
  }
  return best ? { kind: 'modelEndpoint', at: best.at, model: 'modelCrossing' } : undefined;
}

export function modelLineAt(m: ModelSnaps, at: Pt, q: ModelSnapQuery): SnapHit | undefined {
  if (!q.on('modelExtent')) return undefined;
  let best: { d: number; l: ModelLine; foot: Pt } | undefined;
  for (const l of m.lines) {
    const foot = nearestOn({ kind: 'line', a: l.a, b: l.b }, at);
    if (!foot) continue;
    const d = dist(foot, at);
    if (d <= q.tolerance && (!best || d < best.d)) best = { d, l, foot };
  }
  return best ? { kind: 'modelExtent', at: best.foot, model: best.l.tag, guide: { a: best.l.a, b: best.l.b } } : undefined;
}

/** Shift+click on a model snap: add the snapped place as a fixed reference point (a point pinned to the model). */
export function attachModelPoint(draft: SketchDraft, at: Pt): { draft: SketchDraft; id: string } {
  const have = draft.points.find((p) => p.fixed && dist(p, at) <= 1e-6);
  if (have) return { draft, id: have.id };
  const r = withPoint(draft, at);
  return { draft: { ...r.draft, points: r.draft.points.map((p) => (p.id === r.id ? { ...p, fixed: true, ext: true } as typeof p : p)) }, id: r.id };
}

/** A closed outline seen edge-on (a circle in a side view) lies on one line: that line's span, which `classifyCurve` would call a loop. */
function collinear(pts: Pt[]): Projected | null {
  const far = (from: Pt) => pts.reduce((b, p) => (dist(p, from) > dist(b, from) ? p : b), from);
  const a = far(pts[0]), b = far(a);
  const L = dist(a, b);
  if (L < 1e-6) return null;
  const tol = L * 1e-6;
  return pts.every((p) => Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / L <= tol) ? { kind: 'line', a, b } : null;
}

/** A Shift+click on a model point: every point the click just made at the snapped place is pinned to a fixed reference point there. */
export function attachModelSnap(before: SketchDraft, after: SketchDraft, snap: SnapHit | undefined): SketchDraft {
  if (!snap || !snap.model || snap.kind === 'modelExtent') return after;
  const known = new Set(before.points.map((p) => p.id));
  let d = after;
  for (const p of after.points) {
    if (known.has(p.id) || p.fixed || dist(p, snap.at) > 1e-6) continue;
    const r = attachModelPoint(d, snap.at);
    d = addConstraintOf(r.draft, 'coincident', [p.id, r.id]);
    break;
  }
  return d;
}
