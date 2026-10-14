import { describe, expect, it } from 'vitest';
import { CONSTRUCTION_LAYER, DxfBuilder, dxfNum, parseDxf, sketchToDxf, viewsToDxf, type DxfEntity } from './index';

const sketch = {
  points: [
    { id: 'O', x: 0, y: 0 }, { id: 'p1', x: 10, y: 0 }, { id: 'p2', x: 10, y: 5 }, { id: 'p3', x: 0, y: 5 },
    { id: 'c', x: 5, y: 2.5 }, { id: 'a1', x: 8, y: 2.5 }, { id: 'a2', x: 5, y: 5.5 },
    { id: 's1', x: 0, y: 10 }, { id: 's2', x: 5, y: 12 }, { id: 's3', x: 10, y: 10 },
  ],
  entities: [
    { id: 'e1', type: 'line', p1: 'p1', p2: 'p2' },
    { id: 'e2', type: 'line', p1: 'p3', p2: 'O', construction: true },
    { id: 'e3', type: 'circle', c: 'c', r: 1.25 },
    { id: 'e4', type: 'arc', c: 'c', p1: 'a1', p2: 'a2' },
    { id: 'e5', type: 'spline', pts: ['s1', 's2', 's3'] },
    { id: 'e6', type: 'point', p: 'O' },
    { id: 'e7', type: 'ellipse', c: 'c', p: 'a1', r: 1 },
    { id: 'e8', type: 'mystery' },
  ],
};

describe('dxfNum', () => {
  it('uses fixed notation without trailing zeros or negative zero', () => {
    expect([1, 2.5, -0.0000001, 1e-9, 123456.789, 1 / 3, 0.1 + 0.2].map(dxfNum)).toEqual(['1', '2.5', '0', '0', '123456.789', '0.333333', '0.3']);
  });
});

describe('sketchToDxf', () => {
  const r = sketchToDxf(sketch);
  const f = parseDxf(r.text);
  const by = (t: string) => f.entities.filter((e) => e.type === t);
  it('is R12 ASCII with the sections, a layer table and an EOF', () => {
    const lines = r.text.split('\n');
    expect(lines.slice(0, 8)).toEqual(['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009']);
    expect(r.text).toMatch(/\n2\nTABLES\n/);
    expect(r.text).toMatch(/\n2\nENTITIES\n/);
    expect(r.text.trimEnd().endsWith('0\nEOF')).toBe(true);
    expect(r.text).toContain('2\nCONSTRUCTION\n70\n0\n62\n5\n6\nDASHED');
    expect(r.text).not.toContain('LWPOLYLINE');
  });
  it('counts what it wrote and what it could not', () => {
    expect(r).toMatchObject({ entities: 7, skipped: 1, construction: 1 });
  });
  it('round trips lines, circle, arc, point', () => {
    expect(f.insunits).toBe(4);
    expect(by('LINE')).toEqual([
      { type: 'LINE', layer: '0', a: { x: 10, y: 0 }, b: { x: 10, y: 5 } },
      { type: 'LINE', layer: CONSTRUCTION_LAYER, a: { x: 0, y: 5 }, b: { x: 0, y: 0 } },
    ]);
    expect(by('CIRCLE')).toEqual([{ type: 'CIRCLE', layer: '0', c: { x: 5, y: 2.5 }, r: 1.25 }]);
    const arc = by('ARC')[0] as Extract<DxfEntity, { type: 'ARC' }>;
    expect(arc).toMatchObject({ layer: '0', c: { x: 5, y: 2.5 }, r: 3 });
    expect(arc.a0).toBe(0);
    expect(arc.a1).toBeCloseTo(90, 5);   // counter-clockwise from (8, 2.5) up to (5, 5.5)
    expect(by('POINT')).toHaveLength(1);
  });
  it('writes splines and ellipses as sampled polylines through the original points', () => {
    const pl = by('POLYLINE') as Array<Extract<DxfEntity, { type: 'POLYLINE' }>>;
    expect(pl).toHaveLength(2);
    const spline = pl.find((p) => !p.closed)!;
    expect(spline.verts[0]).toMatchObject({ x: 0, y: 10 });
    expect(spline.verts.at(-1)).toMatchObject({ x: 10, y: 10 });
    expect(spline.verts.some((v) => Math.abs(v.x - 5) < 1e-4 && Math.abs(v.y - 12) < 1e-4)).toBe(true);
    const ell = pl.find((p) => p.closed)!;
    expect(ell.verts).toHaveLength(72);
    expect(Math.max(...ell.verts.map((v) => v.x))).toBeCloseTo(8, 4);
  });
  it('an arc that closes on itself becomes a circle', () => {
    const g = parseDxf(sketchToDxf({ points: [{ id: 'c', x: 0, y: 0 }, { id: 'a', x: 2, y: 0 }], entities: [{ id: 'e1', type: 'arc', c: 'c', p1: 'a', p2: 'a' }] }).text);
    expect(g.entities).toEqual([{ type: 'CIRCLE', layer: '0', c: { x: 0, y: 0 }, r: 2 }]);
  });
  it('an empty sketch is a valid file with no entities', () => {
    const e = sketchToDxf({ points: [], entities: [] });
    expect(e.entities).toBe(0);
    expect(parseDxf(e.text).entities).toEqual([]);
  });
  it('header extents cover the geometry', () => {
    const b = new DxfBuilder();
    b.line('0', { x: -3, y: 2 }, { x: 4, y: 9 });
    expect(b.toString()).toContain('9\n$EXTMIN\n10\n-3\n20\n2\n30\n0\n9\n$EXTMAX\n10\n4\n20\n9\n');
  });
});

