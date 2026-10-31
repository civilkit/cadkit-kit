/**
 * Extend (the counterpart of Trim). Click a line or arc near the end you want to lengthen: that end is carried on, in
 * the direction the curve already runs (a line straight on, an arc round its own circle), to the nearest boundary: the
 * first place it meets another line, arc or circle of the sketch. Hovering previews the piece that would be added.
 * A circle cannot be extended; with nothing ahead the click says so (`nothingToExtend`).
 *
 * Edit rules (the mirror image of trim.ts):
 *  - the new end: an existing sketch point within 1e-7 of the meeting place is reused (so a closed outline closes with a
 *    shared point); otherwise a new point is added and bound to the boundary with `pointOnLine [point, lineId]` or
 *    `pointOnCircle [point, circleOrArcId]` (refs convention from solver.rs, the same as trim);
 *  - only that end of the entity is re-pointed; the old end point is removed when nothing else uses it, and constraints
 *    that referenced it go with it (`pruneDangling`). A point shared with another entity stays where it is;
 *  - `equal` and `midpoint` on an extended line are dropped (its length changed); horizontal / vertical / parallel /
 *    perpendicular / collinear stay true because the direction does not change; an arc keeps its centre and radius, so
 *    `radius` / `diameter` / `equal` between arcs stay valid;
 *  - an arc is never extended past its own other end (the gap is the limit).
 * Splines and ellipses are neither extended nor used as boundaries.
 *
 * Two curves (`extendToMeet`; Shift-click one then another in the tool): both are carried on, each along its own line
 * or circle, to where the two cross, and their grown ends become one shared point. Where two crossings are possible
 * the one needing the least total growth wins (equal growth is refused); a curve that already reaches the point stays.
 * Refused, nothing changed: parallel or collinear lines, curves that never meet, a crossing on a curve's body or behind
 * its chosen end (growing would shorten it), the same curve twice, splines / ellipses / circles.
 */
import type { DraftConstraint, SketchDraft } from '../index';
import { angleOf, arcSweep, dist, dot, intersect, sample, scale, sub, add, TAU, TOL, wrap, type ArcG, type CurveG } from './edit-geom';
import { curveOf, dropOrphans, entityOf, pruneDangling, replaceEntity, withConstraint, withPoint } from './edit-draft';
import type { Pt, PreviewShape, Tool, ToolOutput } from './types';

interface Hit { at: Pt; cutter: string; cutterType: string }
export interface ExtendPlan {
  entityId: string;
  /** which end moves: 'p1' or 'p2' */
  end: 'p1' | 'p2';
  to: Hit;
  /** the piece that is added, as preview shapes */
  added: PreviewShape[];
}
export type ExtendRes = { ok: true; draft: SketchDraft; added: PreviewShape[] } | { ok: false; hint: string };

const FAR = 1e6;
/** A crossing nearer than this to the growing end is that end (a touch within rounding), not a place to grow to. */
const END_TOL = TOL * 10;

function sizeOf(draft: SketchDraft): number {
  if (!draft.points.length) return 1;
  const xs = draft.points.map((p) => p.x), ys = draft.points.map((p) => p.y);
  return Math.max(1, Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)));
}

