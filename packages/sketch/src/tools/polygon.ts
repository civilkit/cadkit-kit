/**
 * Regular polygon by centre and radius. Click the centre, then a second point: its distance is the radius and its
 * direction the rotation. `mode: 'inscribed'` puts a vertex at the pointer (radius = circumradius); `'circumscribed'`
 * puts the midpoint of an edge there (radius = apothem, the circle touches every side). The side count lives in the
 * state (default 6) and is changed with the keys `+` / `-` or a `sides` field event; `m` toggles the mode. Both persist
 * after a polygon is drawn and through Escape.
 *
 * Built from N lines sharing N vertex points (a closed profile), plus the centre as a free point. Constraints:
 * `equal refs=[lineA,lineB]` between consecutive sides (verified in solver.rs: for lines it equates lengths; N-1 of
 * them, so none is redundant) and, for an inscribed polygon with a committed radius, `distance refs=[centre,vertex0]`.
 * A committed radius on a circumscribed polygon, and any typed angle, pin the geometry only (no kernel constraint
 * expresses an apothem). No circle is added: tying the vertices to one needs a point-on-circle convention that was
 * not verified. Sides < 3 or a zero radius is refused with a hint.
 */
import type { SketchDraft } from '../index';
import { addConstraintOf, addLine, addPoint } from './builders';
import { segmentEnd } from './geometry';
import { applyLock, hasValues } from './shape-helpers';
import type { FieldSpec, Modifiers, Pt, Tool, ToolOutput, ToolSettings } from './types';

export type PolygonMode = 'inscribed' | 'circumscribed';
export const MIN_SIDES = 3;
export const MAX_SIDES = 128;

export interface PolygonState {
  sides: number;
  mode: PolygonMode;
  centre?: { at: Pt; pointId?: string };
  locked: { r?: number; ang?: number };
  live: { r?: number; ang?: number };
  cursor?: Pt;
  mods: Modifiers;
}

const NO_MODS: Modifiers = { shift: false, ctrl: false, alt: false };
const merged = (s: PolygonState) => ({ ...s.live, ...s.locked });
const reset = (s: PolygonState): PolygonState => ({ sides: s.sides, mode: s.mode, locked: {}, live: {}, mods: s.mods, ...(s.cursor ? { cursor: s.cursor } : {}) });
const validSides = (n: number) => Number.isInteger(n) && n >= MIN_SIDES && n <= MAX_SIDES;

/** Vertices of the polygon for the pointer-derived `radius` and `angDeg` (direction of the vertex or edge midpoint). */
export function polygonVertices(c: Pt, radius: number, angDeg: number, sides: number, mode: PolygonMode): Pt[] {
  const R = mode === 'inscribed' ? radius : radius / Math.cos(Math.PI / sides);
  const a0 = (angDeg * Math.PI) / 180 - (mode === 'inscribed' ? 0 : Math.PI / sides);
  const out: Pt[] = [];
  for (let i = 0; i < sides; i++) { const t = a0 + (2 * Math.PI * i) / sides; out.push({ x: c.x + R * Math.cos(t), y: c.y + R * Math.sin(t) }); }
  return out;
}

function measure(s: PolygonState, settings: ToolSettings) {
  const m = merged(s);
  // direction and length from the pointer (Ctrl angle step and typed locks); H/V inference has no meaning here
  return segmentEnd(s.centre!.at, s.cursor!, s.mods, { ...settings, autoConstraints: false }, { len: m.r, ang: m.ang });
}

function view(state: PolygonState, draft: SketchDraft, settings: ToolSettings, hint?: string): ToolOutput<PolygonState> {
  if (!validSides(state.sides)) return { state, draft, preview: [], fields: [], hint: 'app.sketch.hint.sides' };
  const sidesField: FieldSpec = { id: 'sides', label: 'app.sketch.field.sides', value: state.sides, locked: false, unit: 'count' };
  if (!state.centre || !state.cursor) return { state, draft, preview: [], fields: settings.onViewValues === 'off' ? [] : [sidesField], hint };
  const r = measure(state, settings);
  const c = state.centre.at;
  const v = r.len > 1e-9 ? polygonVertices(c, r.len, r.ang, state.sides, state.mode) : [];
  const edges = v.map((a, i) => ({ kind: 'line' as const, a, b: v[(i + 1) % v.length] }));
  const shapes = r.len > 1e-9 ? [{ kind: 'circle' as const, c, r: r.len }, ...edges] : edges;
  const fields: FieldSpec[] = settings.onViewValues === 'off' ? [] : [
    { id: 'r', label: state.mode === 'inscribed' ? 'app.sketch.field.circumradius' : 'app.sketch.field.apothem', value: r.len, locked: state.locked.r !== undefined, unit: 'length' },
    { id: 'ang', label: 'app.sketch.field.angle', value: r.ang, locked: state.locked.ang !== undefined, unit: 'angle' },
    sidesField,
  ];
  return { state, draft, preview: shapes, fields, hint };
}

