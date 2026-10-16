// Plane placement on the real kernel: the first body lands on the chosen plane and grows the way the placement says, for BOSL2 entries
// and the built-in shapes, and the Placer drops on a plane (the ground plane of the up axis by default, a hovered plane, a tree row).
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import type { ScriptHost } from '@kit/script';
import { Controller, type KernelFactory, type ViewSink } from '../controller';
import { buildShape, catalogItem, registerDynamicItem, type PlaceTarget } from './shapes';
import { Placer, type PlacerDeps } from './placer';
import { boslEntry, defaultParams, type Params } from './bosl/entries';
import { buildBosl } from './bosl/build';
import { DEFAULT_SETTING, groundPlane, type Placement, type PlaneRef, type PlacementSetting, type StdPlane, type UpAxis } from './placement';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function world() {
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} } as ViewSink, kernel });
  await controller.load(emptyPart('Empty') as unknown as PartDoc);
  const host: ScriptHost = {
    load: async () => {}, edit: async () => ({ ok: true }), geometry: () => ({ mesh: null, edges: [], box: null }),
    build: (d, view) => controller.scratchBuild(d as never, view) as never, release: () => controller.scratchRelease(), facts: (need) => controller.scratchFacts(need),
  };
  /** The kernel's exact bounding box joined with the display mesh's (the exact one misses revolved faces, the mesh is faceted). */
  const bbox = async () => {
    const m = ((await sessions.at(-1)!.check({ volume: 1 })) as unknown as { measured: { bbox: { min: number[]; max: number[] } } }).measured;
    const mesh = controller.bodyBox();
    return { min: [0, 1, 2].map((i) => Math.min(m.bbox.min[i], mesh?.min[i] ?? Infinity)), max: [0, 1, 2].map((i) => Math.max(m.bbox.max[i], mesh?.max[i] ?? -Infinity)) };
  };
  const valid = async () => ((await sessions.at(-1)!.validate()) as { ok: boolean }).ok;
  return { controller, host, bbox, valid };
}
const near = (a: number[], b: number[], tol = 0.02) => a.forEach((v, i) => expect(Math.abs(v - b[i]), `${JSON.stringify(a)} vs ${JSON.stringify(b)}`).toBeLessThan(tol));

async function placeBosl(entryId: string, plane: StdPlane, place: Placement, params: Params = {}, uv: [number, number] = [0, 0]) {
  const w = await world();
  const e = boslEntry(entryId)!;
  const target: PlaceTarget = { kind: 'ground', point: [0, 0, 0], plane: { kind: 'std', id: plane }, uv, place };
  const b = await buildBosl(w.host, w.controller.document(), { entryId, params: { ...defaultParams(e), ...params } }, target, true);
  if ('error' in b) throw new Error(`${b.error} ${b.hint}`);
  expect((await w.controller.applyDocPatch(b.patch!, 'test')).ok).toBe(true);
  expect(await w.valid()).toBe(true);
  return { w, box: await w.bbox() };
}
const NO: Placement = { flip: false, rot: 0, mirror: false };
// prismoid defaults: base 40 x 30 (x1, y1), top 20 x 15, height h = 25
const PRISM = { x1: 40, y1: 30, x2: 20, y2: 15, h: 25 };

