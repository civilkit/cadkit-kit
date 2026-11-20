/**
 * What is still free in an under-defined sketch, in words and as things to do about it.
 *
 *   freeParts        probes the solver: which points can still move (and along which axis) and which circle radii are open
 *   describeFree     one finding per free point or radius, named by the entity that owns it ("Circle 3 centre ... x and y")
 *   suggestionsFor   for each finding, the constraints that would pin it (radius dimension, horizontal, distance from the origin ...)
 *   tooltipItems     the constraints and dimensions attached to a hovered point or entity, and which of them drive
 *
 * `freeParts` needs the solver (the `solve` callback of define.ts); the rest is pure.
 */
import type { SketchSolverStatus } from '@ck/part-model';
import { addCandidate, entityPoints, relationTolerance, roundDimension, suggestRelations, type Candidate, type Solve } from './define';
import type { SketchDraft } from './index';
import { nextId } from './tools/builders';
import { refDimsOf } from './refdims';

export type Axes = 'x' | 'y' | 'xy';
/** A part of the sketch the solver cannot pin yet: a point (`axes` = the directions it can move) or a circle's radius (`id` is the circle). */
export interface FreePart { kind: 'point' | 'radius'; id: string; axes?: Axes }

/** Asks the solver which points can still move, along which axis, and which circle radii are open. Each is one probe with a pin that
 *  must change the degrees of freedom to count: a pin on what is already determined adds nothing. `maxProbes` bounds the work. */
export async function freeParts(draft: SketchDraft, status: SketchSolverStatus | null, solve: Solve, opts: { maxProbes?: number } = {}): Promise<FreePart[]> {
  if (!status || (status.dof === 0 && status.solved)) return [];
  let left = opts.maxProbes ?? 80;
  const base = status.dof;
  const drops = async (d: SketchDraft): Promise<boolean> => {
    if (left-- <= 0) return false;
    const s = await solve(d);
    return !!s && s.solved && s.dof < base;
  };
  const withK = (d: SketchDraft, type: string, refs: string[], value?: number | number[]): SketchDraft => ({ ...d, constraints: [...d.constraints, { id: nextId(d, 'k'), type, refs, ...(value !== undefined ? { value } : {}) }] });
  const out: FreePart[] = [];
  for (const p of draft.points) {
    if (p.fixed) continue;   // a point no entity is made of (a stray click) is a free part too: the solver counts its freedom
    if (!(await drops(withK(draft, 'fix', [p.id], [p.x, p.y])))) continue;
    // a fixed helper point at the same place: horizontal to it pins y, vertical pins x
    const tid = nextId(draft, 'p');
    const helped: SketchDraft = { ...draft, points: [...draft.points, { id: tid, x: p.x, y: p.y, fixed: true }] };
    const y = await drops(withK(helped, 'horizontal', [p.id, tid]));
    const x = await drops(withK(helped, 'vertical', [p.id, tid]));
    out.push({ kind: 'point', id: p.id, axes: x && y ? 'xy' : x ? 'x' : y ? 'y' : 'xy' });
  }
  for (const e of draft.entities) {
    if (e.type === 'circle' && (await drops(withK(draft, 'radius', [e.id], Number(e.r))))) out.push({ kind: 'radius', id: e.id });
  }
  return out;
}

export type FreeRole = 'centre' | 'start' | 'end' | 'point' | 'radius';
export interface FreeItem {
  /** Stable key: `point:p3` or `radius:e2`. */
  key: string;
  partId: string;
  /** The owning entity; empty for an orphan point (one no entity is made of). */
  entityId: string;
  entityType: string;
  /** 1-based position among the entities of the same type, for "Circle 3". */
  ordinal: number;
  role: FreeRole;
  axes?: Axes;
}

