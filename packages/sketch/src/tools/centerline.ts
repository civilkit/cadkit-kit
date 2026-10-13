/**
 * Centreline: a line entity with `construction: true`, drawn with two clicks (not chained). It behaves like the
 * line tool for typed length (a `distance` constraint when committed), typed angle (pins the geometry only) and
 * H/V inference, but it never contributes to a profile. After the second click the tool is ready for a new one.
 *
 * Kernel conventions used: `construction: true` on the entity, horizontal/vertical refs=[lineId], distance refs=[p1,p2].
 */
import type { SketchDraft } from '../index';
import { addConstraintOf, addPoint } from './builders';
import { segmentEnd } from './geometry';
import { addEntity, applyLock, hasValues } from './shape-helpers';
import type { FieldSpec, Modifiers, Pt, Tool, ToolOutput, ToolSettings } from './types';

export interface CenterlineState {
  start?: { at: Pt; pointId?: string };
  locked: { len?: number; ang?: number };
  live: { len?: number; ang?: number };
  cursor?: Pt;
  snapPoint?: { id: string; at: Pt };
  mods: Modifiers;
}

const NO_MODS: Modifiers = { shift: false, ctrl: false, alt: false };
const merged = (s: CenterlineState) => ({ ...s.live, ...s.locked });
const fresh = (s: CenterlineState): CenterlineState => ({ locked: {}, live: {}, mods: s.mods, ...(s.cursor ? { cursor: s.cursor } : {}) });

function view(state: CenterlineState, draft: SketchDraft, settings: ToolSettings, hint?: string): ToolOutput<CenterlineState> {
  if (!state.start || !state.cursor) return { state, draft, preview: [], fields: [], hint };
  const r = segmentEnd(state.start.at, state.cursor, state.mods, settings, merged(state), state.snapPoint?.at);
  const fields: FieldSpec[] = settings.onViewValues === 'off' ? [] : [
    { id: 'len', label: 'app.sketch.field.length', value: r.len, locked: state.locked.len !== undefined, unit: 'length' },
    { id: 'ang', label: 'app.sketch.field.angle', value: r.ang, locked: state.locked.ang !== undefined, unit: 'angle' },
  ];
  return { state, draft, preview: [{ kind: 'line', a: state.start.at, b: r.end }], fields, hint, ...(r.infer ? { pending: [r.infer] } : {}) };
}

function commit(state: CenterlineState, draft: SketchDraft, settings: ToolSettings): ToolOutput<CenterlineState> {
  const start = state.start!;
  const r = segmentEnd(start.at, state.cursor!, state.mods, settings, merged(state), state.snapPoint?.at);
  if (r.len < 1e-9) return view(state, draft, settings, 'app.sketch.hint.degenerate');
  const pinned = state.locked.len !== undefined || state.locked.ang !== undefined;
  let d = draft;
  let a = start.pointId;
  if (!a) { const p = addPoint(d, start.at); d = p.draft; a = p.id; }
  let b = pinned ? undefined : state.snapPoint?.id;
  if (b === a) return view(state, draft, settings, 'app.sketch.hint.degenerate');
  if (!b) { const p = addPoint(d, r.end); d = p.draft; b = p.id; }
  const line = addEntity(d, { type: 'line', p1: a, p2: b, construction: true });
  d = line.draft;
  if (r.infer && settings.autoConstraints) d = addConstraintOf(d, r.infer, [line.id]);
  if (state.locked.len !== undefined) d = addConstraintOf(d, 'distance', [a, b], state.locked.len);
  return view(fresh(state), d, settings);
}

export const centerlineTool: Tool<CenterlineState> = {
  id: 'centerline',
  start: () => ({ locked: {}, live: {}, mods: NO_MODS }),
  step(state, ev, draft, settings) {
    switch (ev.type) {
      case 'move':
        return view({ ...state, cursor: ev.snap?.at ?? ev.at, mods: ev.mods, snapPoint: ev.snap?.pointId ? { id: ev.snap.pointId, at: ev.snap.at } : undefined }, draft, settings);
      case 'click': {
        const w: CenterlineState = { ...state, cursor: ev.snap?.at ?? ev.at, mods: ev.mods, snapPoint: ev.snap?.pointId ? { id: ev.snap.pointId, at: ev.snap.at } : undefined };
        if (!state.start) return view({ ...w, start: { at: w.cursor!, ...(w.snapPoint ? { pointId: w.snapPoint.id } : {}) }, snapPoint: undefined }, draft, settings);
        return commit(w, draft, settings);
      }
      case 'field': {
        if (!state.start) return view(state, draft, settings);
        const key = ev.id === 'len' ? 'len' : ev.id === 'ang' ? 'ang' : null;
        if (!key) return view(state, draft, settings);
        const next = { ...state, ...applyLock(state.locked, state.live, key, ev, key === 'len') };
        if (ev.commit && next.locked.len !== undefined && next.locked.ang !== undefined && state.cursor) return commit(next, draft, settings);
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
