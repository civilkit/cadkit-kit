import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import { featureCommands, type Ctx, type FeatureActions } from './featureCommands';
import './locales/en';

const petalRing = (): PartDoc => {
  const N = 5, Rc = 10, tm = 30, rho = 8.83044266165705;
  const alpha = Math.atan2(rho, tm), d = Math.hypot(tm, rho), th0 = Math.PI / 2 - alpha;
  const points: Array<{ id: string; x: number; y: number }> = [], entities: Array<Record<string, unknown>> = [], ids = new Map<string, string>();
  const P = (p: number[]) => { const k = p.map((v) => v.toFixed(7)).join(','); if (!ids.has(k)) { ids.set(k, 'p' + (ids.size + 1)); points.push({ id: ids.get(k)!, x: p[0], y: p[1] }); } return ids.get(k)!; };
  const at = (a: number, r: number) => [r * Math.cos(a), r * Math.sin(a)];
  let n = 0;
  const line = (a: number[], b: number[]) => entities.push({ type: 'line', id: 'e' + ++n, p1: P(a), p2: P(b) });
  const arc = (c: number[], a: number[], b: number[]) => { const cid = 'c' + n; points.push({ id: cid, x: c[0], y: c[1] }); entities.push({ type: 'arc', id: 'e' + ++n, c: cid, p1: P(a), p2: P(b) }); };
  for (let i = 0; i < N; i++) {
    const th = th0 + (2 * Math.PI * i) / N, thn = th + (2 * Math.PI) / N;
    line(at(th - alpha, Rc), at(th - alpha, tm));
    arc(at(th, d), at(th - alpha, tm), at(th + alpha, tm));
    line(at(th + alpha, tm), at(th + alpha, Rc));
    arc([0, 0], at(th + alpha, Rc), at(thn - alpha, Rc));
  }
  return { ...emptyPart('Petals'), features: [{ type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'top' }, points, entities, constraints: [] }, { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 10 }], seq: 3 } as unknown as PartDoc;
};

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function world(doc: PartDoc) {
  const store = createStore();
  let body: { mesh: { faceIds: string[] } } | null = null;
  const view: ViewSink = { setBody(b) { body = b as never; }, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view, kernel });
  await controller.load(doc);
  const pending: Promise<unknown>[] = [];
  const actions: FeatureActions = {
    context: (): Ctx => ({ doc: controller.document(), selection: store.selection.value, mode: store.mode.value, box: controller.bodyBox(), edges: controller.bodyEdges(), selectedId: null, tangentChain: true }),
    create: (ops) => { pending.push(controller.edit(ops)); },
    holeOnFace: () => {}, addThread: () => {}, holeFlip: (id) => controller.extrudeFlip(id, 'cut'), notify: () => {},
  };
  const cmds = featureCommands(actions);
  const run = async (id: string) => { cmds.find((c) => c.id === id)!.run(); await Promise.all(pending.splice(0)); };
  const stats = async () => {
    const s = sessions.at(-1)!;
    const report = await s.verify();
    const mass = (await s.massProps()) as { volume: number };
    return { errors: report.regen.errors.map(([id, e]) => `${id}:${e.code}`), volume: mass.volume, faces: new Set(body?.mesh.faceIds).size };
  };
  return { store, controller, run, stats, select: (names: string[]) => { store.mode.value = 'edge'; store.select(names); }, doc: () => controller.document()! };
}

type Ref = { faces: string[]; at: number[] };
type Fillet = { id: string; edges: Ref[] };
const pairs = (refs: Ref[]) => refs.map((r) => [...r.faces].sort().join('|')).sort();
type Edge = { key?: string; faces?: string[]; pts?: number[][] };
/** The edge of `edges` a reference names: the nearest one between the same two faces (null when none is). */
const edgeOf = (r: Ref, edges: Edge[]): string | null => {
  let best: { d: number; key: string } | null = null;
  for (const e of edges) {
    if (!e.key || !e.pts?.length || e.faces?.length !== 2 || !r.faces.every((f) => e.faces!.includes(f))) continue;
    const d = Math.min(...e.pts.map((p) => Math.hypot(...p.map((v, i) => v - r.at[i]))));
    if (!best || d < best.d) best = { d, key: e.key };
  }
  return best?.key ?? null;
};

