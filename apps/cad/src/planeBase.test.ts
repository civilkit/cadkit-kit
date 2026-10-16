import { describe, expect, it } from 'vitest';
import { featureLabel, hasAutoName, planeBase, planeDefaultName, planeOps, refLabel } from './featureCreators';
import { renameOps } from './treeActions';
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

describe('live default names (hull film: all five rows read alike)', () => {
  const doc = (features: unknown[]) => ({ features });
  it('a generated plane name follows the current offset and base', () => {
    const p1 = { type: 'plane', id: 'P1', mode: 'offset', base: { kind: 'std', id: 'right' }, offset: -60, name: 'Plane 10 from Right', autoName: true };
    const p2 = { type: 'plane', id: 'P2', mode: 'offset', base: { kind: 'feature', id: 'P1' }, offset: 20, name: 'Plane 10 from Plane 10 from Right', autoName: true };
    const d = doc([p1, p2]);
    expect(featureLabel(d, p1 as never)).toBe('Plane -60 from Right');
    expect(featureLabel(d, p2 as never)).toBe('Plane 20 from Plane -60 from Right');
  });
  it('old documents without the flag are recognised by the shape of the name; a user name is kept', () => {
    expect(hasAutoName({ type: 'plane', name: 'Plane 10 from Right' })).toBe(true);
    expect(hasAutoName({ type: 'plane', name: 'Bulkhead' })).toBe(false);
    expect(hasAutoName({ type: 'plane', name: 'Plane 10 from Right', autoName: false })).toBe(false);
    const p = { type: 'plane', id: 'P1', mode: 'offset', base: { kind: 'std', id: 'top' }, offset: 5, name: 'Bulkhead' };
    expect(featureLabel(doc([p]), p as never)).toBe('Bulkhead');
    expect(refLabel(doc([p]), { kind: 'feature', id: 'P1' })).toBe('Bulkhead');
  });
  it('sketches are labelled live from their plane', () => {
    const p = { type: 'plane', id: 'P1', mode: 'offset', base: { kind: 'std', id: 'right' }, offset: 30, name: 'Plane 10 from Right', autoName: true };
    const s = { type: 'sketch', id: 'F2', name: 'Sketch on Plane 10 from Right', plane: { kind: 'feature', id: 'P1' } };
    expect(featureLabel(doc([p, s]), s as never)).toBe('Sketch on Plane 30 from Right');
  });
  it('a rename ends the live name', () => {
    const ops = renameOps('P1', 'Midship');
    expect(ops).toContainEqual({ op: 'set', id: 'P1', path: 'autoName', value: false });
  });
});

describe('the Plane tool reads the CURRENT tree selection (hull film: two of four planes took the previous plane)', () => {
  it('select Right -> Plane -> OK -> select Right -> Plane gives Right both times', () => {
    // tree state: the Right row chosen, no feature selected
    const first = planeOps(ctx([], { refPlane: 'right', selectedId: null }))![0] as { feature: Record<string, unknown> };
    expect(first.feature.base).toEqual({ kind: 'std', id: 'right' });
    const p1 = { ...first.feature, id: 'P1' };
    // after OK the new plane is the selected feature and the Right row is no longer chosen (main.tsx clears it); the user then picks Right again
    const second = planeOps(ctx([p1], { refPlane: 'right', selectedId: null }))![0] as { feature: Record<string, unknown> };
    expect(second.feature.base).toEqual({ kind: 'std', id: 'right' });
    expect(second.feature.name).toBe('Plane 10 from Right');
  });
  it('a selected feature wins only when no standard row is chosen', () => {
    const p1 = { type: 'plane', id: 'P1', mode: 'offset', base: { kind: 'std', id: 'right' }, offset: 5 };
    expect(planeBase(ctx([p1], { selectedId: 'P1' }))).toEqual({ kind: 'feature', id: 'P1' });
  });
});
