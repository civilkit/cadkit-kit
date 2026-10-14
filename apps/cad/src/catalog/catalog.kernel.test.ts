import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from '../controller';
import { CATALOG, buildShape as build, catalogItem, type BuildResult, type BuiltShape, type PlaceTarget } from './shapes';
const buildShape = (...a: Parameters<typeof build>): BuiltShape => { const r: BuildResult = build(...a); if ('error' in r) throw new Error(r.error); return r; };
import { faceInfos, raycast, type MeshArrays } from './geometry';

type Wire = Record<string, unknown>;
const rect = (id: string, x0: number, y0: number, x1: number, y1: number) => ({
  type: 'sketch', id, plane: { kind: 'std', id: 'front' },
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: x0, y: y0 }, { id: 'p2', x: x1, y: y0 }, { id: 'p3', x: x1, y: y1 }, { id: 'p4', x: x0, y: y1 }],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([id, a, b]) => ({ id, type: 'line', p1: a, p2: b })), constraints: [],
});
const slab = (): PartDoc => ({
  ...emptyPart('Slab'),
  features: [rect('F1', 0, 0, 80, 60), { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 20 }],
  seq: 3,
}) as unknown as PartDoc;
const cylinderDoc = (): PartDoc => ({
  ...emptyPart('Cyl'),
  features: [
    { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'c', x: 0, y: 0 }], entities: [{ id: 'k1', type: 'circle', c: 'c', r: 20 }], constraints: [] },
    { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 50 },
  ],
  seq: 3,
}) as unknown as PartDoc;

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function world(doc: PartDoc) {
  const store = createStore();
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view, kernel });
  await controller.load(doc);
  const stats = async () => {
    const s = sessions.at(-1)!;
    const report = await s.verify();
    let volume: number | null = null;
    try { volume = ((await s.massProps()) as { volume: number }).volume; } catch { /* no solid */ }
    return { errors: report.regen.errors.map(([id, e]) => `${id}:${e.code}`), volume };
  };
  return { controller, stats, session: () => sessions.at(-1)! };
}
const BOX = 80 * 60 * 20;

/** The frame the kernel gives a sketch on `face`, found the way the app does: preview a probe shape and read its sketch. */
async function frameOf(w: Awaited<ReturnType<typeof world>>, face: string) {
  const probe = buildShape(catalogItem('add-block')!, { kind: 'face', face, planar: true, frame: { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }, point: [0, 0, 0] }, w.controller.document()!.seq)!;
  const r = await w.controller.preview(probe.ops, 0);
  const sk = (r.body?.sketches ?? r.sketches ?? []).find((s: { id: string }) => s.id === probe.sketchId);
  return sk!.frame as { o: number[]; x: number[]; y: number[]; z: number[] };
}

