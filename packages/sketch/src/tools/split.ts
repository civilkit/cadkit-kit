/**
 * Split Entity. Click a place on a line, arc, circle or fit spline: the entity is broken there into two entities that
 * meet at one shared sketch point (the joint), so every outline through it stays closed and extrudes as before.
 *
 * Edit rules:
 *  - the joint: an existing sketch point on the curve at the picked place (a snapped point, or any point within 1e-6) is
 *    reused; otherwise a new free point is added. Picking an end of the entity is refused (nothing to break);
 *  - line / arc: the original id keeps the first piece, a new entity (same type, construction flag and extra fields,
 *    sharing the centre of an arc) takes the second. The joint slides along the curve, so the split adds one degree of
 *    freedom: the two pieces are kept straight with `horizontal` / `vertical` on both, else `parallel`;
 *  - circle: becomes two arcs about the same centre, from the picked place to the opposite side and back (the original id
 *    keeps the first), so the picked place and its opposite are the joints. The opposite joint slides round the circle;
 *  - fit spline: becomes two fit splines through the same data points with the joint added as a data point where it falls
 *    between two of them. Each half has natural ends, so the curve between the old data points follows the old one closely
 *    but not to the last digit (the join has zero curvature, the old curve did not: a smooth curve moves by far less than a
 *    pixel's worth, a sharply wavering one can shift visibly, and the hint says so). A closed spline is cut at the joint and at the data point nearest the far side;
 *  - constraints that referenced the original: `horizontal` / `vertical` go on both pieces; `parallel`, `perpendicular`,
 *    `collinear`, `angle`, `pointOnLine`, `pldist`, `symmetric` (line), and `radius`, `diameter`, `equal`, `concentric`,
 *    `coincident`, `distance`, `hdist`, `vdist`, `pointOnCircle` (arc, circle) stay on the first piece, which still
 *    carries the same line direction or radius for both; `tangent` goes to the piece that holds the end it touches, else
 *    stays on the first. Dimensions between points (`distance` of two end points, etc.) are untouched, so a length across
 *    both pieces still reads true;
 *  - dropped, and reported: `equal` and `midpoint` on a line (its length changed), everything on a spline, and any
 *    constraint kind not listed above. `dropped` names the kinds, so the editor can say so.
 * Control-point splines, ellipses and the rest are not split (`splitUnsupported`).
 */
import type { DraftConstraint, DraftEntity, SketchDraft } from '../index';
import { dist, nearestOn, TOL } from './edit-geom';
import { curveOf, entityOf, pruneDangling, ptOf, replaceEntity, withConstraint, withEntity, withPoint } from './edit-draft';
import { fitLocate } from './splineMath';
import type { Pt, PreviewShape, Tool, ToolOutput } from './types';

export type SplitRes = { ok: true; draft: SketchDraft; at: Pt; dropped: string[]; /** a fit spline was re-fitted: its halves may differ slightly from the curve they replace */ refitted?: boolean } | { ok: false; hint: string };

/** Within this of the curve a sketch point counts as being on it (and as being the joint). */
const ON = 1e-6;

const KEEP_LINE = new Set(['parallel', 'perpendicular', 'collinear', 'angle', 'pointOnLine', 'pldist', 'symmetric']);
const KEEP_ROUND = new Set(['radius', 'diameter', 'equal', 'concentric', 'coincident', 'distance', 'hdist', 'vdist', 'pointOnCircle']);

