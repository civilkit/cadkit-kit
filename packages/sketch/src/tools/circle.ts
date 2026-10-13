/**
 * Circle by centre and radius. First click sets the centre (an existing point is reused), the second click sets
 * the radius from the pointer. A typed radius or diameter commits with Tab or Enter and ends the shape at once:
 * it becomes a driving dimension, `radius` (value = radius) or `diameter` (value = diameter), with refs
 * `[circleId]` (convention read from the solver and checked against the real kernel). An uncommitted value only
 * previews. Zero radius is refused with `app.sketch.hint.degenerate`. Escape clears typed values, then the centre.
 */
import type { SketchDraft } from '../index';
import { addPoint } from './builders';
import { addCircle, addSizeConstraint, dist } from './builders-arcs';
import type { FieldSpec, Pt, Tool, ToolOutput, ToolSettings } from './types';

type Typed = { kind: 'radius' | 'diameter'; value: number };
export interface CircleState {
  centre?: { at: Pt; pointId?: string };
  locked?: Typed;
  live?: Typed;
  cursor?: Pt;
}

const radiusOf = (s: CircleState): number => {
  const t = s.locked ?? s.live;
  if (t) return t.kind === 'diameter' ? t.value / 2 : t.value;
  return s.centre && s.cursor ? dist(s.centre.at, s.cursor) : 0;
};

function view(state: CircleState, draft: SketchDraft, settings: ToolSettings, hint?: string): ToolOutput<CircleState> {
  if (!state.centre || !state.cursor) return { state, draft, preview: [], fields: [], hint };
  const r = radiusOf(state);
  const lockedKind = state.locked?.kind;
  const fields: FieldSpec[] = settings.onViewValues === 'off' ? [] : [
    { id: 'radius', label: 'app.sketch.field.radius', value: r, locked: lockedKind === 'radius', unit: 'length' },
    { id: 'diameter', label: 'app.sketch.field.diameter', value: r * 2, locked: lockedKind === 'diameter', unit: 'length' },
  ];
  return { state, draft, preview: r > 0 ? [{ kind: 'circle', c: state.centre.at, r }] : [], fields, hint };
}

function commit(state: CircleState, draft: SketchDraft, settings: ToolSettings): ToolOutput<CircleState> {
  const r = radiusOf(state);
  if (!state.centre || !(r > 1e-9)) return view(state, draft, settings, 'app.sketch.hint.degenerate');
  let d = draft;
  let c = state.centre.pointId;
  if (!c) { const a = addPoint(d, state.centre.at); d = a.draft; c = a.id; }
  const circle = addCircle(d, c, r);
  d = circle.draft;
  if (state.locked) d = addSizeConstraint(d, state.locked.kind, circle.id, state.locked.value);
  return view({ ...(state.cursor ? { cursor: state.cursor } : {}) }, d, settings);
}

export const circleTool: Tool<CircleState> = {
  id: 'circle',
  start: () => ({}),
  step(state, ev, draft, settings) {
    switch (ev.type) {
      case 'move': return view({ ...state, cursor: ev.snap?.at ?? ev.at }, draft, settings);
      case 'click': {
        const at = ev.snap?.at ?? ev.at;
        if (!state.centre) return view({ ...state, centre: { at, ...(ev.snap?.pointId ? { pointId: ev.snap.pointId } : {}) }, cursor: at }, draft, settings);
        return commit({ ...state, cursor: at }, draft, settings);
      }
      case 'field': {
        if (!state.centre || (ev.id !== 'radius' && ev.id !== 'diameter')) return view(state, draft, settings);
        const kind = ev.id;
        if (ev.value === null || !Number.isFinite(ev.value) || ev.value <= 0) {
          const { locked, live, ...rest } = state;
          const keepLocked = locked && locked.kind !== kind ? { locked } : {};
          return view({ ...rest, ...keepLocked }, draft, settings);
        }
        if (ev.commit) return commit({ ...state, locked: { kind, value: ev.value }, live: undefined }, draft, settings);
        return view({ ...state, live: { kind, value: ev.value } }, draft, settings);
      }
      case 'key': {
        if (ev.key !== 'Escape') return view(state, draft, settings);
        if (state.locked || state.live) { const { locked, live, ...rest } = state; return view(rest, draft, settings); }
        return view({}, draft, settings);
      }
    }
  },
};
