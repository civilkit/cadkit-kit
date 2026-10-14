/**
 * Sketch patterns: copies of selected geometry along a line (`pattern-linear`) or around a centre (`pattern-circular`).
 * Both tools: click entities to select them (click again to unselect), Enter, then set the pattern (below), then click or
 * press Enter to make it. Escape clears typed values, then goes back one step, then drops the selection.
 *
 *  - linear: move the pointer to where the SECOND instance should sit (its distance from the first is the spacing, its
 *    direction the angle; within 2 degrees of horizontal or vertical the direction snaps to it when auto-constraints are
 *    on); or type `d` (spacing), `a` (angle, degrees) and `n` (count including the original). Tab or Enter locks a
 *    typed value; click or Enter applies.
 *  - circular: click the centre (an existing point, else a new fixed point), then type `n` (count including the original;
 *    the copies are spread over 360 degrees) and/or `a` (the angle between neighbours, degrees; negative = clockwise);
 *    click or Enter applies.
 *
 * What it writes: real copies (fresh points and entities, same fields, `construction` kept) and constraints that make a
 * copy a rigid, parametric image of the original, verified against the solver in pattern.kernel.test.ts:
 *  - the ANCHOR point (the first selected point; the one farthest from the centre for circular) of copy k is placed from
 *    copy k-1's anchor: linear = `hdist` + `vdist` between them (or `horizontal` / `vertical` when that component is 0),
 *    so the spacing is a driving dimension, one per copy; circular = a construction line from the centre to each anchor
 *    (`equal` length to the first) and an `angle` dimension between neighbouring lines, so the step angle is a driving
 *    dimension (a negative step writes the pair the other way round);
 *  - every other point of a copy is placed against its anchor: linear = `hdist` / `vdist` (or `horizontal` / `vertical`),
 *    circular = `distance` to the centre and to the anchor (two circles; the solver keeps the solution nearest the drawn
 *    one). These constraints carry `hidden: true` so the canvas shows only the spacing dimensions; the constraint list
 *    still lists them;
 *  - a copied circle gets `equal` to its original, a copied ellipse a `radius`. A copied arc is not placed at its centre
 *    but gets `equal` (radius) to its original: the solver already ties both ends of an arc to one radius, and placing
 *    all three points as well would be one constraint too many (it would show as over-constrained). When the centre is
 *    shared with something else selected, one arc end gets only one of its two placing constraints instead;
 *  - the originals and their constraints are not touched. The copies follow the SPACING (and the anchor), not the later
 *    shape of the original: reshaping the original does not reshape the copies.
 */
import type { SketchDraft } from '../index';
import { entityShape } from '../select';
import { arcSweep, TOL } from './edit-geom';
import { curveOf, entityOf, entityPoints, ptOf, withConstraint, withEntity, withPoint } from './edit-draft';
import type { FieldSpec, Pt, PreviewShape, Tool, ToolOutput, ToolSettings } from './types';

export const MAX_COUNT = 99;
const PATTERNABLE = new Set(['line', 'circle', 'arc', 'ellipse', 'point', 'spline', 'cvspline']);
const hidden = { hidden: true };

/** The distinct points the entities use, in order of first use. */
function pointsOf(draft: SketchDraft, ids: string[]): string[] {
  const out: string[] = [];
  for (const id of ids) { const e = entityOf(draft, id); if (e) for (const p of entityPoints(e)) if (!out.includes(p)) out.push(p); }
  return out;
}

const dirDeg = (a: Pt, b: Pt) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
const rad = (deg: number) => (deg * Math.PI) / 180;

export interface LinearSpec { n: number; spacing: number; angleDeg: number }
export interface CircularSpec { n: number; stepDeg: number; center: { at: Pt; pointId?: string } }
export type PatternRes = { ok: true; draft: SketchDraft; created: string[] } | { ok: false; hint: string };

