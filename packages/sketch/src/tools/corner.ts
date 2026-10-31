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
 * Lines that share no end are first brought to where they meet (`meetLines`): the nearer end of each moves to the
 * crossing, so a line that stops short is carried on and one that runs past is cut there (its shorter piece goes).
 * A spec with `s === ''` stands for such a pair; `prepare` turns it into a real corner or says why not.
 *
 * Edit rules: the two lines keep their ids and directions; the corner end of each is replaced by a new point
 * (the arc / chamfer end). The old corner point is dropped when nothing else uses it, and constraints that
 * referenced it (a dimension on the corner, a coincident) are dropped with it. Horizontal/vertical and other
 * line-level constraints stay valid because the lines keep their direction.
 */
import type { DraftEntity, SketchDraft } from '../index';
import { add, arcSweep, cornerGeometry, cross, dist, len, PARALLEL_SIN, sample, scale, sub, type Corner, type CurveG } from './edit-geom';
import { dropOrphans, entityOf, entityPoints, ptOf, replaceEntity, withConstraint, withEntity, withPoint } from './edit-draft';
import type { FieldSpec, Pt, PreviewShape, Tool, ToolEvent, ToolOutput, ToolSettings } from './types';

export type CornerKind = 'fillet' | 'chamfer';
/** `s` is the shared end point; '' when the lines share none and are to be joined first (see `meetLines`) */
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

/** Lines nearer than this to meeting at infinity (sketch units) are refused as meeting too far away. */
const MEET_FAR = 1e7;
/** Constraints that give a line a size of its own: moving one end would change it. */
const SIZED = new Set(['equal', 'midpoint', 'length', 'distance']);

/** Why the end `pointId` of line `lineId` may not move, or undefined when it may. */
function heldReason(d: SketchDraft, lineId: string, pointId: string): string | undefined {
  const p = d.points.find((q) => q.id === pointId);
  if (!p || p.fixed) return 'app.sketch.hint.endHeld';
  if (d.entities.some((e) => e.id !== lineId && entityPoints(e).includes(pointId))) return 'app.sketch.hint.endHeld';
  const ks = [...d.constraints, ...d.temp];
  if (ks.some((k) => k.refs?.includes(pointId) || k.at === pointId)) return 'app.sketch.hint.endHeld';
  if (ks.some((k) => SIZED.has(k.type) && k.refs?.includes(lineId))) return 'app.sketch.hint.lineSized';
  return undefined;
}

/**
 * Bring two lines that share no end to where they meet: the end of each nearer the crossing moves onto it and the two
 * ends become one point. Refused (draft untouched) for parallel lines, lines that meet more than 1e7 away, an end that
 * is held (another curve, a constraint or dimension on the point, a fixed point), or a line with a size of its own.
 */
export function meetLines(draft: SketchDraft, a: string, b: string): { ok: true; draft: SketchDraft; spec: CornerSpec } | { ok: false; hint: string } {
  const ea = entityOf(draft, a), eb = entityOf(draft, b);
  if (!ea || !eb || a === b || ea.type !== 'line' || eb.type !== 'line') return { ok: false, hint: 'app.sketch.hint.noCorner' };
  const ends = (e: typeof ea) => [String(e.p1), String(e.p2)] as const;
  const [a1, a2] = ends(ea).map((i) => ptOf(draft, i)), [b1, b2] = ends(eb).map((i) => ptOf(draft, i));
  if (!a1 || !a2 || !b1 || !b2) return { ok: false, hint: 'app.sketch.hint.degenerate' };
  const da = sub(a2, a1), db = sub(b2, b1);
  const la = len(da), lb = len(db);
  if (la < 1e-9 || lb < 1e-9) return { ok: false, hint: 'app.sketch.hint.degenerate' };
  const den = cross(da, db);
  if (Math.abs(den) < PARALLEL_SIN * la * lb) return { ok: false, hint: 'app.sketch.hint.parallel.more' };
  const t = cross(sub(b1, a1), db) / den;
  const m = add(a1, scale(da, t));
  if (dist(m, a1) > MEET_FAR || dist(m, b1) > MEET_FAR) return { ok: false, hint: 'app.sketch.hint.meetFar' };
  const nearer = (e: typeof ea, p1: Pt, p2: Pt) => (dist(p1, m) <= dist(p2, m) ? { end: 'p1' as const, id: String(e.p1) } : { end: 'p2' as const, id: String(e.p2) });
  const ma = nearer(ea, a1, a2), mb = nearer(eb, b1, b2);
  const held = heldReason(draft, a, ma.id) ?? heldReason(draft, b, mb.id);
  if (held) return { ok: false, hint: held };
  const np = withPoint(draft, m);
  let d = replaceEntity(np.draft, a, (e) => ({ ...e, [ma.end]: np.id }));
  d = replaceEntity(d, b, (e) => ({ ...e, [mb.end]: np.id }));
  return { ok: true, draft: dropOrphans(d, [ma.id, mb.id]), spec: { a, b, s: np.id } };
}

