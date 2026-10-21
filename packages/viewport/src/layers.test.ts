import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import {
  sketchPolylines, curvePolylines, planeOutlines, axisLines,
  type Frame, type SketchLayerItem, type CurveLayerItem, type PlaneLayerItem,
} from './layers';

// The pure functions only read points/entities (or 3D pts / frames); tests build the
// minimum shape and cast, rather than full kernel features.
const asSketches = (items: unknown[]): SketchLayerItem[] => items as SketchLayerItem[];
const asCurves = (items: unknown[]): CurveLayerItem[] => items as CurveLayerItem[];
const asPlanes = (items: unknown[]): PlaneLayerItem[] => items as PlaneLayerItem[];

const FRONT: Frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const FRONT_UP: Frame = { o: [10, 20, 30], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

function expectPointClose(actual: number[], expected: number[]): void {
  expect(actual).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i++) expect(actual[i]).toBeCloseTo(expected[i], 6);
}

function expectPolylineClose(actual: number[][], expected: number[][]): void {
  expect(actual).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i++) expectPointClose(actual[i], expected[i]);
}

function sketch(entities: unknown[], points: unknown[]) {
  return {
    id: 'S1',
    frame: FRONT,
    sketch: { type: 'sketch', id: 'S1', plane: { kind: 'std', id: 'front' }, points, entities, constraints: [] },
  };
}

const pts2 = [
  { id: 'a', x: 0, y: 0 },
  { id: 'b', x: 10, y: 0 },
  { id: 'c', x: 10, y: 5 },
];