/** Shared copying: `place(p, k)` is where point p goes in copy k (k = 1..n-1). Returns the new point ids per copy. */
function copyGeometry(draft: SketchDraft, ids: string[], count: number, place: (p: Pt, k: number) => Pt, keep: (id: string) => string | null) {
  let d = draft;
  const created: string[] = [];
  const maps: Array<Map<string, string>> = [];
  const entMaps: Array<Map<string, string>> = [];
  const src = pointsOf(d, ids);
  for (let k = 1; k < count; k++) {
    const em = new Map<string, string>();
    entMaps.push(em);
    const m = new Map<string, string>();
    for (const pid of src) {
      const same = keep(pid);
      if (same) { m.set(pid, same); continue; }
      const added = withPoint(d, place(ptOf(d, pid)!, k));
      d = added.draft; m.set(pid, added.id); created.push(added.id);
    }
    maps.push(m);
    for (const id of ids) {
      const e = entityOf(draft, id)!;
      const { id: _id, ...rest } = e;
      const f: Record<string, unknown> = { ...rest };
      for (const key of ['c', 'p', 'p1', 'p2']) if (typeof e[key] === 'string') f[key] = m.get(e[key] as string);
      if (Array.isArray(e.pts)) f.pts = (e.pts as string[]).map((q) => m.get(q));
      const added = withEntity(d, f);
      d = added.draft; created.push(added.id); em.set(id, added.id);
      // shape constraints that do not depend on position
      if (e.type === 'circle') d = withConstraint(d, 'equal', [e.id, added.id], hidden);
      else if (e.type === 'ellipse') d = withConstraint(d, 'radius', [added.id], { value: Number(e.r), ...hidden });
    }
  }
  return { draft: d, created, maps, entMaps, src };
}

/**
 * The solver ties both ends of an arc to one radius, so placing all three of its points and keeping that tie would be one
 * constraint too many (the sketch would read as over-constrained). Per arc, one of these is left out:
 *  - its CENTRE, when nothing else selected uses that point: the copy then gets `equal` (same radius) to its original, and the
 *    centre follows from the two placed ends and the radius (the solver keeps the solution nearest the drawn one);
 *  - otherwise one END (preferably the second), which then gets one of its two placing constraints only.
 * Never the anchor, and never a point `never` rules out.
 */
function arcPlan(draft: SketchDraft, ids: string[], anchor: string, never: (id: string) => boolean = () => false) {
  const use = new Map<string, number>();
  for (const id of ids) { const e = entityOf(draft, id); if (e) for (const p of new Set(entityPoints(e))) use.set(p, (use.get(p) ?? 0) + 1); }
  const centres = new Set<string>(), equalArcs: string[] = [], half = new Map<string, string>();   // half: relaxed end -> its arc's centre
  for (const id of ids) {
    const e = entityOf(draft, id);
    if (e?.type !== 'arc') continue;
    const c = String(e.c);
    const g = curveOf(draft, e);
    // a half circle makes the centre-from-radius solution degenerate (the two roots meet), so there one end is relaxed instead
    const nearSemicircle = !g || g.kind !== 'arc' || Math.abs(arcSweep(g) - Math.PI) < (15 * Math.PI) / 180;
    if (!nearSemicircle && (use.get(c) ?? 0) === 1 && c !== anchor && !never(c) && !centres.has(c)) { centres.add(c); equalArcs.push(id); continue; }
    const pick = [String(e.p2), String(e.p1), c].find((q) => q !== anchor && !half.has(q) && !centres.has(q) && !never(q));
    if (pick) half.set(pick, c);
  }
  return { centres, equalArcs, half };
}

export function linearInstances(spec: LinearSpec): Pt[] {
  const v = { x: spec.spacing * Math.cos(rad(spec.angleDeg)), y: spec.spacing * Math.sin(rad(spec.angleDeg)) };
  return Array.from({ length: spec.n }, (_, k) => ({ x: k * v.x, y: k * v.y }));
}

