/**
 * Text tool. A click places a text entity (default string, gauge font, 5 mm cap height) anchored at the clicked point; clicking an
 * existing sketch point (snap.pointId) anchors it there. The entity is in the draft at once, so the sketch shows it and the text panel
 * (string, size, font, anchor grid, angle, spacing, mirror, on arc) edits it live; the app then drops to Select mode with the new
 * entity selected. Kernel convention: entity `text {string, font, height, p, anchor}`; the anchor is the sketch point `p`.
 */
import type { SketchDraft } from '../index';
import { addText } from '../text';
import type { Pt, Tool, ToolOutput } from './types';

export interface TextState { cursor?: Pt; placed?: string }

export const textTool: Tool<TextState> = {
  id: 'text',
  start: () => ({}),
  step(state, ev, draft) {
    const out = (s: TextState, d: SketchDraft, hint?: string): ToolOutput<TextState> => ({ state: s, draft: d, preview: [], fields: [], hint });
    switch (ev.type) {
      case 'move': return out({ ...state, cursor: ev.snap?.at ?? ev.at }, draft, 'app.sketch.hint.textPlace');
      case 'click': {
        const at = ev.snap?.at ?? ev.at;
        const r = addText(draft, at, { pointId: ev.snap?.pointId });
        return out({ cursor: at, placed: r.id }, r.draft);
      }
      default: return out(state, draft, 'app.sketch.hint.textPlace');
    }
  },
};