/** Plan the extension of the end of `entityId` nearest `at`. A string is the hint key of why not. */
export function planExtend(draft: SketchDraft, entityId: string, at: Pt): ExtendPlan | string {
  const e = entityOf(draft, entityId);
  const g = e ? curveOf(draft, e) : null;
  if (!e || !g || g.kind === 'circle') return 'app.sketch.hint.pickExtendable';
  const others = draft.entities.filter((o) => o.id !== entityId).map((o) => ({ o, g: curveOf(draft, o) })).filter((x): x is { o: typeof x.o; g: CurveG } => !!x.g);

  if (g.kind === 'line') {
    const toA = dist(at, g.a), toB = dist(at, g.b);
    const end: 'p1' | 'p2' = toB < toA ? 'p2' : 'p1';
    const from = end === 'p2' ? g.b : g.a, back = end === 'p2' ? g.a : g.b;
    const l = dist(from, back);
    if (l < TOL) return 'app.sketch.hint.degenerate';
    const u = scale(sub(from, back), 1 / l);
    const ray: CurveG = { kind: 'line', a: from, b: add(from, scale(u, FAR * sizeOf(draft))) };
    let best: { t: number; hit: Hit } | null = null;
    for (const { o, g: og } of others) {
      for (const p of intersect(ray, og)) {
        const t = dot(sub(p, from), u);
        if (t > END_TOL && (!best || t < best.t)) best = { t, hit: { at: p, cutter: o.id, cutterType: String(o.type) } };
      }
    }
    if (!best) return 'app.sketch.hint.nothingToExtend';
    return { entityId, end, to: best.hit, added: [{ kind: 'line', a: from, b: best.hit.at }] };
  }

  // arc: carry an end on round its own circle, towards the uncovered side
  const sweep = arcSweep(g);
  const gap = TAU - sweep;
  if (gap < 1e-9) return 'app.sketch.hint.nothingToExtend';
  const a1 = angleOf(sub(g.p1, g.c)), a2 = angleOf(sub(g.p2, g.c));
  const atAngle = angleOf(sub(at, g.c));
  // nearer end by angle: past the middle of the arc towards p2 means p2
  const along = wrap(atAngle - a1);
  const end: 'p1' | 'p2' = along > sweep ? (along - sweep < TAU - along ? 'p2' : 'p1') : (along > sweep / 2 ? 'p2' : 'p1');
  const circle: CurveG = { kind: 'circle', c: g.c, r: g.r };
  let best: { d: number; hit: Hit } | null = null;
  for (const { o, g: og } of others) {
    for (const p of intersect(circle, og)) {
      const a = angleOf(sub(p, g.c));
      const d = end === 'p2' ? wrap(a - a2) : wrap(a1 - a);
      if (d > END_TOL / g.r && d < gap - END_TOL / g.r && (!best || d < best.d)) best = { d, hit: { at: p, cutter: o.id, cutterType: String(o.type) } };
    }
  }
  if (!best) return 'app.sketch.hint.nothingToExtend';
  const piece: ArcG = end === 'p2' ? { kind: 'arc', c: g.c, r: g.r, p1: g.p2, p2: best.hit.at } : { kind: 'arc', c: g.c, r: g.r, p1: best.hit.at, p2: g.p1 };
  const added = sample(piece, 0, arcSweep(piece)).map((s) => ({ kind: 'line' as const, ...s }));
  return { entityId, end, to: best.hit, added };
}

const DROP_ON_LINE = new Set(['equal', 'midpoint']);

export function extendAt(draft: SketchDraft, entityId: string, at: Pt): ExtendRes {
  const plan = planExtend(draft, entityId, at);
  if (typeof plan === 'string') return { ok: false, hint: plan };
  let d = draft;
  const ent = entityOf(d, entityId)!;
  const oldEnd = String(ent[plan.end]);
  let pid: string;
  const near = d.points.find((p) => dist(p, plan.to.at) <= TOL);
  if (near) pid = near.id;
  else {
    const added = withPoint(d, plan.to.at);
    d = added.draft; pid = added.id;
    d = withConstraint(d, plan.to.cutterType === 'line' ? 'pointOnLine' : 'pointOnCircle', [pid, plan.to.cutter]);
  }
  d = replaceEntity(d, entityId, (x) => ({ ...x, [plan.end]: pid }));
  if (ent.type === 'line') d = { ...d, constraints: d.constraints.filter((k: DraftConstraint) => !(DROP_ON_LINE.has(k.type) && k.refs?.includes(entityId))) };
  d = dropOrphans(d, [oldEnd]);
  return { ok: true, draft: pruneDangling(d), added: plan.added };
}

