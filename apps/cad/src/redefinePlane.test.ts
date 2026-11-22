import { describe, expect, it } from 'vitest';
import { planeRefOf, redefinePlaneOps, redefineSelf } from './redefinePlane';

describe('redefinePlane', () => {
  it('sets the sketch plane with one edit', () => {
    expect(redefinePlaneOps('F1', { kind: 'feature', id: 'F3' })).toEqual([{ op: 'set', id: 'F1', path: 'plane', value: { kind: 'feature', id: 'F3' } }]);
  });
  it('a picked origin plane is stored by name, a face or datum plane by id', () => {
    expect(planeRefOf('top')).toEqual({ kind: 'std', id: 'top' });
    expect(planeRefOf({ kind: 'face', id: 'F2.C1' })).toEqual({ kind: 'face', id: 'F2.C1' });
  });
  it('refuses a sketch on itself but not an origin plane of the same name', () => {
    expect(redefineSelf('F1', { kind: 'feature', id: 'F1' })).toBe(true);
    expect(redefineSelf('F1', { kind: 'feature', id: 'F2' })).toBe(false);
    expect(redefineSelf('front', { kind: 'std', id: 'front' })).toBe(false);
  });
});
