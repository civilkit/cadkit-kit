/**
 * Line tool (chained). Click to start, click to place each next end; the chain continues from the last end.
 * Typed length and angle: a value with `commit` locks it as a driving dimension (a `distance` constraint for
 * the length); an uncommitted value only previews. Horizontal and vertical are inferred within 2 degrees.
 * Clicking the chain's first point closes the profile and ends the chain. Escape clears locks, then ends the chain.
 *
 * Not here yet (later slices): tangent arc switching, an `angle` constraint from a typed angle (the kernel's
 * `angle` reference convention needs a probe first, so a typed angle pins the geometry only).
 */
import type { SketchDraft } from '../index';
import { addConstraintOf, addLine, addPoint, pointOf } from './builders';
import { segmentEnd, type EndResult } from './geometry';
import type { FieldSpec, Pt, Tool, ToolOutput, ToolSettings } from './types';

export interface LineState {
  first?: string;
  last?: string;
  locked: { len?: number; ang?: number };
  live: { len?: number; ang?: number };
  cursor?: Pt;
  snapPoint?: { id: string; at: Pt };
  mods: { shift: boolean; ctrl: boolean; alt: boolean };
}

const NO_MODS = { shift: false, ctrl: false, alt: false };
const merged = (s: LineState) => ({ ...s.live, ...s.locked });

function view(state: LineState, draft: SketchDraft, settings: ToolSettings, hint?: string): ToolOutput<LineState> {
  if (!state.last || !state.cursor) return { state, draft, preview: [], fields: [], hint };
  const a = pointOf(draft, state.last);
  const r = segmentEnd(a, state.cursor, state.mods, settings, merged(state), state.snapPoint?.at);
  const fields: FieldSpec[] = settings.onViewValues === 'off' ? [] : [
    { id: 'len', label: 'app.sketch.field.length', value: r.len, locked: state.locked.len !== undefined, unit: 'length' },
    { id: 'ang', label: 'app.sketch.field.angle', value: r.ang, locked: state.locked.ang !== undefined, unit: 'angle' },
  ];
  return { state, draft, preview: [{ kind: 'line', a, b: r.end }], fields, hint, ...(r.infer ? { pending: [r.infer] } : {}) };
}

function commitSegment(state: LineState, draft: SketchDraft, settings: ToolSettings): ToolOutput<LineState> {
  const a = pointOf(draft, state.last!);
  const r: EndResult = segmentEnd(a, state.cursor!, state.mods, settings, merged(state), state.snapPoint?.at);
  if (r.len < 1e-9) return view(state, draft, settings, 'app.sketch.hint.degenerate');
  let d = draft;
  let endId = state.snapPoint?.id;
  const pinned = state.locked.len !== undefined || state.locked.ang !== undefined;
  // a typed value moves the end off the snapped point, so the snap no longer applies
  if (endId && pinned) endId = undefined;
  if (!endId) { const added = addPoint(d, r.end); d = added.draft; endId = added.id; }
  if (endId === state.last) return view(state, draft, settings, 'app.sketch.hint.degenerate');
  const line = addLine(d, state.last!, endId);
  d = line.draft;
  if (r.infer && settings.autoConstraints) d = addConstraintOf(d, r.infer, [line.id]);
  if (state.locked.len !== undefined) d = addConstraintOf(d, 'distance', [state.last!, endId], state.locked.len);
  const closes = endId === state.first && d.entities.length > 1;
  const next: LineState = closes
    ? { locked: {}, live: {}, mods: state.mods, ...(state.cursor ? { cursor: state.cursor } : {}) }
    : { first: state.first, last: endId, locked: {}, live: {}, cursor: state.cursor, mods: state.mods };
  return view(next, d, settings);
}

export const lineTool: Tool<LineState> = {
  id: 'line',
  start: () => ({ locked: {}, live: {}, mods: NO_MODS }),
  step(state, ev, draft, settings) {
    switch (ev.type) {
      case 'move': {
        const next = { ...state, cursor: ev.snap?.at ?? ev.at, mods: ev.mods, snapPoint: ev.snap?.pointId ? { id: ev.snap.pointId, at: ev.snap.at } : undefined };
        return view(next, draft, settings);
      }
      case 'click': {
        const withCursor: LineState = { ...state, cursor: ev.snap?.at ?? ev.at, mods: ev.mods, snapPoint: ev.snap?.pointId ? { id: ev.snap.pointId, at: ev.snap.at } : undefined };
        if (!state.last) {
          let d = draft;
          let id = withCursor.snapPoint?.id;
          if (!id) { const added = addPoint(d, withCursor.cursor!); d = added.draft; id = added.id; }
          return view({ ...withCursor, first: id, last: id }, d, settings);
        }
        return commitSegment(withCursor, draft, settings);
      }
      case 'field': {
        if (!state.last) return view(state, draft, settings);
        const key = ev.id === 'len' ? 'len' : ev.id === 'ang' ? 'ang' : null;
        if (!key) return view(state, draft, settings);
        const locked = { ...state.locked };
        const live = { ...state.live };
        if (ev.value === null || !Number.isFinite(ev.value)) { delete locked[key]; delete live[key]; }
        else if (ev.commit) { locked[key] = ev.value; delete live[key]; }
        else live[key] = ev.value;
        const next = { ...state, locked, live };
        // locking the last field finishes the segment, as the typed-value flow expects
        if (ev.commit && locked.len !== undefined && locked.ang !== undefined && state.cursor) return commitSegment(next, draft, settings);
        return view(next, draft, settings);
      }
      case 'key': {
        if (ev.key !== 'Escape') return view(state, draft, settings);
        if (Object.keys(state.locked).length || Object.keys(state.live).length) return view({ ...state, locked: {}, live: {} }, draft, settings);
        return view({ locked: {}, live: {}, mods: state.mods }, draft, settings);
      }
    }
  },
};
