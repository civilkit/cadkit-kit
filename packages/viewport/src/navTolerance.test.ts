import { describe, expect, it } from 'vitest';
import { bodyScreenPx, isRightClick, rightClickSlop, scaledPickTol } from './navTolerance';

describe('right click slop', () => {
  it('a few pixels of jitter still opens the menu', () => {
    expect(isRightClick({ x: 100, y: 100 }, { x: 105, y: 103 }, rightClickSlop('mouse'))).toBe(true);
    expect(isRightClick({ x: 100, y: 100 }, { x: 100, y: 112 }, rightClickSlop('mouse'))).toBe(false);
  });
  it('a pen or finger gets more room than a mouse', () => { expect(rightClickSlop('pen')).toBeGreaterThan(rightClickSlop('mouse')); });
});

describe('pick tolerance follows the body size', () => {
  it('a body filling the view keeps the usual tolerance', () => { expect(scaledPickTol(10, 600)).toBe(10); });
  it('a body 100 px across (an 8 mm part seen from afar) gets a smaller one', () => {
    expect(scaledPickTol(10, 100)).toBeCloseTo(4);
    expect(scaledPickTol(10, 100)).toBeLessThan(scaledPickTol(10, 600));
  });
  it('never drops below the floor, never exceeds the base', () => {
    expect(scaledPickTol(10, 10)).toBe(2);
    expect(scaledPickTol(1, 10)).toBe(1);
  });
  it('is the same for the same body size on screen whatever the camera distance', () => {
    const a = bodyScreenPx(4, 40, 45, 800), b = bodyScreenPx(400, 4000, 45, 800);
    expect(scaledPickTol(10, a)).toBeCloseTo(scaledPickTol(10, b));
  });
});
