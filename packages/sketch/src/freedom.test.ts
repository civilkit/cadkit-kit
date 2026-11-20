import { describe, expect, it } from 'vitest';
import type { SketchSolverStatus } from '@ck/part-model';
import type { SketchDraft } from './index';
import { freedomHighlight, withoutSuggestion, applySuggestion, describeFree, effectiveMarkMode, freeParts, suggestionsFor, tooltipItems } from './freedom';

const P = (id: string, x: number, y: number, fixed = false) => ({ id, x, y, ...(fixed ? { fixed: true } : {}) });
const bare = (points: SketchDraft['points'], entities: SketchDraft['entities'], constraints: SketchDraft['constraints'] = [], extras?: SketchDraft['extras']): SketchDraft => ({ id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [], points, entities, constraints, ...(extras ? { extras } : {}) });
const status = (dof: number, extra: Partial<SketchSolverStatus> = {}): SketchSolverStatus => ({ dof, fullyDefined: dof === 0, conflicts: [], redundant: [], solved: true, state: dof === 0 ? 'full' : 'under', ...extra } as SketchSolverStatus);

const twoCircles = () => bare([P('O', 0, 0, true), P('c1', 20.02, 10), P('c2', 50, 10)], [
  { id: 'e1', type: 'line', p1: 'O', p2: 'c1' }, { id: 'e2', type: 'circle', c: 'c1', r: 5.004 }, { id: 'e3', type: 'circle', c: 'c2', r: 7 },
]);

describe('describeFree', () => {
  it('names each free point or radius by its owner, with the entity\'s number among its kind', () => {
    const d = twoCircles();
    const items = describeFree(d, [{ kind: 'point', id: 'c2', axes: 'xy' }, { kind: 'radius', id: 'e3' }, { kind: 'point', id: 'c1', axes: 'y' }]);
    expect(items.map((i) => [i.key, i.entityType, i.ordinal, i.role, i.axes])).toEqual([
      ['point:c2', 'circle', 2, 'centre', 'xy'], ['radius:e3', 'circle', 2, 'radius', undefined], ['point:c1', 'line', 1, 'end', 'y'],
    ]);
  });
  it('a point owned by no entity gives no finding', () => {
    expect(describeFree(twoCircles(), [{ kind: 'point', id: 'zz' }])).toEqual([]);
  });
});

describe('suggestionsFor', () => {
  it('a free radius is answered by a radius dimension with the rounded current value', () => {
    const d = twoCircles();
    const s = suggestionsFor(d, describeFree(d, [{ kind: 'radius', id: 'e2' }]));
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ label: 'radius', kind: 'dimension', type: 'radius', refs: ['e2'], value: 5 });
  });
  it('a centre free in x and y gets distances from the origin; only the open axis when one is pinned', () => {
    const d = twoCircles();
    const xy = suggestionsFor(d, describeFree(d, [{ kind: 'point', id: 'c2', axes: 'xy' }]));
    expect(xy.map((s) => [s.type, s.value])).toEqual([['hdist', 50], ['vdist', 10]]);
    const y = suggestionsFor(d, describeFree(d, [{ kind: 'point', id: 'c2', axes: 'y' }]));
    expect(y.map((s) => s.type)).toEqual(['vdist']);
  });
  it('a point at the origin is answered by coincident with it; without an origin by fixing it', () => {
    const d = bare([P('O', 0, 0, true), P('a', 0.001, 0)], [{ id: 'e1', type: 'point', p: 'a' }]);
    expect(suggestionsFor(d, describeFree(d, [{ kind: 'point', id: 'a', axes: 'xy' }])).map((s) => [s.label, s.type])).toEqual([['origin', 'coincident']]);
    const free = bare([P('a', 3.04, 4)], [{ id: 'e1', type: 'point', p: 'a' }]);
    const f = suggestionsFor(free, describeFree(free, [{ kind: 'point', id: 'a', axes: 'xy' }]));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ type: 'fix', value: [3.04, 4] });
  });
  it('the free end of a nearly horizontal line suggests horizontal and its length, at most three chips', () => {
    const d = bare([P('O', 0, 0, true), P('b', 40, 0.1)], [{ id: 'e1', type: 'line', p1: 'O', p2: 'b' }]);
    const s = suggestionsFor(d, describeFree(d, [{ kind: 'point', id: 'b', axes: 'xy' }]));
    expect(s.map((x) => x.label)).toEqual(['horizontal', 'length', 'hdist']);
    expect(s[1].value).toBe(40);
  });
  it('applySuggestion adds the constraint; a dimension is flagged to open its value box, a relation is not', () => {
    const d = twoCircles();
    const [r] = suggestionsFor(d, describeFree(d, [{ kind: 'radius', id: 'e2' }]));
    const a = applySuggestion(d, r);
    expect(a.dimension).toBe(true);
    expect(a.draft.constraints.find((c) => c.id === a.id)).toMatchObject({ type: 'radius', refs: ['e2'], value: 5 });
    const h = bare([P('O', 0, 0, true), P('b', 40, 0.1)], [{ id: 'e1', type: 'line', p1: 'O', p2: 'b' }]);
    const rel = suggestionsFor(h, describeFree(h, [{ kind: 'point', id: 'b', axes: 'y' }])).find((x) => x.label === 'horizontal')!;
    expect(applySuggestion(h, rel).dimension).toBe(false);
  });
});

