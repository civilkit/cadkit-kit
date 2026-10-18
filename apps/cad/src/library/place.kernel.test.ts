import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from '../controller';
import { buildShape, catalogItem, type BuiltShape, type PlaceTarget } from '../catalog/shapes';
import { FIXTURE_DIR } from './testkit';
import { buildPlaced } from './buildPlaced';
import { parsePart } from './partFile';
import { liveSources, withSource } from './insert';
import type { LibraryRecord, PartData } from './registry';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

const rect = (id: string, x0: number, y0: number, x1: number, y1: number) => ({
  type: 'sketch', id, plane: { kind: 'std', id: 'front' },
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: x0, y: y0 }, { id: 'p2', x: x1, y: y0 }, { id: 'p3', x: x1, y: y1 }, { id: 'p4', x: x0, y: y1 }],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([id, a, b]) => ({ id, type: 'line', p1: a, p2: b })), constraints: [],
});
const slab = (): PartDoc => ({ ...emptyPart('Slab'), features: [rect('F1', 0, 0, 80, 60), { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 20 }], seq: 3 }) as unknown as PartDoc;
const BOX = 80 * 60 * 20;

const LIB: LibraryRecord = { id: 'https://example.com/libs/library.json', source: 'https://example.com/libs/library.json', name: 'Fixture parts', parts: 3, addedAt: 0, licence: 'CC0-1.0' };
function partData(doc: unknown, id = 'p'): PartData {
  const bytes = new TextEncoder().encode(JSON.stringify(doc));
  return { part: { id, title: id, category: 'blocks', tags: [], file: id + '.ckpart' }, doc: parsePart(bytes), bytes, sha256: 'a'.repeat(64), licence: 'CC0-1.0', fromCache: false };
}
const block = (): PartData => partData(JSON.parse(readFileSync(FIXTURE_DIR + '/parts/block-small.ckpart', 'utf8')), 'block-small');
/** The same block with a fillet on its edge at (10, 0): the edge reference carries a world point, which has to move with the part. */
const filleted = (): PartData => {
  const d = JSON.parse(readFileSync(FIXTURE_DIR + '/parts/block-small.ckpart', 'utf8'));
  d.features.push({ type: 'fillet', id: 'F3', radius: 1, edges: [{ faces: ['F2.S.e1', 'F2.S.e2'], at: [10, 0, 2.5] }] });
  return partData(d, 'filleted');
};

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
  const frameOf = async (face: string) => {
    const probe = buildShape(catalogItem('add-block')!, { kind: 'face', face, planar: true, frame: { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }, point: [0, 0, 0] }, controller.document()!.seq) as BuiltShape;
    const r = await controller.preview(probe.ops, 0);
    const sk = (r.body?.sketches ?? r.sketches ?? []).find((s: { id: string }) => s.id === probe.sketchId);
    await controller.cancelPreview();
    return sk!.frame as { o: number[]; x: number[]; y: number[]; z: number[] };
  };
  /** One drop, the way the app does it: the placed patch as one undo step, the provenance after it. */
  const drop = async (data: PartData, target: PlaceTarget, o: { flip?: boolean } = {}) => {
    const built = buildPlaced(controller.document()!, data, LIB, target, { linked: true, ...o, commitSource: (e) => controller.setDocExtra('sources', withSource(controller.document()!, e)) });
    const hist = sessions.at(-1)!.history().length;
    const r = await controller.applyDocPatch(built.patch!, 'Catalog: ' + data.part.title);
    if (r.ok) built.onCommitted?.();
    return { built, r, steps: sessions.at(-1)!.history().length - hist };
  };
  return { controller, stats, frameOf, drop };
}

const face = async (w: Awaited<ReturnType<typeof world>>, name: string, point: number[]): Promise<PlaceTarget> => ({ kind: 'face', face: name, planar: true, frame: await w.frameOf(name), point: point as [number, number, number], extent: [80, 60], thickness: 20 });
/** Corner box of the part's top, from the frame: where the 10 x 10 block lands in the world. */
const corners = (t: PlaceTarget, size = 10): number[][] => {
  const f = t.frame!, p = t.point;
  return [[0, 0], [size, 0], [0, size], [size, size]].map(([a, b]) => [0, 1, 2].map((i) => p[i] + a * f.x[i] + b * f.y[i]));
};

