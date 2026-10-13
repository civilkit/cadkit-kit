/** Small immutable helpers tools use to extend a draft. Ids follow the kernel's style: p1.., e1.., k1.. */
import type { DraftConstraint, DraftEntity, DraftPoint, SketchDraft } from '../index';
import type { Pt } from './types';

export function nextId(draft: SketchDraft, prefix: 'p' | 'e' | 'k'): string {
  const rx = new RegExp(`^${prefix}(\\d+)$`);
  const pool: Array<{ id: string }> = prefix === 'p' ? draft.points : prefix === 'e' ? draft.entities : [...draft.constraints, ...draft.temp];
  let max = 0;
  for (const it of pool) { const m = rx.exec(it.id); if (m) max = Math.max(max, Number(m[1])); }
  return `${prefix}${max + 1}`;
}

export function addPoint(draft: SketchDraft, at: Pt): { draft: SketchDraft; id: string } {
  const id = nextId(draft, 'p');
  const point: DraftPoint = { id, x: at.x, y: at.y };
  return { draft: { ...draft, points: [...draft.points, point] }, id };
}

export function addLine(draft: SketchDraft, p1: string, p2: string): { draft: SketchDraft; id: string } {
  const id = nextId(draft, 'e');
  const entity: DraftEntity = { id, type: 'line', p1, p2 };
  return { draft: { ...draft, entities: [...draft.entities, entity] }, id };
}

export function addConstraintOf(draft: SketchDraft, type: string, refs: string[], value?: number): SketchDraft {
  const c: DraftConstraint = { id: nextId(draft, 'k'), type, refs, ...(value !== undefined ? { value } : {}) };
  return { ...draft, constraints: [...draft.constraints, c] };
}

export const pointOf = (draft: SketchDraft, id: string): Pt => {
  const p = draft.points.find((q) => q.id === id);
  if (!p) throw new Error(`no point ${id}`);
  return { x: p.x, y: p.y };
};
