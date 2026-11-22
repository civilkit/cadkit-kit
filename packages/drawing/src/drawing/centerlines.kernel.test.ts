import { afterEach, expect, it } from 'vitest';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { drawingQuery } from './kernel';
import { sanitizeDrawing, viewScale, type DView } from './model';
import { fetchViews } from './layout';
import { centerFeatures, dimFromPicks, pickTarget, type DimPick } from './geom';
import { dimMeasure, placer, refreshDims, renderSheet } from './render';
import { hitAnnotation } from './hit';
import { STEPPED_DRAWING, STEPPED_PART } from './centerlines.fixture';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const AXIS_OFFSET = 2.990832237915203;     // the off-axis shaft's sketch position on the underside

it('the tester part: centre lines of the shafts and centre marks of the holes are pick targets and dimension references', async () => {
  const s = await Session.open(clone(STEPPED_PART) as unknown as PartDoc); sessions.push(s);
  const q = drawingQuery(s);
  let doc = sanitizeDrawing(clone(STEPPED_DRAWING));
  expect(doc.sheet.scale).toBe('5:1');
  expect(doc.views.map((v) => v.label)).toEqual(['Left', 'Top', 'Right']);
  const data = await fetchViews(doc, q);
  const centre = (v: DView) => { const g = data[v.id]!; const sc = viewScale(doc, v); return { g, sc }; };

  // Left and Right: the two shaft axes (the hub's and the off-axis shaft's) are two of the axes found, and they are pick targets
  for (const label of ['Left', 'Right']) {
    const v = doc.views.find((x) => x.label === label)!;
    const { g, sc } = centre(v);
    const axes = centerFeatures(g, v, sc).flatMap((f) => (f.kind === 'axis' ? [f] : []));
    expect(axes.length).toBeGreaterThanOrEqual(2);
    // the off-axis shaft runs down from the disc, the hub shaft goes up: their ranges do not overlap along the axis
    const tall = axes.filter((a) => Math.abs(a.q[1] - a.p[1]) > 5);
    expect(tall.length).toBe(2);
    const picks: DimPick[] = tall.map((a) => pickTarget(g, v, [(a.p[0] + a.q[0]) / 2, (a.p[1] + a.q[1]) / 2], 0.4 / sc, sc)!.pick);
    expect(picks.every((p) => typeof p === 'object' && 'axis' in p)).toBe(true);
    const d = dimFromPicks(g, v.id, picks, { v, scale: sc, others: doc.dims.filter((x) => x.view === v.id) })!;
    expect(d.kind).toBe('linear');
    expect(d.orient).toBe('h');
    expect(Math.abs(d.b![0] - d.a[0])).toBeCloseTo(AXIS_OFFSET, 6);
    // it goes outside the existing overall dimension of the view, not over it
    const overall = doc.dims.find((x) => x.view === v.id && x.overall === 'w')!;
    expect(d.offset).toBeGreaterThan(overall.offset);
    expect(dimMeasure(d, doc)).toBe('2.99');
    // Select hits the centre line itself, never the view behind it
    const withDim = { ...doc, dims: [...doc.dims, d] };
    const prims = renderSheet({ doc: withDim, data });
    const P = placer(withDim, v, g);
    const a = [...tall].sort((m, n) => n.p[1] + n.q[1] - (m.p[1] + m.q[1]))[0];   // the hub shaft, above the dimension's extension lines
    const hit = hitAnnotation(prims, P((a.p[0] + a.q[0]) / 2, (a.p[1] + a.q[1]) / 2), 1);
    expect(hit?.kind).toBe('center');
    expect(hit?.view).toBe(v.id);
  }

  // Top: centre marks of the hub circle (at the origin) and of the cross hole; distance between the two marks
  const top = doc.views.find((x) => x.label === 'Top')!;
  const { g, sc } = centre(top);
  const marks = centerFeatures(g, top, sc).flatMap((f) => (f.kind === 'mark' ? [f] : []));
  const hub = marks.find((m) => Math.hypot(m.c[0], m.c[1]) < 1e-6)!;
  const hole = marks.find((m) => Math.abs(m.r - 0.5) < 1e-6)!;
  expect(hub && hole).toBeTruthy();
  const mp = (m: { c: [number, number]; r: number }): DimPick => pickTarget(g, top, [m.c[0] + 0.1 / sc, m.c[1] + 0.1 / sc], 0.4 / sc, sc)!.pick;
  const pk = [mp(hub), mp(hole)];
  expect(pk.every((p) => typeof p === 'object' && 'mark' in p)).toBe(true);
  const dm = dimFromPicks(g, top.id, pk, { v: top, scale: sc })!;
  expect(Math.abs(dm.b![0] - dm.a[0])).toBeCloseTo(Math.abs(hole.c[0] - hub.c[0]), 6);
  expect(Math.abs(hole.c[0] - hub.c[0])).toBeCloseTo(4.067, 6);

  // the tester's own drawing is untouched by all this: its existing dimensions still refresh without loss
  expect(refreshDims(doc, data).lost).toEqual([]);

  // the dimension between the shaft axes follows a change of the part (the off-axis shaft moves)
  const v1 = doc.views.find((x) => x.label === 'Left')!;
  const { g: g1, sc: sc1 } = centre(v1);
  const tall = centerFeatures(g1, v1, sc1).flatMap((f) => (f.kind === 'axis' && Math.abs(f.q[1] - f.p[1]) > 5 ? [f] : []));
  const d1 = dimFromPicks(g1, v1.id, tall.map((a): DimPick => ({ axis: a.edges })), { v: v1, scale: sc1 })!;
  const moved = clone(STEPPED_PART) as unknown as { features: Array<{ id: string; points?: Array<{ id: string; x: number; y: number }> }> };
  moved.features.find((f) => f.id === 'F5')!.points!.find((p) => p.id === 'p1')!.y = 4;
  const s2 = await Session.open(moved as unknown as PartDoc); sessions.push(s2);
  const data2 = await fetchViews(doc, drawingQuery(s2));
  const re = refreshDims({ ...doc, dims: [d1] }, data2);
  expect(re.lost).toEqual([]);
  expect(Math.abs(re.dims[0].b![0] - re.dims[0].a[0])).toBeCloseTo(4, 6);
}, 120000);
