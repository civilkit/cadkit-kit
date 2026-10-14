/**
 * Fully Define and the "how defined is it" colouring of a sketch.
 *
 * Both need the solver, which lives in the kernel, so the functions here take a `solve` callback: it gets a draft and
 * returns the kernel's verdict (`dof`, `state`, `conflicts`, `redundant`, `solved`) or null when no answer came. The
 * app passes a callback that runs the draft through the sketch's partial regen; the tests pass the real kernel or a
 * stub.
 *
 *   fullyDefine     adds constraints until the degrees of freedom reach zero, first the relations the drawing already
 *                   shows (horizontal, vertical, parallel, perpendicular, equal), then dimensions taken from the
 *                   present geometry (radii, lengths, angles, positions from the origin). A candidate the solver calls
 *                   redundant or conflicting is thrown away, so the result is never over-constrained.
 *   definitionMap   per entity: `full` (nothing about it can move), `under` (it can still move or change) or `over`
 *                   (a constraint that mentions it is in conflict). Found by pinning each free point in turn and asking
 *                   whether the pin is redundant (the point was already determined).
 */
import type { SketchSolverStatus } from '@ck/part-model';
import type { DraftConstraint, DraftEntity, SketchDraft } from './index';
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

const DIM = new Set(['distance', 'hdist', 'vdist', 'pldist', 'radius', 'diameter', 'angle']);
const round = (v: number) => Math.round(v * 1e4) / 1e4;
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

interface Candidate { type: string; refs: string[]; value?: number | number[]; extra?: Record<string, unknown>; kind: 'relation' | 'dimension' }

/** Relations the drawing already satisfies (within a small tolerance) that no constraint states yet. */
export function suggestRelations(d: SketchDraft): Candidate[] {
  const pts = pm(d);
  const out: Candidate[] = [];
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
      if (Math.abs(a.len - b.len) < 1e-6 * Math.max(a.len, 1) && !stated('equal', [lines[i].id, lines[j].id])) out.push({ kind: 'relation', type: 'equal', refs: [lines[i].id, lines[j].id] });
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
      if (Math.abs(radius(round_[i]) - radius(round_[j])) < 1e-6 && !stated('equal', [round_[i].id, round_[j].id])) out.push({ kind: 'relation', type: 'equal', refs: [round_[i].id, round_[j].id] });
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
      if (r > 1e-9) out.push({ kind: 'dimension', type: 'radius', refs: [e.id], value: round(r) });
    }
  }
  for (const e of d.entities) {
    if (e.type !== 'line') continue;
    const a = pts.get(str(e.p1)), b = pts.get(str(e.p2));
    if (!a || !b || dimmed('distance', [str(e.p1), str(e.p2)])) continue;
    if (a.fixed && b.fixed) continue;
    const l = dist(a, b);
    if (l > 1e-9) out.push({ kind: 'dimension', type: 'distance', refs: [str(e.p1), str(e.p2)], value: round(l) });
  }
  const lines = d.entities.filter((e) => e.type === 'line');
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const shared = [str(lines[i].p1), str(lines[i].p2)].find((p) => p === str(lines[j].p1) || p === str(lines[j].p2));
      if (!shared || dimmed('angle', [lines[i].id, lines[j].id])) continue;
      const spec = angleSpec(d, lines[i].id, lines[j].id);
      if (spec && spec.measured > 0.01 && spec.measured < 179.99) out.push({ kind: 'dimension', type: 'angle', refs: spec.refs, value: round(spec.measured), extra: spec.extra });
    }
  }
  const origin = d.points.find((p) => p.fixed && p.x === 0 && p.y === 0);
  for (const p of d.points) {
    if (p.fixed) continue;
    if (origin) {
      if (Math.abs(p.x) < 1e-9 && Math.abs(p.y) < 1e-9) out.push({ kind: 'dimension', type: 'coincident', refs: [origin.id, p.id] });
      else {
        if (!dimmed('hdist', [origin.id, p.id])) out.push({ kind: 'dimension', type: 'hdist', refs: [origin.id, p.id], value: round(Math.abs(p.x)) });
        if (!dimmed('vdist', [origin.id, p.id])) out.push({ kind: 'dimension', type: 'vdist', refs: [origin.id, p.id], value: round(Math.abs(p.y)) });
      }
    } else if (!has(d, (c) => c.type === 'fix' && c.refs?.[0] === p.id)) out.push({ kind: 'dimension', type: 'fix', refs: [p.id], value: [round(p.x), round(p.y)] });
  }
  return out;
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
    else refused += ids.length;
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

/**
 * How defined each entity is. `status` is the solver's answer for the draft as it stands. At zero degrees of freedom
 * everything is `full`; otherwise each free point (and circle radius) is probed with a pin and the entity is `full`
 * when everything it is made of was already determined. Entities named by a conflicting constraint are `over`.
 * `maxProbes` bounds the work on large sketches: past it the undecided entities are reported `under`.
 */
export async function definitionMap(draft: SketchDraft, status: SketchSolverStatus | null, solve: Solve, opts: { maxProbes?: number; cancelled?: () => boolean } = {}): Promise<Map<string, DefState>> {
  const out = new Map<string, DefState>();
  if (!status) return out;
  const conflicting = new Set([...status.conflicts, ...status.redundant.filter(() => status.state === 'over')]);
  const overPts = new Set<string>();
  for (const c of draft.constraints) if (conflicting.has(c.id)) for (const p of refPoints(draft, c)) overPts.add(p);
  const overEnt = new Set<string>();
  for (const c of draft.constraints) if (conflicting.has(c.id)) for (const r of c.refs ?? []) if (draft.entities.some((e) => e.id === r)) overEnt.add(r);

  const known = new Map<string, boolean>();   // point or circle id -> determined
  if (status.dof === 0 && status.solved) {
    for (const p of draft.points) known.set(p.id, true);
  } else {
    let left = opts.maxProbes ?? 60;
    const probe = async (type: string, ref: string, value: number | number[]) => {
      if (left-- <= 0 || opts.cancelled?.()) return false;
      const id = nextId(draft, 'k');
      const s = await solve({ ...draft, constraints: [...draft.constraints, { id, type, refs: [ref], value }] });
      return !!s && s.redundant.includes(id);
    };
    for (const p of draft.points) {
      if (p.fixed) { known.set(p.id, true); continue; }
      known.set(p.id, await probe('fix', p.id, [p.x, p.y]));
    }
    for (const e of draft.entities) if (e.type === 'circle') known.set(e.id, await probe('radius', e.id, Number(e.r)));
  }
  for (const e of draft.entities) {
    if (overEnt.has(e.id) || entityPoints(e).some((p) => overPts.has(p))) { out.set(e.id, 'over'); continue; }
    const parts = [...entityPoints(e), ...(e.type === 'circle' ? [e.id] : [])];
    out.set(e.id, parts.every((p) => known.get(p)) ? 'full' : 'under');
  }
  return out;
}