/** Where on the entity the split would happen, before any edit. A string is the hint key of why not. */
function locate(draft: SketchDraft, e: ReturnType<typeof entityOf>, at: Pt, pointId?: string): { joint: Pt; pointId?: string; vertex?: number; span?: number } | string {
  if (!e) return 'app.sketch.hint.splitPick';
  const near = (target: Pt): string | undefined => {
    const snapped = pointId ? draft.points.find((p) => p.id === pointId) : undefined;
    if (snapped && dist(snapped, target) <= ON) return snapped.id;
    return draft.points.find((p) => dist(p, target) <= ON)?.id;
  };
  // a snapped sketch point that lies on the curve is the place, wherever the pointer was
  const snapped = pointId ? draft.points.find((p) => p.id === pointId) : undefined;
  if (snapped && e.type !== 'spline' && (e.type === 'line' || e.type === 'arc' || e.type === 'circle')) {
    const g0 = curveOf(draft, e), n0 = g0 ? nearestOn(g0, snapped) : null;
    if (n0 && dist(n0, snapped) <= ON) at = { x: snapped.x, y: snapped.y };
  }
  if (snapped && e.type === 'spline') {
    const ids0 = splineIds(draft, e), pts0 = ids0.map((id) => ptOf(draft, id)!);
    const l0 = pts0.length && pts0.every(Boolean) ? fitLocate(pts0, e.closed === true, snapped) : null;
    if (l0 && l0.dist <= ON) at = { x: snapped.x, y: snapped.y };
  }
  if (e.type === 'spline') {
    const ids = splineIds(draft, e);
    const pts = ids.map((id) => ptOf(draft, id)!);
    const loc = ids.length && pts.every(Boolean) ? fitLocate(pts, e.closed === true, at) : null;
    if (!loc) return 'app.sketch.hint.splitUnsupported';
    if (loc.vertex !== undefined) {
      if (e.closed !== true && (loc.vertex === 0 || loc.vertex === ids.length - 1)) return 'app.sketch.hint.splitAtEnd';
      return { joint: loc.pt, pointId: ids[loc.vertex], vertex: loc.vertex };
    }
    return { joint: loc.pt, ...(near(loc.pt) ? { pointId: near(loc.pt) } : {}), span: loc.span };
  }
  if (e.type !== 'line' && e.type !== 'arc' && e.type !== 'circle') return 'app.sketch.hint.splitUnsupported';
  const g = curveOf(draft, e);
  if (!g) return 'app.sketch.hint.degenerate';
  if (g.kind === 'line' && dist(g.a, g.b) < TOL) return 'app.sketch.hint.degenerate';
  const q = nearestOn(g, at);
  if (!q) return 'app.sketch.hint.degenerate';
  const id = near(q);
  if (e.type !== 'circle' && (id === e.p1 || id === e.p2)) return 'app.sketch.hint.splitAtEnd';
  if (g.kind !== 'circle' && (dist(q, g.kind === 'line' ? g.a : g.p1) <= ON || dist(q, g.kind === 'line' ? g.b : g.p2) <= ON)) return 'app.sketch.hint.splitAtEnd';
  return { joint: q, ...(id ? { pointId: id } : {}) };
}

/** The data points of a fit spline as point ids, consecutive repeats removed (the kernel drops them too). */
function splineIds(d: SketchDraft, e: DraftEntity): string[] {
  const out: string[] = [];
  for (const raw of Array.isArray(e.pts) ? e.pts : []) {
    const id = String(raw);
    const p = ptOf(d, id), last = out.length ? ptOf(d, out[out.length - 1]) : null;
    if (!p) return [];
    if (!last || dist(p, last) > 1e-9) out.push(id);
  }
  if (e.closed === true && out.length > 2) {
    const a = ptOf(d, out[0])!, b = ptOf(d, out[out.length - 1])!;
    if (dist(a, b) < 1e-12) out.pop();
  }
  return out;
}

/** The place that would be split for a click near `at` on the entity (the hover marker). Null when it cannot be split there. */
export function splitPoint(draft: SketchDraft, entityId: string, at: Pt, pointId?: string): Pt | null {
  const r = locate(draft, entityOf(draft, entityId), at, pointId);
  return typeof r === 'string' ? null : r.joint;
}

