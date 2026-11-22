/**
 * Break. Click a line, arc or circle: it is split at every place another line, arc or circle crosses it, in one step.
 * Each cut is a Split Entity (split.ts), so the pieces share the new points, the constraints carry over by the same rules
 * and an outline through the curve stays closed. A crossing at an end of the curve is not a cut (nothing to break there);
 * a curve with no crossing is refused with a hint. Splines and ellipses are not broken (use Split entity at a point).
 */
import type { SketchDraft } from '../types';
import { curveOf, entityOf, ptOf } from './edit-draft';
import { dist, intersect, nearestOn } from './edit-geom';
import { splitAt } from './split';
import type { Pt, PreviewShape, Tool, ToolOutput } from './types';

const ON = 1e-6;

export type BreakRes = { ok: true; draft: SketchDraft; cuts: number; dropped: string[] } | { ok: false; hint: string };

/** Where other curves of the sketch cross this one (distinct places, ends included: the split refuses those). */
export function crossings(draft: SketchDraft, entityId: string): Pt[] {
  const e = entityOf(draft, entityId);
  const g = e ? curveOf(draft, e) : null;
  if (!e || !g) return [];
  const out: Pt[] = [];
  const ends = [e.p1, e.p2].map((id) => (typeof id === 'string' ? ptOf(draft, id) : null)).filter((p): p is Pt => !!p);
  for (const o of draft.entities) {
    if (o.id === entityId) continue;
    const h = curveOf(draft, o);
    if (!h) continue;
    for (const p of intersect(g, h)) if (!ends.some((q) => dist(p, q) <= ON) && !out.some((q) => dist(p, q) <= ON)) out.push(p);
  }
  return out;
}

/** Break the entity at each of its crossings. */
export function breakAt(draft: SketchDraft, entityId: string): BreakRes {
  const e = entityOf(draft, entityId);
  if (!e) return { ok: false, hint: 'app.sketch.hint.breakPick' };
  if (e.type !== 'line' && e.type !== 'arc' && e.type !== 'circle') return { ok: false, hint: 'app.sketch.hint.breakUnsupported' };
  const spots = crossings(draft, entityId);
  if (!spots.length) return { ok: false, hint: 'app.sketch.hint.breakNone' };
  let d = draft, cuts = 0;
  const pieces = new Set<string>([entityId]);
  const dropped = new Set<string>();
  for (const at of spots) {
    // the piece that now carries this place (the original keeps the first part, new entities take the rest)
    for (const id of [...pieces]) {
      const pe = entityOf(d, id), g = pe ? curveOf(d, pe) : null, n = g ? nearestOn(g, at) : null;
      if (!n || dist(n, at) > ON) continue;
      const before = new Set(d.entities.map((x) => x.id));
      const r = splitAt(d, id, at);
      if (!r.ok) break;                              // an end of that piece: already a joint
      d = r.draft;
      cuts++;
      for (const k of r.dropped) dropped.add(k);
      for (const x of d.entities) if (!before.has(x.id)) pieces.add(x.id);
      break;
    }
  }
  if (!cuts) return { ok: false, hint: 'app.sketch.hint.breakNone' };
  return { ok: true, draft: d, cuts, dropped: [...dropped] };
}

const marker = (at: Pt, r: number): PreviewShape => ({ kind: 'circle', c: at, r });

export interface BreakState { hover?: { entityId: string } }
const view = (draft: SketchDraft, state: BreakState = {}, hint?: string, preview: PreviewShape[] = []): ToolOutput<BreakState> =>
  ({ state, draft, preview, fields: [], ...(hint ? { hint } : {}) });

export const breakTool: Tool<BreakState> = {
  id: 'break',
  start: () => ({}),
  step(state, ev, draft, _settings, env): ToolOutput<BreakState> {
    switch (ev.type) {
      case 'move': {
        const id = ev.snap?.entityId;
        if (!id) return view(draft);
        const r = Math.max((env?.tol ?? 0.6) * 0.5, 1e-3);
        return view(draft, { hover: { entityId: id } }, undefined, crossings(draft, id).map((p) => marker(p, r)));
      }
      case 'click': {
        const id = ev.snap?.entityId;
        if (!id) return view(draft, state, 'app.sketch.hint.breakPick');
        const r = breakAt(draft, id);
        if (!r.ok) return view(draft, state, r.hint);
        return { ...view(r.draft), ...(r.dropped.length ? { hint: 'app.sketch.hint.splitDropped', dropped: r.dropped } : {}) };
      }
      case 'key':
        return view(draft);
      default:
        return view(draft, state);
    }
  },
};
