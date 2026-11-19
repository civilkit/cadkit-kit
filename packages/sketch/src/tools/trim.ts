/**
 * Trim. Click a segment of a line, arc or circle: it is removed up to the nearest intersections with the other
 * entities (lines, circles, arcs; the intersection maths is in edit-geom.ts). A segment with no intersections
 * is deleted whole. Hovering previews the part that would go.
 *
 * Edit rules:
 *  - cut points: an existing sketch point within 1e-7 is reused (so shapes that meet share a point id);
 *    otherwise a new point is added and bound to the cutter with `pointOnLine [point, lineId]` or
 *    `pointOnCircle [point, circleOrArcId]` (refs convention read from solver.rs; both are covered by the
 *    real-kernel test);
 *  - line / arc: the removed span's ends are re-pointed to the cut points. A cut inside the entity splits it
 *    in two: the original id keeps the first piece, a new entity (same type and construction flag, sharing the
 *    centre of an arc) takes the second; horizontal / vertical / parallel / perpendicular / collinear on the
 *    original are copied to the new piece. `equal` and `midpoint` on a trimmed line are dropped (its length changed);
 *  - circle: needs two or more cut points; it becomes an arc `{c,p1,p2}` (same id, counter-clockwise from the end
 *    of the removed span to its start), `radius` / `diameter` / `equal` stay valid. One cut point only: refused;
 *    a tangent line or arc that stops at its contact counts as a cut there (its end is reused as the cut point);
 *  - points left unused are removed and every constraint with a dangling ref is dropped (`pruneDangling`), so a
 *    result never has an unresolved ref.
 * Splines and ellipses are neither trimmed nor used as cutters.
 */
import type { DraftConstraint, SketchDraft } from '../index';
import { add, arcSweep, dist, dot, len, scale, sub, intersect, paramEnd, paramOf, pointAt, sample, TAU, TOL, wrap, type CurveG } from './edit-geom';
import { curveOf, dropOrphans, entityOf, pruneDangling, removeEntities, replaceEntity, withConstraint, withEntity, withPoint } from './edit-draft';
import type { Pt, PreviewShape, Tool, ToolOutput } from './types';

/** `point`: an existing sketch point to cut at (the cutter's own end, at a tangent contact it stops on) */
interface Cut { t: number; at: Pt; cutter: string; cutterType: string; point?: string }
export interface TrimPlan {
  entityId: string;
  curve: CurveG;
  type: 'line' | 'arc' | 'circle';
  /** removed span in the curve's parameter; `lo`/`hi` undefined = the span runs to that end */
  lo?: Cut; hi?: Cut;
  /** nothing to cut against: the whole entity goes */
  whole: boolean;
}
export type TrimRes = { ok: true; draft: SketchDraft; removed: PreviewShape[] } | { ok: false; hint: string };

/** How far from a tangent contact an end of the cutter may sit and still be taken as the contact point. */
const TANGENT_END_TOL = 1e-4;

/**
 * Where the cutter `h` touches the circle / arc / line `g` tangentially, when that touch is one of `h`'s own ends (within
 * TANGENT_END_TOL): such a cutter only grazes `g` and stops there (a 3-point arc drawn to end on the tangent point), so the
 * crossing test, whose tolerance is far tighter than the solver leaves the end, can miss it. The end is the cut.
 */
function tangentEnds(draft: SketchDraft, g: CurveG, h: CurveG, ends: Array<string | undefined>): Array<{ at: Pt; point: string }> {
  if (h.kind === 'circle') return [];
  let contacts: Pt[] = [];
  if (g.kind === 'line') {
    if (h.kind === 'line') return [];
    // g is a line, h an arc: g touches h's circle at the foot of the perpendicular from h's centre
    const d = sub(g.b, g.a), l = len(d);
    if (l < TOL) return [];
    const f = add(g.a, scale(d, dot(sub(h.c, g.a), d) / (l * l)));
    if (Math.abs(dist(f, h.c) - h.r) <= TANGENT_END_TOL) contacts = [f];
  } else if (h.kind === 'line') {
    const d = sub(h.b, h.a), l = len(d);
    if (l < TOL) return [];
    const f = add(h.a, scale(d, dot(sub(g.c, h.a), d) / (l * l)));
    if (Math.abs(dist(f, g.c) - g.r) <= TANGENT_END_TOL) contacts = [f];
  } else {
    const dc = dist(g.c, h.c);
    if (dc < TOL) return [];
    const outer = Math.abs(dc - (g.r + h.r)) <= TANGENT_END_TOL, inner = Math.abs(dc - Math.abs(g.r - h.r)) <= TANGENT_END_TOL;
    if (outer || inner) { const u = scale(sub(h.c, g.c), 1 / dc); contacts = [add(g.c, scale(u, g.r)), add(g.c, scale(u, -g.r))]; }
  }
  const out: Array<{ at: Pt; point: string }> = [];
  for (const id of ends) {
    const p = id === undefined ? undefined : draft.points.find((q) => q.id === id);
    if (p && contacts.some((c) => dist(c, p) <= TANGENT_END_TOL)) out.push({ at: { x: p.x, y: p.y }, point: p.id });
  }
  return out;
}

