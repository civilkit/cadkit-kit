/**
 * Line tool (chained). Click to start, click to place each next end; the chain continues from the last end.
 * Typed length and angle: a value with `commit` locks it as a driving dimension (a `distance` constraint for
 * the length); an uncommitted value only previews. Horizontal and vertical are inferred within 2 degrees.
 * Clicking the chain's first point closes the profile and ends the chain, and so does a typed segment that ends exactly on
 * it. Escape clears locks, then ends the chain.
 *
 * The first point can be typed: Tab before the first click shows X and Y fields (Tab or Enter locks each; once both are
 * locked the point is placed there, on an existing point when one is at those coordinates, so a profile can start at (0, 0)).
 * A click with only one of them locked takes the other from the pointer.
 *
 * Tangent arc mode: `m` toggles it (the app also flips it when the pointer rests on the chain's end), `a` enters it,
 * `l` and Escape leave it. In arc mode the tool is the tangent arc tool continuing from the chain's end, so each
 * click places a tangent arc and the chain goes on from the arc's end; the mode stays until changed. The output's
 * `anchor` is the chain end the app watches for that resting pointer, and `mode` names the current mode.
 *
 * A typed angle also becomes a driving `angle` dimension between the new line and the chain's previous line (the interior angle at their shared
 * corner, 0..180, so 180 minus the turn in relative mode), when the setting `typedAngleDims` is on. Not made: for the first segment of a chain (nothing
 * to measure against: a typed 0, 180 or 90 there gets the horizontal / vertical constraint, with auto constraints on), for the segment that closes the chain (its length and both ends are already
 * given), after an arc, when the new constraint would repeat or contradict one (`refusal`); the hint line says so when it is skipped.
 */
import type { SketchDraft } from '../index';
import { addConstraintOf, addLine, addPoint, pointOf } from './builders';
import { angleSpec, appendSpec, orientations, refusal } from './constraints';
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
  /** Direction (degrees from the x axis) of the last straight segment placed: what a relative angle is measured from. */
  dir?: number;
  /** The last straight line of the chain (a typed angle is dimensioned against it). */
  prevLine?: string;
  /** Segments placed in this chain (a typed segment closes the loop on the first point only from the third one on). */
  segs?: number;
  /** Typing the first point (Tab before the first click): the typed X and Y, previewed (`live`) or locked. */
  start?: { live: { x?: number; y?: number }; locked: { x?: number; y?: number } };
  /** Present in tangent arc mode: the arc tool's state, continuing from `last`. */
  arc?: TangentArcState;
}

/** The typed angle is measured from the previous segment's direction (a left turn is positive) instead of from the x axis. Kept for the session, off by default. */
let relativeAngle = false;
export const isRelativeAngle = (): boolean => relativeAngle;
export const setRelativeAngle = (on: boolean): void => { relativeAngle = on; };
const wrap180 = (d: number): number => { let a = ((d % 360) + 360) % 360; if (a > 180) a -= 360; return Math.abs(a) < 1e-12 ? 0 : a; };
/** The absolute direction (degrees from the x axis) of a segment that turns `turn` degrees from a previous direction `prev`. */
export const absoluteAngle = (prev: number, turn: number): number => wrap180(prev + turn);
/** The turn (degrees, left positive, -180..180) from a previous direction to an absolute one. */
export const turnAngle = (prev: number, abs: number): number => wrap180(abs - prev);

const NO_MODS = { shift: false, ctrl: false, alt: false };
const relative = (s: LineState): boolean => relativeAngle && s.dir !== undefined;
/** The typed values as segmentEnd wants them: the angle absolute, whatever the entry mode. */
const merged = (s: LineState) => {
  const m = { ...s.live, ...s.locked };
  return relative(s) && m.ang !== undefined ? { ...m, ang: absoluteAngle(s.dir!, m.ang) } : m;
};

/** The chain end the pointer may rest on to flip to an arc: only once the chain has a segment to be tangent to. */
function anchorOf(state: LineState, draft: SketchDraft): Pt | undefined {
  if (!state.last) return undefined;
  return ownersAt(draft, state.last).length === 1 ? pointOf(draft, state.last) : undefined;
}

const SAME_POINT = 1e-6;

