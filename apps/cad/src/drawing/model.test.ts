import { describe, expect, it } from 'vitest';
import {
  STD_FRAMES, auxFrame, bestScale, cross, dimText, emptyDrawing, fmtLength, parseScale, projectedFrame, removeView, sanitizeDrawing, scaleText, sectionFrame, sheetSize, sideFor, dot3,
  type DrawingDoc, type DView,
} from './model';
import { dimMeasure, renderSheet, toSvg, viewLabel } from './render';
import { hitAnnotation } from './hit';
import { toDxf, toPdf } from './output';
import { parseDxf } from '@kit/io';
import { distToPoly, edgeShape, findRef, pickEdge, refreshDim, dimFromPicks, autoDims } from './geom';
import { holeCallout, holeInfos, threadLabel } from './kernel';
import { moveView, alignedPos, sideOfPoint } from './layout';

const v = (id: string, extra: Partial<DView> = {}): DView => ({ id, kind: 'std', label: id, x: [1, 0, 0], y: [0, 1, 0], pos: [100, 100], scale: null, hidden: true, tangent: false, centerlines: true, showLabel: true, ...extra });
const view = (min: [number, number], max: [number, number], lines: Array<{ k?: 'e' | 'o' | 't' | 'h'; v?: boolean; p: number[]; e?: number }>, edges: Array<{ faces: string[]; at: number[] }> = []) =>
  ({ min, max, lines: lines.map((l) => ({ k: 'e' as const, v: true, ...l })), edges: edges.map((e) => ({ ...e, mid: [0, 0], ends: [[0, 0], [0, 0]] })) });
const circle = (cx: number, cy: number, r: number, e: number) => { const p: number[] = []; for (let i = 0; i <= 32; i++) p.push(cx + r * Math.cos((i / 32) * 2 * Math.PI), cy + r * Math.sin((i / 32) * 2 * Math.PI)); return { p, e }; };

describe('sheet model', () => {
  it('sizes follow the orientation and the standard names', () => {
    const d = emptyDrawing('P');
    expect(sheetSize(d.sheet)).toEqual([420, 297]);
    expect(sheetSize({ ...d.sheet, size: 'A4', orientation: 'portrait' })).toEqual([210, 297]);
    expect(sheetSize({ ...d.sheet, size: 'ANSI B' })[0]).toBeCloseTo(431.8);
  });
  it('scales parse and print', () => {
    expect(parseScale('1:2')).toBe(0.5); expect(parseScale('5:1')).toBe(5); expect(parseScale('nonsense', 3)).toBe(3);
    expect(scaleText(0.5)).toBe('1:2'); expect(scaleText(2)).toBe('2:1');
  });
  it('the largest standard scale that fits is chosen', () => {
    const d = emptyDrawing('P');
    expect(bestScale(d.sheet, [[60, 40], [8, 0], [0, 8]])).toBe('2:1');
    expect(bestScale(d.sheet, [[1000, 700], [0, 0], [0, 0]])).toBe('1:4');
  });
  it('projected frames match the kernel names (third angle)', () => {
    const f = STD_FRAMES.front;
    expect(projectedFrame(f.x, f.y, 'right')).toEqual({ x: STD_FRAMES.right.x, y: STD_FRAMES.right.y });
    expect(projectedFrame(f.x, f.y, 'left')).toEqual({ x: STD_FRAMES.left.x, y: STD_FRAMES.left.y });
    expect(projectedFrame(f.x, f.y, 'up')).toEqual({ x: STD_FRAMES.top.x, y: STD_FRAMES.top.y });
    expect(projectedFrame(f.x, f.y, 'down')).toEqual({ x: STD_FRAMES.bottom.x, y: STD_FRAMES.bottom.y });
    expect(sideFor('first', 'right')).toBe('left');
  });
  it('a vertical section looks from the right; its point lies on the cut plane', () => {
    const f = STD_FRAMES.front;
    const s = sectionFrame(f.x, f.y, { dir: 'v', at: 12 });
    const z = cross(s.x, s.y);
    expect(z).toEqual([1, 0, 0]);
    expect(dot3(z, s.point)).toBeCloseTo(12);
  });
  it('an auxiliary view looks square at an inclined edge', () => {
    const f = STD_FRAMES.front;
    const a = auxFrame(f.x, f.y, Math.PI / 4);
    const z = cross(a.x, a.y);
    expect(dot3(z, [Math.SQRT1_2, Math.SQRT1_2, 0])).toBeCloseTo(0);   // the view direction is square to the edge
    expect(Math.abs(z[2])).toBeCloseTo(0);
  });
  it('dimension text: override with <> and units', () => {
    expect(dimText('25', '')).toBe('25'); expect(dimText('25', '<> +0.1')).toBe('25 +0.1'); expect(dimText('25', 'TYP')).toBe('TYP');
    expect(fmtLength(25.4, 'in')).toBe('1.0'); expect(fmtLength(12.5, 'mm')).toBe('12.5'); expect(fmtLength(60, 'mm')).toBe('60');
  });
  it('a stored drawing is repaired on load: unknown sheet, dangling parents and dimensions', () => {
    const raw = { sheet: { size: 'Z9' }, views: [v('V1'), v('V2', { parent: 'gone' })], dims: [{ id: 'D1', view: 'V2' }, { id: 'D2', view: 'V1' }] };
    const d = sanitizeDrawing(raw, 'P');
    expect(d.sheet.size).toBe('A3'); expect(d.views.map((x) => x.id)).toEqual(['V1']); expect(d.dims.map((x) => x.id)).toEqual(['D2']);
    expect(sanitizeDrawing(null, 'Q').title.title).toBe('Q');
  });
  it('removing a view takes its dependants and their dimensions', () => {
    const d: DrawingDoc = { ...emptyDrawing('P'), views: [v('V1'), v('V2', { parent: 'V1', side: 'right', kind: 'proj' })], dims: [{ id: 'D1', view: 'V2', kind: 'linear', a: [0, 0], offset: 5 }] };
    const r = removeView(d, 'V1');
    expect(r.views).toEqual([]); expect(r.dims).toEqual([]);
  });
});

