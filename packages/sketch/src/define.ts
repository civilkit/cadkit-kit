/**
 * Fully Define and the "how defined is it" colouring of a sketch.
 *
 * Both need the solver, which lives in the kernel, so the functions here take a `solve` callback: it gets a draft and
 * returns the kernel's verdict (`dof`, `state`, `conflicts`, `redundant`, `solved`) or null when no answer came. The
 * app passes a callback that runs the draft through the sketch's partial regen; the tests pass the real kernel or a
 * stub.
 *
 *   fullyDefine     adds constraints until the degrees of freedom reach zero, first the relations the drawing already
 *                   shows (coincident, point on a curve, tangent, concentric, horizontal, vertical, parallel, perpendicular,
 *                   equal), then dimensions taken from the
 *                   present geometry (radii, lengths, angles, positions from the origin), their values rounded by `roundDimension`. A candidate the solver calls
 *                   redundant or conflicting is thrown away, so the result is never over-constrained.
 *   definitionMap   per entity: `full` (nothing about it can move), `under` (it can still move or change) or `over`
 *                   (a constraint that mentions it is in conflict). Found by pinning each free point in turn and asking
 *                   whether the pin adds anything: when the degrees of freedom do not drop the point was already determined.
 */
import type { SketchSolverStatus } from '@ck/part-model';
import type { DraftConstraint, DraftEntity, SketchDraft } from './types';
import { nextId } from './tools/builders';
import { angleSpec } from './tools/constraints';
import type { Pt } from './tools/types';

export type Solve = (draft: SketchDraft) => Promise<SketchSolverStatus | null>;
export type DefState = 'under' | 'full' | 'over';

export interface DefineResult {
  draft: SketchDraft;
  status: SketchSolverStatus | null;
  /** Geometric relations added. */
  relations: number;
  /** Dimensions (and pins) added. */
  dimensions: number;
  /** Candidates the solver refused (redundant or conflicting). */
  refused: number;
  /** True when the degrees of freedom are zero at the end. */
  fully: boolean;
}

const DIM = new Set(['distance', 'hdist', 'vdist', 'pldist', 'radius', 'diameter', 'raddiff', 'arclength', 'angle']);
const round = (v: number) => Math.round(v * 1e4) / 1e4;

/**
 * The value a dimension is given from a measured one: the nearest half (0.5 mm, or 0.5 degree) when that is within 1% of the
 * measurement, else two decimals (four when two would round a small positive value to nothing). A measurement of 19.97 becomes 20,
 * 19.26 stays 19.26, and a dimension never carries spurious precision such as 19.2631.
 */
export function roundDimension(v: number): number {
  if (!Number.isFinite(v)) return v;
  const a = Math.abs(v), sign = v < 0 ? -1 : 1;
  const half = Math.round(a * 2) / 2;
  if (half > 0 && Math.abs(half - a) <= 0.01 * a) return sign * half;
  const two = Math.round(a * 100) / 100;
  return sign * (two === 0 && a > 0 ? round(a) : two);
}
const pm = (d: SketchDraft) => new Map(d.points.map((p) => [p.id, p]));
const str = (v: unknown) => (typeof v === 'string' ? v : '');

const has = (d: SketchDraft, pred: (c: DraftConstraint) => boolean) => d.constraints.some(pred);
const refsSet = (c: DraftConstraint) => new Set(c.refs ?? []);

/** Points an entity is made of (centre and ends, spline points). */
export function entityPoints(e: DraftEntity): string[] {
  const out: string[] = [];
  for (const k of ['p1', 'p2', 'c', 'p']) if (typeof e[k] === 'string') out.push(e[k] as string);
  if (Array.isArray(e.pts)) for (const p of e.pts) if (typeof p === 'string') out.push(p);
  return out;
}

export interface Candidate { type: string; refs: string[]; value?: number | number[]; extra?: Record<string, unknown>; kind: 'relation' | 'dimension' }

