import { describe, expect, it } from 'vitest';
import { underlayCorners, underlayHeight, underlayPlacement, type UnderlayShape } from './underlay';

// the front plane of a part: sketch x along world X, sketch y along world Z, normal -Y, origin at 5 mm along X
const frame = { o: [5, 0, 0], x: [1, 0, 0], y: [0, 0, 1], z: [0, -1, 0] };
const shape = (o: Partial<UnderlayShape> = {}): UnderlayShape => ({ frame, url: 'data:x', pxW: 400, pxH: 200, w: 100, x: 0, y: 0, rot: 0, opacity: 0.6, ...o });
const near = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));

describe('underlay placement', () => {
  it('the height follows the pixels', () => {
    expect(underlayHeight(400, 200, 100)).toBe(50);
    expect(underlayHeight(0, 200, 100)).toBe(100);   // an unreadable picture is a square, not a divide by zero
  });
  it('lies on the sketch plane, centred at its sketch position', () => {
    const p = underlayPlacement(shape({ x: 10, y: -4 }));
    near(p.centre, [15, 0, -4]);
    near(p.right, [1, 0, 0]);
    near(p.up, [0, 0, 1]);
    expect([p.width, p.height]).toEqual([100, 50]);
    const c = underlayCorners(shape());
    near(c[0], [-45, 0, -25]); near(c[2], [55, 0, 25]);
  });
  it('turns counter-clockwise about the normal: 90 degrees takes right to the sketch y axis', () => {
    const p = underlayPlacement(shape({ rot: 90 }));
    near(p.right, [0, 0, 1]);
    near(p.up, [-1, 0, 0]);
    const c = underlayCorners(shape({ rot: 90 }));
    near(c[0], [5 + 25, 0, -50]);   // the lower left corner after the quarter turn: (-50,-25) becomes (25,-50)
  });
});
