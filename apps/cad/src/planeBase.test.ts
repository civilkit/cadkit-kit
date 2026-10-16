import { describe, expect, it } from 'vitest';
import { planeBase, planeDefaultName, planeOps, refLabel } from './featureCreators';
import { planeBaseChoices, planeBasePatch, planeBaseValue } from './optionRules';
import type { Ctx } from './featureCommands';

const ctx = (features: unknown[], extra: Partial<Ctx> = {}): Ctx => ({ doc: { features } as never, selection: [], mode: 'body', box: null, edges: [], ...extra });
const feat = (c: Ctx) => (planeOps(c)![0] as { feature: Record<string, unknown> }).feature;

describe('the Plane tool takes its base from the selection', () => {
  it('defaults to Front', () => {
    expect(planeBase(ctx([]))).toEqual({ kind: 'std', id: 'front' });
    expect(feat(ctx([])).name).toBe('Plane 10 from Front');
  });
  it('a standard plane chosen in the tree', () => {
    expect(feat(ctx([], { refPlane: 'right' }))).toMatchObject({ mode: 'offset', base: { kind: 'std', id: 'right' }, name: 'Plane 10 from Right' });
    expect(planeBase(ctx([], { refPlane: 'top' }))).toEqual({ kind: 'std', id: 'top' });
  });
  it('a selected Plane feature', () => {
    const c = ctx([{ type: 'plane', id: 'P1', name: 'Mid plane', mode: 'offset', base: { kind: 'std', id: 'front' }, offset: 5 }], { selectedId: 'P1' });
    expect(feat(c)).toMatchObject({ base: { kind: 'feature', id: 'P1' }, name: 'Plane 10 from Mid plane' });
  });
  it('a picked planar face wins; two faces make a mid plane', () => {
    expect(feat(ctx([], { mode: 'face', selection: ['F1.S.f2'], refPlane: 'top' }))).toMatchObject({ base: { kind: 'face', id: 'F1.S.f2' } });
    expect(feat(ctx([], { mode: 'face', selection: ['A.f1', 'B.f2'] }))).toMatchObject({ mode: 'mid', name: 'Plane between A.f1 and B.f2' });
  });
  it('names carry the offset and base', () => {
    expect(planeDefaultName(null, { mode: 'offset', base: { kind: 'std', id: 'front' }, offset: -60 })).toBe('Plane -60 from Front');
    expect(refLabel(null, { kind: 'std', id: 'top' })).toBe('Top');
  });
});

describe('the base selector of the plane editor', () => {
  const doc = { features: [{ type: 'plane', id: 'P1', name: 'Bulkhead' }, { type: 'plane', id: 'P2' }, { type: 'plane', id: 'P3' }] };
  it('offers the standard planes and earlier plane features, never itself or later ones', () => {
    expect(planeBaseChoices(doc, 'P2', { kind: 'std', id: 'front' }).map((c) => c[0])).toEqual(['std:front', 'std:top', 'std:right', 'feature:P1']);
  });
  it('keeps a face base visible', () => {
    expect(planeBaseChoices(doc, 'P2', { kind: 'face', id: 'F1.f3' }).map((c) => c[0])).toContain('face:F1.f3');
  });
  it('round-trips value and patch', () => {
    expect(planeBaseValue({ kind: 'feature', id: 'P1' })).toBe('feature:P1');
    expect(planeBaseValue(undefined)).toBe('std:front');
    expect(planeBasePatch('std:top')).toEqual({ base: { kind: 'std', id: 'top' } });
    expect(planeBasePatch('face:F1.f3')).toEqual({ base: { kind: 'face', id: 'F1.f3' } });
  });
});
