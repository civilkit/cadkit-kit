import { describe, expect, it } from 'vitest';
import type { SketchSolverStatus } from '@ck/part-model';
import type { SketchDraft } from './index';
import { conflictingGeometry, definitionMap, fullyDefine, roundDimension, suggestDimensions, suggestRelations, type Solve } from './define';
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
    expect(r.some((c) => (c.type === 'horizontal' || c.type === 'vertical') && c.refs.length === 1)).toBe(false);   // (points a, c, e do line up: that is a point relation)
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

describe('suggestRelations: what the drawing nearly satisfies', () => {
  const rel = (d: SketchDraft) => suggestRelations(d).map((c) => [c.type, ...c.refs, ...(c.extra ? [JSON.stringify(c.extra)] : [])].join(' '));
  it('points within tolerance of each other are coincident, but a line\'s own two ends never', () => {
    const d = bare([P('a', 0, 0), P('b', 50, 0.05), P('c', 50, 40), P('x', 0.04, 0.02)], [{ id: 'e1', type: 'line', p1: 'a', p2: 'b' }, { id: 'e2', type: 'line', p1: 'b', p2: 'c' }]);
    expect(rel(d)).toContain('coincident a x');
    expect(rel(d).filter((r) => r.startsWith('coincident')).length).toBe(1);
  });
  it('an end point on a circle, an arc or a line gets pointOnCircle / pointOnLine', () => {
    const d = bare([P('c', 0, 0), P('s', 10.03, 0.02), P('a', 30, 0), P('b', 60, 0), P('m', 45, 0.04)], [
      { id: 'e1', type: 'circle', c: 'c', r: 10 }, { id: 'e2', type: 'line', p1: 'a', p2: 'b' }, { id: 'e3', type: 'point', p: 's' }, { id: 'e4', type: 'point', p: 'm' },
    ]);
    expect(rel(d)).toContain('pointOnCircle s e1');
    expect(rel(d)).toContain('pointOnLine m e2');
    // a point far from the segment, though on its infinite line, is not on it
    const far = bare([P('a', 30, 0), P('b', 60, 0), P('m', 90, 0)], [{ id: 'e2', type: 'line', p1: 'a', p2: 'b' }, { id: 'e4', type: 'point', p: 'm' }]);
    expect(rel(far).some((r) => r.startsWith('pointOnLine'))).toBe(false);
  });
  it('curves that nearly touch are tangent (internal when nested), concentric when they share a centre', () => {
    const d = bare([P('a', 0, 0), P('b', 30.05, 0), P('c', 0.02, 40), P('n', 100, 0), P('m', 105, 0)], [
      { id: 'e1', type: 'circle', c: 'a', r: 10 }, { id: 'e2', type: 'circle', c: 'b', r: 20 },
      { id: 'e3', type: 'circle', c: 'n', r: 30 }, { id: 'e4', type: 'circle', c: 'm', r: 25 },
      { id: 'e5', type: 'circle', c: 'c', r: 5 },
    ]);
    const r = rel(d);
    expect(r).toContain('tangent e1 e2');
    expect(r).toContain('tangent e3 e4 {"internal":true}');
    expect(r.some((x) => x.startsWith('tangent e1 e3'))).toBe(false);
  });
  it('a circle and a line at its radius are tangent; one centre on another is concentric', () => {
    const d = bare([P('a', 0, 0), P('p', -50, 10.04), P('q', 50, 10.04), P('b', 0.03, -0.02)], [
      { id: 'e1', type: 'circle', c: 'a', r: 10 }, { id: 'e2', type: 'line', p1: 'p', p2: 'q' }, { id: 'e3', type: 'circle', c: 'b', r: 4 },
    ]);
    const r = rel(d);
    expect(r).toContain('tangent e2 e1');
    expect(r).toContain('concentric e1 e3');
  });
  it('arcs that meet end to end with their radii in line are tangent at that point', () => {
    // arc one ends where its radius is along +x, arc two starts where its radius is along -x: the centres and the join are collinear
    const t = suggestRelations(bare([P('c1', 0, 0), P('s', 0, 10), P('j', 10, 0), P('c2', 30, 0), P('z', 30, 20)], [
      { id: 'e1', type: 'arc', c: 'c1', p1: 's', p2: 'j' }, { id: 'e2', type: 'arc', c: 'c2', p1: 'j', p2: 'z' },
    ])).filter((c) => c.type === 'tangent');
    expect(t).toEqual([expect.objectContaining({ refs: ['e1', 'e2'], extra: { at: 'j' } })]);
  });
  it('points that share an x or a y line up, radii and lengths within tolerance are equal', () => {
    const d = bare([P('a', 0, 0), P('b', 30, 0.05), P('c', 20.03, 40), P('o1', 0, 100), P('o2', 40, 100)], [
      { id: 'e1', type: 'point', p: 'a' }, { id: 'e2', type: 'point', p: 'b' }, { id: 'e3', type: 'point', p: 'c' },
      { id: 'e4', type: 'circle', c: 'o1', r: 5 }, { id: 'e5', type: 'circle', c: 'o2', r: 5.04 },
    ]);
    const r = rel(d);
    expect(r).toContain('horizontal a b');
    expect(r.some((x) => x.startsWith('vertical') && x.includes(' c'))).toBe(false);   // c is 20.03 from b, not aligned
    expect(r).toContain('equal e4 e5');
  });
});

describe('roundDimension', () => {
  it('takes the nearest half when it is within 1%, otherwise two decimals', () => {
    expect(roundDimension(19.97)).toBe(20);
    expect(roundDimension(40.2)).toBe(40);        // 0.5% off 40
    expect(roundDimension(39.9)).toBe(40);
    expect(roundDimension(24.6)).toBe(24.5);      // 0.4% off 24.5
    expect(roundDimension(19.26)).toBe(19.26);    // 19.5 is 1.2% away: keep the measurement, to two decimals
    expect(roundDimension(19.2631)).toBe(19.26);
    expect(roundDimension(19.54)).toBe(19.5);     // 0.2% off
    expect(roundDimension(19.5001)).toBe(19.5);
  });
  it('rounds angles the same way and handles zero, small and negative values', () => {
    expect(roundDimension(89.7)).toBe(89.5);      // nearest half, 0.2% off
    expect(roundDimension(60.0004)).toBe(60);
    expect(roundDimension(0)).toBe(0);
    expect(roundDimension(0.003)).toBe(0.003);    // two decimals would erase it: keep four
    expect(roundDimension(0.37)).toBe(0.37);      // 0.5 is 35% away
    expect(roundDimension(-12.04)).toBe(-12);
    expect(roundDimension(12.3456)).toBe(12.35);
  });
  it('never returns more than two decimals for a size of 0.01 or more', () => {
    for (const v of [3.14159, 17.777, 99.999, 0.0151, 250.4321]) {
      const r = roundDimension(v);
      expect(Math.abs(r * 100 - Math.round(r * 100))).toBeLessThan(1e-9);
    }
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
