/**
 * Shared corner machinery for the fillet and chamfer tools (both pick the same two lines and take one length).
 *
 * Conventions, verified against the solver (rebuild/crates/ck-model/src/sketch/solver.rs) and by the
 * real-kernel tests in edit-kernel.test.ts:
 *  - arc `{c,p1,p2}` is counter-clockwise from p1 to p2, so the fillet arc takes p1 = the tangent point from
 *    which the short way round to the other is counter-clockwise;
 *  - `tangent` takes refs = [entityId, entityId]; the shared end is found from the entities' common point
 *    id (the optional `at` names it explicitly, and we write it). Line/arc tangency at a shared end is
 *    "line direction is perpendicular to (shared point - arc centre)";
 *  - `radius` takes refs = [arcId] and `value` (arcs are supported: the radius is |p1 - c|).
 *
 * Edit rules: the two lines keep their ids and directions; the corner end of each is replaced by a new point
 * (the arc / chamfer end). The old corner point is dropped when nothing else uses it, and constraints that
 * referenced it (a dimension on the corner, a coincident) are dropped with it. Horizontal/vertical and other
 * line-level constraints stay valid because the lines keep their direction.
 */
import type { DraftEntity, SketchDraft } from '../index';
import { arcSweep, cornerGeometry, cross, sample, sub, type Corner, type CurveG } from './edit-geom';
import { dropOrphans, entityOf, ptOf, replaceEntity, withConstraint, withEntity, withPoint } from './edit-draft';
import type { FieldSpec, Pt, PreviewShape, Tool, ToolEvent, ToolOutput, ToolSettings } from './types';

export type CornerKind = 'fillet' | 'chamfer';
export interface CornerSpec { a: string; b: string; s: string }
export type CornerResult = { ok: true; draft: SketchDraft; created: string[] } | { ok: false; hint: string };

const HINTS: Record<CornerKind, Record<string, string>> = {
  fillet: { parallel: 'app.sketch.hint.parallel', tooLarge: 'app.sketch.hint.radiusTooLarge', degenerate: 'app.sketch.hint.degenerate' },
  chamfer: { parallel: 'app.sketch.hint.parallel', tooLarge: 'app.sketch.hint.distanceTooLarge', degenerate: 'app.sketch.hint.degenerate' },
};

const otherEnd = (e: DraftEntity, s: string) => String(e.p1 === s ? e.p2 : e.p1);

/** Find the corner for two line entities: the end point they share. */
export function findCorner(draft: SketchDraft, a: string, b: string): CornerSpec | null {
  const ea = entityOf(draft, a), eb = entityOf(draft, b);
  if (!ea || !eb || a === b || ea.type !== 'line' || eb.type !== 'line') return null;
  for (const s of [String(ea.p1), String(ea.p2)]) if (s === eb.p1 || s === eb.p2) return { a, b, s };
  return null;
}

/** The two lines meeting at a corner point, if exactly two lines end there. */
export function cornerAtPoint(draft: SketchDraft, pointId: string): CornerSpec | null {
  const lines = draft.entities.filter((e) => e.type === 'line' && (e.p1 === pointId || e.p2 === pointId));
  return lines.length === 2 ? { a: lines[0].id, b: lines[1].id, s: pointId } : null;
}

function geometry(draft: SketchDraft, spec: CornerSpec, kind: CornerKind, amount: number): Corner | string {
  const ea = entityOf(draft, spec.a)!, eb = entityOf(draft, spec.b)!;
  const s = ptOf(draft, spec.s), a = ptOf(draft, otherEnd(ea, spec.s)), b = ptOf(draft, otherEnd(eb, spec.s));
  if (!s || !a || !b) return HINTS[kind].degenerate;
  const g = cornerGeometry(s, a, b, kind, amount);
  return typeof g === 'string' ? HINTS[kind][g] : g;
}

/** Preview segments of the new corner piece (arc sampled into segments, or the chamfer line). */
export function cornerPreview(draft: SketchDraft, spec: CornerSpec, kind: CornerKind, amount: number): { shapes: PreviewShape[]; hint?: string } {
  const g = geometry(draft, spec, kind, amount);
  if (typeof g === 'string') return { shapes: [], hint: g };
  if (kind === 'chamfer' || !g.c) return { shapes: [{ kind: 'line', a: g.t1, b: g.t2 }] };
  return { shapes: arcShapes(g.c, g.t1, g.t2) };
}

function arcShapes(c: Pt, t1: Pt, t2: Pt): PreviewShape[] {
  const ccw = cross(sub(t1, c), sub(t2, c)) > 0;
  const p1 = ccw ? t1 : t2, p2 = ccw ? t2 : t1;
  const r = Math.hypot(p1.x - c.x, p1.y - c.y);
  const g: CurveG = { kind: 'arc', c, r, p1, p2 };
  return sample(g, 0, arcSweep(g))
    .map((s) => ({ kind: 'line' as const, a: s.a, b: s.b }));
}

/**
 * Replace the corner. `dimension` true (the amount was typed and committed) also writes the driving
 * dimension: fillet `radius` on the arc. The chamfer has no single-ref dimension that means "distance
 * along both lines", so it writes none.
 */
