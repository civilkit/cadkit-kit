import { describe, expect, it } from 'vitest';
import { emptyDrawing, viewScale, type DDim, type DrawingDoc, type DView } from './model';
import { dimMeasure, refreshDims, renderSheet, toSvg, placer, type Prim } from './render';
import { hitAnnotation } from './hit';
import { toDxf, toPdf } from './output';
import { centerFeatures, dimFromPicks, findCenter, pickCenter, pickTarget, refreshDim, type DimPick } from './geom';

const dv = (id: string, extra: Partial<DView> = {}): DView => ({ id, kind: 'std', label: id, x: [1, 0, 0], y: [0, 1, 0], pos: [150, 120], scale: null, hidden: true, tangent: false, centerlines: true, showLabel: true, ...extra });
type L = { k?: 'e' | 'o' | 't' | 'h'; v?: boolean; p: number[]; e: number };
const mkView = (min: [number, number], max: [number, number], lines: L[], edges: Array<{ faces: string[]; at: number[] }>) =>
  ({ min, max, lines: lines.map((l) => ({ k: 'e' as const, v: true, ...l })), edges: edges.map((e) => ({ ...e, mid: [0, 0], ends: [[0, 0], [0, 0]] })) });
const circle = (cx: number, cy: number, r: number, e: number): L => { const p: number[] = []; for (let i = 0; i <= 48; i++) p.push(cx + r * Math.cos((i / 48) * 2 * Math.PI), cy + r * Math.sin((i / 48) * 2 * Math.PI)); return { p, e }; };

/** Side view of a stepped round part like the one in the bug report: disc (r 30, 10 high), a shaft up at u = 8 (r 8) and a shaft down at u = -6 (r 10). Offset moves the whole view's origin. */
function steppedSide(du = 0, dw = 0, up = 8, down = -6) {
  const o = (v: number[]) => v.map((x, i) => x + (i % 2 ? dw : du));
  const lines: L[] = [
    { k: 'o', p: o([-30, 0, -30, 10]), e: 0 }, { k: 'o', p: o([30, 0, 30, 10]), e: 1 },
    { k: 'o', p: o([up - 8, 10, up - 8, 25]), e: 2 }, { k: 'o', p: o([up + 8, 10, up + 8, 25]), e: 3 },
    { k: 'o', p: o([down - 10, -20, down - 10, 0]), e: 4 }, { k: 'o', p: o([down + 10, -20, down + 10, 0]), e: 5 },
    { p: o([-30, 10, 30, 10]), e: 6 }, { p: o([-30, 0, 30, 0]), e: 7 },
  ];
  const edges = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ faces: [`S${i}`, `T${i}`], at: [i, i, i] }));
  return mkView([-30 + du, -20 + dw], [30 + du, 25 + dw], lines, edges);
}
const doc1 = (scale: string, projection: 'third' | 'first' = 'third'): { doc: DrawingDoc; view: DView } => {
  const view = dv('V1');
  const doc = { ...emptyDrawing('P'), views: [view] };
  doc.sheet = { ...doc.sheet, scale, projection };
  return { doc, view };
};
const axesOf = (g: ReturnType<typeof steppedSide>, v: DView) => centerFeatures(g, v, 1).filter((f) => f.kind === 'axis');