/** One finding per free part, owned by the first entity that is made of the point (centres and the like before ends of lines). */
export function describeFree(draft: SketchDraft, parts: FreePart[]): FreeItem[] {
  const ordinal = new Map<string, number>();
  const count: Record<string, number> = {};
  for (const e of draft.entities) { const ty = String(e.type); count[ty] = (count[ty] ?? 0) + 1; ordinal.set(e.id, count[ty]); }
  const out: FreeItem[] = [];
  for (const part of parts) {
    if (part.kind === 'radius') {
      const e = draft.entities.find((x) => x.id === part.id);
      if (e) out.push({ key: `radius:${e.id}`, partId: e.id, entityId: e.id, entityType: String(e.type), ordinal: ordinal.get(e.id)!, role: 'radius' });
      continue;
    }
    const owner = draft.entities.find((e) => entityPoints(e).includes(part.id));
    if (!owner) {
      // an orphan point: no entity owns it. Named "Point n" (n counts the orphans), with no entity to colour
      if (!draft.points.some((q) => q.id === part.id)) continue;
      const n = draft.points.filter((q) => !q.fixed && !draft.entities.some((e) => entityPoints(e).includes(q.id))).findIndex((q) => q.id === part.id) + 1;
      out.push({ key: `point:${part.id}`, partId: part.id, entityId: '', entityType: 'point', ordinal: n || 1, role: 'point', axes: part.axes ?? 'xy' });
      continue;
    }
    const role: FreeRole = owner.c === part.id ? 'centre' : owner.p1 === part.id ? 'start' : owner.p2 === part.id ? 'end' : 'point';
    out.push({ key: `point:${part.id}`, partId: part.id, entityId: owner.id, entityType: String(owner.type), ordinal: ordinal.get(owner.id)!, role, axes: part.axes ?? 'xy' });
  }
  return out;
}

export interface Suggestion extends Candidate {
  /** The finding it answers (`FreeItem.key`). */
  itemKey: string;
  /** What to call it: a dimension to open a value box for, or a relation that is added straight away. */
  label: 'radius' | 'length' | 'hdist' | 'vdist' | 'fix' | 'horizontal' | 'vertical' | 'origin' | 'perpendicular' | 'parallel' | 'tangent' | 'equal' | 'concentric';
}

const has = (d: SketchDraft, type: string, ids: string[]) => d.constraints.some((c) => c.type === type && ids.every((i) => (c.refs ?? []).includes(i)));

/** The constraints that would pin each finding, most natural first (at most three per finding). Dimensions carry the current measure, rounded. */
export function suggestionsFor(draft: SketchDraft, items: FreeItem[]): Suggestion[] {
  const pts = new Map(draft.points.map((p) => [p.id, p]));
  const origin = draft.points.find((p) => p.fixed && p.x === 0 && p.y === 0);
  const rels = suggestRelations(draft);
  const tol = relationTolerance(draft);
  const out: Suggestion[] = [];
  for (const it of items) {
    const mine: Suggestion[] = [];
    const e = draft.entities.find((x) => x.id === it.entityId);
    if (it.role === 'radius' && e) {
      const r = Number(e.r);
      if (r > 1e-9) mine.push({ itemKey: it.key, label: 'radius', kind: 'dimension', type: 'radius', refs: [e.id], value: roundDimension(r) });
    } else {
      const p = pts.get(it.partId);
      if (!p) continue;
      // relations the drawing already satisfies that name this entity (horizontal / vertical line, tangent, equal ...)
      for (const c of rels) {
        if (!(e && c.refs.includes(e.id)) && !c.refs.includes(it.partId)) continue;
        if (c.type === 'horizontal' || c.type === 'vertical' || c.type === 'perpendicular' || c.type === 'parallel' || c.type === 'tangent' || c.type === 'equal' || c.type === 'concentric') {
          mine.push({ itemKey: it.key, label: c.type as Suggestion['label'], ...c });
        }
      }
      if (e && e.type === 'line') {
        const a = pts.get(String(e.p1)), b = pts.get(String(e.p2));
        if (a && b && !has(draft, 'distance', [a.id, b.id]) && !(a.fixed && b.fixed)) {
          const len = Math.hypot(a.x - b.x, a.y - b.y);
          if (len > 1e-9) mine.push({ itemKey: it.key, label: 'length', kind: 'dimension', type: 'distance', refs: [a.id, b.id], value: roundDimension(len) });
        }
      }
      if (origin) {
        if (Math.hypot(p.x, p.y) <= tol) mine.push({ itemKey: it.key, label: 'origin', kind: 'relation', type: 'coincident', refs: [origin.id, p.id] });
        else {
          if (it.axes !== 'y' && !has(draft, 'hdist', [origin.id, p.id])) mine.push({ itemKey: it.key, label: 'hdist', kind: 'dimension', type: 'hdist', refs: [origin.id, p.id], value: roundDimension(Math.abs(p.x)) });
          if (it.axes !== 'x' && !has(draft, 'vdist', [origin.id, p.id])) mine.push({ itemKey: it.key, label: 'vdist', kind: 'dimension', type: 'vdist', refs: [origin.id, p.id], value: roundDimension(Math.abs(p.y)) });
        }
      } else mine.push({ itemKey: it.key, label: 'fix', kind: 'dimension', type: 'fix', refs: [p.id], value: [roundDimension(p.x), roundDimension(p.y)] });
    }
    const seen = new Set<string>();
    for (const s of mine) {
      const k = s.type + s.refs.join(',');
      if (seen.has(k) || seen.size >= 3) continue;
      seen.add(k);
      out.push(s);
    }
  }
  return out;
}

