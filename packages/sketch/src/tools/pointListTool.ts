/**
 * Shared engine of the point-list curve tools (fit spline and control-point spline). Not a tool itself:
 * `spline.ts` and `cvspline.ts` configure it.
 *
 * Behaviour: each click adds a point to the draft (a snapped existing point is reused, never duplicated)
 * and to the pending list; the entity is written to the draft only when the shape is finished, so the
 * draft never holds a half-valid curve. Finish with Enter, or by clicking the last point again (the
 * second click of a double click). Clicking the first point closes the curve and finishes it. Escape
 * cancels: the points this tool added are removed again. A click on a point already in the list, or too
 * few points to finish, returns a hint key and changes nothing.
 */
import type { DraftEntity, SketchDraft } from '../index';
import { addPoint, nextId, pointOf } from './builders';
import type { Pt, Tool, ToolOutput, ToolSettings } from './types';

export interface PointListState {
  /** Point ids picked so far, in order. */
  pts: string[];
  /** Point ids this tool created (removed again on Escape); snapped existing points are not listed. */
  added: string[];
  /** Control-point spline only. */
  degree?: number;
  cursor?: Pt;
  snapPoint?: { id: string; at: Pt };
  mods: { shift: boolean; ctrl: boolean; alt: boolean };
}

export interface PointListConfig {
  id: string;
  /** Initial state fields beyond the common ones (the degree). */
  init?: Partial<PointListState>;
  /** Fewest points to finish open / closed, given the state (the degree may change them). */
  minOpen(s: PointListState): number;
  minClosed(s: PointListState): number;
  entity(s: PointListState, closed: boolean): Omit<DraftEntity, 'id'>;
  /** Preview from the picked points' positions plus the pending cursor position (if any). */
  preview(s: PointListState, at: Pt[], cursor: Pt | undefined, closing: boolean): import('./types').PreviewShape[];
  /** Handle a typed field the shape owns (the degree); return the new state or undefined to ignore. */
  field?(s: PointListState, id: string, value: number | null): PointListState | undefined;
}

const NO_MODS = { shift: false, ctrl: false, alt: false };
const SAME = 1e-9;
const near = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y) < SAME;

function view(cfg: PointListConfig, state: PointListState, draft: SketchDraft, hint?: string): ToolOutput<PointListState> {
  if (!state.pts.length) return { state, draft, preview: [], fields: [], hint };
  const at = state.pts.map((id) => pointOf(draft, id));
  const cursor = state.cursor;
  const closing = !!cursor && at.length >= cfg.minClosed(state) && !!state.snapPoint && state.snapPoint.id === state.pts[0];
  // the cursor is a tentative next point unless it sits on a point already picked
  const tentative = cursor && !at.some((q) => near(q, cursor)) ? cursor : undefined;
  return { state, draft, preview: cfg.preview(state, at, tentative, closing), fields: [], hint, ...(closing ? { pending: ['close'] } : {}) };
}

function reset(state: PointListState): PointListState {
  return { pts: [], added: [], ...(state.degree !== undefined ? { degree: state.degree } : {}), ...(state.cursor ? { cursor: state.cursor } : {}), mods: state.mods };
}

function finish(cfg: PointListConfig, state: PointListState, draft: SketchDraft, closed: boolean): ToolOutput<PointListState> {
  const id = nextId(draft, 'e');
  const entity: DraftEntity = { id, ...cfg.entity(state, closed) };
  return view(cfg, reset(state), { ...draft, entities: [...draft.entities, entity] });
}

function cancel(state: PointListState, draft: SketchDraft): { draft: SketchDraft; state: PointListState } {
  const gone = new Set(state.added);
  const d: SketchDraft = gone.size ? { ...draft, points: draft.points.filter((p) => !gone.has(p.id)) } : draft;
  return { draft: d, state: reset(state) };
}

export function pointListTool(cfg: PointListConfig): Tool<PointListState> {
  const needPoints = 'app.sketch.hint.needPoints';
  return {
    id: cfg.id,
    start: () => ({ pts: [], added: [], mods: NO_MODS, ...cfg.init }),
    step(state: PointListState, ev, draft: SketchDraft, _settings: ToolSettings) {
      switch (ev.type) {
        case 'move':
          return view(cfg, { ...state, cursor: ev.snap?.at ?? ev.at, mods: ev.mods, snapPoint: ev.snap?.pointId ? { id: ev.snap.pointId, at: ev.snap.at } : undefined }, draft);
        case 'click': {
          const at = ev.snap?.at ?? ev.at;
          const sid = ev.snap?.pointId;
          const s: PointListState = { ...state, cursor: at, mods: ev.mods, snapPoint: sid ? { id: sid, at } : undefined };
          if (!s.pts.length) {
            if (sid) return view(cfg, { ...s, pts: [sid] }, draft);
            const added = addPoint(draft, at);
            return view(cfg, { ...s, pts: [added.id], added: [added.id] }, added.draft);
          }
          const last = s.pts[s.pts.length - 1];
          // clicking the last point again is the second click of a double click: finish
          if (sid === last || near(at, pointOf(draft, last))) {
            return s.pts.length >= cfg.minOpen(s) ? finish(cfg, s, draft, false) : view(cfg, s, draft, needPoints);
          }
          if (sid === s.pts[0] || (!sid && near(at, pointOf(draft, s.pts[0])))) {
            return s.pts.length >= cfg.minClosed(s) ? finish(cfg, s, draft, true) : view(cfg, s, draft, needPoints);
          }
          if ((sid && s.pts.includes(sid)) || s.pts.some((id) => near(at, pointOf(draft, id)))) return view(cfg, s, draft, 'app.sketch.hint.degenerate');
          if (sid) return view(cfg, { ...s, pts: [...s.pts, sid] }, draft);
          const added = addPoint(draft, at);
          return view(cfg, { ...s, pts: [...s.pts, added.id], added: [...s.added, added.id] }, added.draft);
        }
        case 'field': {
          const next = cfg.field?.(state, ev.id, ev.value);
          return view(cfg, next ?? state, draft);
        }
        case 'key': {
          if (ev.key === 'Enter') {
            if (!state.pts.length) return view(cfg, state, draft);
            return state.pts.length >= cfg.minOpen(state) ? finish(cfg, state, draft, false) : view(cfg, state, draft, needPoints);
          }
          if (ev.key === 'Escape') {
            const c = cancel(state, draft);
            return view(cfg, c.state, c.draft);
          }
          return view(cfg, state, draft);
        }
      }
    },
  };
}
