/**
 * Arc slot (curved slot). Click the arc centre, click the start point on the centre arc (this sets the radius R and
 * the start angle), click the end of the arc (the pointer's angle round the centre sets the sweep; it follows the
 * pointer round, so either direction works), then click (or type) the width: the pointer's radial distance from the
 * centre arc is the half width. Typed radius (distance centre to start) becomes a `distance` constraint on those two
 * points, typed width a `distance` between the two side points at the start (the cap diameter); typed start angle and
 * typed sweep pin geometry only. A start direction inferred horizontal or vertical constrains the centre and start points.
 *
 * Shape: two concentric arcs (radii R - w/2 and R + w/2, one shared centre point) joined by two half-circle caps
 * centred on the centre arc's end points. Seven points (centre, two cap centres, four side points), four arcs, one closed
 * loop. All four arcs run COUNTER-CLOCKWISE about their centre (kernel convention, see slot.ts): the outer arc from the
 * start side to the end side, the end cap from its outer point to its inner point (bulging along the arc), the inner arc
 * start to end, the start cap from its inner point to its outer point. The four arc/cap joins are tangent constraints at
 * the shared point; with the arcs' own equal-radius equations that leaves six degrees of freedom (centre x and y, R,
 * start angle, sweep, width), the equal-cap-radius constraint would be redundant (both caps are w/2 by concentricity).
 */
import type { SketchDraft } from '../index';
import { addConstraintOf, addPoint } from './builders';
import { addTangent, angleOf, arcPolyline, dist } from './builders-arcs';
import { segmentEnd } from './geometry';
import { addArc, applyLock, hasValues, polyline } from './shape-helpers';
import type { FieldSpec, Modifiers, Pt, PreviewShape, Tool, ToolOutput, ToolSettings } from './types';

const TAU = Math.PI * 2;
const DEG = 180 / Math.PI;
type Ref = { at: Pt; pointId?: string };
export interface ArcSlotState {
  c?: Ref;
  /** Set once the start point is placed (sweep stage). */
  start?: { at: Pt; infer?: 'horizontal' | 'vertical'; radLock?: number };
  /** Set once the sweep is placed (width stage); signed, counter-clockwise positive. */
  sweep?: number;
  /** Signed turn of the pointer round the centre since the start click, and its last angle (sweep stage). */
  acc?: number;
  prev?: number;
  locked: { len?: number; ang?: number; sweep?: number; w?: number };
  live: { len?: number; ang?: number; sweep?: number; w?: number };
  cursor?: Pt;
  snapPoint?: { id: string; at: Pt };
  mods: Modifiers;
}