/** The first point as typed: the typed X / Y, the other from the pointer (or 0 with no pointer yet). */
function startAt(state: LineState): Pt {
  const typed = { ...state.start?.live, ...state.start?.locked };
  return { x: typed.x ?? state.cursor?.x ?? 0, y: typed.y ?? state.cursor?.y ?? 0 };
}

/** Place the first point of a chain at `at`: on an existing point there, else a new one. */
function placeFirst(state: LineState, draft: SketchDraft, at: Pt, settings: ToolSettings, id?: string): ToolOutput<LineState> {
  let d = draft;
  let pid = id ?? draft.points.find((q) => Math.hypot(q.x - at.x, q.y - at.y) < SAME_POINT)?.id;
  if (!pid) { const added = addPoint(d, at); d = added.draft; pid = added.id; }
  const { start: _typing, ...rest } = state;
  return view({ ...rest, first: pid, last: pid, locked: {}, live: {}, segs: 0, cursor: state.cursor ?? at }, d, settings);
}

function view(state: LineState, draft: SketchDraft, settings: ToolSettings, hint?: string): ToolOutput<LineState> {
  if (!state.last && state.start) {
    const at = startAt(state);
    const fields: FieldSpec[] = [
      { id: 'x', label: 'app.sketch.field.x', value: at.x, locked: state.start.locked.x !== undefined, unit: 'length' },
      { id: 'y', label: 'app.sketch.field.y', value: at.y, locked: state.start.locked.y !== undefined, unit: 'length' },
    ];
    return { state, draft, preview: [], fields, hint: hint ?? 'app.sketch.hint.lineTypeStart' };
  }
  if (!state.last) return { state, draft, preview: [], fields: [], hint: hint ?? 'app.sketch.hint.lineStart' };
  if (!state.cursor) return { state, draft, preview: [], fields: [], hint: hint ?? 'app.sketch.hint.lineNext' };
  const a = pointOf(draft, state.last);
  const r = segmentEnd(a, state.cursor, state.mods, settings, merged(state), state.snapPoint?.at);
  const fields: FieldSpec[] = settings.onViewValues === 'off' ? [] : [
    { id: 'len', label: 'app.sketch.field.length', value: r.len, locked: state.locked.len !== undefined, unit: 'length' },
    { id: 'ang', label: 'app.sketch.field.angle', value: relative(state) ? turnAngle(state.dir!, r.ang) : r.ang, locked: state.locked.ang !== undefined, unit: 'angle',
      ...(state.dir !== undefined ? { toggle: { id: 'turn', on: relativeAngle, label: 'app.sketch.field.turn', tip: relativeAngle ? 'app.sketch.field.turn.tipOn' : 'app.sketch.field.turn.tipOff' } } : {}) },
  ];
  const anchor = anchorOf(state, draft);
  return { state, draft, preview: [{ kind: 'line', a, b: r.end }], fields, hint: hint ?? 'app.sketch.hint.lineNext', mode: 'line', from: a, ...(anchor ? { anchor } : {}), ...(r.infer ? { pending: [r.infer] } : {}) };
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
        : { ...next, last: end, locked: {}, live: {}, segs: (state.segs ?? 0) + 1, prevLine: undefined };
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
  // a segment that ends on the chain's first point (typed length and angle landing exactly there) closes the loop like a click on it
  if (!endId && state.first && state.first !== state.last && (state.segs ?? 0) >= 2 && Math.hypot(r.end.x - pointOf(d, state.first).x, r.end.y - pointOf(d, state.first).y) < SAME_POINT * Math.max(1, r.len)) endId = state.first;
  if (!endId) { const added = addPoint(d, r.end); d = added.draft; endId = added.id; }
  if (endId === state.last) return view(state, draft, settings, 'app.sketch.hint.degenerate');
  const line = addLine(d, state.last!, endId);
  d = line.draft;
  if (r.infer && settings.autoConstraints) d = addConstraintOf(d, r.infer, [line.id]);
  if (state.locked.len !== undefined) d = addConstraintOf(d, 'distance', [state.last!, endId], state.locked.len);
  const closes = endId === state.first && d.entities.length > 1;
  let skipped = false;
  // the first segment of a chain has no line to measure an angle against: a typed 0 / 180 or 90 still gets its horizontal / vertical constraint (the same one an inferred direction gets)
  if (!state.prevLine && state.locked.ang !== undefined && settings.autoConstraints && !r.infer) {
    const a = ((state.locked.ang % 180) + 180) % 180;
    if (Math.abs(a) < 1e-9) d = addConstraintOf(d, 'horizontal', [line.id]);
    else if (Math.abs(a - 90) < 1e-9) d = addConstraintOf(d, 'vertical', [line.id]);
  }
  if (state.locked.ang !== undefined && state.prevLine && settings.typedAngleDims !== false) {
    // two lines already forced horizontal / vertical have their angle: another dimension would repeat it
    const o = orientations(d);
    const spec = closes || (o.has(state.prevLine) && o.has(line.id)) ? undefined : angleSpec(d, state.prevLine, line.id);
    if (spec && !refusal(d, { type: 'angle', refs: [...spec.refs], value: Math.round(spec.measured * 1e6) / 1e6, extra: spec.extra })) {
      d = appendSpec(d, { type: 'angle', refs: [...spec.refs], value: Math.round(spec.measured * 1e6) / 1e6, extra: spec.extra });
    } else skipped = true;
  }
  const next: LineState = closes
    ? { locked: {}, live: {}, mods: state.mods, ...(state.cursor ? { cursor: state.cursor } : {}) }
    : { first: state.first, last: endId, locked: {}, live: {}, cursor: state.cursor, mods: state.mods, segs: (state.segs ?? 0) + 1, dir: r.ang, prevLine: line.id };
  return view(next, d, settings, skipped ? 'app.sketch.hint.angleSkipped' : undefined);
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
          // typed X / Y win over the pointer on that axis (a click with one of them locked)
          const typed = state.start?.locked;
          if (typed && (typed.x !== undefined || typed.y !== undefined) && !withCursor.snapPoint) return placeFirst(withCursor, draft, { x: typed.x ?? withCursor.cursor!.x, y: typed.y ?? withCursor.cursor!.y }, settings);
          return placeFirst(withCursor, draft, withCursor.cursor!, settings, withCursor.snapPoint?.id);
        }
        return commitSegment(withCursor, draft, settings);
      }
      case 'field': {
        if (!state.last) {
          if (!state.start || (ev.id !== 'x' && ev.id !== 'y')) return view(state, draft, settings);
          const k = ev.id;
          const locked = { ...state.start.locked }, live = { ...state.start.live };
          if (ev.value === null || !Number.isFinite(ev.value)) { delete locked[k]; delete live[k]; }
          else if (ev.commit) { locked[k] = ev.value; delete live[k]; }
          else live[k] = ev.value;
          const next: LineState = { ...state, start: { live, locked } };
          // both coordinates locked: the first point goes there
          if (locked.x !== undefined && locked.y !== undefined) return placeFirst(next, draft, { x: locked.x, y: locked.y }, settings);
          return view(next, draft, settings);
        }
        if (ev.id === 'turn') {
          // the angle's meaning changes: a value typed in the other mode would be misread, so it is dropped
          relativeAngle = ev.value === null ? !relativeAngle : ev.value !== 0;
          const { ang: _l, ...locked } = state.locked, { ang: _v, ...live } = state.live;
          return view({ ...state, locked, live }, draft, settings);
        }
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
        // T switches the typed angle between absolute and relative to the previous segment
        if (ev.key === 't' && state.last && state.dir !== undefined) { relativeAngle = !relativeAngle; const { ang: _l, ...locked } = state.locked, { ang: _v, ...live } = state.live; return view({ ...state, locked, live }, draft, settings); }
        // Tab before the first click: type the first point's X and Y
        if (ev.key === 'Tab' && !state.last) return view({ ...state, cursor: state.cursor ?? { x: 0, y: 0 }, start: state.start ?? { live: {}, locked: {} } }, draft, settings);
        if (ev.key === 'Escape' && !state.last && state.start) { const { start: _typing, ...rest } = state; return view(rest, draft, settings); }
        if (ev.key !== 'Escape') return view(state, draft, settings);
        if (Object.keys(state.locked).length || Object.keys(state.live).length) return view({ ...state, locked: {}, live: {} }, draft, settings);
        return view({ locked: {}, live: {}, mods: state.mods }, draft, settings);
      }
    }
  },
};