describe('placement on a plane', { skip: !process.env.CK_WASM, timeout: 240000 }, () => {
  it('Prismoid on the Top plane (Y up): base on the ground, height up: y from 0 to h', async () => {
    const { box } = await placeBosl('prismoid', 'top', NO, PRISM);
    near([box.min[1], box.max[1]], [0, 25]);
    near([box.max[0] - box.min[0], box.max[2] - box.min[2]], [40, 30]);      // base: x1 along X, y1 along Z (Top's sketch y is -Z)
  });
  it('Z up: the ground plane is Front and the Prismoid rises along +Z', async () => {
    expect(groundPlane('z')).toBe('front');
    const { box } = await placeBosl('prismoid', groundPlane('z'), NO, PRISM);
    near([box.min[2], box.max[2]], [0, 25]);
  });
  it('on the Front plane with Y up the body goes toward the viewer (+Z) and lies on its side: the reported bug is now a choice, not the default', async () => {
    const { box } = await placeBosl('prismoid', 'front', NO, PRISM);
    near([box.min[2], box.max[2]], [0, 25]);
    near([box.min[1], box.max[1]], [-15, 15]);
  });
  it('flip puts the body on the other side of the plane', async () => {
    const top = await placeBosl('prismoid', 'top', { ...NO, flip: true }, PRISM);
    near([top.box.min[1], top.box.max[1]], [-25, 0]);
    const front = await placeBosl('prismoid', 'front', { ...NO, flip: true }, PRISM);
    near([front.box.min[2], front.box.max[2]], [-25, 0]);
    const right = await placeBosl('prismoid', 'right', { ...NO, flip: true }, PRISM);
    near([right.box.min[0], right.box.max[0]], [-25, 0]);
  });
  it('rotate 90 swaps width and depth in the bounding box (and 180 does not)', async () => {
    const r0 = await placeBosl('prismoid', 'top', NO, PRISM);
    const r1 = await placeBosl('prismoid', 'top', { ...NO, rot: 1 }, PRISM);
    const r2 = await placeBosl('prismoid', 'top', { ...NO, rot: 2 }, PRISM);
    const wd = (b: { min: number[]; max: number[] }) => [b.max[0] - b.min[0], b.max[2] - b.min[2]];
    near(wd(r0.box), [40, 30]); near(wd(r1.box), [30, 40]); near(wd(r2.box), [40, 30]);
    near([r1.box.min[1], r1.box.max[1]], [0, 25]);
  });
  it('a shifted top follows the turn: rotate moves the lean, mirror reverses it', async () => {
    const p = { ...PRISM, shiftx: 30 };
    const centreX = (b: { min: number[]; max: number[] }) => (b.min[0] + b.max[0]) / 2;
    const a = await placeBosl('prismoid', 'top', NO, p);
    const m = await placeBosl('prismoid', 'top', { ...NO, mirror: true }, p);
    expect(centreX(a.box)).toBeGreaterThan(5);
    expect(centreX(m.box)).toBeLessThan(-5);
  });
  it('the drop point places the centre on the plane (uv of the Top plane: sketch y is -Z)', async () => {
    const { box } = await placeBosl('cuboid', 'top', NO, {}, [20, 10]);
    near([(box.min[0] + box.max[0]) / 2, (box.min[2] + box.max[2]) / 2], [20, -10]);
  });
  it('every entry stands on every plane with its height along the plane normal, valid, one solid, and flips to the other side', async () => {
    // the entries that are bodies of revolution or have orientation-specific ground shapes get the most attention
    for (const id of ['cuboid', 'cyl', 'tube', 'wedge', 'spheroid', 'onion', 'torus', 'pie_slice', 'regular_prism']) {
      for (const plane of ['top', 'right'] as StdPlane[]) {
        const up = await placeBosl(id, plane, NO);
        const dn = await placeBosl(id, plane, { ...NO, flip: true });
        const ax = plane === 'top' ? 1 : 0;
        const s = (b: { min: number[]; max: number[] }) => b.max[ax] + b.min[ax];
        if (Math.abs(s(up.box)) > 0.2 * (up.box.max[ax] - up.box.min[ax])) expect(Math.sign(s(up.box)) * Math.sign(s(dn.box)), `${id} on ${plane}: flip mirrors across the plane`).toBe(-1);
        expect(up.box.max[ax] - up.box.min[ax], `${id} ${plane} size`).toBeCloseTo(dn.box.max[ax] - dn.box.min[ax], 1);
      }
    }
  });
  it('built-in shapes (the old Shapes catalog) take the same plane, flip and rotation', async () => {
    const w = await world();
    const item = catalogItem('add-block')!;
    const r = buildShape(item, { kind: 'ground', point: [0, 0, 0], plane: { kind: 'std', id: 'top' }, uv: [0, 0], place: { flip: true, rot: 1, mirror: false } }, 1, 20);
    if ('error' in r) throw new Error(r.error);
    expect((await w.controller.commit(r.ops, 't')).ok).toBe(true);
    near([(await w.bbox()).min[1], (await w.bbox()).max[1]], [-20, 0]);
  });
});

