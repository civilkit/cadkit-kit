/**
 * Project body edges into the sketch (the "convert entities" tool).
 *
 * What it does: takes edges of the body on screen (world-space polylines the viewer already has: key, the two faces
 * an edge separates, points), flattens them onto the sketch plane along its normal and adds the result as REFERENCE
 * geometry:
 *  - every point is `fixed: true` (a constant for the solver: projected geometry never moves and adds no degrees of
 *    freedom); points at the same place are shared;
 *  - every entity is `construction: true` (never extruded; drawn dashed) and `ext: true` (the kernel's marker for
 *    external geometry: on a circle it makes the radius a driven constant, so a projected circle is fully defined);
 *  - a straight projection becomes a `line`, a circular one an `arc {c,p1,p2}` (counter-clockwise p1 to p2) or a
 *    `circle`, anything else (an ellipse from a tilted circle, a free-form edge) a `spline` through the polyline's
 *    vertices (at most 32, ends kept, `closed` for a loop). Recognition is by fit, within 1e-5 of the size.
 * Limits (documented, not hidden): a projected circle that is tilted is a spline approximation, not an ellipse; an
 * edge square-on to the plane (it projects to a point) is skipped; a body that changes later does not move the
 * reference (it is a snapshot, not an associative link); the edges are what the kernel tessellated, so a free-form
 * edge keeps that tessellation's accuracy.
 *
 * Choosing the edges: Enter projects what was selected in the 3D view before the sketch opened (edge keys, and the
 * boundary edges of selected faces, which includes the face the sketch is on); a click projects the edge nearest the
 * pointer (its projection, within the pick tolerance); a click on an already projected edge says so.
 */
import type { SketchDraft } from '../index';
import { angleOf, dist, TAU, TOL, wrap } from './edit-geom';
import { ptOf, withEntity, withPoint } from './edit-draft';
import type { BodyEdge, FieldSpec, PlaneFrame3, Pt, PreviewShape, Tool, ToolEnv, ToolOutput } from './types';

export type Projected =
  | { kind: 'line'; a: Pt; b: Pt }
  | { kind: 'arc'; c: Pt; r: number; p1: Pt; p2: Pt }
  | { kind: 'circle'; c: Pt; r: number }
  | { kind: 'spline'; pts: Pt[]; closed: boolean };

/** Plane coordinates (u, v) of world points, and the largest distance of any of them from the plane. */
export function flatten(frame: PlaneFrame3, pts: number[][]): { pts: Pt[]; off: number } {
  let off = 0;
  const out = pts.map((p) => {
    const d = [p[0] - frame.o[0], p[1] - frame.o[1], p[2] - frame.o[2]];
    const dotv = (a: number[]) => d[0] * a[0] + d[1] * a[1] + d[2] * a[2];
    off = Math.max(off, Math.abs(dotv(frame.z)));
    return { x: dotv(frame.x), y: dotv(frame.y) };
  });
  return { pts: out, off };
}

function circumcircle(a: Pt, b: Pt, c: Pt): { c: Pt; r: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
  const ux = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const uy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { c: { x: ux, y: uy }, r: Math.hypot(a.x - ux, a.y - uy) };
}

/** Recognise a projected polyline as a line, an arc, a circle or (otherwise) a spline. Null when it has no length. */
export function classifyCurve(pts: Pt[]): Projected | null {
  const n = pts.length;
  if (n < 2) return null;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const size = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  if (size < 1e-6) return null;
  const tol = size * 1e-5;
  const first = pts[0], last = pts[n - 1];
  const closed = dist(first, last) <= tol;
  if (!closed) {
    // straight: every vertex on the chord
    const dx = last.x - first.x, dy = last.y - first.y, l = Math.hypot(dx, dy);
    if (pts.every((p) => Math.abs((p.x - first.x) * dy - (p.y - first.y) * dx) / l <= tol)) return { kind: 'line', a: first, b: last };
  }
  if (n >= 3) {
    const i1 = closed ? Math.floor(n / 3) : Math.floor(n / 2), i2 = closed ? Math.floor((2 * n) / 3) : n - 1;
    const cc = circumcircle(first, pts[i1], pts[i2]);
    if (cc && cc.r < size * 1e4 && pts.every((p) => Math.abs(dist(p, cc.c) - cc.r) <= Math.max(1e-5 * cc.r, 1e-7))) {
      // signed angle swept walking the polyline
      let sweep = 0, maxStep = 0;
      for (let i = 1; i < n; i++) {
        let da = angleOf({ x: pts[i].x - cc.c.x, y: pts[i].y - cc.c.y }) - angleOf({ x: pts[i - 1].x - cc.c.x, y: pts[i - 1].y - cc.c.y });
        if (da > Math.PI) da -= TAU; else if (da < -Math.PI) da += TAU;
        sweep += da; maxStep = Math.max(maxStep, Math.abs(da));
      }
      if (Math.abs(sweep) >= TAU - 1.5 * maxStep - 1e-9) return { kind: 'circle', c: cc.c, r: cc.r };
      return sweep > 0 ? { kind: 'arc', c: cc.c, r: cc.r, p1: first, p2: last } : { kind: 'arc', c: cc.c, r: cc.r, p1: last, p2: first };
    }
  }
  const keep = Math.min(n - (closed ? 1 : 0), 32);
  const src = closed ? pts.slice(0, n - 1) : pts;
  const out: Pt[] = [];
  for (let i = 0; i < keep; i++) out.push(src[Math.round((i * (src.length - 1)) / Math.max(1, keep - 1))]);
  return out.length >= 2 && !(closed && out.length < 3) ? { kind: 'spline', pts: out, closed } : null;
}

