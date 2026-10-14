import { describe, expect, it } from 'vitest';
import type { SketchDraft } from './index';
import { annotate, constraintTargets, removeConstraintById } from './annotations';

const d = (): SketchDraft => ({
  id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [],
  points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 10, y: 0 }, { id: 'p3', x: 10, y: 6 }, { id: 'c1', x: 30, y: 0 }],
  entities: [
    { id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'line', p1: 'p2', p2: 'p3' },
    { id: 'e3', type: 'circle', c: 'c1', r: 4 },
  ],
  constraints: [
    { id: 'k1', type: 'horizontal', refs: ['e1'] },
    { id: 'k2', type: 'distance', refs: ['p1', 'p2'], value: 10 },
    { id: 'k3', type: 'radius', refs: ['e3'], value: 4 },
    { id: 'k4', type: 'angle', refs: ['e1', 'e2'], value: 90 },
    { id: 'k5', type: 'coincident', refs: ['p1', 'p2'] },
    { id: 'k6', type: 'vertical', refs: ['e2'] },
  ],
});

describe('annotate', () => {
  it('puts a dimension at the middle of what it measures, with its value', () => {
    const a = annotate(d());
    expect(a.find((x) => x.id === 'k2')).toMatchObject({ kind: 'dimension', text: '10', at: { x: 5, y: 0 }, value: 10 });
    expect(a.find((x) => x.id === 'k3')).toMatchObject({ kind: 'dimension', text: 'R4' });
    const ang = a.find((x) => x.id === 'k4')!;
    expect(ang.text).toBe('∠90°');
    expect(ang.at).toEqual({ x: 10, y: 0 });          // the corner the two lines share
  });
  it('puts a symbol for a geometric constraint on the shape it constrains', () => {
    const a = annotate(d());
    expect(a.find((x) => x.id === 'k1')).toMatchObject({ kind: 'mark', text: 'H', at: { x: 5, y: 0 } });
    expect(a.find((x) => x.id === 'k6')).toMatchObject({ kind: 'mark', text: 'V', at: { x: 10, y: 3 } });
  });
  it('does not draw coincident constraints, which are the shared points', () => {
    expect(annotate(d()).some((x) => x.type === 'coincident')).toBe(false);
  });
  it('skips constraints whose references are gone', () => {
    const draft = d();
    draft.constraints.push({ id: 'k9', type: 'distance', refs: ['nope', 'p1'], value: 3 });
    expect(annotate(draft).find((x) => x.id === 'k9')).toMatchObject({ at: { x: 0, y: 0 } });   // falls back to what exists
    draft.constraints.push({ id: 'k10', type: 'horizontal', refs: ['nope'] });
    expect(annotate(draft).find((x) => x.id === 'k10')).toBeUndefined();
  });
});

describe('constraint helpers', () => {
  it('names the entities and points a constraint refers to', () => {
    expect(constraintTargets(d(), 'k4')).toEqual({ entities: ['e1', 'e2'], points: [] });
    expect(constraintTargets(d(), 'k2')).toEqual({ entities: [], points: ['p1', 'p2'] });
    expect(constraintTargets(d(), 'nope')).toEqual({ entities: [], points: [] });
  });
  it('removes a constraint by id and nothing else', () => {
    const out = removeConstraintById(d(), 'k2');
    expect(out.constraints.map((c) => c.id)).toEqual(['k1', 'k3', 'k4', 'k5', 'k6']);
    expect(out.entities).toHaveLength(3);
  });
});

import { setConstraintValue } from './annotations';
import { pointDims, setPointDim } from './select';

describe('editing values', () => {
  it('changes a dimension value, refusing a missing constraint or a non-positive size', () => {
    const out = setConstraintValue(d(), 'k2', 25)!;
    expect(out.constraints.find((c) => c.id === 'k2')!.value).toBe(25);
    expect(setConstraintValue(d(), 'k1', 5)).toBeNull();          // no value on a horizontal
    expect(setConstraintValue(d(), 'nope', 5)).toBeNull();
    expect(setConstraintValue(d(), 'k2', -3)).toBeNull();
    expect(setConstraintValue(d(), 'k4', -45)).not.toBeNull();    // an angle may be negative
  });
  it('moves a point to a typed coordinate and dimensions it from the origin', () => {
    const draft = d();
    draft.points.unshift({ id: 'O', x: 0, y: 0, fixed: true });
    expect(pointDims(draft, 'p2').map((f) => [f.id, f.value])).toEqual([['x', 10], ['y', 0]]);
    expect(pointDims(draft, 'O')).toEqual([]);                       // the origin is fixed
    const out = setPointDim(draft, 'p2', 'x', -15)!;
    expect(out.points.find((p) => p.id === 'p2')!.x).toBe(-15);
    expect(out.constraints.find((c) => c.type === 'hdist')).toMatchObject({ refs: ['O', 'p2'], value: 15 });
    const again = setPointDim(out, 'p2', 'x', -20)!;
    expect(again.constraints.filter((c) => c.type === 'hdist')).toHaveLength(1);
    expect(setPointDim(draft, 'O', 'x', 3)).toBeNull();
  });
});
