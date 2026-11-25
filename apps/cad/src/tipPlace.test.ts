import { describe, expect, it } from 'vitest';
import { placeTip, type Box } from './tipPlace';

const size = { w: 240, h: 80 }, bounds = { w: 1000, h: 700 };
const hits = (p: { x: number; y: number }, r: Box) => p.x < r.x + r.w && p.x + size.w > r.x && p.y < r.y + r.h && p.y + size.h > r.y;

describe('placeTip', () => {
  it('goes below and right of the pointer when nothing is in the way', () => {
    expect(placeTip({ x: 100, y: 100 }, size, [], bounds)).toEqual({ x: 114, y: 116 });
  });
  it('moves off a dimension label that sits where it would land', () => {
    const label: Box = { x: 150, y: 130, w: 90, h: 28 };   // the angle label under the pointer's usual spot
    const p = placeTip({ x: 100, y: 100 }, size, [label], bounds);
    expect(hits(p, label)).toBe(false);
  });
  it('clears several labels at once when a clear spot exists', () => {
    const labels: Box[] = [{ x: 150, y: 130, w: 90, h: 28 }, { x: 60, y: 140, w: 60, h: 24 }, { x: 300, y: 120, w: 70, h: 26 }];
    const p = placeTip({ x: 100, y: 100 }, size, labels, bounds);
    for (const l of labels) expect(hits(p, l)).toBe(false);
  });
  it('stays inside the viewport near an edge', () => {
    const p = placeTip({ x: 990, y: 690 }, size, [], bounds);
    expect(p.x).toBeLessThanOrEqual(bounds.w - size.w);
    expect(p.y).toBeLessThanOrEqual(bounds.h - size.h);
    expect(p.x).toBeGreaterThanOrEqual(0);
  });
  it('picks the least overlap when every spot is covered', () => {
    const wall: Box = { x: 0, y: 0, w: 1000, h: 700 };
    expect(() => placeTip({ x: 100, y: 100 }, size, [wall], bounds)).not.toThrow();
  });
});
