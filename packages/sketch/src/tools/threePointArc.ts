/**
 * Arc through three points. Click the start, click a point the arc passes through, click the end. The centre is
 * the circumcentre of the three points. Kernel arcs run counter-clockwise from `p1` to `p2` (solver `Arc`, checked
 * with an extruded profile in `arcs.kernel.test.ts`), so when start -> through -> end turns clockwise the entity is
 * stored as `arc {c, p1: end, p2: start}`: the same curve, listed in the kernel's direction. The through point is
 * not stored in the sketch (there is no on-curve constraint here); only start, end and the new centre are points,
 * and an existing point under the start or end click is reused.
 * Refused with a hint: collinear points (`app.sketch.hint.collinear`) and coincident points, which includes closing
 * on the first point (`app.sketch.hint.degenerate`). Escape drops the shape.
 */
import type { SketchDraft } from '../index';
import { addPoint } from './builders';
import { addArc, angleOf, arcPolyline, circumcircle, dist, sweepCcw, turnsCcw } from './builders-arcs';
import type { FieldSpec, Pt, Tool, ToolOutput, ToolSettings } from './types';

export interface ThreePointArcState {
  a?: { at: Pt; pointId?: string };
  through?: Pt;
  cursor?: Pt;
}

function view(state: ThreePointArcState, draft: SketchDraft, settings: ToolSettings, hint?: string): ToolOutput<ThreePointArcState> {
  const { a, through, cursor } = state;
  if (!a || !cursor) return { state, draft, preview: [], fields: [], hint };
  if (!through) return { state, draft, preview: [{ kind: 'line', a: a.at, b: cursor }], fields: [], hint };
  const circle = circumcircle(a.at, through, cursor);
  if (!circle) {
    const bad = dist(through, cursor) < 1e-9 || dist(a.at, cursor) < 1e-9 ? undefined : 'app.sketch.hint.collinear';
    return { state, draft, preview: [{ kind: 'line', a: a.at, b: through }, { kind: 'line', a: through, b: cursor }], fields: [], hint: hint ?? bad };
  }
  const ccw = turnsCcw(a.at, through, cursor);
  const [from, to] = ccw ? [a.at, cursor] : [cursor, a.at];
  const a0 = angleOf(circle.c, from);
  const fields: FieldSpec[] = settings.onViewValues === 'off' ? [] : [
    { id: 'radius', label: 'app.sketch.field.radius', value: circle.r, locked: false, unit: 'length' },
  ];
  return { state, draft, preview: arcPolyline(circle.c, circle.r, a0, sweepCcw(a0, angleOf(circle.c, to))), fields, hint };
}

export const threePointArcTool: Tool<ThreePointArcState> = {
  id: 'arc-three-point',
  start: () => ({}),
  step(state, ev, draft, settings) {
    switch (ev.type) {
      case 'move': return view({ ...state, cursor: ev.snap?.at ?? ev.at }, draft, settings);
      case 'click': {
        const at = ev.snap?.at ?? ev.at;
        const pointId = ev.snap?.pointId;
        const withCursor = { ...state, cursor: at };
        if (!state.a) return view({ ...withCursor, a: { at, ...(pointId ? { pointId } : {}) } }, draft, settings);
        if (!state.through) {
          if (dist(state.a.at, at) < 1e-9) return view(withCursor, draft, settings, 'app.sketch.hint.degenerate');
          return view({ ...withCursor, through: at }, draft, settings);
        }
        const a = state.a.at;
        if (dist(a, at) < 1e-9 || dist(state.through, at) < 1e-9) return view(withCursor, draft, settings, 'app.sketch.hint.degenerate');
        const circle = circumcircle(a, state.through, at);
        if (!circle) return view(withCursor, draft, settings, 'app.sketch.hint.collinear');
        let d = draft;
        let aid = state.a.pointId;
        if (!aid) { const p = addPoint(d, a); d = p.draft; aid = p.id; }
        let cid = pointId && pointId !== aid ? pointId : undefined;
        if (!cid) { const p = addPoint(d, at); d = p.draft; cid = p.id; }
        const centre = addPoint(d, circle.c);
        d = centre.draft;
        const ccw = turnsCcw(a, state.through, at);
        d = addArc(d, centre.id, ccw ? aid : cid, ccw ? cid : aid).draft;
        return view({ cursor: at }, d, settings);
      }
      case 'key': {
        if (ev.key !== 'Escape') return view(state, draft, settings);
        return view({}, draft, settings);
      }
      case 'field': return view(state, draft, settings);
    }
  },
};
