import { describe, expect, it } from 'vitest';
import { decimalsFor, formatCursor, formatDelta, formatLen, formatPoint3, formatSpacing, formatZoom, zoomPercent } from './sketchStatus';

describe('status text', () => {
  it('cursor coordinates in the display unit, precision following the zoom', () => {
    expect(formatCursor(232.123, -5.1, 0.1)).toBe('232.1 mm, -5.1 mm');
    expect(formatCursor(232.123, -5.1, 0.01)).toBe('232.12 mm, -5.10 mm');
    expect(formatCursor(232.4, 5.6, 1)).toBe('232 mm, 6 mm');
    expect(formatCursor(25.4, 0, 0.1, 'in')).toBe('1.000 in, 0.000 in');
  });
  it('never shows negative zero', () => { expect(formatCursor(-0.001, 0, 0.1)).toBe('0.0 mm, 0.0 mm'); });
  it('delta from the last point', () => {
    expect(formatDelta({ x: 0, y: 0 }, { x: 12, y: 3.5 }, 0.1)).toBe('dx 12.0  dy 3.5  len 12.5  angle 16°');
    expect(formatDelta({ x: 1, y: 1 }, { x: 1, y: 1 }, 0.1)).toBe('dx 0.0  dy 0.0  len 0.0  angle 0°');
    expect(formatDelta({ x: 0, y: 0 }, { x: -5, y: 0 }, 0.1)).toContain('angle 180°');
    expect(formatDelta({ x: 0, y: 0 }, { x: 0, y: -5 }, 0.1)).toContain('angle -90°');
  });
  it('zoom as a percentage of real size, and grid spacing with its unit', () => {
    expect(zoomPercent(25.4 / 96)).toBe(100);
    expect(formatZoom(25.4 / 96 / 2)).toBe('200%');
    expect(formatSpacing(10)).toBe('10 mm');
    expect(formatSpacing(0.5)).toBe('0.5 mm');
    expect(formatSpacing(25.4, 'in')).toBe('1 in');
  });
  it('decimals', () => { expect(decimalsFor(0.1)).toBe(1); expect(decimalsFor(5)).toBe(0); expect(formatLen(1.25, 1)).toBe('1.3 mm'); });
  it('model point', () => { expect(formatPoint3([1, 2.25, -3])).toBe('1.0 mm, 2.3 mm, -3.0 mm'); });
});
