import { describe, expect, it } from 'vitest';
import type { SketchDraft } from '@kit/sketch';
import { MAX_DXF_ENTITIES, dxfToSketch, mergeIntoDraft, parseDxf, sketchToDxf, type DxfImportOk } from './index';

/** Assemble a DXF from group-code pairs (arrays of [code, value]), with an optional $INSUNITS. */
const dxf = (ents: Array<Array<[number, string | number]>>, insunits?: number): string => {
  const flat = (p: Array<[number, string | number]>) => p.map(([c, v]) => `${c}\n${v}`).join('\n');
  const head = insunits === undefined ? '' : `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n${insunits}\n0\nENDSEC\n`;
  return `${head}0\nSECTION\n2\nENTITIES\n${ents.map((e) => flat(e)).join('\n')}\n0\nENDSEC\n0\nEOF\n`;
};
const line = (x1: number, y1: number, x2: number, y2: number, layer = '0'): Array<[number, string | number]> => [[0, 'LINE'], [8, layer], [10, x1], [20, y1], [30, 0], [11, x2], [21, y2], [31, 0]];
const ok = (t: string): DxfImportOk => { const r = dxfToSketch(t); if (!r.ok) throw new Error(JSON.stringify(r.error)); return r; };
const pt = (r: DxfImportOk, id: unknown) => r.points.find((p) => p.id === id)!;
/** CCW sweep in degrees of an imported arc entity. */
const sweep = (r: DxfImportOk, e: Record<string, unknown>) => {
  const c = pt(r, e.c), a = pt(r, e.p1), b = pt(r, e.p2);
  const d = (Math.atan2(b.y - c.y, b.x - c.x) - Math.atan2(a.y - c.y, a.x - c.x)) * 180 / Math.PI;
  return ((d % 360) + 360) % 360;
};

describe('dxfToSketch basics', () => {
  it('reads a line, a circle and an arc in millimetres', () => {
    const r = ok(dxf([line(0, 0, 10, 0), [[0, 'CIRCLE'], [8, '0'], [10, 5], [20, 5], [40, 2]], [[0, 'ARC'], [8, '0'], [10, 0], [20, 0], [40, 3], [50, 0], [51, 90]]]));
    expect(r.scale).toBe(1);
    expect(r.entities.map((e) => e.type)).toEqual(['line', 'circle', 'arc']);
    expect(r.entities[1]).toMatchObject({ r: 2 });
    const arc = r.entities[2];
    expect(pt(r, arc.p1)).toMatchObject({ x: 3 });
    expect(pt(r, arc.p2).y).toBeCloseTo(3, 9);
    expect(sweep(r, arc)).toBeCloseTo(90, 9);
  });
  it('shares end points that agree within 1e-6 and keeps farther ones apart', () => {
    const r = ok(dxf([line(0, 0, 10, 0), line(10 + 5e-7, 1e-7, 10, 10), line(10, 10, 0, 10), line(0, 10 + 2e-6, 0, 0)]));
    expect(r.points).toHaveLength(5);     // (0,0) (10,0) (10,10) (0,10) and (0,10.000002)
    expect(r.entities[0]).toMatchObject({ p1: 'p1', p2: 'p2' });
    expect(r.entities[1].p1).toBe('p2');
  });
  it('drops zero-length lines and counts them', () => {
    const r = ok(dxf([line(0, 0, 0, 0), line(0, 0, 1, 0)]));
    expect(r.entities).toHaveLength(1);
    expect(r.degenerate).toBe(1);
  });
  it('an arc whose angles coincide is a circle', () => {
    const r = ok(dxf([[[0, 'ARC'], [10, 0], [20, 0], [40, 3], [50, 30], [51, 30]]]));
    expect(r.entities).toEqual([{ id: 'e1', type: 'circle', c: 'p1', r: 3 }]);
  });
  it('CONSTRUCTION layer (any case) marks construction, points never are', () => {
    const r = ok(dxf([line(0, 0, 1, 0, 'construction'), line(0, 0, 0, 1, 'Part'), [[0, 'POINT'], [8, 'CONSTRUCTION'], [10, 1], [20, 1]]]));
    expect(r.entities.map((e) => e.construction)).toEqual([true, undefined, undefined]);
    expect(r.entities[2].type).toBe('point');
  });
  it('the Y axis stays the sketch v axis', () => {
    const r = ok(dxf([line(0, 0, 0, 7)]));
    expect(pt(r, r.entities[0].p2)).toMatchObject({ x: 0, y: 7 });
  });
  it('a mirrored OCS (extrusion -Z) is flipped back', () => {
    const r = ok(dxf([[[0, 'CIRCLE'], [10, 4], [20, 1], [40, 2], [210, 0], [220, 0], [230, -1]]]));
    expect(pt(r, r.entities[0].c)).toMatchObject({ x: -4, y: 1 });
    const a = ok(dxf([[[0, 'ARC'], [10, 0], [20, 0], [40, 1], [50, 10], [51, 40], [230, -1]]]));
    // 10..40 degrees seen from below is 140..170 degrees seen from above
    const e = a.entities[0];
    expect(Math.atan2(pt(a, e.p1).y, pt(a, e.p1).x) * 180 / Math.PI).toBeCloseTo(140, 6);
    expect(Math.atan2(pt(a, e.p2).y, pt(a, e.p2).x) * 180 / Math.PI).toBeCloseTo(170, 6);
  });
});

