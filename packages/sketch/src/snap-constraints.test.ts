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
  it('does not repeat a horizontal or vertical the tool already inferred for the same segment', () => {
    const b = base();
    const { draft } = addPoint(b, { x: 20, y: 0 });
    const withInferred = { ...draft, constraints: [...draft.constraints, { id: 'k9', type: 'horizontal', refs: ['e5'] }] };
    const out = applySnapConstraints(b, withInferred, { kind: 'align', at: { x: 20, y: 0 }, alignTo: { y: 'p1' } });
    expect(out.constraints.filter((c) => c.type === 'horizontal')).toHaveLength(1);
    const vert = applySnapConstraints(b, withInferred, { kind: 'align', at: { x: 20, y: 0 }, alignTo: { x: 'p2' } });
    expect(vert.constraints.map((c) => c.type)).toEqual(['horizontal', 'vertical']);   // a different kind is still added
  });
});

describe('applySnapConstraints: the richer snaps', () => {
  const circ = (): SketchDraft => ({ ...base(), points: [...base().points, { id: 'c', x: 30, y: 30 }], entities: [...base().entities, { id: 'e2', type: 'circle', c: 'c', r: 5 }] });
  it('on-curve puts the new point on the line or circle', () => {
    const b = circ();
    const line = applySnapConstraints(b, addPoint(b, { x: 3, y: 0 }).draft, { kind: 'oncurve', at: { x: 3, y: 0 }, entityId: 'e1' });
    expect(line.constraints.map((c) => [c.type, c.refs])).toEqual([['pointOnLine', ['p4', 'e1']]]);
    const round = applySnapConstraints(b, addPoint(b, { x: 33, y: 34 }).draft, { kind: 'oncurve', at: { x: 33, y: 34 }, entityId: 'e2' });
    expect(round.constraints.map((c) => c.type)).toEqual(['pointOnCircle']);
  });
  it('intersection puts the point on both curves', () => {
    const b = circ();
    const out = applySnapConstraints(b, addPoint(b, { x: 5, y: 0 }).draft, { kind: 'intersection', at: { x: 5, y: 0 }, entityId: 'e1', entityIds: ['e1', 'e2'] });
    expect(out.constraints.map((c) => c.type)).toEqual(['pointOnLine', 'pointOnCircle']);
  });
  it('quadrant puts the point on the circle and level with / above its centre', () => {
    const b = circ();
    const right = applySnapConstraints(b, addPoint(b, { x: 35, y: 30 }).draft, { kind: 'quadrant', at: { x: 35, y: 30 }, entityId: 'e2' });
    expect(right.constraints.map((c) => [c.type, c.refs])).toEqual([['pointOnCircle', ['p4', 'e2']], ['horizontal', ['p4', 'c']]]);
    const top = applySnapConstraints(b, addPoint(b, { x: 30, y: 35 }).draft, { kind: 'quadrant', at: { x: 30, y: 35 }, entityId: 'e2' });
    expect(top.constraints.map((c) => c.type)).toEqual(['pointOnCircle', 'vertical']);
  });
});