/** Relations the drawing already satisfies (within a small tolerance) that no constraint states yet. */
export function suggestRelations(d: SketchDraft): Candidate[] {
  return [...suggestCoincidences(d), ...suggestCurveRelations(d), ...suggestLineRelations(d), ...suggestAlignments(d)];
}

/** How close counts as "already so": 0.2% of the sketch's extent, between 0.01 and 0.5 mm. */
export function relationTolerance(d: SketchDraft): number {
  if (!d.points.length) return 0.01;
  const xs = d.points.map((p) => p.x), ys = d.points.map((p) => p.y);
  const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
  return Math.min(0.5, Math.max(0.01, 0.002 * extent));
}

/** Points that end or place something (not only a centre): the ones that can sit on a curve or line up with another. */
function placedPoints(d: SketchDraft): Set<string> {
  const out = new Set<string>();
  for (const e of d.entities) for (const k of ['p1', 'p2', 'p']) if (typeof e[k] === 'string') out.add(e[k] as string);
  for (const e of d.entities) if (Array.isArray(e.pts)) for (const p of e.pts) if (typeof p === 'string') out.add(p);
  return out;
}

/** Two points that lie within tolerance of each other (and no constraint joins them yet). */
function suggestCoincidences(d: SketchDraft): Candidate[] {
  const tol = relationTolerance(d);
  const out: Candidate[] = [];
  const lineEnds = new Set(d.entities.filter((e) => e.type === 'line').map((e) => [str(e.p1), str(e.p2)].sort().join('|')));
  const joined = (a: string, b: string) => has(d, (c) => (c.type === 'coincident' || c.type === 'concentric') && refsSet(c).has(a) && refsSet(c).has(b));
  for (let i = 0; i < d.points.length; i++) {
    for (let j = i + 1; j < d.points.length; j++) {
      const a = d.points[i], b = d.points[j];
      if (a.fixed && b.fixed) continue;
      if (Math.hypot(a.x - b.x, a.y - b.y) > tol) continue;
      if (lineEnds.has([a.id, b.id].sort().join('|')) || joined(a.id, b.id)) continue;
      out.push({ kind: 'relation', type: 'coincident', refs: [a.id, b.id] });
    }
  }
  return out;
}

/** A circle or arc as centre point id, centre and radius (null when the draft does not say). */
function curveOf(d: SketchDraft, pts: Map<string, Pt & { id: string }>, e: DraftEntity): { cid: string; c: Pt; r: number } | null {
  const cid = str(e.c), c = pts.get(cid);
  if (!c) return null;
  if (e.type === 'circle') return Number(e.r) > 1e-9 ? { cid, c, r: Number(e.r) } : null;
  const p = pts.get(str(e.p1));
  const r = p ? Math.hypot(p.x - c.x, p.y - c.y) : NaN;
  return r > 1e-9 ? { cid, c, r } : null;
}