describe('Fillet editor: edges added to a saved fillet later', { skip: !process.env.CK_WASM }, () => {
  // On the hub-and-petals body: the rim of one hub arc (e4) and of the flank next to it (e1), picked with Tangent chain on, round
  // e1, its petal end e2 and the far flank e3 as well. The fillet is saved, then its editor adds the rim of the flank on the other side
  // of the hub arc (e5), clicked on the body on screen, which has the fillet applied: there the hub arc's round has cut e5's rim into a
  // long edge and a short stub at the end of the round, and neither the stub nor the round's own edges exist on the body the fillet is
  // applied to.
  const rimKey = (edges: Array<{ key?: string; faces?: string[]; pts?: number[][] }>, f: string) => edges.find((e) => e.faces?.includes('F2.C1') && e.faces.includes(f))!.key!;

  async function subsetSaved() {
    const w = await world(petalRing());
    const edges = w.controller.bodyEdges();
    w.select([rimKey(edges, 'F2.S.e4'), rimKey(edges, 'F2.S.e1')]);
    await w.run('add-fillet');
    const f = w.doc().features.at(-1) as unknown as Fillet;
    expect(pairs(f.edges)).toEqual(['F2.C1|F2.S.e1', 'F2.C1|F2.S.e2', 'F2.C1|F2.S.e3', 'F2.C1|F2.S.e4']);
    expect((await w.stats()).errors).toEqual([]);
    return { w, f };
  }

  async function pickedAllAtOnce() {
    const w = await world(petalRing());
    const edges = w.controller.bodyEdges();
    w.select(['F2.S.e4', 'F2.S.e1', 'F2.S.e5'].map((f) => rimKey(edges, f)));
    await w.run('add-fillet');
    const f = w.doc().features.at(-1) as unknown as Fillet;
    return { f, stats: await w.stats() };
  }

  for (const which of ['long', 'stub'] as const) {
    it(`adding the next flank's rim (the ${which} piece on screen) gives what picking it with the others at once gives`, async () => {
      const { w, f } = await subsetSaved();
      const shown = w.controller.shownEdges();
      const e5 = shown.filter((e) => e.faces?.includes('F2.C1') && e.faces.includes('F2.S.e5'));
      expect(e5.length).toBe(2);   // the round of e4 split e5's rim
      const len = (e: { pts?: number[][] }) => e.pts!.slice(1).reduce((s, p, i) => s + Math.hypot(...p.map((v, k) => v - e.pts![i][k])), 0);
      e5.sort((a, b) => len(b) - len(a));
      const name = (which === 'long' ? e5[0] : e5[1]).key!;
      const r = await w.controller.pickIntoList(f.id, 'edges', () => f.edges, () => [], [name], true, false);
      expect(r).not.toBeNull();
      const value = r!.value as Ref[];
      // one chip per edge: each entry names an edge of the body the fillet is applied to, and no two entries name the same edge
      const before = await w.controller.edgesBefore(f.id);
      const keys = value.map((x) => edgeOf(x, before));
      expect(keys.filter((k) => k === null)).toEqual([]);
      expect(keys.length - new Set(keys).size).toBe(0);
      // every edge once, and only edges of the body the fillet is applied to
      expect(pairs(value)).toEqual(['F2.C1|F2.S.e1', 'F2.C1|F2.S.e2', 'F2.C1|F2.S.e3', 'F2.C1|F2.S.e4', 'F2.C1|F2.S.e5', 'F2.C1|F2.S.e6', 'F2.C1|F2.S.e7']);
      expect(value.slice(0, 4)).toEqual(f.edges);   // the saved edges stay as they were
      const p = await w.controller.preview([{ op: 'set', id: f.id, path: 'edges', value }], 0);
      expect(p.ok).toBe(true);
      const c = await w.controller.commit([{ op: 'set', id: f.id, path: 'edges', value }]);
      expect(c.ok).toBe(true);
      const after = await w.stats();
      expect(after.errors).toEqual([]);

      const once = await pickedAllAtOnce();
      expect(once.stats.errors).toEqual([]);
      expect(pairs(value)).toEqual(pairs(once.f.edges));
      expect(after.faces).toBe(once.stats.faces);
      expect(after.volume).toBeCloseTo(once.stats.volume, 6);
    }, 120000);
  }

  it('picking all the edges at once still rounds them all', async () => {
    const once = await pickedAllAtOnce();
    expect(once.stats.errors).toEqual([]);
    expect(pairs(once.f.edges)).toEqual(['F2.C1|F2.S.e1', 'F2.C1|F2.S.e2', 'F2.C1|F2.S.e3', 'F2.C1|F2.S.e4', 'F2.C1|F2.S.e5', 'F2.C1|F2.S.e6', 'F2.C1|F2.S.e7']);
    expect(once.stats.volume).toBeLessThan(22192.05);   // more rounded than the subset (22192.05 mm3)
  }, 120000);
});
