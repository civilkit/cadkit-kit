/**
 * Straight slot. Click the first centre, click the second centre, then click (or type) the width: the pointer's
 * perpendicular distance from the centre line is the half width. Typed length (centre to centre) becomes a `distance`
 * constraint on the two centres, typed width a `distance` between the two end points of the first arc (its diameter);
 * a typed angle pins geometry only. If the centre line is inferred horizontal or vertical, both straight sides get
 * that constraint.
 *
 * Shape: two lines and two arcs in one closed loop, sharing six points (two centres, four side points).
 * Kernel conventions (solver.rs, profile.rs; confirmed by the real-kernel test): `arc {c, p1, p2}` runs
 * COUNTER-CLOCKWISE about `c` from `p1` to `p2` (sweep in (0, 2pi]), and the solver adds its own |c-p1| = |c-p2|
 * equation. With d the unit centre direction and n = d rotated +90 degrees: the end arc at centre 2 runs from
 * (c2 - n h) to (c2 + n h) (bulging along +d) and the end arc at centre 1 from (c1 + n h) to (c1 - n h) (bulging along -d).
 * Tangency between lines and arcs is not constrained (the tangent refs convention was not verified).
 */
import type { SketchDraft } from '../index';
import { addConstraintOf, addLine, addPoint } from './builders';
import { segmentEnd } from './geometry';
import { addArc, applyLock, arcPoints, hasValues, polyline } from './shape-helpers';
import type { FieldSpec, Modifiers, Pt, PreviewShape, Tool, ToolOutput, ToolSettings } from './types';

type Ref = { at: Pt; pointId?: string };
export interface SlotState {
  c1?: Ref;
  /** Set once the second centre is placed (width stage). */
  c2?: Ref & { infer?: 'horizontal' | 'vertical'; lenLock?: number };
  locked: { len?: number; ang?: number; w?: number };
  live: { len?: number; ang?: number; w?: number };
  cursor?: Pt;
  snapPoint?: { id: string; at: Pt };
  mods: Modifiers;
}

const NO_MODS: Modifiers = { shift: false, ctrl: false, alt: false };
const merged = (s: SlotState) => ({ ...s.live, ...s.locked });
const fresh = (s: SlotState): SlotState => ({ locked: {}, live: {}, mods: s.mods, ...(s.cursor ? { cursor: s.cursor } : {}) });

/** Full width: the typed width, else twice the pointer's perpendicular distance to the centre line. */
function widthOf(s: SlotState): number {
  const m = merged(s);
  if (m.w !== undefined) return m.w;
  if (!s.c1 || !s.c2 || !s.cursor) return 0;
  const a = s.c1.at, b = s.c2.at;
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return 2 * Math.abs(((s.cursor.x - a.x) * (b.y - a.y) - (s.cursor.y - a.y) * (b.x - a.x)) / l);
}

interface Geo { a1: Pt; b1: Pt; a2: Pt; b2: Pt; ang: number; h: number }
function geometry(c1: Pt, c2: Pt, width: number): Geo {
  const L = Math.hypot(c2.x - c1.x, c2.y - c1.y);
  const dx = (c2.x - c1.x) / L, dy = (c2.y - c1.y) / L;
  const h = width / 2;
  const nx = -dy * h, ny = dx * h;
  return {
    a1: { x: c1.x + nx, y: c1.y + ny }, b1: { x: c1.x - nx, y: c1.y - ny },
    a2: { x: c2.x + nx, y: c2.y + ny }, b2: { x: c2.x - nx, y: c2.y - ny },
    ang: Math.atan2(dy, dx), h,
  };
}

function outline(c1: Pt, c2: Pt, width: number): PreviewShape[] {
  const g = geometry(c1, c2, width);
  const cap2 = arcPoints(c2, g.h, g.ang - Math.PI / 2, Math.PI);
  const cap1 = arcPoints(c1, g.h, g.ang + Math.PI / 2, Math.PI);
  return polyline([...cap2, ...cap1], true);
}

function view(state: SlotState, draft: SketchDraft, settings: ToolSettings, hint?: string): ToolOutput<SlotState> {
  if (!state.c1 || !state.cursor) return { state, draft, preview: [], fields: [], hint };
  const off = settings.onViewValues === 'off';
  if (!state.c2) {
    const m = merged(state);
    const r = segmentEnd(state.c1.at, state.cursor, state.mods, settings, { len: m.len, ang: m.ang }, state.snapPoint?.at);
    const fields: FieldSpec[] = off ? [] : [
      { id: 'len', label: 'app.sketch.field.length', value: r.len, locked: state.locked.len !== undefined, unit: 'length' },
      { id: 'ang', label: 'app.sketch.field.angle', value: r.ang, locked: state.locked.ang !== undefined, unit: 'angle' },
    ];
    return { state, draft, preview: [{ kind: 'line', a: state.c1.at, b: r.end }], fields, hint, ...(r.infer ? { pending: [r.infer] } : {}) };
  }
  const w = widthOf(state);
  const fields: FieldSpec[] = off ? [] : [{ id: 'w', label: 'app.sketch.field.width', value: w, locked: state.locked.w !== undefined, unit: 'length' }];
  const preview = w > 1e-9 ? outline(state.c1.at, state.c2.at, w) : [{ kind: 'line' as const, a: state.c1.at, b: state.c2.at }];
  return { state, draft, preview, fields, hint };
}

