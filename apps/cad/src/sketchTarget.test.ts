import { beforeEach, describe, expect, it } from 'vitest';
import { lastSketchPlane, sketchTarget } from './sketchTarget';
import { setPlaneUp, viewPlaneIds } from './planeNames';

const none = { face: null, plane: null, feature: null, last: null };

describe('sketchTarget', () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } setPlaneUp('z'); });

  it('a selected Top plane wins over the last-used Front plane (Z up: Front = xz, Top = front)', () => {
    const [frontUi, topUi] = viewPlaneIds();
    expect(frontUi).toBe('xz'); expect(topUi).toBe('front');
    expect(sketchTarget({ ...none, plane: topUi!, last: frontUi! })).toEqual({ kind: 'plane', id: 'front' });
  });
  it('a selected face wins over a plane, a plane over a plane feature, and the selection over the last plane', () => {
    expect(sketchTarget({ face: 'F2.C1', plane: 'top', feature: 'F3', last: 'xz' })).toEqual({ kind: 'face', id: 'F2.C1' });
    expect(sketchTarget({ ...none, plane: 'top', feature: 'F3', last: 'xz' })).toEqual({ kind: 'plane', id: 'top' });
    expect(sketchTarget({ ...none, feature: 'F3', last: 'xz' })).toEqual({ kind: 'feature', id: 'F3' });
  });
  it('with nothing selected it falls back to the last-used plane, and to null when there is none', () => {
    expect(sketchTarget({ ...none, last: 'yz' })).toEqual({ kind: 'last', id: 'yz' });
    expect(sketchTarget(none)).toBeNull();
    expect(sketchTarget({ ...none, last: 'bogus' })).toBeNull();
  });
  it('remembers the last plane and ignores a bad stored value', () => {
    expect(lastSketchPlane.get()).toBeNull();
    lastSketchPlane.set('xz');
    expect(lastSketchPlane.get()).toBe('xz');
    localStorage.setItem('cad.lastSketchPlane', 'nope');
    expect(lastSketchPlane.get()).toBeNull();
  });
});
