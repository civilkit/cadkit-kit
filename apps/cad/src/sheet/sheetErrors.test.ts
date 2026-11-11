// A refused sheet feature shows the kernel's own reason (its `detail`) in the editor's card, with advice for the code.
import { describe, expect, it } from 'vitest';
import { adviceOf, diagnose, summaryLine } from '@kit/viewdata';
import '../i18n';

const hint = 'check the picks, the heights and the radii; see docs/sheet-metal.md';
const feats = [{ id: 'F5', type: 'sheetCut', sketch: 'S2' }, { id: 'F6', type: 'sheetCorner' }, { id: 'F7', type: 'edgeFlange' }];

describe('sheet errors in the editor card', () => {
  it('a cut that removes a panel says what the kernel says', () => {
    const d = diagnose([{ id: 'F5', code: 'sheetMetalUnsupported', params: { detail: 'the cut removes the whole panel P0', hint } }], feats);
    expect(summaryLine(d)).toContain('the cut removes the whole panel P0');
    expect(adviceOf(d.roots[0])).toMatch(/sheet tools/i);
    expect(adviceOf(d.roots[0])).not.toBe(adviceOf({ ...d.roots[0], code: 'somethingElse' }));
  });
  it('a corner next to a bend and a value out of range name their reasons', () => {
    const corner = diagnose([{ id: 'F6', code: 'sheetMetalUnsupported', params: { detail: 'the corner of panel P0 touches the bend side `e1`: round the corners of free walls', hint } }], feats);
    expect(summaryLine(corner)).toContain('touches the bend side');
    const value = diagnose([{ id: 'F6', code: 'invalidValue', params: { field: 'radius', detail: 'radius must be above 0', hint: 'x' } }], feats);
    expect(summaryLine(value)).toContain('radius must be above 0');
    expect(adviceOf(value.roots[0])).toMatch(/out of range/i);
    const low = diagnose([{ id: 'F7', code: 'flangeHeightTooLow', params: { minHeight: 6.52, detail: 'height 4 is below 6.52' } }], feats);
    expect(adviceOf(low.roots[0])).toMatch(/shorter than its bend/i);
  });
});