/** The constraint ref lists, rewritten for the two pieces. Returns the new constraint list and the kinds dropped. */
function carry(draft: SketchDraft, before: SketchDraft, id: string, piece: string, kind: 'line' | 'round' | 'spline', ends?: { first: string; second: string }): { draft: SketchDraft; dropped: string[] } {
  const dropped = new Set<string>();
  const keep: DraftConstraint[] = [];
  const extra: Array<{ type: string; refs: string[] }> = [];
  for (const k of before.constraints) {
    if (!k.refs?.includes(id)) { keep.push(k); continue; }
    if (kind === 'spline') { dropped.add(k.type); continue; }
    if (k.type === 'horizontal' || k.type === 'vertical') {
      keep.push(k);
      if (kind === 'line' && k.refs.length === 1) extra.push({ type: k.type, refs: [piece] });
      continue;
    }
    if (k.type === 'tangent') {
      // at the end it touches: the piece holding that end; otherwise the carrier is what is tangent, and the first piece has it
      const other = k.refs.find((r) => r !== id);
      const o = other ? entityOf(before, other) : undefined;
      const touches = (p: string) => !!o && [o.p1, o.p2].includes(p);
      const onSecond = !!ends && (typeof k.at === 'string' ? k.at === ends.second : touches(ends.second) && !touches(ends.first));
      keep.push(onSecond ? { ...k, refs: k.refs.map((r) => (r === id ? piece : r)) } : k);
      continue;
    }
    if (kind === 'line' ? KEEP_LINE.has(k.type) : KEEP_ROUND.has(k.type)) { keep.push(k); continue; }
    dropped.add(k.type);
  }
  let d: SketchDraft = { ...draft, constraints: keep };
  for (const x of extra) d = withConstraint(d, x.type, x.refs);
  return { draft: d, dropped: [...dropped] };
}

export function splitAt(draft: SketchDraft, entityId: string, at: Pt, pointId?: string): SplitRes {
  const e = entityOf(draft, entityId);
  const loc = locate(draft, e, at, pointId);
  if (typeof loc === 'string' || !e) return { ok: false, hint: typeof loc === 'string' ? loc : 'app.sketch.hint.splitPick' };
  let d = draft;
  // the joint
  let m = loc.pointId;
  if (!m) { const w = withPoint(d, loc.joint); d = w.draft; m = w.id; }
  const { id: _id, ...rest } = e;

  if (e.type === 'line' || e.type === 'arc') {
    const oldP2 = String(e.p2);
    d = replaceEntity(d, entityId, (x) => ({ ...x, p2: m }));
    const w = withEntity(d, { ...rest, p1: m, p2: oldP2 });
    d = w.draft;
    const c = carry(d, draft, entityId, w.id, e.type === 'line' ? 'line' : 'round', { first: String(e.p1), second: oldP2 });
    d = c.draft;
    const hv = draft.constraints.some((k) => k.refs?.length === 1 && k.refs[0] === entityId && (k.type === 'horizontal' || k.type === 'vertical'));
    if (e.type === 'line' && !hv) d = withConstraint(d, 'parallel', [entityId, w.id]);
    // equal / midpoint on a line change meaning with its length: dropped (the generic carry does that, since neither is kept)
    return { ok: true, draft: pruneDangling(d), at: loc.joint, dropped: c.dropped };
  }

  if (e.type === 'circle') {
    const cen = ptOf(d, String(e.c))!;
    const q = { x: 2 * cen.x - loc.joint.x, y: 2 * cen.y - loc.joint.y };
    const opp = withPoint(d, q);
    d = opp.draft;
    const { r: _r, ...arcRest } = rest;
    d = replaceEntity(d, entityId, (x) => { const { r: _x, ...o } = x; return { ...o, type: 'arc', c: e.c, p1: m, p2: opp.id }; });
    const w = withEntity(d, { ...arcRest, type: 'arc', c: e.c, p1: opp.id, p2: m });
    d = w.draft;
    const c = carry(d, draft, entityId, w.id, 'round');
    return { ok: true, draft: pruneDangling(c.draft), at: loc.joint, dropped: c.dropped };
  }

  // fit spline
  const ids = splineIds(d, e);
  const n = ids.length;
  let a: string[], b: string[];
  if (e.closed !== true) {
    const cut = loc.vertex !== undefined ? loc.vertex : loc.span!;     // vertex: shared data point; span s: joint falls after data point s
    a = loc.vertex !== undefined ? ids.slice(0, cut + 1) : [...ids.slice(0, cut + 1), m];
    b = loc.vertex !== undefined ? ids.slice(cut) : [m, ...ids.slice(cut + 1)];
  } else {
    // cut at the joint and at the data point that balances the two halves by chord length
    const at = (i: number) => ptOf(d, ids[((i % n) + n) % n])!;
    const chord = (i0: number, i1: number) => { let t = 0; for (let i = i0; i < i1; i++) t += dist(at(i), at(i + 1)); return t; };
    const ring = (i0: number, i1: number) => { const o: string[] = []; for (let i = i0; i <= i1; i++) o.push(ids[((i % n) + n) % n]); return o; };
    const jp = loc.joint;
    let bestJ = 0, bestGap = Infinity;
    if (loc.vertex !== undefined) {
      const v = loc.vertex;
      for (let j = v + 1; j <= v + n - 1; j++) {
        const gap = Math.abs(chord(v, j) - chord(j, v + n));
        if (gap < bestGap) { bestGap = gap; bestJ = j; }
      }
      a = ring(v, bestJ); b = ring(bestJ, v + n);
    } else {
      const s = loc.span!;
      for (let j = s + 1; j <= s + n; j++) {
        const gap = Math.abs(dist(jp, at(s + 1)) + chord(s + 1, j) - (chord(j, s + n) + dist(at(s), jp)));
        if (gap < bestGap) { bestGap = gap; bestJ = j; }
      }
      a = [m, ...ring(s + 1, bestJ)]; b = [...ring(bestJ, s + n), m];
    }
  }
  if (a.length < 2 || b.length < 2) return { ok: false, hint: 'app.sketch.hint.splitAtEnd' };
  d = replaceEntity(d, entityId, (x) => { const { closed: _c, ...o } = x; return { ...o, pts: a }; });
  const { closed: _closed, pts: _pts, ...splineRest } = rest;
  const w = withEntity(d, { ...splineRest, pts: b });
  const c = carry(w.draft, draft, entityId, w.id, 'spline');
  return { ok: true, draft: pruneDangling(c.draft), at: loc.joint, dropped: c.dropped, refitted: true };
}