function placeSecond(state: SlotState, draft: SketchDraft, settings: ToolSettings): ToolOutput<SlotState> {
  const m = merged(state);
  const r = segmentEnd(state.c1!.at, state.cursor!, state.mods, settings, { len: m.len, ang: m.ang }, state.snapPoint?.at);
  if (r.len < 1e-9) return view(state, draft, settings, 'app.sketch.hint.degenerate');
  const pinned = state.locked.len !== undefined || state.locked.ang !== undefined;
  const pointId = pinned ? undefined : state.snapPoint?.id;
  if (pointId && pointId === state.c1!.pointId) return view(state, draft, settings, 'app.sketch.hint.degenerate');
  const c2 = {
    at: r.end, ...(pointId ? { pointId } : {}),
    ...(r.infer ? { infer: r.infer } : {}), ...(state.locked.len !== undefined ? { lenLock: state.locked.len } : {}),
  };
  return view({ ...state, c2, locked: {}, live: {}, snapPoint: undefined }, draft, settings);
}

function finish(state: SlotState, draft: SketchDraft, settings: ToolSettings): ToolOutput<SlotState> {
  const w = widthOf(state);
  if (!state.c1 || !state.c2 || w < 1e-9) return view(state, draft, settings, 'app.sketch.hint.degenerate');
  const g = geometry(state.c1.at, state.c2.at, w);
  let d = draft;
  const add = (at: Pt, existing?: string) => { if (existing) return existing; const a = addPoint(d, at); d = a.draft; return a.id; };
  const c1 = add(state.c1.at, state.c1.pointId);
  const c2 = add(state.c2.at, state.c2.pointId);
  const a1 = add(g.a1), b1 = add(g.b1), a2 = add(g.a2), b2 = add(g.b2);
  const top = addLine(d, a1, a2); d = top.draft;
  const cap2 = addArc(d, c2, b2, a2); d = cap2.draft;
  const bottom = addLine(d, b2, b1); d = bottom.draft;
  const cap1 = addArc(d, c1, a1, b1); d = cap1.draft;
  if (state.c2.infer && settings.autoConstraints) {
    d = addConstraintOf(d, state.c2.infer, [top.id]);
    d = addConstraintOf(d, state.c2.infer, [bottom.id]);
  }
  if (state.c2.lenLock !== undefined) d = addConstraintOf(d, 'distance', [c1, c2], state.c2.lenLock);
  if (state.locked.w !== undefined) d = addConstraintOf(d, 'distance', [a1, b1], state.locked.w);
  return view(fresh(state), d, settings);
}

export const slotTool: Tool<SlotState> = {
  id: 'slot',
  start: () => ({ locked: {}, live: {}, mods: NO_MODS }),
  step(state, ev, draft, settings) {
    switch (ev.type) {
      case 'move':
        return view({ ...state, cursor: ev.snap?.at ?? ev.at, mods: ev.mods, snapPoint: ev.snap?.pointId ? { id: ev.snap.pointId, at: ev.snap.at } : undefined }, draft, settings);
      case 'click': {
        const w: SlotState = { ...state, cursor: ev.snap?.at ?? ev.at, mods: ev.mods, snapPoint: ev.snap?.pointId ? { id: ev.snap.pointId, at: ev.snap.at } : undefined };
        if (!state.c1) return view({ ...w, c1: { at: w.cursor!, ...(w.snapPoint ? { pointId: w.snapPoint.id } : {}) }, snapPoint: undefined }, draft, settings);
        if (!state.c2) return placeSecond(w, draft, settings);
        return finish(w, draft, settings);
      }
      case 'field': {
        if (!state.c1) return view(state, draft, settings);
        const stage2 = !state.c2;
        const key = stage2 ? (ev.id === 'len' ? 'len' : ev.id === 'ang' ? 'ang' : null) : (ev.id === 'w' ? 'w' : null);
        if (!key) return view(state, draft, settings);
        const next = { ...state, ...applyLock(state.locked, state.live, key, ev, key !== 'ang') };
        if (stage2 && ev.commit && next.locked.len !== undefined && next.locked.ang !== undefined && state.cursor) return placeSecond(next, draft, settings);
        if (!stage2 && ev.commit && next.locked.w !== undefined) return finish(next, draft, settings);
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