function cutsOf(draft: SketchDraft, id: string, g: CurveG): Cut[] {
  const end = paramEnd(g);
  const tol = g.kind === 'line' ? TOL : TOL / g.r;
  // a crossing found within rounding of the curve's own end is that end (a touch at a shared corner), not a place to cut
  const endTol = tol * 10;
  const cuts: Cut[] = [];
  for (const e of draft.entities) {
    if (e.id === id) continue;
    const other = curveOf(draft, e);
    if (!other) continue;
    const touch = tangentEnds(draft, g, other, [e.p1, e.p2].map((p) => (p === undefined ? undefined : String(p))));
    // a crossing found at a tangent end is that end
    const hits: Array<{ at: Pt; point?: string }> = [...intersect(g, other).filter((p) => !touch.some((q) => dist(p, q.at) <= TANGENT_END_TOL)).map((p) => ({ at: p })), ...touch];
    for (const { at: p, point } of hits) {
      let t = paramOf(g, p);
      if (g.kind === 'arc' && t > TAU - endTol) t = 0;
      if (g.kind !== 'circle' && !(t > endTol && t < end - endTol)) continue;
      cuts.push({ t, at: p, cutter: e.id, cutterType: String(e.type), ...(point ? { point } : {}) });
    }
  }
  cuts.sort((a, b) => a.t - b.t);
  // merge cut points that are the same place (a crossing through a shared corner reports twice)
  const out: Cut[] = [];
  for (const c of cuts) {
    const last = out[out.length - 1];
    if (last && Math.abs(c.t - last.t) <= tol) continue;
    out.push(c);
  }
  if (g.kind === 'circle' && out.length > 1 && out[0].t + TAU - out[out.length - 1].t <= tol) out.pop();
  return out;
}

export function planTrim(draft: SketchDraft, entityId: string, at: Pt): TrimPlan | string {
  const e = entityOf(draft, entityId);
  const g = e ? curveOf(draft, e) : null;
  if (!e || !g) return 'app.sketch.hint.pickCurve';
  const type = g.kind;
  const cuts = cutsOf(draft, entityId, g);
  if (!cuts.length) return { entityId, curve: g, type, whole: true };
  let tc = paramOf(g, at);
  if (g.kind === 'line') tc = Math.min(Math.max(tc, 0), paramEnd(g));
  if (g.kind === 'arc' && tc > arcSweep(g)) tc = (tc - arcSweep(g)) < (TAU - tc) ? arcSweep(g) : 0;
  if (g.kind === 'circle') {
    if (cuts.length < 2) return 'app.sketch.hint.trimOneCut';  // none would have deleted it whole
    let lo = cuts[cuts.length - 1], hi = cuts[0];
    for (let i = 0; i < cuts.length; i++) if (cuts[i].t <= tc) { lo = cuts[i]; hi = cuts[(i + 1) % cuts.length]; }
    return { entityId, curve: g, type, lo, hi, whole: false };
  }
  let lo: Cut | undefined, hi: Cut | undefined;
  for (const c of cuts) { if (c.t <= tc) lo = c; else if (!hi) hi = c; }
  return { entityId, curve: g, type, lo, hi, whole: false };
}

function removedShapes(plan: TrimPlan): PreviewShape[] {
  const g = plan.curve, end = paramEnd(g);
  if (plan.whole) return g.kind === 'circle' ? [{ kind: 'circle', c: g.c, r: g.r }] : sample(g, 0, end).map((s) => ({ kind: 'line' as const, ...s }));
  const t0 = plan.lo?.t ?? 0;
  let t1 = plan.hi?.t ?? end;
  if (g.kind === 'circle' && t1 <= t0) t1 += TAU;
  return sample(g, t0, t1).map((s) => ({ kind: 'line' as const, ...s }));
}

const COPY_TO_PIECE = new Set(['horizontal', 'vertical', 'parallel', 'perpendicular', 'collinear']);
const DROP_ON_LINE = new Set(['equal', 'midpoint']);

