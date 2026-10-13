/**
 * A sketch being edited: a detached, mutable copy of a sketch feature that
 * preserves every field the typed model does not know about (round-trips back
 * to an identical feature), plus temporary drag constraints that are dropped
 * on commit and only travel with speculative previews.
 */

export interface DraftPoint {
  id: string;
  x: number;
  y: number;
  fixed?: boolean;
  [key: string]: unknown;
}

export interface DraftEntity {
  id: string;
  [key: string]: unknown;
}

export interface DraftConstraint {
  id: string;
  type: string;
  refs?: string[];
  value?: number | number[];
  [key: string]: unknown;
}

export interface SketchDraft {
  id: string;
  name?: string;
  plane: unknown;
  points: DraftPoint[];
  entities: DraftEntity[];
  constraints: DraftConstraint[];
  /** Temporary constraints (drag fixes): previewed, never committed. */
  temp: DraftConstraint[];
  /** Top-level feature fields outside the known set (seq, visible, ...). */
  extras?: Record<string, unknown>;
}

const KNOWN = new Set(['type', 'id', 'name', 'plane', 'points', 'entities', 'constraints']);

/** Deep copy of a sketch feature into a draft; unknown fields are kept. */
export function fromFeature(feature: Record<string, unknown>): SketchDraft {
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(feature)) {
    if (!KNOWN.has(k)) extras[k] = structuredClone(v);
  }
  const draft: SketchDraft = {
    id: String(feature.id),
    plane: structuredClone(feature.plane),
    points: structuredClone((feature.points ?? []) as DraftPoint[]),
    entities: structuredClone((feature.entities ?? []) as DraftEntity[]),
    constraints: structuredClone((feature.constraints ?? []) as DraftConstraint[]),
    temp: [],
  };
  if (feature.name !== undefined) draft.name = String(feature.name);
  if (Object.keys(extras).length) draft.extras = extras;
  return draft;
}

/** Reassemble the feature. Temporary drag constraints are excluded unless
 *  `includeTemp` (speculative preview) asks for them. */
export function toFeature(draft: SketchDraft, opts?: { includeTemp?: boolean }): Record<string, unknown> {
  return {
    ...(draft.extras ? structuredClone(draft.extras) : {}),
    type: 'sketch',
    id: draft.id,
    ...(draft.name !== undefined ? { name: draft.name } : {}),
    plane: structuredClone(draft.plane),
    points: structuredClone(draft.points),
    entities: structuredClone(draft.entities),
    constraints: structuredClone(opts?.includeTemp ? [...draft.constraints, ...draft.temp] : draft.constraints),
  };
}

/** Move a point and pin it at the new spot with a temporary fix so the
 *  solver re-solves the rest of the sketch around the drag. Returns a new
 *  draft. */
export function movePoint(draft: SketchDraft, id: string, x: number, y: number): SketchDraft {
  if (!draft.points.some((p) => p.id === id)) throw new Error(`no point ${id} in sketch ${draft.id}`);
  const points = draft.points.map((p) => (p.id === id ? { ...p, x, y } : p));
  const fixId = `draft-fix-${id}`;
  const temp = draft.temp.filter((c) => c.id !== fixId);
  temp.push({ id: fixId, type: 'fix', refs: [id], value: [x, y] });
  return { ...draft, points, temp };
}

/** Copy the solver's result back into the draft: point positions and circle /
 *  ellipse radii come from the solved sketch, everything else (constraints,
 *  temp fixes, extras) is kept. The kernel regen only re-solves on `expr`
 *  changes, so a committed draft must carry the solved coordinates itself. */
export function foldSolution(draft: SketchDraft, solved: { points: Array<{ id: string; x: number; y: number }>; entities: Array<{ id: string; r?: number }> }): SketchDraft {
  const pts = new Map(solved.points.map((p) => [p.id, p]));
  const ents = new Map(solved.entities.map((e) => [e.id, e]));
  return {
    ...draft,
    points: draft.points.map((p) => {
      const s = pts.get(p.id);
      return s ? { ...p, x: s.x, y: s.y } : p;
    }),
    entities: draft.entities.map((e) => {
      const r = ents.get(e.id)?.r;
      return typeof r === 'number' ? { ...e, r } : e;
    }),
  };
}

/** Add a real constraint. Returns a new draft. */
export function addConstraint(draft: SketchDraft, constraint: DraftConstraint): SketchDraft {
  return { ...draft, constraints: [...draft.constraints, constraint] };
}

/** Remove a constraint (real or temporary). Returns a new draft. */
export function removeConstraint(draft: SketchDraft, id: string): SketchDraft {
  return {
    ...draft,
    constraints: draft.constraints.filter((c) => c.id !== id),
    temp: draft.temp.filter((c) => c.id !== id),
  };
}
