import { describe, expect, it } from 'vitest';
import {
  KERNEL_END_REFERENCES, chamferTypeOf, endAllowsDraft, endNeedsDepth, endsFor, filletProfileOf, hasOptions, managedPaths, patchChamferType, patchDraft, patchEnd,
  patchFilletProfile, patchFilletVariable, patchRadii, radiiOf,
} from './optionRules';

describe('end conditions', () => {
  it('extrude offers the five the kernel cuts, the reference ones only when it does', () => {
    expect(endsFor('extrude')).toEqual(['blind', 'mid', 'through', 'throughBoth', 'upToNext']);
    expect(KERNEL_END_REFERENCES).toBe(false);
    expect(endsFor('revolve')).toEqual(['blind', 'mid']);
  });
  it('depth only for blind and mid; draft not for mid or through both', () => {
    expect(['blind', 'mid', 'through', 'throughBoth', 'upToNext'].filter(endNeedsDepth)).toEqual(['blind', 'mid']);
    expect(['blind', 'mid', 'through', 'throughBoth', 'upToNext'].filter(endAllowsDraft)).toEqual(['blind', 'through', 'upToNext']);
  });
  it('patchEnd drops what the new end does not read', () => {
    expect(patchEnd({ depth: 4 }, 'through')).toMatchObject({ end: 'through', depth: null });
    expect(patchEnd({ depth: 4, draft: 3, draftOut: true }, 'mid')).toMatchObject({ end: 'mid', draft: null, draftOut: null });
    expect(patchEnd({}, 'blind')).toMatchObject({ end: 'blind', depth: 10 });
    expect(patchEnd({ depth: 7 }, 'blind').depth).toBeUndefined();   // keeps the depth it has
    expect(patchEnd({ endFace: 'F2.C1' }, 'offsetFromFace')).toMatchObject({ endOffset: 0 });
    expect(patchEnd({ endFace: 'F2.C1', endOffset: 2 }, 'upToFace')).toMatchObject({ endOffset: null, endPoint: null });
    expect(patchEnd({ endFace: 'F2.C1' }, 'blind')).toMatchObject({ endFace: null, endOffset: null, endPoint: null });
  });
  it('draft zero removes the draft fields', () => {
    expect(patchDraft({}, 5)).toEqual({ draft: 5 });
    expect(patchDraft({ draft: 5 }, 0)).toEqual({ draft: null, draftOut: null });
  });
});

describe('chamfer', () => {
  it('uses the wire names the kernel reads', () => {
    expect(chamferTypeOf({})).toBe('equal');
    expect(chamferTypeOf({ chamferType: 'angleDistance' })).toBe('equal');   // not a kernel type: shown as equal until changed
    expect(patchChamferType({ distance: 2 }, 'distances')).toEqual({ chamferType: 'distances', distance2: 2, angle: null });
    expect(patchChamferType({ distance: 2, distance2: 5 }, 'distances').distance2).toBe(5);
    expect(patchChamferType({ distance: 2 }, 'angle')).toEqual({ chamferType: 'angle', distance2: null, angle: 45 });
    expect(patchChamferType({ distance: 2, angle: 30, distance2: 1 }, 'equal')).toEqual({ chamferType: 'equal', distance2: null, angle: null });
  });
});

describe('fillet', () => {
  it('variable radius keeps the radius as the first of two', () => {
    expect(patchFilletVariable({ radius: 3 }, true)).toEqual({ filletType: 'variable', radii: [3, 3] });
    expect(patchFilletVariable({ filletType: 'variable', radii: [1, 4] }, false)).toEqual({ filletType: null, radii: null, radius: 1 });
    expect(patchRadii({ radii: [1, 2] }, 1, 6)).toEqual({ radii: [1, 6] });
    expect(radiiOf({ radius: 2 })).toEqual([2, 2]);
  });
  it('profile carries rho for conic and shape for curvature only', () => {
    expect(patchFilletProfile({}, 'conic')).toEqual({ profile: 'conic', rho: 0.5, shape: null });
    expect(patchFilletProfile({ rho: 0.3 }, 'conic').rho).toBe(0.3);
    expect(patchFilletProfile({}, 'curvature')).toEqual({ profile: 'curvature', rho: null, shape: 0.5 });
    expect(patchFilletProfile({ profile: 'chord' }, 'circular')).toEqual({ profile: null, rho: null, shape: null });
    expect(filletProfileOf({ profile: 'bogus' })).toBe('circular');
  });
});

describe('managed fields', () => {
  it('only the forms that exist', () => {
    expect(['extrude', 'revolve', 'chamfer', 'fillet', 'shell', 'hole', 'rib', 'sweep', 'loft'].filter(hasOptions)).toEqual(['extrude', 'revolve', 'chamfer', 'fillet', 'shell', 'sweep', 'loft']);
    expect(managedPaths('shell').has('inside')).toBe(true);   // the kernel reads only `outward`; the old `inside` field is hidden
  });
});
