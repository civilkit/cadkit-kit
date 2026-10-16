// The boat hull built the way the UI builds it: Plane tool with the Right plane selected, offset edited, sketches on those planes,
// then the Loft tool on a selection that is NOT in axis order. The loft must come to a clean tip at the extreme plane.
import { afterEach, describe, expect, it } from 'vitest';
import { Session, type EditResult } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import type { Ctx, FeatureActions } from './featureCommands';
import { creatorCommands, featureLabel, loftAutoOrder, planeOps } from './featureCreators';

type Wire = Record<string, unknown>;
const STATIONS = [[-60, 6, 5, 3], [-35, 15, 9, 4], [0, 18, 12, 5], [30, 13, 9, 5.5]];
const section = (w: number, d: number, h: number) => [[0, h], [.55 * w, h + .4], [w, h - 1], [.97 * w, -.3 * d], [.6 * w, -.8 * d], [0, -d], [-.6 * w, -.8 * d], [-.97 * w, -.3 * d], [-w, h - 1], [-.55 * w, h + .4]].map(([u, v]) => [Math.round(u), Math.round(v)]);
const splineSketch = (id: string, plane: string, P: number[][]): Wire => ({
  type: 'sketch', id, name: 'Sketch on x', autoName: true, plane: { kind: 'feature', id: plane }, constraints: [],
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, ...P.map(([x, y], i) => ({ id: 'p' + (i + 1), x, y }))],
  entities: [{ id: 'e1', type: 'spline', pts: P.map((_, i) => 'p' + (i + 1)), closed: true }],
});
const pointSketch = (id: string, plane: string): Wire => ({
  type: 'sketch', id, name: 'Sketch on x', autoName: true, plane: { kind: 'feature', id: plane }, constraints: [],
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: 0, y: 2 }], entities: [{ id: 'e1', type: 'point', p: 'p1' }],
});

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function build(order: 'tree' | 'shuffled') {
  const store = createStore();
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view, kernel });
  await controller.load({ ...emptyPart('Hull') } as PartDoc);
  const ctx = (extra: Partial<Ctx> = {}): Ctx => ({ doc: controller.document(), selection: [], mode: store.mode.value, box: null, edges: [], refPlane: 'right', ...extra } as unknown as Ctx);
  const results: EditResult[] = [];
  const pending: Promise<unknown>[] = [];
  const actions = (selectedIds?: string[]): FeatureActions => ({
    context: () => ctx({ selectedIds }), create: (ops) => { pending.push(controller.edit(ops).then((r) => { results.push(r); })); },
    holeOnFace: () => {}, addThread: () => {}, holeFlip: () => false, notify: () => {},
  });
  const planeIds: string[] = [];
  // the Plane tool (Right plane picked in the tree), then the Offset field of the editor, as the film does
  for (const [x] of [...STATIONS, [62]]) {
    const ops = planeOps(ctx())!;
    expect((ops[0] as unknown as { feature: Wire }).feature.base).toEqual({ kind: 'std', id: 'right' });
    expect((await controller.edit(ops)).ok).toBe(true);
    const id = (controller.document()!.features.at(-1) as unknown as Wire).id as string;
    planeIds.push(id);
    expect((await controller.edit([{ op: 'set', id, path: 'offset', value: x }])).ok).toBe(true);
  }
  const sk: string[] = [];
  for (const [i, [, w, d, h]] of STATIONS.entries()) {
    const pid = planeIds[i];
    expect((await controller.edit([{ op: 'add', feature: splineSketch('S' + i, pid, section(w, d, h)) as never }])).ok).toBe(true);
    sk.push((controller.document()!.features.at(-1) as unknown as Wire).id as string);
  }
  expect((await controller.edit([{ op: 'add', feature: pointSketch('SP', planeIds[4]) as never }])).ok).toBe(true);
  const SP = (controller.document()!.features.at(-1) as unknown as Wire).id as string;
  const picked = order === 'tree' ? [...sk, SP] : [SP, sk[2], sk[0], sk[3], sk[1]];
  const cmd = creatorCommands(actions(picked)).find((c) => c.id === 'add-loft')!;
  cmd.run(); await Promise.all(pending.splice(0));
  return { controller, results, planeIds, sk, SP, session: sessions.at(-1)! };
}

