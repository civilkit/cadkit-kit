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
export function classifyCurve(pts: Pt[], maxSplinePts = 32): Projected | null {
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
  const keep = Math.min(n - (closed ? 1 : 0), maxSplinePts);
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

/** `ids` is every entity that now stands for the edges: the ones added and the ones that were already there. */
export type ProjectRes = { draft: SketchDraft; added: string[]; ids: string[]; existing: number; skipped: number };

const samePt = (a: Pt, b: Pt) => dist(a, b) <= 1e-6;

/** The projected entity already at this place (same kind, same fixed points), if any. */
function findExisting(draft: SketchDraft, c: Projected): string | null {
  for (const e of draft.entities) {
    if (!e.ext) continue;
    if (c.kind === 'spline' && e.type === 'spline') {
      const q = (Array.isArray(e.pts) ? e.pts : []).map((id) => ptOf(draft, String(id)));
      if (q.length === c.pts.length && q.every((a, i) => a && samePt(a, c.pts[i]))) return e.id;
    } else if (c.kind === 'line' && e.type === 'line') {
      const a = ptOf(draft, String(e.p1)), b = ptOf(draft, String(e.p2));
      if (a && b && ((samePt(a, c.a) && samePt(b, c.b)) || (samePt(a, c.b) && samePt(b, c.a)))) return e.id;
    } else if (c.kind === 'circle' && e.type === 'circle') {
      const m = ptOf(draft, String(e.c));
      if (m && samePt(m, c.c) && Math.abs(Number(e.r) - c.r) <= 1e-6) return e.id;
    } else if (c.kind === 'arc' && e.type === 'arc') {
      const m = ptOf(draft, String(e.c)), a = ptOf(draft, String(e.p1)), b = ptOf(draft, String(e.p2));
      if (m && a && b && samePt(m, c.c) && samePt(a, c.p1) && samePt(b, c.p2)) return e.id;
    }
  }
  return null;
}

/** The curve an edge projects to: the exact source spline when the edge has one, else the tessellation recognised as a line, arc, circle or fit spline. */
export function edgeCurve(frame: PlaneFrame3, edge: BodyEdge): Projected | null {
  if (edge.exact && edge.exact.pts.length >= 3 && edge.exact.pieces === 1) return { kind: 'spline', pts: flatten(frame, edge.exact.pts).pts, closed: edge.exact.closed };
  return classifyCurve(flatten(frame, edge.pts).pts);
}

/** Add the projection of `edges` onto the plane of `frame` to the draft. */
export function projectEdges(draft: SketchDraft, frame: PlaneFrame3, edges: BodyEdge[]): ProjectRes {
  const curves: Array<Projected | null> = edges.map((edge) => edgeCurve(frame, edge));
  return projectCurves(draft, curves);
}

/** Add reference curves (already flattened; null = nothing to project) as fixed geometry: construction unless `opts.construction` is false (then a real outline that an extrude can use). */
export function projectCurves(draft: SketchDraft, curves: Array<Projected | null>, opts: { construction?: boolean } = {}): ProjectRes {
  let d = draft;
  const added: string[] = [];
  const ids: string[] = [];
  let existing = 0, skipped = 0;
  const fixedPoint = (at: Pt): string => {
    const near = d.points.find((p) => p.fixed && Math.hypot(p.x - at.x, p.y - at.y) <= TOL);
    if (near) return near.id;
    const r = withPoint(d, at);
    d = { ...r.draft, points: r.draft.points.map((p) => (p.id === r.id ? { ...p, fixed: true } : p)) };
    return r.id;
  };
  const flag = opts.construction === false ? { ext: true } : { construction: true, ext: true };
  for (const c of curves) {
    if (!c) { skipped++; continue; }
    const had = findExisting(d, c);
    if (had) { existing++; ids.push(had); continue; }
    let fields: Record<string, unknown>;
    switch (c.kind) {
      case 'line': fields = { type: 'line', p1: fixedPoint(c.a), p2: fixedPoint(c.b), ...flag }; break;
      case 'circle': fields = { type: 'circle', c: fixedPoint(c.c), r: c.r, ...flag }; break;
      case 'arc': fields = { type: 'arc', c: fixedPoint(c.c), p1: fixedPoint(c.p1), p2: fixedPoint(c.p2), ...flag }; break;
      default: fields = { type: 'spline', pts: c.pts.map(fixedPoint), ...(c.closed ? { closed: true } : {}), ...flag };
    }
    const e = withEntity(d, fields);
    d = e.draft; added.push(e.id); ids.push(e.id);
  }
  return { draft: d, added, ids, existing, skipped };
}

// ---------------------------------------------------------------- reference chains

const rkey = (p: Pt) => `${Math.round(p.x * 1e4)}:${Math.round(p.y * 1e4)}`;

/**
 * The reference outline an edge belongs to: the edges that lie in the same plane parallel to the sketch plane and
 * join it end to end (a vertex with exactly two of them continues the chain; a branch or an open end stops it).
 * Returned in walking order, each as the flattened polyline oriented along the walk.
 */
export function referenceChain(env: ToolEnv, edge: BodyEdge): Array<{ edge: BodyEdge; pts: Pt[]; exact?: Pt[]; closed?: boolean; whole?: boolean }> {
  if (!env.body) return [];
  type Piece = { edge: BodyEdge; pts: Pt[]; off: number };
  const all: Piece[] = [];
  let seed: Piece | null = null;
  for (const e of env.body.edges) {
    const f = flatten(env.body.frame, e.pts);
    if (f.pts.length < 2 || !classifyCurve(f.pts)) continue;
    const piece = { edge: e, pts: f.pts, off: f.off };
    all.push(piece);
    if (e === edge) seed = piece;
  }
  if (!seed) return [];
  const s0 = seed;
  const group = all.filter((p) => Math.abs(p.off - s0.off) <= 1e-4);
  const ends = (p: Piece) => [rkey(p.pts[0]), rkey(p.pts[p.pts.length - 1])];
  const at = new Map<string, Piece[]>();
  for (const p of group) for (const k of new Set(ends(p))) at.set(k, [...(at.get(k) ?? []), p]);
  const closedSelf = (p: Piece) => ends(p)[0] === ends(p)[1];
  if (closedSelf(s0)) {
    const ex = s0.edge.exact;
    return [{ edge: s0.edge, pts: s0.pts, ...(ex && ex.pts.length >= 3 && ex.pieces === 1 ? { exact: flatten(env.body.frame, ex.pts).pts, closed: ex.closed } : {}) }];
  }
  // grow both ways from the seed
  function walkFrom(startPiece: Piece, farKey: string, seen: Set<Piece>): Array<{ edge: BodyEdge; pts: Pt[] }> {
    const out: Array<{ edge: BodyEdge; pts: Pt[] }> = [];
    let cur = startPiece, key = farKey;
    for (;;) {
      const here = at.get(key) ?? [];
      if (here.length !== 2) break;
      const nxt = here.find((p) => p !== cur);
      if (!nxt || seen.has(nxt) || closedSelf(nxt)) break;
      seen.add(nxt);
      const st = ends(nxt)[0] === key;
      out.push({ edge: nxt.edge, pts: st ? nxt.pts : [...nxt.pts].reverse() });
      key = st ? ends(nxt)[1] : ends(nxt)[0];
      cur = nxt;
    }
    return out;
  }
  const seenAll = new Set<Piece>([s0]);
  const fwd = walkFrom(s0, ends(s0)[1], seenAll);
  const back = walkFrom(s0, ends(s0)[0], seenAll).map((x) => ({ edge: x.edge, pts: [...x.pts].reverse() })).reverse();
  const walked = [...back, { edge: s0.edge, pts: s0.pts }, ...fwd];
  const ex = s0.edge.exact;
  // every piece of a split closed outline shares the one exact spline; it stands for the chain only when the chain is all of them
  if (ex && ex.pts.length >= 3 && ex.pieces === walked.length && walked.every((w) => w.edge.exact === ex))
    return walked.map((w) => ({ ...w, exact: flatten(env.body!.frame, ex.pts).pts, closed: ex.closed, whole: true }));
  return walked;
}

/** The curves that stand for a reference chain: each edge on its own, except that two or more free-form pieces are
 *  joined into one spline (a closed one when the outline closes), so a smooth outline made of several kernel edges is
 *  one curve that can be offset. */
export function chainCurves(chain: Array<{ pts: Pt[]; exact?: Pt[]; closed?: boolean; whole?: boolean }>): Array<Projected | null> {
  if (chain.length >= 2 && chain[0].exact && chain.every((c) => c.whole)) return [{ kind: 'spline', pts: chain[0].exact, closed: chain[0].closed === true }];
  const each = chain.map((c) => (c.exact ? { kind: 'spline' as const, pts: c.exact, closed: c.closed === true } : classifyCurve(c.pts)));
  if (chain.length < 2 || !each.every((c) => c?.kind === 'spline')) return each;
  const merged: Pt[] = [];
  for (const c of chain) for (const p of c.pts) if (!merged.length || dist(p, merged[merged.length - 1]) > 1e-9) merged.push(p);
  return [classifyCurve(merged, 48)];
}

// ---------------------------------------------------------------- the tool

export function shapesOf(c: Projected): PreviewShape[] {
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

/** What a click on a body edge gives another tool (Dimension): the edge's projection as a fixed reference entity in the
 *  sketch (found when it is already there, added when not, so it is never duplicated), or why there is nothing to use.
 *  `none`: no body edge under the pointer. `squareOn`: one is, but it is square-on to the plane and projects to a point. */
export type EdgePick = { draft: SketchDraft; id: string } | { none: true } | { squareOn: true };
export function projectEdgeAt(draft: SketchDraft, env: ToolEnv | undefined, at: Pt): EdgePick {
  if (!env?.body) return { none: true };
  const e = edgeNear(env, at);
  if (e) {
    const r = projectEdges(draft, env.body.frame, [e]);
    return r.ids.length ? { draft: r.draft, id: r.ids[0] } : { none: true };
  }
  const tol = env.tol ?? 0;
  const under = env.body.edges.some((x) => distToPolyline(at, flatten(env.body!.frame, x.pts).pts) <= tol);
  return under ? { squareOn: true } : { none: true };
}

export type ProjectState = Record<string, never>;
const view = (draft: SketchDraft, hint?: string, preview: PreviewShape[] = [], fields: FieldSpec[] = []): ToolOutput<ProjectState> =>
  ({ state: {}, draft, preview, fields, ...(hint ? { hint } : {}) });

/** What Enter would add: the pre-selected edges that are not in the sketch yet. While there is something pending it is
 *  always previewed, which also tells the app the tool is mid-action, so Enter reaches the tool instead of confirming the sketch. */
function pending(env: ToolEnv, draft: SketchDraft): PreviewShape[] {
  if (!env.body || !env.selection?.length) return [];
  return edgesFor(env.body.edges, env.selection).flatMap((e) => {
    const c = edgeCurve(env.body!.frame, e);
    return c && !findExisting(draft, c) ? shapesOf(c) : [];
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
        const c = e ? edgeCurve(env.body.frame, e) : null;
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
