/**
 * Tangent arc. Click an existing end point (snap.pointId) where exactly one line or arc ends; that shape fixes the
 * direction. Then click the arc's end: the centre lies on the normal to that direction through the start, equally
 * far from both ends. The result is `arc {c, p1, p2}` in the kernel's counter-clockwise direction (the ends swap
 * when the arc bends to the right of the travel direction) plus a `tangent` constraint.
 *
 * Kernel convention (solver.rs `tangent`, confirmed by real-kernel regeneration in `arcs.kernel.test.ts`):
 * constraint `tangent` has refs `[entityId, entityId]` (the two curves, here the existing shape then the new arc)
 * and the shared end point is auto-detected; we also write `at: pointId` to name it. For line + arc it demands
 * (line direction) perpendicular to (shared point - arc centre); for arc + arc, the two centres and the shared
 * point collinear. Coincidence comes from sharing the point id, so no `coincident` is added.
 *
 * Refused with hints: a start that is not the single free end of a line or arc (`app.sketch.hint.tangentStart`), an
 * end straight along the tangent line, which would be an infinite radius (`app.sketch.hint.tangentAligned`), and
 * an end on the start (`app.sketch.hint.degenerate`). After an arc is placed the chain continues from its end,
 * tangent to it; Escape ends the chain.
 */
import type { DraftEntity, SketchDraft } from '../index';
import { addPoint, pointOf } from './builders';
import { addArc, addTangent, angleOf, arcPolyline, ccwTangent, dist, ownersAt, sweepCcw } from './builders-arcs';
import type { FieldSpec, Pt, Tool, ToolOutput, ToolSettings } from './types';

export interface TangentArcState {
  from?: { pointId: string; at: Pt; dir: Pt; entityId: string };
  cursor?: Pt;
}

/** Unit direction of travel leaving `pointId` along the continuation of `owner`. */
function leaving(draft: SketchDraft, owner: DraftEntity, pointId: string): Pt {
  const p = pointOf(draft, pointId);
  if (owner.type === 'line') {
    const other = pointOf(draft, (owner.p1 === pointId ? owner.p2 : owner.p1) as string);
    const l = dist(other, p);
    return { x: (p.x - other.x) / l, y: (p.y - other.y) / l };
  }
  const t = ccwTangent(pointOf(draft, owner.c as string), p);
  // the arc runs ccw p1 -> p2: leaving past p2 continues ccw, leaving past p1 continues clockwise
  return owner.p2 === pointId ? t : { x: -t.x, y: -t.y };
}

interface Solved { c: Pt; r: number; left: boolean }
function solve(from: NonNullable<TangentArcState['from']>, e: Pt): Solved | 'degenerate' | 'aligned' {
  const w = { x: e.x - from.at.x, y: e.y - from.at.y };
  const len = Math.hypot(w.x, w.y);
  if (len < 1e-9) return 'degenerate';
  const n = { x: -from.dir.y, y: from.dir.x };
  const nw = n.x * w.x + n.y * w.y;
  if (Math.abs(nw) / len < 1e-9) return 'aligned';
  const t = (len * len) / (2 * nw);
  return { c: { x: from.at.x + n.x * t, y: from.at.y + n.y * t }, r: Math.abs(t), left: t > 0 };
}

function view(state: TangentArcState, draft: SketchDraft, settings: ToolSettings, hint?: string): ToolOutput<TangentArcState> {
  const { from, cursor } = state;
  if (!from || !cursor) return { state, draft, preview: [], fields: [], hint };
  const s = solve(from, cursor);
  if (s === 'degenerate' || s === 'aligned') return { state, draft, preview: [{ kind: 'line', a: from.at, b: cursor }], fields: [], hint: hint ?? (s === 'aligned' ? 'app.sketch.hint.tangentAligned' : undefined) };
  const [p, q] = s.left ? [from.at, cursor] : [cursor, from.at];
  const a0 = angleOf(s.c, p);
  const fields: FieldSpec[] = settings.onViewValues === 'off' ? [] : [
    { id: 'radius', label: 'app.sketch.field.radius', value: s.r, locked: false, unit: 'length' },
  ];
  return { state, draft, preview: arcPolyline(s.c, s.r, a0, sweepCcw(a0, angleOf(s.c, q))), fields, hint, pending: ['tangent'] };
}

export const tangentArcTool: Tool<TangentArcState> = {
  id: 'arc-tangent',
  start: () => ({}),
  step(state, ev, draft, settings) {
    switch (ev.type) {
      case 'move': return view({ ...state, cursor: ev.snap?.at ?? ev.at }, draft, settings);
      case 'click': {
        const at = ev.snap?.at ?? ev.at;
        const pointId = ev.snap?.pointId;
        if (!state.from) {
          const owners = pointId ? ownersAt(draft, pointId) : [];
          if (!pointId || owners.length !== 1) return view({ ...state, cursor: at }, draft, settings, 'app.sketch.hint.tangentStart');
          const owner = owners[0];
          return view({ cursor: at, from: { pointId, at: pointOf(draft, pointId), dir: leaving(draft, owner, pointId), entityId: owner.id } }, draft, settings);
        }
        const s = solve(state.from, at);
        if (s === 'degenerate') return view({ ...state, cursor: at }, draft, settings, 'app.sketch.hint.degenerate');
        if (s === 'aligned') return view({ ...state, cursor: at }, draft, settings, 'app.sketch.hint.tangentAligned');
        let d = draft;
        let eid = pointId && pointId !== state.from.pointId ? pointId : undefined;
        if (!eid) { const p = addPoint(d, at); d = p.draft; eid = p.id; }
        const centre = addPoint(d, s.c);
        d = centre.draft;
        const arc = addArc(d, centre.id, s.left ? state.from.pointId : eid, s.left ? eid : state.from.pointId);
        d = addTangent(arc.draft, state.from.entityId, arc.id, state.from.pointId);
        const t = ccwTangent(s.c, at);
        const dir = s.left ? t : { x: -t.x, y: -t.y };
        return view({ cursor: at, from: { pointId: eid, at, dir, entityId: arc.id } }, d, settings);
      }
      case 'key': {
        if (ev.key !== 'Escape') return view(state, draft, settings);
        return view({}, draft, settings);
      }
      case 'field': return view(state, draft, settings);
    }
  },
};