export function trimAt(draft: SketchDraft, entityId: string, at: Pt): TrimRes {
  const plan = planTrim(draft, entityId, at);
  if (typeof plan === 'string') return { ok: false, hint: plan };
  const removed = removedShapes(plan);
  if (plan.whole) return { ok: true, draft: removeEntities(draft, [entityId]), removed };

  let d = draft;
  const ent = entityOf(d, entityId)!;
  const cutPoint = (c: Cut): string => {
    if (c.point) return c.point;
    const near = d.points.find((p) => dist(p, c.at) <= TOL);
    if (near) return near.id;
    // a tangent contact: the solver leaves the touching end of the cutter a hair off the exact contact, so a cut
    // there reuses that end (the pieces then join at one point) instead of adding a second point beside it
    const tangent = draft.constraints.some((k) => k.type === 'tangent' && k.refs?.includes(entityId) && k.refs.includes(c.cutter));
    if (tangent) {
      const cutter = entityOf(d, c.cutter);
      const end = cutter && [cutter.p1, cutter.p2].map(String).map((id) => d.points.find((p) => p.id === id)).find((p) => p && dist(p, c.at) <= TANGENT_END_TOL);
      if (end) return end.id;
    }
    const added = withPoint(d, c.at);
    d = added.draft;
    // at a tangent contact the cutter already touches this curve there, so a point-on-curve would repeat the tangent
    if (tangent) return added.id;
    d = withConstraint(d, c.cutterType === 'line' ? 'pointOnLine' : 'pointOnCircle', [added.id, c.cutter]);
    return added.id;
  };
  const candidates: string[] = [];

  if (plan.type === 'circle') {
    const hi = cutPoint(plan.hi!), lo = cutPoint(plan.lo!);
    d = replaceEntity(d, entityId, (e) => { const { r: _r, ...rest } = e; return { ...rest, type: 'arc', c: ent.c, p1: hi, p2: lo }; });
    return { ok: true, draft: pruneDangling(d), removed };
  }

  const oldP1 = String(ent.p1), oldP2 = String(ent.p2);
  const loId = plan.lo ? cutPoint(plan.lo) : undefined;
  const hiId = plan.hi ? cutPoint(plan.hi) : undefined;
  if (loId && hiId) {
    // split: original keeps [p1, lo]; a new entity takes [hi, p2]
    d = replaceEntity(d, entityId, (e) => ({ ...e, p2: loId }));
    const { id: _id, p1: _a, p2: _b, ...rest } = ent;
    const piece = withEntity(d, { ...rest, p1: hiId, p2: oldP2 });
    d = piece.draft;
    if (plan.type === 'line') {
      for (const k of draft.constraints) {
        if (!COPY_TO_PIECE.has(k.type) || !k.refs?.includes(entityId)) continue;
        d = withConstraint(d, k.type, k.refs.map((r) => (r === entityId ? piece.id : r)));
      }
    }
  } else if (loId) {
    d = replaceEntity(d, entityId, (e) => ({ ...e, p2: loId }));
    candidates.push(oldP2);
  } else if (hiId) {
    d = replaceEntity(d, entityId, (e) => ({ ...e, p1: hiId }));
    candidates.push(oldP1);
  }
  if (plan.type === 'line') {
    d = { ...d, constraints: d.constraints.filter((k: DraftConstraint) => !(DROP_ON_LINE.has(k.type) && k.refs?.includes(entityId))) };
  }
  return { ok: true, draft: dropOrphans(d, candidates), removed };
}

export interface TrimState { hover?: { entityId: string; at: Pt } }

export const trimTool: Tool<TrimState> = {
  id: 'trim',
  start: () => ({}),
  step(state, ev, draft): ToolOutput<TrimState> {
    switch (ev.type) {
      case 'move': {
        const id = ev.snap?.entityId;
        if (!id) return { state: {}, draft, preview: [], fields: [] };
        const at = ev.snap?.at ?? ev.at;
        const plan = planTrim(draft, id, at);
        if (typeof plan === 'string') return { state: {}, draft, preview: [], fields: [], hint: plan };
        return { state: { hover: { entityId: id, at } }, draft, preview: removedShapes(plan), fields: [] };
      }
      case 'click': {
        const id = ev.snap?.entityId;
        if (!id) return { state, draft, preview: [], fields: [], hint: 'app.sketch.hint.pickCurve' };
        const r = trimAt(draft, id, ev.snap?.at ?? ev.at);
        if (!r.ok) return { state, draft, preview: [], fields: [], hint: r.hint };
        return { state: {}, draft: r.draft, preview: [], fields: [] };
      }
      case 'key':
        return { state: {}, draft, preview: [], fields: [] };
      default:
        return { state, draft, preview: [], fields: [] };
    }
  },
};
