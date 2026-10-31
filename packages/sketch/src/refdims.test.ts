import { describe, expect, it } from 'vitest';
import type { SketchDraft } from './index';
import { addRefDim, makeDriven, makeDriving, measureRef, refAnnotations, refDimsOf, removeDimension, removeRefDim, toggleRadiusDiameter } from './refdims';
import { fromFeature, toFeature } from './index';
import { deleteEntity } from './select';

const d0 = (): SketchDraft => ({
  id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [],
  points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 6, y: 8 }],
  entities: [{ id: 'e1', type: 'line', p1: 'a', p2: 'b' }],
  constraints: [{ id: 'k1', type: 'distance', refs: ['a', 'b'], value: 10 }],
});

describe('reference dimensions', () => {
  it('a driving dimension becomes a reference one: the constraint goes, the measurement stays', () => {
    const d = makeDriven(d0(), 'k1')!;
    expect(d.constraints).toEqual([]);
    expect(refDimsOf(d)).toEqual([{ id: 'r1', type: 'distance', refs: ['a', 'b'] }]);
    expect(measureRef(d, refDimsOf(d)[0])).toBeCloseTo(10, 9);
  });
  it('and back: the reference value is measured and becomes the constraint value', () => {
    const d = makeDriving(makeDriven(d0(), 'k1')!, 'r1')!;
    expect(d.constraints).toEqual([expect.objectContaining({ type: 'distance', refs: ['a', 'b'], value: 10 })]);
    expect(refDimsOf(d)).toEqual([]);
    expect(d.extras?.refDims).toBeUndefined();
  });
  it('measures each kind: hdist, vdist, radius, angle', () => {
    let d: SketchDraft = { ...d0(), points: [...d0().points, { id: 'c', x: 0, y: 5 }, { id: 'o', x: 20, y: 20 }], entities: [...d0().entities, { id: 'e2', type: 'line', p1: 'a', p2: 'c' }, { id: 'e3', type: 'circle', c: 'o', r: 3 }] };
    d = addRefDim(addRefDim(addRefDim(addRefDim(d, 'hdist', ['a', 'b']), 'vdist', ['a', 'b']), 'radius', ['e3']), 'angle', ['e1', 'e2']);
    const v = refDimsOf(d).map((r) => measureRef(d, r)!);
    expect(v[0]).toBeCloseTo(6, 9); expect(v[1]).toBeCloseTo(8, 9); expect(v[2]).toBeCloseTo(3, 9);
    expect(v[3]).toBeGreaterThan(0);
  });
  it('labels are bracketed and flagged driven; they do not touch the constraints and survive a feature round trip', () => {
    const d = makeDriven(d0(), 'k1')!;
    const a = refAnnotations(d);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ id: 'r1', text: '(10 mm)', driven: true, kind: 'dimension' });
    const back = fromFeature(toFeature(d));
    expect(refDimsOf(back)).toEqual(refDimsOf(d));
  });
  it('deleting an entity takes the reference dimensions that name it', () => {
    const d = makeDriven(d0(), 'k1')!;
    const gone = deleteEntity(d, 'e1');
    expect(refDimsOf(gone)).toEqual([]);
    expect(refDimsOf(deleteEntity(addRefDim(d, 'distance', ['a', 'b']), 'e1'))).toEqual([]);
  });
  it('removes one, and refuses what is not a dimension', () => {
    const d = makeDriven(d0(), 'k1')!;
    expect(refDimsOf(removeRefDim(d, 'r1'))).toEqual([]);
    expect(makeDriven({ ...d0(), constraints: [{ id: 'k1', type: 'horizontal', refs: ['e1'] }] }, 'k1')).toBeNull();
    expect(makeDriving(d0(), 'r9')).toBeNull();
  });
});

const circle = (extra: Record<string, unknown> = {}): SketchDraft => ({
  id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [],
  points: [{ id: 'o', x: 0, y: 0 }],
  entities: [{ id: 'e1', type: 'circle', c: 'o', r: 5 }],
  constraints: [{ id: 'k1', type: 'radius', refs: ['e1'], value: 5, ...extra }],
});

describe('radius and diameter', () => {
  it('a radius becomes a diameter of twice the value, and back', () => {
    const dia = toggleRadiusDiameter(circle(), 'k1')!;
    expect(dia.constraints[0]).toMatchObject({ type: 'diameter', value: 10, refs: ['e1'] });
    expect(toggleRadiusDiameter(dia, 'k1')!.constraints[0]).toMatchObject({ type: 'radius', value: 5 });
  });
  it('an expression keeps driving the same size', () => {
    const dia = toggleRadiusDiameter(circle({ expr: 'w' }), 'k1')!;
    expect(dia.constraints[0]).toMatchObject({ type: 'diameter', value: 10, expr: 'w*2' });
    expect(toggleRadiusDiameter(circle({ expr: 'a+b' }), 'k1')!.constraints[0]).toMatchObject({ expr: '(a+b)*2' });
    expect(toggleRadiusDiameter({ ...circle(), constraints: [{ id: 'k1', type: 'diameter', refs: ['e1'], value: 10, expr: 'w' }] }, 'k1')!.constraints[0]).toMatchObject({ type: 'radius', value: 5, expr: 'w/2' });
  });
  it('a reference dimension changes kind and is measured again', () => {
    const r = makeDriven(circle(), 'k1')!;
    const dia = toggleRadiusDiameter(r, 'r1')!;
    expect(refDimsOf(dia)[0].type).toBe('diameter');
    expect(measureRef(dia, refDimsOf(dia)[0])).toBeCloseTo(10, 9);
  });
  it('refuses what is not a radius or diameter, and an unknown id', () => {
    expect(toggleRadiusDiameter(d0(), 'k1')).toBeNull();
    expect(toggleRadiusDiameter(circle(), 'zz')).toBeNull();
  });
});

describe('removing a dimension', () => {
  it('takes a driving or a reference one by id', () => {
    expect(removeDimension(d0(), 'k1').constraints).toEqual([]);
    const r = makeDriven(d0(), 'k1')!;
    expect(refDimsOf(removeDimension(r, 'r1'))).toEqual([]);
  });
  it('leaves everything else alone', () => {
    const d = { ...d0(), constraints: [...d0().constraints, { id: 'k2', type: 'horizontal', refs: ['e1'] }] };
    expect(removeDimension(d, 'k1').constraints.map((c) => c.id)).toEqual(['k2']);
  });
});