describe('centre lines are pick targets', () => {
  it('each cylinder seen from the side has a centre line made of its two silhouette edges', () => {
    const g = steppedSide(), v = dv('V1');
    const ax = axesOf(g, v);
    expect(ax.length).toBe(3);
    const up = ax.find((f) => f.edges.includes(2))!;
    expect(up.edges).toEqual([2, 3]);
    expect(up.kind === 'axis' && up.p).toEqual([8, 10]);
    expect(up.kind === 'axis' && up.q).toEqual([8, 25]);
  });
  it('a click on the centre line picks it, a click near the outline still picks the edge', () => {
    const g = steppedSide(), v = dv('V1');
    const c = pickCenter(g, v, [8.2, 17], 0.5, 1)!;
    expect(c.pick).toEqual({ axis: [2, 3] });
    expect(pickTarget(g, v, [8.2, 17], 0.5, 1)!.pick).toEqual({ axis: [2, 3] });
    expect(pickTarget(g, v, [15.9, 17], 0.5, 1)!.pick).toBe(3);
    // centre lines switched off: nothing to pick there
    expect(pickTarget(g, { ...v, centerlines: false }, [8, 17], 0.5, 1)).toBeNull();
  });
  it('centre marks of full circles are pick targets too', () => {
    const g = mkView([-10, -10], [10, 10], [circle(0, 0, 5, 0), circle(7, 0, 2, 1)], [{ faces: ['A', 'B'], at: [0, 0, 0] }, { faces: ['C', 'D'], at: [1, 1, 1] }]);
    const v = dv('V1');
    expect(pickCenter(g, v, [0.1, 3], 0.4, 5)!.pick).toEqual({ mark: 0 });
    expect(pickTarget(g, v, [7, -1], 0.3, 5)!.pick).toEqual({ mark: 1 });
  });
  it('Select: the centre line is hit before the view, a dimension that is as near wins over the centre line', () => {
    const { doc, view } = doc1('5:1');
    const g = steppedSide();
    const data = { V1: g };
    const prims = renderSheet({ doc, data });
    const P = placer(doc, view, g);
    const at = P(8, 17);
    const hit = hitAnnotation(prims, at, 0.8);
    expect(hit?.kind).toBe('center');
    expect(hit?.view).toBe('V1');
    // away from every line: nothing is annotation-hit (the view behind is picked by the workspace)
    const far = P(-20, 5);
    expect(hitAnnotation(prims, [far[0], far[1] + 4], 0.8)).toBeNull();
    // a dimension drawn over the same spot beats the centre line
    const dim: DDim = { id: 'D1', view: 'V1', kind: 'linear', a: [8, 17], b: [8, 25], orient: 'h', offset: 0 };
    const withDim = renderSheet({ doc: { ...doc, dims: [dim] }, data });
    expect(hitAnnotation(withDim, at, 0.8)?.kind).toBe('dim');
  });
});

describe('dimensions from centre lines', () => {
  it.each(['5:1', '1:1', '2:1', '1:2', '1:10'])('distance between two parallel centre lines at %s is exact', (scale) => {
    const { doc, view } = doc1(scale);
    const g = steppedSide(), s = viewScale(doc, view);
    const d = dimFromPicks(g, 'V1', [{ axis: [2, 3] }, { axis: [4, 5] }], { v: view, scale: s })!;
    expect(d.kind).toBe('linear');
    expect(d.orient).toBe('h');
    expect(Math.abs(d.b![0] - d.a[0])).toBeCloseTo(14, 6);        // 8 - (-6)
    expect(dimMeasure(d, doc)).toBe('14');
    // the extension lines start level, at the end of the common stretch of the two axes, and the dimension line is clear of the view
    expect(d.a[1]).toBeCloseTo(d.b![1], 9);
    const prims = renderSheet({ doc: { ...doc, dims: [d] }, data: { V1: g } });
    const P = placer(doc, view, g);
    const dimLine = prims.find((p) => p.t === 'poly' && p.tag?.kind === 'dim' && p.pts.length === 4 && p.pts[1] === p.pts[3] && Math.abs(p.pts[2] - p.pts[0]) > 1) as Extract<Prim, { t: 'poly' }>;
    const bottom = P(0, -20)[1];
    expect(dimLine.pts[1]).toBeGreaterThanOrEqual(bottom + 12 - 1e-9);
    expect(Math.abs(dimLine.pts[2] - dimLine.pts[0])).toBeCloseTo(14 * s, 6);
  });
  it('is exact to 1e-6 for a view whose origin is far from zero, whatever side the shafts are on (mirrored view)', () => {
    const { doc, view } = doc1('5:1');
    for (const [du, dw] of [[250.123456, -80.654321], [-1e3, 1e3]]) {
      for (const [up, down] of [[8, -6], [-6, 8], [3.3333333, -9.9999999]]) {
        const g = steppedSide(du, dw, up, down);
        const d = dimFromPicks(g, 'V1', [{ axis: [2, 3] }, { axis: [4, 5] }], { v: view, scale: 5 })!;
        expect(Math.abs(d.b![0] - d.a[0])).toBeCloseTo(Math.abs(up - down), 6);
        expect(Math.abs(d.b![0] - d.a[0]) - Math.abs(up - down)).toBeLessThan(1e-6);
      }
    }
  });
  it('first-angle sheets give the same measure (the view data is what is measured)', () => {
    const { doc, view } = doc1('5:1', 'first');
    const d = dimFromPicks(steppedSide(), 'V1', [{ axis: [4, 5] }, { axis: [2, 3] }], { v: view, scale: 5 })!;
    expect(dimMeasure(d, doc)).toBe('14');
  });
  it('centre line to an edge: the distance from the axis to a parallel edge; centre line to a centre mark', () => {
    const { view } = doc1('5:1');
    const g = steppedSide();
    const e = dimFromPicks(g, 'V1', [{ axis: [2, 3] }, 1], { v: view, scale: 5 })!;   // axis at u = 8, silhouette of the disc at u = 30
    expect(e.kind).toBe('linear');
    expect(Math.abs(e.b![0] - e.a[0])).toBeCloseTo(22, 6);
    const gm = mkView([-10, -10], [20, 10], [circle(0, 0, 4, 0), circle(12, 5, 2, 1), { k: 'o', p: [18, -10, 18, 10], e: 2 }, { k: 'o', p: [14, -10, 14, 10], e: 3 }], [0, 1, 2, 3].map((i) => ({ faces: [`F${i}`, `G${i}`], at: [i, 0, 0] })));
    const m = dimFromPicks(gm, 'V1', [{ mark: 0 }, { mark: 1 }], { v: view, scale: 5 })!;
    expect(m.kind).toBe('linear');
    expect(m.orient).toBe('h');
    expect(Math.abs(m.b![0] - m.a[0])).toBeCloseTo(12, 6);
    const ma = dimFromPicks(gm, 'V1', [{ mark: 0 }, { axis: [3, 2] }], { v: view, scale: 5 })!;   // mark at u = 0, axis at u = 16
    expect(Math.abs(ma.b![0] - ma.a[0])).toBeCloseTo(16, 6);
    // one mark alone has nothing to measure
    expect(dimFromPicks(gm, 'V1', [{ mark: 0 }], { v: view })).toBeNull();
  });
  it('two non-parallel centre lines give the angle between them', () => {
    const { doc, view } = doc1('1:1');
    const g = mkView([-20, -20], [20, 20], [
      { k: 'o', p: [-2, -20, -2, 20], e: 0 }, { k: 'o', p: [2, -20, 2, 20], e: 1 },
      { k: 'o', p: [-20, -2, 20, -2], e: 2 }, { k: 'o', p: [-20, 2, 20, 2], e: 3 },
    ], [0, 1, 2, 3].map((i) => ({ faces: [`F${i}`, `G${i}`], at: [i, 0, 0] })));
    const d = dimFromPicks(g, 'V1', [{ axis: [0, 1] }, { axis: [2, 3] }], { v: view, scale: 1 })!;
    expect(d.kind).toBe('angular');
    expect(dimMeasure(d, doc)).toBe('90°');
  });
});

