import { describe, expect, it } from 'vitest';
import type { SketchSolverStatus } from '@ck/part-model';
import type { SketchDraft } from './index';
import { conflictingGeometry, definitionMap, fullyDefine, suggestDimensions, suggestRelations, type Solve } from './define';
import { rectDraft } from './tools/edit-fixtures';

const P = (id: string, x: number, y: number, fixed = false) => ({ id, x, y, ...(fixed ? { fixed: true } : {}) });
const bare = (points: SketchDraft['points'], entities: SketchDraft['entities'], constraints: SketchDraft['constraints'] = []): SketchDraft => ({ id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [], points, entities, constraints });
const status = (dof: number, extra: Partial<SketchSolverStatus> = {}): SketchSolverStatus => ({ dof, fullyDefined: dof === 0, conflicts: [], redundant: [], solved: true, state: dof === 0 ? 'full' : 'under', ...extra } as SketchSolverStatus);

describe('suggestRelations', () => {
  it('finds horizontal, vertical, parallel / perpendicular and equal as drawn, within a degree', () => {
    // a quad that is axis-aligned to within 0.3 degrees
    const d = bare([P('a', 0, 0), P('b', 10, 0.04), P('c', 10.02, 5), P('d', 0, 5)], [
      { id: 'e1', type: 'line', p1: 'a', p2: 'b' }, { id: 'e2', type: 'line', p1: 'b', p2: 'c' }, { id: 'e3', type: 'line', p1: 'c', p2: 'd' }, { id: 'e4', type: 'line', p1: 'd', p2: 'a' },
    ]);
    const r = suggestRelations(d);
    expect(r.filter((c) => c.type === 'horizontal').map((c) => c.refs[0])).toEqual(['e1', 'e3']);
    expect(r.filter((c) => c.type === 'vertical').map((c) => c.refs[0])).toEqual(['e2', 'e4']);
    // two axis-aligned lines are related through the axes already: no parallel / perpendicular on top
    expect(r.some((c) => c.type === 'parallel' || c.type === 'perpendicular')).toBe(false);
  });
  it('a tilted pair gets parallel and perpendicular, not horizontal / vertical', () => {
    const d = bare([P('a', 0, 0), P('b', 10, 10), P('c', 0, 5), P('d', 5, 10), P('e', 0, 20), P('f', 5, 15)], [
      { id: 'e1', type: 'line', p1: 'a', p2: 'b' }, { id: 'e2', type: 'line', p1: 'c', p2: 'd' }, { id: 'e3', type: 'line', p1: 'e', p2: 'f' },
    ]);
    const r = suggestRelations(d);
    expect(r.some((c) => c.type === 'horizontal' || c.type === 'vertical')).toBe(false);
    expect(r.filter((c) => c.type === 'parallel').map((c) => c.refs)).toEqual([['e1', 'e2']]);
    expect(r.filter((c) => c.type === 'perpendicular').map((c) => c.refs)).toEqual([['e1', 'e3'], ['e2', 'e3']]);
  });
  it('does not repeat what is stated, and finds equal radii', () => {
    const r0 = rectDraft(10, 5);
    expect(suggestRelations(r0).filter((c) => c.type === 'horizontal' || c.type === 'vertical')).toEqual([]);
    const two = bare([P('a', 0, 0), P('b', 20, 0)], [{ id: 'e1', type: 'circle', c: 'a', r: 3 }, { id: 'e2', type: 'circle', c: 'b', r: 3 }]);
    expect(suggestRelations(two).map((c) => [c.type, c.refs])).toEqual([['equal', ['e1', 'e2']]]);
  });
});

describe('suggestDimensions', () => {
  it('sizes first, then positions from the origin; coincident when a point is at the origin; fix when there is no origin', () => {
    const d = bare([P('O', 0, 0, true), P('a', 5, 5), P('b', 15, 5), P('c', 0, 0), P('o', 30, 30)], [
      { id: 'e1', type: 'line', p1: 'a', p2: 'b' }, { id: 'e2', type: 'circle', c: 'o', r: 4 },
    ]);
    const s = suggestDimensions(d).map((c) => [c.type, ...c.refs]);
    expect(s.slice(0, 2)).toEqual([['radius', 'e2'], ['distance', 'a', 'b']]);
    expect(s).toContainEqual(['hdist', 'O', 'a']);
    expect(s).toContainEqual(['coincident', 'O', 'c']);
    const noOrigin = suggestDimensions(bare([P('a', 5, 5)], [{ id: 'e1', type: 'point', p: 'a' }]));
    expect(noOrigin).toEqual([expect.objectContaining({ type: 'fix', refs: ['a'], value: [5, 5] })]);
  });
  it('skips what already has a dimension', () => {
    const d = bare([P('O', 0, 0, true), P('a', 5, 0), P('b', 15, 0)], [{ id: 'e1', type: 'line', p1: 'a', p2: 'b' }], [{ id: 'k1', type: 'distance', refs: ['a', 'b'], value: 10 }, { id: 'k2', type: 'hdist', refs: ['O', 'a'], value: 5 }]);
    expect(suggestDimensions(d).map((c) => c.type)).not.toContain('distance');
    expect(suggestDimensions(d).filter((c) => c.type === 'hdist').map((c) => c.refs[1])).toEqual(['b']);
  });
});

