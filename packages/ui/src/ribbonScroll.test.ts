import { describe, it, expect } from 'vitest';
import { hiddenEdges, revealScroll, stepScroll } from './ribbonScroll';

const m = (scrollLeft: number, clientWidth = 400, scrollWidth = 1000) => ({ scrollLeft, clientWidth, scrollWidth });

describe('ribbon strip scrolling', () => {
  it('reports the edges that still hide content', () => {
    expect(hiddenEdges(m(0))).toEqual({ left: false, right: true });
    expect(hiddenEdges(m(300))).toEqual({ left: true, right: true });
    expect(hiddenEdges(m(600))).toEqual({ left: true, right: false });
    expect(hiddenEdges(m(0, 1000, 1000))).toEqual({ left: false, right: false });
    expect(hiddenEdges(m(599.4))).toEqual({ left: true, right: false });   // sub-pixel
  });
  it('reveals an item only when it is not fully inside', () => {
    expect(revealScroll(m(0), { left: 100, width: 50 })).toBeNull();
    expect(revealScroll(m(0), { left: 500, width: 50 })).toBe(162);          // right edge + pad at the strip's right
    expect(revealScroll(m(500), { left: 450, width: 50 })).toBe(438);        // left edge - pad
    expect(revealScroll(m(0), { left: 900, width: 100 })).toBe(600);         // clamped to the end
    expect(revealScroll(m(0, 100, 1000), { left: 300, width: 200 })).toBe(288);   // wider than the strip: left edge wins
  });
  it('steps one group at a time and clamps at both ends', () => {
    const starts = [0, 200, 450, 700];
    expect(stepScroll(m(0), starts, 1)).toBe(200);
    expect(stepScroll(m(200), starts, 1)).toBe(450);
    expect(stepScroll(m(450), starts, 1)).toBe(600);   // 700 clamps to the end
    expect(stepScroll(m(600), starts, 1)).toBe(600);
    expect(stepScroll(m(450), starts, -1)).toBe(200);
    expect(stepScroll(m(100), starts, -1)).toBe(0);
    expect(stepScroll(m(0), starts, -1)).toBe(0);
  });
});
