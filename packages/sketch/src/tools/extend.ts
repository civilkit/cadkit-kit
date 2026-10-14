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
        if (t > TOL && (!best || t < best.t)) best = { t, hit: { at: p, cutter: o.id, cutterType: String(o.type) } };
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
      if (d > TOL / g.r && d < gap - TOL / g.r && (!best || d < best.d)) best = { d, hit: { at: p, cutter: o.id, cutterType: String(o.type) } };
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

export type ExtendState = Record<string, never>;
const view = (draft: SketchDraft, hint?: string, preview: PreviewShape[] = []): ToolOutput<ExtendState> =>
  ({ state: {}, draft, preview, fields: [], ...(hint ? { hint } : {}) });

export const extendTool: Tool<ExtendState> = {
  id: 'extend',
  start: () => ({}),
  step(_state, ev, draft): ToolOutput<ExtendState> {
    switch (ev.type) {
      case 'move': {
        const id = ev.snap?.entityId;
        if (!id) return view(draft);
        const plan = planExtend(draft, id, ev.snap?.at ?? ev.at);
        return typeof plan === 'string' ? view(draft) : view(draft, undefined, plan.added);
      }
      case 'click': {
        const id = ev.snap?.entityId;
        if (!id) return view(draft, 'app.sketch.hint.pickExtendable');
        const r = extendAt(draft, id, ev.snap?.at ?? ev.at);
        return r.ok ? view(r.draft) : view(draft, r.hint);
      }
      default:
        return view(draft);
    }
  },
};

