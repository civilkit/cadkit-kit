import { describe, expect, it } from 'vitest';
import { nearestInsertSize, seatParams } from './heatSetSeat';
import { INSERT_SIZES } from '@kit/script';

describe('heat-set seat on a hole', () => {
  it('picks the size whose hole is nearest', () => {
    for (const n of Object.keys(INSERT_SIZES)) expect(nearestInsertSize(INSERT_SIZES[n].hole)).toBe(n);
    expect(nearestInsertSize(3.2)).toBe(nearestInsertSize(3.2 + 1e-9));
  });
  it('the insert goes in at the mouth, into the part: a hole on a +Z face takes it down (-Z)', () => {
    const r = seatParams({ mouth: [5, -3, 10], out: [0, 0, 1], diameter: 3.4 });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.params.origin).toEqual([5, -3, 10]); expect(r.params.axis).toBe('nz'); }
  });
  it('every face direction maps to its axis', () => {
    const want: Array<[[number, number, number], string]> = [[[0, 0, -1], 'pz'], [[1, 0, 0], 'nx'], [[-1, 0, 0], 'px'], [[0, 1, 0], 'ny'], [[0, -1, 0], 'py']];
    for (const [out, axis] of want) { const r = seatParams({ mouth: [0, 0, 0], out, diameter: 3 }); expect(r.ok && r.params.axis).toBe(axis); }
  });
  it('a narrower hole is opened up to the insert hole; a wider one is left as it is', () => {
    const narrow = seatParams({ mouth: [0, 0, 0], out: [0, 0, 1], diameter: 2 }, 'M3');
    const wide = seatParams({ mouth: [0, 0, 0], out: [0, 0, 1], diameter: 9 }, 'M3');
    expect(narrow.ok && narrow.params.hole).toBe(true);
    expect(wide.ok && wide.params.hole).toBe(false);
  });
  it('a slanted hole or no diameter is refused', () => {
    expect(seatParams({ mouth: [0, 0, 0], out: [0.7071, 0, 0.7071], diameter: 3 })).toEqual({ ok: false, reason: 'axis' });
    expect(seatParams({ mouth: [0, 0, 0], out: [0, 0, 1], diameter: 0 })).toEqual({ ok: false, reason: 'diameter' });
  });
  it('an explicit size wins over the nearest', () => {
    const r = seatParams({ mouth: [0, 0, 0], out: [0, 0, 1], diameter: 3 }, 'M5');
    expect(r.ok && r.params.size).toBe('M5');
  });
});
