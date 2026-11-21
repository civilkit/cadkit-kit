/**
 * Manual placement of a sketch dimension: where the user dragged its label. View data only, kept in the sketch's `extras` as
 * `dimPlacement: { [dimension id]: { level, side } }` (the vocabulary of the automatic layout, see dimLayout.ts) and carried through the
 * kernel like `refDims` (unknown sketch fields are kept). The solver never reads it.
 */
import type { SketchDraft } from './index';
import { dimensionShape } from './annotations';
import { LEVEL_PX, MAX_LEVEL, type ToPx } from './dimLayout';

export interface DimPlace { level: number; side: 1 | -1 }
export type DimPlacements = Record<string, DimPlace>;

const valid = (p: unknown): p is DimPlace => {
  const q = p as DimPlace | null;
  return !!q && typeof q === 'object' && Number.isFinite(q.level) && q.level >= 1 && (q.side === 1 || q.side === -1);
};

/** The stored placements (entries that are not well formed are ignored). */
export function placementsOf(d: SketchDraft): DimPlacements {
  const raw = d.extras?.dimPlacement;
  const out: DimPlacements = {};
  if (raw && typeof raw === 'object') for (const [id, p] of Object.entries(raw as Record<string, unknown>)) if (valid(p)) out[id] = { level: Math.min(MAX_LEVEL, Math.max(1, Math.round(p.level))), side: p.side };
  return out;
}

const withPlacements = (d: SketchDraft, list: DimPlacements): SketchDraft => {
  const extras = { ...(d.extras ?? {}) };
  if (Object.keys(list).length) extras.dimPlacement = list; else delete extras.dimPlacement;
  return { ...d, ...(Object.keys(extras).length ? { extras } : { extras: undefined }) };
};

/** Pin a dimension at a level and side. */
export const setDimPlacement = (d: SketchDraft, id: string, p: DimPlace): SketchDraft => withPlacements(d, { ...placementsOf(d), [id]: { level: p.level, side: p.side } });

/** Back to the automatic place. */
export function resetDimPlacement(d: SketchDraft, id: string): SketchDraft {
  const list = placementsOf(d);
  if (!(id in list)) return d;
  delete list[id];
  return withPlacements(d, list);
}

/** Drop the placements of dimensions that no longer exist (a deleted constraint, a reference dimension that became a driving one under a new id). */
export function pruneDimPlacement(d: SketchDraft): SketchDraft {
  const list = placementsOf(d);
  const ids = new Set<string>(d.constraints.map((c) => c.id));
  if (Array.isArray(d.extras?.refDims)) for (const r of d.extras!.refDims as Array<{ id: string }>) ids.add(r.id);
  const keep = Object.fromEntries(Object.entries(list).filter(([id]) => ids.has(id)));
  const had = d.extras?.dimPlacement;
  if (had === undefined || Object.keys(keep).length === Object.keys(list).length && Object.keys(list).length === Object.keys(had as object).length) return d;
  return withPlacements(d, keep);
}

/**
 * The level and side whose label position is nearest the pointer (screen pixels): each candidate's drawing is built with the same
 * shape code the layout uses and its label point projected, so this works the same for every kind of dimension. Null when none can be built.
 */
export function placementFromPointer(d: SketchDraft, dim: { type: string; refs: string[]; value: number }, pointer: { x: number; y: number }, o: { to: ToPx; squareRight?: boolean }): DimPlace | null {
  const s = (() => { const a = o.to(0, 0), b = o.to(1, 0); return a && b ? Math.hypot(b.x - a.x, b.y - a.y) || 1 : 1; })();
  let best: DimPlace | null = null, bestD = Infinity;
  for (const side of [1, -1] as const) for (let level = 1; level <= MAX_LEVEL; level++) {
    const shape = dimensionShape(d, dim.type, dim.refs, dim.value, { off: LEVEL_PX / s, level, side, squareRight: o.squareRight !== false });
    const t = shape ? o.to(shape.text.x, shape.text.y) : null;
    if (!t) continue;
    const dist = Math.hypot(t.x - pointer.x, t.y - pointer.y);
    if (dist < bestD - 1e-9) { bestD = dist; best = { level, side }; }
  }
  return best;
}
