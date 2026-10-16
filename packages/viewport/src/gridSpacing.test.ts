import { describe, expect, it } from 'vitest';
import { adaptiveGrid, parseSpacing, GRID_MAX_PX, GRID_MIN_PX } from './gridSpacing';

describe('adaptive grid', () => {
  it('keeps the minor lines 8 to 80 px apart at every zoom', () => {
    for (let e = -4; e <= 4; e += 0.137) {
      const upp = 10 ** e;
      const px = adaptiveGrid(upp).minor / upp;
      expect(px).toBeGreaterThanOrEqual(GRID_MIN_PX);
      expect(px).toBeLessThanOrEqual(GRID_MAX_PX);
    }
  });
  it('subdivides when zooming in and merges when zooming out', () => {
    expect(adaptiveGrid(0.5).minor).toBe(10);
    expect(adaptiveGrid(0.05).minor).toBe(1);
    expect(adaptiveGrid(0.005).minor).toBeCloseTo(0.1);
    expect(adaptiveGrid(5).minor).toBe(100);
  });
  it('strong lines every 5th or 10th', () => {
    for (const upp of [0.05, 0.1, 0.2, 0.5, 1, 3]) { const g = adaptiveGrid(upp); expect([5, 10]).toContain(g.majorEvery); expect(g.major).toBeCloseTo(g.minor * g.majorEvery); }
    expect(adaptiveGrid(0.05).majorEvery).toBe(10);
  });
  it('follows the user spacing: multiples of it by 1, 2, 5 and powers of ten', () => {
    const g = adaptiveGrid(0.1, 2.5);
    const ratio = g.minor / 2.5;
    expect([1, 2, 5].some((m) => Math.abs(Math.log10(ratio / m) % 1) < 1e-6 || Math.abs(Math.log10(ratio / m) % 1 - 1) < 1e-6)).toBe(true);
    expect(g.minor / 0.1).toBeGreaterThanOrEqual(GRID_MIN_PX);
    expect(g.minor / 0.1).toBeLessThanOrEqual(GRID_MAX_PX);
    expect(adaptiveGrid(0.125, 5).minor).toBe(2.5);   // nearest to 20 px of 5 x 1, 2, 5 x 10^n
  });
});

describe('typed spacing', () => {
  it('parses numbers with an optional unit into millimetres', () => {
    expect(parseSpacing('2.5')).toBe(2.5);
    expect(parseSpacing(' 5mm ')).toBe(5);
    expect(parseSpacing('0.25 in')).toBeCloseTo(6.35);
    expect(parseSpacing('1 cm')).toBe(10);
  });
  it('rejects junk and non-positive values', () => {
    expect(parseSpacing('abc')).toBeNull();
    expect(parseSpacing('-2')).toBeNull();
    expect(parseSpacing('0')).toBeNull();
    expect(parseSpacing('')).toBeNull();
  });
});