const marker = (at: Pt, r: number): PreviewShape => ({ kind: 'circle', c: at, r });

export interface SplitState { hover?: { entityId: string } }
const view = (draft: SketchDraft, state: SplitState = {}, hint?: string, preview: PreviewShape[] = []): ToolOutput<SplitState> =>
  ({ state, draft, preview, fields: [], ...(hint ? { hint } : {}) });

export const splitTool: Tool<SplitState> = {
  id: 'split',
  start: () => ({}),
  step(state, ev, draft, _settings, env): ToolOutput<SplitState> {
    switch (ev.type) {
      case 'move': {
        const id = ev.snap?.entityId;
        if (!id) return view(draft);
        const p = splitPoint(draft, id, ev.snap?.at ?? ev.at, ev.snap?.pointId);
        return p ? view(draft, { hover: { entityId: id } }, undefined, [marker(p, Math.max((env?.tol ?? 0.6) * 0.5, 1e-3))]) : view(draft);
      }
      case 'click': {
        const id = ev.snap?.entityId;
        if (!id) return view(draft, state, 'app.sketch.hint.splitPick');
        const r = splitAt(draft, id, ev.snap?.at ?? ev.at, ev.snap?.pointId);
        if (!r.ok) return view(draft, state, r.hint);
        const hint = r.refitted ? (r.dropped.length ? 'app.sketch.hint.splitSplineDropped' : 'app.sketch.hint.splitSpline') : r.dropped.length ? 'app.sketch.hint.splitDropped' : undefined;
        return { ...view(r.draft), ...(hint ? { hint } : {}), ...(r.dropped.length ? { dropped: r.dropped } : {}) };
      }
      case 'key':
        return view(draft);
      default:
        return view(draft, state);
    }
  },
};
