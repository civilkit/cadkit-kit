import { describe, expect, it } from 'vitest';
import { canDetachOnDelete, detachDeleteOps, freezeBeforeSuppressOps, isDetachableFeature, makeIndependentConnectorPatch, makeIndependentPlanePatch, reattachPatch } from './frozenPose';

const F = { o: [0, 10, 0], x: [1, 0, 0], y: [0, 0, -1], z: [0, 1, 0] };

const features = [
  { id: 'F1', type: 'sketch', plane: { kind: 'std', id: 'top' } },
  { id: 'F2', type: 'extrude', sketch: 'F1', depth: 10 },
  { id: 'F3', type: 'sketch', plane: { kind: 'face', id: 'F2.C1' } },
  { id: 'F4', type: 'extrude', sketch: 'F3', depth: 5 },
  { id: 'P1', type: 'plane', mode: 'offset', base: { kind: 'face', id: 'F2.C1' }, offset: 5 },
];

describe('frozenPose', () => {
  it('identifies detachable sketches and planes', () => {
    expect(isDetachableFeature(features[0])).toBe(false); // std plane
    expect(isDetachableFeature(features[1])).toBe(false); // extrude
    expect(isDetachableFeature(features[2])).toBe(true);  // face sketch
    expect(isDetachableFeature(features[4])).toBe(true);  // offset plane
    expect(isDetachableFeature({ id: 'P2', type: 'plane', mode: 'frame' })).toBe(false);
    expect(isDetachableFeature({ id: 'C1', type: 'connector', anchor: { kind: 'face', id: 'F2.C1' } })).toBe(true);
    expect(isDetachableFeature({ id: 'C2', type: 'connector', anchor: { kind: 'std', id: 'top' } })).toBe(false);
    expect(isDetachableFeature({ id: 'C3', type: 'connector', anchor: { kind: 'frame', origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0] } })).toBe(false);
  });

  it('allows detaching when all direct dependents are sketches/planes with known frames', () => {
    const frames = new Map([['F3', F], ['P1', F]]);
    expect(canDetachOnDelete(features, ['F2'], (id) => frames.get(id))).toBe(true);
    // Deleting F1 directly blocks F2 (an extrude), which is not detachable
    expect(canDetachOnDelete(features, ['F1'], (id) => frames.get(id))).toBe(false);
    // Missing frame for P1 prevents detach
    expect(canDetachOnDelete(features, ['F2'], (id) => (id === 'F3' ? F : null))).toBe(false);
  });

  it('builds atomic detach-delete ops stamping frozenFrame before remove(detach)', () => {
    const frames = new Map([['F3', F], ['P1', F]]);
    const ops = detachDeleteOps(features, ['F2'], (id) => frames.get(id));
    expect(ops).toEqual([
      { op: 'set', id: 'F3', path: 'frozenFrame', value: F },
      { op: 'set', id: 'P1', path: 'frozenFrame', value: F },
      { op: 'remove', id: 'F2', detach: true },
    ]);
  });

  it('stamps frozenFrame onto unsuppressed dependent sketches/planes before suppress', () => {
    const frames = new Map([['F3', F], ['P1', F]]);
    const withSuppressedP1 = features.map((f) => (f.id === 'P1' ? { ...f, suppressed: true } : f));
    const ops = freezeBeforeSuppressOps(withSuppressedP1, ['F2'], (id) => frames.get(id));
    expect(ops).toEqual([{ op: 'set', id: 'F3', path: 'frozenFrame', value: F }]);
  });

  it('builds reattach and make-independent patches clearing frozenFrame', () => {
    expect(reattachPatch('plane', { kind: 'std', id: 'top' })).toEqual({ plane: { kind: 'std', id: 'top' }, frozenFrame: null });
    expect(makeIndependentPlanePatch(F)).toEqual({
      mode: 'frame',
      origin: F.o,
      xDir: F.x,
      yDir: F.y,
      base: null,
      frozenFrame: null,
    });
    expect(makeIndependentConnectorPatch(F)).toEqual({
      anchor: { kind: 'frame', origin: F.o, xDir: F.x, yDir: F.y },
      offset: null,
      rotate: null,
      flip: null,
      rotateZ: null,
      frozenFrame: null,
    });
  });
});
