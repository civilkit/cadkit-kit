import { describe, expect, it } from 'vitest';
import { angleDeg, boxRange, closestOnSegment, faceAreaFromMesh, facePlane, lineAngleDeg, pointFace, pointPolyline, polylineLength, polylinePolyline, segSeg, type FaceMesh } from './geometry';

// one unit square face in z = 2, two triangles, plus a vertical triangle as a second face
const mesh: FaceMesh = {
  positions: [0, 0, 2, 4, 0, 2, 4, 3, 2,   0, 0, 2, 4, 3, 2, 0, 3, 2,   0, 0, 0, 1, 0, 0, 0, 0, 1],
  triFace: [0, 0, 1], faceIds: ['top', 'side'],
};

describe('vector helpers', () => {
  it('closest point on a segment clamps to the ends', () => {
    expect(closestOnSegment([5, 1, 0], [0, 0, 0], [2, 0, 0])).toEqual([2, 0, 0]);
    expect(closestOnSegment([1, 4, 0], [0, 0, 0], [2, 0, 0])).toEqual([1, 0, 0]);
  });
  it('segment to segment: skew lines, parallel lines, crossing segments, end to end', () => {
    expect(segSeg([0, 0, 0], [10, 0, 0], [5, -5, 3], [5, 5, 3]).d).toBeCloseTo(3);
    expect(segSeg([0, 0, 0], [10, 0, 0], [0, 4, 0], [10, 4, 0]).d).toBeCloseTo(4);
    expect(segSeg([0, 0, 0], [10, 0, 0], [5, -1, 0], [5, 1, 0]).d).toBeCloseTo(0);
    const c = segSeg([0, 0, 0], [1, 0, 0], [3, 4, 0], [3, 8, 0]);
    expect(c.d).toBeCloseTo(Math.hypot(2, 4)); expect(c.a).toEqual([1, 0, 0]); expect(c.b).toEqual([3, 4, 0]);
    expect(segSeg([1, 1, 1], [1, 1, 1], [4, 5, 1], [4, 5, 1]).d).toBeCloseTo(5);   // two points
  });
  it('polylines: length, point and polyline distance', () => {
    const L = [[0, 0, 0], [3, 0, 0], [3, 4, 0]];
    expect(polylineLength(L)).toBe(7);
    expect(pointPolyline([6, 4, 0], L).d).toBeCloseTo(3);
    expect(polylinePolyline(L, [[10, 0, 0], [10, 5, 0]]).d).toBeCloseTo(7);
    expect(polylinePolyline([[0, 0, 5]], L).d).toBeCloseTo(5);
  });
  it('angles: between vectors 0..180, between lines 0..90', () => {
    expect(angleDeg([1, 0, 0], [0, 1, 0])).toBeCloseTo(90);
    expect(angleDeg([1, 0, 0], [-1, 0, 0])).toBeCloseTo(180);
    expect(lineAngleDeg([1, 0, 0], [-1, 1, 0])).toBeCloseTo(45);
    expect(lineAngleDeg([1, 0, 0], [-1, 0.0, 0])).toBeCloseTo(0);
    expect(angleDeg([0, 0, 0], [1, 0, 0])).toBe(0);
  });
});

describe('face helpers', () => {
  it('area from triangles', () => { expect(faceAreaFromMesh(mesh, 'top')).toBeCloseTo(12); expect(faceAreaFromMesh(mesh, 'side')).toBeCloseTo(0.5); expect(faceAreaFromMesh(mesh, 'nope')).toBe(0); });
  it('plane of a flat face: normal, centroid, flat', () => {
    const p = facePlane(mesh, 'top')!;
    expect(p.flat).toBe(true);
    expect(p.normal[2]).toBeCloseTo(1);   // winding gives +z
    expect(p.point[2]).toBeCloseTo(2);
    expect(p.point[0]).toBeCloseTo(2); expect(p.point[1]).toBeCloseTo(1.5);
  });
  it('a bent face is not flat', () => {
    const bent: FaceMesh = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0,   1, 0, 0, 1, 1, 1, 0, 1, 0], triFace: [0, 0], faceIds: ['f'] };
    expect(facePlane(bent, 'f')!.flat).toBe(false);
  });
  it('point to face: over the face, beside it (to the edge), above a corner', () => {
    expect(pointFace([1, 1, 5], mesh, 'top')!.d).toBeCloseTo(3);
    expect(pointFace([6, 1.5, 2], mesh, 'top')!.d).toBeCloseTo(2);
    expect(pointFace([5, 4, 2], mesh, 'top')!.d).toBeCloseTo(Math.SQRT2);
    expect(pointFace([0, 0, 0], mesh, 'missing')).toBeNull();
  });
  it('box range along a direction', () => {
    expect(boxRange({ min: [0, 0, 0], max: [30, 20, 10] }, [0, 0, 1])).toEqual([0, 10]);
    expect(boxRange({ min: [-1, -2, -3], max: [1, 2, 3] }, [1, 0, 0])).toEqual([-1, 1]);
    const [lo, hi] = boxRange({ min: [0, 0, 0], max: [1, 1, 1] }, [1, 1, 0]);
    expect(lo).toBe(0); expect(hi).toBe(2);
  });
});