/** How far the end `end` of a line or arc must grow to reach `m` (a place on its carrier), or null when m is on its body or behind that end. */
function growthTo(g: CurveG, end: 'p1' | 'p2', m: Pt): number | null {
  if (g.kind === 'line') {
    const from = end === 'p2' ? g.b : g.a, back = end === 'p2' ? g.a : g.b;
    const l = dist(from, back);
    if (l < TOL) return null;
    const t = dot(sub(m, from), scale(sub(from, back), 1 / l));
    return t < -END_TOL ? null : Math.max(t, 0);
  }
  if (g.kind !== 'arc') return null;
  const gap = TAU - arcSweep(g);
  const a = angleOf(sub(m, g.c));
  let d = end === 'p2' ? wrap(a - angleOf(sub(g.p2, g.c))) : wrap(angleOf(sub(g.p1, g.c)) - a);
  const tol = END_TOL / g.r;
  if (d > TAU - tol) d = 0;
  return d <= gap - tol || d <= tol ? d * g.r : null;
}

const ends = ['p1', 'p2'] as const;
/** The piece a curve gains when its end `end` grows to `m`, as preview shapes. */
function pieceTo(g: CurveG, end: 'p1' | 'p2', m: Pt): PreviewShape[] {
  if (g.kind === 'line') return [{ kind: 'line', a: end === 'p2' ? g.b : g.a, b: m }];
  if (g.kind !== 'arc') return [];
  const piece: ArcG = end === 'p2' ? { kind: 'arc', c: g.c, r: g.r, p1: g.p2, p2: m } : { kind: 'arc', c: g.c, r: g.r, p1: m, p2: g.p1 };
  return sample(piece, 0, arcSweep(piece)).map((s) => ({ kind: 'line' as const, ...s }));
}

/**
 * Extend two lines / arcs to where they meet. `atA` / `atB` name the end of each to grow (the end nearer that place);
 * without them the end that reaches the meeting point by growing is used. One edit, shared point where they join.
 */
export function extendToMeet(draft: SketchDraft, aId: string, bId: string, atA?: Pt, atB?: Pt): ExtendRes {
  if (aId === bId) return { ok: false, hint: 'app.sketch.hint.pickOtherCurve' };
  const ea = entityOf(draft, aId), eb = entityOf(draft, bId);
  const ga = ea ? curveOf(draft, ea) : null, gb = eb ? curveOf(draft, eb) : null;
  if (!ea || !eb || !ga || !gb || ga.kind === 'circle' || gb.kind === 'circle') return { ok: false, hint: 'app.sketch.hint.pickExtendable' };
  const far = FAR * sizeOf(draft);
  const carrier = (g: CurveG): CurveG => {
    if (g.kind !== 'line') return g.kind === 'arc' ? { kind: 'circle', c: g.c, r: g.r } : g;
    const l = dist(g.a, g.b);
    if (l < TOL) return g;
    const u = scale(sub(g.b, g.a), 1 / l);
    return { kind: 'line', a: sub(g.a, scale(u, far)), b: add(g.b, scale(u, far)) };
  };
  const meets = intersect(carrier(ga), carrier(gb));
  if (!meets.length) return { ok: false, hint: ga.kind === 'line' && gb.kind === 'line' ? 'app.sketch.hint.parallel.more' : 'app.sketch.hint.noMeet' };
  const nearEnd = (g: CurveG, at: Pt): 'p1' | 'p2' => {
    if (g.kind === 'line') return dist(at, g.b) < dist(at, g.a) ? 'p2' : 'p1';
    if (g.kind !== 'arc') return 'p1';
    return dist(at, g.p2) < dist(at, g.p1) ? 'p2' : 'p1';
  };
  const choices = (g: CurveG, m: Pt, at?: Pt) => (at ? [nearEnd(g, at)] : [...ends]).map((end) => ({ end, grow: growthTo(g, end, m) })).filter((x): x is { end: 'p1' | 'p2'; grow: number } => x.grow !== null).sort((x, y) => x.grow - y.grow)[0];
  const cands = meets.map((m) => ({ m, a: choices(ga, m, atA), b: choices(gb, m, atB) })).filter((c) => c.a && c.b)
    .map((c) => ({ m: c.m, a: c.a!, b: c.b!, cost: c.a!.grow + c.b!.grow })).sort((x, y) => x.cost - y.cost);
  if (!cands.length) return { ok: false, hint: 'app.sketch.hint.meetBehind' };
  if (cands.length > 1 && cands[1].cost - cands[0].cost <= END_TOL) return { ok: false, hint: 'app.sketch.hint.meetAmbiguous' };
  const { m, a, b } = cands[0];
  const reachA = a.grow <= END_TOL, reachB = b.grow <= END_TOL;
  if (reachA && reachB) return { ok: false, hint: 'app.sketch.hint.nothingToExtend' };
  let d = draft;
  // the joint: an end that already reaches the meeting point, else a point already there, else a new one
  let pid: string;
  if (reachA) pid = String(ea[a.end]);
  else if (reachB) pid = String(eb[b.end]);
  else {
    const near = d.points.find((p) => dist(p, m) <= TOL);
    if (near) pid = near.id;
    else { const w = withPoint(d, m); d = w.draft; pid = w.id; }
  }
  const old: string[] = [];
  for (const [id, ent, pick, reach] of [[aId, ea, a, reachA], [bId, eb, b, reachB]] as const) {
    if (reach && String(ent[pick.end]) === pid) continue;
    old.push(String(ent[pick.end]));
    d = replaceEntity(d, id, (x) => ({ ...x, [pick.end]: pid }));
    if (ent.type === 'line') d = { ...d, constraints: d.constraints.filter((k: DraftConstraint) => !(DROP_ON_LINE.has(k.type) && k.refs?.includes(id))) };
  }
  d = dropOrphans(d, old);
  return { ok: true, draft: pruneDangling(d), added: [...(reachA ? [] : pieceTo(ga, a.end, m)), ...(reachB ? [] : pieceTo(gb, b.end, m))] };
}