/** Points on a curve, curves that touch, curves that share a centre. */
function suggestCurveRelations(d: SketchDraft): Candidate[] {
  const pts = pm(d), tol = relationTolerance(d), out: Candidate[] = [];
  const placed = placedPoints(d);
  const curves = d.entities.filter((e) => e.type === 'circle' || e.type === 'arc').flatMap((e) => { const g = curveOf(d, pts, e); return g ? [{ e, ...g }] : []; });
  const lines = d.entities.filter((e) => e.type === 'line');
  const stated = (type: string, ids: string[]) => has(d, (c) => c.type === type && ids.every((i) => refsSet(c).has(i)));
  const joined = (a: string, b: string) => a === b || has(d, (c) => (c.type === 'coincident' || c.type === 'concentric') && refsSet(c).has(a) && refsSet(c).has(b));
  // a point on a circle or arc / on a line, that is not one of the entity's own points
  for (const pid of placed) {
    const p = pts.get(pid);
    if (!p) continue;
    for (const k of curves) {
      if (entityPoints(k.e).includes(pid) || stated('pointOnCircle', [pid, k.e.id])) continue;
      if (Math.abs(Math.hypot(p.x - k.c.x, p.y - k.c.y) - k.r) > tol) continue;
      // a point that already sits on one of this curve's own end points is the same thing as coincident
      if (entityPoints(k.e).some((q) => joined(pid, q) || (pts.get(q) && Math.hypot(pts.get(q)!.x - p.x, pts.get(q)!.y - p.y) <= tol))) continue;
      out.push({ kind: 'relation', type: 'pointOnCircle', refs: [pid, k.e.id] });
    }
    for (const l of lines) {
      if (entityPoints(l).includes(pid) || stated('pointOnLine', [pid, l.id])) continue;
      const a = pts.get(str(l.p1)), b = pts.get(str(l.p2));
      if (!a || !b) continue;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1e-9) continue;
      const t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len);
      const off = Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / len;
      if (off > tol || t < -tol / len || t > 1 + tol / len) continue;
      if (Math.hypot(p.x - a.x, p.y - a.y) <= tol || Math.hypot(p.x - b.x, p.y - b.y) <= tol) continue;   // at an end: coincident covers it
      out.push({ kind: 'relation', type: 'pointOnLine', refs: [pid, l.id] });
    }
  }
  const sharedEnd = (a: DraftEntity, b: DraftEntity) => entityPoints(a).filter((q) => q !== str(a.c) && q !== str(b.c)).find((q) => entityPoints(b).includes(q));
  const crossOf = (u: Pt, v: Pt) => Math.abs(u.x * v.y - u.y * v.x) / (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y));
  const sinTol = Math.sin((1 * Math.PI) / 180);
  for (let i = 0; i < curves.length; i++) {
    for (let j = i + 1; j < curves.length; j++) {
      const a = curves[i], b = curves[j];
      const dd = Math.hypot(a.c.x - b.c.x, a.c.y - b.c.y);
      if (dd <= tol) {
        if (a.cid !== b.cid && !joined(a.cid, b.cid)) out.push({ kind: 'relation', type: 'concentric', refs: [a.e.id, b.e.id] });
        continue;
      }
      if (stated('tangent', [a.e.id, b.e.id])) continue;
      const at = sharedEnd(a.e, b.e);
      if (at) {
        // joined at an end: tangent there when the two radii through that end point line up
        const q = pts.get(at)!;
        if (crossOf({ x: q.x - a.c.x, y: q.y - a.c.y }, { x: q.x - b.c.x, y: q.y - b.c.y }) < sinTol) out.push({ kind: 'relation', type: 'tangent', refs: [a.e.id, b.e.id], extra: { at } });
        continue;
      }
      if (Math.abs(dd - (a.r + b.r)) <= tol) out.push({ kind: 'relation', type: 'tangent', refs: [a.e.id, b.e.id] });
      else if (Math.abs(a.r - b.r) > tol && Math.abs(dd - Math.abs(a.r - b.r)) <= tol) out.push({ kind: 'relation', type: 'tangent', refs: [a.e.id, b.e.id], extra: { internal: true } });
    }
  }
  for (const l of lines) {
    const a = pts.get(str(l.p1)), b = pts.get(str(l.p2));
    if (!a || !b) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-9) continue;
    for (const k of curves) {
      if (stated('tangent', [l.id, k.e.id])) continue;
      const at = entityPoints(l).find((q) => entityPoints(k.e).includes(q) && q !== k.cid);
      if (at) {
        const q = pts.get(at)!;
        const rad = { x: q.x - k.c.x, y: q.y - k.c.y };
        // tangent at the shared end: the line is perpendicular to the radius there
        if (Math.abs((b.x - a.x) * rad.x + (b.y - a.y) * rad.y) / (len * Math.hypot(rad.x, rad.y)) < sinTol) out.push({ kind: 'relation', type: 'tangent', refs: [l.id, k.e.id], extra: { at } });
        continue;
      }
      const off = Math.abs((k.c.x - a.x) * (b.y - a.y) - (k.c.y - a.y) * (b.x - a.x)) / len;
      const t = ((k.c.x - a.x) * (b.x - a.x) + (k.c.y - a.y) * (b.y - a.y)) / (len * len);
      if (Math.abs(off - k.r) <= tol && t > -0.5 && t < 1.5) out.push({ kind: 'relation', type: 'tangent', refs: [l.id, k.e.id] });
    }
  }
  return out;
}