describe('catalog shapes against the real kernel', { skip: !process.env.CK_WASM, timeout: 180000 }, () => {
  it('every shape dropped on the top face of a slab is valid and adds or removes the right volume', async () => {
    for (const item of CATALOG) {
      const w = await world(slab());
      const face = 'F2.C1';
      const frame = await frameOf(w, face);
      const target: PlaceTarget = { kind: 'face', face, planar: true, frame, point: [40, 30, 20], extent: [80, 60], thickness: 20 };
      const built = buildShape(item, target, w.controller.document()!.seq);
      const before = w.session().history().length;
      const r = await w.controller.commit(built.ops);
      expect(r.ok, item.id + ' ' + JSON.stringify((r as { hints?: unknown }).hints)).toBe(true);
      expect(w.session().history().length - before, item.id + ' is one undo step').toBe(1);
      const s = await w.stats();
      expect(s.errors, item.id).toEqual([]);
      if (item.op === 'add') expect(s.volume!, item.id).toBeGreaterThan(BOX + 1);
      else expect(s.volume!, item.id).toBeLessThan(BOX - 1);
      // the shape has a surface on screen (the kernel once left a trimmed sphere face without triangles)
      const bf = w.controller.bodyFaces()!;
      const own = new Set(Array.from(bf.triFace).map((f) => bf.faceIds[f]).filter((n) => n.startsWith(built.mainId + '.')));
      expect(own.size, item.id + ' has faces in the mesh').toBeGreaterThan(0);
    }
  });

  it('uv placement: a block dropped at the corner vertex of the top face is centred there, on the right side of the slab', async () => {
    const w = await world(slab());
    const frame = await frameOf(w, 'F2.C1');
    const target: PlaceTarget = { kind: 'face', face: 'F2.C1', planar: true, frame, point: [80, 60, 20], extent: [80, 60], thickness: 20 };
    const built = buildShape(catalogItem('add-block')!, target, w.controller.document()!.seq);
    expect((await w.controller.commit(built.ops)).ok).toBe(true);
    expect(w.controller.bodyBox()).toEqual({ min: [0, 0, 0], max: [92.5, 72.5, 45] });
  });

  it('the bottom face (normal pointing down): a boss grows downwards, a pocket cuts upwards into the part', async () => {
    const w = await world(slab());
    const frame = await frameOf(w, 'F2.C0');
    const target: PlaceTarget = { kind: 'face', face: 'F2.C0', planar: true, frame, point: [40, 30, 0], extent: [80, 60], thickness: 20 };
    expect((await w.controller.commit((buildShape(catalogItem('add-block')!, target, w.controller.document()!.seq)).ops)).ok).toBe(true);
    expect(w.controller.bodyBox()!.min[2]).toBeCloseTo(-25, 6);
    const w2 = await world(slab());
    const f2 = await frameOf(w2, 'F2.C0');
    const t2 = { ...target, frame: f2 };
    expect((await w2.controller.commit((buildShape(catalogItem('cut-pocket')!, t2, w2.controller.document()!.seq)).ops)).ok).toBe(true);
    expect((await w2.stats()).volume!).toBeCloseTo(BOX - 25 * 25 * 10, 3);
  });

  it('a curved face: a tangent plane at the picked point carries the shape (boss out of a cylinder side, hole into it)', async () => {
    for (const id of ['add-boss', 'add-sphere', 'hole', 'cut-pocket', 'cut-sphere']) {
      const w = await world(cylinderDoc());
      const names = (w.controller.bodyFaces()?.faceIds ?? []);
      const info = faceInfos(w.controller.bodyFaces() as MeshArrays);
      const side = names.find((n) => info.get(n) && !info.get(n)!.planar)!;
      expect(side).toBeTruthy();
      const target: PlaceTarget = { kind: 'face', face: side, planar: false, point: [20, 0, 25], extent: [125, 50], thickness: 40 };
      const built = buildShape(catalogItem(id)!, target, w.controller.document()!.seq);
      const r = await w.controller.commit(built.ops);
      expect(r.ok, id + JSON.stringify((r as { hints?: unknown }).hints)).toBe(true);
      const v0 = Math.PI * 400 * 50;
      const s = await w.stats();
      expect(s.errors, id).toEqual([]);
      if (id.startsWith('add')) expect(s.volume!).toBeGreaterThan(v0);
      else expect(s.volume!).toBeLessThan(v0);
    }
  });

  it('a sphere dropped at a corner vertex is centred there (the quarter-disc plane starts at the picked spot)', async () => {
    const w = await world(slab());
    const frame = await frameOf(w, 'F2.C1');
    const built = buildShape(catalogItem('add-sphere')!, { kind: 'face', face: 'F2.C1', planar: true, frame, point: [80, 60, 20], extent: [80, 60], thickness: 20 }, w.controller.document()!.seq);
    expect((await w.controller.commit(built.ops)).ok).toBe(true);
    const b = w.controller.bodyBox()!;
    expect(b.max[0]).toBeCloseTo(92.5, 1);
    expect(b.max[1]).toBeCloseTo(72.5, 1);
    expect(b.max[2]).toBeCloseTo(32.5, 1);
  });

  it('first body: a shape dropped on the ground goes on the Front plane at the spot; removing shapes are refused there', async () => {
    const w = await world(emptyPart('Empty') as unknown as PartDoc);
    const target: PlaceTarget = { kind: 'ground', point: [10, 20, 0] };
    expect(build(catalogItem('hole')!, target, 1)).toEqual({ error: 'needsBody' });
    expect(build(catalogItem('cut-pocket')!, target, 1)).toEqual({ error: 'needsBody' });
    const built = buildShape(catalogItem('add-block')!, target, w.controller.document()!.seq);
    expect((await w.controller.commit(built.ops)).ok).toBe(true);
    expect(w.controller.bodyBox()).toEqual({ min: [-5, 5, 0], max: [25, 35, 30] });
  });

  it('raycast finds the top face of the slab and reports it flat with its centre', async () => {
    const w = await world(slab());
    const m = w.controller.bodyFaces()! as MeshArrays;
    const hit = raycast(m, [40, 30, 100], [0, 0, -1])!;
    expect(hit.face).toBe('F2.C1');
    expect(hit.point[2]).toBeCloseTo(20, 6);
    const info = faceInfos(m).get('F2.C1')!;
    expect(info.planar).toBe(true);
    expect(info.centroid[0]).toBeCloseTo(40, 3);
    expect(info.centroid[1]).toBeCloseTo(30, 3);
    expect([...info.extent].map(Math.round)).toEqual([80, 60]);
  });

  it('a dome rises outward from every face of a block that was dropped on the ground', async () => {
    const w = await world(emptyPart('Empty') as unknown as PartDoc);
    expect((await w.controller.commit(buildShape(catalogItem('add-block')!, { kind: 'ground', point: [0, 0, 0] }, 1).ops)).ok).toBe(true);
    const info = faceInfos(w.controller.bodyFaces() as MeshArrays);
    for (const [name, f] of info) {
      const w2 = await world(emptyPart('Empty') as unknown as PartDoc);
      await w2.controller.commit(buildShape(catalogItem('add-block')!, { kind: 'ground', point: [0, 0, 0] }, 1).ops);
      const frame = await frameOf(w2, name);
      const r = await w2.controller.commit(buildShape(catalogItem('add-sphere')!, { kind: 'face', face: name, planar: true, frame, point: f.centroid, extent: f.extent, thickness: 30 }, w2.controller.document()!.seq).ops);
      const s = await w2.stats();
      expect(r.ok, name).toBe(true);
      expect(s.errors, name).toEqual([]);
      expect(s.volume!, name).toBeCloseTo(27000 + (2 / 3) * Math.PI * 5 ** 3, 0);
    }
  });
});