/** The draft with a suggestion applied, and the new constraint's id (a dimension then opens its value box). */
export function applySuggestion(draft: SketchDraft, s: Suggestion): { draft: SketchDraft; id: string; dimension: boolean } {
  const r = addCandidate(draft, s);
  return { ...r, dimension: s.kind === 'dimension' && typeof s.value === 'number' };
}

/** What the viewport paints amber for the free items: their curves, and their points (a radius is a size, not a point). Null when nothing is free, so the highlight clears. */
export function freedomHighlight(items: FreeItem[]): { entities: string[]; points: string[] } | null {
  if (!items.length) return null;
  return { entities: [...new Set(items.map((i) => i.entityId).filter(Boolean))], points: items.filter((i) => i.role !== 'radius').map((i) => i.partId) };
}

/** The analysis with an applied suggestion's chip taken out, so it cannot be run twice while the new analysis is on its way. */
export function withoutSuggestion<T extends { items: FreeItem[]; suggestions: Suggestion[] }>(state: T, applied: Suggestion): T {
  return { ...state, suggestions: state.suggestions.filter((s) => !(s.itemKey === applied.itemKey && s.type === applied.type && s.refs.join(',') === applied.refs.join(','))) };
}

export interface TooltipItem { id: string; type: string; value?: number; /** Dimensions and relations drive; a reference dimension only measures. */ driving: boolean; blame?: 'conflict' | 'redundant' }

/** The constraints and dimensions attached to a point or entity, one row each: those naming it, or (for an entity) any of its points; for a point also
 *  those of the curves it ends (a horizontal line, a tangent, an equal radius ...), after its own. Reference dimensions come last, as not driving. */
export function tooltipItems(draft: SketchDraft, status: SketchSolverStatus | null, target: string): TooltipItem[] {
  const e = draft.entities.find((x) => x.id === target);
  const ids = new Set<string>([target, ...(e ? entityPoints(e) : [])]);
  const via = new Set<string>(e ? [] : draft.entities.filter((x) => entityPoints(x).includes(target)).map((x) => x.id));
  const blame = (id: string) => (status?.conflicts.includes(id) ? { blame: 'conflict' as const } : status?.redundant.includes(id) ? { blame: 'redundant' as const } : {});
  const row = (c: SketchDraft['constraints'][number]): TooltipItem => ({ id: c.id, type: c.type, driving: true, ...(typeof c.value === 'number' ? { value: c.value } : {}), ...blame(c.id) });
  const own = draft.constraints.filter((c) => (c.refs ?? []).some((r) => ids.has(r)));
  const ownIds = new Set(own.map((c) => c.id));
  const ends = draft.constraints.filter((c) => !ownIds.has(c.id) && (c.refs ?? []).some((r) => via.has(r)));
  const out: TooltipItem[] = [...own, ...ends].map(row);
  for (const r of refDimsOf(draft)) if (r.refs.some((x) => ids.has(x) || via.has(x))) out.push({ id: r.id, type: r.type, driving: false });
  return out;
}

/** Which constraint glyph chips show, from the Show constraints setting (`null` = not chosen yet) and the user's chip mode:
 *  chosen on: all; chosen off: only for what is hovered; not chosen: all while the sketch is small (under 12 entities), else the user's mode. */
export const SMALL_SKETCH = 12;
export function effectiveMarkMode(show: boolean | null, base: 'always' | 'hover' | 'off', entityCount: number): 'always' | 'hover' | 'off' {
  if (show === true) return 'always';
  if (show === false) return base === 'always' ? 'hover' : base;
  return base === 'hover' && entityCount < SMALL_SKETCH ? 'always' : base;
}
