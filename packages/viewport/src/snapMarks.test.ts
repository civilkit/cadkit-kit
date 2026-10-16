import { describe, expect, it } from 'vitest';
import { markerColor, markerSegments, markerStyleFor, MARKER_HALF_PX, type MarkerStyle } from './snapMarks';

describe('snap glyph selection', () => {
  it('maps each sketch snap kind to its AutoCAD-style glyph', () => {
    expect(markerStyleFor({ kind: 'point', role: 'endpoint' })).toBe('point');         // square
    expect(markerStyleFor({ kind: 'point', role: 'origin' })).toBe('point');
    expect(markerStyleFor({ kind: 'point', role: 'center' })).toBe('center');          // circle
    expect(markerStyleFor({ kind: 'midpoint' })).toBe('midpoint');                     // triangle
    expect(markerStyleFor({ kind: 'quadrant' })).toBe('quadrant');                     // diamond
    expect(markerStyleFor({ kind: 'intersection' })).toBe('intersection');             // X
    expect(markerStyleFor({ kind: 'perpendicular' })).toBe('perpendicular');           // right angle
    expect(markerStyleFor({ kind: 'tangent' })).toBe('tangent');                       // circle with a tangent line
    expect(markerStyleFor({ kind: 'oncurve' })).toBe('oncurve');                       // hourglass
    expect(markerStyleFor({ kind: 'grid' })).toBe('grid');                             // small plus
    expect(markerStyleFor({ kind: 'align' })).toBe('align');
  });
  it('model snaps use the same glyphs', () => {
    expect(markerStyleFor({ kind: 'modelEndpoint', model: 'modelEndpoint' })).toBe('point');
    expect(markerStyleFor({ kind: 'modelMidpoint' })).toBe('midpoint');
    expect(markerStyleFor({ kind: 'modelCenter' })).toBe('center');
    expect(markerStyleFor({ kind: 'modelExtent' })).toBe('align');
  });
  it('draws nothing without a snap, or for a curve pick that is not a snap', () => {
    expect(markerStyleFor(undefined)).toBeNull();
    expect(markerStyleFor({ kind: 'grid', entityId: 'e1' })).toBeNull();
    expect(markerStyleFor({ kind: 'axis' })).toBeNull();
  });
});

describe('glyph geometry', () => {
  const styles: MarkerStyle[] = ['point', 'midpoint', 'align', 'center', 'quadrant', 'intersection', 'perpendicular', 'tangent', 'oncurve', 'grid', 'anchor'];
  it('every glyph has segments that stay within about 1.5 half-sizes of the snapped point', () => {
    for (const s of styles) {
      const segs = markerSegments(s, 10, -4, 2);
      expect(segs.length).toBeGreaterThan(1);
      for (const [p, q] of segs) for (const v of [p, q]) {
        expect(Math.abs(v.x - 10)).toBeLessThanOrEqual(2 * 1.5 + 1e-9);
        expect(Math.abs(v.y + 4)).toBeLessThanOrEqual(2 * 1.5 + 1e-9);
      }
    }
  });
  it('the hourglass is two triangles tip to tip and the X is two diagonals', () => {
    expect(markerSegments('oncurve', 0, 0, 1)).toHaveLength(4);
    expect(markerSegments('intersection', 0, 0, 1)).toHaveLength(2);
    expect(markerSegments('point', 0, 0, 1)).toHaveLength(4);
    expect(markerSegments('midpoint', 0, 0, 1)).toHaveLength(3);
  });
  it('is about 10 px across on screen', () => { expect(MARKER_HALF_PX * 2).toBeGreaterThanOrEqual(10); expect(MARKER_HALF_PX * 2).toBeLessThanOrEqual(12); });
});

describe('colours', () => {
  it('orange for the sketch, cyan for the model, and a different shade on dark', () => {
    const o = markerColor(false, false), od = markerColor(false, true), c = markerColor(true, false), cd = markerColor(true, true);
    expect((o >> 16) & 255).toBeGreaterThan(o & 255);   // red over blue: orange
    expect((c & 255)).toBeGreaterThan((c >> 16) & 255); // blue over red: cyan
    expect(o).not.toBe(od); expect(c).not.toBe(cd);
    // contrast: the light-background shade is darker than the dark-background shade
    const lum = (x: number) => 0.2126 * ((x >> 16) & 255) + 0.7152 * ((x >> 8) & 255) + 0.0722 * (x & 255);
    expect(lum(o)).toBeLessThan(lum(od)); expect(lum(c)).toBeLessThan(lum(cd));
  });
});