export function applyLinear(draft: SketchDraft, ids: string[], spec: LinearSpec): PatternRes {
  const sel = ids.filter((i) => { const e = entityOf(draft, i); return e && PATTERNABLE.has(String(e.type)); });
  if (!sel.length) return { ok: false, hint: 'app.sketch.hint.nothingToPattern' };
  if (!(spec.spacing > TOL)) return { ok: false, hint: 'app.sketch.hint.degenerate' };
  if (!Number.isInteger(spec.n) || spec.n < 2 || spec.n > MAX_COUNT) return { ok: false, hint: 'app.sketch.hint.patternCount' };
  const v = { x: spec.spacing * Math.cos(rad(spec.angleDeg)), y: spec.spacing * Math.sin(rad(spec.angleDeg)) };
  const r = copyGeometry(draft, sel, spec.n, (p, k) => ({ x: p.x + k * v.x, y: p.y + k * v.y }), () => null);
  let d = r.draft;
  const anchor = r.src[0];
  const A = ptOf(draft, anchor)!;
  const { centres, equalArcs, half } = arcPlan(draft, sel, anchor);
  const axis = (a: string, b: string, dx: number, dy: number, extra: Record<string, unknown>, keep: 'both' | 'x' | 'y' = 'both') => {
    if (keep !== 'y') {
      if (Math.abs(dx) <= 1e-9) d = withConstraint(d, 'vertical', [a, b], extra); else d = withConstraint(d, 'hdist', [a, b], { value: Math.abs(dx), ...extra });
    }
    if (keep !== 'x') {
      if (Math.abs(dy) <= 1e-9) d = withConstraint(d, 'horizontal', [a, b], extra); else d = withConstraint(d, 'vdist', [a, b], { value: Math.abs(dy), ...extra });
    }
  };
  r.maps.forEach((m, i) => {
    const Ak = m.get(anchor)!;
    const prev = i === 0 ? anchor : r.maps[i - 1].get(anchor)!;
    axis(prev, Ak, v.x, v.y, {});                                  // the spacing dimension: visible
    for (const pid of r.src) {
      if (pid === anchor || centres.has(pid)) continue;
      const P = ptOf(draft, pid)!;
      // a relaxed arc end keeps the coordinate the arc equation can best correct: drop the one in which it sits farther from the centre
      const cen = half.has(pid) ? ptOf(draft, half.get(pid)!)! : null;
      const keep = cen ? (Math.abs(P.x - cen.x) >= Math.abs(P.y - cen.y) ? 'y' : 'x') : 'both';
      axis(Ak, m.get(pid)!, P.x - A.x, P.y - A.y, hidden, keep);
    }
    for (const a of equalArcs) d = withConstraint(d, 'equal', [a, r.entMaps[i].get(a)!], hidden);
  });
  return { ok: true, draft: d, created: r.created };
}

