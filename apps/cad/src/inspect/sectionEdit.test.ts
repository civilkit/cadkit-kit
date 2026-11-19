import { describe, expect, it } from 'vitest';
import { sketchSectionPlane, sectionChipShown } from './sectionEdit';

const feats = [
  { id: 'F1', type: 'sketch', plane: { kind: 'std', id: 'top' } },
  { id: 'F2', type: 'extrude', sketch: 'F1' },
  { id: 'F3', type: 'sketch', plane: { kind: 'face', id: 'F2.C1' } },
  { id: 'F4', type: 'extrude', sketch: 'F3' },
  { id: 'F5', type: 'shell', faces: ['F2.C1'] },
  { id: 'F6', type: 'sketch', plane: { kind: 'feature', id: 'P1' } },
];
describe('sketchSectionPlane', () => {
  it('a standard plane, a face, or nothing', () => {
    expect(sketchSectionPlane(feats, feats[1])).toEqual({ plane: 'top' });
    expect(sketchSectionPlane(feats, feats[3])).toEqual({ plane: 'face', faceId: 'F2.C1' });
    expect(sketchSectionPlane(feats, feats[4])).toBeNull();
    expect(sketchSectionPlane(feats, feats[5])).toBeNull();
    expect(sketchSectionPlane(feats, null)).toBeNull();
    expect(sketchSectionPlane(feats, { type: 'extrude', sketch: 'F9' })).toBeNull();
  });
});

describe('sectionChipShown', () => {
  const base = { sketching: false, editing: true, sectionOn: false, hasBody: true };
  it('shows for every kind of feature panel once there is a body (add, cut, shell all open the same panel)', () => {
    expect(sectionChipShown(base)).toBe(true);
  });
  it('stays while a cut is on, and never in a sketch or without a body', () => {
    expect(sectionChipShown({ ...base, editing: false, sectionOn: true })).toBe(true);
    expect(sectionChipShown({ ...base, editing: false })).toBe(false);
    expect(sectionChipShown({ ...base, sketching: true })).toBe(false);
    expect(sectionChipShown({ ...base, hasBody: false })).toBe(false);
  });
});
