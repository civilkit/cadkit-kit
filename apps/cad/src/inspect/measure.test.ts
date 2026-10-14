import { describe, expect, it, vi } from 'vitest';
import { copyText, fmt, measure, measureLocal, resolvePick, rowText, type EdgeInfo, type MeasureCtx } from './measure';
import { densityOf, massText, massView } from './mass';

const line = (key: string, a: number[], b: number[]): EdgeInfo => ({ key, pts: [a, b], line: true, faces: ['A', 'B'], mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] });
const edges: EdgeInfo[] = [
  line('x|y#0', [0, 0, 0], [10, 0, 0]),
  line('x|y#1', [0, 0, 5], [0, 5, 5]),
  line('x|y#2', [0, 8, 0], [10, 8, 10]),
  { key: 'c|d#3', faces: ['C', 'D'], mid: [-5, 0, 0], pts: Array.from({ length: 9 }, (_, i) => [5 * Math.cos(i * Math.PI / 4), 5 * Math.sin(i * Math.PI / 4), 0]), circle: { c: [0, 0, 0], n: [0, 0, 1], r: 5 } },
  { key: 'c|d#4', faces: ['C', 'D'], mid: [-5, 0, 7], pts: [[-5, 0, 7], [0, 5, 7]], circle: { c: [0, 0, 7], n: [0, 0, 1], r: 5 } },
];
const ctx = (kernel: MeasureCtx['kernel'] = async () => null, mesh: MeasureCtx['mesh'] = null): MeasureCtx => ({ edges, mesh, kernel });
const val = (o: { rows: Array<{ id: string; value: unknown }> }, id: string) => o.rows.find((r) => r.id === id)?.value;

describe('resolvePick', () => {
  it('knows corners, edges and faces; a missing edge is null', () => {
    expect(resolvePick('v:1,2,3', edges)).toEqual({ kind: 'vertex', name: 'v:1,2,3', p: [1, 2, 3] });
    expect(resolvePick('x|y#0', edges)).toMatchObject({ kind: 'edge' });
    expect(resolvePick('x|y#99', edges)).toBeNull();
    expect(resolvePick('F2.C0', edges)).toEqual({ kind: 'face', name: 'F2.C0' });
    expect(resolvePick('', edges)).toBeNull();
  });
});

describe('measureLocal', () => {
  const P = (n: string) => resolvePick(n, edges)!;
  it('two corners: distance, the per-axis offsets and one leader', () => {
    const o = measureLocal([P('v:0,0,0'), P('v:3,4,12')])!;
    expect(val(o, 'distance')).toBeCloseTo(13);
    expect(val(o, 'delta')).toEqual([3, 4, 12]);
    expect(o.marks).toEqual([{ a: [0, 0, 0], b: [3, 4, 12], text: '13' }]);
  });
  it('one corner is a position; one line edge its length; a full circle its radius, diameter, centre and circumference', () => {
    expect(val(measureLocal([P('v:1,2,3')])!, 'position')).toEqual([1, 2, 3]);
    expect(val(measureLocal([P('x|y#0')])!, 'length')).toBe(10);
    const c = measureLocal([P('c|d#3')])!;
    expect(val(c, 'radius')).toBe(5); expect(val(c, 'diameter')).toBe(10); expect(val(c, 'center')).toEqual([0, 0, 0]);
    expect(val(c, 'length') as number).toBeCloseTo(2 * Math.PI * 5, 9);
    expect(c.marks[0].text).toBe('R5');
  });
  it('corner to edge, edge to edge: distance and angle between straight edges', () => {
    expect(val(measureLocal([P('v:5,3,0'), P('x|y#0')])!, 'distance')).toBeCloseTo(3);
    const o = measureLocal([P('x|y#0'), P('x|y#1')])!;
    expect(val(o, 'distance')).toBeCloseTo(5);
    expect(val(o, 'angle')).toBeCloseTo(90);
    expect(val(measureLocal([P('x|y#0'), P('x|y#2')])!, 'angle')).toBeCloseTo(45);
  });
  it('two circles: centre distance and parallel axes', () => {
    const o = measureLocal([P('c|d#3'), P('c|d#4')])!;
    expect(val(o, 'centerDistance')).toBeCloseTo(7);
    expect(val(o, 'angle')).toBeCloseTo(0);
  });
  it('faces are left to the kernel', () => { expect(measureLocal([P('F1')])).toBeNull(); });
});