describe('layers: sketch entities to polylines', () => {
  it('a line becomes a two-point polyline', () => {
    const out = sketchPolylines(asSketches([
      { id: 'S1', frame: FRONT, sketch: { entities: [{ type: 'line', id: 'e1', p1: 'a', p2: 'b' }], points: pts2 } },
    ]));
    expect(out).toHaveLength(1);
    expect(out[0].polylines).toHaveLength(1);
    expect(out[0].polylines[0]).toEqual([[0, 0, 0], [10, 0, 0]]);
  });

  it('entities transform through the sketch frame', () => {
    const out = sketchPolylines(asSketches([
      {
        id: 'S1',
        frame: FRONT_UP,
        sketch: { entities: [{ type: 'line', id: 'e1', p1: 'a', p2: 'b' }], points: pts2 },
      },
    ]));
    expect(out[0].polylines[0]).toEqual([[10, 20, 30], [20, 20, 30]]);
  });

  it('a circle samples a closed polyline at distance r from the centre', () => {
    const out = sketchPolylines(asSketches([
      sketch([{ type: 'circle', id: 'e1', c: 'a', r: 5 }], [
        { id: 'a', x: 2, y: 3 },
      ]),
    ]));
    const line = out[0].polylines[0];
    expect(line.length).toBeGreaterThanOrEqual(48);
    const d = (p: number[]) => Math.hypot(p[0] - 2, p[1] - 3, p[2]);
    for (const p of line) expect(d(p)).toBeCloseTo(5, 6);
    // closed: first == last (up to float error)
    expectPointClose(line[0], line[line.length - 1]);
  });

  it('an arc sweeps counter-clockwise from p1 to p2', () => {
    const out = sketchPolylines(asSketches([
      sketch(
        [{ type: 'arc', id: 'e1', c: 'c', p1: 'a', p2: 'b' }],
        [
          { id: 'a', x: 10, y: 0 }, // start at angle 0
          { id: 'b', x: 0, y: 10 }, // end at angle pi/2
          { id: 'c', x: 0, y: 0 },
        ],
      ),
    ]));
    const line = out[0].polylines[0];
    expectPointClose(line[0], [10, 0, 0]);
    expectPointClose(line[line.length - 1], [0, 10, 0]);
    // every point on the circle, and the mid point is in the first quadrant (CCW)
    for (const p of line) expect(Math.hypot(p[0], p[1])).toBeCloseTo(10, 6);
    const mid = line[Math.floor(line.length / 2)];
    expect(mid[0]).toBeGreaterThan(0);
    expect(mid[1]).toBeGreaterThan(0);
  });

  it('an arc with p1 == p2 sweeps the full circle', () => {
    const out = sketchPolylines(asSketches([
      sketch(
        [{ type: 'arc', id: 'e1', c: 'c', p1: 'a', p2: 'a' }],
        [
          { id: 'a', x: 10, y: 0 },
          { id: 'c', x: 0, y: 0 },
        ],
      ),
    ]));
    const line = out[0].polylines[0];
    expect(line.length).toBeGreaterThan(2);
    expectPointClose(line[0], line[line.length - 1]);
  });

  it('an ellipse uses |p-c| as the major radius and r as the minor', () => {
    const out = sketchPolylines(asSketches([
      sketch(
        [{ type: 'ellipse', id: 'e1', c: 'c', p: 'p', r: 4 }],
        [
          { id: 'c', x: 0, y: 0 },
          { id: 'p', x: 10, y: 0 },
        ],
      ),
    ]));
    const line = out[0].polylines[0];
    expect(line.length).toBeGreaterThan(8);
    // x extents = major 10, y extents = minor 4
    const xs = line.map((p) => p[0]);
    const ys = line.map((p) => p[1]);
    expect(Math.max(...xs)).toBeCloseTo(10, 6);
    expect(Math.min(...xs)).toBeCloseTo(-10, 6);
    expect(Math.max(...ys)).toBeCloseTo(4, 6);
    expect(Math.min(...ys)).toBeCloseTo(-4, 6);
  });

  it('a spline draws its curve through the points and honours closed', () => {
    const open = sketchPolylines(asSketches([
      sketch([{ type: 'spline', id: 'e1', pts: ['a', 'b', 'c'] }], pts2),
    ]));
    const o = open[0].polylines[0];
    expect(o.length).toBeGreaterThan(3);
    expectPointClose(o[0], [0, 0, 0]);
    expectPointClose(o[o.length - 1], [10, 5, 0]);

    const closed = sketchPolylines(asSketches([
      sketch([{ type: 'spline', id: 'e1', pts: ['a', 'b', 'c'], closed: true }], pts2),
    ]));
    expectPointClose(closed[0].polylines[0][closed[0].polylines[0].length - 1], [0, 0, 0]);
  });

  it('unknown entity types are skipped, not fatal', () => {
    const out = sketchPolylines(asSketches([
      sketch(
        [{ type: 'nonsense', id: 'e1' }, { type: 'line', id: 'e2', p1: 'a', p2: 'b' }],
        pts2,
      ),
    ]));
    expect(out[0].polylines).toHaveLength(1);
  });

  it('a missing point id leaves the entity out, not fatal', () => {
    const out = sketchPolylines(asSketches([
      sketch([{ type: 'line', id: 'e1', p1: 'a', p2: 'zzz' }], pts2),
    ]));
    expect(out[0].polylines).toHaveLength(0);
  });
});

describe('layers: curves, planes, axes', () => {
  it('curve polylines pass the 3D points through', () => {
    const out = curvePolylines(asCurves([
      { id: 'F10', pts: [[0, 0, 0], [1, 2, 3], [4, 5, 6]] },
    ]));
    expect(out).toEqual([{ id: 'F10', polylines: [[[0, 0, 0], [1, 2, 3], [4, 5, 6]]] }]);
  });

  it('a plane becomes a quad outline in its own x/y axes', () => {
    const out = planeOutlines([{ id: 'F9', frame: FRONT_UP }], 10);
    expect(out).toHaveLength(1);
    const quad = out[0].quad;
    expect(quad).toHaveLength(5); // closed: 4 corners + repeat
    expectPointClose(quad[0], quad[4]);
    // all corners on the plane: same z as origin (FRONT_UP z is world z), at o ± 5x ± 5y
    const xs = quad.map((p) => p[0]);
    const ys = quad.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(10);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(10);
    for (const p of quad) expect(p[2]).toBeCloseTo(30);
  });

  it('axes are three short lines along the plane frame x, y, z', () => {
    const out = axisLines([{ id: 'F9', frame: FRONT_UP }], 10);
    expect(out).toHaveLength(3);
    expectPolylineClose(out[0], [[10, 20, 30], [20, 20, 30]]); // +x
    expectPolylineClose(out[1], [[10, 20, 30], [10, 30, 30]]); // +y
    expectPolylineClose(out[2], [[10, 20, 30], [10, 20, 40]]); // +z
  });

  it('empty inputs give empty outputs', () => {
    expect(sketchPolylines([])).toEqual([]);
    expect(curvePolylines([])).toEqual([]);
    expect(planeOutlines([], 1)).toEqual([]);
    expect(axisLines([], 1)).toEqual([]);
  });
});

