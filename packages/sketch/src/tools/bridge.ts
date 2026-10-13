/**
 * Bridge curve: a smooth curve joining two open curve ends. Click a free end of one curve, then a free end of
 * another; the tool writes a control-point spline from the first end to the second plus the kernel's continuity
 * constraints at both ends. Keys `1` / `2` (or the `continuity` field, value 1 or 2) switch tangent (G1, default) and
 * curvature (G2) continuity; Escape drops the first pick.
 *
 * Kernel convention (ck-model sketch/solver.rs `continuity`, sketch/smooth.rs; confirmed by the real-kernel test):
 *   - the bridge is `{type:'cvspline', pts:[A, ..., B], degree}` and its first and last control points ARE the two
 *     curve-end point ids, so it joins the curves topologically (no coincident constraint is needed);
 *   - the constraint is `{type:'g1'|'g2', refs:[bridgeId, otherEntityId], at: endPointId}`: `refs[0]` must be an OPEN
 *     cvspline, `at` must be one of its two end points, and `refs[1]` may be a line, arc, circle, ellipse, spline or
 *     cvspline (an end relation to a point entity is an error). One constraint per end; g2 also implies the g1 tangent
 *     equation, g3 exists but the tool does not use it.
 *   - a continuity constraint needs the bridge's first (level+1) control points free to move: g1 constrains the first
 *     two control points of that end, g2 the first three.
 *
 * Why the control points are placed analytically here: the kernel's regen does NOT move sketch points to satisfy
 * constraints (it only re-solves when an `expr` value changed), and no solve request is exposed to the front end, so
 * the sketch comes back exactly as drawn with a status (`residual`, `solved`). The tool therefore puts the control
 * points where the constraints already hold: G1 uses a cubic with its inner control points on the end tangents; G2
 * uses a quintic Bezier (6 control points, kernel degree 5, default knots make it a single span) whose first three and
 * last three control points reproduce the curvature of the curve at that end. Curvature is known for lines (0), arcs
 * (1/r) and open fit splines (0, natural ends); a control-point spline end only supports G1.
 * Neither original curve is fixed by this tool; if a later solve moves them, the constraints keep the join smooth.
 *
 * The preview type has line segments only, so the bridge is previewed as its sampled curve in line segments.
 */
import type { DraftEntity, SketchDraft } from '../index';
import { addConstraint } from '../index';
import { nextId, pointOf } from './builders';
import { bsplineCurve, fitEndDerivative } from './splineMath';
import type { PreviewShape, Pt, Tool, ToolOutput, ToolSettings } from './types';

export type Continuity = 1 | 2;

export interface BridgeEnd { pointId: string; entityId: string }

export interface BridgeState {
  first?: BridgeEnd;
  continuity: Continuity;
  cursor?: Pt;
  snapPoint?: { id: string; at: Pt };
  mods: { shift: boolean; ctrl: boolean; alt: boolean };
}

/** The geometry of a curve end: where it is, the direction the curve would continue in, and the signed curvature of that continuation (left turn positive), when known. */
export interface EndGeom { at: Pt; out: Pt; curvature?: number }

const NO_MODS = { shift: false, ctrl: false, alt: false };
const unit = (v: Pt): Pt | null => { const l = Math.hypot(v.x, v.y); return l > 1e-12 ? { x: v.x / l, y: v.y / l } : null; };
const left = (v: Pt): Pt => ({ x: -v.y, y: v.x });
const add = (a: Pt, v: Pt, k = 1): Pt => ({ x: a.x + v.x * k, y: a.y + v.y * k });