describe('dimensions on centre lines follow the part, the view and the sheet', () => {
  const picks: DimPick[] = [{ axis: [2, 3] }, { axis: [4, 5] }];
  it('are re-anchored through their references after the part changes (even when the edge numbering changes)', () => {
    const { doc, view } = doc1('5:1');
    const g0 = steppedSide();
    const d0 = dimFromPicks(g0, 'V1', picks, { v: view, scale: 5 })!;
    expect(d0.refs?.length).toBe(2);
    expect(d0.refs![0].axis).toBeTruthy();
    // shaft moved to u = 11 and the edges renumbered in reverse: faces + points identify the edges, not their index
    const g1 = steppedSide(0, 0, 11, -6);
    const rev = { ...g1, lines: g1.lines.map((l) => ({ ...l, e: 7 - l.e! })), edges: [...g1.edges].reverse() };
    const r = refreshDim({ ...d0, offset: 33 }, rev, view)!;
    expect(r).not.toBeNull();
    expect(Math.abs(r.b![0] - r.a[0])).toBeCloseTo(17, 6);
    expect(r.offset).toBe(33);                          // a dragged position is kept
    const re = refreshDims({ ...doc, dims: [d0] }, { V1: rev });
    expect(re.lost).toEqual([]);
    // a part whose cylinder is gone: the dimension is reported lost, not silently moved
    const gone = mkView([-30, -20], [30, 25], [{ k: 'o', p: [-30, 0, -30, 10], e: 0 }], [{ faces: ['x'], at: [0, 0, 0] }]);
    expect(refreshDim(d0, gone, view)).toBeNull();
  });
  it('survive save and reload (plain JSON) and are in the SVG, PDF and DXF output', () => {
    const { doc, view } = doc1('5:1');
    const g = steppedSide();
    const d = dimFromPicks(g, 'V1', picks, { v: view, scale: 5 })!;
    const saved = JSON.parse(JSON.stringify({ ...doc, dims: [d] })) as DrawingDoc;
    expect(saved.dims[0].refs).toEqual(d.refs);
    expect(dimMeasure(saved.dims[0], saved)).toBe('14');
    const prims = renderSheet({ doc: saved, data: { V1: g } });
    const size: [number, number] = [420, 297];
    expect(toSvg(prims, size)).toMatch(/>14</);
    expect(toSvg(prims, size)).toContain('stroke-dasharray="8 1.5 1.5 1.5"');     // the centre lines are there too
    expect(new TextDecoder().decode(toPdf(prims, size))).toContain('(14)');
    const dxf = toDxf(prims, size);
    expect(dxf).toContain('ENTITIES');
    expect(dxf).toMatch(/\n14\n/);
  });
  it('move and rescale with the view: the dimension stays 14 and its extension lines stay on the axes', () => {
    const { doc, view } = doc1('5:1');
    const g = steppedSide();
    const d = dimFromPicks(g, 'V1', picks, { v: view, scale: 5 })!;
    for (const [scale, pos] of [['5:1', [150, 120]], ['2:1', [80, 200]], ['1:1', [300, 40]]] as const) {
      const doc2: DrawingDoc = { ...doc, views: [{ ...view, scale, pos: [pos[0], pos[1]] }], dims: [d] };
      const P = placer(doc2, doc2.views[0], g);
      const prims = renderSheet({ doc: doc2, data: { V1: g } });
      const ext = prims.filter((p) => p.t === 'poly' && p.tag?.kind === 'dim' && p.pts.length === 4 && Math.abs(p.pts[0] - p.pts[2]) < 1e-9 && p.pts[1] !== p.pts[3]) as Array<Extract<Prim, { t: 'poly' }>>;
      expect(ext.length).toBe(2);
      const xs = ext.map((p) => p.pts[0]).sort((a, b) => a - b);
      expect(xs[0]).toBeCloseTo(P(-6, 0)[0], 6);
      expect(xs[1]).toBeCloseTo(P(8, 0)[0], 6);
      expect(dimMeasure(d, doc2)).toBe('14');
    }
  });
  it('the centre line of another view is not found in this view (ids carry the view)', () => {
    const g = steppedSide();
    const a = centerFeatures(g, dv('V1'), 1)[0].id, b = centerFeatures(g, dv('V2'), 1)[0].id;
    expect(a).not.toBe(b);
    expect(findCenter(g, dv('V1'), { axis: [2, 3] })?.edges).toEqual([2, 3]);
    expect(findCenter(g, dv('V1'), { axis: [2, 5] })).toBeNull();
  });
});