/** The edges chosen by `selection`: keys of edges, plus the boundary edges of any face named in it. */
export function edgesFor(edges: BodyEdge[], selection: string[]): BodyEdge[] {
  const sel = new Set(selection);
  return edges.filter((e) => (e.key !== undefined && sel.has(e.key)) || (e.faces ?? []).some((f) => sel.has(f)));
}

export type ProjectRes = { draft: SketchDraft; added: string[]; existing: number; skipped: number };

const samePt = (a: Pt, b: Pt) => dist(a, b) <= 1e-6;

/** Is there already a projected entity at this place (same kind, same fixed points)? */
function exists(draft: SketchDraft, c: Projected): boolean {
  for (const e of draft.entities) {
    if (!e.ext) continue;
    if (c.kind === 'line' && e.type === 'line') {
      const a = ptOf(draft, String(e.p1)), b = ptOf(draft, String(e.p2));
      if (a && b && ((samePt(a, c.a) && samePt(b, c.b)) || (samePt(a, c.b) && samePt(b, c.a)))) return true;
    } else if (c.kind === 'circle' && e.type === 'circle') {
      const m = ptOf(draft, String(e.c));
      if (m && samePt(m, c.c) && Math.abs(Number(e.r) - c.r) <= 1e-6) return true;
    } else if (c.kind === 'arc' && e.type === 'arc') {
      const m = ptOf(draft, String(e.c)), a = ptOf(draft, String(e.p1)), b = ptOf(draft, String(e.p2));
      if (m && a && b && samePt(m, c.c) && samePt(a, c.p1) && samePt(b, c.p2)) return true;
    }
  }
  return false;
}

/** Add the projection of `edges` onto the plane of `frame` to the draft. */
export function projectEdges(draft: SketchDraft, frame: PlaneFrame3, edges: BodyEdge[]): ProjectRes {
  let d = draft;
  const added: string[] = [];
  let existing = 0, skipped = 0;
  const fixedPoint = (at: Pt): string => {
    const near = d.points.find((p) => p.fixed && Math.hypot(p.x - at.x, p.y - at.y) <= TOL);
    if (near) return near.id;
    const r = withPoint(d, at);
    d = { ...r.draft, points: r.draft.points.map((p) => (p.id === r.id ? { ...p, fixed: true } : p)) };
    return r.id;
  };
  const flag = { construction: true, ext: true };
  for (const edge of edges) {
    const c = classifyCurve(flatten(frame, edge.pts).pts);
    if (!c) { skipped++; continue; }
    if (exists(d, c)) { existing++; continue; }
    let fields: Record<string, unknown>;
    switch (c.kind) {
      case 'line': fields = { type: 'line', p1: fixedPoint(c.a), p2: fixedPoint(c.b), ...flag }; break;
      case 'circle': fields = { type: 'circle', c: fixedPoint(c.c), r: c.r, ...flag }; break;
      case 'arc': fields = { type: 'arc', c: fixedPoint(c.c), p1: fixedPoint(c.p1), p2: fixedPoint(c.p2), ...flag }; break;
      default: fields = { type: 'spline', pts: c.pts.map(fixedPoint), ...(c.closed ? { closed: true } : {}), ...flag };
    }
    const e = withEntity(d, fields);
    d = e.draft; added.push(e.id);
  }
  return { draft: d, added, existing, skipped };
}

// ---------------------------------------------------------------- the tool