/** A spec that is a real corner, on a draft where it is one (the lines joined first when they shared no end). */
function prepare(draft: SketchDraft, spec: CornerSpec): { ok: true; draft: SketchDraft; spec: CornerSpec } | { ok: false; hint: string } {
  if (spec.s !== '') return { ok: true, draft, spec };
  const shared = findCorner(draft, spec.a, spec.b);
  return shared ? { ok: true, draft, spec: shared } : meetLines(draft, spec.a, spec.b);
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
  const prep = prepare(draft, spec);
  if (!prep.ok) return { shapes: [], hint: prep.hint };
  const g = geometry(prep.draft, prep.spec, kind, amount);
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
export function applyCorner(draft: SketchDraft, spec0: CornerSpec, kind: CornerKind, amount: number, dimension = false): CornerResult {
  const prep = prepare(draft, spec0);
  if (!prep.ok) return prep;
  const spec = prep.spec;
  let d = prep.draft;
  const g = geometry(d, spec, kind, amount);
  if (typeof g === 'string') return { ok: false, hint: g };
  const ea = entityOf(d, spec.a)!, eb = entityOf(d, spec.b)!;
  const created: string[] = [];
  // a line the fillet uses up: the arc ends on its far end point, and the line goes
  const whole = (line: string, far: string, on: boolean, at: Pt) => {
    if (on) return { id: far, gone: line };
    const p = withPoint(d, at);
    d = p.draft; created.push(p.id);
    return { id: p.id, gone: undefined as string | undefined };
  };
  // tangents the used-up line had at its far end are passed on to the arc
  const carried = (line: string, far: string) => d.constraints
    .filter((k) => k.type === 'tangent' && k.refs?.includes(line) && (k.at === undefined || k.at === far))
    .map((k) => k.refs!.find((r) => r !== line)!);
  const farA = otherEnd(ea, spec.s), farB = otherEnd(eb, spec.s);
  const passA = g.wholeA ? carried(spec.a, farA) : [], passB = g.wholeB ? carried(spec.b, farB) : [];
  const t1 = whole(spec.a, farA, !!g.wholeA, g.t1);
  const t2 = whole(spec.b, farB, !!g.wholeB, g.t2);
  const swap = (to: string) => (e: DraftEntity): DraftEntity => (e.p1 === spec.s ? { ...e, p1: to } : { ...e, p2: to });
  if (!t1.gone) d = replaceEntity(d, spec.a, swap(t1.id));
  if (!t2.gone) d = replaceEntity(d, spec.b, swap(t2.id));
  const gone = [t1.gone, t2.gone].filter((x): x is string => !!x);
  if (gone.length) d = { ...d, entities: d.entities.filter((e) => !gone.includes(e.id)) };
  if (kind === 'chamfer') {
    const ln = withEntity(d, { type: 'line', p1: t1.id, p2: t2.id });
    d = ln.draft; created.push(ln.id);
  } else {
    const centre = withPoint(d, g.c!);
    d = centre.draft; created.push(centre.id);
    const ccw = cross(sub(g.t1, g.c!), sub(g.t2, g.c!)) > 0;
    const arc = withEntity(d, { type: 'arc', c: centre.id, p1: ccw ? t1.id : t2.id, p2: ccw ? t2.id : t1.id });
    d = arc.draft; created.push(arc.id);
    if (t1.gone) for (const o of passA) d = withConstraint(d, 'tangent', [o, arc.id], { at: t1.id });
    else d = withConstraint(d, 'tangent', [spec.a, arc.id], { at: t1.id });
    if (t2.gone) for (const o of passB) d = withConstraint(d, 'tangent', [o, arc.id], { at: t2.id });
    else d = withConstraint(d, 'tangent', [spec.b, arc.id], { at: t2.id });
    if (dimension) d = withConstraint(d, 'radius', [arc.id], { value: amount });
  }
  d = dropOrphans(d, [spec.s]);
  return { ok: true, draft: d, created };
}

/**
 * Several corners in one edit with one size. All or nothing: a corner that cannot be cut, one named twice (the same
 * shared end, or the same two lines), or a line already used up by an earlier corner refuses the whole batch.
 */
export function applyCorners(draft: SketchDraft, specs: CornerSpec[], kind: CornerKind, amount: number, dimension = false): CornerResult {
  const seen = new Set<string>();
  for (const sp of specs) {
    const keys = [`${[sp.a, sp.b].sort().join('|')}`, ...(sp.s ? [`@${sp.s}`] : [])];
    if (keys.some((k) => seen.has(k))) return { ok: false, hint: 'app.sketch.hint.cornerTwice' };
    keys.forEach((k) => seen.add(k));
  }
  let d = draft;
  const created: string[] = [];
  for (const sp of specs) {
    const ea = entityOf(d, sp.a), eb = entityOf(d, sp.b);
    if (!ea || !eb || (sp.s && !((ea.p1 === sp.s || ea.p2 === sp.s) && (eb.p1 === sp.s || eb.p2 === sp.s)))) return { ok: false, hint: 'app.sketch.hint.noCorner' };
    const r = applyCorner(d, sp, kind, amount, dimension);
    if (!r.ok) return r;
    d = r.draft; created.push(...r.created);
  }
  return { ok: true, draft: d, created };
}

/**
 * Match picked lines into corners, in pick order: a line pairs with the first earlier pick that still has a free end
 * where one of its own ends is (an end is used once), so a rectangle's four sides give its four corners. Two lines in
 * line make no corner. Lines left without a partner are returned in `unpaired`.
 */
export function pairCorners(draft: SketchDraft, picks: string[]): { corners: CornerSpec[]; unpaired: string[] } {
  const used = new Set<string>(), paired = new Set<string>();
  const corners: CornerSpec[] = [];
  const lineOf = (id: string) => { const e = entityOf(draft, id); return e && e.type === 'line' ? e : undefined; };
  picks.forEach((l, i) => {
    const el = lineOf(l);
    if (!el) return;
    for (const p of [String(el.p1), String(el.p2)]) {
      if (used.has(`${l}|${p}`)) continue;
      for (const e of picks.slice(0, i)) {
        const ee = lineOf(e);
        if (!ee || used.has(`${e}|${p}`) || (ee.p1 !== p && ee.p2 !== p) || e === l) continue;
        const s = ptOf(draft, p), a = ptOf(draft, otherEnd(ee, p)), b = ptOf(draft, otherEnd(el, p));
        if (!s || !a || !b || dist(s, a) < 1e-9 || dist(s, b) < 1e-9) continue;
        if (Math.abs(cross(sub(a, s), sub(b, s))) < PARALLEL_SIN * dist(s, a) * dist(s, b)) continue;
        corners.push({ a: e, b: l, s: p });
        used.add(`${l}|${p}`); used.add(`${e}|${p}`); paired.add(l); paired.add(e);
        break;
      }
    }
  });
  return { corners, unpaired: picks.filter((p) => !paired.has(p)) };
}

export interface CornerState {
  /** first picked line, waiting for the second */
  first?: string;
  /** a complete corner waiting for confirmation */
  pending?: CornerSpec;
  /** shift-picked lines (paired into corners with `pairCorners`) and corner points, waiting for one confirmation */
  picks?: string[];
  corners?: CornerSpec[];
  /** typed and committed amount; applied at once when the corner is complete */
  locked?: number;
  /** typed, uncommitted amount: preview only */
  live?: number;
  /** last amount used, the default for the next corner */
  amount: number;
}

export const DEFAULT_AMOUNT = 5;
const amountOf = (s: CornerState) => s.locked ?? s.live ?? s.amount;
const batching = (s: CornerState) => (s.picks?.length ?? 0) + (s.corners?.length ?? 0) > 0;
const batchOf = (s: CornerState, draft: SketchDraft) => {
  const p = pairCorners(draft, s.picks ?? []);
  return { specs: [...(s.corners ?? []), ...p.corners], unpaired: p.unpaired };
};

function view(kind: CornerKind, state: CornerState, draft: SketchDraft, settings: ToolSettings, hint?: string): ToolOutput<CornerState> {
  const specs = batching(state) ? batchOf(state, draft).specs : state.pending ? [state.pending] : [];
  const pvs = specs.map((sp) => cornerPreview(draft, sp, kind, amountOf(state)));
  const pv = { shapes: pvs.flatMap((x) => x.shapes), hint: pvs.find((x) => x.hint)?.hint };
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
  const confirmBatch = (state: CornerState, draft: SketchDraft, settings: ToolSettings): ToolOutput<CornerState> => {
    const { specs, unpaired } = batchOf(state, draft);
    if (unpaired.length) return view(kind, state, draft, settings, 'app.sketch.hint.unpairedLine');
    const res = applyCorners(draft, specs, kind, amountOf(state), state.locked !== undefined);
    if (!res.ok) return view(kind, state, draft, settings, res.hint);
    return view(kind, { amount: amountOf(state) }, res.draft, settings);
  };
  const complete = (state: CornerState, spec: CornerSpec, draft: SketchDraft, settings: ToolSettings) => {
    const next: CornerState = { ...state, first: undefined, pending: spec, live: undefined };
    return next.locked !== undefined ? confirm(next, draft, settings) : view(kind, next, draft, settings);
  };
  /** Shift-click: add a corner point or toggle a line in the batch (a half-made single pick joins it). */
  const addPick = (state: CornerState, ev: Extract<ToolEvent, { type: 'click' }>, draft: SketchDraft, settings: ToolSettings) => {
    const base: CornerState = { ...state, first: undefined, pending: undefined, picks: [...(state.picks ?? []), ...(state.first ? [state.first] : [])], corners: [...(state.corners ?? []), ...(state.pending ? [state.pending] : [])] };
    const snap = ev.snap;
    if (snap?.pointId && !snap.entityId) {
      const c = cornerAtPoint(draft, snap.pointId);
      if (!c) return view(kind, base, draft, settings, 'app.sketch.hint.noCorner');
      const have = (base.corners ?? []).some((x) => x.s === c.s);
      return view(kind, { ...base, corners: have ? base.corners!.filter((x) => x.s !== c.s) : [...(base.corners ?? []), c] }, draft, settings);
    }
    const e = snap?.entityId ? entityOf(draft, snap.entityId) : undefined;
    if (!e || e.type !== 'line') return view(kind, base, draft, settings, 'app.sketch.hint.pickLine');
    const picks = base.picks!.includes(e.id) ? base.picks!.filter((x) => x !== e.id) : [...base.picks!, e.id];
    return view(kind, { ...base, picks }, draft, settings);
  };
  return {
    id: kind,
    start: () => ({ amount: DEFAULT_AMOUNT }),
    step(state, ev: ToolEvent, draft, settings) {
      switch (ev.type) {
        case 'move': return view(kind, state, draft, settings);
        case 'click': {
          if (ev.mods.shift) return addPick(state, ev, draft, settings);
          if (batching(state)) return confirmBatch(state, draft, settings);
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
          // two lines that share no end are joined where they meet when the corner is made
          return complete(state, findCorner(draft, state.first, e.id) ?? { a: state.first, b: e.id, s: '' }, draft, settings);
        }
        case 'field': {
          if (ev.id !== fieldId) return view(kind, state, draft, settings);
          if (ev.value === null || !Number.isFinite(ev.value)) return view(kind, { ...state, locked: undefined, live: undefined }, draft, settings);
          if (ev.value <= 0) return view(kind, state, draft, settings, 'app.sketch.hint.degenerate');
          if (ev.commit) {
            const next = { ...state, locked: ev.value, live: undefined };
            return batching(next) ? confirmBatch(next, draft, settings) : state.pending ? confirm(next, draft, settings) : view(kind, next, draft, settings);
          }
          return view(kind, { ...state, live: ev.value }, draft, settings);
        }
        case 'key': {
          if (ev.key === 'Enter' && batching(state)) return confirmBatch(state, draft, settings);
          if (ev.key === 'Enter' && state.pending) return confirm(state, draft, settings);
          if (ev.key !== 'Escape') return view(kind, state, draft, settings);
          if (state.live !== undefined || state.locked !== undefined) return view(kind, { ...state, live: undefined, locked: undefined }, draft, settings);
          return view(kind, { amount: state.amount }, draft, settings);
        }
      }
    },
  };
}