const NO_MODS: Modifiers = { shift: false, ctrl: false, alt: false };
const merged = (s: ArcSlotState) => ({ ...s.live, ...s.locked });
const fresh = (s: ArcSlotState): ArcSlotState => ({ locked: {}, live: {}, mods: s.mods, ...(s.cursor ? { cursor: s.cursor } : {}) });
const wrapPi = (d: number): number => { let x = d % TAU; if (x > Math.PI) x -= TAU; if (x <= -Math.PI) x += TAU; return x; };
const at = (c: Pt, r: number, a: number): Pt => ({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
export const MAX_SWEEP = TAU - 1e-6;

/** Follow the pointer round the centre so the sweep keeps growing the way the pointer went. */
function track(s: ArcSlotState, cursor: Pt): ArcSlotState {
  if (!s.c || !s.start || s.sweep !== undefined || dist(s.c.at, cursor) < 1e-9) return { ...s, cursor };
  const a = angleOf(s.c.at, cursor);
  const prev = s.prev ?? angleOf(s.c.at, s.start.at);
  const acc = Math.max(-MAX_SWEEP, Math.min(MAX_SWEEP, (s.acc ?? 0) + wrapPi(a - prev)));
  return { ...s, cursor, acc, prev: a };
}

/** The signed sweep a click would set now: the typed value (direction from the pointer), else the tracked turn. */
function sweepOf(s: ArcSlotState): number {
  if (s.sweep !== undefined) return s.sweep;
  const m = merged(s);
  const dir = (s.acc ?? 0) < 0 ? -1 : 1;
  if (m.sweep !== undefined) return Math.min(m.sweep / DEG, MAX_SWEEP) * dir;
  return s.acc ?? 0;
}

const radiusOf = (s: ArcSlotState): number => (s.c && s.start ? dist(s.c.at, s.start.at) : 0);

/** Full width: the typed width, else twice the pointer's radial distance from the centre arc. */
function widthOf(s: ArcSlotState): number {
  const m = merged(s);
  if (m.w !== undefined) return m.w;
  if (!s.c || !s.start || !s.cursor) return 0;
  return 2 * Math.abs(dist(s.c.at, s.cursor) - radiusOf(s));
}

export interface Geo { c: Pt; R: number; h: number; a0: number; sw: number; m0: Pt; m1: Pt; pi0: Pt; po0: Pt; pi1: Pt; po1: Pt }
/** The shape for a signed sweep (a clockwise sweep is the same shape drawn from its far end). */
export function geometry(c: Pt, start: Pt, signedSweep: number, width: number): Geo {
  const R = dist(c, start), h = width / 2;
  const a0 = angleOf(c, start) + Math.min(signedSweep, 0), sw = Math.abs(signedSweep), a1 = a0 + sw;
  return { c, R, h, a0, sw, m0: at(c, R, a0), m1: at(c, R, a1), pi0: at(c, R - h, a0), po0: at(c, R + h, a0), pi1: at(c, R - h, a1), po1: at(c, R + h, a1) };
}

/** Why a shape cannot be built, as a hint key: inner radius not positive, or the two end caps would overlap. */
export function problem(g: Geo): string | null {
  if (g.R - g.h < 1e-9) return 'app.sketch.hint.arcSlotWide';
  if (g.sw < 1e-9 || g.sw > MAX_SWEEP || g.h < 1e-9) return 'app.sketch.hint.degenerate';
  if (dist(g.m0, g.m1) < 2 * g.h - 1e-9) return 'app.sketch.hint.arcSlotWide';
  return null;
}

function outline(g: Geo): PreviewShape[] {
  const out: Pt[] = [
    ...arcPointsOf(g.c, g.R + g.h, g.a0, g.sw), ...arcPointsOf(g.m1, g.h, g.a0 + g.sw, Math.PI),
    ...arcPointsOf(g.c, g.R - g.h, g.a0 + g.sw, -g.sw), ...arcPointsOf(g.m0, g.h, g.a0 + Math.PI, Math.PI),
  ];
  return polyline(out, true);
}
const arcPointsOf = (c: Pt, r: number, a0: number, sweep: number): Pt[] => {
  const n = Math.max(4, Math.ceil(Math.abs(sweep) / (Math.PI / 24)));
  return Array.from({ length: n + 1 }, (_, i) => at(c, r, a0 + (sweep * i) / n));
};

function view(state: ArcSlotState, draft: SketchDraft, settings: ToolSettings, hint?: string): ToolOutput<ArcSlotState> {
  if (!state.c || !state.cursor) return { state, draft, preview: [], fields: [], hint };
  const off = settings.onViewValues === 'off';
  const lockedOf = (k: keyof ArcSlotState['locked']) => state.locked[k] !== undefined;
  if (!state.start) {
    const m = merged(state);
    const r = segmentEnd(state.c.at, state.cursor, state.mods, settings, { len: m.len, ang: m.ang }, state.snapPoint?.at);
    const fields: FieldSpec[] = off ? [] : [
      { id: 'len', label: 'app.sketch.field.radius', value: r.len, locked: lockedOf('len'), unit: 'length' },
      { id: 'ang', label: 'app.sketch.field.angle', value: r.ang, locked: lockedOf('ang'), unit: 'angle' },
    ];
    return { state, draft, preview: [{ kind: 'line', a: state.c.at, b: r.end }], fields, hint, ...(r.infer ? { pending: [r.infer] } : {}) };
  }
  const R = radiusOf(state), a0 = angleOf(state.c.at, state.start.at);
  if (state.sweep === undefined) {
    const sw = sweepOf(state);
    const fields: FieldSpec[] = off ? [] : [{ id: 'sweep', label: 'app.sketch.field.sweep', value: Math.abs(sw) * DEG, locked: lockedOf('sweep'), unit: 'angle' }];
    const preview: PreviewShape[] = [{ kind: 'line', a: state.c.at, b: state.start.at }];
    if (Math.abs(sw) > 1e-9) preview.push(...arcPolyline(state.c.at, R, sw >= 0 ? a0 : a0 + sw, Math.abs(sw)), { kind: 'line', a: state.c.at, b: at(state.c.at, R, a0 + sw) });
    return { state, draft, preview, fields, hint };
  }
  const w = widthOf(state);
  const fields: FieldSpec[] = off ? [] : [{ id: 'w', label: 'app.sketch.field.width', value: w, locked: lockedOf('w'), unit: 'length' }];
  const g = geometry(state.c.at, state.start.at, state.sweep, w);
  const preview = w > 1e-9 && !problem(g) ? outline(g)
    : [...arcPolyline(state.c.at, R, state.sweep >= 0 ? a0 : a0 + state.sweep, Math.abs(state.sweep))];
  return { state, draft, preview, fields, hint };
}

function placeStart(state: ArcSlotState, draft: SketchDraft, settings: ToolSettings): ToolOutput<ArcSlotState> {
  const m = merged(state);
  const r = segmentEnd(state.c!.at, state.cursor!, state.mods, settings, { len: m.len, ang: m.ang }, state.snapPoint?.at);
  if (r.len < 1e-9) return view(state, draft, settings, 'app.sketch.hint.degenerate');
  const pointId = state.locked.len !== undefined || state.locked.ang !== undefined ? undefined : state.snapPoint?.id;
  if (pointId && pointId === state.c!.pointId) return view(state, draft, settings, 'app.sketch.hint.degenerate');
  const start = { at: r.end, ...(r.infer ? { infer: r.infer } : {}), ...(state.locked.len !== undefined ? { radLock: state.locked.len } : {}) };
  const a = angleOf(state.c!.at, r.end);
  return view({ ...state, start, acc: 0, prev: a, locked: {}, live: {}, snapPoint: undefined }, draft, settings);
}

function placeSweep(state: ArcSlotState, draft: SketchDraft, settings: ToolSettings): ToolOutput<ArcSlotState> {
  const sw = sweepOf(state);
  if (Math.abs(sw) < 1e-9 || Math.abs(sw) > MAX_SWEEP) return view(state, draft, settings, 'app.sketch.hint.degenerate');
  return view({ ...state, sweep: sw, locked: {}, live: {}, snapPoint: undefined }, draft, settings);
}

function finish(state: ArcSlotState, draft: SketchDraft, settings: ToolSettings): ToolOutput<ArcSlotState> {
  const w = widthOf(state);
  if (!state.c || !state.start || state.sweep === undefined || w < 1e-9) return view(state, draft, settings, 'app.sketch.hint.degenerate');
  const g = geometry(state.c.at, state.start.at, state.sweep, w);
  const bad = problem(g);
  if (bad) return view(state, draft, settings, bad);
  let d = draft;
  const add = (p: Pt, existing?: string) => { if (existing) return existing; const a = addPoint(d, p); d = a.draft; return a.id; };
  const c = add(g.c, state.c.pointId);
  const m0 = add(g.m0), m1 = add(g.m1), pi0 = add(g.pi0), po0 = add(g.po0), pi1 = add(g.pi1), po1 = add(g.po1);
  const outer = addArc(d, c, po0, po1); d = outer.draft;
  const cap1 = addArc(d, m1, po1, pi1); d = cap1.draft;
  const inner = addArc(d, c, pi0, pi1); d = inner.draft;
  const cap0 = addArc(d, m0, pi0, po0); d = cap0.draft;
  d = addTangent(d, outer.id, cap1.id, po1);
  d = addTangent(d, inner.id, cap1.id, pi1);
  d = addTangent(d, inner.id, cap0.id, pi0);
  d = addTangent(d, outer.id, cap0.id, po0);
  // the start side is the clockwise end for a clockwise sweep; the inference and typed radius belong to the picked start point
  const picked = state.sweep >= 0 ? m0 : m1;
  if (state.start.infer && settings.autoConstraints) d = addConstraintOf(d, state.start.infer, [c, picked]);
  if (state.start.radLock !== undefined) d = addConstraintOf(d, 'distance', [c, picked], state.start.radLock);
  if (state.locked.w !== undefined) d = addConstraintOf(d, 'distance', [pi0, po0], state.locked.w);
  return view(fresh(state), d, settings);
}

export const arcSlotTool: Tool<ArcSlotState> = {
  id: 'arc-slot',
  start: () => ({ locked: {}, live: {}, mods: NO_MODS }),
  step(state, ev, draft, settings) {
    switch (ev.type) {
      case 'move': {
        const w = track({ ...state, mods: ev.mods, snapPoint: ev.snap?.pointId ? { id: ev.snap.pointId, at: ev.snap.at } : undefined }, ev.snap?.at ?? ev.at);
        return view(w, draft, settings);
      }
      case 'click': {
        const base: ArcSlotState = { ...state, mods: ev.mods, snapPoint: ev.snap?.pointId ? { id: ev.snap.pointId, at: ev.snap.at } : undefined };
        const w = track(base, ev.snap?.at ?? ev.at);
        if (!state.c) return view({ ...w, c: { at: w.cursor!, ...(w.snapPoint ? { pointId: w.snapPoint.id } : {}) }, snapPoint: undefined }, draft, settings);
        if (!state.start) return placeStart(w, draft, settings);
        if (state.sweep === undefined) return placeSweep(w, draft, settings);
        return finish(w, draft, settings);
      }
      case 'field': {
        if (!state.c) return view(state, draft, settings);
        const stage = !state.start ? 1 : state.sweep === undefined ? 2 : 3;
        const key = stage === 1 ? (ev.id === 'len' ? 'len' : ev.id === 'ang' ? 'ang' : null) : stage === 2 ? (ev.id === 'sweep' ? 'sweep' : null) : (ev.id === 'w' ? 'w' : null);
        if (!key) return view(state, draft, settings);
        const next = { ...state, ...applyLock(state.locked, state.live, key, ev, key !== 'ang') };
        if (stage === 1 && ev.commit && next.locked.len !== undefined && next.locked.ang !== undefined && state.cursor) return placeStart(next, draft, settings);
        if (stage === 2 && ev.commit && next.locked.sweep !== undefined) return placeSweep(next, draft, settings);
        if (stage === 3 && ev.commit && next.locked.w !== undefined) return finish(next, draft, settings);
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