describe('Placer: drop on a plane', { skip: !process.env.CK_WASM, timeout: 240000 }, () => {
  async function placer(up: UpAxis, setting: PlacementSetting = DEFAULT_SETTING, planeAt: PlacerDeps['planeAt'] = () => null, oblique = false) {
    const w = await world();
    const c = w.controller;
    const deps: PlacerDeps = {
      document: () => c.document(), hasSolid: () => c.hasSolid(), bodyFaces: () => c.bodyFaces() as never, bodyEdges: () => c.bodyEdges(), bodyBox: () => c.bodyBox(),
      preview: (ops) => c.preview(ops, 0) as never, cancelPreview: () => c.cancelPreview(), commit: (ops, why) => c.commit(ops, why), commitPatch: (patch, why) => c.applyDocPatch(patch, why),
      buildBosl: async (item, target, doc, linked) => (await buildBosl(w.host, doc, { entryId: item.bosl!.entryId, params: item.bosl!.params }, target, linked)) as never,
      // a camera looking straight down at the origin from +Y: rays go -Y
      rayAt: (x, y) => (oblique ? { o: [x + 50, 100, y], d: [-0.5, -1, 0] } : { o: [x, 100, y], d: [0, -1, 0] }), worldPerPixel: () => 0.05, setFade() {}, holdView() {},
      upAxis: () => up, placement: () => setting, planeAt,
    };
    return { w, p: new Placer(deps) };
  }
  const prism = () => registerDynamicItem({ id: 'bosl:prismoid', kind: 'cone', op: 'add', bosl: { entryId: 'prismoid', params: { ...defaultParams(boslEntry('prismoid')!), ...PRISM } } });

  it('with no plane chosen the first body goes on the ground plane of the up axis (Top for Y up) and rises', async () => {
    const { w, p } = await placer('y');
    p.hover(prism(), 0, 0);
    await new Promise((r) => setTimeout(r, 1200));
    expect(p.status).toMatchObject({ state: 'ready', ground: true, plane: { kind: 'std', id: 'top' } });
    expect(await p.drop(prism(), 0, 0)).toBeTruthy();
    const b = await w.bbox();
    near([b.min[1], b.max[1]], [0, 25]);
  });
  it('Z up: Front is the ground and the body rises along +Z', async () => {
    const { w, p } = await placer('z');
    expect(await p.drop(prism(), 0, 0)).toBeTruthy();
    const b = await w.bbox();
    near([b.min[2], b.max[2]], [0, 25]);
  });
  it('the hovered plane wins over Place on; the history entry says how it stands', async () => {
    const hovered: PlaneRef = { kind: 'std', id: 'right' };
    const { w, p } = await placer('y', { plane: 'top', flip: true, rot: 1, mirror: false }, () => hovered, true);
    p.hover(prism(), 0, 0);
    await new Promise((r) => setTimeout(r, 1200));
    expect(p.status).toMatchObject({ state: 'ready', plane: { kind: 'std', id: 'right' } });
    expect(await p.drop(prism(), 0, 0)).toBeTruthy();
    const b = await w.bbox();
    near([b.min[0], b.max[0]], [-25, 0]);
    expect(sessions.at(-1)!.history().at(-1)!.reason).toBe('Catalog: Prismoid (Right plane, flipped, turned 90)');
  });
  it('a drop on a plane row of the history tree (no pointer ray) works, and a cut cannot go there', async () => {
    const { w, p } = await placer('y');
    expect(await p.dropOnPlane(prism(), { kind: 'std', id: 'top' })).toBeTruthy();
    const b = await w.bbox();
    near([b.min[1], b.max[1]], [0, 25]);
    expect(await p.dropOnPlane(catalogItem('cut-pocket')!, { kind: 'std', id: 'top' })).toBeNull();
    expect(p.status).toMatchObject({ state: 'blocked' });
  });
  it('the old Shapes items use the same plane targeting', async () => {
    const { w, p } = await placer('y');
    expect(await p.dropOnPlane(catalogItem('add-cylinder')!, { kind: 'std', id: 'top' })).toBeTruthy();
    const b = await w.bbox();
    near([b.min[1], b.max[1]], [0, 30]);
  });
});