/** Two placed points that share an x or a y (within tolerance), apart from the two ends of one line (the line's own horizontal / vertical covers those). */
function suggestAlignments(d: SketchDraft): Candidate[] {
  const tol = relationTolerance(d), out: Candidate[] = [];
  const placed = placedPoints(d);
  const pts = d.points.filter((p) => placed.has(p.id));
  const lineEnds = new Set(d.entities.filter((e) => e.type === 'line').map((e) => [str(e.p1), str(e.p2)].sort().join('|')));
  const stated = (a: string, b: string) => has(d, (c) => (c.type === 'horizontal' || c.type === 'vertical' || c.type === 'coincident') && refsSet(c).has(a) && refsSet(c).has(b));
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i], b = pts[j];
      if ((a.fixed && b.fixed) || lineEnds.has([a.id, b.id].sort().join('|')) || stated(a.id, b.id)) continue;
      const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
      if (Math.hypot(dx, dy) <= tol) continue;      // the same place: coincident covers it
      if (dy <= tol) out.push({ kind: 'relation', type: 'horizontal', refs: [a.id, b.id] });
      else if (dx <= tol) out.push({ kind: 'relation', type: 'vertical', refs: [a.id, b.id] });
    }
  }
  return out;
}

/** Lines that are horizontal, vertical, parallel, perpendicular or of equal length, and equal radii. */
function suggestLineRelations(d: SketchDraft): Candidate[] {
  const pts = pm(d);
  const out: Candidate[] = [];
  const tolLen = relationTolerance(d);
  const lines = d.entities.filter((e) => e.type === 'line');
  const dir = (e: DraftEntity) => {
    const a = pts.get(str(e.p1)), b = pts.get(str(e.p2));
    return a && b ? { x: b.x - a.x, y: b.y - a.y, len: Math.hypot(b.x - a.x, b.y - a.y) } : null;
  };
  const stated = (type: string, ids: string[]) => has(d, (c) => c.type === type && ids.every((i) => refsSet(c).has(i)));
  const tol = Math.sin((1 * Math.PI) / 180);   // within a degree
  for (const e of lines) {
    const v = dir(e);
    if (!v || v.len < 1e-9) continue;
    const ends = [str(e.p1), str(e.p2)];
    if (!stated('horizontal', [e.id]) && !stated('horizontal', ends) && !stated('vertical', [e.id]) && !stated('vertical', ends)) {
      if (Math.abs(v.y) / v.len < tol) out.push({ kind: 'relation', type: 'horizontal', refs: [e.id] });
      else if (Math.abs(v.x) / v.len < tol) out.push({ kind: 'relation', type: 'vertical', refs: [e.id] });
    }
  }
  const taken = new Set(out.filter((c) => c.type === 'horizontal' || c.type === 'vertical').map((c) => c.refs[0]));
  const isAxis = (e: DraftEntity) => taken.has(e.id) || has(d, (c) => (c.type === 'horizontal' || c.type === 'vertical') && (refsSet(c).has(e.id) || (refsSet(c).has(str(e.p1)) && refsSet(c).has(str(e.p2)))));
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = dir(lines[i]), b = dir(lines[j]);
      if (!a || !b || a.len < 1e-9 || b.len < 1e-9) continue;
      const cross = Math.abs(a.x * b.y - a.y * b.x) / (a.len * b.len);
      const dot = Math.abs(a.x * b.x + a.y * b.y) / (a.len * b.len);
      const both = isAxis(lines[i]) && isAxis(lines[j]);
      // two axis-aligned lines are already related through the axes: parallel / perpendicular would be redundant
      if (!both && cross < tol && !stated('parallel', [lines[i].id, lines[j].id])) out.push({ kind: 'relation', type: 'parallel', refs: [lines[i].id, lines[j].id] });
      else if (!both && dot < tol && !stated('perpendicular', [lines[i].id, lines[j].id])) out.push({ kind: 'relation', type: 'perpendicular', refs: [lines[i].id, lines[j].id] });
      if (Math.abs(a.len - b.len) <= tolLen && !stated('equal', [lines[i].id, lines[j].id])) out.push({ kind: 'relation', type: 'equal', refs: [lines[i].id, lines[j].id] });
    }
  }
  const round_ = d.entities.filter((e) => e.type === 'circle' || e.type === 'arc');
  const radius = (e: DraftEntity) => {
    if (e.type === 'circle') return Number(e.r);
    const c = pts.get(str(e.c)), p = pts.get(str(e.p1));
    return c && p ? Math.hypot(p.x - c.x, p.y - c.y) : NaN;
  };
  for (let i = 0; i < round_.length; i++) {
    for (let j = i + 1; j < round_.length; j++) {
      if (Math.abs(radius(round_[i]) - radius(round_[j])) <= tolLen && !stated('equal', [round_[i].id, round_[j].id])) out.push({ kind: 'relation', type: 'equal', refs: [round_[i].id, round_[j].id] });
    }
  }
  return out;
}

