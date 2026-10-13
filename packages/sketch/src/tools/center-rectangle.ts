/**
 * Rectangle by centre. First click sets the centre, second click a corner; the rectangle is symmetric about the
 * centre, so the pointer's offset from the centre is the half width and half height. Typed width and height (full
 * sizes, committed with Tab or Enter) become `distance` constraints on two adjacent sides. The four lines get
 * horizontal and vertical constraints like rectangle.ts. The centre is kept as a free sketch point (a snap target);
 * it is not tied to the rectangle by a constraint (no midpoint symmetry yet).
 *
 * Kernel conventions used: horizontal/vertical refs=[lineId], distance refs=[p1,p2] + value.
 */
import type { SketchDraft } from '../index';
import { addConstraintOf, addLine, addPoint } from './builders';
import { applyLock, hasValues } from './shape-helpers';
import type { FieldSpec, Pt, Tool, ToolOutput, ToolSettings } from './types';

export interface CenterRectState {
  centre?: { at: Pt; pointId?: string };
  locked: { w?: number; h?: number };
  live: { w?: number; h?: number };
  cursor?: Pt;
}

const eff = (s: CenterRectState) => ({ ...s.live, ...s.locked });

function extent(s: CenterRectState): { hw: number; hh: number } | null {
  if (!s.centre || !s.cursor) return null;
  const e = eff(s);
  return {
    hw: e.w !== undefined ? e.w / 2 : Math.abs(s.cursor.x - s.centre.at.x),
    hh: e.h !== undefined ? e.h / 2 : Math.abs(s.cursor.y - s.centre.at.y),
  };
}

function view(state: CenterRectState, draft: SketchDraft, settings: ToolSettings, hint?: string): ToolOutput<CenterRectState> {
  const o = extent(state);
  if (!o || !state.centre) return { state, draft, preview: [], fields: [], hint };
  const { x, y } = state.centre.at;
  const corners: Pt[] = [{ x: x - o.hw, y: y - o.hh }, { x: x + o.hw, y: y - o.hh }, { x: x + o.hw, y: y + o.hh }, { x: x - o.hw, y: y + o.hh }];
  const preview = corners.map((a, i) => ({ kind: 'line' as const, a, b: corners[(i + 1) % 4] }));
  const fields: FieldSpec[] = settings.onViewValues === 'off' ? [] : [
    { id: 'w', label: 'app.sketch.field.width', value: o.hw * 2, locked: state.locked.w !== undefined, unit: 'length' },
    { id: 'h', label: 'app.sketch.field.height', value: o.hh * 2, locked: state.locked.h !== undefined, unit: 'length' },
  ];
  return { state, draft, preview, fields, hint };
}

function commit(state: CenterRectState, draft: SketchDraft, settings: ToolSettings): ToolOutput<CenterRectState> {
  const o = extent(state);
  if (!o || !state.centre || o.hw < 1e-9 || o.hh < 1e-9) return view(state, draft, settings, 'app.sketch.hint.degenerate');
  const { x, y } = state.centre.at;
  let d = draft;
  let c = state.centre.pointId;
  if (!c) { const a = addPoint(d, { x, y }); d = a.draft; c = a.id; }
  const ids: string[] = [];
  for (const q of [{ x: x - o.hw, y: y - o.hh }, { x: x + o.hw, y: y - o.hh }, { x: x + o.hw, y: y + o.hh }, { x: x - o.hw, y: y + o.hh }]) {
    const a = addPoint(d, q); d = a.draft; ids.push(a.id);
  }
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

export const centerRectangleTool: Tool<CenterRectState> = {
  id: 'center-rectangle',
  start: () => ({ locked: {}, live: {} }),
  step(state, ev, draft, settings) {
    switch (ev.type) {
      case 'move': return view({ ...state, cursor: ev.snap?.at ?? ev.at }, draft, settings);
      case 'click': {
        const at = ev.snap?.at ?? ev.at;
        if (!state.centre) return view({ ...state, centre: { at, ...(ev.snap?.pointId ? { pointId: ev.snap.pointId } : {}) }, cursor: at }, draft, settings);
        return commit({ ...state, cursor: at }, draft, settings);
      }
      case 'field': {
        if (!state.centre) return view(state, draft, settings);
        const key = ev.id === 'w' ? 'w' : ev.id === 'h' ? 'h' : null;
        if (!key) return view(state, draft, settings);
        const next = { ...state, ...applyLock(state.locked, state.live, key, ev) };
        if (ev.commit && next.locked.w !== undefined && next.locked.h !== undefined) return commit(next, draft, settings);
        return view(next, draft, settings);
      }
      case 'key': {
        if (ev.key !== 'Escape') return view(state, draft, settings);
        if (hasValues(state.locked, state.live)) return view({ ...state, locked: {}, live: {} }, draft, settings);
        return view({ locked: {}, live: {} }, draft, settings);
      }
    }
  },
};