describe('fullyDefine with a stub solver', () => {
  /** dof = unknowns - constraints, a constraint on an id already used twice is redundant */
  const stub = (unknowns: number, redundantIf: (c: { id: string; type: string }, all: SketchDraft['constraints']) => boolean = () => false): Solve => async (d) => {
    const red = d.constraints.filter((c, i) => redundantIf(c, d.constraints.slice(0, i))).map((c) => c.id);
    return status(Math.max(0, unknowns - (d.constraints.length - red.length)), { redundant: red });
  };
  it('adds constraints until the stub says zero, counting relations and dimensions, and stops there', async () => {
    const d = rectDraft(10, 5);
    const r = await fullyDefine({ ...d, points: [P('O', 0, 0, true), ...d.points.map((p) => ({ ...p, x: p.x + 3, y: p.y + 2 }))], constraints: [] }, stub(8));
    expect(r.fully).toBe(true);
    expect(r.status!.dof).toBe(0);
    expect(r.relations).toBe(4 + 2);          // 4 horizontal / vertical, 2 equal (the opposite sides)
    expect(r.relations + r.dimensions).toBe(8);
  });
  it('a candidate the solver calls redundant is refused and not kept', async () => {
    const d = rectDraft(10, 5);
    const start = { ...d, points: [P('O', 0, 0, true), ...d.points.map((p) => ({ ...p, x: p.x + 3, y: p.y + 2 }))], constraints: [] };
    const r = await fullyDefine(start, stub(8, (c) => c.type === 'equal'));
    expect(r.draft.constraints.some((c) => c.type === 'equal')).toBe(false);
    expect(r.fully).toBe(true);
  });
  it('does nothing when already defined or in conflict, and survives a solver that answers nothing', async () => {
    const d = rectDraft(10, 5);
    expect((await fullyDefine(d, async () => status(0))).fully).toBe(true);
    const c = await fullyDefine(d, async () => status(3, { state: 'over', conflicts: ['k1'] }));
    expect(c.relations + c.dimensions).toBe(0);
    expect(c.fully).toBe(false);
    expect((await fullyDefine(d, async () => null)).fully).toBe(false);
  });
  it('respects the solve budget', async () => {
    let calls = 0;
    const d = rectDraft(10, 5);
    await fullyDefine({ ...d, constraints: [] }, async (x) => { calls++; return status(1000 - x.constraints.length); }, { maxSolves: 5 });
    expect(calls).toBeLessThanOrEqual(6);
  });
});

describe('definitionMap with a stub solver', () => {
  const rect = (): SketchDraft => bare([P('a', 0, 0), P('b', 10, 0), P('c', 10, 5), P('d', 0, 5)], [
    { id: 'e1', type: 'line', p1: 'a', p2: 'b' }, { id: 'e2', type: 'line', p1: 'b', p2: 'c' }, { id: 'e3', type: 'line', p1: 'c', p2: 'd' }, { id: 'e4', type: 'line', p1: 'd', p2: 'a' }, { id: 'e5', type: 'circle', c: 'a', r: 1 },
  ]);
  it('zero degrees of freedom: everything full, no probes', async () => {
    let calls = 0;
    const m = await definitionMap(rect(), status(0), async () => { calls++; return null; });
    expect([...m.values()].every((v) => v === 'full')).toBe(true);
    expect(calls).toBe(0);
  });
  it('probes each free point: a probe that does not lower the dof means determined', async () => {
    // only point a is "determined": a pin on it adds nothing
    const m = await definitionMap(rect(), status(4), async (d) => (d.constraints[0].refs![0] === 'a' ? status(4) : status(2)));
    expect(m.get('e1')).toBe('under');   // b is free
    expect(m.get('e4')).toBe('under');
    expect(m.get('e5')).toBe('under');   // a is determined but the circle radius probe lowers dof
  });
  it('entities named by a conflicting constraint are over; probes are bounded', async () => {
    const d: SketchDraft = { ...rect(), constraints: [{ id: 'k1', type: 'distance', refs: ['a', 'b'], value: 10 }, { id: 'k2', type: 'distance', refs: ['a', 'b'], value: 12 }] };
    let calls = 0;
    const m = await definitionMap(d, status(2, { state: 'over', conflicts: ['k2'] }), async () => { calls++; return status(2); }, { maxProbes: 3 });
    expect(m.get('e1')).toBe('over');
    expect(m.get('e3')).toBe('under');
    expect(calls).toBeLessThanOrEqual(3);
  });

  it('conflictingGeometry lists the points and curves a blamed constraint names, and nothing when all is well', () => {
    const d: SketchDraft = { ...rect(), constraints: [{ id: 'k1', type: 'distance', refs: ['a', 'b'], value: 10 }, { id: 'k2', type: 'distance', refs: ['a', 'b'], value: 12 }] };
    const g = conflictingGeometry(d, status(2, { state: 'over', conflicts: ['k2'] }));
    expect(g.points).toEqual(['a', 'b']);
    expect(g.entities).toContain('e1');
    expect(g.entities).not.toContain('e3');
    expect(conflictingGeometry(d, status(2))).toEqual({ entities: [], points: [] });
    expect(conflictingGeometry(d, null)).toEqual({ entities: [], points: [] });
  });
  it('a redundant constraint is blamed only once the sketch is over-constrained', () => {
    const d: SketchDraft = { ...rect(), constraints: [{ id: 'k1', type: 'distance', refs: ['a', 'b'], value: 10 }] };
    expect(conflictingGeometry(d, status(2, { state: 'under', redundant: ['k1'] })).points).toEqual([]);
    expect(conflictingGeometry(d, status(2, { state: 'over', redundant: ['k1'] })).points).toEqual(['a', 'b']);
  });
});
