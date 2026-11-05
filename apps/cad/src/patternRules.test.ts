import { describe, expect, it } from 'vitest';
import './i18n';
import { patchDir2, patchDistanceType, toPatch, toValue } from './patternRules';
import { chainLength, pathPatternOps } from './featureCreators';
import type { Ctx } from './featureCommands';

describe('pattern rules', () => {
  it('distance types carry the span over and drop what the new type does not read', () => {
    expect(patchDistanceType({ count: 5, spacing: 15 }, '', 'extent')).toEqual({ distanceType: 'extent', extent: 60, to: null, toOffset: null });
    expect(patchDistanceType({ count: 5, distanceType: 'extent', extent: 60 }, '', 'spacing')).toEqual({ distanceType: null, extent: null, spacing: 15, to: null, toOffset: null });
    expect(patchDistanceType({ count2: 3, spacing2: 4 }, '2', 'toObject')).toEqual({ distanceType2: 'toObject', extent2: null });
  });
  it('direction 2 on and off', () => {
    expect(patchDir2({ spacing: 7 }, 'z')).toEqual({ dir2: { kind: 'axis', axis: 'z' }, count2: 2, spacing2: 7 });
    expect(patchDir2({ dir2: { kind: 'axis', axis: 'z' }, count2: 4 }, 'y')).toEqual({ dir2: { kind: 'axis', axis: 'y' } });
    expect(Object.values(patchDir2({}, ''))).toEqual(Array(8).fill(null));
  });
  it('To object values', () => {
    expect(toValue({ kind: 'feature', id: 'F3' })).toBe('feature:F3');
    expect(toValue([1, 2, 3])).toBe('point');
    expect(toValue(undefined)).toBe('');
    expect(toPatch('2', 'face:F2.S.e2', null)).toEqual({ to2: { kind: 'face', id: 'F2.S.e2' } });
    expect(toPatch('', 'point', [1, 2, 3])).toEqual({ to: [1, 2, 3] });
    expect(toPatch('', '', null)).toEqual({ to: null });
  });
});

describe('pattern on path command', () => {
  const pts = [{ id: 'a', x: 10, y: 10 }, { id: 'b', x: 50, y: 10 }, { id: 'c', x: 50, y: 50 }, { id: 'd', x: 90, y: 50 }];
  const path = { type: 'sketch', id: 'F5', points: pts, entities: [{ type: 'line', id: 'e1', p1: 'a', p2: 'b' }, { type: 'arc', id: 'e2', c: 'c', p1: 'b', p2: 'd' }] };
  it('measures a chain of lines and arcs', () => {
    expect(chainLength(path)).toBeCloseTo(40 + 20 * Math.PI, 9);
    expect(chainLength({ ...path, entities: [{ type: 'spline', id: 'e1', pts: ['a', 'b', 'c'] }] })).toBeNull();
  });
  it('repeats the last feature 3 times over the whole newest open sketch', () => {
    const doc = { features: [{ type: 'extrude', id: 'F2' }, { type: 'hole', id: 'F4' }, path] };
    const c = { doc, selection: [], mode: 'face', box: { min: [0, 0, 0], max: [100, 100, 10] }, edges: [] } as unknown as Ctx;
    expect(pathPatternOps(c)).toEqual([{ op: 'add', feature: { type: 'curvepattern', seeds: ['F4'], path: { kind: 'sketch', id: 'F5' }, count: 3, distanceType: 'extent', extent: +(40 + 20 * Math.PI).toFixed(6) } }]);
    expect(pathPatternOps({ ...c, doc: { features: doc.features.slice(0, 2) } } as unknown as Ctx)).toBeNull();
  });
});