/** Entities that have this point as an open end, with the end's geometry; `null` geometry when the end is degenerate. */
export function endsAt(draft: SketchDraft, pointId: string): Array<{ entity: DraftEntity; geom: EndGeom | null }> {
  const out: Array<{ entity: DraftEntity; geom: EndGeom | null }> = [];
  const at = (id: string): Pt => pointOf(draft, id);
  for (const e of draft.entities) {
    if (e.construction) continue;
    if (e.type === 'line' && (e.p1 === pointId || e.p2 === pointId)) {
      const here = e.p1 === pointId ? e.p1 : e.p2; const other = e.p1 === pointId ? e.p2 : e.p1;
      const o = unit({ x: at(here as string).x - at(other as string).x, y: at(here as string).y - at(other as string).y });
      out.push({ entity: e, geom: o ? { at: at(pointId), out: o, curvature: 0 } : null });
    } else if (e.type === 'arc' && (e.p1 === pointId || e.p2 === pointId)) {
      // the kernel sweeps arcs counter-clockwise from p1 to p2 about c
      const c = at(e.c as string); const p = at(pointId);
      const r = Math.hypot(p.x - c.x, p.y - c.y);
      const radial = unit({ x: p.x - c.x, y: p.y - c.y });
      if (!radial || r < 1e-12) { out.push({ entity: e, geom: null }); continue; }
      const ccw = left(radial);
      const atEnd = e.p2 === pointId;
      out.push({ entity: e, geom: { at: p, out: atEnd ? ccw : { x: -ccw.x, y: -ccw.y }, curvature: (atEnd ? 1 : -1) / r } });
    } else if (e.type === 'spline' && !e.closed) {
      const ids = e.pts as string[];
      const isStart = ids[0] === pointId; const isEnd = ids[ids.length - 1] === pointId;
      if (!isStart && !isEnd) continue;
      const d = fitEndDerivative(ids.map(at), isStart ? 'start' : 'end');
      const o = d ? unit(isStart ? { x: -d.x, y: -d.y } : d) : null;
      out.push({ entity: e, geom: o ? { at: at(pointId), out: o, curvature: 0 } : null });
    } else if (e.type === 'cvspline' && !e.closed) {
      const ids = e.pts as string[];
      const isStart = ids[0] === pointId; const isEnd = ids[ids.length - 1] === pointId;
      if (!isStart && !isEnd) continue;
      const seq = isStart ? ids : [...ids].reverse();
      const here = at(seq[0]);
      // the clamped end tangent runs to the first control point that differs from the end
      let o: Pt | null = null;
      for (let i = 1; i < seq.length && !o; i++) o = unit({ x: here.x - at(seq[i]).x, y: here.y - at(seq[i]).y });
      out.push({ entity: e, geom: o ? { at: here, out: o } : null });
    }
  }
  return out;
}

export interface BridgeShape { pts: Pt[]; degree: number }

/** Control points of the bridge from end `a` to end `b`, or the hint key saying why there is none. */
export function bridgeShape(a: EndGeom, b: EndGeom, continuity: Continuity): BridgeShape | { hint: string } {
  const gap = Math.hypot(b.at.x - a.at.x, b.at.y - a.at.y);
  if (gap < 1e-9) return { hint: 'app.sketch.hint.degenerate' };
  if (continuity === 1) {
    const t = gap / 3;
    return { pts: [a.at, add(a.at, a.out, t), add(b.at, b.out, t), b.at], degree: 3 };
  }
  if (a.curvature === undefined || b.curvature === undefined) return { hint: 'app.sketch.hint.bridgeCurvatureUnknown' };
  // quintic Bezier: P1 = P0 + a*T, P2 = P1 + a*T + h*N with h = (n/(n-1)) * k * a^2 = 1.25 k a^2 gives curvature k at P0
  const s = gap / 4;
  const inner = (e: EndGeom): Pt[] => {
    const p1 = add(e.at, e.out, s);
    return [p1, add(add(p1, e.out, s), left(e.out), 1.25 * e.curvature! * s * s)];
  };
  const [p1, p2] = inner(a); const [q1, q2] = inner(b);
  return { pts: [a.at, p1, p2, q2, q1, b.at], degree: 5 };
}

function pickEnd(draft: SketchDraft, pointId: string | undefined): { end: BridgeEnd; geom: EndGeom } | { hint: string } {
  if (!pointId) return { hint: 'app.sketch.hint.bridgeNeedsEnd' };
  const ends = endsAt(draft, pointId);
  // a point shared by two curves is a joint, not a free end
  if (ends.length !== 1) return { hint: 'app.sketch.hint.bridgeNeedsEnd' };
  const { entity, geom } = ends[0];
  if (!geom) return { hint: 'app.sketch.hint.degenerate' };
  return { end: { pointId, entityId: entity.id }, geom };
}