export function applyCircular(draft: SketchDraft, ids: string[], spec: CircularSpec): PatternRes {
  const sel = ids.filter((i) => { const e = entityOf(draft, i); return e && PATTERNABLE.has(String(e.type)); });
  if (!sel.length) return { ok: false, hint: 'app.sketch.hint.nothingToPattern' };
  if (!Number.isInteger(spec.n) || spec.n < 2 || spec.n > MAX_COUNT) return { ok: false, hint: 'app.sketch.hint.patternCount' };
  if (!(Math.abs(spec.stepDeg) > 1e-9)) return { ok: false, hint: 'app.sketch.hint.degenerate' };
  let d = draft;
  let cId = spec.center.pointId;
  if (!cId) { const a = withPoint(d, spec.center.at); cId = a.id; d = { ...a.draft, points: a.draft.points.map((p) => (p.id === a.id ? { ...p, fixed: true } : p)) }; }
  const C = ptOf(d, cId)!;
  const base = d;
  const src0 = pointsOf(base, sel);
  // the anchor is the point farthest from the centre (a point at the centre cannot define an angle)
  const dc = (p: string) => Math.hypot(ptOf(base, p)!.x - C.x, ptOf(base, p)!.y - C.y);
  const anchor = src0.filter((p) => p !== cId).sort((a, b) => dc(b) - dc(a))[0];
  if (!anchor || dc(anchor) <= TOL) return { ok: false, hint: 'app.sketch.hint.degenerate' };
  const rot = (p: Pt, k: number): Pt => {
    const t = rad(spec.stepDeg) * k, c = Math.cos(t), s = Math.sin(t);
    return { x: C.x + (p.x - C.x) * c - (p.y - C.y) * s, y: C.y + (p.x - C.x) * s + (p.y - C.y) * c };
  };
  const r = copyGeometry(base, sel, spec.n, rot, (id) => (id === cId || dc(id) <= TOL ? cId! : null));
  d = r.draft;
  const A = ptOf(base, anchor)!;
  const { centres, equalArcs, half } = arcPlan(base, sel, anchor, (q) => q === cId || dc(q) <= TOL);
  // construction radial lines centre -> anchor of each instance
  const radial: string[] = [];
  const first = withEntity(d, { type: 'line', p1: cId, p2: anchor, construction: true });
  d = first.draft; radial.push(first.id); r.created.push(first.id);
  r.maps.forEach((m, i) => {
    const Ak = m.get(anchor)!;
    const line = withEntity(d, { type: 'line', p1: cId, p2: Ak, construction: true });
    d = line.draft; radial.push(line.id); r.created.push(line.id);
    d = withConstraint(d, 'equal', [radial[0], line.id], hidden);
    const deg = Math.abs(spec.stepDeg) % 360 || 360;
    // the turn from the earlier line to the later one is +step (counter-clockwise); a clockwise step reads the pair backwards
    d = spec.stepDeg > 0 ? withConstraint(d, 'angle', [radial[i], line.id], { value: deg }) : withConstraint(d, 'angle', [line.id, radial[i]], { value: deg });
    const thetaA = Math.atan2(A.y - C.y, A.x - C.x);
    for (const pid of r.src) {
      if (pid === anchor || m.get(pid) === cId || centres.has(pid)) continue;
      const P = ptOf(base, pid)!;
      const Pk = m.get(pid)!;
      // placed by its turn from the anchor as seen from the centre (an angle, so the solver cannot choose the mirror image)
      // and, unless it is the arc end the solver already ties to a radius, by its distance from the centre
      const pl = withEntity(d, { type: 'line', p1: cId, p2: Pk, construction: true });
      d = pl.draft; r.created.push(pl.id);
      let delta = Math.atan2(P.y - C.y, P.x - C.x) - thetaA;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta <= -Math.PI) delta += 2 * Math.PI;
      const pdeg = (Math.abs(delta) * 180) / Math.PI;
      // a relaxed arc end keeps whichever of the two the arc equation can best correct: the ray (angle) or the circle about the centre
      let keep: 'both' | 'angle' | 'distance' = 'both';
      if (half.has(pid)) {
        const cen = ptOf(base, half.get(pid)!)!;
        const rl = Math.hypot(P.x - C.x, P.y - C.y);
        const u = { x: (P.x - C.x) / rl, y: (P.y - C.y) / rl };
        const gRay = Math.abs((P.x - cen.x) * u.x + (P.y - cen.y) * u.y), gCirc = Math.abs((P.x - cen.x) * -u.y + (P.y - cen.y) * u.x);
        keep = gRay >= gCirc ? 'angle' : 'distance';
      }
      if (keep !== 'distance') d = delta >= 0 ? withConstraint(d, 'angle', [line.id, pl.id], { value: pdeg, ...hidden }) : withConstraint(d, 'angle', [pl.id, line.id], { value: pdeg, ...hidden });
      if (keep !== 'angle') d = withConstraint(d, 'distance', [cId!, Pk], { value: Math.hypot(P.x - C.x, P.y - C.y), ...hidden });
    }
    for (const a of equalArcs) d = withConstraint(d, 'equal', [a, r.entMaps[i].get(a)!], hidden);
  });
  return { ok: true, draft: d, created: r.created };
}

