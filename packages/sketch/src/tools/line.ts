/**
 * Line tool (chained). Click to start, click to place each next end; the chain continues from the last end.
 * Typed length and angle: a value with `commit` locks it as a driving dimension (a `distance` constraint for
 * the length); an uncommitted value only previews. Horizontal and vertical are inferred within 2 degrees.
 * Clicking the chain's first point closes the profile and ends the chain. Escape clears locks, then ends the chain.
 *
 * Tangent arc mode: `m` toggles it (the app also flips it when the pointer rests on the chain's end), `a` enters it,
 * `l` and Escape leave it. In arc mode the tool is the tangent arc tool continuing from the chain's end, so each
 * click places a tangent arc and the chain goes on from the arc's end; the mode stays until changed. The output's
 * `anchor` is the chain end the app watches for that resting pointer, and `mode` names the current mode.
 *
 * Not here yet: an `angle` constraint from a typed angle (a typed angle pins the geometry only).
 */
import type { SketchDraft } from '../index';
import { addConstraintOf, addLine, addPoint, pointOf } from './builders';
import { ownersAt } from './builders-arcs';
import { segmentEnd, type EndResult } from './geometry';
import { tangentArcTool, type TangentArcState } from './tangentArc';
import type { FieldSpec, Pt, Tool, ToolOutput, ToolSettings } from './types';

export interface LineState {
  first?: string;
  last?: string;
  locked: { len?: number; ang?: number };
  live: { len?: number; ang?: number };
  cursor?: Pt;
  snapPoint?: { id: string; at: Pt };
  mods: { shift: boolean; ctrl: boolean; alt: boolean };
  /** Present in tangent arc mode: the arc tool's state, continuing from `last`. */
  arc?: TangentArcState;
}

const NO_MODS = { shift: false, ctrl: false, alt: false };
const merged = (s: LineState) => ({ ...s.live, ...s.locked });

/** The chain end the pointer may rest on to flip to an arc: only once the chain has a segment to be tangent to. */
function anchorOf(state: LineState, draft: SketchDraft): Pt | undefined {
  if (!state.last) return undefined;
  return ownersAt(draft, state.last).length === 1 ? pointOf(draft, state.last) : undefined;
}

function view(state: LineState, draft: SketchDraft, settings: ToolSettings, hint?: string): ToolOutput<LineState> {
  if (!state.last || !state.cursor) return { state, draft, preview: [], fields: [], hint };
  const a = pointOf(draft, state.last);
  const r = segmentEnd(a, state.cursor, state.mods, settings, merged(state), state.snapPoint?.at);
  const fields: FieldSpec[] = settings.onViewValues === 'off' ? [] : [
    { id: 'len', label: 'app.sketch.field.length', value: r.len, locked: state.locked.len !== undefined, unit: 'length' },
    { id: 'ang', label: 'app.sketch.field.angle', value: r.ang, locked: state.locked.ang !== undefined, unit: 'angle' },
  ];
  const anchor = anchorOf(state, draft);
  return { state, draft, preview: [{ kind: 'line', a, b: r.end }], fields, hint, mode: 'line', from: a, ...(anchor ? { anchor } : {}), ...(r.infer ? { pending: [r.infer] } : {}) };
}

/** Wrap the arc tool's output as the line tool's: when an arc was placed the chain continues from its end. */
function arcView(state: LineState, out: ToolOutput<TangentArcState>, before: SketchDraft): ToolOutput<LineState> {
  let next: LineState = { ...state, arc: out.state, ...(out.state.cursor ? { cursor: out.state.cursor } : {}) };
  if (out.draft !== before) {
    const end = out.state.from?.pointId;
    if (end) {
      const closes = end === state.first && out.draft.entities.length > 1;
      next = closes
        ? { locked: {}, live: {}, mods: state.mods, ...(next.cursor ? { cursor: next.cursor } : {}) }
        : { ...next, last: end, locked: {}, live: {} };
    }
  }
  const anchor = next.arc && next.last ? pointOf(out.draft, next.last) : undefined;
  return { ...out, state: next, mode: next.arc ? 'arc' : 'line', ...(anchor ? { anchor } : {}) };
}

function enterArc(state: LineState, draft: SketchDraft, settings: ToolSettings): ToolOutput<LineState> {
  if (!state.last || ownersAt(draft, state.last).length !== 1) return view(state, draft, settings, 'app.sketch.hint.tangentStart');
  const at = pointOf(draft, state.last);
  const started = tangentArcTool.step(tangentArcTool.start(), { type: 'click', at, snap: { kind: 'point', at, pointId: state.last }, mods: state.mods }, draft, settings);
  if (!started.state.from) return view(state, draft, settings, started.hint ?? 'app.sketch.hint.tangentStart');
  const arc: TangentArcState = { ...started.state, ...(state.cursor ? { cursor: state.cursor } : {}) };
  const shown = tangentArcTool.step(arc, { type: 'move', at: state.cursor ?? at, mods: state.mods }, draft, settings);
  return arcView({ ...state, locked: {}, live: {} }, shown, draft);
}

function stepArc(state: LineState, ev: Parameters<Tool<LineState>['step']>[1], draft: SketchDraft, settings: ToolSettings): ToolOutput<LineState> {
  if (ev.type === 'key') {
    if (ev.key === 'l' || ev.key === 'm' || ev.key === 'Escape') return view({ ...state, arc: undefined }, draft, settings);
    return arcView(state, tangentArcTool.step(state.arc!, ev, draft, settings), draft);
  }
  const withMods = ev.type === 'move' || ev.type === 'click' ? { ...state, mods: ev.mods } : state;
  return arcView(withMods, tangentArcTool.step(state.arc!, ev, draft, settings), draft);
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
    if (state.arc) return stepArc(state, ev, draft, settings);
    if (ev.type === 'key' && (ev.key === 'm' || ev.key === 'a') && state.last) return enterArc(state, draft, settings);
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
