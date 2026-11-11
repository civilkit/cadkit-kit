import { describe, expect, it } from 'vitest';
import { meshToStl } from '@kit/io';
import { cube, headLike } from '../../../../packages/io/src/testmesh';
import { worldBox } from './meshDoc';
import { buildRecord, guessUnit, meshNameOf, probeStl, sizeMm, unitHint } from './meshImport';

const stl = (p: Float32Array) => meshToStl({ positions: p }).data as Uint8Array;

describe('probe and import', () => {
  it('a head-like STL (about 100k triangles) imports end to end: counts, size, closed, record in the unit', () => {
    const bytes = stl(headLike(224, 224));
    const pr = probeStl(bytes);
    expect(pr.ok).toBe(true);
    if (!pr.ok) return;
    expect(pr.probe.triangles).toBeGreaterThan(99_000);
    expect(pr.probe.check.watertight).toBe(true);
    expect(pr.probe.size[2]).toBeGreaterThan(190);   // 200 mm tall
    const { rec } = buildRecord(bytes, 'head scan.stl', 'mm', [], null);
    expect(rec.name).toBe('head scan');
    expect(rec.id).toBe('mesh1');
    expect(rec.tris).toBe(pr.probe.triangles);
    expect(rec.watertight).toBe(true);
    expect(worldBox(rec).max[2]).toBeGreaterThan(95);
  });
  it('the unit scales the record; the ground option sits it at the origin', () => {
    const bytes = stl(cube(2));
    const cm = buildRecord(bytes, 'a.stl', 'cm', [], null).rec;
    expect(worldBox(cm).max).toEqual([20, 20, 20]);
    const g = buildRecord(bytes, 'a.stl', 'mm', [], 'z').rec;
    const b = worldBox(g);
    expect(b.min[2]).toBeCloseTo(0, 6);
    expect((b.min[0] + b.max[0]) / 2).toBeCloseTo(0, 6);
  });
  it('a bad file reports a code instead of throwing', () => {
    expect(probeStl(new Uint8Array(0))).toEqual({ ok: false, code: 'empty' });
    expect(probeStl(new TextEncoder().encode('solid x\nendsolid x'))).toEqual({ ok: false, code: 'noFacets' });
  });
  it('unit hints and guess', () => {
    const p = probeStl(stl(cube(0.1)));
    if (!p.ok) throw new Error('probe');
    expect(unitHint(sizeMm(p.probe, 1))?.key).toBe('mesh.import.guessSmall');
    expect(unitHint([100, 50, 20])).toBeNull();
    expect(unitHint([9000, 1, 1])?.key).toBe('mesh.import.guessLarge');
    expect(guessUnit([0.2, 0.18, 0.25])).toBe('m');
    expect(guessUnit([120, 80, 40])).toBe('mm');
  });
  it('names', () => expect(meshNameOf('C:\\scans\\Head v2.STL')).toBe('Head v2'));
});
