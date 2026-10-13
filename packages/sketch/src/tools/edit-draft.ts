/**
 * Draft helpers shared by the edit tools. All functions return new drafts (the input is never mutated).
 *
 * Reference integrity: every id in a constraint's `refs` (and its `at`) must name a point or an entity of the
 * draft. `pruneDangling` drops any constraint that does not, and every edit tool runs it last, so no tool ever
 * leaves a dangling ref.
 */
import type { DraftConstraint, DraftEntity, DraftPoint, SketchDraft } from '../index';
import { nextId } from './builders';
import type { CurveG } from './edit-geom';
import type { Pt } from './types';

export const ptOf = (d: SketchDraft, id: string): Pt | null => { const p = d.points.find((q) => q.id === id); return p ? { x: p.x, y: p.y } : null; };
export const entityOf = (d: SketchDraft, id: string): DraftEntity | undefined => d.entities.find((e) => e.id === id);

/** Point ids an entity depends on (c, p, p1, p2, pts). */
export function entityPoints(e: DraftEntity): string[] {
  const out: string[] = [];
  for (const k of ['c', 'p', 'p1', 'p2']) if (typeof e[k] === 'string') out.push(e[k] as string);
  if (Array.isArray(e.pts)) for (const q of e.pts) if (typeof q === 'string') out.push(q);
  return out;
}

/** Geometry of a line, circle or arc entity; null for anything else (or a missing point). */
export function curveOf(d: SketchDraft, e: DraftEntity): CurveG | null {
  if (e.type === 'line') {
    const a = ptOf(d, String(e.p1)), b = ptOf(d, String(e.p2));
    return a && b ? { kind: 'line', a, b } : null;
  }
  if (e.type === 'circle') {
    const c = ptOf(d, String(e.c)); const r = Number(e.r);
    return c && Number.isFinite(r) && r > 0 ? { kind: 'circle', c, r } : null;
  }
  if (e.type === 'arc') {
    const c = ptOf(d, String(e.c)), p1 = ptOf(d, String(e.p1)), p2 = ptOf(d, String(e.p2));
    if (!c || !p1 || !p2) return null;
    const r = Math.hypot(p1.x - c.x, p1.y - c.y);
    return r > 0 ? { kind: 'arc', c, r, p1, p2 } : null;
  }
  return null;
}

/** Append a point with a given id-free position; returns the id. */
export function withPoint(d: SketchDraft, at: Pt): { draft: SketchDraft; id: string } {
  const id = nextId(d, 'p');
  const point: DraftPoint = { id, x: at.x, y: at.y };
  return { draft: { ...d, points: [...d.points, point] }, id };
}

/** Append an entity (any shape) with a fresh `e` id. */
export function withEntity(d: SketchDraft, fields: Record<string, unknown>): { draft: SketchDraft; id: string } {
  const id = nextId(d, 'e');
  return { draft: { ...d, entities: [...d.entities, { ...fields, id } as DraftEntity] }, id };
}

/** Append a constraint, with optional extra fields such as `at`. */
export function withConstraint(d: SketchDraft, type: string, refs: string[], extra: Record<string, unknown> = {}): SketchDraft {
  const c: DraftConstraint = { id: nextId(d, 'k'), type, refs, ...extra };
  return { ...d, constraints: [...d.constraints, c] };
}

export function replaceEntity(d: SketchDraft, id: string, fn: (e: DraftEntity) => DraftEntity): SketchDraft {
  return { ...d, entities: d.entities.map((e) => (e.id === id ? fn(e) : e)) };
}

/** Drop every constraint (and temp constraint) that has a ref or `at` that is neither a point nor an entity. */
export function pruneDangling(d: SketchDraft): SketchDraft {
  const ids = new Set<string>([...d.points.map((p) => p.id), ...d.entities.map((e) => e.id)]);
  const ok = (c: DraftConstraint) => (c.refs ?? []).every((r) => ids.has(r)) && (typeof c.at !== 'string' || ids.has(c.at));
  return { ...d, constraints: d.constraints.filter(ok), temp: d.temp.filter(ok) };
}

/**
 * Remove the candidate points that no entity uses any more (fixed points stay), then prune constraints.
 * Only the candidates are touched: unrelated free points in the draft are left alone.
 */
export function dropOrphans(d: SketchDraft, candidates: Iterable<string>): SketchDraft {
  const used = new Set<string>();
  for (const e of d.entities) for (const p of entityPoints(e)) used.add(p);
  const gone = new Set<string>();
  for (const id of candidates) {
    const p = d.points.find((q) => q.id === id);
    if (p && !p.fixed && !used.has(id)) gone.add(id);
  }
  return pruneDangling({ ...d, points: d.points.filter((p) => !gone.has(p.id)) });
}

/** Remove entities by id, then orphaned points they used, then dangling constraints. */
export function removeEntities(d: SketchDraft, ids: Iterable<string>): SketchDraft {
  const del = new Set(ids);
  const cands = new Set<string>();
  for (const e of d.entities) if (del.has(e.id)) for (const p of entityPoints(e)) cands.add(p);
  return dropOrphans({ ...d, entities: d.entities.filter((e) => !del.has(e.id)) }, cands);
}