describe('placement of the new dimension and the view label', () => {
  it('stacks outside the dimensions already under the view, and the label stays below it', () => {
    const { doc, view } = doc1('5:1');
    const g = steppedSide();
    const overall: DDim = { id: 'D0', view: 'V1', kind: 'linear', a: [-30, -20], b: [30, -20], orient: 'h', offset: 14, overall: 'w' };
    const d = dimFromPicks(g, 'V1', [{ axis: [2, 3] }, { axis: [4, 5] }], { v: view, scale: 5, others: [overall] })!;
    const clear = (d.offset) - (Math.min(d.a[1], d.b![1]) - -20) * 5;     // mm beyond the view's lower edge
    expect(clear).toBeCloseTo(22, 6);                                      // 14 + 8
    const alone = dimFromPicks(g, 'V1', [{ axis: [2, 3] }, { axis: [4, 5] }], { v: view, scale: 5 })!;
    expect(alone.offset - (Math.min(alone.a[1], alone.b![1]) - -20) * 5).toBeCloseTo(12, 6);
    const prims = renderSheet({ doc: { ...doc, dims: [overall, d] }, data: { V1: g } });
    const label = prims.find((p) => p.t === 'text' && p.tag?.kind === 'label') as Extract<Prim, { t: 'text' }>;
    const bottom = placer(doc, view, g)(0, -20)[1];
    expect(label.y).toBeGreaterThanOrEqual(bottom + 22 + 5);
    // a dimension that sits inside the view (its line is above the lower edge) does not push the label away
    const inside: DDim = { id: 'D2', view: 'V1', kind: 'linear', a: [0, 10], b: [0, 10], orient: 'h', offset: 12 };
    const p2 = renderSheet({ doc: { ...doc, dims: [inside] }, data: { V1: g } });
    const l2 = p2.find((p) => p.t === 'text' && p.tag?.kind === 'label') as Extract<Prim, { t: 'text' }>;
    expect(l2.y).toBeCloseTo(bottom + 9, 6);
  });
});