describe('units', () => {
  it.each([[1, 25.4], [5, 10], [6, 1000], [4, 1], [0, 1], [2, 304.8]])('$INSUNITS %i scales by %f', (u, k) => {
    const r = ok(dxf([line(0, 0, 2, 0)], u));
    expect(r.scale).toBe(k);
    expect(pt(r, r.entities[0].p2).x).toBeCloseTo(2 * k, 9);
    expect(r.unknownUnits).toBeNull();
  });
  it('radius and arc points scale too', () => {
    const r = ok(dxf([[[0, 'CIRCLE'], [10, 1], [20, 1], [40, 0.5]]], 1));
    expect(r.entities[0].r).toBeCloseTo(12.7, 9);
  });
  it('an unknown unit code is taken as mm and reported', () => {
    const r = ok(dxf([line(0, 0, 3, 0)], 99));
    expect(r.scale).toBe(1);
    expect(r.unknownUnits).toBe(99);
  });
});

describe('polylines', () => {
  const lw = (flags: number, verts: Array<[number, number, number?]>): Array<[number, string | number]> => [[0, 'LWPOLYLINE'], [8, '0'], [90, verts.length], [70, flags], ...verts.flatMap(([x, y, b]): Array<[number, number]> => (b ? [[10, x], [20, y], [42, b]] : [[10, x], [20, y]]))];
  it('an open polyline is a chain of lines sharing points; closed adds the closing line', () => {
    const open = ok(dxf([lw(0, [[0, 0], [10, 0], [10, 5]])]));
    expect(open.entities).toHaveLength(2);
    expect(open.points).toHaveLength(3);
    const closed = ok(dxf([lw(1, [[0, 0], [10, 0], [10, 5], [0, 5]])]));
    expect(closed.entities).toHaveLength(4);
    expect(closed.points).toHaveLength(4);
    expect(closed.entities[3]).toMatchObject({ p1: 'p4', p2: 'p1' });
  });
  it('bulge 1 is a counter-clockwise semicircle, bulge -1 the clockwise one', () => {
    const ccw = ok(dxf([lw(0, [[0, 0, 1], [10, 0]])]));
    const a = ccw.entities[0];
    expect(a.type).toBe('arc');
    expect(pt(ccw, a.c)).toMatchObject({ x: 5, y: 0 });
    expect(sweep(ccw, a)).toBeCloseTo(180, 6);
    expect(pt(ccw, a.p1)).toMatchObject({ x: 0, y: 0 });      // runs through (5, -5): below the chord
    const cw = ok(dxf([lw(0, [[0, 0, -1], [10, 0]])]));
    const b = cw.entities[0];
    expect(pt(cw, b.p1)).toMatchObject({ x: 10, y: 0 });      // same arc walked the other way, through (5, 5)
    expect(sweep(cw, b)).toBeCloseTo(180, 6);
  });
  it('a quarter arc (bulge tan(pi/8)) has its centre on the left and radius = chord / sqrt2', () => {
    const r = ok(dxf([lw(0, [[10, 0, Math.tan(Math.PI / 8)], [0, 10]])]));
    const a = r.entities[0];
    expect(pt(r, a.c).x).toBeCloseTo(0, 9);
    expect(pt(r, a.c).y).toBeCloseTo(0, 9);
    expect(sweep(r, a)).toBeCloseTo(90, 6);
  });
  it('a major arc (bulge 3, 286 degrees) puts the centre on the other side', () => {
    const r = ok(dxf([lw(0, [[0, 0, 3], [10, 0]])]));
    const a = r.entities[0];
    expect(sweep(r, a)).toBeCloseTo(4 * Math.atan(3) * 180 / Math.PI, 6);
    expect(pt(r, a.c).y).toBeLessThan(0);      // counter-clockwise from (0,0) round the long way: centre below the chord
  });
  it('a rounded rectangle (four bulged corners) closes with shared points', () => {
    const q = Math.tan(Math.PI / 8);
    const r = ok(dxf([lw(1, [[2, 0], [8, 0, q], [10, 2], [10, 8, q], [8, 10], [2, 10, q], [0, 8], [0, 2, q]])]));
    expect(r.entities.filter((e) => e.type === 'arc')).toHaveLength(4);
    expect(r.entities.filter((e) => e.type === 'line')).toHaveLength(4);
    // every end point is shared by exactly two entities, so the loop is closed
    const use = new Map<string, number>();
    for (const e of r.entities) for (const k of ['p1', 'p2'] as const) use.set(e[k] as string, (use.get(e[k] as string) ?? 0) + 1);
    expect([...use.values()].every((n) => n === 2)).toBe(true);
  });
  it('POLYLINE with VERTEX and SEQEND, closed flag and bulge', () => {
    const v = (x: number, y: number, b = 0): Array<[number, string | number]> => [[0, 'VERTEX'], [8, '0'], [10, x], [20, y], [30, 0], ...(b ? [[42, b] as [number, number]] : [])];
    const r = ok(dxf([[[0, 'POLYLINE'], [8, '0'], [66, 1], [70, 1]], v(0, 0), v(10, 0, 1), v(10, 10), [[0, 'SEQEND'], [8, '0']]].flat().reduce<Array<Array<[number, string | number]>>>((acc, p) => { acc.push([p as [number, string | number]]); return acc; }, [])));
    // (0,0)-(10,0) line, (10,0)-(10,10) bulged arc, (10,10)-(0,0) closing line
    expect(r.entities.map((e) => e.type)).toEqual(['line', 'arc', 'line']);
  });
});

