// A Cone dragged or typed past the point where its taper closes: the height stops at the tip and the model stays valid.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import { HandleRunner } from './handles/runner';
import { planSizeBox } from './handles/sizeBox';
import { planHandles } from './handles/plan';

const R = 10, DRAFT = 30, TIP = R / Math.tan(DRAFT * Math.PI / 180);   // 17.32
const disc = { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'top' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'c', x: 0, y: 0 }], entities: [{ id: 'k1', type: 'circle', c: 'c', r: R }], constraints: [] };
const doc = (depth: number): PartDoc => ({ ...emptyPart('Cone'), features: [disc, { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth, draft: DRAFT }], seq: 3 }) as unknown as PartDoc;

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function world(d: PartDoc) {
  const store = createStore();
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(x) { const s = await Session.open(x); sessions.push(s); return s; } };
  const controller = new Controller({ store, view, kernel });
  await controller.load(d);
  const runner = new HandleRunner({ preview: (ops) => controller.preview(ops, 0), cancelPreview: () => controller.cancelPreview(), commit: async (c) => { await controller.commit(c.ops); } });
  const depth = () => (controller.document()!.features.find((f) => f.id === 'F2') as unknown as { depth: number }).depth;
  const errors = async () => (await sessions.at(-1)!.verify()).regen.errors.map(([id, e]) => `${id}:${e.code}`);
  const volume = async () => ((await sessions.at(-1)!.massProps()) as { volume: number }).volume;
  return { controller, runner, depth, errors, volume };
}

describe('cone tip clamp', () => {
  it('exposes the limit the kernel reports', async () => {
    const w = await world(doc(10));
    expect(w.controller.tipLimit('F2')).toBeCloseTo(TIP, 6);
    expect(w.controller.tipNote()).toBeNull();
  });

  it('typing a height past the tip clamps to it, keeps the model valid and leaves a note', async () => {
    const w = await world(doc(10));
    const r = await w.controller.edit([{ op: 'set', id: 'F2', path: 'depth', value: 80 }]);
    expect(r.ok).toBe(true);
    expect(w.depth()).toBeCloseTo(TIP, 6);
    expect(await w.errors()).toEqual([]);
    expect(await w.volume()).toBeGreaterThan(0);
    expect(w.controller.tipNote()?.text).toMatch(/^Limited to the tip \(17\.32 mm\)$/);
  });

  it('dragging the height handle past the tip stops at it, however far the pointer goes', async () => {
    const w = await world(doc(10));
    const s = planSizeBox({ doc: w.controller.document(), shapeId: 'F2', frameOf: (x) => w.controller.sketchFrameOf(x), bodyBox: w.controller.bodyBox(), mode: 'opposite', tipLimit: (id) => w.controller.tipLimit(id) })!;
    const sink = w.runner.sink(s);
    sink.onStart!('df');
    for (const q of [15, 17, 30, 500]) sink.onDrag('df', q, [0, 0, 0]);
    await new Promise((r) => setTimeout(r, 200));
    expect(s.format!('df', 500)).toBe('Height 17.32 mm (tip)');
    expect(s.format!('df', 12)).toBe('Height 12 mm');
    const c = s.commit('df', 500, [0, 0, 0])!;
    expect(c.notice).toMatch(/Limited to the tip/);
    await w.runner.commit(c);
    expect(w.depth()).toBeCloseTo(TIP, 6);
    expect(await w.errors()).toEqual([]);
  });

  it('the cap arrow handle clamps too', async () => {
    const w = await world(doc(10));
    const mesh = w.controller.bodyFaces(), faces = mesh?.faceIds ?? [];
    const cap = faces.find((f) => f === 'F2.C1');
    expect(cap).toBeTruthy();
    const s = planHandles({ doc: w.controller.document(), selection: [cap!], mode: 'face', edges: w.controller.bodyEdges(), mesh, box: w.controller.bodyBox(), editingId: null, sketching: false, enabled: true, tipLimit: (id) => w.controller.tipLimit(id) });
    expect(s).not.toBeNull();
    expect(s!.format!('depth', 99)).toBe('Depth 17.32 mm (tip)');
    expect((s!.commit('depth', 99, [0, 0, 0])!.ops[0] as { value: number }).value).toBeCloseTo(TIP, 6);
  });

  it('a document saved past the tip opens with the height at the tip, once', async () => {
    const w = await world(doc(40));
    expect(w.depth()).toBeCloseTo(TIP, 6);
    expect(await w.errors()).toEqual([]);
    expect(w.controller.tipNote()).not.toBeNull();
  });

  it('a draft-angle edit that moves the tip under the height is refused and the height stays', async () => {
    const w = await world(doc(10));
    const r = await w.controller.edit([{ op: 'set', id: 'F2', path: 'draft', value: 60 }]);   // tip = 10 / tan 60 = 5.77 < 10
    expect(r.ok).toBe(false);
    expect(w.depth()).toBe(10);
    expect(await w.errors()).toEqual([]);
    expect(w.controller.tipNote()?.text).toMatch(/5\.77 mm/);
  });
});
