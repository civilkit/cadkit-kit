/**
 * Sketch patterns: copies of selected geometry along a line (`pattern-linear`) or around a centre (`pattern-circular`).
 * Both tools: click entities to select them (click again to unselect) or have them selected in Select mode before choosing the
 * tool (that skips this step), then press Enter, or click on empty space (which also counts as the first pattern click), then set
 * the pattern (below), then click or press Enter to make it. Every step shows a hint. Escape clears typed values, then goes
 * back one step, then drops the selection.
 *
 *  - linear: a rows x columns grid, set in the pattern panel (the layout of the 3D linear pattern's editor). Direction 1
 *    (columns) has a count (the original included), an angle (typed, or taken from a line picked in the sketch; horizontal
 *    until set) and a spacing between copies, or, switched to `total length`, the length from the first copy to the last.
 *    Direction 2 (rows) is the same group, off at count 1, at 90 degrees to direction 1 until its angle is set. A live preview
 *    shows every copy; Enter or OK makes the pattern, Escape clears the typed values, then goes back a step.
 *    The older gesture is kept as a shortcut: until the pointer enters the panel, direction 1 follows the pointer (where the
 *    SECOND instance should sit: its distance from the first is the spacing, its direction the angle; within 2 degrees of
 *    horizontal or vertical the angle snaps when auto-constraints are on) and a click on the canvas makes the pattern. Typing
 *    digits goes to the on-view fields `n`, `d` and `a` (count, spacing, angle of direction 1), Tab or Enter locks a value.
 *  - circular: click the centre (an existing point, else a new fixed point), then set the count (including the original;
 *    the copies are spread over 360 degrees) and the angle, in the panel or the on-view fields `n` and `a`. The angle is the
 *    STEP between neighbours (negative = clockwise) or, switched to `total angle`, the turn from the first copy to the last
 *    (360 spreads the copies right round). Click or Enter applies.
 *
 * What it writes: real copies (fresh points and entities, same fields, `construction` kept) and constraints that make a
 * copy a rigid, parametric image of the original, verified against the solver in pattern.kernel.test.ts:
 *  - the ANCHOR point (the first selected point; the one farthest from the centre for circular) of copy k is placed from
 *    copy k-1's anchor: linear = `hdist` + `vdist` between them (or `horizontal` / `vertical` when that component is 0),
 *    so the spacing is a driving dimension, one per copy. In a grid the first row is written so; direction 2 adds ONE
 *    spacing (the first copy of row 2 from the original) and every later copy is that same step again from the one below
 *    it, a construction line kept `parallel` and `equal` to the first step: spacing 1 and spacing 2 drive the whole grid; circular = a construction line from the centre to each anchor
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
import type { FieldSpec, PanelRow, PanelSpec, Pt, PreviewShape, Tool, ToolEnv, ToolOutput, ToolSettings } from './types';

export const MAX_COUNT = 99;
/** The most instances (rows x columns) one pattern makes: every copy is a set of real points and constraints for the solver. */
export const MAX_INSTANCES = 200;
const PATTERNABLE = new Set(['line', 'circle', 'arc', 'ellipse', 'point', 'spline', 'cvspline', 'text']);
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
/** A rows x columns grid: `n1` instances (the original included) along direction 1, `n2` along direction 2. Row-major: the first row comes first. */
export interface GridSpec { n1: number; spacing1: number; angle1: number; n2: number; spacing2: number; angle2: number }
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

const vec = (spacing: number, angleDeg: number): Pt => ({ x: spacing * Math.cos(rad(angleDeg)), y: spacing * Math.sin(rad(angleDeg)) });
/** Where instance k (row-major) of a grid sits relative to the original. */
export const gridOffset = (g: GridSpec, k: number): Pt => {
  const i = k % g.n1, j = Math.floor(k / g.n1), a = vec(g.spacing1, g.angle1), b = vec(g.spacing2, g.angle2);
  return { x: i * a.x + j * b.x, y: i * a.y + j * b.y };
};