describe('edges and dimensions', () => {
  const g = view([0, 0], [60, 40], [
    { p: [0, 0, 60, 0], e: 0 }, { p: [60, 0, 60, 40], e: 1 }, { p: [60, 40, 0, 40], e: 2 }, { p: [0, 40, 0, 0], e: 3 }, circle(20, 20, 5, 4),
  ], [{ faces: ['F2.C0', 'F2.S.e1'], at: [30, 0, 0] }, { faces: ['F2.S.e1', 'F2.S.e2'], at: [60, 20, 0] }, { faces: ['F2.C0', 'F2.S.e3'], at: [30, 40, 0] }, { faces: ['F2.S.e4', 'F2.C0'], at: [0, 20, 0] }, { faces: ['F4.S.h1', 'F2.C0'], at: [25, 20, 0] }]);
  it('picks the nearest shown edge and ignores hidden ones when they are off', () => {
    expect(pickEdge(g, v('x'), [30, 0.3], 1)?.e).toBe(0);
    const hid = view([0, 0], [10, 10], [{ p: [0, 5, 10, 5], e: 0, v: false }]);
    expect(pickEdge(hid, v('x', { hidden: false }), [5, 5], 1)).toBeNull();
    expect(pickEdge(hid, v('x', { hidden: true }), [5, 5], 1)?.e).toBe(0);
    expect(distToPoly([0, 1], [0, 0, 5, 0])).toBe(1);
  });
  it('tells a line from a circle', () => {
    expect(edgeShape(g, 0)).toMatchObject({ kind: 'line' });
    const c = edgeShape(g, 4);
    expect(c).toMatchObject({ kind: 'circle', full: true });
    expect((c as { r: number }).r).toBeCloseTo(5, 6);
  });
  it('one edge: length or diameter; two parallel edges: distance; two others: angle', () => {
    expect(dimFromPicks(g, 'V1', [0])).toMatchObject({ kind: 'linear', orient: 'h' });
    expect(dimFromPicks(g, 'V1', [4])).toMatchObject({ kind: 'diameter', r: expect.closeTo(5, 6) });
    expect(dimFromPicks(g, 'V1', [4], { radial: true })?.kind).toBe('radial');
    const dist = dimFromPicks(g, 'V1', [0, 2])!;
    expect(dist.kind).toBe('linear'); expect(dist.orient).toBe('v');
    expect(Math.abs(dist.b![1] - dist.a[1])).toBeCloseTo(40);
    const ang = dimFromPicks(g, 'V1', [0, 1])!;
    expect(ang.kind).toBe('angular');
    const doc = emptyDrawing('P');
    expect(dimMeasure(ang, doc)).toBe('90°');
    expect(dimMeasure(dist, doc)).toBe('40');
  });
  it('a dimension finds its edge again by the faces and the model point', () => {
    const d = dimFromPicks(g, 'V1', [0])!;
    // the part grew: the edge moved and changed index
    const g2 = view([0, 0], [80, 40], [{ p: [0, 0, 80, 0], e: 7 }], []);
    g2.edges[7] = { faces: ['F2.C0', 'F2.S.e1'], at: [40, 0, 0], mid: [40, 0], ends: [[0, 0], [80, 0]] };
    expect(findRef(g2, d.refs![0])).toBe(7);
    const r = refreshDim(d, g2)!;
    expect(dimMeasure(r, emptyDrawing('P'))).toBe('80');
    expect(refreshDim(d, view([0, 0], [1, 1], [], []))).toBeNull();
  });
  it('auto dimensions: overall size, one diameter per hole, hole callouts from features', () => {
    const feats = [{ type: 'hole', id: 'F4', size: 'M5', end: 'through', kind: 'simple' }] as never;
    const dims = autoDims(g, v('V1'), holeInfos(feats));
    expect(dims.filter((d) => d.kind === 'linear').length).toBe(2);
    const co = dims.find((d) => d.kind === 'callout')!;
    expect(co.feature).toBe('F4');
    expect(dims.filter((d) => d.kind === 'diameter').length).toBe(0);
  });
});