// ---- kernel fixture: flangeBolt has a circle, a hex-head sketch, a helix curve and a datum plane ----
const wasm = process.env.CK_WASM;
const fixture = resolve(__dirname, '../../../../rebuild/tools/cases/flangeBolt.ckpart');

describe('layers: flangeBolt fixture', { skip: !(wasm && existsSync(fixture)) }, () => {
  it('bodyForView sketch/curve/plane data converts to polylines', async () => {
    const { Session } = await import('@ck/session');
    const doc = JSON.parse(readFileSync(fixture, 'utf8'));
    const s = await Session.open(doc);
    try {
      const v = await s.bodyForView();
      expect(v).toBeTruthy();
      expect(v!.sketches.length).toBeGreaterThanOrEqual(3); // F1, F3, F5, F10, F12
      expect(v!.curves.length).toBeGreaterThanOrEqual(1); // helix F11
      expect(v!.planes.length).toBeGreaterThanOrEqual(1); // datum F9

      const sk = sketchPolylines(v!.sketches as never);
      expect(sk.length).toBe(v!.sketches.length);
      // F1 is a circle sketch: some sketch must have a closed high-count polyline
      const closed = sk.flatMap((s) => s.polylines).filter(
        (p) => p.length >= 48 && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1], p[0][2] - p[p.length - 1][2]) < 1e-6,
      );
      expect(closed.length).toBeGreaterThanOrEqual(1);
      // every point finite
      for (const p of sk.flatMap((s) => s.polylines).flat()) {
        for (const c of p) expect(Number.isFinite(c)).toBe(true);
      }

      const cv = curvePolylines(v!.curves as never);
      expect(cv[0].polylines[0].length).toBeGreaterThan(2);

      const pl = planeOutlines(v!.planes as never, 40);
      expect(pl[0].quad).toHaveLength(5);

      const ax = axisLines(v!.planes as never, 40);
      expect(ax).toHaveLength(v!.planes.length * 3);
    } finally {
      await s.close();
    }
  }, 60_000);
});

describe('splines draw as curves, not control polygons', () => {
  const ring = (n: number, r: number) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, x: r * Math.cos((2 * Math.PI * i) / n), y: r * Math.sin((2 * Math.PI * i) / n) }));
  const frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] } as never;
  for (const type of ['spline', 'cvspline'] as const) {
    it(`a closed ${type} is sampled densely and closes on itself`, () => {
      const points = ring(6, 10);
      const sketch = { points, entities: [{ id: 'e', type, pts: points.map((p) => p.id), closed: true }] } as never;
      const line = sketchPolylines([{ id: 's', frame, sketch }])[0].polylines[0];
      expect(line.length).toBeGreaterThan(points.length + 1);   // not the 7-point polygon
      expect(Math.hypot(line[0][0] - line.at(-1)![0], line[0][1] - line.at(-1)![1])).toBeLessThan(1e-6);
    });
  }
  it('an interpolating spline passes through its points', () => {
    const points = ring(6, 10);
    const sketch = { points, entities: [{ id: 'e', type: 'spline', pts: points.map((p) => p.id), closed: true }] } as never;
    const line = sketchPolylines([{ id: 's', frame, sketch }])[0].polylines[0];
    for (const p of points) expect(line.some((q) => Math.hypot(q[0] - p.x, q[1] - p.y) < 1e-6)).toBe(true);
  });
});