describe('freeParts', () => {
  it('is empty at zero degrees of freedom and when there is no verdict', async () => {
    const d = twoCircles();
    expect(await freeParts(d, null, async () => null)).toEqual([]);
    expect(await freeParts(d, status(0), async () => status(0))).toEqual([]);
  });
  it('a pin that lowers the degrees of freedom marks the part free; a stub solver with x/y behaviour gives the axes', async () => {
    // c2 free in x and y (dof 2), everything else fixed by the stub: a fix pin on c2 takes 2, a horizontal/vertical to the helper takes 1
    const d = bare([P('O', 0, 0, true), P('c2', 50, 10)], [{ id: 'e3', type: 'circle', c: 'c2', r: 7 }]);
    const solve = async (t: SketchDraft) => {
      const k = t.constraints[t.constraints.length - 1];
      if (!k) return status(3);
      if (k.type === 'fix') return status(1);
      if (k.type === 'radius') return status(2);
      if (k.type === 'horizontal') return status(2);   // pins y
      return status(3);                                // vertical: x stays free here (already determined)
    };
    expect(await freeParts(d, status(3), solve)).toEqual([{ kind: 'point', id: 'c2', axes: 'y' }, { kind: 'radius', id: 'e3' }]);
  });
});

describe('tooltipItems', () => {
  const d = bare([P('O', 0, 0, true), P('a', 10, 0), P('b', 10, 5)], [{ id: 'e1', type: 'line', p1: 'a', p2: 'b' }], [
    { id: 'k1', type: 'vertical', refs: ['e1'] }, { id: 'k2', type: 'distance', refs: ['a', 'b'], value: 5 }, { id: 'k3', type: 'hdist', refs: ['O', 'a'], value: 10 }, { id: 'k4', type: 'horizontal', refs: ['O', 'a'] },
  ], { refDims: [{ id: 'r1', type: 'distance', refs: ['a', 'b'] }] });
  it('an entity lists what names it or its points, a reference dimension last and not driving', () => {
    expect(tooltipItems(d, null, 'e1').map((i) => [i.id, i.driving])).toEqual([['k1', true], ['k2', true], ['k3', true], ['k4', true], ['r1', false]]);
  });
  it('a point lists what names it, then those of the curve it ends, with values, and the solver\'s blame', () => {
    const items = tooltipItems(d, status(1, { conflicts: ['k4'] }), 'O');
    expect(items.map((i) => i.id)).toEqual(['k3', 'k4']);
    expect(items[0].value).toBe(10);
    expect(items[1].blame).toBe('conflict');
    expect(tooltipItems(d, null, 'b').map((i) => i.id)).toEqual(['k2', 'k1', 'r1']);
  });
  it('a point with several constraints and dimensions lists every one, its own first and then those of the curve it ends', () => {
    const q = bare([P('O', 0, 0, true), P('a', 60, 0), P('b', 60, 40)], [{ id: 'e1', type: 'line', p1: 'a', p2: 'b' }], [
      { id: 'h', type: 'hdist', refs: ['O', 'a'], value: 60 }, { id: 'c', type: 'coincident', refs: ['O', 'a'] }, { id: 'v', type: 'vdist', refs: ['O', 'a'], value: 0 }, { id: 'ver', type: 'vertical', refs: ['e1'] }, { id: 'len', type: 'distance', refs: ['a', 'b'], value: 40 }, { id: 'far', type: 'radius', refs: ['zz'], value: 3 },
    ], { refDims: [{ id: 'r1', type: 'distance', refs: ['O', 'a'] }] });
    expect(tooltipItems(q, null, 'a').map((i) => i.id)).toEqual(['h', 'c', 'v', 'len', 'ver', 'r1']);
  });
  it('nothing attached gives an empty list', () => { expect(tooltipItems(d, null, 'zz')).toEqual([]); });
});

describe('effectiveMarkMode', () => {
  it('chosen on shows all; chosen off falls back to hover; unchosen is all for small sketches', () => {
    expect(effectiveMarkMode(true, 'hover', 40)).toBe('always');
    expect(effectiveMarkMode(false, 'always', 3)).toBe('hover');
    expect(effectiveMarkMode(false, 'off', 3)).toBe('off');
    expect(effectiveMarkMode(null, 'hover', 11)).toBe('always');
    expect(effectiveMarkMode(null, 'hover', 12)).toBe('hover');
    expect(effectiveMarkMode(null, 'off', 3)).toBe('off');
  });
});

describe('freedom highlight after a chip', () => {
  const it1 = { key: 'a', entityId: 'e1', partId: 'p1', role: 'start' }, it2 = { key: 'b', entityId: 'e2', partId: 'e2', role: 'radius' };
  it('clears when nothing is free and leaves a radius out of the points', () => {
    expect(freedomHighlight([])).toBeNull();
    expect(freedomHighlight([it1, it2] as never)).toEqual({ entities: ['e1', 'e2'], points: ['p1'] });
  });
  it('takes only the applied chip out of the analysis', () => {
    const s1 = { itemKey: 'a', label: 'hdist', kind: 'dimension', type: 'hdist', refs: ['o', 'p1'], value: 5 }, s2 = { ...s1, type: 'vdist', label: 'vdist' };
    const st = { items: [it1] as never, suggestions: [s1, s2] as never };
    expect(withoutSuggestion(st, s1 as never).suggestions).toEqual([s2]);
  });
});