describe('callouts', () => {
  const pitch = (_s: string, z: string) => (z === 'M10' ? 1.5 : z === 'M8' ? 1.25 : null);
  it('thread callouts carry the pitch: M10x1.5', () => {
    expect(threadLabel({ type: 'thread', id: 'F6', size: 'M10', standard: 'metric' }, pitch)).toBe('M10x1.5');
    expect(threadLabel({ type: 'thread', id: 'F6', size: '1/4-20' }, pitch)).toBe('1/4-20');
  });
  it('a tapped blind hole reads thread and depth, a clearance hole diameter and THRU', () => {
    const feats = [
      { type: 'hole', id: 'F10', size: 'M8', kind: 'simple', end: 'blind', depth: 14 },
      { type: 'thread', id: 'F11', face: 'F10.S.h1', standard: 'metric', size: 'M8', length: 'full' },
      { type: 'hole', id: 'F2', diameter: 6.5, end: 'through', kind: 'simple' },
    ] as never;
    const h = holeInfos(feats, pitch);
    expect(h.map((x) => x.text)).toEqual(['M8x1.25 ↧ 14', 'Ø6.5 THRU']);
    expect(holeCallout({ type: 'hole', id: 'F1', size: 'M5', end: 'through', kind: 'countersink' }, null)).toBe('M5 CLR THRU\nCSK');
  });
  it('a free thread (no hole) is a callout too, with its length', () => {
    const h = holeInfos([{ type: 'thread', id: 'F6', face: 'F4.S.c1', size: 'M10', standard: 'metric', length: 30 }] as never, pitch);
    expect(h[0].text).toBe('M10x1.5 ↧ 30');
  });
});

describe('views on the sheet', () => {
  const doc0: DrawingDoc = { ...emptyDrawing('P'), views: [v('V1', { pos: [100, 100] }), v('V2', { kind: 'proj', parent: 'V1', side: 'right', pos: [200, 100] })] };
  const data = { V1: view([0, 0], [60, 40], [{ p: [0, 0, 60, 0], e: 0 }]), V2: view([0, 0], [8, 40], [{ p: [0, 0, 8, 0], e: 0 }]) };
  it('projected views stay level with the parent', () => {
    const p = alignedPos(doc0, data, doc0.views[1], [300, 150]);
    expect(p[1]).toBeCloseTo(100 + 20 * 1 - 20 * 1);   // same centre height at equal scale
    expect(p[0]).toBe(300);
  });
  it('moving a parent carries its dependants; moving a dependant keeps it aligned', () => {
    const m = moveView(doc0, data, 'V1', [120, 130]);
    expect(m.views[1].pos).toEqual([220, 130]);
    const k = moveView(doc0, data, 'V2', [260, 190]);
    expect(k.views[1].pos).toEqual([260, 100]);
  });
  it('the side a cursor is on', () => {
    const b = { x0: 0, y0: 0, x1: 100, y1: 50 };
    expect(sideOfPoint(b, [200, 25])).toBe('right'); expect(sideOfPoint(b, [-90, 25])).toBe('left'); expect(sideOfPoint(b, [50, -80])).toBe('up'); expect(sideOfPoint(b, [50, 130])).toBe('down');
  });
  it('labels', () => {
    expect(viewLabel(doc0, doc0.views[0])).toBe('V1  (1:1)');
    expect(viewLabel(doc0, { ...doc0.views[0], kind: 'section', cut: { dir: 'v', at: 0, letter: 'A' } })).toBe('SECTION A-A  (1:1)');
  });
});