function commit(state: PolygonState, draft: SketchDraft, settings: ToolSettings): ToolOutput<PolygonState> {
  if (!validSides(state.sides)) return view(state, draft, settings);
  const r = measure(state, settings);
  if (r.len < 1e-9) return view(state, draft, settings, 'app.sketch.hint.degenerate');
  let d = draft;
  let c = state.centre!.pointId;
  if (!c) { const a = addPoint(d, state.centre!.at); d = a.draft; c = a.id; }
  const ids: string[] = [];
  for (const q of polygonVertices(state.centre!.at, r.len, r.ang, state.sides, state.mode)) { const a = addPoint(d, q); d = a.draft; ids.push(a.id); }
  const lines: string[] = [];
  for (let i = 0; i < ids.length; i++) { const l = addLine(d, ids[i], ids[(i + 1) % ids.length]); d = l.draft; lines.push(l.id); }
  for (let i = 0; i + 1 < lines.length; i++) d = addConstraintOf(d, 'equal', [lines[i], lines[i + 1]]);
  if (state.mode === 'inscribed' && state.locked.r !== undefined) d = addConstraintOf(d, 'distance', [c, ids[0]], state.locked.r);
  return view(reset(state), d, settings);
}

export const polygonTool: Tool<PolygonState> = {
  id: 'polygon',
  start: () => ({ sides: 6, mode: 'inscribed', locked: {}, live: {}, mods: NO_MODS }),
  step(state, ev, draft, settings) {
    switch (ev.type) {
      case 'move': return view({ ...state, cursor: ev.snap?.at ?? ev.at, mods: ev.mods }, draft, settings);
      case 'click': {
        const w: PolygonState = { ...state, cursor: ev.snap?.at ?? ev.at, mods: ev.mods };
        if (!state.centre) return view({ ...w, centre: { at: w.cursor!, ...(ev.snap?.pointId ? { pointId: ev.snap.pointId } : {}) } }, draft, settings);
        return commit(w, draft, settings);
      }
      case 'field': {
        if (ev.id === 'sides') {
          if (ev.value === null || !Number.isFinite(ev.value)) return view(state, draft, settings);
          return view({ ...state, sides: Math.round(ev.value) }, draft, settings);
        }
        if (!state.centre) return view(state, draft, settings);
        const key = ev.id === 'r' ? 'r' : ev.id === 'ang' ? 'ang' : null;
        if (!key) return view(state, draft, settings);
        const next = { ...state, ...applyLock(state.locked, state.live, key, ev, key === 'r') };
        if (ev.commit && next.locked.r !== undefined && next.locked.ang !== undefined && state.cursor) return commit(next, draft, settings);
        return view(next, draft, settings);
      }
      case 'key': {
        if (ev.key === '+' || ev.key === '=') return view({ ...state, sides: Math.min(MAX_SIDES, state.sides + 1) }, draft, settings);
        if (ev.key === '-') return view({ ...state, sides: Math.max(MIN_SIDES, state.sides - 1) }, draft, settings);
        if (ev.key === 'm') return view({ ...state, mode: state.mode === 'inscribed' ? 'circumscribed' : 'inscribed' }, draft, settings);
        if (ev.key !== 'Escape') return view(state, draft, settings);
        if (hasValues(state.locked, state.live)) return view({ ...state, locked: {}, live: {} }, draft, settings);
        return view({ sides: state.sides, mode: state.mode, locked: {}, live: {}, mods: state.mods }, draft, settings);
      }
    }
  },
};