export function applyLinear(draft: SketchDraft, ids: string[], spec: LinearSpec): PatternRes {
  if (!Number.isInteger(spec.n) || spec.n < 2 || spec.n > MAX_COUNT) return { ok: false, hint: 'app.sketch.hint.patternCount' };
  return applyGrid(draft, ids, { n1: spec.n, spacing1: spec.spacing, angle1: spec.angleDeg, n2: 1, spacing2: 0, angle2: spec.angleDeg + 90 });
}

/**
 * The grid pattern. Direction 1 is written as before: each step from the previous instance's anchor is a driving `hdist` / `vdist` pair
 * (or `horizontal` / `vertical`). Direction 2 adds ONE spacing (the anchor of the first copy of row 2 from the original's anchor): every
 * other copy in row 2 and after is that same step again from the instance below it, as a construction line kept parallel and equal to
 * the first one. So editing spacing 1 or spacing 2 moves the whole grid, and no other dimension is added.
 */
export function applyGrid(draft: SketchDraft, ids: string[], g: GridSpec): PatternRes {
  const sel = ids.filter((i) => { const e = entityOf(draft, i); return e && PATTERNABLE.has(String(e.type)); });
  if (!sel.length) return { ok: false, hint: 'app.sketch.hint.nothingToPattern' };
  if (!Number.isInteger(g.n1) || !Number.isInteger(g.n2) || g.n1 < 1 || g.n2 < 1 || g.n1 > MAX_COUNT || g.n2 > MAX_COUNT || g.n1 * g.n2 < 2) return { ok: false, hint: 'app.sketch.hint.patternCount' };
  if (g.n1 * g.n2 > MAX_INSTANCES) return { ok: false, hint: 'app.sketch.hint.patternTooMany' };
  if ((g.n1 > 1 && !(g.spacing1 > TOL)) || (g.n2 > 1 && !(g.spacing2 > TOL))) return { ok: false, hint: 'app.sketch.hint.degenerate' };
  const v1 = vec(g.spacing1, g.angle1), v2 = vec(g.spacing2, g.angle2);
  if (g.n1 > 1 && g.n2 > 1 && Math.abs(v1.x * v2.y - v1.y * v2.x) <= 1e-9 * g.spacing1 * g.spacing2) return { ok: false, hint: 'app.sketch.hint.patternParallel' };
  const r = copyGeometry(draft, sel, g.n1 * g.n2, (p, k) => { const o = gridOffset(g, k); return { x: p.x + o.x, y: p.y + o.y }; }, () => null);
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
  const anchorOf = (k: number) => (k === 0 ? anchor : r.maps[k - 1].get(anchor)!);
  let step2: string | null = null;                              // the construction line the later rows copy
  r.maps.forEach((m, idx) => {
    const k = idx + 1, i = k % g.n1, j = Math.floor(k / g.n1);
    const Ak = m.get(anchor)!;
    if (j === 0) axis(anchorOf(k - 1), Ak, v1.x, v1.y, {});    // spacing 1: visible, one per step
    else if (i === 0 && j === 1) {                              // spacing 2: visible, once
      axis(anchorOf(0), Ak, v2.x, v2.y, {});
      const line = withEntity(d, { type: 'line', p1: anchorOf(0), p2: Ak, construction: true });
      d = line.draft; step2 = line.id; r.created.push(line.id);
    } else {
      const line = withEntity(d, { type: 'line', p1: anchorOf(k - g.n1), p2: Ak, construction: true });
      d = line.draft; r.created.push(line.id);
      d = withConstraint(d, 'parallel', [step2!, line.id], hidden);
      d = withConstraint(d, 'equal', [step2!, line.id], hidden);
    }
    for (const pid of r.src) {
      if (pid === anchor || centres.has(pid)) continue;
      const P = ptOf(draft, pid)!;
      // a relaxed arc end keeps the coordinate the arc equation can best correct: drop the one in which it sits farther from the centre
      const cen = half.has(pid) ? ptOf(draft, half.get(pid)!)! : null;
      const keep = cen ? (Math.abs(P.x - cen.x) >= Math.abs(P.y - cen.y) ? 'y' : 'x') : 'both';
      axis(Ak, m.get(pid)!, P.x - A.x, P.y - A.y, hidden, keep);
    }
    for (const a of equalArcs) d = withConstraint(d, 'equal', [a, r.entMaps[idx].get(a)!], hidden);
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

const PICKABLE = (draft: SketchDraft, id: string | undefined) => { const e = id ? entityOf(draft, id) : undefined; return e && PATTERNABLE.has(String(e.type)) ? e : undefined; };
/** Entities selected in Select mode before the tool was chosen. */
const preselected = (draft: SketchDraft, env?: ToolEnv): string[] => (env?.entities ?? []).filter((id) => PICKABLE(draft, id));
/** What to do next, per step: the hint every view carries unless a refusal replaces it. */
const hintSelect = (n: number) => (n ? 'app.sketch.hint.patternPickMore' : 'app.sketch.hint.patternPick');

type Num = number | undefined;
const rec = (s: object) => s as Record<string, Num>;
const normDeg = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
/** A typed value is shown as the spacing between copies, or (in total mode) as the length from the first copy to the last. */
const toStep = (v: number, total: boolean | undefined, n: number) => (total && n > 1 ? v / (n - 1) : v);
const toShown = (step: number, total: boolean | undefined, n: number) => (total && n > 1 ? step * (n - 1) : step);

/** The size of what is being repeated, so the first guess at a spacing leaves a gap. Circles count with their radius. */
function selSize(draft: SketchDraft, ids: string[]): { w: number; h: number } {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const add = (x: number, y: number) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
  for (const id of ids) {
    const e = entityOf(draft, id);
    if (!e) continue;
    for (const pid of entityPoints(e)) { const p = ptOf(draft, pid); if (p) add(p.x, p.y); }
    if (e.type === 'circle') { const c = ptOf(draft, String(e.c)); const r = Number(e.r); if (c && r > 0) { add(c.x - r, c.y - r); add(c.x + r, c.y + r); } }
  }
  return x1 >= x0 ? { w: x1 - x0, h: y1 - y0 } : { w: 0, h: 0 };
}
function defaultStep(draft: SketchDraft, ids: string[], angle: number): number {
  const { w, h } = selSize(draft, ids);
  const ext = Math.abs(Math.cos(rad(angle))) * w + Math.abs(Math.sin(rad(angle))) * h;
  return ext > TOL ? Math.round(ext * 150) / 100 : 10;
}

export interface LinearState extends SelState {
  phase: 'select' | 'set';
  /** columns (direction 1) and rows (direction 2), the original included */
  n: number; n2: number;
  /** the spacing field means the length from the first copy to the last, not the step between neighbours */
  total1?: boolean; total2?: boolean;
  /** typed (locked) or being typed (live) values: spacing and angle of direction 1, then of direction 2 (suffix 2). The spacing is in the field's unit (see total1 / total2). */
  lockedD?: number; liveD?: number; lockedA?: number; liveA?: number;
  lockedD2?: number; liveD2?: number; lockedA2?: number; liveA2?: number;
  /** a line of the sketch is being picked for this direction */
  pick?: 1 | 2;
  /** false once the panel has been used: the pointer no longer sets direction 1 (until then it does, so the click gesture still works) */
  follow?: boolean;
  /** from the pointer */
  ptr?: Pt;
}

function gridSpecOf(draft: SketchDraft, s: LinearState, settings: ToolSettings): GridSpec | null {
  const anchor = pointsOf(draft, s.selected)[0];
  const A = anchor ? ptOf(draft, anchor) : null;
  if (!A) return null;
  const r = rec(s);
  const typedD = r.lockedD ?? r.liveD;
  let angle1 = r.lockedA ?? r.liveA;
  let step1 = typedD !== undefined ? toStep(typedD, s.total1, s.n) : undefined;
  if (s.follow !== false && s.ptr && (angle1 === undefined || step1 === undefined)) {
    const dx = s.ptr.x - A.x, dy = s.ptr.y - A.y;
    if (angle1 === undefined && Math.hypot(dx, dy) > TOL) {
      angle1 = dirDeg(A, s.ptr);
      if (settings.autoConstraints) for (const snap of [0, 90, 180, -90, -180]) if (Math.abs(angle1 - snap) < 2) angle1 = snap;
    }
    // the spacing is how far the pointer is along the chosen direction (the plain distance unless the angle snapped)
    if (step1 === undefined && angle1 !== undefined) { const along = dx * Math.cos(rad(angle1)) + dy * Math.sin(rad(angle1)); if (along > TOL) step1 = along; }
  }
  angle1 ??= 0;
  step1 ??= defaultStep(draft, s.selected, angle1);
  const angle2 = r.lockedA2 ?? r.liveA2 ?? normDeg(angle1 + 90);
  const typed2 = r.lockedD2 ?? r.liveD2;
  const step2 = typed2 !== undefined ? toStep(typed2, s.total2, s.n2) : defaultStep(draft, s.selected, angle2);
  return { n1: s.n, spacing1: step1, angle1, n2: s.n2, spacing2: step2, angle2 };
}

/** Would applyGrid take this? (Used to draw the preview and to offer OK.) */
const gridOk = (g: GridSpec | null): g is GridSpec => !!g && g.n1 >= 1 && g.n2 >= 1 && g.n1 * g.n2 >= 2 && g.n1 * g.n2 <= MAX_INSTANCES && g.n1 <= MAX_COUNT && g.n2 <= MAX_COUNT
  && (g.n1 === 1 || g.spacing1 > TOL) && (g.n2 === 1 || g.spacing2 > TOL);

function linearPanel(s: LinearState, g: GridSpec | null, ok: boolean): PanelSpec {
  const r = rec(s);
  const group = (sfx: '' | '2'): PanelSpec['groups'][number] => {
    const two = sfx === '2';
    const n = two ? s.n2 : s.n, total = two ? s.total2 : s.total1;
    const step = g ? (two ? g.spacing2 : g.spacing1) : 0, angle = g ? (two ? g.angle2 : g.angle1) : 0;
    const rows: PanelRow[] = [{ kind: 'number', id: 'n' + (two ? '2' : ''), label: 'app.sketch.pattern.count', value: n, unit: 'count' }];
    if (!two || n > 1) {
      rows.push(
        { kind: 'number', id: 'a' + sfx, label: 'app.sketch.pattern.angle', value: angle, unit: 'angle', locked: (r['lockedA' + sfx] ?? r['liveA' + sfx]) !== undefined },
        { kind: 'choice', id: 'tot' + (two ? 2 : 1), label: 'app.sketch.pattern.distanceType', value: total ? 1 : 0, options: ['app.sketch.pattern.spacing', 'app.sketch.pattern.totalLength'] },
        { kind: 'number', id: 'd' + sfx, label: total ? 'app.sketch.pattern.totalLength' : 'app.sketch.pattern.spacing', value: toShown(step, total, n), unit: 'length', locked: (r['lockedD' + sfx] ?? r['liveD' + sfx]) !== undefined },
        { kind: 'pick', id: 'pick' + (two ? 2 : 1), label: 'app.sketch.pattern.direction', active: s.pick === (two ? 2 : 1), button: 'app.sketch.pattern.pickLine' },
      );
    }
    return { id: two ? 'dir2' : 'dir1', title: two ? 'app.sketch.pattern.dir2' : 'app.sketch.pattern.dir1', rows };
  };
  return { title: 'app.sketch.tool.pattern-linear', groups: [group(''), group('2')], note: 'app.sketch.pattern.noteLinear', canApply: ok };
}

function linearView(state: LinearState, draft: SketchDraft, settings: ToolSettings, hint?: string): ToolOutput<LinearState> {
  let preview = highlight(draft, state.selected);
  const fields: FieldSpec[] = [];
  let panel: PanelSpec | undefined;
  if (state.phase === 'set') {
    const g = gridSpecOf(draft, state, settings);
    const ok = gridOk(g);
    if (ok) preview = [...preview, ...shapesOfCopies(draft, state.selected, g.n1 * g.n2, (p, k) => { const o = gridOffset(g, k); return { x: p.x + o.x, y: p.y + o.y }; })];
    if (settings.onViewValues !== 'off') {
      fields.push(
        { id: 'n', label: 'app.sketch.field.count', value: state.n, locked: false, unit: 'count' },
        { id: 'd', label: 'app.sketch.field.spacing', value: g ? toShown(g.spacing1, state.total1, state.n) : 0, locked: state.lockedD !== undefined, unit: 'length' },
        { id: 'a', label: 'app.sketch.field.angle', value: g?.angle1 ?? 0, locked: state.lockedA !== undefined, unit: 'angle' },
      );
    }
    panel = linearPanel(state, g, ok);
  }
  const h = hint ?? (state.phase === 'select' ? hintSelect(state.selected.length) : state.pick ? 'app.sketch.hint.patternPickLine' : 'app.sketch.hint.patternSetLinear');
  return { state, draft, preview, fields, ...(panel ? { panel } : {}), hint: h };
}

const TYPED_KEYS = ['lockedD', 'liveD', 'lockedA', 'liveA', 'lockedD2', 'liveD2', 'lockedA2', 'liveA2'] as const;
const clearTyped = (s: LinearState): LinearState => { const o = { ...s }; for (const k of TYPED_KEYS) delete o[k]; return o; };

export const linearPatternTool: Tool<LinearState> = {
  id: 'pattern-linear',
  start: () => ({ phase: 'select', selected: [], n: 3, n2: 1 }),
  step(state, ev, draft, settings, env?: ToolEnv): ToolOutput<LinearState> {
    // entities selected before the tool was chosen: go straight to the pattern
    if (state.phase === 'select' && !state.selected.length && preselected(draft, env).length) state = { ...state, selected: preselected(draft, env), phase: 'set' };
    const apply = (s: LinearState): ToolOutput<LinearState> => {
      const g = gridSpecOf(draft, s, settings);
      if (!g) return linearView(s, draft, settings, 'app.sketch.hint.patternPlace');
      const r = applyGrid(draft, s.selected, g);
      if (!r.ok) return linearView(s, draft, settings, r.hint);
      return linearView({ phase: 'select', selected: [], n: s.n, n2: 1 }, r.draft, settings);
    };
    switch (ev.type) {
      case 'move':
        return state.phase === 'set' && state.follow !== false ? linearView({ ...state, ptr: ev.snap?.at ?? ev.at }, draft, settings) : linearView(state, draft, settings);
      case 'click': {
        if (state.phase === 'select') {
          const e = PICKABLE(draft, ev.snap?.entityId);
          if (e) return linearView({ ...state, selected: toggle(state.selected, e.id) }, draft, settings);
          // a click on empty space with something selected is the first click of the pattern: on to the second-copy position
          if (state.selected.length) return linearView({ ...state, phase: 'set', ptr: ev.snap?.at ?? ev.at }, draft, settings);
          return linearView(state, draft, settings, 'app.sketch.hint.pickEntity');
        }
        if (state.pick) {
          // picking the direction: a line of the sketch gives its angle
          const line = ev.snap?.entityId ? entityOf(draft, ev.snap.entityId) : undefined;
          const a = line?.type === 'line' ? ptOf(draft, String(line.p1)) : null, b = line?.type === 'line' ? ptOf(draft, String(line.p2)) : null;
          if (!a || !b || Math.hypot(b.x - a.x, b.y - a.y) <= TOL) return linearView(state, draft, settings, 'app.sketch.hint.patternPickLine');
          const deg = Math.round(dirDeg(a, b) * 1e6) / 1e6;
          return linearView({ ...state, pick: undefined, follow: false, ...(state.pick === 1 ? { lockedA: deg, liveA: undefined } : { lockedA2: deg, liveA2: undefined }) }, draft, settings);
        }
        return apply(state.follow === false ? state : { ...state, ptr: ev.snap?.at ?? ev.at });
      }
      case 'field': {
        if (state.phase !== 'set') return linearView(state, draft, settings);
        const r = rec(state);
        if (ev.id === 'freeze') {
          // the pointer has gone to the panel: keep what it set
          if (state.follow === false) return linearView(state, draft, settings);
          const g = gridSpecOf(draft, state, settings);
          if (!g) return linearView({ ...state, follow: false }, draft, settings);
          return linearView({ ...state, follow: false, ...(r.lockedA === undefined ? { liveA: g.angle1 } : {}), ...(r.lockedD === undefined ? { liveD: toShown(g.spacing1, state.total1, state.n) } : {}) }, draft, settings);
        }
        if (ev.id === 'n' || ev.id === 'n2') {
          if (ev.value === null || !Number.isFinite(ev.value)) return linearView(state, draft, settings);
          const n = Math.round(ev.value);
          const n1 = ev.id === 'n' ? n : state.n, n2 = ev.id === 'n2' ? n : state.n2;
          if (n < 1 || n > MAX_COUNT || n1 * n2 < 2) return linearView(state, draft, settings, 'app.sketch.hint.patternCount');
          if (n1 * n2 > MAX_INSTANCES) return linearView(state, draft, settings, 'app.sketch.hint.patternTooMany');
          return linearView({ ...state, [ev.id]: n }, draft, settings);
        }
        if (ev.id === 'tot1' || ev.id === 'tot2') {
          // spacing <-> total length: what was typed keeps its step, so the shape does not change under the user
          const two = ev.id === 'tot2', sfx = two ? '2' : '', on = ev.value === 1, nn = two ? state.n2 : state.n, was = two ? state.total2 : state.total1;
          const conv = (v: Num): Num => (v === undefined ? v : toShown(toStep(v, was, nn), on, nn));
          return linearView({ ...state, [two ? 'total2' : 'total1']: on, ['lockedD' + sfx]: conv(r['lockedD' + sfx]), ['liveD' + sfx]: conv(r['liveD' + sfx]) }, draft, settings);
        }
        if (ev.id === 'pick1' || ev.id === 'pick2') return linearView({ ...state, pick: ev.value === 1 ? (ev.id === 'pick1' ? 1 : 2) : undefined }, draft, settings);
        const m = /^([da])(2?)$/.exec(ev.id);
        if (!m) return linearView(state, draft, settings);
        const k = (m[1] === 'd' ? 'D' : 'A') + m[2];
        if (ev.value === null || !Number.isFinite(ev.value)) return linearView({ ...state, [`locked${k}`]: undefined, [`live${k}`]: undefined }, draft, settings);
        if (m[1] === 'd' && ev.value <= 0) return linearView(state, draft, settings, 'app.sketch.hint.degenerate');
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
          if (state.pick) return linearView({ ...state, pick: undefined }, draft, settings);
          const r = rec(state);
          if (TYPED_KEYS.some((k) => r[k] !== undefined)) return linearView(clearTyped(state), draft, settings);
          if (state.phase === 'set') return linearView({ ...state, phase: 'select', ptr: undefined, follow: undefined, n2: 1 }, draft, settings);
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
  /** typed angle; its meaning follows `total` */
  lockedA?: number; liveA?: number;
  /** the angle field means the whole turn from the first to the last copy, not the step between neighbours */
  total?: boolean;
}

/** The step between neighbours that makes `total` degrees: a whole turn (360 or more) spreads the copies round, so the last does not land on the first. */
const stepOfTotal = (total: number, n: number) => (Math.abs(total) >= 360 - 1e-9 ? total / n : total / Math.max(n - 1, 1));
const totalOfStep = (step: number, n: number) => (Math.abs(Math.abs(step) * n - 360) < 1e-6 ? Math.sign(step) * 360 : step * (n - 1));
const stepOf = (s: CircularState) => { const v = s.lockedA ?? s.liveA; return v === undefined ? 360 / s.n : s.total ? stepOfTotal(v, s.n) : v; };

function circularView(state: CircularState, draft: SketchDraft, settings: ToolSettings, hint?: string): ToolOutput<CircularState> {
  let preview = highlight(draft, state.selected);
  const fields: FieldSpec[] = [];
  let panel: PanelSpec | undefined;
  if (state.phase === 'set' && state.center) {
    const C = state.center.at, step = stepOf(state);
    const ok = state.n >= 2 && state.n <= MAX_COUNT && Math.abs(step) > 1e-9;
    if (ok) {
      preview = [...preview, ...shapesOfCopies(draft, state.selected, state.n, (p, k) => {
        const t = rad(step) * k, c = Math.cos(t), s = Math.sin(t);
        return { x: C.x + (p.x - C.x) * c - (p.y - C.y) * s, y: C.y + (p.x - C.x) * s + (p.y - C.y) * c };
      })];
    }
    const shown = state.total ? totalOfStep(step, state.n) : step;
    if (settings.onViewValues !== 'off') {
      fields.push(
        { id: 'n', label: 'app.sketch.field.count', value: state.n, locked: false, unit: 'count' },
        { id: 'a', label: 'app.sketch.field.angle', value: shown, locked: state.lockedA !== undefined, unit: 'angle' },
      );
    }
    panel = {
      title: 'app.sketch.tool.pattern-circular',
      groups: [{ id: 'circ', rows: [
        { kind: 'number', id: 'n', label: 'app.sketch.pattern.count', value: state.n, unit: 'count' },
        { kind: 'choice', id: 'tot', label: 'app.sketch.pattern.angleType', value: state.total ? 1 : 0, options: ['app.sketch.pattern.stepAngle', 'app.sketch.pattern.totalAngle'] },
        { kind: 'number', id: 'a', label: state.total ? 'app.sketch.pattern.totalAngle' : 'app.sketch.pattern.stepAngle', value: shown, unit: 'angle', locked: state.lockedA !== undefined || state.liveA !== undefined },
      ] }],
      note: 'app.sketch.pattern.noteCircular',
      canApply: ok,
    };
  }
  const h = hint ?? (state.phase === 'select' ? hintSelect(state.selected.length) : state.phase === 'center' ? 'app.sketch.hint.pickCenter' : 'app.sketch.hint.patternSetCircular');
  return { state, draft, preview, fields, ...(panel ? { panel } : {}), hint: h };
}

export const circularPatternTool: Tool<CircularState> = {
  id: 'pattern-circular',
  start: () => ({ phase: 'select', selected: [], n: 6 }),
  step(state, ev, draft, settings, env?: ToolEnv): ToolOutput<CircularState> {
    if (state.phase === 'select' && !state.selected.length && preselected(draft, env).length) state = { ...state, selected: preselected(draft, env), phase: 'center' };
    const apply = (s: CircularState): ToolOutput<CircularState> => {
      const r = applyCircular(draft, s.selected, { n: s.n, stepDeg: stepOf(s), center: s.center! });
      if (!r.ok) return circularView(s, draft, settings, r.hint);
      return circularView({ phase: 'select', selected: [], n: s.n }, r.draft, settings);
    };
    switch (ev.type) {
      case 'move': return circularView(state, draft, settings);
      case 'click': {
        if (state.phase === 'select') {
          const e = PICKABLE(draft, ev.snap?.entityId);
          if (e) return circularView({ ...state, selected: toggle(state.selected, e.id) }, draft, settings);
          // empty space with something selected: that click is the centre
          if (state.selected.length) state = { ...state, phase: 'center' };
          else return circularView(state, draft, settings, 'app.sketch.hint.pickEntity');
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
        if (ev.id === 'tot') {
          // step <-> total: a typed angle keeps its step
          const on = ev.value === 1;
          const v = state.lockedA ?? state.liveA;
          if (v === undefined) return circularView({ ...state, total: on }, draft, settings);
          const step = stepOf(state), nv = on ? totalOfStep(step, state.n) : step;
          return circularView({ ...state, total: on, ...(state.lockedA !== undefined ? { lockedA: nv } : { liveA: nv }) }, draft, settings);
        }
        if (ev.id !== 'a') return circularView(state, draft, settings);
        if (ev.value === null || !Number.isFinite(ev.value)) return circularView({ ...state, lockedA: undefined, liveA: undefined }, draft, settings);
        if (ev.value === 0) return circularView(state, draft, settings, 'app.sketch.hint.degenerate');
        return circularView(ev.commit ? { ...state, lockedA: ev.value, liveA: undefined } : { ...state, liveA: ev.value }, draft, settings);
      }
      case 'key': {
        if (ev.key === 'Enter') {
          if (state.phase === 'select') {
            return state.selected.length ? circularView({ ...state, phase: 'center' }, draft, settings) : circularView(state, draft, settings, 'app.sketch.hint.nothingToPattern');
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