describe('splines', () => {
  const spline = (flags: number, deg: number, knots: number[], ctl: Array<[number, number]>, fit: Array<[number, number]> = []): Array<[number, string | number]> => [
    [0, 'SPLINE'], [8, '0'], [70, flags], [71, deg], [72, knots.length], [73, ctl.length], [74, fit.length],
    ...knots.map((k): [number, number] => [40, k]), ...ctl.flatMap(([x, y]): Array<[number, number]> => [[10, x], [20, y], [30, 0]]), ...fit.flatMap(([x, y]): Array<[number, number]> => [[11, x], [21, y], [31, 0]]),
  ];
  it('fit points become a fit spline through shared points', () => {
    const r = ok(dxf([spline(1064, 3, [], [], [[0, 0], [5, 4], [10, 0]])]));
    expect(r.entities).toEqual([{ id: 'e1', type: 'spline', pts: ['p1', 'p2', 'p3'] }]);
  });
  it('a closed fit spline drops the repeated first point', () => {
    const r = ok(dxf([spline(1065, 3, [], [], [[0, 0], [5, 4], [10, 0], [5, -4], [0, 0]])]));
    expect(r.entities[0]).toMatchObject({ type: 'spline', closed: true });
    expect((r.entities[0].pts as string[]).length).toBe(4);
  });
  it('control points with clamped uniform knots become a cvspline of that degree', () => {
    const r = ok(dxf([spline(8, 3, [0, 0, 0, 0, 1, 2, 2, 2, 2], [[0, 0], [2, 4], [6, 4], [8, 1], [10, 0]])]));
    expect(r.entities[0]).toMatchObject({ type: 'cvspline', degree: 3 });
    expect((r.entities[0].pts as string[]).length).toBe(5);
  });
  it('other knot vectors are sampled into lines that run from the first to the last control point', () => {
    const r = ok(dxf([spline(8, 2, [0, 0, 0, 0.2, 1, 1, 1], [[0, 0], [3, 5], [7, 5], [10, 0]])]));
    expect(r.sampled).toBe(1);
    expect(r.entities.every((e) => e.type === 'line')).toBe(true);
    expect(pt(r, r.entities[0].p1)).toMatchObject({ x: 0, y: 0 });
    const last = pt(r, r.entities.at(-1)!.p2);
    expect(last.x).toBeCloseTo(10, 6);
    expect(last.y).toBeCloseTo(0, 6);
  });
});

