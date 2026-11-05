import { describe, expect, it } from 'vitest';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { bakedDoc, knurlCost, mayBeSlow, recordsInFaces, KNURL_HEAVY } from './exportKnurl';
import { DEFAULT_KNURL, knurlCosmetic } from './knurl';

const target = { axis: 'z' as const, center: [0, 0] as [number, number], radius: 10, from: 0, to: 12 };
const rec = (o = {}) => knurlCosmetic({ ...DEFAULT_KNURL, target, pattern: 'straight', count: 24, depth: 0.6, cosmetic: true, ...o });
const doc = (extra: Record<string, unknown> = {}): PartDoc => ({ ...emptyPart('Knob'), features: [{ type: 'sketch', id: 'F1' }, { type: 'extrude', id: 'F2' }], seq: 3, cosmeticKnurls: [rec()], viewCache: { x: 1 }, thumbnail: 'data:', ...extra }) as unknown as PartDoc;

describe('bakedDoc', () => {
  it('appends the cuts to a copy without the records, the stored view or the thumbnail; the original is not touched', () => {
    const d = doc();
    const b = bakedDoc(d, [rec()]) as unknown as Record<string, unknown> & { features: Array<{ id: string; type: string }>; seq: number };
    expect(b.features.length).toBeGreaterThan(2);
    expect(b.features.slice(0, 2).map((f) => f.id)).toEqual(['F1', 'F2']);
    expect(b.features.slice(2).every((f) => /^F\d+$/.test(f.id))).toBe(true);
    expect(new Set(b.features.map((f) => f.id)).size).toBe(b.features.length);
    expect(b.cosmeticKnurls).toBeUndefined();
    expect(b.viewCache).toBeUndefined();
    expect(b.thumbnail).toBeUndefined();
    expect(b.seq).toBeGreaterThan(b.features.length);
    expect(d.features).toHaveLength(2);
    expect((d as unknown as Record<string, unknown>).cosmeticKnurls).toHaveLength(1);
  });
  it('numbers several records one after the other', () => {
    const b = bakedDoc(doc(), [rec(), rec({ count: 30 })]);
    expect(new Set(b.features.map((f) => f.id)).size).toBe(b.features.length);
  });
  it('a rolled-back model keeps the features it shows and loses the marker, so the cuts land on what is shown', () => {
    const d = doc({ features: [{ type: 'sketch', id: 'F1' }, { type: 'extrude', id: 'F2' }, { type: 'extrude', id: 'F3' }], seq: 4, rollback: 'F2' });
    const b = bakedDoc(d, [rec()], 2) as unknown as { features: Array<{ id: string }>; rollback: unknown };
    expect(b.features.map((f) => f.id).slice(0, 3)).toEqual(['F1', 'F2', 'F4']);
    expect(b.rollback).toBeNull();
  });
  it('throws the helper\'s message for grooves it cannot cut', () => {
    expect(() => bakedDoc(doc(), [rec({ pattern: 'diamond', profile: 'round', count: 60, depth: 0.2, helixAngle: 45 })])).toThrow(/crossings|groove/i);
  });
});

describe('knurlCost and mayBeSlow', () => {
  it('count the cells of the pattern: grooves for straight, crossings for a diamond, grooves times rings for a pyramid', () => {
    expect(knurlCost(rec())).toBe(24);
    const d = rec({ pattern: 'diamond', profile: 'round', count: 16, depth: 0.3, helixAngle: 45 });
    expect(knurlCost(d)).toBeGreaterThan(50);
    const p = rec({ pattern: 'pyramid', count: 90, depth: 0.15 });
    expect(knurlCost(p)).toBeGreaterThan(1000);
  });
  it('warns for round diamonds and pyramids and for dense V ones, never for straight grooves', () => {
    expect(mayBeSlow([rec({ count: 500, depth: 0.1 })])).toBe(false);
    expect(mayBeSlow([rec({ pattern: 'diamond', count: 8, depth: 0.2, helixAngle: 45 })])).toBe(false);
    expect(mayBeSlow([rec({ pattern: 'diamond', count: 120, depth: 0.12, helixAngle: 45 })])).toBe(true);
    expect(mayBeSlow([rec({ pattern: 'pyramid', profile: 'round', count: 24, depth: 0.3 })])).toBe(true);
    expect(mayBeSlow([rec(), rec({ pattern: 'pyramid', count: 90, depth: 0.15 })])).toBe(true);
    expect(KNURL_HEAVY).toBeGreaterThan(24);
  });
});

describe('recordsInFaces', () => {
  const cyl = (radius: number, area: number) => ({ name: 'F2.S.e1', surface: 'cylinder', radius, area });
  it('keeps the records whose cylinder is among the faces: same radius and an area that covers the band', () => {
    const area = 2 * Math.PI * 10 * 12;
    const k = rec();
    expect(recordsInFaces([k], [cyl(10, area)])).toEqual([k]);
    expect(recordsInFaces([k], [cyl(10, area * 2)])).toEqual([k]);
    expect(recordsInFaces([k], [cyl(10, area / 2)])).toEqual([]);
    expect(recordsInFaces([k], [cyl(9, area)])).toEqual([]);
    expect(recordsInFaces([k], [{ name: 'F2.C1', surface: 'plane', area: 300 }])).toEqual([]);
    expect(recordsInFaces([k], [])).toEqual([]);
  });
});
