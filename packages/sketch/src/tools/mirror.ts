/**
 * Mirror. Click entities to select them (click again to unselect), press Enter, then click the mirror line (a
 * line entity). Mirrored copies are added; the originals stay.
 *
 * Conventions:
 *  - a point lying on the mirror line (within 1e-7) is its own mirror and is shared, not duplicated; every
 *    other point maps to one new point, shared by all the mirrored entities that use it;
 *  - a reflection reverses rotation, so a mirrored arc `{c,p1,p2}` is `{c', p1: m(p2), p2: m(p1)}` and stays
 *    counter-clockwise; circles keep `r`; ellipses map `c` and the major-axis point `p`; splines map `pts` and
 *    keep their other fields (degree, knots, closed);
 *  - constraints: `symmetric` takes refs = [pointA, pointB, lineEntityId] (solver.rs: the two points are
 *    mirror images over the line). One is written per mirrored point pair, tying the copy to the original.
 *    The copy of a circle's radius is only the number `r`; no `equal` is written;
 *  - the mirror line itself is never mirrored, and constraints of the originals are not copied.
 * Escape drops the selection, then the whole operation.
 */
import type { DraftEntity, SketchDraft } from '../index';
import { arcSweep, distToLine, reflect, sample, TOL, type CurveG } from './edit-geom';
import { curveOf, entityOf, ptOf, withConstraint, withEntity, withPoint } from './edit-draft';
import type { PreviewShape, Tool, ToolOutput, ToolSettings } from './types';

export interface MirrorState {
  phase: 'select' | 'line';
  selected: string[];
}

export type MirrorRes = { ok: true; draft: SketchDraft; created: string[] } | { ok: false; hint: string };

const MIRRORABLE = new Set(['line', 'circle', 'arc', 'ellipse', 'point', 'spline', 'cvspline']);

export function mirrorEntities(draft: SketchDraft, ids: string[], lineId: string): MirrorRes {
  const axis = entityOf(draft, lineId);
  if (!axis || axis.type !== 'line') return { ok: false, hint: 'app.sketch.hint.pickLine' };
  const a = ptOf(draft, String(axis.p1)), b = ptOf(draft, String(axis.p2));
  if (!a || !b || Math.hypot(b.x - a.x, b.y - a.y) < TOL) return { ok: false, hint: 'app.sketch.hint.degenerate' };
  const src = ids.filter((i) => i !== lineId).map((i) => entityOf(draft, i)).filter((e): e is DraftEntity => !!e && MIRRORABLE.has(String(e.type)));
  if (!src.length) return { ok: false, hint: 'app.sketch.hint.nothingToMirror' };

  let d = draft;
  const map = new Map<string, string>();
  const created: string[] = [];
  const pairs: Array<[string, string]> = [];
  const mirrorPoint = (id: string): string => {
    const got = map.get(id);
    if (got) return got;
    const p = ptOf(d, id)!;
    if (distToLine(p, a, b) <= TOL) { map.set(id, id); return id; }
    const add = withPoint(d, reflect(p, a, b));
    d = add.draft;
    map.set(id, add.id); pairs.push([id, add.id]); created.push(add.id);
    return add.id;
  };
  for (const e of src) {
    const m = (k: string) => mirrorPoint(String(e[k]));
    const { id: _id, ...rest } = e;
    let fields: Record<string, unknown>;
    switch (e.type) {
      case 'line': fields = { ...rest, p1: m('p1'), p2: m('p2') }; break;
      case 'arc': { const p1 = m('p1'), p2 = m('p2'); fields = { ...rest, c: m('c'), p1: p2, p2: p1 }; break; }
      case 'circle': fields = { ...rest, c: m('c') }; break;
      case 'ellipse': fields = { ...rest, c: m('c'), p: m('p') }; break;
      case 'point': fields = { ...rest, p: m('p') }; break;
      default: fields = { ...rest, pts: (e.pts as string[]).map(mirrorPoint) };
    }
    const add = withEntity(d, fields);
    d = add.draft; created.push(add.id);
  }
  for (const [p, q] of pairs) d = withConstraint(d, 'symmetric', [p, q, lineId]);
  return { ok: true, draft: d, created };
}

function previewOf(draft: SketchDraft, ids: string[], lineId: string | undefined): PreviewShape[] {
  const out: PreviewShape[] = [];
  const axisE = lineId ? entityOf(draft, lineId) : undefined;
  const axis = axisE ? curveOf(draft, axisE) : null;
  if (!axis || axis.kind !== 'line') return out;
  const r = (p: { x: number; y: number }) => reflect(p, axis.a, axis.b);
  for (const id of ids) {
    const e = entityOf(draft, id);
    const g: CurveG | null = e ? curveOf(draft, e) : null;
    if (!g || id === lineId) continue;
    if (g.kind === 'line') out.push({ kind: 'line', a: r(g.a), b: r(g.b) });
    else if (g.kind === 'circle') out.push({ kind: 'circle', c: r(g.c), r: g.r });
    else {
      const m: CurveG = { kind: 'arc', c: r(g.c), r: g.r, p1: r(g.p2), p2: r(g.p1) };
      for (const s of sample(m, 0, arcSweep(m))) out.push({ kind: 'line', a: s.a, b: s.b });
    }
  }
  return out;
}

const view = (state: MirrorState, draft: SketchDraft, settings: ToolSettings, hint?: string, preview: PreviewShape[] = []): ToolOutput<MirrorState> =>
  ({ state, draft, preview, fields: [], ...(hint ? { hint } : {}) });

export const mirrorTool: Tool<MirrorState> = {
  id: 'mirror',
  start: () => ({ phase: 'select', selected: [] }),
  step(state, ev, draft, settings) {
    switch (ev.type) {
      case 'move': {
        if (state.phase === 'line' && ev.snap?.entityId) return view(state, draft, settings, undefined, previewOf(draft, state.selected, ev.snap.entityId));
        return view(state, draft, settings);
      }
      case 'click': {
        const id = ev.snap?.entityId;
        if (state.phase === 'select') {
          const e = id ? entityOf(draft, id) : undefined;
          if (!e || !MIRRORABLE.has(String(e.type))) return view(state, draft, settings, 'app.sketch.hint.pickEntity');
          const selected = state.selected.includes(e.id) ? state.selected.filter((s) => s !== e.id) : [...state.selected, e.id];
          return view({ ...state, selected }, draft, settings);
        }
        if (!id) return view(state, draft, settings, 'app.sketch.hint.pickLine');
        const r = mirrorEntities(draft, state.selected, id);
        if (!r.ok) return view(state, draft, settings, r.hint);
        return view({ phase: 'select', selected: [] }, r.draft, settings);
      }
      case 'key': {
        if (ev.key === 'Enter' && state.phase === 'select') {
          return state.selected.length ? view({ ...state, phase: 'line' }, draft, settings) : view(state, draft, settings, 'app.sketch.hint.nothingToMirror');
        }
        if (ev.key === 'Escape') return state.selected.length ? view({ phase: 'select', selected: [] }, draft, settings) : view(state, draft, settings);
        return view(state, draft, settings);
      }
      default:
        return view(state, draft, settings);
    }
  },
};
