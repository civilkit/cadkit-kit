import { describe, expect, it } from 'vitest';
import type { PartDoc } from '@ck/part-model';
import { asSurfaceOp, closeWithLineOp, defaultThickness, openProfile, patchThin, patchThinOn, profileSize, thinOf } from './thinRules';

type Wire = Record<string, unknown>;
const doc = (...features: Wire[]): PartDoc => ({ format: 'ck-part', version: 1, name: 't', features, seq: 9 }) as unknown as PartDoc;

/** A C: three lines whose loose ends are 4 apart. */
const cSketch = (gap = 4): Wire => ({
  type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' },
  points: [{ id: 'a', x: 20, y: 0 }, { id: 'b', x: 0, y: 0 }, { id: 'c', x: 0, y: 40 }, { id: 'd', x: 20, y: 40 }, { id: 'g', x: 20, y: gap }],
  entities: [{ type: 'line', id: 'e1', p1: 'a', p2: 'b' }, { type: 'line', id: 'e2', p1: 'b', p2: 'c' }, { type: 'line', id: 'e3', p1: 'c', p2: 'd' }, { type: 'line', id: 'e4', p1: 'd', p2: 'g' }],
  constraints: [],
});
const circle: Wire = { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'o', x: 0, y: 0 }], entities: [{ type: 'circle', id: 'e1', c: 'o', r: 10 }], constraints: [] };

/** Two arcs forming a lens with separate end points at the same places (what the script layer writes). */
const lensSketch = (): Wire => ({
  type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' },
  points: [{ id: 'c1', x: 15, y: -10 }, { id: 'a1', x: 30, y: 0 }, { id: 'b1', x: 0, y: 0 }, { id: 'c2', x: 15, y: 10 }, { id: 'a2', x: 0, y: 0 }, { id: 'b2', x: 30, y: 0 }],
  entities: [{ type: 'arc', id: 'e1', c: 'c1', p1: 'a1', p2: 'b1' }, { type: 'arc', id: 'e2', c: 'c2', p1: 'a2', p2: 'b2' }],
  constraints: [],
});

describe('thin option rules', () => {
  it('a sketch of arcs that meet at the same coordinates (separate points) is not an open profile', () => {
    expect(openProfile(doc(lensSketch()), 'F1')).toBeNull();
    const moved = lensSketch() as { points: Array<{ id: string; x: number }> };
    moved.points.find((p) => p.id === 'b2')!.x = 40;
    expect(openProfile(doc(moved as unknown as Wire), 'F1')?.closedShapes).toBe(0);
  });
  it('reads the option, with defaults, and treats enabled:false as off', () => {
    expect(thinOf({})).toBeNull();
    expect(thinOf({ thin: null })).toBeNull();
    expect(thinOf({ thin: { enabled: false, thickness: 2 } })).toBeNull();
    expect(thinOf({ thin: { thickness: 2 } })).toEqual({ thickness: 2, side: 'inside', ends: 'flat', cornerStyle: 'mitre' });
    expect(thinOf({ thin: { thickness: '=w', side: 'both', thickness2: 1, ends: 'round', cornerStyle: 'round' } })).toEqual({ thickness: '=w', side: 'both', ends: 'round', cornerStyle: 'round', thickness2: 1 });
    expect(thinOf({ thin: { thickness: 2, side: 'sideways' } })?.side).toBe('inside');
  });
  it('default thickness is 10% of the profile size, at least 1 mm', () => {
    expect(profileSize(cSketch() as never)).toBeCloseTo(Math.hypot(20, 40), 6);
    expect(defaultThickness(cSketch() as never)).toBe(4.5);                // 4.47 rounded to half a unit of its magnitude
    const tiny = { ...cSketch(), points: [{ id: 'a', x: 0, y: 0 }, { id: 'g', x: 3, y: 0 }, { id: 'b', x: 0, y: 4 }] } as Wire;
    expect(defaultThickness(tiny as never)).toBe(1);
    expect(defaultThickness(circle as never)).toBeGreaterThanOrEqual(2);   // a circle of radius 10: box 20 x 20
    expect(defaultThickness(null)).toBe(1);
  });
  it('turning thin on uses the default thickness; off removes the field; fields patch the whole option', () => {
    const d = doc(cSketch());
    const on = patchThinOn({ type: 'extrude', sketch: 'F1' }, d, true);
    expect(on).toEqual({ thin: { thickness: 4.5, side: 'inside', ends: 'flat', cornerStyle: 'mitre' } });
    expect(patchThinOn({ thin: on.thin }, d, false)).toEqual({ thin: null });
    const eff = { thin: on.thin };
    expect(patchThin(eff, 'thickness', '=2*w')).toEqual({ thin: { ...(on.thin as object), thickness: '=2*w' } });
    const both = patchThin(eff, 'side', 'both') as { thin: Wire };
    expect(both.thin.thickness2).toBe(4.5);
    const back = patchThin({ thin: both.thin }, 'side', 'mid') as { thin: Wire };
    expect(back.thin.thickness2).toBeUndefined();
  });
  it('an open sketch reports its gap and closes with one line', () => {
    const d = doc(cSketch());
    const o = openProfile(d, 'F1')!;
    expect(o.closedShapes).toBe(0);
    expect(o.gap?.distance).toBeCloseTo(4, 9);
    expect(o.gap?.near).toBe(true);
    expect(openProfile(doc(cSketch(35)), 'F1')?.gap?.near).toBe(false);
    expect(openProfile(doc(circle), 'F1')).toBeNull();
    const op = closeWithLineOp(d, 'F1') as unknown as { op: string; id: string; feature: { entities: Array<{ id: string; type: string; p1: string; p2: string }> } };
    expect(op.op).toBe('replace');
    const added = op.feature.entities.at(-1)!;
    expect(added).toMatchObject({ type: 'line', id: 'e5' });
    expect([added.p1, added.p2].sort()).toEqual(['a', 'g']);
    // the closed sketch is no longer an open profile
    expect(openProfile(doc(op.feature as unknown as Wire), 'F1')).toBeNull();
  });
  it('as surface keeps the sketch and the depth', () => {
    expect(asSurfaceOp({ type: 'extrude', id: 'F2', sketch: 'F1', op: 'add', end: 'blind', depth: 7, flip: true, thin: null })).toEqual({
      op: 'replace', id: 'F2', feature: { type: 'surfaceExtrude', id: 'F2', sketch: 'F1', end: 'blind', depth: 7, flip: true },
    });
  });
});
