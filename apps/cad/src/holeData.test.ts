import { beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  CUSTOM, DEFAULT_PREFS, ISO_SIZES, ISO_TABLE, defaultDepth, effectiveFit, holeDiameter, loadHolePrefs, newHole, patchEnd, patchFit, patchKind, patchSize, saveHolePrefs, sizeChoice,
} from './holeData';

const HOLE_RS = '/path/to/work/rebuild/crates/ck-model/src/features/hole.rs';

describe('ISO table', () => {
  // The kernel-backed comparison is in holeData.kernel.test.ts; this one needs only the source file.
  it.skipIf(!existsSync(HOLE_RS))('matches the numbers in the kernel source (hole.rs)', () => {
    const src = readFileSync(HOLE_RS, 'utf8');
    const rows = [...src.matchAll(/\("(M[\d.]+)",\s*\[([^\]]+)\]\)/g)].map((m) => [m[1], m[2].split(',').map(Number)] as const);
    expect(rows.map((r) => r[0])).toEqual(ISO_SIZES);
    for (const [name, v] of rows) {
      const r = ISO_TABLE[name];
      expect([r.tap, r.close, r.normal, r.loose, r.cboreD, r.cboreDepth, r.cskD]).toEqual(v);
    }
  });
  it('lists M2 to M24 in order', () => {
    expect(ISO_SIZES[0]).toBe('M2');
    expect(ISO_SIZES.at(-1)).toBe('M24');
    expect(ISO_TABLE.M6.normal).toBe(6.6);
  });
});

describe('holeDiameter', () => {
  it('follows size and fit', () => {
    expect(holeDiameter({ kind: 'simple', size: 'M6', fit: 'tap' })).toBe(5);
    expect(holeDiameter({ kind: 'simple', size: 'M6', fit: 'close' })).toBe(6.4);
    expect(holeDiameter({ kind: 'simple', size: 'M6', fit: 'loose' })).toBe(7);
    expect(holeDiameter({ kind: 'simple', size: 'M6' })).toBe(6.6);
  });
  it('tap is a plain hole fit only: cbore / csink treat it as normal', () => {
    expect(holeDiameter({ kind: 'cbore', size: 'M6', fit: 'tap' })).toBe(6.6);
    expect(effectiveFit('csink', 'tap')).toBe('normal');
    expect(effectiveFit('simple', 'tap')).toBe('tap');
  });
  it('a plain diameter wins on a simple hole, and an unknown size is invalid', () => {
    expect(holeDiameter({ kind: 'simple', size: 'M6', diameter: 4 })).toBe(4);
    expect(holeDiameter({ kind: 'simple', diameter: 3.25 })).toBe(3.25);
    expect(holeDiameter({ kind: 'simple', size: 'M7' })).toBeNull();
    expect(sizeChoice({ kind: 'simple', diameter: 1 })).toBe(CUSTOM);
    expect(sizeChoice({ kind: 'simple', size: 'M8' })).toBe('M8');
  });
});

describe('draft patches', () => {
  it('changing to a counterbore keeps the size, drops the plain diameter and sets the ISO 4762 dimensions', () => {
    expect(patchKind({ kind: 'simple', size: 'M8', fit: 'tap' }, 'cbore')).toEqual({ kind: 'cbore', size: 'M8', diameter: null, fit: 'normal', cboreDiameter: 15, cboreDepth: 8.6, cskDiameter: null, cskAngle: null });
  });
  it('a custom-diameter hole becomes M6 when it turns into a counterbore or countersink', () => {
    expect(patchKind({ kind: 'simple', diameter: 3 }, 'csink')).toMatchObject({ kind: 'csink', size: 'M6', diameter: null, cskDiameter: 12.4, cskAngle: 90, cboreDiameter: null });
  });
  it('back to simple removes the counterbore and countersink fields', () => {
    expect(patchKind({ kind: 'cbore', size: 'M5' }, 'simple')).toEqual({ kind: 'simple', cboreDiameter: null, cboreDepth: null, cskDiameter: null, cskAngle: null });
  });
  it('picking a size removes any plain diameter and refreshes the dimensions; custom keeps the current diameter', () => {
    expect(patchSize({ kind: 'simple', diameter: 4 }, 'M10')).toMatchObject({ size: 'M10', diameter: null, fit: 'normal' });
    expect(patchSize({ kind: 'cbore', size: 'M6' }, 'M10')).toMatchObject({ size: 'M10', cboreDiameter: 18, cboreDepth: 10.6 });
    expect(patchSize({ kind: 'simple', size: 'M6', fit: 'close' }, CUSTOM)).toEqual({ size: null, fit: null, diameter: 6.4 });
    expect(patchSize({ kind: 'cbore', size: 'M6' }, CUSTOM)).toEqual({});
  });
  it('fit and end', () => {
    expect(patchFit({ kind: 'cbore' }, 'tap')).toEqual({ fit: 'normal' });
    expect(patchFit({ kind: 'simple' }, 'tap')).toEqual({ fit: 'tap' });
    expect(patchEnd({ size: 'M6' }, 'through')).toEqual({ end: 'through' });
    expect(patchEnd({ size: 'M6' }, 'blind')).toEqual({ end: 'blind', depth: 13.2 });
    expect(patchEnd({ size: 'M6', depth: 7 }, 'blind')).toEqual({ end: 'blind' });
    expect(defaultDepth(2)).toBe(10);
  });
});

describe('new hole and remembered defaults', () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } });
  it('starts as a simple M6 normal through hole', () => {
    expect(newHole('F3', false)).toEqual({ type: 'hole', sketch: 'F3', kind: 'simple', size: 'M6', fit: 'normal', end: 'through' });
    expect(newHole('F3', true)).toMatchObject({ flip: true });
    expect(DEFAULT_PREFS).toEqual({ kind: 'simple', size: 'M6', fit: 'normal' });
  });
  it('remembers the last confirmed type, size and fit; a custom diameter is not remembered', () => {
    saveHolePrefs({ kind: 'cbore', size: 'M8', fit: 'loose' });
    expect(loadHolePrefs()).toEqual({ kind: 'cbore', size: 'M8', fit: 'loose' });
    expect(newHole('F3', false)).toMatchObject({ kind: 'cbore', size: 'M8', fit: 'loose', end: 'through', cboreDiameter: 15, cboreDepth: 8.6 });
    saveHolePrefs({ kind: 'simple', diameter: 3 });
    expect(loadHolePrefs().size).toBe('M8');
  });
  it('ignores a damaged stored value', () => {
    localStorage.setItem('kit.hole.prefs', '{"kind":"zzz","size":"M99","fit":"xx"}');
    expect(loadHolePrefs()).toEqual(DEFAULT_PREFS);
    localStorage.setItem('kit.hole.prefs', 'not json');
    expect(loadHolePrefs()).toEqual(DEFAULT_PREFS);
  });
});
