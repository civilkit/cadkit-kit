/**
 * Point tool. Each click adds a sketch point plus a `point` entity `{p}` on it, and the tool stays active.
 * Clicking an existing sketch point (snap.pointId) reuses it and only adds the entity if none exists there yet.
 * Kernel convention: entity `point {p}` where p is a point id.
 */
import type { SketchDraft } from '../index';
import { addPoint } from './builders';
import { addEntity } from './shape-helpers';
import type { Pt, Tool, ToolOutput } from './types';

export interface PointState { cursor?: Pt }

export const pointTool: Tool<PointState> = {
  id: 'point',
  start: () => ({}),
  step(state, ev, draft) {
    const out = (s: PointState, d: SketchDraft, hint?: string): ToolOutput<PointState> => ({ state: s, draft: d, preview: [], fields: [], hint });
    switch (ev.type) {
      case 'move': return out({ cursor: ev.snap?.at ?? ev.at }, draft);
      case 'click': {
        const at = ev.snap?.at ?? ev.at;
        let d = draft;
        let id = ev.snap?.pointId;
        if (id && d.entities.some((e) => e.type === 'point' && e.p === id)) return out({ cursor: at }, draft, 'app.sketch.hint.exists');
        if (!id) { const a = addPoint(d, at); d = a.draft; id = a.id; }
        d = addEntity(d, { type: 'point', p: id }).draft;
        return out({ cursor: at }, d);
      }
      default: return out(state, draft);
    }
  },
};