describe('measure with the kernel', () => {
  it('a face: area, radius and diameter, surface kind; asks with face refs', async () => {
    const kernel = vi.fn(async () => ({ items: [{ kind: 'face', surface: 'cylinder', area: 251.3, radius: 5, center: [0, 0, 0] }] }));
    const o = await measure([resolvePick('F2.S.e1', edges)!], ctx(kernel));
    expect(kernel).toHaveBeenCalledWith([{ kind: 'face', id: 'F2.S.e1' }]);
    expect(val(o, 'area')).toBe(251.3); expect(val(o, 'diameter')).toBe(10); expect(o.surface).toBe('cylinder');
  });
  it('two faces: the kernel distance and angle (radians) become mm and degrees, with a leader', async () => {
    const kernel = async () => ({ items: [{ area: 4 }, { area: 4 }], distance: 5, points: [[0, 0, 0], [0, 0, 5]], angle: Math.PI / 2, normalDistance: 5 });
    const o = await measure([resolvePick('A1', edges)!, resolvePick('A2', edges)!], ctx(kernel));
    expect(val(o, 'angle')).toBeCloseTo(90); expect(val(o, 'distance')).toBe(5); expect(val(o, 'normalDistance')).toBe(5);
    expect(o.marks).toEqual([{ a: [0, 0, 0], b: [0, 0, 5], text: '5' }]);
  });
  it('an edge and a face pass the edge as its two faces and a point on it', async () => {
    const kernel = vi.fn(async () => ({ items: [{ kind: 'edge', length: 10 }, { kind: 'face', area: 1 }], distance: 0, points: [[0, 0, 0], [0, 0, 0]] }));
    await measure([resolvePick('x|y#0', edges)!, resolvePick('F9', edges)!], ctx(kernel));
    expect(kernel).toHaveBeenCalledWith([{ kind: 'edge', faces: ['A', 'B'], at: [5, 0, 0] }, { kind: 'face', id: 'F9' }]);
  });
  it('a corner against a face is measured on the face triangles, with the distance along a flat face normal', async () => {
    const mesh = { positions: [0, 0, 2, 4, 0, 2, 4, 3, 2], triFace: [0], faceIds: ['top'] };
    const kernel = vi.fn(async () => null);
    const o = await measure([resolvePick('v:1,1,5', edges)!, resolvePick('top', edges)!], ctx(kernel, mesh));
    expect(val(o, 'distance')).toBeCloseTo(3); expect(val(o, 'normalDistance')).toBeCloseTo(3);
    expect(kernel).not.toHaveBeenCalled();
  });
  it('a kernel failure falls back to the face area from the mesh, else says unavailable; it never throws', async () => {
    const mesh = { positions: [0, 0, 2, 4, 0, 2, 4, 3, 2], triFace: [0], faceIds: ['top'] };
    const bad = async () => { throw new Error('boom'); };
    expect(val(await measure([resolvePick('top', edges)!], ctx(bad, mesh)), 'area')).toBeCloseTo(6);
    expect((await measure([resolvePick('top', edges)!], ctx(bad))).error).toBe('unavailable');
    expect((await measure([resolvePick('top', edges)!, resolvePick('x|y#0', edges)!], ctx(async () => null))).error).toBe('unavailable');
  });
  it('more than two picks use the first two', async () => {
    const o = await measure([resolvePick('v:0,0,0', edges)!, resolvePick('v:0,0,2', edges)!, resolvePick('v:0,0,9', edges)!], ctx());
    expect(val(o, 'distance')).toBe(2);
  });
});

describe('formatting', () => {
  it('fmt trims zeros and never prints -0', () => { expect(fmt(12.5)).toBe('12.5'); expect(fmt(3)).toBe('3'); expect(fmt(-0.00001)).toBe('0'); expect(fmt(1 / 3)).toBe('0.3333'); });
  it('rowText adds units; copyText is label TAB value per row', () => {
    const rows = [{ id: 'distance', value: 12.5, unit: 'mm' as const }, { id: 'angle', value: 90, unit: 'deg' as const }, { id: 'center', value: [1, 2, 3.5], unit: 'text' as const }, { id: 'area', value: 6, unit: 'mm2' as const }];
    expect(rows.map(rowText)).toEqual(['12.5 mm', '90°', '(1, 2, 3.5)', '6 mm²']);
    expect(copyText(rows.slice(0, 2), (id) => id.toUpperCase())).toBe('DISTANCE\t12.5 mm\nANGLE\t90°');
  });
});

describe('mass numbers', () => {
  it('density by material name, ignoring case; unknown is null', () => {
    expect(densityOf('Steel')).toBe(7.85); expect(densityOf('aluminium')).toBe(2.7); expect(densityOf('unobtainium')).toBeNull(); expect(densityOf(undefined)).toBeNull();
  });
  it('scales volume to grams and the unit-density moments with the density', () => {
    const v = massView({ volume: 1000, area: 600, com: [5, 5, 5], principal: [100, 200, 300], bodies: [{ volume: 400, area: 1, com: [0, 0, 0] }] }, 8);
    expect(v.mass).toBeCloseTo(8); expect(v.principal).toEqual([0.8, 1.6, 2.4]); expect(v.bodies[0].mass).toBeCloseTo(3.2);
  });
  it('massText switches to kg at 1000 g', () => { expect(massText(16.2)).toBe('16.2 g'); expect(massText(2500)).toBe('2.5 kg'); });
});
