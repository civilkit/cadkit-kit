import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../controller';
import { massView, densityOf, type MassRaw } from './mass';
import { measure, resolvePick, type MeasureCtx } from './measure';

const rect = (w: number, h: number) => ({ type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' },
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: 0, y: 0 }, { id: 'p2', x: w, y: 0 }, { id: 'p3', x: w, y: h }, { id: 'p4', x: 0, y: h }],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b })), constraints: [] });
const boxDoc = (w: number, h: number, d: number, material = 'aluminium'): PartDoc =>
  ({ ...emptyPart('Box', material), features: [rect(w, h), { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: d }], seq: 3 }) as unknown as PartDoc;
const cylDoc = (): PartDoc => ({ ...emptyPart('Cyl'), features: [
  { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'c', x: 0, y: 0 }], entities: [{ id: 'e1', type: 'circle', c: 'c', r: 5 }], constraints: [] },
  { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 8 }], seq: 3 }) as unknown as PartDoc;

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
async function load(doc: PartDoc) {
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const c = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  await c.load(doc);
  const ctx = (): MeasureCtx => ({ edges: c.bodyEdges(), mesh: c.bodyFaces(), kernel: (refs) => c.measure(refs) });
  return { c, ctx };
}
const rowOf = (o: { rows: Array<{ id: string; value: unknown }> }, id: string) => o.rows.find((r) => r.id === id)?.value;

describe('Inspect against the kernel', () => {
  it('mass properties of a 30 x 20 x 10 aluminium box: volume, area, centre, bounding box, moments, mass', async () => {
    const { c } = await load(boxDoc(30, 20, 10));
    const raw = (await c.massProps()) as MassRaw;
    expect(raw.volume).toBeCloseTo(6000, 6);
    expect(raw.area).toBeCloseTo(2 * (600 + 300 + 200), 6);
    // the extrusion runs from the front plane toward +Z; x and y span the sketch
    expect(raw.com![0]).toBeCloseTo(15, 6); expect(raw.com![1]).toBeCloseTo(10, 6); expect(raw.com![2]).toBeCloseTo(5, 6);
    const box = c.bodyBox()!;
    expect(box.min).toEqual([0, 0, 0]); expect(box.max).toEqual([30, 20, 10]);
    const dens = densityOf('aluminium')!;
    const v = massView(raw, dens);
    expect(v.mass).toBeCloseTo(6000 * 2.7 / 1000, 6);   // 16.2 g
    // principal moments of a cuboid, I = m (a^2 + b^2) / 12, sorted ascending
    const m = v.mass;
    const want = [(30 ** 2 + 20 ** 2), (30 ** 2 + 10 ** 2), (20 ** 2 + 10 ** 2)].map((s) => (m * s) / 12).sort((a, b) => a - b);
    expect(v.principal.length).toBe(3);
    v.principal.forEach((x, i) => expect(x).toBeCloseTo(want[i], 4));
  }, 60000);

  it('measures distances between known corners, an edge length and the angle between faces', async () => {
    const { c, ctx } = await load(boxDoc(30, 20, 10));
    const edges = c.bodyEdges();
    const corner = (x: number, y: number, z: number) => resolvePick(`v:${x},${y},${z}`, edges)!;
    const d = await measure([corner(0, 0, 0), corner(30, 20, 10)], ctx());
    expect(rowOf(d, 'distance') as number).toBeCloseTo(Math.hypot(30, 20, 10), 9);
    expect(d.marks.length).toBe(1);
    // an edge of the 30 mm side
    const e30 = edges.find((e) => e.pts && Math.abs(e.pts[0][0] - e.pts[e.pts.length - 1][0]) === 30)!;
    const len = await measure([resolvePick(e30.key!, edges)!], ctx());
    expect(rowOf(len, 'length') as number).toBeCloseTo(30, 9);
    // a face: area from the kernel, plane surface
    const ids = c.bodyFaces()!.faceIds;
    const areas = [] as number[];
    for (const id of ids) { const o = await measure([resolvePick(id, edges)!], ctx()); areas.push(rowOf(o, 'area') as number); expect(o.surface).toBe('plane'); }
    expect(areas.map((a) => Math.round(a)).sort((a, b) => a - b)).toEqual([200, 200, 300, 300, 600, 600]);
    // two faces at a right angle
    const pairs = ids.flatMap((a, i) => ids.slice(i + 1).map((b) => [a, b]));
    let right = 0, parallel = 0;
    for (const [a, b] of pairs) {
      const o = await measure([resolvePick(a, edges)!, resolvePick(b, edges)!], ctx());
      const ang = rowOf(o, 'angle') as number;
      if (Math.abs(ang - 90) < 1e-6) right++;
      if (Math.abs(ang) < 1e-6 || Math.abs(ang - 180) < 1e-6) { parallel++; expect([10, 20, 30]).toContainEqual(expect.closeTo(rowOf(o, 'distance') as number, 6)); }
    }
    expect(right).toBe(12); expect(parallel).toBe(3);
  }, 60000);

  it('a circular edge gives radius and diameter; a cylinder face its radius', async () => {
    const { c, ctx } = await load(cylDoc());
    const edges = c.bodyEdges();
    const o = await measure([resolvePick(edges[0].key!, edges)!], ctx());
    expect(rowOf(o, 'radius')).toBeCloseTo(5, 9);
    expect(rowOf(o, 'diameter')).toBeCloseTo(10, 9);
    expect(rowOf(o, 'length') as number).toBeCloseTo(2 * Math.PI * 5, 9);
    const cyl = c.bodyFaces()!.faceIds.find((f) => f.includes('.S.'))!;
    const f = await measure([resolvePick(cyl, edges)!], ctx());
    expect(f.surface).toBe('cylinder');
    expect(rowOf(f, 'radius')).toBeCloseTo(5, 9);
    expect(rowOf(f, 'area') as number).toBeCloseTo(2 * Math.PI * 5 * 8, 6);
  }, 60000);

  it('interference of a single solid answers with no pairs', async () => {
    const { c } = await load(boxDoc(10, 10, 10));
    const r = await c.interference();
    expect(r).toEqual({ bodies: 1, pairs: [] });
  }, 60000);
});
