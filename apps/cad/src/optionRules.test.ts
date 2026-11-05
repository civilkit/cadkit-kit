import { describe, expect, it } from 'vitest';
import {
  FULL_ROUND_FACES, chamferTypeOf, endAllowsDraft, endAllowsTwist, filletFullRound, patchFilletFullRound, patchTwist, patchTwistCentre, twistCentreOf, endNeedsDepth, endNeedsObject, endsFor, filletProfileOf, hasOptions, managedPaths, objectRefChoices, objectRefLabel, objectRefPatch,
  objectRefValue, patchChamferType, patchDraft, patchEnd, patchFilletProfile, patchFilletVariable, patchRadii, patchStart, radiiOf, startAllowed, startOf,
} from './optionRules';
import {
  addStop, centreLineOf, centreLinePatch, connectorPatch, connectorsOf, patchStop, patchThickenAxis, patchThickenVariable, removeStop, stopsOf, thickenAxisOf, thickenVariable,
} from './surfaceRules';
import './i18n';

describe('end conditions', () => {
  it('extrude offers the five length ends and To object; the old reference ends are not offered', () => {
    expect(endsFor('extrude')).toEqual(['blind', 'mid', 'through', 'throughBoth', 'upToNext', 'toObject']);
    expect(endsFor('revolve')).toEqual(['blind', 'mid']);
    expect(endsFor('extrude').filter(endNeedsObject)).toEqual(['toObject']);
    expect(endNeedsDepth('toObject')).toBe(false);
    expect(endAllowsDraft('toObject')).toBe(true);
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
    expect(patchEnd({ depth: 4 }, 'toObject')).toMatchObject({ end: 'toObject', depth: null });
    expect(patchEnd({ endRef: 'F2.C1', endOffset: 2 }, 'blind')).toMatchObject({ endRef: null, endOffset: null });
    expect(patchEnd({ endRef: 'F2.C1', endOffset: 2 }, 'toObject')).not.toHaveProperty('endRef');   // keeps the reference it has
    // a start other than the sketch plane works with blind and To object only
    expect(patchEnd({ start: 'fromObject', startRef: 'F2.C1', startOffset: 1 }, 'mid')).toMatchObject({ start: null, startRef: null, startOffset: null });
    expect(patchEnd({ start: 'fromObject', startRef: 'F2.C1' }, 'toObject')).not.toHaveProperty('start');
    expect(['blind', 'mid', 'through', 'throughBoth', 'upToNext', 'toObject'].filter(startAllowed)).toEqual(['blind', 'toObject']);
  });
  it('the start: the sketch plane, or From object', () => {
    expect(startOf({})).toBe('sketch');
    expect(startOf({ start: 'fromObject' })).toBe('fromObject');
    expect(patchStart('fromObject')).toEqual({ start: 'fromObject' });
    expect(patchStart('sketch')).toEqual({ start: null, startRef: null, startOffset: null });
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

describe('full round, twist, loft and thicken rules', () => {
  it('full round replaces variable radius and carries three faces', () => {
    expect(filletFullRound({ filletType: 'fullRound' })).toBe(true);
    expect(patchFilletFullRound({ radius: 2 }, true)).toEqual({ filletType: 'fullRound', radii: null, profile: null, rho: null, shape: null });
    expect(patchFilletFullRound({}, false)).toEqual({ filletType: null, side1: null, center: null, side2: null });
    expect(patchFilletVariable({ radius: 2, filletType: 'fullRound' }, true)).toMatchObject({ filletType: 'variable', side1: null, center: null, side2: null });
    for (const k of FULL_ROUND_FACES) expect(managedPaths('fillet').has(k)).toBe(true);
  });
  it('twist: zero removes it with its centre, a twist drops the draft, up to next refuses it', () => {
    expect(patchTwist({}, 30)).toEqual({ twist: 30, draft: null, draftOut: null });
    expect(patchTwist({ twist: 30 }, 0)).toEqual({ twist: null, twistCentre: null });
    expect(patchTwistCentre({}, 0, 5)).toEqual({ twistCentre: [5, 0] });
    expect(patchTwistCentre({ twistCentre: [5, 0] }, 0, 0)).toEqual({ twistCentre: null });
    expect(twistCentreOf({})).toEqual([0, 0]);
    expect(patchEnd({ twist: 30, depth: 4 }, 'upToNext')).toMatchObject({ twist: null, twistCentre: null });
    expect(patchEnd({ twist: 30, depth: 4 }, 'mid')).not.toHaveProperty('twist');
    expect(endAllowsTwist('upToNext')).toBe(false);
    expect(managedPaths('extrude').has('twist') && managedPaths('extrude').has('twistCentre')).toBe(true);
  });
  it('loft centre line and connectors', () => {
    expect(centreLinePatch('F5')).toEqual({ centreLine: { sketch: 'F5' } });
    expect(centreLinePatch('')).toEqual({ centreLine: null });
    expect(centreLineOf({ centreLine: { sketch: 'F5' } })).toBe('F5');
    expect(connectorPatch({}, 3, 1, 0.25)).toEqual({ connectors: [null, 0.25, null] });
    expect(connectorPatch({ connectors: [null, 0.25, null] }, 3, 1, null)).toEqual({ connectors: null });
    expect(connectorPatch({}, 2, 0, 3)).toEqual({ connectors: [1, null] });   // clamped to the profile
    expect(connectorsOf({ connectors: [0, null] }, 3)).toEqual([0, null, null]);
    expect(managedPaths('loft').has('centreLine') && managedPaths('loft').has('connectors')).toBe(true);
  });
  it('variable thicken: ramp on and off, axis, stops between 2 and 6', () => {
    const on = patchThickenVariable({ thickness: 4 }, true);
    expect(on).toEqual({ thickness: null, thicknessAt: { along: [0, 0, 1], stops: [[0, 4], [10, 2]] } });
    const eff = { thicknessAt: (on as { thicknessAt: unknown }).thicknessAt };
    expect(thickenVariable(eff)).toBe(true);
    expect(patchThickenVariable(eff, false)).toEqual({ thicknessAt: null, thickness: 4 });
    expect(patchThickenAxis(eff, 'x')).toEqual({ thicknessAt: { along: [1, 0, 0], stops: [[0, 4], [10, 2]] } });
    expect(thickenAxisOf({ thicknessAt: { along: [1, 1, 0], stops: [] } })).toBe('custom');
    expect(patchStop(eff, 1, 1, 1)).toEqual({ thicknessAt: { along: [0, 0, 1], stops: [[0, 4], [10, 1]] } });
    expect(addStop(eff)).toEqual({ thicknessAt: { along: [0, 0, 1], stops: [[0, 4], [10, 2], [20, 2]] } });
    expect(removeStop(eff, 0)).toEqual({});   // two stops is the least
    let e = eff as Record<string, unknown>;
    for (let i = 0; i < 8; i++) e = { thicknessAt: { ...(e.thicknessAt as object), ...((addStop(e).thicknessAt as object | undefined) ?? {}) } };
    expect(stopsOf(e)).toHaveLength(6);
    expect(managedPaths('thicken').has('thicknessAt')).toBe(true);
  });
});

describe('managed fields', () => {
  it('only the forms that exist', () => {
    expect(['extrude', 'revolve', 'chamfer', 'fillet', 'shell', 'hole', 'rib', 'sweep', 'loft'].filter(hasOptions)).toEqual(['extrude', 'revolve', 'chamfer', 'fillet', 'shell', 'sweep', 'loft']);
    expect(managedPaths('shell').has('inside')).toBe(true);   // the kernel reads only `outward`; the old `inside` field is hidden
  });
});

describe('To object references', () => {
  const doc = {
    features: [
      { type: 'sketch', id: 'F1' }, { type: 'extrude', id: 'F2', op: 'newBody', body: 'Base' },
      { type: 'plane', id: 'P1', name: 'Lid' }, { type: 'extrude', id: 'F4' }, { type: 'plane', id: 'P2' },
    ],
  };
  it('the choices: the three planes, the Plane features before the feature, and the named bodies (not for a start)', () => {
    const c = objectRefChoices(doc as never, 'F4', null, true);
    expect(c.map(([v]) => v)).toEqual(['', 'std:front', 'std:top', 'std:right', 'feature:P1', 'body:Base']);
    expect(objectRefChoices(doc as never, 'F4', null, false).map(([v]) => v)).not.toContain('body:Base');
    // a picked face or point is kept at the top so the list shows it
    expect(objectRefChoices(doc as never, 'F4', { kind: 'face', id: 'F2.C1' }, true)[0]).toEqual(['picked', 'Face F2.C1']);
  });
  it('a choice becomes a reference and back', () => {
    expect(objectRefPatch('std:top')).toEqual({ kind: 'std', id: 'top' });
    expect(objectRefPatch('feature:P1')).toEqual({ kind: 'feature', id: 'P1' });
    expect(objectRefPatch('body:Base')).toEqual({ kind: 'body', name: 'Base' });
    expect(objectRefValue({ kind: 'body', name: 'Base' })).toBe('body:Base');
    expect(objectRefValue({ kind: 'std', id: 'top' })).toBe('std:top');
    expect(objectRefValue({ kind: 'face', id: 'F2.C1' })).toBe('picked');
    expect(objectRefValue(undefined)).toBe('');
  });
  it('labels say what the reference is in words', () => {
    expect(objectRefLabel(doc as never, 'F2.C1')).toBe('Face F2.C1');
    expect(objectRefLabel(doc as never, { kind: 'face', id: 'F2.C1' })).toBe('Face F2.C1');
    expect(objectRefLabel(doc as never, { kind: 'std', id: 'top' })).toBe('Top Plane');
    expect(objectRefLabel(doc as never, { kind: 'feature', id: 'P1' })).toBe('Lid');
    expect(objectRefLabel(doc as never, { kind: 'body', name: 'Base' })).toBe('Body Base');
    expect(objectRefLabel(doc as never, { kind: 'vertex', faces: ['A', 'B', 'C'], at: [1, 2, 3] })).toBe('Corner at (1, 2, 3)');
    expect(objectRefLabel(doc as never, { kind: 'sketchPoint', sketch: 'F1', point: 'p3' })).toBe('Point p3 of F1');
    expect(objectRefLabel(doc as never, null)).toBe('');
  });
});