export function applyCorner(draft: SketchDraft, spec: CornerSpec, kind: CornerKind, amount: number, dimension = false): CornerResult {
  const g = geometry(draft, spec, kind, amount);
  if (typeof g === 'string') return { ok: false, hint: g };
  const t1 = withPoint(draft, g.t1);
  const t2 = withPoint(t1.draft, g.t2);
  let d = t2.draft;
  const swap = (to: string) => (e: DraftEntity): DraftEntity => (e.p1 === spec.s ? { ...e, p1: to } : { ...e, p2: to });
  d = replaceEntity(d, spec.a, swap(t1.id));
  d = replaceEntity(d, spec.b, swap(t2.id));
  const created: string[] = [t1.id, t2.id];
  if (kind === 'chamfer') {
    const ln = withEntity(d, { type: 'line', p1: t1.id, p2: t2.id });
    d = ln.draft; created.push(ln.id);
  } else {
    const centre = withPoint(d, g.c!);
    d = centre.draft; created.push(centre.id);
    const ccw = cross(sub(g.t1, g.c!), sub(g.t2, g.c!)) > 0;
    const arc = withEntity(d, { type: 'arc', c: centre.id, p1: ccw ? t1.id : t2.id, p2: ccw ? t2.id : t1.id });
    d = arc.draft; created.push(arc.id);
    d = withConstraint(d, 'tangent', [spec.a, arc.id], { at: t1.id });
    d = withConstraint(d, 'tangent', [spec.b, arc.id], { at: t2.id });
    if (dimension) d = withConstraint(d, 'radius', [arc.id], { value: amount });
  }
  d = dropOrphans(d, [spec.s]);
  return { ok: true, draft: d, created };
}

export interface CornerState {
  /** first picked line, waiting for the second */
  first?: string;
  /** a complete corner waiting for confirmation */
  pending?: CornerSpec;
  /** typed and committed amount; applied at once when the corner is complete */
  locked?: number;
  /** typed, uncommitted amount: preview only */
  live?: number;
  /** last amount used, the default for the next corner */
  amount: number;
}

export const DEFAULT_AMOUNT = 5;
const amountOf = (s: CornerState) => s.locked ?? s.live ?? s.amount;

function view(kind: CornerKind, state: CornerState, draft: SketchDraft, settings: ToolSettings, hint?: string): ToolOutput<CornerState> {
  const pv = state.pending ? cornerPreview(draft, state.pending, kind, amountOf(state)) : { shapes: [] as PreviewShape[], hint: undefined };
  const fields: FieldSpec[] = settings.onViewValues === 'off' ? [] : [
    { id: kind === 'fillet' ? 'r' : 'd', label: kind === 'fillet' ? 'app.sketch.field.radius' : 'app.sketch.field.distance', value: amountOf(state), locked: state.locked !== undefined, unit: 'length' },
  ];
  const h = hint ?? pv.hint;
  return { state, draft, preview: pv.shapes, fields, ...(h ? { hint: h } : {}) };
}

export function makeCornerTool(kind: CornerKind): Tool<CornerState> {
  const fieldId = kind === 'fillet' ? 'r' : 'd';
  const confirm = (state: CornerState, draft: SketchDraft, settings: ToolSettings): ToolOutput<CornerState> => {
    const res = applyCorner(draft, state.pending!, kind, amountOf(state), state.locked !== undefined);
    // a refused corner stays pending so a smaller amount can be typed
    if (!res.ok) return view(kind, state, draft, settings, res.hint);
    return view(kind, { amount: amountOf(state) }, res.draft, settings);
  };
  const complete = (state: CornerState, spec: CornerSpec, draft: SketchDraft, settings: ToolSettings) => {
    const next: CornerState = { ...state, first: undefined, pending: spec, live: undefined };
    return next.locked !== undefined ? confirm(next, draft, settings) : view(kind, next, draft, settings);
  };
  return {
    id: kind,
    start: () => ({ amount: DEFAULT_AMOUNT }),
    step(state, ev: ToolEvent, draft, settings) {
      switch (ev.type) {
        case 'move': return view(kind, state, draft, settings);
        case 'click': {
          if (state.pending) return confirm(state, draft, settings);
          const snap = ev.snap;
          if (!state.first && snap?.pointId && !snap.entityId) {
            const c = cornerAtPoint(draft, snap.pointId);
            return c ? complete(state, c, draft, settings) : view(kind, state, draft, settings, 'app.sketch.hint.noCorner');
          }
          const id = snap?.entityId;
          const e = id ? entityOf(draft, id) : undefined;
          if (!e || e.type !== 'line') return view(kind, state, draft, settings, 'app.sketch.hint.pickLine');
          if (!state.first) return view(kind, { ...state, first: e.id }, draft, settings);
          if (state.first === e.id) return view(kind, state, draft, settings, 'app.sketch.hint.pickOtherLine');
          const spec = findCorner(draft, state.first, e.id);
          return spec ? complete(state, spec, draft, settings) : view(kind, state, draft, settings, 'app.sketch.hint.noCorner');
        }
        case 'field': {
          if (ev.id !== fieldId) return view(kind, state, draft, settings);
          if (ev.value === null || !Number.isFinite(ev.value)) return view(kind, { ...state, locked: undefined, live: undefined }, draft, settings);
          if (ev.value <= 0) return view(kind, state, draft, settings, 'app.sketch.hint.degenerate');
          if (ev.commit) {
            const next = { ...state, locked: ev.value, live: undefined };
            return state.pending ? confirm(next, draft, settings) : view(kind, next, draft, settings);
          }
          return view(kind, { ...state, live: ev.value }, draft, settings);
        }
        case 'key': {
          if (ev.key === 'Enter' && state.pending) return confirm(state, draft, settings);
          if (ev.key !== 'Escape') return view(kind, state, draft, settings);
          if (state.live !== undefined || state.locked !== undefined) return view(kind, { ...state, live: undefined, locked: undefined }, draft, settings);
          return view(kind, { amount: state.amount }, draft, settings);
        }
      }
    },
  };
}