describe('refusals and reports', () => {
  it('refuses more than 20000 entities with a count', () => {
    const many = dxf(Array.from({ length: MAX_DXF_ENTITIES + 1 }, (_, i) => line(i, 0, i + 1, 0)));
    const r = dxfToSketch(many);
    expect(r).toEqual({ ok: false, error: { code: 'tooMany', count: MAX_DXF_ENTITIES + 1, max: MAX_DXF_ENTITIES } });
  });
  it('accepts exactly 20000', () => {
    const r = dxfToSketch(dxf(Array.from({ length: MAX_DXF_ENTITIES }, (_, i) => line(i, 0, i + 1, 0))));
    expect(r.ok).toBe(true);
  });
  it('lists what it does not read, and refuses a file with nothing readable', () => {
    const t = dxf([[[0, 'TEXT'], [10, 0], [20, 0], [1, 'hi']], [[0, 'HATCH'], [8, '0']], [[0, 'TEXT'], [10, 0], [20, 0]]]);
    expect(dxfToSketch(t)).toEqual({ ok: false, error: { code: 'nothing', unsupported: { TEXT: 2, HATCH: 1 } } });
    const mixed = ok(dxf([line(0, 0, 1, 0), [[0, 'INSERT'], [2, 'BLK']]]));
    expect(mixed.unsupported).toEqual({ INSERT: 1 });
  });
  it('refuses coordinates far from the origin', () => {
    expect(dxfToSketch(dxf([line(0, 0, 5e6, 0)]))).toEqual({ ok: false, error: { code: 'range', max: 1e6 } });
    expect(dxfToSketch(dxf([line(0, 0, 3000, 0)], 6))).toEqual({ ok: false, error: { code: 'range', max: 1e6 } });   // 3 km in metres
  });
  it('binary DXF and non-DXF text are refused with a code', () => {
    expect(dxfToSketch('AutoCAD Binary DXF\r\n\x1a\0')).toMatchObject({ ok: false, error: { code: 'binary' } });
    expect(dxfToSketch('hello world\nthis is not a dxf file')).toMatchObject({ ok: false, error: { code: 'notDxf' } });
    expect(dxfToSketch('')).toMatchObject({ ok: false, error: { code: 'notDxf' } });
  });
  it('reads CRLF files and ignores the BLOCKS section', () => {
    const t = `0\r\nSECTION\r\n2\r\nBLOCKS\r\n0\r\nBLOCK\r\n0\r\nLINE\r\n10\r\n0\r\n20\r\n0\r\n11\r\n1\r\n21\r\n1\r\n0\r\nENDBLK\r\n0\r\nENDSEC\r\n` + dxf([line(0, 0, 5, 0)]).replace(/\n/g, '\r\n');
    expect(ok(t).entities).toHaveLength(1);
  });
});

describe('round trip with our own writer', () => {
  it('a sketch exported and imported again keeps its lines, circle and arc', () => {
    const sk = {
      points: [{ id: 'O', x: 0, y: 0 }, { id: 'p1', x: 10, y: 0 }, { id: 'p2', x: 10, y: 5 }, { id: 'c', x: 20, y: 20 }, { id: 'a1', x: 23, y: 20 }, { id: 'a2', x: 20, y: 23 }],
      entities: [{ id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'circle', c: 'c', r: 1.5 }, { id: 'e3', type: 'arc', c: 'c', p1: 'a1', p2: 'a2' }, { id: 'e4', type: 'line', p1: 'O', p2: 'p1', construction: true }],
    };
    const r = ok(sketchToDxf(sk).text);
    expect(r.entities.map((e) => [e.type, e.construction ?? false])).toEqual([['line', false], ['circle', false], ['arc', false], ['line', true]]);
    const arc = r.entities.find((e) => e.type === 'arc')!;
    expect(sweep(r, arc)).toBeCloseTo(90, 6);
    expect(pt(r, arc.c)).toMatchObject({ x: 20, y: 20 });
    expect(r.entities.find((e) => e.type === 'circle')!.r).toBe(1.5);
    expect(parseDxf(sketchToDxf(sk).text).entities).toHaveLength(4);
  });
});

describe('mergeIntoDraft', () => {
  const draft = (): SketchDraft => ({ id: 'F1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: 1, y: 1 }], entities: [{ id: 'e1', type: 'point', p: 'p1' }], constraints: [], temp: [] });
  it('renumbers after the draft ids and rewrites every reference', () => {
    const r = ok(dxf([line(0, 0, 10, 0), [[0, 'CIRCLE'], [10, 5], [20, 5], [40, 2]], [[0, 'SPLINE'], [70, 1064], [71, 3], [74, 3], [11, 0], [21, 0], [11, 5], [21, 3], [11, 9], [21, 0]]]));
    const d = mergeIntoDraft(draft(), r);
    expect(d.points.map((p) => p.id)).toEqual(['O', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
    expect(d.entities.map((e) => e.id)).toEqual(['e1', 'e2', 'e3', 'e4']);
    expect(d.entities[1]).toMatchObject({ type: 'line', p1: 'p2', p2: 'p3' });
    expect(d.entities[2]).toMatchObject({ type: 'circle', c: 'p4', r: 2 });
    expect(d.entities[3]).toMatchObject({ type: 'spline', pts: ['p2', 'p5', 'p6'] });
    expect(d.points[0]).toMatchObject({ fixed: true });     // existing content untouched
  });
  it('does not touch the draft it is given', () => {
    const d0 = draft();
    mergeIntoDraft(d0, ok(dxf([line(0, 0, 1, 0)])));
    expect(d0.points).toHaveLength(2);
  });
});
