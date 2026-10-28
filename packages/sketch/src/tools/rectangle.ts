/**
 * Rectangle by two corners. First click sets a corner, second click the opposite one. Typed width and height
 * (committed with Tab or Enter) become `distance` constraints. The four lines get horizontal and vertical
 * constraints, so the rectangle stays axis-aligned however it is dragged later. Holding Alt makes it a square: both
 * sides take the longer of the pointer's two offsets (or a typed size, which the other side then follows).
 */
import type { SketchDraft } from '../index';
import { addConstraintOf, addLine, addPoint } from './builders';
import type { FieldSpec, Pt, Tool, ToolOutput, ToolSettings } from './types';

export interface RectState {
  corner?: { at: Pt; pointId?: string };
  locked: { w?: number; h?: number };
  live: { w?: number; h?: number };
  cursor?: Pt;
  /** Alt was held at the last pointer event */
  square?: boolean;
}

const sign = (v: number) => (v < 0 ? -1 : 1);
const eff = (s: RectState) => ({ ...s.live, ...s.locked });

function opposite(s: RectState): { x1: number; y1: number; w: number; h: number } | null {
  if (!s.corner || !s.cursor) return null;
  const { at } = s.corner;
  const e = eff(s);
  const side = e.w ?? e.h ?? Math.max(Math.abs(s.cursor.x - at.x), Math.abs(s.cursor.y - at.y));
  const w = e.w ?? (s.square ? side : Math.abs(s.cursor.x - at.x));
  const h = e.h ?? (s.square ? side : Math.abs(s.cursor.y - at.y));
  return { x1: at.x + sign(s.cursor.x - at.x) * w, y1: at.y + sign(s.cursor.y - at.y) * h, w, h };
}

function view(state: RectState, draft: SketchDraft, settings: ToolSettings, hint?: string): ToolOutput<RectState> {
  const o = opposite(state);
  if (!o || !state.corner) return { state, draft, preview: [], fields: [], hint };
  const { x, y } = state.corner.at;
  const corners: Pt[] = [{ x, y }, { x: o.x1, y }, { x: o.x1, y: o.y1 }, { x, y: o.y1 }];
  const preview = corners.map((a, i) => ({ kind: 'line' as const, a, b: corners[(i + 1) % 4] }));
  const fields: FieldSpec[] = settings.onViewValues === 'off' ? [] : [
    { id: 'w', label: 'app.sketch.field.width', value: o.w, locked: state.locked.w !== undefined, unit: 'length' },
    { id: 'h', label: 'app.sketch.field.height', value: o.h, locked: state.locked.h !== undefined, unit: 'length' },
  ];
  return { state, draft, preview, fields, hint };
}

function commit(state: RectState, draft: SketchDraft, settings: ToolSettings): ToolOutput<RectState> {
  const o = opposite(state);
  if (!o || !state.corner || o.w < 1e-9 || o.h < 1e-9) return view(state, draft, settings, 'app.sketch.hint.degenerate');
  const { x, y } = state.corner.at;
  let d = draft;
  let p1 = state.corner.pointId;
  if (!p1) { const a = addPoint(d, { x, y }); d = a.draft; p1 = a.id; }
  const a2 = addPoint(d, { x: o.x1, y }); d = a2.draft;
  const a3 = addPoint(d, { x: o.x1, y: o.y1 }); d = a3.draft;
  const a4 = addPoint(d, { x, y: o.y1 }); d = a4.draft;
  const ids = [p1, a2.id, a3.id, a4.id];
  const lines: string[] = [];
  for (let i = 0; i < 4; i++) { const l = addLine(d, ids[i], ids[(i + 1) % 4]); d = l.draft; lines.push(l.id); }
  d = addConstraintOf(d, 'horizontal', [lines[0]]);
  d = addConstraintOf(d, 'vertical', [lines[1]]);
  d = addConstraintOf(d, 'horizontal', [lines[2]]);
  d = addConstraintOf(d, 'vertical', [lines[3]]);
  if (state.locked.w !== undefined) d = addConstraintOf(d, 'distance', [ids[0], ids[1]], state.locked.w);
  if (state.locked.h !== undefined) d = addConstraintOf(d, 'distance', [ids[1], ids[2]], state.locked.h);
  return view({ locked: {}, live: {}, ...(state.cursor ? { cursor: state.cursor } : {}) }, d, settings);
}

export const rectangleTool: Tool<RectState> = {
  id: 'rectangle',
  start: () => ({ locked: {}, live: {} }),
  step(state, ev, draft, settings) {
    switch (ev.type) {
      case 'move': return view({ ...state, cursor: ev.snap?.at ?? ev.at, square: ev.mods.alt }, draft, settings);
      case 'click': {
        const at = ev.snap?.at ?? ev.at;
        if (!state.corner) return view({ ...state, corner: { at, ...(ev.snap?.pointId ? { pointId: ev.snap.pointId } : {}) }, cursor: at }, draft, settings);
        return commit({ ...state, cursor: at, square: ev.mods.alt }, draft, settings);
      }
      case 'field': {
        if (!state.corner) return view(state, draft, settings);
        const key = ev.id === 'w' ? 'w' : ev.id === 'h' ? 'h' : null;
        if (!key) return view(state, draft, settings);
        const locked = { ...state.locked };
        const live = { ...state.live };
        if (ev.value === null || !Number.isFinite(ev.value) || ev.value <= 0) { delete locked[key]; delete live[key]; }
        else if (ev.commit) { locked[key] = ev.value; delete live[key]; }
        else live[key] = ev.value;
        const next = { ...state, locked, live };
        if (ev.commit && locked.w !== undefined && locked.h !== undefined) return commit(next, draft, settings);
        return view(next, draft, settings);
      }
      case 'key': {
        if (ev.key !== 'Escape') return view(state, draft, settings);
        if (Object.keys(state.locked).length || Object.keys(state.live).length) return view({ ...state, locked: {}, live: {} }, draft, settings);
        return view({ locked: {}, live: {} }, draft, settings);
      }
    }
  },
};
