import { describe, expect, it } from 'vitest';
import type { SketchDraft } from './index';
import { applySnapConstraints } from './snap-constraints';
import { addPoint } from './tools/builders';

const base = (): SketchDraft => ({
  id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [], constraints: [],
  points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 10, y: 0 }],
  entities: [{ id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }],
});

describe('applySnapConstraints', () => {
  it('constrains a new point on a midpoint to that line', () => {
    const b = base();
    const { draft } = addPoint(b, { x: 5, y: 0 });
    const out = applySnapConstraints(b, draft, { kind: 'midpoint', at: { x: 5, y: 0 }, entityId: 'e1' });
    expect(out.constraints).toEqual([expect.objectContaining({ type: 'midpoint', refs: ['p3', 'e1'] })]);
  });
  it('constrains a new point on an alignment: vertical for x, horizontal for y', () => {
    const b = base();
    const { draft } = addPoint(b, { x: 10, y: 7 });
    const out = applySnapConstraints(b, draft, { kind: 'align', at: { x: 10, y: 7 }, alignTo: { x: 'p2' } });
    expect(out.constraints.map((c) => [c.type, c.refs])).toEqual([['vertical', ['p3', 'p2']]]);
    const both = applySnapConstraints(b, addPoint(b, { x: 10, y: 0 }).draft, { kind: 'align', at: { x: 10, y: 0 }, alignTo: { x: 'p2', y: 'p1' } });
    expect(both.constraints.map((c) => c.type)).toEqual(['vertical', 'horizontal']);
  });
  it('adds nothing when no point was added, when the point is off the snap, or for plain point and grid snaps', () => {
    const b = base();
    expect(applySnapConstraints(b, b, { kind: 'midpoint', at: { x: 5, y: 0 }, entityId: 'e1' })).toBe(b);
    const moved = addPoint(b, { x: 6, y: 0 }).draft;
    expect(applySnapConstraints(b, moved, { kind: 'midpoint', at: { x: 5, y: 0 }, entityId: 'e1' }).constraints).toEqual([]);
    const grid = addPoint(b, { x: 5, y: 5 }).draft;
    expect(applySnapConstraints(b, grid, { kind: 'grid', at: { x: 5, y: 5 } }).constraints).toEqual([]);
    expect(applySnapConstraints(b, grid, undefined)).toBe(grid);
  });
});
