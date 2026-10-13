/**
 * Ellipse. Three stages: click the centre, click the end of the major axis, click (or type) the minor radius.
 *
 * Kernel convention (profile.rs / solver.rs, confirmed by a real-kernel test): entity `ellipse {c, p, r}` where
 * `c` is the centre point, `p` is a point at the END of the semi-major axis (so the semi-major length is |p - c|
 * and the axis direction is p - c) and `r` is the semi-MINOR length, a plain number measured perpendicular to
 * that axis. Typed major length (semi-major) becomes `distance refs=[c,p]`; typed minor radius becomes
 * `radius refs=[ellipseId]` (the solver treats an ellipse's `r` as its radius). A typed angle pins geometry only.
 * H/V snapping of the axis direction is applied to the geometry but writes no constraint (the axis has no line).
 */
import type { SketchDraft } from '../index';
import { addConstraintOf, addPoint } from './builders';
import { segmentEnd } from './geometry';
import { addEntity, applyLock, hasValues, polyline } from './shape-helpers';
import type { FieldSpec, Modifiers, Pt, Tool, ToolOutput, ToolSettings } from './types';

type Ref = { at: Pt; pointId?: string };
export interface EllipseState {
  centre?: Ref;
  /** Set once the major axis is placed (stage 3). `lenLock` is the typed semi-major length, if any. */
  axis?: { end: Ref; lenLock?: number };
  locked: { len?: number; ang?: number; r?: number };
  live: { len?: number; ang?: number; r?: number };
  cursor?: Pt;
  snapPoint?: { id: string; at: Pt };
  mods: Modifiers;
}

const NO_MODS: Modifiers = { shift: false, ctrl: false, alt: false };
const merged = (s: EllipseState) => ({ ...s.live, ...s.locked });
const fresh = (s: EllipseState): EllipseState => ({ locked: {}, live: {}, mods: s.mods, ...(s.cursor ? { cursor: s.cursor } : {}) });

function ellipsePoints(c: Pt, p: Pt, r: number, segs = 48): Pt[] {
  const ux = p.x - c.x, uy = p.y - c.y;
  const l = Math.hypot(ux, uy) || 1;
  const vx = (-uy / l) * r, vy = (ux / l) * r;
  const out: Pt[] = [];
  for (let i = 0; i < segs; i++) { const t = (2 * Math.PI * i) / segs; out.push({ x: c.x + ux * Math.cos(t) + vx * Math.sin(t), y: c.y + uy * Math.cos(t) + vy * Math.sin(t) }); }
  return out;
}

/** Semi-minor length from the pointer: its perpendicular distance to the major axis line. */
function minorOf(s: EllipseState): number {
  const m = merged(s);
  if (m.r !== undefined) return m.r;
  if (!s.centre || !s.axis || !s.cursor) return 0;
  const c = s.centre.at, p = s.axis.end.at;
  const l = Math.hypot(p.x - c.x, p.y - c.y) || 1;
  return Math.abs(((s.cursor.x - c.x) * (p.y - c.y) - (s.cursor.y - c.y) * (p.x - c.x)) / l);
}

function view(state: EllipseState, draft: SketchDraft, settings: ToolSettings, hint?: string): ToolOutput<EllipseState> {
  if (!state.centre || !state.cursor) return { state, draft, preview: [], fields: [], hint };
  const off = settings.onViewValues === 'off';
  if (!state.axis) {
    const m = merged(state);
    const r = segmentEnd(state.centre.at, state.cursor, state.mods, settings, { len: m.len, ang: m.ang }, state.snapPoint?.at);
    const fields: FieldSpec[] = off ? [] : [
      { id: 'len', label: 'app.sketch.field.majorRadius', value: r.len, locked: state.locked.len !== undefined, unit: 'length' },
      { id: 'ang', label: 'app.sketch.field.angle', value: r.ang, locked: state.locked.ang !== undefined, unit: 'angle' },
    ];
    return { state, draft, preview: [{ kind: 'line', a: state.centre.at, b: r.end }], fields, hint };
  }
  const r = minorOf(state);
  const fields: FieldSpec[] = off ? [] : [{ id: 'r', label: 'app.sketch.field.minorRadius', value: r, locked: state.locked.r !== undefined, unit: 'length' }];
  const preview = [{ kind: 'line' as const, a: state.centre.at, b: state.axis.end.at }, ...(r > 1e-9 ? polyline(ellipsePoints(state.centre.at, state.axis.end.at, r), true) : [])];
  return { state, draft, preview, fields, hint };
}