/** The dimensions that could pin the sketch down, in the order they are tried: sizes first, then angles, then positions. */
export function suggestDimensions(d: SketchDraft): Candidate[] {
  const pts = pm(d);
  const out: Candidate[] = [];
  const dimmed = (type: string, ids: string[]) => has(d, (c) => c.type === type && ids.every((i) => refsSet(c).has(i)));
  const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
  for (const e of d.entities) {
    if (e.type === 'circle' || e.type === 'arc') {
      if (dimmed('radius', [e.id]) || dimmed('diameter', [e.id])) continue;
      const r = e.type === 'circle' ? Number(e.r) : (() => { const c = pts.get(str(e.c)), p = pts.get(str(e.p1)); return c && p ? dist(c, p) : NaN; })();
      if (r > 1e-9) out.push({ kind: 'dimension', type: 'radius', refs: [e.id], value: roundDimension(r) });
    }
  }
  for (const e of d.entities) {
    if (e.type !== 'line') continue;
    const a = pts.get(str(e.p1)), b = pts.get(str(e.p2));
    if (!a || !b || dimmed('distance', [str(e.p1), str(e.p2)])) continue;
    if (a.fixed && b.fixed) continue;
    const l = dist(a, b);
    if (l > 1e-9) out.push({ kind: 'dimension', type: 'distance', refs: [str(e.p1), str(e.p2)], value: roundDimension(l) });
  }
  const lines = d.entities.filter((e) => e.type === 'line');
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const shared = [str(lines[i].p1), str(lines[i].p2)].find((p) => p === str(lines[j].p1) || p === str(lines[j].p2));
      if (!shared || dimmed('angle', [lines[i].id, lines[j].id])) continue;
      const spec = angleSpec(d, lines[i].id, lines[j].id);
      if (spec && spec.measured > 0.01 && spec.measured < 179.99) out.push({ kind: 'dimension', type: 'angle', refs: spec.refs, value: roundDimension(spec.measured), extra: spec.extra });
    }
  }
  const origin = d.points.find((p) => p.fixed && p.x === 0 && p.y === 0);
  for (const p of d.points) {
    if (p.fixed) continue;
    if (origin) {
      if (Math.abs(p.x) < 1e-9 && Math.abs(p.y) < 1e-9) out.push({ kind: 'dimension', type: 'coincident', refs: [origin.id, p.id] });
      else {
        if (!dimmed('hdist', [origin.id, p.id])) out.push({ kind: 'dimension', type: 'hdist', refs: [origin.id, p.id], value: roundDimension(Math.abs(p.x)) });
        if (!dimmed('vdist', [origin.id, p.id])) out.push({ kind: 'dimension', type: 'vdist', refs: [origin.id, p.id], value: roundDimension(Math.abs(p.y)) });
      }
    } else if (!has(d, (c) => c.type === 'fix' && c.refs?.[0] === p.id)) out.push({ kind: 'dimension', type: 'fix', refs: [p.id], value: [roundDimension(p.x), roundDimension(p.y)] });
  }
  return out;
}

