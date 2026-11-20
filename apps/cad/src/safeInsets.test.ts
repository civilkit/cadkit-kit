import { describe, expect, it } from 'vitest';
import { computeSafeInsets, safeCenterX, ZERO_INSETS, MIN_FREE_WIDTH, type InsetInput } from './safeInsets';

const base: InsetInput = { layout: 'desktop', width: 2000, leftPanel: null, editorCard: null, rightPanel: null };

describe('computeSafeInsets', () => {
  it('a floating left panel only: the inset is its right edge, centre at (385 + 2000) / 2', () => {
    const i = computeSafeInsets({ ...base, leftPanel: { left: 12, right: 385 } });
    expect(i).toEqual({ left: 385, right: 0, top: 0, bottom: 0 });
    expect(safeCenterX(i, 2000, 'desktop')).toBe(1192.5);
  });
  it('floating left panel plus the editor card: the card edge wins', () => {
    expect(computeSafeInsets({ ...base, leftPanel: { left: 12, right: 385 }, editorCard: { left: 413, right: 705 } }).left).toBe(705);
  });
  it('an editor card over a docked or hidden panel counts too (it floats over the canvas); no card and no floating panel is zero', () => {
    expect(computeSafeInsets({ ...base, editorCard: { left: 12, right: 304 } }).left).toBe(304);
    expect(computeSafeInsets(base)).toEqual(ZERO_INSETS);
  });
  it('docked or hidden or folded (no box given): nothing is offset, so no double offset', () => {
    expect(computeSafeInsets({ ...base, leftPanel: null })).toEqual(ZERO_INSETS);
  });
  it('a phone never offsets, even with boxes given', () => {
    expect(computeSafeInsets({ ...base, layout: 'phone', width: 400, leftPanel: { left: 0, right: 100 } })).toEqual(ZERO_INSETS);
    expect(safeCenterX(ZERO_INSETS, 400, 'phone')).toBeNull();
  });
  it('a floating right panel insets the right side; the centre is between the two', () => {
    const i = computeSafeInsets({ ...base, leftPanel: { left: 12, right: 400 }, rightPanel: { left: 1700, right: 1988 } });
    expect(i).toMatchObject({ left: 400, right: 300 });
    expect(safeCenterX(i, 2000, 'desktop')).toBe(1050);
  });
  it('a window too narrow (free width under the minimum) centres in the whole window', () => {
    expect(computeSafeInsets({ ...base, width: 600, leftPanel: { left: 12, right: 385 } })).toEqual(ZERO_INSETS);
    expect(computeSafeInsets({ ...base, width: 385 + MIN_FREE_WIDTH, leftPanel: { left: 12, right: 385 } }).left).toBe(385);
  });
  it('empty boxes and a zero width give zero', () => {
    expect(computeSafeInsets({ ...base, leftPanel: { left: 0, right: -10 } })).toEqual(ZERO_INSETS);
    expect(computeSafeInsets({ ...base, width: 0, leftPanel: { left: 0, right: 100 } })).toEqual(ZERO_INSETS);
  });
});