function shapesOf(c: Projected): PreviewShape[] {
  const poly = (pts: Pt[], closed: boolean): PreviewShape[] => pts.slice(0, closed ? pts.length : -1).map((p, i) => ({ kind: 'line' as const, a: p, b: pts[(i + 1) % pts.length] }));
  if (c.kind === 'line') return [{ kind: 'line', a: c.a, b: c.b }];
  if (c.kind === 'circle') return [{ kind: 'circle', c: c.c, r: c.r }];
  if (c.kind === 'spline') return poly(c.pts, c.closed);
  const a0 = angleOf({ x: c.p1.x - c.c.x, y: c.p1.y - c.c.y });
  const sw = wrap(angleOf({ x: c.p2.x - c.c.x, y: c.p2.y - c.c.y }) - a0) || TAU;
  const n = Math.max(2, Math.ceil((24 * sw) / TAU));
  const pts = Array.from({ length: n + 1 }, (_, i) => ({ x: c.c.x + c.r * Math.cos(a0 + (sw * i) / n), y: c.c.y + c.r * Math.sin(a0 + (sw * i) / n) }));
  return poly(pts, false);
}

function distToPolyline(p: Pt, pts: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const t = l2 < 1e-18 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

/** The body edge whose projection is nearest `at` (within `tol`); among ties, the one nearest the plane. */
export function edgeNear(env: ToolEnv, at: Pt): BodyEdge | null {
  if (!env.body) return null;
  const tol = env.tol ?? 0;
  let best: { e: BodyEdge; d: number; off: number } | null = null;
  for (const e of env.body.edges) {
    const f = flatten(env.body.frame, e.pts);
    const d = distToPolyline(at, f.pts);
    if (d > tol) continue;
    if (!classifyCurve(f.pts)) continue;
    if (!best || d < best.d - tol * 0.05 || (Math.abs(d - best.d) <= tol * 0.05 && f.off < best.off)) best = { e, d, off: f.off };
  }
  return best?.e ?? null;
}

export type ProjectState = Record<string, never>;
const view = (draft: SketchDraft, hint?: string, preview: PreviewShape[] = [], fields: FieldSpec[] = []): ToolOutput<ProjectState> =>
  ({ state: {}, draft, preview, fields, ...(hint ? { hint } : {}) });

/** What Enter would add: the pre-selected edges that are not in the sketch yet. While there is something pending it is
 *  always previewed, which also tells the app the tool is mid-action, so Enter reaches the tool instead of confirming the sketch. */
function pending(env: ToolEnv, draft: SketchDraft): PreviewShape[] {
  if (!env.body || !env.selection?.length) return [];
  return edgesFor(env.body.edges, env.selection).flatMap((e) => {
    const c = classifyCurve(flatten(env.body!.frame, e.pts).pts);
    return c && !exists(draft, c) ? shapesOf(c) : [];
  });
}

const after = (env: ToolEnv, r: ProjectRes): ToolOutput<ProjectState> => {
  const left = pending(env, r.draft);
  const hint = r.added.length ? undefined : r.existing ? 'app.sketch.hint.alreadyProjected' : 'app.sketch.hint.nothingProjected';
  return view(r.draft, hint ?? (left.length ? 'app.sketch.hint.projectSelection' : undefined), left);
};

export const projectTool: Tool<ProjectState> = {
  id: 'project',
  start: () => ({}),
  step(_state, ev, draft, _settings, env) {
    if (!env?.body) return view(draft, ev.type === 'click' || (ev.type === 'key' && ev.key === 'Enter') ? 'app.sketch.hint.noBody' : undefined);
    switch (ev.type) {
      case 'move': {
        const e = edgeNear(env, ev.at);
        const c = e ? classifyCurve(flatten(env.body.frame, e.pts).pts) : null;
        if (c) return view(draft, undefined, shapesOf(c));
        const left = pending(env, draft);
        return view(draft, left.length ? 'app.sketch.hint.projectSelection' : undefined, left);
      }
      case 'click': {
        const e = edgeNear(env, ev.at);
        if (!e) return view(draft, 'app.sketch.hint.pickBodyEdge', pending(env, draft));
        return after(env, projectEdges(draft, env.body.frame, [e]));
      }
      case 'key': {
        if (ev.key !== 'Enter') return view(draft, undefined, pending(env, draft));
        const edges = edgesFor(env.body.edges, env.selection ?? []);
        if (!edges.length) return view(draft, 'app.sketch.hint.nothingSelected');
        return after(env, projectEdges(draft, env.body.frame, edges));
      }
      default:
        return view(draft, undefined, pending(env, draft));
    }
  },
};
