/**
 * Arc by centre point. Click the centre, click the start (this sets the radius), click the end. The end is the
 * pointer's direction projected onto the circle, and the arc always runs counter-clockwise from start to end
 * (the kernel's only arc direction), so sweeping the pointer clockwise draws the larger remaining arc.
 * Entity `arc {c, p1: start, p2: end}`. A typed radius (field `radius`, commit with Tab or Enter) is accepted
 * while placing the start: it pins the start at that distance in the pointer's direction and writes a `radius`
 * constraint `refs [arcId]` (the radius of an arc is |c-p1|). Existing points are reused for the centre, the start
 * and the end (the end only when it already lies on the circle). A zero radius or an end on the start is refused
 * with `app.sketch.hint.degenerate`. Escape clears the typed radius, then steps back to nothing.
 */
import type { SketchDraft } from '../index';
import { addPoint } from './builders';
import { addArc, addSizeConstraint, angleOf, arcPolyline, dist, sweepCcw } from './builders-arcs';
import type { FieldSpec, Pt, Tool, ToolOutput, ToolSettings } from './types';

export interface CentreArcState {
  centre?: { at: Pt; pointId?: string };
  start?: { at: Pt; pointId?: string };
  lockedR?: number;
  liveR?: number;
  cursor?: Pt;
}

const along = (c: Pt, toward: Pt, r: number): Pt => {
  const l = dist(c, toward);
  const u = l > 1e-12 ? { x: (toward.x - c.x) / l, y: (toward.y - c.y) / l } : { x: 1, y: 0 };
  return { x: c.x + u.x * r, y: c.y + u.y * r };
};

/** The start point that a click would place right now. */
function startNow(s: CentreArcState): { at: Pt; pointId?: string } | null {
  if (!s.centre || !s.cursor) return null;
  const typed = s.lockedR ?? s.liveR;
  if (typed !== undefined) return { at: along(s.centre.at, s.cursor, typed) };
  return { at: s.cursor };
}

function view(state: CentreArcState, draft: SketchDraft, settings: ToolSettings, hint?: string): ToolOutput<CentreArcState> {
  if (!state.centre || !state.cursor) return { state, draft, preview: [], fields: [], hint };
  const c = state.centre.at;
  const s = state.start ?? startNow(state);
  if (!s) return { state, draft, preview: [], fields: [], hint };
  const r = dist(c, s.at);
  const fields: FieldSpec[] = settings.onViewValues === 'off' ? [] : [
    { id: 'radius', label: 'app.sketch.field.radius', value: r, locked: state.lockedR !== undefined, unit: 'length' },
  ];
  const preview: ToolOutput<CentreArcState>['preview'] = [{ kind: 'line', a: c, b: s.at }];
  if (state.start && r > 1e-9) {
    const a0 = angleOf(c, state.start.at);
    const end = along(c, state.cursor, r);
    preview.push(...arcPolyline(c, r, a0, sweepCcw(a0, angleOf(c, end))), { kind: 'line', a: c, b: end });
  }
  return { state, draft, preview, fields, hint };
}

function finish(state: CentreArcState, draft: SketchDraft, settings: ToolSettings, ev?: { pointId?: string; at: Pt }): ToolOutput<CentreArcState> {
  const c = state.centre!.at;
  const start = state.start!;
  const r = dist(c, start.at);
  const end = along(c, state.cursor!, r);
  const sweep = sweepCcw(angleOf(c, start.at), angleOf(c, end));
  if (r < 1e-9 || sweep < 1e-9 || sweep > Math.PI * 2 - 1e-9) return view(state, draft, settings, 'app.sketch.hint.degenerate');
  let d = draft;
  let cid = state.centre!.pointId;
  if (!cid) { const a = addPoint(d, c); d = a.draft; cid = a.id; }
  let sid = start.pointId;
  if (!sid) { const a = addPoint(d, start.at); d = a.draft; sid = a.id; }
  let eid = ev?.pointId;
  const onCircle = eid !== undefined && ev !== undefined && Math.abs(dist(c, ev.at) - r) <= 1e-6 * Math.max(1, r);
  if (!eid || !onCircle || eid === sid || eid === cid) { const a = addPoint(d, end); d = a.draft; eid = a.id; }
  const arc = addArc(d, cid, sid, eid);
  d = arc.draft;
  if (state.lockedR !== undefined) d = addSizeConstraint(d, 'radius', arc.id, state.lockedR);
  return view({ ...(state.cursor ? { cursor: state.cursor } : {}) }, d, settings);
}

export const centreArcTool: Tool<CentreArcState> = {
  id: 'arc-centre',
  start: () => ({}),
  step(state, ev, draft, settings) {
    switch (ev.type) {
      case 'move': return view({ ...state, cursor: ev.snap?.at ?? ev.at }, draft, settings);
      case 'click': {
        const at = ev.snap?.at ?? ev.at;
        const withCursor = { ...state, cursor: at };
        if (!state.centre) return view({ ...withCursor, centre: { at, ...(ev.snap?.pointId ? { pointId: ev.snap.pointId } : {}) } }, draft, settings);
        if (!state.start) {
          const s = startNow(withCursor)!;
          if (dist(state.centre.at, s.at) < 1e-9) return view(withCursor, draft, settings, 'app.sketch.hint.degenerate');
          const pointId = state.lockedR === undefined && ev.snap?.pointId && ev.snap.pointId !== state.centre.pointId ? ev.snap.pointId : undefined;
          return view({ ...withCursor, start: { at: s.at, ...(pointId ? { pointId } : {}) }, liveR: undefined }, draft, settings);
        }
        return finish(withCursor, draft, settings, { at, ...(ev.snap?.pointId ? { pointId: ev.snap.pointId } : {}) });
      }
      case 'field': {
        if (ev.id !== 'radius' || !state.centre || state.start) return view(state, draft, settings);
        if (ev.value === null || !Number.isFinite(ev.value) || ev.value <= 0) return view({ ...state, lockedR: undefined, liveR: undefined }, draft, settings);
        if (ev.commit) {
          // locking the radius fixes the start in the pointer's direction; the end is still to be placed
          const next = { ...state, lockedR: ev.value, liveR: undefined };
          const s = startNow(next);
          return view(s ? { ...next, start: { at: s.at } } : next, draft, settings);
        }
        return view({ ...state, liveR: ev.value }, draft, settings);
      }
      case 'key': {
        if (ev.key !== 'Escape') return view(state, draft, settings);
        if (state.lockedR !== undefined || state.liveR !== undefined) return view({ ...state, lockedR: undefined, liveR: undefined, start: undefined }, draft, settings);
        return view({}, draft, settings);
      }
    }
  },
};
