/** Test fixtures for the edit tools: sketch drafts built by hand, and the reference-integrity check. */
import type { SketchDraft } from '../index';

/** Axis-aligned rectangle from the origin: p1 (0,0), p2 (w,0), p3 (w,h), p4 (0,h); e1 bottom, e2 right, e3 top, e4 left, with H/V constraints. */
export function rectDraft(w: number, h: number): SketchDraft {
  return {
    id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [],
    points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: w, y: 0 }, { id: 'p3', x: w, y: h }, { id: 'p4', x: 0, y: h }],
    entities: [
      { id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'line', p1: 'p2', p2: 'p3' },
      { id: 'e3', type: 'line', p1: 'p3', p2: 'p4' }, { id: 'e4', type: 'line', p1: 'p4', p2: 'p1' },
    ],
    constraints: [
      { id: 'k1', type: 'horizontal', refs: ['e1'] }, { id: 'k2', type: 'vertical', refs: ['e2'] },
      { id: 'k3', type: 'horizontal', refs: ['e3'] }, { id: 'k4', type: 'vertical', refs: ['e4'] },
    ],
  };
}

/** True when every ref (and `at`) of every constraint names a point or an entity of the draft. */
export function resolves(d: SketchDraft): boolean {
  const ids = new Set([...d.points.map((p) => p.id), ...d.entities.map((e) => e.id)]);
  return [...d.constraints, ...d.temp].every((c) => (c.refs ?? []).every((r) => ids.has(r)) && (typeof c.at !== 'string' || ids.has(c.at)));
}

export const blankDraft = (): SketchDraft => ({ id: 'F1', plane: { kind: 'std', id: 'front' }, points: [], entities: [], constraints: [], temp: [] });