describe('sheet output', () => {
  const doc: DrawingDoc = { ...emptyDrawing('Plate', 'steel'), views: [v('V1', { label: 'Front' })], notes: [{ id: 'N1', text: 'DEBURR ALL EDGES', pos: [30, 40] }], balloons: [{ id: 'B1', view: 'V1', at: [10, 10], pos: [60, 60], n: 3 }] };
  doc.dims = [{ id: 'D1', view: 'V1', kind: 'linear', a: [0, 0], b: [60, 0], orient: 'h', offset: 10 }];
  const data = { V1: view([0, 0], [60, 40], [{ p: [0, 0, 60, 0, 60, 40, 0, 40, 0, 0], e: 0 }, { p: [10, 10, 20, 10], e: 1, v: false }]) };
  const prims = renderSheet({ doc, data, bom: [{ no: 1, part: 'Plate', qty: 2, material: 'steel', mass: '10' }] });
  it('the title block carries the fields; the BOM table and annotations are drawn', () => {
    const texts = prims.filter((p) => p.t === 'text').map((p) => (p as { s: string }).s);
    expect(texts).toContain('Plate'); expect(texts).toContain('steel'); expect(texts).toContain('60'); expect(texts).toContain('DEBURR ALL EDGES'); expect(texts).toContain('3'); expect(texts).toContain('Mass (g)');
  });
  it('hidden lines follow the toggle', () => {
    const hidden = (d: DrawingDoc) => renderSheet({ doc: d, data }).filter((p) => p.t === 'poly' && p.layer === 'hidden').length;
    expect(hidden(doc)).toBe(1);
    expect(hidden({ ...doc, views: [{ ...doc.views[0], hidden: false }] })).toBe(0);
  });
  it('tangent edges are drawn only when asked', () => {
    const dt = { V1: view([0, 0], [10, 10], [{ k: 't', p: [0, 0, 10, 0] }]) };
    const n = (tan: boolean) => renderSheet({ doc: { ...doc, dims: [], notes: [], balloons: [], views: [{ ...doc.views[0], tangent: tan }] }, data: dt }).filter((p) => p.t === 'poly' && p.layer === 'thin').length;
    expect(n(false)).toBe(0); expect(n(true)).toBe(1);
  });
  it('SVG, PDF and DXF are written from the same primitives', () => {
    const size = sheetSize(doc.sheet);
    const svg = toSvg(prims, size);
    expect(svg).toContain('viewBox="0 0 420 297"'); expect(svg).toContain('DEBURR ALL EDGES');
    const pdf = toPdf(prims, size);
    const text = Array.from(pdf).map((c) => String.fromCharCode(c)).join('');
    expect(text.startsWith('%PDF-1.4')).toBe(true); expect(text).toContain('/MediaBox [0 0 1190.551 841.89]'); expect(text).toContain('(DEBURR ALL EDGES) Tj'); expect(text.trim().endsWith('%%EOF')).toBe(true);
    const xref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xref, xref + 4)).toBe('xref');
    const dxf = toDxf(prims, size);
    expect(dxf).toContain('HIDDEN'); expect(dxf).toContain('LWPOLYLINE');
    const back = parseDxf(dxf);
    expect(back.entities.filter((e) => e.type === 'POLYLINE').length).toBeGreaterThan(10);
    expect(new Set(back.entities.map((e) => e.layer))).toContain('HIDDEN');
    const ys = back.entities.flatMap((e) => (e.type === 'POLYLINE' ? e.verts.map((q) => q.y) : []));
    expect(Math.max(...ys)).toBeLessThanOrEqual(297); expect(Math.min(...ys)).toBeGreaterThanOrEqual(0); expect(dxf.trim().endsWith('EOF')).toBe(true);
  });
  it('hit testing: dimension text, a note, the title block', () => {
    const dim = prims.find((p) => p.t === 'text' && p.s === '60')!;
    expect(hitAnnotation(prims, [(dim as { x: number }).x, (dim as { y: number }).y - 1], 2)).toMatchObject({ kind: 'dim', id: 'D1' });
    expect(hitAnnotation(prims, [31, 39], 2)).toMatchObject({ kind: 'note', id: 'N1' });
    expect(hitAnnotation(prims, [400, 280], 2)?.kind).toBe('title');
    expect(hitAnnotation(prims, [5, 5], 1)).toBeNull();
  });
});