describe('library parts dropped on a target (against the real kernel)', { skip: !process.env.CK_WASM, timeout: 180000 }, () => {
  it('on the top face of a slab: the origin goes to the drop point, the part sits ON the face, one undo step; a second copy elsewhere', async () => {
    const w = await world(slab());
    const t1 = await face(w, 'F2.C1', [60, 40, 20]);
    const a = await w.drop(block(), t1);
    expect(a.r.ok).toBe(true);
    expect(a.steps).toBe(1);
    expect(a.built.notice).toBeUndefined();
    let s = await w.stats();
    expect(s.errors).toEqual([]);
    expect(s.volume!).toBeCloseTo(BOX + 10 * 10 * 5, 3);                   // exactly the block's volume was added: it is fused to the slab, not floating
    const box = w.controller.bodyBox()!;
    expect(box.min).toEqual([0, 0, 0]);
    expect(box.max[2]).toBeCloseTo(25, 6);                                  // 5 high on the 20 mm slab: it stands on the face
    // where it is: the block's top corners are the drop point plus 10 along the face's own axes
    const bf = w.controller.bodyFaces()!;
    const top: number[][] = [];
    for (let i = 0; i < bf.positions.length; i += 3) if (Math.abs(bf.positions[i + 2] - 25) < 1e-6) top.push([bf.positions[i], bf.positions[i + 1]]);
    const want = corners(t1);
    expect(Math.min(...top.map((p) => p[0]))).toBeCloseTo(Math.min(...want.map((p) => p[0])), 4);
    expect(Math.max(...top.map((p) => p[0]))).toBeCloseTo(Math.max(...want.map((p) => p[0])), 4);
    expect(Math.min(...top.map((p) => p[1]))).toBeCloseTo(Math.min(...want.map((p) => p[1])), 4);
    expect(Math.max(...top.map((p) => p[1]))).toBeCloseTo(Math.max(...want.map((p) => p[1])), 4);

    // a second copy elsewhere: its own variables and ids, another step
    const t2 = await face(w, 'F2.C1', [15, 10, 20]);
    const b = await w.drop(block(), t2);
    expect(b.r.ok).toBe(true);
    expect(b.steps).toBe(1);
    s = await w.stats();
    expect(s.errors).toEqual([]);
    expect(s.volume!).toBeCloseTo(BOX + 2 * 500, 3);
    const doc = w.controller.document()!;
    expect(doc.features.map((f) => f.id)).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'F6']);
    expect((doc as unknown as { variables: Array<{ name: string }> }).variables.map((v) => v.name)).toEqual(expect.arrayContaining(['blocksmall_1_w', 'blocksmall_2_w']));
    const src = liveSources(doc);
    expect(src.map((e) => e.features)).toEqual([['F3', 'F4'], ['F5', 'F6']]);
    // both undo in turn
    await w.controller.undo();
    expect((await w.stats()).volume!).toBeCloseTo(BOX + 500, 3);
    await w.controller.undo();
    expect((await w.stats()).volume!).toBeCloseTo(BOX, 3);
  });

  it('on a side face the part stands out of that face (its up along the face normal)', async () => {
    const w = await world(slab());
    // the face at x = 80: found by its normal in the mesh
    const bf = w.controller.bodyFaces()!;
    const names = bf.faceIds.filter((n) => n.startsWith('F2.S'));
    let side = '';
    for (const n of names) {
      const idx = Array.from(bf.triFace).map((f, i) => (bf.faceIds[f] === n ? i : -1)).filter((i) => i >= 0);
      const xs = idx.flatMap((i) => [0, 1, 2].map((k) => bf.positions[(i * 3 + k) * 3]));
      if (xs.every((x) => Math.abs(x - 80) < 1e-6)) side = n;
    }
    expect(side).toBeTruthy();
    const t = await face(w, side, [80, 30, 10]);
    const r = await w.drop(block(), t);
    expect(r.r.ok).toBe(true);
    const s = await w.stats();
    expect(s.errors).toEqual([]);
    expect(s.volume!).toBeCloseTo(BOX + 500, 3);
    expect(w.controller.bodyBox()!.max[0]).toBeCloseTo(85, 6);              // 5 mm out of the x = 80 face
  });

  it('an edge reference inside the part moves with it (rotated frame: a side face), and the fillet still lands on the right edge', async () => {
    const w = await world(slab());
    const bf = w.controller.bodyFaces()!;
    let side = '';
    for (const n of bf.faceIds.filter((x) => x.startsWith('F2.S'))) {
      const idx = Array.from(bf.triFace).map((f, i) => (bf.faceIds[f] === n ? i : -1)).filter((i) => i >= 0);
      if (idx.flatMap((i) => [0, 1, 2].map((k) => bf.positions[(i * 3 + k) * 3])).every((x) => Math.abs(x - 80) < 1e-6)) side = n;
    }
    // well inside the face: a part flush with the slab's bottom would fuse its side with the slab's own face and lose the edge
    const r = await w.drop(filleted(), await face(w, side, [80, 30, 16]));
    expect(r.r, JSON.stringify(r.r)).toEqual({ ok: true });
    expect(r.built.notice).toBeUndefined();
    const s = await w.stats();
    expect(s.errors).toEqual([]);
    expect(s.volume!).toBeCloseTo(BOX + 500 - (1 - Math.PI / 4) * 5, 2);    // one rounded edge: the fillet found its edge
  });

  it('on the empty ground and on a datum plane: the part goes onto that plane at the drop point', async () => {
    const w = await world({ ...emptyPart('Empty'), features: [], seq: 1 } as unknown as PartDoc);
    // Top plane (Y up): sketch x = world x, sketch y = world -z; the part rises along +Y
    const r = await w.drop(block(), { kind: 'ground', point: [5, 0, -7], plane: { kind: 'std', id: 'top' }, uv: [5, 7] });
    expect(r.r.ok).toBe(true);
    expect((await w.stats()).errors).toEqual([]);
    const box = w.controller.bodyBox()!;
    expect(box.min.map((x) => +x.toFixed(6))).toEqual([5, 0, -17]);
    expect(box.max.map((x) => +x.toFixed(6))).toEqual([15, 5, -7]);
    // flipped (Direction: down): it hangs below the plane
    const w2 = await world({ ...emptyPart('Empty'), features: [], seq: 1 } as unknown as PartDoc);
    const r2 = await w2.drop(block(), { kind: 'ground', point: [0, 0, 0], plane: { kind: 'std', id: 'top' }, uv: [0, 0], place: { flip: true, rot: 0, mirror: false } }, { flip: true });
    expect(r2.r.ok).toBe(true);
    expect(w2.controller.bodyBox()!.min[1]).toBeCloseTo(-5, 6);
  });

  it('a part that cannot be moved safely stays at its own origin, with a notice', async () => {
    const d = JSON.parse(readFileSync(FIXTURE_DIR + '/parts/block-small.ckpart', 'utf8'));
    d.features.push({ ...rect('F3', 0, 0, 2, 2), plane: { kind: 'std', id: 'top' } });      // a second plane of the world
    d.features.push({ type: 'extrude', id: 'F4', op: 'add', sketch: 'F3', end: 'blind', depth: 1 });
    const w = await world(slab());
    const r = await w.drop(partData(d, 'two-planes'), await face(w, 'F2.C1', [60, 40, 20]));
    expect(r.built.notice).toContain('several planes');
    // origin placement: exactly what phase 1 did, the document is still valid
    expect(r.r, JSON.stringify(r.r)).toEqual({ ok: true });
    expect((await w.stats()).errors).toEqual([]);
  });
  it('Rotate on a ground drop turns only the dropped part (moveBody by feature id): the slab already in the document stays put', async () => {
    const w = await world(slab());
    const target: PlaceTarget = { kind: 'ground', point: [200, 0, 0], plane: { kind: 'std', id: 'front' }, uv: [200, 0], place: { flip: false, rot: 1, mirror: false } };
    const a = await w.drop(partData(slab(), 'slab-part'), target);
    expect(a.r.ok).toBe(true);
    expect(a.steps).toBe(1);
    expect(a.built.notice).toBeUndefined();
    const s = await w.stats();
    expect(s.errors).toEqual([]);
    expect(s.volume!).toBeCloseTo(2 * BOX, 3);
    // the new slab (80 x 60 at the drop point (200, 0)) turned 90 degrees counter-clockwise about it: x 140..200, y 0..80; the old one is untouched: x 0..80, y 0..60
    const box = w.controller.bodyBox()!;
    expect(box.min).toEqual([0, 0, 0]);
    expect(box.max[0]).toBeCloseTo(200, 6);
    expect(box.max[1]).toBeCloseTo(80, 6);
    expect(box.max[2]).toBeCloseTo(20, 6);
  });
});