// ---------------------------------------------------------------- previews

function shapesOfCopies(draft: SketchDraft, ids: string[], count: number, place: (p: Pt, k: number) => Pt): PreviewShape[] {
  const out: PreviewShape[] = [];
  for (let k = 1; k < count; k++) {
    const pts = new Map<string, Pt>();
    const moved: SketchDraft = { ...draft, points: draft.points.map((p) => { const q = place({ x: p.x, y: p.y }, k); pts.set(p.id, q); return { ...p, x: q.x, y: q.y }; }) };
    for (const id of ids) out.push(...(entityShape(moved, id) as PreviewShape[]));
  }
  return out;
}

// ---------------------------------------------------------------- tools

interface SelState { selected: string[] }
const toggle = (s: string[], id: string) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
const highlight = (draft: SketchDraft, ids: string[]): PreviewShape[] => ids.flatMap((id) => entityShape(draft, id) as PreviewShape[]);

export interface LinearState extends SelState {
  phase: 'select' | 'set';
  n: number;
  lockedD?: number; liveD?: number; lockedA?: number; liveA?: number;
  /** from the pointer */
  ptr?: Pt;
}

function linearSpec(draft: SketchDraft, s: LinearState, settings: ToolSettings): LinearSpec | null {
  const anchor = pointsOf(draft, s.selected)[0];
  const A = anchor ? ptOf(draft, anchor) : null;
  if (!A) return null;
  let spacing = s.lockedD ?? s.liveD;
  let angle = s.lockedA ?? s.liveA;
  if (s.ptr && (spacing === undefined || angle === undefined)) {
    const dx = s.ptr.x - A.x, dy = s.ptr.y - A.y;
    if (angle === undefined) {
      angle = dirDeg(A, s.ptr);
      if (settings.autoConstraints) for (const snap of [0, 90, 180, -90, -180]) if (Math.abs(angle - snap) < 2) angle = snap;
    }
    // the spacing is how far the pointer is along the chosen direction (the plain distance unless the angle snapped)
    if (spacing === undefined) spacing = dx * Math.cos(rad(angle)) + dy * Math.sin(rad(angle));
  }
  return spacing !== undefined && angle !== undefined ? { n: s.n, spacing, angleDeg: angle } : null;
}

function linearView(state: LinearState, draft: SketchDraft, settings: ToolSettings, hint?: string): ToolOutput<LinearState> {
  let preview = highlight(draft, state.selected);
  const fields: FieldSpec[] = [];
  if (state.phase === 'set') {
    const spec = linearSpec(draft, state, settings);
    if (spec && spec.spacing > TOL && spec.n >= 2 && spec.n <= MAX_COUNT) {
      const v = { x: spec.spacing * Math.cos(rad(spec.angleDeg)), y: spec.spacing * Math.sin(rad(spec.angleDeg)) };
      preview = [...preview, ...shapesOfCopies(draft, state.selected, spec.n, (p, k) => ({ x: p.x + k * v.x, y: p.y + k * v.y }))];
    }
    if (settings.onViewValues !== 'off') {
      fields.push(
        { id: 'n', label: 'app.sketch.field.count', value: state.n, locked: false, unit: 'count' },
        { id: 'd', label: 'app.sketch.field.spacing', value: spec?.spacing ?? 0, locked: state.lockedD !== undefined, unit: 'length' },
        { id: 'a', label: 'app.sketch.field.angle', value: spec?.angleDeg ?? 0, locked: state.lockedA !== undefined, unit: 'angle' },
      );
    }
  }
  return { state, draft, preview, fields, ...(hint ? { hint } : {}) };
}

