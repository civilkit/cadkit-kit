/**
 * Replace: when a constraint or dimension that was just added clashes with what is already there (the solver calls it
 * a conflict, or finds it redundant), which EXISTING constraint could be taken out so the new one stands? Each candidate
 * that shares a point or an entity with the new one is tried: the draft without it must solve with no conflict and
 * nothing redundant. The caller offers the first as a one-click "Replace" (Shift while adding does it at once).
 */
import type { DraftConstraint, SketchDraft } from './types';
import { entityPoints } from './tools/edit-draft';
import type { Solve } from './define';

/** The point and entity ids a constraint is about, entities expanded to their points. */
function touched(d: SketchDraft, k: DraftConstraint): Set<string> {
  const out = new Set<string>();
  const add = (id: unknown) => {
    if (typeof id !== 'string') return;
    out.add(id);
    const e = d.entities.find((x) => x.id === id);
    if (e) for (const p of entityPoints(e)) out.add(p);
  };
  for (const r of k.refs ?? []) add(r);
  add((k as { at?: unknown }).at);
  return out;
}

/** Ids of existing constraints whose removal lets the added one stand, nearest first (most shared geometry). Empty when none does. */
export async function replaceCandidates(draft: SketchDraft, addedId: string, solve: Solve, opts: { max?: number } = {}): Promise<string[]> {
  const added = draft.constraints.find((k) => k.id === addedId);
  if (!added) return [];
  const mine = touched(draft, added);
  const related = draft.constraints
    .filter((k) => k.id !== addedId)
    .map((k) => ({ k, shared: [...touched(draft, k)].filter((id) => mine.has(id)).length }))
    .filter((x) => x.shared > 0)
    .sort((a, b) => b.shared - a.shared)
    .slice(0, opts.max ?? 12);
  const found: string[] = [];
  for (const { k } of related) {
    const s = await solve({ ...draft, constraints: draft.constraints.filter((c) => c.id !== k.id) });
    if (s && s.solved && !s.conflicts.length && !s.redundant.length) found.push(k.id);
  }
  return found;
}

/** The draft with one constraint taken out (the replaced one). */
export const withoutConstraint = (draft: SketchDraft, id: string): SketchDraft => ({ ...draft, constraints: draft.constraints.filter((k) => k.id !== id) });
