/**
 * Add Spline Point. Click a fit spline where it should get one more data point: the spline keeps its id and its
 * constraints, and gets a new free sketch point at the clicked place on the curve, inserted between the two data points
 * it lies between (a closed spline wraps, so the place after the last point goes at the end). The point is then an
 * ordinary sketch point: drag it, dimension it or constrain it. The new point lies on the old curve, but the curve is
 * fitted through the points again, so it can shift slightly (the hint says so). Picking a place that already is a data
 * point is refused; control-point splines have their own points and are not handled.
 */
import type { SketchDraft } from '../index';
import { entityOf, ptOf, replaceEntity, withPoint } from './edit-draft';
import { splineIds } from './split';
import { fitLocate } from './splineMath';
import type { PreviewShape, Pt, Tool, ToolOutput } from './types';

export type SplineAddRes = { ok: true; draft: SketchDraft; at: Pt; pointId: string } | { ok: false; hint: string };

/** Where the new point would go for a click near `at` on spline `entityId`, or the hint key of why it cannot. */
function locate(draft: SketchDraft, entityId: string, at: Pt): { ids: string[]; span: number; pt: Pt } | string {
  const e = entityOf(draft, entityId);
  if (!e || e.type !== 'spline') return 'app.sketch.hint.splineAddPick';
  const ids = splineIds(draft, e);
  const pts = ids.map((id) => ptOf(draft, id)!);
  const loc = ids.length >= 2 && pts.every(Boolean) ? fitLocate(pts, e.closed === true, at) : null;
  if (!loc) return 'app.sketch.hint.splineAddPick';
  if (loc.vertex !== undefined) return 'app.sketch.hint.splineAddAtPoint';
  return { ids, span: loc.span, pt: loc.pt };
}

export function addSplinePoint(draft: SketchDraft, entityId: string, at: Pt): SplineAddRes {
  const r = locate(draft, entityId, at);
  if (typeof r === 'string') return { ok: false, hint: r };
  const w = withPoint(draft, r.pt);
  const after = r.ids[r.span];
  const d = replaceEntity(w.draft, entityId, (e) => {
    const raw = (Array.isArray(e.pts) ? e.pts : []).map(String);
    const i = raw.indexOf(after);
    return { ...e, pts: [...raw.slice(0, i + 1), w.id, ...raw.slice(i + 1)] };
  });
  return { ok: true, draft: d, at: r.pt, pointId: w.id };
}

export interface SplineAddState { hover?: { entityId: string } }
const view = (draft: SketchDraft, hint?: string, preview: PreviewShape[] = []): ToolOutput<SplineAddState> => ({ state: {}, draft, preview, fields: [], ...(hint ? { hint } : {}) });

export const splineAddTool: Tool<SplineAddState> = {
  id: 'spline-add',
  start: () => ({}),
  step(_state, ev, draft, _settings, env): ToolOutput<SplineAddState> {
    switch (ev.type) {
      case 'move': {
        const id = ev.snap?.entityId;
        const r = id ? locate(draft, id, ev.snap?.at ?? ev.at) : null;
        return r && typeof r !== 'string' ? view(draft, undefined, [{ kind: 'circle', c: r.pt, r: Math.max((env?.tol ?? 0.6) * 0.5, 1e-3) }]) : view(draft);
      }
      case 'click': {
        const id = ev.snap?.entityId;
        if (!id) return view(draft, 'app.sketch.hint.splineAddPick');
        const r = addSplinePoint(draft, id, ev.snap?.at ?? ev.at);
        return r.ok ? view(r.draft, 'app.sketch.hint.splineAdded') : view(draft, r.hint);
      }
      default:
        return view(draft);
    }
  },
};
