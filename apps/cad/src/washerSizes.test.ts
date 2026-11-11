import { describe, expect, it } from 'vitest';
import { findWasherSize, WASHER_SIZES, washerLabel } from './washerSizes';

const num = (s: string): number => Number(s.slice(1));
const row = (id: string) => WASHER_SIZES.find((w) => w.id === id)!;

describe('washer size tables', () => {
  it('every row is consistent', () => {
    for (const w of WASHER_SIZES) {
      expect(w.outer, w.id).toBeGreaterThan(w.inner);
      expect(w.inner, w.id).toBeGreaterThan(0);
      expect(w.thickness, w.id).toBeGreaterThan(0);
      expect(w.thickness, w.id).toBeLessThan((w.outer - w.inner) * 2);
      expect(w.id.endsWith(w.size), w.id).toBe(true);
      expect(Number.isFinite(num(w.size)), w.id).toBe(true);
    }
  });
  it('ids are unique and rows are sorted by nominal size within a standard', () => {
    expect(new Set(WASHER_SIZES.map((w) => w.id)).size).toBe(WASHER_SIZES.length);
    const stds = [...new Set(WASHER_SIZES.map((w) => w.standard))];
    expect(stds).toEqual(['ISO 7089', 'ISO 7093-1', 'DIN 127 B']);
    for (const s of stds) {
      const rows = WASHER_SIZES.filter((w) => w.standard === s);
      expect(rows.map((w) => num(w.size))).toEqual(rows.map((w) => num(w.size)).sort((a, b) => a - b));
      // the rows of a table grow with the size
      for (let i = 1; i < rows.length; i++) { expect(rows[i].inner).toBeGreaterThanOrEqual(rows[i - 1].inner); expect(rows[i].outer).toBeGreaterThan(rows[i - 1].outer); }
    }
    expect(WASHER_SIZES.filter((w) => w.kind === 'spring').every((w) => w.standard === 'DIN 127 B')).toBe(true);
  });
  it('known values', () => {
    expect(row('iso7089-M8')).toMatchObject({ inner: 8.4, outer: 16, thickness: 1.6 });
    expect(row('iso7089-M10')).toMatchObject({ inner: 10.5, outer: 20, thickness: 2 });
    expect(row('iso7089-M12')).toMatchObject({ inner: 13, outer: 24, thickness: 2.5 });
    expect(row('iso7089-M64')).toMatchObject({ inner: 70, outer: 115, thickness: 10 });
    expect(row('iso7093-M8')).toMatchObject({ inner: 8.4, outer: 24, thickness: 2 });
    expect(row('iso7093-M12')).toMatchObject({ inner: 13, outer: 37, thickness: 3 });
    expect(row('din127b-M8')).toMatchObject({ inner: 8.1, outer: 14.8, thickness: 2 });
    expect(row('din127b-M10')).toMatchObject({ inner: 10.2, outer: 18.1, thickness: 2.2 });
  });
  it('labels and lookup', () => {
    expect(washerLabel(row('iso7089-M8'))).toBe('M8 - 8.4 x 16 x 1.6 (ISO 7089)');
    expect(findWasherSize('flat', 8.4, 16, 1.6)?.id).toBe('iso7089-M8');
    expect(findWasherSize('flat', 8.4, 16, 1.7)).toBeUndefined();
  });
});

import { CLEARANCE_MEDIUM, sizeForHole } from './washerSizes';

describe('sizeForHole (ISO 273 medium clearance)', () => {
  it('every table size has a clearance hole', () => { for (const w of WASHER_SIZES) expect(CLEARANCE_MEDIUM[w.size], w.id).toBeGreaterThan(w.size === 'M1.6' ? 1 : 0); });
  it('6.6 -> M6, 9 -> M8, 11 -> M10 in all three standards', () => {
    for (const std of ['ISO 7089', 'ISO 7093-1', 'DIN 127 B']) {
      expect(sizeForHole(std, 6.6)).toMatchObject({ fit: 'contains', size: { size: 'M6', standard: std } });
      expect(sizeForHole(std, 9)?.size.size).toBe('M8');
      expect(sizeForHole(std, 11)?.size.size).toBe('M10');
    }
  });
  it('the edge is inclusive and a hair under drops a size', () => {
    expect(sizeForHole('ISO 7089', 6.6)?.size.size).toBe('M6');
    expect(sizeForHole('ISO 7089', 6.599)?.size.size).toBe('M5');
    expect(sizeForHole('ISO 7089', 8.999)?.size.size).toBe('M6');
    expect(sizeForHole('ISO 7089', 7)?.size.size).toBe('M6');
  });
  it('a standard without the exact size steps down to one it has', () => {
    expect(sizeForHole('DIN 127 B', 2.9)?.size.size).toBe('M2');       // no M2.5 row
    expect(sizeForHole('DIN 127 B', 15.5)?.size.size).toBe('M12');     // no M14 row
    expect(sizeForHole('ISO 7093-1', 2.5)).toMatchObject({ fit: 'nearest', size: { size: 'M3' } });   // table starts at M3
  });
  it('misses: smaller than the smallest clearance hole is the nearest (smallest) size, a huge hole the largest', () => {
    expect(sizeForHole('ISO 7089', 1.2)).toMatchObject({ fit: 'nearest', size: { size: 'M1.6' } });
    expect(sizeForHole('DIN 127 B', 2)).toMatchObject({ fit: 'nearest', size: { size: 'M2' } });
    expect(sizeForHole('ISO 7089', 120)).toMatchObject({ fit: 'contains', size: { size: 'M64' } });
  });
  it('bad input and unknown standards', () => {
    expect(sizeForHole('ISO 7089', 0)).toBeNull();
    expect(sizeForHole('ISO 7089', NaN)).toBeNull();
    expect(sizeForHole('nope', 9)).toBeNull();
  });
});
