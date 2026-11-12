/**
 * Rectangle by two corners. First click sets a corner, second click the opposite one. Typed width and height
 * (committed with Tab or Enter) become `distance` constraints. The four lines get horizontal and vertical
 * constraints, so the rectangle stays axis-aligned however it is dragged later. Holding Alt makes it a square: both
 * sides take the longer of the pointer's two offsets (or a typed size, which the other side then follows).
 *
 * `roundedRectangleTool` is the same with a corner radius field `r`: the plain rectangle is drawn (always from a new
 * corner point, never one that is already in use) and its four corners are rounded with the Fillet tool's own edit, so the
 * result is the constraint set Fillet writes (a tangent at every joint, a `radius` on each arc once the radius was typed).
 * The radius stays for the next rectangle; one not typed is held to 0.49 of the shorter side, a typed one that is too large
 * is refused with `app.sketch.hint.radiusTooLarge`.
 */
import type { SketchDraft } from '../index';
import { addConstraintOf, addLine, addPoint } from './builders';
import { applyCorners, cornerAtPoint, DEFAULT_AMOUNT } from './corner';
import type { FieldSpec, PreviewShape, Pt, Tool, ToolOutput, ToolSettings } from './types';

export interface RectState {
  corner?: { at: Pt; pointId?: string };
  locked: { w?: number; h?: number; r?: number };
  live: { w?: number; h?: number; r?: number };
  /** The corner radius of the rounded rectangle, kept for the next one. */
  radius?: number;
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

/** The corner radius in use: a typed one, else the kept one held to 0.49 of the shorter side. */
export const cornerRadius = (s: RectState, w: number, h: number): number => eff(s).r ?? Math.min(s.radius ?? DEFAULT_AMOUNT, 0.49 * Math.min(w, h));

function roundedOutline(corners: Pt[], r: number): PreviewShape[] {
  const out: PreviewShape[] = [];
  const n = corners.length;
  for (let i = 0; i < n; i++) {
    const c = corners[i], prev = corners[(i + n - 1) % n], next = corners[(i + 1) % n];
    const u = unit(prev, c), v = unit(next, c);   // from the corner back along each side
    const t1 = { x: c.x + u.x * r, y: c.y + u.y * r }, t2 = { x: c.x + v.x * r, y: c.y + v.y * r };
    const ctr = { x: c.x + (u.x + v.x) * r, y: c.y + (u.y + v.y) * r };
    const a1 = Math.atan2(t1.y - ctr.y, t1.x - ctr.x);
    let d = Math.atan2(t2.y - ctr.y, t2.x - ctr.x) - a1;
    if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
    let last = t1;
    for (let k = 1; k <= 8; k++) { const a = a1 + (d * k) / 8; const q = { x: ctr.x + r * Math.cos(a), y: ctr.y + r * Math.sin(a) }; out.push({ kind: 'line', a: last, b: q }); last = q; }
    const nt = corners[(i + 1) % n], nu = unit(c, nt);
    out.push({ kind: 'line', a: last, b: { x: nt.x + nu.x * r, y: nt.y + nu.y * r } });
  }
  return out;
}
const unit = (from: Pt, to: Pt): Pt => { const l = Math.hypot(from.x - to.x, from.y - to.y) || 1; return { x: (from.x - to.x) / l, y: (from.y - to.y) / l }; };

function view(state: RectState, draft: SketchDraft, settings: ToolSettings, hint?: string, rounded = false): ToolOutput<RectState> {
  const o = opposite(state);
  if (!o || !state.corner) return { state, draft, preview: [], fields: [], hint };
  const { x, y } = state.corner.at;
  const corners: Pt[] = [{ x, y }, { x: o.x1, y }, { x: o.x1, y: o.y1 }, { x, y: o.y1 }];
  const r = rounded ? cornerRadius(state, o.w, o.h) : 0;
  const preview: PreviewShape[] = rounded && r > 1e-9 && r <= 0.5 * Math.min(o.w, o.h) + 1e-9 ? roundedOutline(corners, r) : corners.map((a, i) => ({ kind: 'line' as const, a, b: corners[(i + 1) % 4] }));
  const fields: FieldSpec[] = settings.onViewValues === 'off' ? [] : [
    { id: 'w', label: 'app.sketch.field.width', value: o.w, locked: state.locked.w !== undefined, unit: 'length' },
    { id: 'h', label: 'app.sketch.field.height', value: o.h, locked: state.locked.h !== undefined, unit: 'length' },
    ...(rounded ? [{ id: 'r', label: 'app.sketch.field.cornerRadius', value: r, locked: state.locked.r !== undefined, unit: 'length' } as FieldSpec] : []),
  ];
  return { state, draft, preview, fields, hint };
}

function commit(state: RectState, draft: SketchDraft, settings: ToolSettings, rounded: boolean): ToolOutput<RectState> {
  const o = opposite(state);
  if (!o || !state.corner || o.w < 1e-9 || o.h < 1e-9) return view(state, draft, settings, 'app.sketch.hint.degenerate', rounded);
  const r = rounded ? cornerRadius(state, o.w, o.h) : 0;
  if (rounded && (r > 0.5 * Math.min(o.w, o.h) + 1e-9)) return view(state, draft, settings, 'app.sketch.hint.radiusTooLarge', rounded);
  const { x, y } = state.corner.at;
  let d = draft;
  let p1 = rounded ? undefined : state.corner.pointId;   // a rounded corner is cut off, so it cannot be a point that other geometry uses
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
  let radius = state.radius;
  if (rounded && r > 1e-9) {
    const specs = ids.map((id) => cornerAtPoint(d, id)).filter((c): c is NonNullable<typeof c> => !!c);
    const res = applyCorners(d, specs, 'fillet', r, state.locked.r !== undefined);
    if (!res.ok) return view(state, draft, settings, res.hint, rounded);
    d = res.draft;
    if (state.locked.r !== undefined) radius = state.locked.r;
  }
  return view({ locked: {}, live: {}, ...(radius !== undefined ? { radius } : {}), ...(state.cursor ? { cursor: state.cursor } : {}) }, d, settings, undefined, rounded);
}

function makeRectangleTool(id: string, rounded: boolean): Tool<RectState> {
  const fresh = (s?: RectState): RectState => ({ locked: {}, live: {}, ...(s?.radius !== undefined ? { radius: s.radius } : {}) });
  return {
    id,
    start: () => ({ locked: {}, live: {} }),
    step(state, ev, draft, settings) {
      switch (ev.type) {
        case 'move': return view({ ...state, cursor: ev.snap?.at ?? ev.at, square: ev.mods.alt }, draft, settings, undefined, rounded);
        case 'click': {
          const at = ev.snap?.at ?? ev.at;
          if (!state.corner) return view({ ...state, corner: { at, ...(ev.snap?.pointId ? { pointId: ev.snap.pointId } : {}) }, cursor: at }, draft, settings, undefined, rounded);
          return commit({ ...state, cursor: at, square: ev.mods.alt }, draft, settings, rounded);
        }
        case 'field': {
          if (!state.corner) return view(state, draft, settings, undefined, rounded);
          const key = ev.id === 'w' ? 'w' : ev.id === 'h' ? 'h' : ev.id === 'r' && rounded ? 'r' : null;
          if (!key) return view(state, draft, settings, undefined, rounded);
          const locked = { ...state.locked };
          const live = { ...state.live };
          if (ev.value === null || !Number.isFinite(ev.value) || ev.value <= 0) { delete locked[key]; delete live[key]; }
          else if (ev.commit) { locked[key] = ev.value; delete live[key]; }
          else live[key] = ev.value;
          const next = { ...state, locked, live };
          if (ev.commit && locked.w !== undefined && locked.h !== undefined) return commit(next, draft, settings, rounded);
          return view(next, draft, settings, undefined, rounded);
        }
        case 'key': {
          if (ev.key !== 'Escape') return view(state, draft, settings, undefined, rounded);
          if (Object.keys(state.locked).length || Object.keys(state.live).length) return view({ ...state, locked: {}, live: {} }, draft, settings, undefined, rounded);
          return view(fresh(state), draft, settings, undefined, rounded);
        }
      }
    },
  };
}

export const rectangleTool = makeRectangleTool('rectangle', false);
export const roundedRectangleTool = makeRectangleTool('rounded-rectangle', true);