export interface ExtendState { first?: { id: string; at: Pt } }
const view = (draft: SketchDraft, state: ExtendState = {}, hint?: string, preview: PreviewShape[] = []): ToolOutput<ExtendState> =>
  ({ state, draft, preview, fields: [], ...(hint ? { hint } : {}) });

export const extendTool: Tool<ExtendState> = {
  id: 'extend',
  start: () => ({}),
  step(state, ev, draft): ToolOutput<ExtendState> {
    switch (ev.type) {
      case 'move': {
        const id = ev.snap?.entityId;
        if (!id) return view(draft, state, state.first ? 'app.sketch.hint.pickSecondCurve' : undefined);
        const at = ev.snap?.at ?? ev.at;
        if (state.first) {
          const r = id === state.first.id ? null : extendToMeet(draft, state.first.id, id, state.first.at, at);
          return view(draft, state, r && !r.ok ? r.hint : 'app.sketch.hint.pickSecondCurve', r && r.ok ? r.added : []);
        }
        const plan = planExtend(draft, id, at);
        return typeof plan === 'string' ? view(draft) : view(draft, state, undefined, plan.added);
      }
      case 'click': {
        const id = ev.snap?.entityId;
        const at = ev.snap?.at ?? ev.at;
        if (!id) return view(draft, ev.mods.shift ? state : {}, 'app.sketch.hint.pickExtendable');
        // Shift-click one curve then another: both grow to where they meet
        if (ev.mods.shift) {
          if (!state.first) return view(draft, { first: { id, at } }, 'app.sketch.hint.pickSecondCurve');
          const r = extendToMeet(draft, state.first.id, id, state.first.at, at);
          return r.ok ? view(r.draft) : view(draft, state, r.hint);
        }
        const r = extendAt(draft, id, at);
        return r.ok ? view(r.draft) : view(draft, {}, r.hint);
      }
      case 'key':
        return view(draft, ev.key === 'Escape' ? {} : state);
      default:
        return view(draft, state);
    }
  },
};
