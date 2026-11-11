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
 *    mirror images over the line). One is written per mirrored point pair, tying the copy to the original. The
 *    radius of a mirrored circle is tied with `equal` to the original. The solver already ties both ends of an
 *    arc to one radius, so `symmetric` on all three arc points would read as over-constrained (one redundant
 *    constraint): an arc whose centre belongs to it alone gets `equal` radius instead of a `symmetric` centre; an
 *    arc near a half circle (the centre is then not fixed by its radius) across a horizontal or vertical axis
 *    gets, for its better-conditioned end, only `horizontal` / `vertical` (same row / column) instead of the full
 *    `symmetric`; other half circles keep all three and show one redundant constraint (still solves). A mirrored
 *    ellipse gets a `radius` of the original's value;
 *  - the Enter key reaches this tool because the selection is always drawn highlighted (the app routes keys to a
 *    tool that has something on show; otherwise Enter confirms the sketch);
 *  - the mirror line itself is never mirrored, and constraints of the originals are not copied.
 * Escape drops the selection, then the whole operation.
 */
import type { DraftEntity, SketchDraft } from '../index';
import { entityShape } from '../select';
import { arcSweep, distToLine, reflect, sample, TOL, type CurveG } from './edit-geom';
import { curveOf, entityOf, entityPoints, ptOf, withConstraint, withEntity, withPoint } from './edit-draft';
import type { PreviewShape, Tool, ToolEnv, ToolOutput, ToolSettings } from './types';

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
  const equalPairs: Array<[string, string]> = [];     // [original, copy] whose radius is tied with `equal`
  const alignOnly = new Set<string>();                // original points whose copy gets only the "same height / same column" half of `symmetric`
  const axisDir = { x: b.x - a.x, y: b.y - a.y };
  const axisKind = Math.abs(axisDir.y) <= TOL * Math.hypot(axisDir.x, axisDir.y) ? 'horizontal' : Math.abs(axisDir.x) <= TOL * Math.hypot(axisDir.x, axisDir.y) ? 'vertical' : null;
  // how many of the mirrored entities use each point (a shared centre is not ours to drop)
  const use = new Map<string, number>();
  for (const e of src) for (const p of new Set(entityPoints(e))) use.set(p, (use.get(p) ?? 0) + 1);
  const dropCentre = new Set<string>();                // arc centres: not mirrored with `symmetric` but through `equal` radius
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
    if (e.type === 'circle') equalPairs.push([e.id, add.id]);
    if (e.type === 'ellipse') d = withConstraint(d, 'radius', [add.id], { value: Number(e.r) });
    if (e.type === 'arc') {
      // The solver already ties both ends of an arc to one radius, so `symmetric` on all three of its points is one constraint
      // too many (the sketch would read as over-constrained). Leave out the centre (the copy gets `equal` radius instead) when
      // it is the arc's own; otherwise leave out half of one end's `symmetric` when the axis is horizontal or vertical.
      const c = String(e.c);
      const g = curveOf(draft, e);
      const nearHalf = !g || g.kind !== 'arc' || Math.abs(arcSweep(g) - Math.PI) < (15 * Math.PI) / 180;   // the centre is then not determined by the radius
      if ((use.get(c) ?? 0) === 1 && map.get(c) !== c && !nearHalf) { dropCentre.add(c); equalPairs.push([e.id, add.id]); }
      else if (axisKind) {
        // the end whose kept half is best conditioned: the arc equation must be able to move it along the axis direction
        const cen = ptOf(draft, c)!;
        const cond = (q: string) => { const p = ptOf(draft, q)!; return axisKind === 'vertical' ? Math.abs(p.x - cen.x) : Math.abs(p.y - cen.y); };
        const end = [String(e.p2), String(e.p1)].filter((q) => map.get(q) !== q && !alignOnly.has(q)).sort((x, y) => cond(y) - cond(x))[0];
        if (end && cond(end) > 1e-6) alignOnly.add(end);
      }
    }
  }
  for (const [p, q] of pairs) {
    if (dropCentre.has(p)) continue;
    d = alignOnly.has(p) ? withConstraint(d, axisKind === 'vertical' ? 'horizontal' : 'vertical', [p, q]) : withConstraint(d, 'symmetric', [p, q, lineId]);
  }
  for (const [o, c] of equalPairs) d = withConstraint(d, 'equal', [o, c]);
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

/** The selection is always drawn highlighted. Besides telling the user what is selected, this is what lets Enter reach the tool:
 *  the app only routes keys to a tool that has something on show (a preview or a field), otherwise Enter confirms the sketch. */
const view = (state: MirrorState, draft: SketchDraft, settings: ToolSettings, hint?: string, preview: PreviewShape[] = []): ToolOutput<MirrorState> =>
  ({ state, draft, preview: [...state.selected.flatMap((id) => entityShape(draft, id) as PreviewShape[]), ...preview], fields: [],
    hint: hint ?? (state.phase === 'line' ? 'app.sketch.hint.mirrorLine' : state.selected.length ? 'app.sketch.hint.mirrorPickMore' : 'app.sketch.hint.mirrorPick') });

export const mirrorTool: Tool<MirrorState> = {
  id: 'mirror',
  start: () => ({ phase: 'select', selected: [] }),
  step(state, ev, draft, settings, env?: ToolEnv) {
    // entities selected in Select mode before the tool was chosen: on to the mirror line
    if (state.phase === 'select' && !state.selected.length) {
      const pre = (env?.entities ?? []).filter((i) => { const e = entityOf(draft, i); return e && MIRRORABLE.has(String(e.type)); });
      if (pre.length) state = { phase: 'line', selected: pre };
    }
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