/** A candidate as a constraint added to the draft (the id is the next free `k`). */
export function addCandidate(d: SketchDraft, c: Candidate): { draft: SketchDraft; id: string } {
  const id = nextId(d, 'k');
  const k: DraftConstraint = { id, type: c.type, refs: [...c.refs], ...(c.value !== undefined ? { value: c.value } : {}), ...(c.extra ?? {}) };
  return { draft: { ...d, constraints: [...d.constraints, k] }, id };
}

const unsolvedOrBad = (s: SketchSolverStatus | null, id: string) => !s || !s.solved || s.conflicts.includes(id) || s.redundant.includes(id);

/**
 * Add constraints until the sketch has no degrees of freedom. `maxSolves` bounds the number of kernel round trips.
 * The draft returned has the accepted constraints; `status` is the solver's last answer for it.
 */
export async function fullyDefine(draft: SketchDraft, solve: Solve, opts: { maxSolves?: number } = {}): Promise<DefineResult> {
  let budget = opts.maxSolves ?? 150;
  const ask = async (d: SketchDraft) => { budget--; return solve(d); };
  let cur = draft;
  let status = await ask(cur);
  const result = (fully: boolean, relations: number, dimensions: number, refused: number): DefineResult => ({ draft: cur, status, relations, dimensions, refused, fully });
  if (!status) return result(false, 0, 0, 0);
  if (status.dof === 0 && !status.conflicts.length) return result(true, 0, 0, 0);
  if (status.conflicts.length) return result(false, 0, 0, 0);   // fix the conflict first: adding more makes it worse

  let relations = 0, dimensions = 0, refused = 0;
  const add = (d: SketchDraft, c: Candidate): { draft: SketchDraft; id: string } => {
    const id = nextId(d, 'k');
    const k: DraftConstraint = { id, type: c.type, refs: [...c.refs], ...(c.value !== undefined ? { value: c.value } : {}), ...(c.extra ?? {}) };
    return { draft: { ...d, constraints: [...d.constraints, k] }, id };
  };

  // 1. relations: all at once, then drop whatever the solver blames
  const rel = suggestRelations(cur);
  if (rel.length) {
    let trial = cur;
    const ids: string[] = [];
    for (const c of rel) { const r = add(trial, c); trial = r.draft; ids.push(r.id); }
    let s = await ask(trial);
    let guard = 0;
    while (s && (s.conflicts.length || s.redundant.length || !s.solved) && guard++ < 6) {
      const bad = new Set([...s.conflicts, ...s.redundant]);
      const mine = ids.filter((i) => bad.has(i));
      if (!mine.length) break;
      trial = { ...trial, constraints: trial.constraints.filter((k) => !mine.includes(k.id)) };
      refused += mine.length;
      for (const m of mine) ids.splice(ids.indexOf(m), 1);
      s = await ask(trial);
    }
    if (s && s.solved && !s.conflicts.length && !s.redundant.length) { cur = trial; status = s; relations = ids.length; refused += 0; }
    else {
      // the batch did not hold together: try them one at a time, in order, keeping each that removes a degree of freedom
      refused += ids.length;
      for (const c of rel) {
        if (!status || status.dof === 0 || budget <= 30) break;
        const r = add(cur, c);
        const one = await ask(r.draft);
        if (unsolvedOrBad(one, r.id) || (one && one.dof >= status.dof)) continue;
        cur = r.draft; status = one; relations++; refused--;
      }
    }
  }

  // 2. dimensions, one at a time: kept only if the solver sees them as new information
  if (status && status.dof > 0) {
    for (const c of suggestDimensions(cur)) {
      if (!status || status.dof === 0 || budget <= 0) break;
      const r = add(cur, c);
      const s = await ask(r.draft);
      if (unsolvedOrBad(s, r.id) || (s && s.dof >= status.dof)) { refused++; continue; }
      cur = r.draft; status = s; dimensions++;
    }
  }
  return result(!!status && status.dof === 0 && status.solved && !status.conflicts.length, relations, dimensions, refused);
}