describe('viewsToDxf', () => {
  // the 12 edges of a 40 (x) by 25 (y) by 10 (z) box with its corner at the origin
  const c = (x: number, y: number, z: number) => [x, y, z];
  const X = 40, Y = 25, Z = 10;
  const edges = [
    [c(0, 0, 0), c(X, 0, 0)], [c(0, Y, 0), c(X, Y, 0)], [c(0, 0, Z), c(X, 0, Z)], [c(0, Y, Z), c(X, Y, Z)],
    [c(0, 0, 0), c(0, Y, 0)], [c(X, 0, 0), c(X, Y, 0)], [c(0, 0, Z), c(0, Y, Z)], [c(X, 0, Z), c(X, Y, Z)],
    [c(0, 0, 0), c(0, 0, Z)], [c(X, 0, 0), c(X, 0, Z)], [c(0, Y, 0), c(0, Y, Z)], [c(X, Y, 0), c(X, Y, Z)],
  ].map((pts) => ({ pts }));
  const box = { min: [0, 0, 0], max: [X, Y, Z] };
  const r = viewsToDxf(edges, box);
  const lines = parseDxf(r.text).entities.filter((e): e is Extract<DxfEntity, { type: 'LINE' }> => e.type === 'LINE');
  it('draws each view once: 4 + 4 + 4 distinct lines for a box', () => {
    expect(r.views).toEqual(['front', 'top', 'right']);
    expect(lines).toHaveLength(12);
  });
  it('lays the views out in third-angle projection with the right sizes', () => {
    const rect = (pred: (l: typeof lines[number]) => boolean) => {
      const xs = lines.filter(pred).flatMap((l) => [l.a.x, l.b.x]), ys = lines.filter(pred).flatMap((l) => [l.a.y, l.b.y]);
      return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    };
    const front = rect((l) => l.a.y <= Y + 1e-9 && l.b.y <= Y + 1e-9 && l.a.x <= X + 1e-9 && l.b.x <= X + 1e-9);
    expect(front).toMatchObject({ w: 40, h: 25, x0: 0, y0: 0 });
    const top = rect((l) => l.a.y > Y && l.b.y > Y);
    expect(top).toMatchObject({ w: 40, h: 10, x0: 0 });
    expect(top.y0).toBeGreaterThan(Y);                 // above the front view
    const right = rect((l) => l.a.x > X && l.b.x > X);
    expect(right).toMatchObject({ w: 10, h: 25, y0: 0 });
    expect(right.x0).toBeGreaterThan(X);               // beside the front view
  });
  it('an edge seen end-on collapses to a segment and a circle edge stays a polyline', () => {
    const circle = { pts: Array.from({ length: 33 }, (_, i) => c(5 + 3 * Math.cos((i * Math.PI) / 16), 5 + 3 * Math.sin((i * Math.PI) / 16), 0)) };
    const g = parseDxf(viewsToDxf([circle], { min: [2, 2, 0], max: [8, 8, 0] }).text).entities;
    expect(g.filter((e) => e.type === 'POLYLINE')).toHaveLength(1);   // front view: the circle
    expect(g.filter((e) => e.type === 'LINE')).toHaveLength(2);        // top and right: a flat segment each
    const top = g.find((e): e is Extract<DxfEntity, { type: 'LINE' }> => e.type === 'LINE')!;
    expect(Math.hypot(top.b.x - top.a.x, top.b.y - top.a.y)).toBeCloseTo(6, 4);
  });
});
