import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from '../controller';
import { HandleRunner } from './runner';
import { planSizeBox, type AboutMode } from './sizeBox';
import type { HandleSession } from './session';

const rect = { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' },
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: -20, y: -10 }, { id: 'p2', x: 20, y: -10 }, { id: 'p3', x: 20, y: 10 }, { id: 'p4', x: -20, y: 10 }],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b })),
  constraints: [{ id: 'c1', type: 'horizontal', refs: ['e1'] }, { id: 'c2', type: 'vertical', refs: ['e2'] }, { id: 'c3', type: 'distance', refs: ['p1', 'p2'], value: 40 }, { id: 'c4', type: 'distance', refs: ['p2', 'p3'], value: 20 }] };
const disc = { type: 'sketch', id: 'S2', plane: { kind: 'std', id: 'top' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'c', x: 0, y: 0 }], entities: [{ id: 'k1', type: 'circle', c: 'c', r: 5 }], constraints: [{ id: 'd1', type: 'diameter', refs: ['k1'], value: 10 }] };
const hsk = { type: 'sketch', id: 'S3', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'h', x: 5, y: 3 }], entities: [{ id: 'pt', type: 'point', p: 'h' }], constraints: [] };
const doc = (extra: unknown[] = []): PartDoc => ({ ...emptyPart('Block'), features: [rect, { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 30 }, ...extra], seq: 10 }) as unknown as PartDoc;

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function world(d: PartDoc) {
  const store = createStore();
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(x) { const s = await Session.open(x); sessions.push(s); return s; } };
  const controller = new Controller({ store, view, kernel });
  await controller.load(d);
  const runner = new HandleRunner({ preview: (ops) => controller.preview(ops, 0), cancelPreview: () => controller.cancelPreview(), commit: async (c) => { await controller.commit(c.ops); } });
  const plan = (id: string, mode: AboutMode = 'opposite'): HandleSession => planSizeBox({ doc: controller.document(), shapeId: id, frameOf: (s) => controller.sketchFrameOf(s), bodyBox: controller.bodyBox(), mode })!;
  const drag = async (s: HandleSession, id: string, q: number, vec: [number, number, number] = [0, 0, 0], end: 'commit' | 'cancel' = 'commit') => {
    const sink = runner.sink(s);
    sink.onStart!(id); sink.onDrag(id, q, vec);
    await new Promise((r) => setTimeout(r, 150));
    if (end === 'commit') await runner.commit(s.commit(id, q, vec)); else await runner.cancel();
  };
  const box = () => controller.bodyBox()!;
  const volume = async () => ((await sessions.at(-1)!.massProps()) as { volume: number }).volume;
  const errors = async () => (await sessions.at(-1)!.verify()).regen.errors.map(([id, e]) => `${id}:${e.code}`);
  return { controller, plan, drag, box, volume, errors, doc: () => controller.document()!, depth: () => sessions.at(-1)!.history().length };
}