/** The points of a constraint's refs, whether it names points or entities. */
function refPoints(d: SketchDraft, c: DraftConstraint): string[] {
  const out: string[] = [];
  for (const r of c.refs ?? []) {
    if (d.points.some((p) => p.id === r)) out.push(r);
    const e = d.entities.find((x) => x.id === r);
    if (e) out.push(...entityPoints(e));
  }
  return out;
}

/** The points and entities named by constraints the solver blames (conflicts, and redundant ones once the sketch is over-constrained), for drawing them in the conflict colour.
 *  An entity counts when a conflicting constraint names it or one of its points. */
export function conflictingGeometry(draft: SketchDraft, status: SketchSolverStatus | null): { entities: string[]; points: string[] } {
  if (!status) return { entities: [], points: [] };
  const conflicting = new Set([...status.conflicts, ...status.redundant.filter(() => status.state === 'over')]);
  const points = new Set<string>();
  const named = new Set<string>();
  for (const c of draft.constraints) {
    if (!conflicting.has(c.id)) continue;
    for (const p of refPoints(draft, c)) points.add(p);
    for (const r of c.refs ?? []) if (draft.entities.some((e) => e.id === r)) named.add(r);
  }
  const entities = draft.entities.filter((e) => named.has(e.id) || entityPoints(e).some((p) => points.has(p))).map((e) => e.id);
  return { entities, points: [...points] };
}

/**
 * How defined each entity is. `status` is the solver's answer for the draft as it stands. At zero degrees of freedom
 * everything is `full`; otherwise each free point (and circle radius) is probed with a pin and the entity is `full`
 * when everything it is made of was already determined. Entities named by a conflicting constraint are `over`.
 * `maxProbes` bounds the work on large sketches: past it the undecided entities are reported `under`.
 */
export async function definitionMap(draft: SketchDraft, status: SketchSolverStatus | null, solve: Solve, opts: { maxProbes?: number; cancelled?: () => boolean } = {}): Promise<Map<string, DefState>> {
  const out = new Map<string, DefState>();
  if (!status) return out;
  const over = new Set(conflictingGeometry(draft, status).entities);

  const known = new Map<string, boolean>();   // point or circle id -> determined
  if (status.dof === 0 && status.solved) {
    for (const p of draft.points) known.set(p.id, true);
    for (const e of draft.entities) known.set(e.id, true);
  } else {
    let left = opts.maxProbes ?? 60;
    const probe = async (type: string, ref: string, value: number | number[]) => {
      if (left-- <= 0 || opts.cancelled?.()) return false;
      const id = nextId(draft, 'k');
      const s = await solve({ ...draft, constraints: [...draft.constraints, { id, type, refs: [ref], value }] });
      // A pin on a point that is only half determined (a distance fixed, its direction free) is partly redundant, so the
      // solver flags it; what tells the cases apart is the rank it adds: none for a determined point, so the degrees of
      // freedom do not drop.
      return !!s && s.solved && s.dof >= status.dof;
    };
    for (const p of draft.points) {
      if (p.fixed) { known.set(p.id, true); continue; }
      known.set(p.id, await probe('fix', p.id, [p.x, p.y]));
    }
    for (const e of draft.entities) if (e.type === 'circle') known.set(e.id, await probe('radius', e.id, Number(e.r)));
  }
  for (const e of draft.entities) {
    if (over.has(e.id)) { out.set(e.id, 'over'); continue; }
    const parts = [...entityPoints(e), ...(e.type === 'circle' ? [e.id] : [])];
    out.set(e.id, parts.every((p) => known.get(p)) ? 'full' : 'under');
  }
  return out;
}
