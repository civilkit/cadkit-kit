/**
 * Equation curve tool. A click adds an equation curve (a spline from x(t), y(t); default a wave starting at the clicked point);
 * the kernel fits its points, and the app drops to Select mode with the new entity picked, so the Equation panel edits the formulas
 * with a preview. Kernel convention: entity `spline {pts:[], equation:{x, y, t, tol}}` (docs/equation-curve.md).
 */
import type { SketchDraft } from '../index';
import { addEquation } from '../equation';
import type { Pt, Tool, ToolOutput } from './types';

export interface EquationState { cursor?: Pt; placed?: string }

export const equationTool: Tool<EquationState> = {
  id: 'equation',
  start: () => ({}),
  step(state, ev, draft) {
    const out = (s: EquationState, d: SketchDraft, hint?: string): ToolOutput<EquationState> => ({ state: s, draft: d, preview: [], fields: [], hint });
    switch (ev.type) {
      case 'move': return out({ ...state, cursor: ev.snap?.at ?? ev.at }, draft, 'app.sketch.hint.equationPlace');
      case 'click': {
        const at = ev.snap?.at ?? ev.at;
        const r = addEquation(draft, at);
        return out({ cursor: at, placed: r.id }, r.draft);
      }
      default: return out(state, draft, 'app.sketch.hint.equationPlace');
    }
  },
};