async function expectTip(w: Awaited<ReturnType<typeof build>>) {
  expect(w.results.at(-1)!.ok).toBe(true);
  const loft = w.controller.document()!.features.at(-1) as unknown as Wire;
  expect(loft.type).toBe('loft');
  const fwd = [...w.sk, w.SP];
  expect([fwd, [...fwd].reverse()]).toContainEqual(loft.sketches);   // along the axis, either way (a point section is an end)
  const pos = [-59, -40, -20, 0, 20, 30, 35, 45, 55, 60, 61, 61.8, 61.99, 62.5];
  const r = await w.session.sections({ axis: 'x', positions: pos, exact: false });
  const a = r.areas;
  // the area peaks inside the stations, then falls to the tip and stays zero beyond the apex plane
  const peak = a.indexOf(Math.max(...a));
  expect(pos[peak]).toBeGreaterThanOrEqual(-20); expect(pos[peak]).toBeLessThanOrEqual(20);
  for (let i = peak; i < pos.indexOf(61.99); i++) expect(a[i + 1]).toBeLessThanOrEqual(a[i] + 1e-6);
  expect(a[pos.indexOf(61.99)]).toBeLessThan(0.01);
  expect(a[pos.indexOf(62.5)]).toBeLessThan(1e-6);
  const report = await w.session.verify();
  expect(report.regen.errors).toEqual([]);
  expect(JSON.stringify(report)).not.toMatch(/"valid":\s*false/);
}

describe('boat hull as the UI builds it', () => {
  it('planes follow the picked Right plane, offsets and generated names are true', async () => {
    const w = await build('tree');
    const doc = w.controller.document()!;
    const planes = (doc.features as unknown as Wire[]).filter((f) => f.type === 'plane');
    expect(planes.map((p) => p.offset)).toEqual([-60, -35, 0, 30, 62]);
    for (const p of planes) { expect(p.base).toEqual({ kind: 'std', id: 'right' }); expect(p.name).toBe(`Plane ${p.offset} from Right`); expect(featureLabel(doc, p as never)).toBe(p.name); }
    const sks = (doc.features as unknown as Wire[]).filter((f) => f.type === 'sketch');
    expect(sks.length).toBe(5);
  }, 60000);

  it('the offset edit renames the plane and the sketch standing on it', async () => {
    const w = await build('tree');
    const id = w.planeIds[4];
    expect((await w.controller.edit([{ op: 'set', id, path: 'offset', value: 64 }])).ok).toBe(true);
    const fs = w.controller.document()!.features as unknown as Wire[];
    expect(fs.find((f) => f.id === id)!.name).toBe('Plane 64 from Right');
    expect(fs.find((f) => f.id === w.SP)!.name).toBe('Sketch on Plane 64 from Right');
  }, 60000);

  it('clean tip when the sketches are picked in tree order', async () => { await expectTip(await build('tree')); }, 60000);
  it('clean tip when the selection has the point first and the sections shuffled (the Loft tool sorts along the axis)', async () => { await expectTip(await build('shuffled')); }, 60000);
});

describe('loftAutoOrder', () => {
  const pl = (id: string, off: number) => ({ type: 'plane', id, mode: 'offset', base: { kind: 'std', id: 'right' }, offset: off });
  const sk = (id: string, plane: string) => ({ type: 'sketch', id, plane: { kind: 'feature', id: plane }, entities: [] });
  const doc = { features: [pl('A', 0), sk('a', 'A'), pl('B', 10), sk('b', 'B'), pl('C', 20), sk('c', 'C'), pl('D', 30), sk('d', 'D')] } as unknown as Ctx['doc'];
  it('monotone either way: nothing to fix', () => {
    expect(loftAutoOrder(doc, ['a', 'b', 'c', 'd'])).toBeNull();
    expect(loftAutoOrder(doc, ['d', 'c', 'b', 'a'])).toBeNull();
  });
  it('out of order: sorted along the axis, direction of the list kept', () => {
    expect(loftAutoOrder(doc, ['a', 'c', 'b', 'd'])).toEqual(['a', 'b', 'c', 'd']);
    expect(loftAutoOrder(doc, ['d', 'b', 'c', 'a'])).toEqual(['d', 'c', 'b', 'a']);
  });
  it('unreadable positions give no answer', () => {
    const d2 = { features: [...(doc as unknown as { features: unknown[] }).features, { type: 'sketch', id: 'z', plane: { kind: 'face', id: 'F1.f0' }, entities: [] }] } as unknown as Ctx['doc'];
    expect(loftAutoOrder(d2, ['a', 'c', 'b', 'z'])).toBeNull();
  });
});
