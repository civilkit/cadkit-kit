/**
 * Point tool. Each click adds a sketch point plus a `point` entity `{p}` on it, and the tool stays active.
 * Clicking an existing sketch point (snap.pointId) reuses it and only adds the entity if none exists there yet.
 * Kernel convention: entity `point {p}` where p is a point id.
 *
 * Typed points (hole centres): Tab shows X and Y fields (Tab or Enter locks each). Once both are locked the point is
 * placed there and dimensioned from the sketch origin (`hdist` + `vdist`, or `coincident` at 0, 0), so it is fully
 * defined; the fields stay up for the next point until Escape. A click, or Enter, with only one of them locked takes the
 * other from the pointer (and dimensions the typed one).
 */
import type { SketchDraft } from '../types';
import { addConstraintOf, addPoint } from './builders';
import { addEntity } from './shape-helpers';
import type { FieldSpec, Pt, Tool, ToolOutput } from './types';

type XY = { x?: number; y?: number };
export interface PointState { cursor?: Pt; typing?: { live: XY; locked: XY } }

const SAME = 1e-9;
const originOf = (d: SketchDraft) => d.points.find((p) => p.fixed && Math.abs(p.x) < SAME && Math.abs(p.y) < SAME);

/** Add the point entity at `at` (on `id` when given) and dimension the typed coordinates from the origin. */
function place(draft: SketchDraft, at: Pt, id: string | undefined, typed: XY): { draft: SketchDraft; hint?: string } {
  let d = draft;
  if (id && d.entities.some((e) => e.type === 'point' && e.p === id)) return { draft, hint: 'app.sketch.hint.exists' };
  if (!id) { const a = addPoint(d, at); d = a.draft; id = a.id; }
  d = addEntity(d, { type: 'point', p: id }).draft;
  const o = originOf(d);
  if (o && o.id !== id) {
    const tx = typed.x !== undefined, ty = typed.y !== undefined;
    if (tx && ty && Math.abs(at.x) < SAME && Math.abs(at.y) < SAME) d = addConstraintOf(d, 'coincident', [o.id, id]);
    else {
      if (tx) d = addConstraintOf(d, 'hdist', [o.id, id], Math.abs(at.x));
      if (ty) d = addConstraintOf(d, 'vdist', [o.id, id], Math.abs(at.y));
    }
  }
  return { draft: d };
}

function out(s: PointState, d: SketchDraft, hint?: string): ToolOutput<PointState> {
  if (!s.typing) return { state: s, draft: d, preview: [], fields: [], hint };
  const v = { ...s.typing.live, ...s.typing.locked };
  const at = { x: v.x ?? s.cursor?.x ?? 0, y: v.y ?? s.cursor?.y ?? 0 };
  const fields: FieldSpec[] = [
    { id: 'x', label: 'app.sketch.field.x', value: at.x, locked: s.typing.locked.x !== undefined, unit: 'length' },
    { id: 'y', label: 'app.sketch.field.y', value: at.y, locked: s.typing.locked.y !== undefined, unit: 'length' },
  ];
  return { state: s, draft: d, preview: [], fields, hint: hint ?? 'app.sketch.hint.pointType' };
}

export const pointTool: Tool<PointState> = {
  id: 'point',
  start: () => ({}),
  step(state, ev, draft) {
    switch (ev.type) {
      case 'move': return out({ ...state, cursor: ev.snap?.at ?? ev.at }, draft);
      case 'click': {
        const snapped = ev.snap?.at ?? ev.at;
        const typed = state.typing?.locked ?? {};
        // a typed coordinate wins over the pointer on its axis (unless the click landed on an existing point)
        const own = ev.snap?.pointId;
        const at = own ? snapped : { x: typed.x ?? snapped.x, y: typed.y ?? snapped.y };
        const r = place(draft, at, own, own ? {} : typed);
        const next: PointState = { cursor: snapped, ...(state.typing ? { typing: { live: {}, locked: {} } } : {}) };
        return out(next, r.draft, r.hint);
      }
      case 'field': {
        if (ev.id !== 'x' && ev.id !== 'y') return out(state, draft);
        const k = ev.id;
        const cur = state.typing ?? { live: {}, locked: {} };
        const locked = { ...cur.locked }, live = { ...cur.live };
        if (ev.value === null || !Number.isFinite(ev.value)) { delete locked[k]; delete live[k]; }
        else if (ev.commit) { locked[k] = ev.value; delete live[k]; }
        else live[k] = ev.value;
        // both coordinates locked: the point goes there, and the fields wait for the next one
        if (locked.x !== undefined && locked.y !== undefined) {
          const at = { x: locked.x, y: locked.y };
          const r = place(draft, at, undefined, locked);
          return out({ ...state, typing: { live: {}, locked: {} } }, r.draft, r.hint);
        }
        return out({ ...state, typing: { live, locked } }, draft);
      }
      case 'key': {
        if (ev.key === 'Tab' && !state.typing) return out({ ...state, typing: { live: {}, locked: {} } }, draft);
        // Enter in a coordinate box with only one of X / Y typed: the point goes there, the other coordinate being what its box shows (typed so far, else the pointer's)
        if (ev.key === 'Enter' && state.typing && (state.typing.locked.x !== undefined || state.typing.locked.y !== undefined)) {
          const v = { ...state.typing.live, ...state.typing.locked };
          const at = { x: v.x ?? state.cursor?.x ?? 0, y: v.y ?? state.cursor?.y ?? 0 };
          const r = place(draft, at, undefined, state.typing.locked);
          return out({ ...state, typing: { live: {}, locked: {} } }, r.draft, r.hint);
        }
        if (ev.key === 'Escape' && state.typing) { const { typing: _t, ...rest } = state; return out(rest, draft); }
        return out(state, draft);
      }
      default: return out(state, draft);
    }
  },
};
