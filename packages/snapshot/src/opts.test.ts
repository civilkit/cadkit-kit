// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { SHEET_NAMES, coerceProjection, coerceSheet } from './opts';
import { renderSnapshot } from './render';
import { snapshotOf } from './snapshotOf';
import { boxInput } from './testmesh';

describe('forgiving snapshot options', () => {
  it('sheet: true means the third-angle drawing, false the single view, a bad name lists the valid ones', () => {
    expect(coerceSheet(true)).toBe('drawing-third-angle');
    expect(coerceSheet(false)).toBe('single');
    expect(coerceSheet(undefined)).toBe('single');
    expect(coerceSheet('orthos')).toBe('orthos');
    expect(() => coerceSheet('poster')).toThrow(/valid sheets: single, orthos, drawing-third-angle, drawing-first-angle, ab, section/);
  });
  it('projection accepts orthographic / perspective as aliases', () => {
    expect(coerceProjection('orthographic')).toBe('ortho');
    expect(coerceProjection('ortho')).toBe('ortho');
    expect(coerceProjection('perspective')).toBe('persp');
    expect(coerceProjection(undefined)).toBeUndefined();
    expect(() => coerceProjection('fisheye')).toThrow(/projection/);
  });
  it('renders with sheet: true and annotate: true instead of crashing (the GAPS report)', async () => {
    const input = boxInput([0, 0, 0], [40, 20, 10]);
    const sheet = await renderSnapshot(input, { sheet: true as never, annotate: true as never, size: 256 });
    expect(sheet.meta.sheet).toBe('drawing-third-angle');
    const single = await renderSnapshot(input, { annotate: true as never, projection: 'orthographic' as never, size: 128 });
    expect(single.meta.projection).toBe('ortho');
    expect(single.width).toBeGreaterThan(0);
    const viaSession = await snapshotOf({ bodyForView: async () => ({ mesh: input.mesh, edges: input.edges ?? [], box: input.box! }) } as never, { sheet: true as never, annotate: true as never, size: 192 });
    expect(viaSession.meta.sheet).toBe('drawing-third-angle');
  });
  it('the agent tool lists the same sheets', async () => {
    const { SHEET_NAMES: toolSheets } = await import('../../agent-tools/src/tools');
    expect([...toolSheets]).toEqual([...SHEET_NAMES]);
  });
});