export const linearPatternTool: Tool<LinearState> = {
  id: 'pattern-linear',
  start: () => ({ phase: 'select', selected: [], n: 3 }),
  step(state, ev, draft, settings): ToolOutput<LinearState> {
    const apply = (s: LinearState): ToolOutput<LinearState> => {
      const spec = linearSpec(draft, s, settings);
      if (!spec) return linearView(s, draft, settings, 'app.sketch.hint.patternPlace');
      const r = applyLinear(draft, s.selected, spec);
      if (!r.ok) return linearView(s, draft, settings, r.hint);
      return linearView({ phase: 'select', selected: [], n: s.n }, r.draft, settings);
    };
    switch (ev.type) {
      case 'move':
        return state.phase === 'set' ? linearView({ ...state, ptr: ev.snap?.at ?? ev.at }, draft, settings) : linearView(state, draft, settings);
      case 'click': {
        if (state.phase === 'select') {
          const id = ev.snap?.entityId;
          const e = id ? entityOf(draft, id) : undefined;
          if (!e || !PATTERNABLE.has(String(e.type))) return linearView(state, draft, settings, 'app.sketch.hint.pickEntity');
          return linearView({ ...state, selected: toggle(state.selected, e.id) }, draft, settings);
        }
        return apply({ ...state, ptr: ev.snap?.at ?? ev.at });
      }
      case 'field': {
        if (state.phase !== 'set') return linearView(state, draft, settings);
        if (ev.id === 'n') {
          if (ev.value === null || !Number.isFinite(ev.value)) return linearView(state, draft, settings);
          const n = Math.round(ev.value);
          return n < 2 || n > MAX_COUNT ? linearView(state, draft, settings, 'app.sketch.hint.patternCount') : linearView({ ...state, n }, draft, settings);
        }
        if (ev.id !== 'd' && ev.id !== 'a') return linearView(state, draft, settings);
        const k = ev.id === 'd' ? 'D' : 'A';
        if (ev.value === null || !Number.isFinite(ev.value)) return linearView({ ...state, [`locked${k}`]: undefined, [`live${k}`]: undefined }, draft, settings);
        if (ev.id === 'd' && ev.value <= 0) return linearView(state, draft, settings, 'app.sketch.hint.degenerate');
        return linearView(ev.commit ? { ...state, [`locked${k}`]: ev.value, [`live${k}`]: undefined } : { ...state, [`live${k}`]: ev.value }, draft, settings);
      }
      case 'key': {
        if (ev.key === 'Enter') {
          if (state.phase === 'select') {
            return state.selected.length ? linearView({ ...state, phase: 'set' }, draft, settings) : linearView(state, draft, settings, 'app.sketch.hint.nothingToPattern');
          }
          return apply(state);
        }
        if (ev.key === 'Escape') {
          if (state.lockedD !== undefined || state.liveD !== undefined || state.lockedA !== undefined || state.liveA !== undefined) {
            return linearView({ ...state, lockedD: undefined, liveD: undefined, lockedA: undefined, liveA: undefined }, draft, settings);
          }
          if (state.phase === 'set') return linearView({ ...state, phase: 'select', ptr: undefined }, draft, settings);
          return linearView({ ...state, selected: [] }, draft, settings);
        }
        return linearView(state, draft, settings);
      }
    }
  },
};

export interface CircularState extends SelState {
  phase: 'select' | 'center' | 'set';
  n: number;
  center?: { at: Pt; pointId?: string };
  lockedA?: number; liveA?: number;
}

const stepOf = (s: CircularState) => s.lockedA ?? s.liveA ?? 360 / s.n;