/** Stage 2 -> 3: fix the major axis end from the pointer and typed values. */
function placeAxis(state: EllipseState, draft: SketchDraft, settings: ToolSettings): ToolOutput<EllipseState> {
  const m = merged(state);
  const r = segmentEnd(state.centre!.at, state.cursor!, state.mods, settings, { len: m.len, ang: m.ang }, state.snapPoint?.at);
  if (r.len < 1e-9) return view(state, draft, settings, 'app.sketch.hint.degenerate');
  const pinned = state.locked.len !== undefined || state.locked.ang !== undefined;
  const pointId = pinned ? undefined : state.snapPoint?.id;
  if (pointId && pointId === state.centre!.pointId) return view(state, draft, settings, 'app.sketch.hint.degenerate');
  const axis = { end: { at: r.end, ...(pointId ? { pointId } : {}) }, ...(state.locked.len !== undefined ? { lenLock: state.locked.len } : {}) };
  return view({ ...state, axis, locked: {}, live: {}, snapPoint: undefined }, draft, settings);
}

function finish(state: EllipseState, draft: SketchDraft, settings: ToolSettings): ToolOutput<EllipseState> {
  const r = minorOf(state);
  if (!state.centre || !state.axis || r < 1e-9) return view(state, draft, settings, 'app.sketch.hint.degenerate');
  let d = draft;
  let c = state.centre.pointId;
  if (!c) { const a = addPoint(d, state.centre.at); d = a.draft; c = a.id; }
  let p = state.axis.end.pointId;
  if (!p) { const a = addPoint(d, state.axis.end.at); d = a.draft; p = a.id; }
  const e = addEntity(d, { type: 'ellipse', c, p, r });
  d = e.draft;
  if (state.axis.lenLock !== undefined) d = addConstraintOf(d, 'distance', [c, p], state.axis.lenLock);
  if (state.locked.r !== undefined) d = addConstraintOf(d, 'radius', [e.id], state.locked.r);
  return view(fresh(state), d, settings);
}

export const ellipseTool: Tool<EllipseState> = {
  id: 'ellipse',
  start: () => ({ locked: {}, live: {}, mods: NO_MODS }),
  step(state, ev, draft, settings) {
    switch (ev.type) {
      case 'move':
        return view({ ...state, cursor: ev.snap?.at ?? ev.at, mods: ev.mods, snapPoint: ev.snap?.pointId ? { id: ev.snap.pointId, at: ev.snap.at } : undefined }, draft, settings);
      case 'click': {
        const w: EllipseState = { ...state, cursor: ev.snap?.at ?? ev.at, mods: ev.mods, snapPoint: ev.snap?.pointId ? { id: ev.snap.pointId, at: ev.snap.at } : undefined };
        if (!state.centre) return view({ ...w, centre: { at: w.cursor!, ...(w.snapPoint ? { pointId: w.snapPoint.id } : {}) }, snapPoint: undefined }, draft, settings);
        if (!state.axis) return placeAxis(w, draft, settings);
        return finish(w, draft, settings);
      }
      case 'field': {
        if (!state.centre) return view(state, draft, settings);
        const stage2 = !state.axis;
        const key = stage2 ? (ev.id === 'len' ? 'len' : ev.id === 'ang' ? 'ang' : null) : (ev.id === 'r' ? 'r' : null);
        if (!key) return view(state, draft, settings);
        const next = { ...state, ...applyLock(state.locked, state.live, key, ev, key !== 'ang') };
        if (stage2 && ev.commit && next.locked.len !== undefined && next.locked.ang !== undefined && state.cursor) return placeAxis(next, draft, settings);
        if (!stage2 && ev.commit && next.locked.r !== undefined) return finish(next, draft, settings);
        return view(next, draft, settings);
      }
      case 'key': {
        if (ev.key !== 'Escape') return view(state, draft, settings);
        if (hasValues(state.locked, state.live)) return view({ ...state, locked: {}, live: {} }, draft, settings);
        return view({ locked: {}, live: {}, mods: state.mods }, draft, settings);
      }
    }
  },
};
