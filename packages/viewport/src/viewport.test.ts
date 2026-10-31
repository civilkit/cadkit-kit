import { describe, it, expect, vi } from 'vitest';
import { Viewport } from './viewport';

describe('viewport import', () => {
  it('Viewport is a function', () => {
    expect(typeof Viewport).toBe('function');
  });
});

// The handlers are arrow fields and the class needs WebGL, so the cancel logic is run on a bare instance with just the fields it touches.
type Bare = Record<string, unknown> & { cancelGesture(): void };
const bare = (over: Record<string, unknown> = {}): Bare => {
  const v = Object.create(Viewport.prototype) as Bare;
  Object.assign(v, { down: { x: 1, y: 2 }, rubber: null, sketchDrag: null, modPan: null, midZoom: null, boxDrag: null, boxEl: null,
    controls: { enabled: false }, dom: { releasePointerCapture: vi.fn() }, opts: {} }, over);
  return v;
};

describe('cancelGesture (pointercancel, and a second finger landing)', () => {
  it('forgets the press, so the pointerup that may still come is no click, and gives the orbit controls back', () => {
    const v = bare({ sketchDrag: 'P1', modPan: { x: 0, y: 0, moved: true }, midZoom: { y: 0, id: 1 } });
    v.cancelGesture();
    expect(v.down).toBeNull();
    expect(v.sketchDrag).toBeNull();
    expect(v.modPan).toBeNull();
    expect(v.midZoom).toBeNull();
    expect((v.controls as { enabled: boolean }).enabled).toBe(true);
  });
  it('a rubber band that was drawn is cancelled for the sketch; one that never moved needs no event', () => {
    const onSketchBox = vi.fn();
    const moved = bare({ rubber: { cx: 0, cy: 0, x: 0, y: 0, moved: true }, opts: { onSketchBox } });
    moved.cancelGesture();
    expect(moved.rubber).toBeNull();
    expect(onSketchBox).toHaveBeenCalledWith(expect.objectContaining({ phase: 'cancel' }));
    onSketchBox.mockClear();
    const still = bare({ rubber: { cx: 0, cy: 0, x: 0, y: 0, moved: false }, opts: { onSketchBox } });
    still.cancelGesture();
    expect(still.rubber).toBeNull();
    expect(onSketchBox).not.toHaveBeenCalled();
  });
  it('a box select in progress is dropped with its rectangle and its pointer capture', () => {
    const remove = vi.fn(), release = vi.fn();
    const v = bare({ boxDrag: { x0: 0, y0: 0, id: 4, add: false }, boxEl: { remove }, dom: { releasePointerCapture: release } });
    v.cancelGesture();
    expect(v.boxDrag).toBeNull();
    expect(v.boxEl).toBeNull();
    expect(remove).toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith(4);
  });
  it('with nothing in progress it only makes sure the controls are on', () => {
    const v = bare({ down: null });
    expect(() => v.cancelGesture()).not.toThrow();
    expect((v.controls as { enabled: boolean }).enabled).toBe(true);
  });
});