function view(state: BridgeState, draft: SketchDraft, hint?: string): ToolOutput<BridgeState> {
  if (!state.first || !state.cursor) return { state, draft, preview: [], fields: [], hint };
  const first = pickEnd(draft, state.first.pointId);
  if ('hint' in first) return { state, draft, preview: [], fields: [], hint: first.hint };
  const over = state.snapPoint && state.snapPoint.id !== state.first.pointId ? pickEnd(draft, state.snapPoint.id) : null;
  const line = (a: Pt, b: Pt): PreviewShape[] => [{ kind: 'line', a, b }];
  if (!over || 'hint' in over) return { state, draft, preview: line(first.geom.at, state.cursor), fields: [], hint };
  const shape = bridgeShape(first.geom, over.geom, state.continuity);
  if ('hint' in shape) return { state, draft, preview: line(first.geom.at, state.cursor), fields: [], hint: shape.hint };
  const curve = bsplineCurve(shape.pts, shape.degree, false, 64);
  const preview = curve.slice(1).map((b, i) => ({ kind: 'line' as const, a: curve[i], b }));
  return { state, draft, preview, fields: [], hint, pending: [`g${state.continuity}`, `g${state.continuity}`] };
}

export const bridgeTool: Tool<BridgeState> = {
  id: 'bridge',
  start: () => ({ continuity: 1, mods: NO_MODS }),
  step(state: BridgeState, ev, draft: SketchDraft, _settings: ToolSettings) {
    switch (ev.type) {
      case 'move':
        return view({ ...state, cursor: ev.snap?.at ?? ev.at, mods: ev.mods, snapPoint: ev.snap?.pointId ? { id: ev.snap.pointId, at: ev.snap.at } : undefined }, draft);
      case 'click': {
        const at = ev.snap?.at ?? ev.at;
        const s: BridgeState = { ...state, cursor: at, mods: ev.mods, snapPoint: ev.snap?.pointId ? { id: ev.snap.pointId, at } : undefined };
        const picked = pickEnd(draft, ev.snap?.pointId);
        if ('hint' in picked) return view(s, draft, picked.hint);
        if (!s.first) return view({ ...s, first: picked.end }, draft);
        if (picked.end.pointId === s.first.pointId) return view(s, draft, 'app.sketch.hint.degenerate');
        const first = pickEnd(draft, s.first.pointId);
        if ('hint' in first) return view({ ...s, first: undefined }, draft, first.hint);
        const shape = bridgeShape(first.geom, picked.geom, s.continuity);
        if ('hint' in shape) return view(s, draft, shape.hint);
        // inner control points are new sketch points; the two ends are the existing end points
        let d = draft;
        const ids = [s.first.pointId];
        for (const q of shape.pts.slice(1, -1)) {
          const id = nextId(d, 'p');
          d = { ...d, points: [...d.points, { id, x: q.x, y: q.y }] };
          ids.push(id);
        }
        ids.push(picked.end.pointId);
        const eid = nextId(d, 'e');
        d = { ...d, entities: [...d.entities, { id: eid, type: 'cvspline', pts: ids, degree: shape.degree }] };
        const type = `g${s.continuity}`;
        for (const end of [s.first, picked.end]) {
          d = addConstraint(d, { id: nextId(d, 'k'), type, refs: [eid, end.entityId], at: end.pointId });
        }
        return view({ continuity: s.continuity, cursor: at, mods: s.mods }, d);
      }
      case 'field': {
        if (ev.id !== 'continuity') return view(state, draft);
        const v = ev.value === 2 ? 2 : 1;
        return view({ ...state, continuity: v }, draft);
      }
      case 'key': {
        if (ev.key === '1' || ev.key === '2') return view({ ...state, continuity: ev.key === '2' ? 2 : 1 }, draft);
        if (ev.key === 'Escape') return view({ continuity: state.continuity, cursor: state.cursor, mods: state.mods }, draft);
        return view(state, draft);
      }
    }
  },
};
