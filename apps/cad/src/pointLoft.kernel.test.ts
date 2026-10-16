import { afterEach, describe, expect, it } from 'vitest';
import { Session, type EditResult } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import type { Ctx, FeatureActions } from './featureCommands';
import { creatorCommands, isPointSketch, loftOps, loftPointIssue, loftProfileIds } from './featureCreators';
import { sketchInfos } from './surfaceRules';

type Wire = Record<string, unknown>;
// the boat hull: closed spline stations [x, half-beam, depth, deck] on planes offset from Right, then a bow point
const STATIONS = [[-60, 6, 5, 3], [-35, 15, 9, 4], [0, 18, 12, 5], [30, 13, 9, 5.5]];
function hull(extra: { pointAt?: number; skipPoint?: boolean } = {}): Wire[] {
  const feats: Wire[] = []; let n = 0;
  const id = () => 'F' + (++n);
  for (const [x, w, d, h] of STATIONS) {
    const pl = { type: 'plane', id: id(), name: 'Station ' + x, mode: 'offset', base: { kind: 'std', id: 'right' }, offset: x };
    const P = [[0, h], [0.55 * w, h + 0.4], [w, h - 1], [0.97 * w, -0.3 * d], [0.6 * w, -0.8 * d], [0, -d], [-0.6 * w, -0.8 * d], [-0.97 * w, -0.3 * d], [-w, h - 1], [-0.55 * w, h + 0.4]];
    feats.push(pl, {
      type: 'sketch', id: id(), name: 'Section ' + x, plane: { kind: 'feature', id: pl.id },
      points: [{ id: 'O', x: 0, y: 0, fixed: true }, ...P.map(([u, v], i) => ({ id: 'p' + (i + 1), x: u, y: v }))],
      entities: [{ id: 'e1', type: 'spline', pts: P.map((_, i) => 'p' + (i + 1)), closed: true }], constraints: [],
    });
  }
  if (!extra.skipPoint) {
    const pl = { type: 'plane', id: id(), name: 'Bow', mode: 'offset', base: { kind: 'std', id: 'right' }, offset: extra.pointAt ?? 62 };
    feats.push(pl, {
      type: 'sketch', id: id(), name: 'Sketch on Bow', plane: { kind: 'feature', id: pl.id },
      points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: 0, y: 2 }], entities: [{ id: 'e1', type: 'point', p: 'p1' }], constraints: [],
    });
  }
  return feats;
}
const partOf = (features: Wire[]): PartDoc => ({ ...emptyPart('Boat'), features, seq: features.length + 1 }) as unknown as PartDoc;

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function world(doc: PartDoc, selectedIds?: string[]) {
  const store = createStore();
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view, kernel });
  await controller.load(doc);
  const pending: Promise<unknown>[] = [];
  const results: EditResult[] = [];
  const actions: FeatureActions = {
    context: (): Ctx => ({ doc: controller.document(), selection: store.selection.value, mode: store.mode.value, box: controller.bodyBox(), edges: controller.bodyEdges(), selectedIds }),
    create: (ops) => { pending.push(controller.edit(ops).then((r) => { results.push(r); })); },
    holeOnFace: () => {}, addThread: () => {}, holeFlip: () => false, notify: () => {},
  };
  const cmds = creatorCommands(actions);
  const cmd = (cid: string) => cmds.find((c) => c.id === cid)!;
  const run = async (cid: string) => { cmd(cid).run(); await Promise.all(pending.splice(0)); return results.at(-1)!; };
  return { cmd, run, controller };
}

describe('point sections: profile rules', () => {
  const isPoint = (set: string[]) => (id: string) => set.includes(id);
  it('a point first or last is fine', () => {
    expect(loftPointIssue(['P', 'A', 'B'], isPoint(['P']))).toBeNull();
    expect(loftPointIssue(['A', 'B', 'P'], isPoint(['P']))).toBeNull();
    expect(loftPointIssue(['A', 'B'], isPoint([]))).toBeNull();
  });
  it('a point in the middle is refused', () => {
    expect(loftPointIssue(['A', 'P', 'B'], isPoint(['P']))).toBe('loftPointMiddle');
  });
  it('two points are refused, even at both ends', () => {
    expect(loftPointIssue(['P', 'A', 'Q'], isPoint(['P', 'Q']))).toBe('loftPointBoth');
    expect(loftPointIssue(['P', 'Q'], isPoint(['P', 'Q']))).toBe('loftPointBoth');
  });
  it('a sketch with one point (construction ignored) is a point sketch, a point plus a line is not', () => {
    const f = (entities: unknown[]) => ({ id: 's', type: 'sketch', entities }) as never;
    expect(isPointSketch(f([{ id: 'a', type: 'point', p: 'p1' }]))).toBe(true);
    expect(isPointSketch(f([{ id: 'a', type: 'point', p: 'p1' }, { id: 'b', type: 'line', p1: 'p1', p2: 'p2', construction: true }]))).toBe(true);
    expect(isPointSketch(f([{ id: 'a', type: 'point', p: 'p1' }, { id: 'b', type: 'line', p1: 'p1', p2: 'p2' }]))).toBe(false);
    expect(isPointSketch(f([]))).toBe(false);
  });
  it('the point sketch is a loft profile: default list and tree selection', () => {
    const doc = partOf(hull());
    const c = { doc, selection: [], mode: 'body', box: null, edges: [] } as unknown as Ctx;
    const ids = loftProfileIds(c);
    expect(ids).toHaveLength(5);
    expect(ids.at(-1)).toBe('F10');
    expect(loftOps(c)).not.toBeNull();
    expect(sketchInfos(doc).filter((s) => s.point).map((s) => s.id)).toEqual(['F10']);
    expect(loftProfileIds({ ...c, selectedIds: ['F10', 'F2', 'F4'] } as Ctx)).toEqual(['F10', 'F2', 'F4']);
  });
});

describe('boat hull through the Loft creator', () => {
  it('four closed spline stations and a point apex make a valid solid', async () => {
    const w = await world(partOf(hull()));
    expect(w.cmd('add-loft').enabled!()).toBe(true);
    const r = await w.run('add-loft');
    expect(r.ok).toBe(true);
    const doc = w.controller.document()!;
    const loft = doc.features.at(-1) as unknown as Wire;
    expect(loft.type).toBe('loft');
    expect((loft.sketches as string[]).length).toBe(5);
    const s = sessions.at(-1)!;
    const report = await s.verify();
    expect(report.regen.errors).toEqual([]);
    const mp = (await s.massProps()) as { volume: number };
    expect(mp.volume).toBeGreaterThan(0);
    expect(JSON.stringify(report)).not.toMatch(/"valid":\s*false/);
  }, 60000);

  it('a point in the middle is refused by the kernel and the editor keeps the draft', async () => {
    const doc = partOf(hull());
    const w = await world(doc);
    const r = await w.controller.edit([{ op: 'add', feature: { type: 'loft', op: 'add', sketches: ['F2', 'F10', 'F4', 'F6'] } }]);
    expect(r.ok).toBe(false);
    expect(w.controller.rejection()?.summary).toBeTruthy();
  }, 60000);
});