function circularView(state: CircularState, draft: SketchDraft, settings: ToolSettings, hint?: string): ToolOutput<CircularState> {
  let preview = highlight(draft, state.selected);
  const fields: FieldSpec[] = [];
  if (state.phase === 'set' && state.center) {
    const C = state.center.at, step = stepOf(state);
    if (state.n >= 2 && state.n <= MAX_COUNT) {
      preview = [...preview, ...shapesOfCopies(draft, state.selected, state.n, (p, k) => {
        const t = rad(step) * k, c = Math.cos(t), s = Math.sin(t);
        return { x: C.x + (p.x - C.x) * c - (p.y - C.y) * s, y: C.y + (p.x - C.x) * s + (p.y - C.y) * c };
      })];
    }
    if (settings.onViewValues !== 'off') {
      fields.push(
        { id: 'n', label: 'app.sketch.field.count', value: state.n, locked: false, unit: 'count' },
        { id: 'a', label: 'app.sketch.field.angle', value: step, locked: state.lockedA !== undefined, unit: 'angle' },
      );
    }
  }
  return { state, draft, preview, fields, ...(hint ? { hint } : {}) };
}

export const circularPatternTool: Tool<CircularState> = {
  id: 'pattern-circular',
  start: () => ({ phase: 'select', selected: [], n: 6 }),
  step(state, ev, draft, settings): ToolOutput<CircularState> {
    const apply = (s: CircularState): ToolOutput<CircularState> => {
      const r = applyCircular(draft, s.selected, { n: s.n, stepDeg: stepOf(s), center: s.center! });
      if (!r.ok) return circularView(s, draft, settings, r.hint);
      return circularView({ phase: 'select', selected: [], n: s.n }, r.draft, settings);
    };
    switch (ev.type) {
      case 'move': return circularView(state, draft, settings);
      case 'click': {
        if (state.phase === 'select') {
          const id = ev.snap?.entityId;
          const e = id ? entityOf(draft, id) : undefined;
          if (!e || !PATTERNABLE.has(String(e.type))) return circularView(state, draft, settings, 'app.sketch.hint.pickEntity');
          return circularView({ ...state, selected: toggle(state.selected, e.id) }, draft, settings);
        }
        if (state.phase === 'center') {
          const at = ev.snap?.at ?? ev.at;
          return circularView({ ...state, phase: 'set', center: { at, ...(ev.snap?.pointId ? { pointId: ev.snap.pointId } : {}) } }, draft, settings);
        }
        return apply(state);
      }
      case 'field': {
        if (state.phase !== 'set') return circularView(state, draft, settings);
        if (ev.id === 'n') {
          if (ev.value === null || !Number.isFinite(ev.value)) return circularView(state, draft, settings);
          const n = Math.round(ev.value);
          return n < 2 || n > MAX_COUNT ? circularView(state, draft, settings, 'app.sketch.hint.patternCount') : circularView({ ...state, n }, draft, settings);
        }
        if (ev.id !== 'a') return circularView(state, draft, settings);
        if (ev.value === null || !Number.isFinite(ev.value)) return circularView({ ...state, lockedA: undefined, liveA: undefined }, draft, settings);
        if (ev.value === 0) return circularView(state, draft, settings, 'app.sketch.hint.degenerate');
        return circularView(ev.commit ? { ...state, lockedA: ev.value, liveA: undefined } : { ...state, liveA: ev.value }, draft, settings);
      }
      case 'key': {
        if (ev.key === 'Enter') {
          if (state.phase === 'select') {
            return state.selected.length ? circularView({ ...state, phase: 'center' }, draft, settings, 'app.sketch.hint.pickCenter') : circularView(state, draft, settings, 'app.sketch.hint.nothingToPattern');
          }
          return state.phase === 'set' ? apply(state) : circularView(state, draft, settings, 'app.sketch.hint.pickCenter');
        }
        if (ev.key === 'Escape') {
          if (state.lockedA !== undefined || state.liveA !== undefined) return circularView({ ...state, lockedA: undefined, liveA: undefined }, draft, settings);
          if (state.phase === 'set') return circularView({ ...state, phase: 'center', center: undefined }, draft, settings);
          if (state.phase === 'center') return circularView({ ...state, phase: 'select' }, draft, settings);
          return circularView({ ...state, selected: [] }, draft, settings);
        }
        return circularView(state, draft, settings);
      }
    }
  },
};

