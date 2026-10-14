/**
 * Construction geometry. An entity marked `construction: true` is a helper: the kernel's profile builder skips it
 * (it is never extruded or revolved; verified in construction.kernel.test.ts), the viewport draws it dashed, and the
 * solver still honours constraints on it. Points and nothing else cannot be construction (`point` entities have no
 * flag); lines, circles, arcs, ellipses and splines can.
 *
 *  - `setConstruction(draft, ids, to)`: set the flag (`true`/`false`) or flip it (`'toggle'`) on the entities. A `false`
 *    result removes the key, so a normal entity is written exactly as before the flag existed.
 *  - `markNewAsConstruction(prev, next)`: the per-sketch "draw as construction" mode. Every shape a tool added in
 *    this step (entities in `next` that `prev` does not have) gets the flag. The app applies it after each tool step
 *    while the mode is on; the mode itself is UI state and is not saved in the sketch.
 *  - `constructionTool`: click a line, arc, circle, ellipse or spline to flip it between normal and construction; the
 *    tool stays active. Shift-click flips every entity connected end to end to it.
 */
import type { SketchDraft } from '../index';
import { entityOf } from './edit-draft';
import { chainOf } from './offset';
import { entityShape } from '../select';
import type { PreviewShape, Tool, ToolOutput } from './types';

export const CONSTRUCTIBLE = new Set(['line', 'circle', 'arc', 'ellipse', 'spline', 'cvspline']);

export function setConstruction(draft: SketchDraft, ids: string[], to: boolean | 'toggle'): SketchDraft {
  const want = new Set(ids);
  return {
    ...draft,
    entities: draft.entities.map((e) => {
      if (!want.has(e.id) || !CONSTRUCTIBLE.has(String(e.type))) return e;
      const on = to === 'toggle' ? !e.construction : to;
      if (on) return e.construction === true ? e : { ...e, construction: true };
      if (!e.construction) return e;
      const { construction: _c, ...rest } = e;
      return rest as typeof e;
    }),
  };
}

export function markNewAsConstruction(prev: SketchDraft, next: SketchDraft): SketchDraft {
  const had = new Set(prev.entities.map((e) => e.id));
  const fresh = next.entities.filter((e) => !had.has(e.id) && CONSTRUCTIBLE.has(String(e.type)) && !e.construction).map((e) => e.id);
  return fresh.length ? setConstruction(next, fresh, true) : next;
}

export type ConstructionState = Record<string, never>;

const view = (draft: SketchDraft, hint?: string, preview: PreviewShape[] = []): ToolOutput<ConstructionState> =>
  ({ state: {}, draft, preview, fields: [], ...(hint ? { hint } : {}) });

export const constructionTool: Tool<ConstructionState> = {
  id: 'construction',
  start: () => ({}),
  step(_state, ev, draft) {
    switch (ev.type) {
      case 'move': {
        const id = ev.snap?.entityId;
        const e = id ? entityOf(draft, id) : undefined;
        return view(draft, undefined, e && CONSTRUCTIBLE.has(String(e.type)) ? (entityShape(draft, e.id) as PreviewShape[]) : []);
      }
      case 'click': {
        const id = ev.snap?.entityId;
        const e = id ? entityOf(draft, id) : undefined;
        if (!e || !CONSTRUCTIBLE.has(String(e.type))) return view(draft, 'app.sketch.hint.pickCurve');
        const ids = ev.mods.shift && (e.type === 'line' || e.type === 'arc') ? chainOf(draft, e.id) : [e.id];
        return view(setConstruction(draft, ids, 'toggle'));
      }
      default:
        return view(draft);
    }
  },
};