describe('size box against the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('width from the opposite face: the body grows on one side, ONE edit, volume and the sketch stay consistent', async () => {
    const w = await world(doc());
    const before = w.depth();
    const s = w.plan('F2');
    expect(s.specs.map((x) => x.id)).toContain('u1');
    await w.drag(s, 'u1', 60, [0, 0, 0], 'cancel');
    expect(w.box().max[0]).toBe(20);
    expect(w.depth()).toBe(before);
    await w.drag(s, 'u1', 60);
    expect(w.box().min[0]).toBeCloseTo(-20); expect(w.box().max[0]).toBeCloseTo(40);
    expect(w.depth()).toBe(before + 1);
    expect(await w.errors()).toEqual([]);
    expect(await w.volume()).toBeCloseTo(60 * 20 * 30, 3);
    const sk = w.doc().features[0] as unknown as { constraints: Array<{ id: string; value?: number }> };
    expect(sk.constraints.find((c) => c.id === 'c3')!.value).toBe(60);
    // the box is rebuilt from the new document: it follows
    expect(w.plan('F2').specs.find((x) => x.id === 'lw')!.text).toBe('60');
  }, 60000);

  it('symmetric about, the other direction (u0), a typed length, and an anchor move', async () => {
    const w = await world(doc());
    await w.drag(w.plan('F2', 'symmetric'), 'u0', 60);
    expect(w.box().min[0]).toBeCloseTo(-30); expect(w.box().max[0]).toBeCloseTo(30);
    await w.drag(w.plan('F2', 'opposite'), 'v0', 30);
    expect(w.box().min[1]).toBeCloseTo(-20); expect(w.box().max[1]).toBeCloseTo(10);
    await w.drag(w.plan('F2'), 'anchor', 4, [4, 2, 0]);
    expect(w.box().min[0]).toBeCloseTo(-26); expect(w.box().min[1]).toBeCloseTo(-18);
    expect(await w.errors()).toEqual([]);
  }, 60000);

  it('anchor mode scales about the sketch origin; a corner changes width and length in one edit', async () => {
    const w = await world(doc());
    await w.drag(w.plan('F2', 'anchor'), 'u1', 80);
    expect(w.box().min[0]).toBeCloseTo(-40); expect(w.box().max[0]).toBeCloseTo(40);
    const before = w.depth();
    await w.drag(w.plan('F2'), 'c++', 0, [10, 5, 0]);
    expect(w.depth()).toBe(before + 1);
    expect(w.box().max[0]).toBeCloseTo(50);
    expect(await w.errors()).toEqual([]);
  }, 60000);

  it('depth edits the feature depth; a typed value goes the same way; a cut and a mid-plane extrude too', async () => {
    const w = await world(doc());
    await w.drag(w.plan('F2'), 'df', 45);
    expect((w.doc().features[1] as unknown as { depth: number }).depth).toBe(45);
    expect(w.box().max[2]).toBeCloseTo(45);
    const m = await world(doc([disc, { type: 'extrude', id: 'F5', op: 'add', sketch: 'S2', end: 'mid', depth: 10 }]));
    const ms = m.plan('F5');
    expect(ms.specs.map((x) => x.id)).toContain('d0');
    await m.drag(ms, 'd1', 20);
    expect((m.doc().features.find((f) => f.id === 'F5') as unknown as { depth: number }).depth).toBe(20);
    expect(await m.errors()).toEqual([]);
  }, 60000);

  it('a circle profile scales uniformly (radius and diameter dimension together)', async () => {
    const w = await world(doc([disc, { type: 'extrude', id: 'F5', op: 'add', sketch: 'S2', end: 'blind', depth: 10 }]));
    await w.drag(w.plan('F5'), 'u1', 20);
    const sk = w.doc().features.find((f) => f.id === 'S2') as unknown as { entities: Array<{ r: number }>; constraints: Array<{ value: number }> };
    expect(sk.entities[0].r).toBe(10);
    expect(sk.constraints[0].value).toBe(20);
    expect(await w.errors()).toEqual([]);
  }, 60000);

  it('a hole: diameter and depth from the box, the anchor moves the hole', async () => {
    const w = await world(doc([hsk, { type: 'hole', id: 'H1', sketch: 'S3', kind: 'simple', diameter: 6, end: 'blind', depth: 12, flip: true }]));
    const s = w.plan('H1', 'symmetric');
    expect(s.specs.map((x) => x.id)).toContain('df');
    const v0 = await w.volume();
    await w.drag(s, 'u1', 10);
    expect((w.doc().features.find((f) => f.id === 'H1') as unknown as { diameter: number }).diameter).toBe(10);
    expect(await w.volume()).toBeLessThan(v0);
    await w.drag(w.plan('H1'), 'df', 20);
    expect((w.doc().features.find((f) => f.id === 'H1') as unknown as { depth: number }).depth).toBe(20);
    await w.drag(w.plan('H1'), 'anchor', 3, [3, 0, 0]);
    const p = (w.doc().features.find((f) => f.id === 'S3') as unknown as { points: Array<{ id: string; x: number }> }).points.find((q) => q.id === 'h')!;
    expect(p.x).toBe(8);
    expect(await w.errors()).toEqual([]);
  }, 60000);

  it('a cut is a shape too: its depth handle deepens the pocket', async () => {
    const w = await world(doc([{ ...disc, id: 'S4', plane: { kind: 'std', id: 'front' } }, { type: 'extrude', id: 'F5', op: 'cut', sketch: 'S4', end: 'blind', depth: 5, flip: true }]));
    expect(w.plan('F5')).not.toBeNull();
    const v0 = await w.volume();
    await w.drag(w.plan('F5'), 'df', 10);
    expect(await w.volume()).toBeLessThan(v0);
    expect(await w.errors()).toEqual([]);
  }, 60000);
});
