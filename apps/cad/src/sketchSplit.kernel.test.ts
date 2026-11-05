// The Split Entity tool through the controller on the real kernel: the split is one sketch edit, Undo takes it back, and the committed
// sketch extrudes to the volume it had before. Skipped without a kernel (CK_WASM).
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { DEFAULT_SETTINGS, splitTool } from '@kit/sketch';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import './locales/en';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

const doc = (): PartDoc => ({
  ...emptyPart('Split'),
  features: [
    {
      type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' },
      points: [{ id: 'p1', x: 0, y: 0, fixed: true }, { id: 'p2', x: 40, y: 0 }, { id: 'p3', x: 40, y: 20 }, { id: 'p4', x: 0, y: 20 }],
      entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([id, a, b]) => ({ id, type: 'line', p1: a, p2: b })),
      constraints: [{ id: 'k1', type: 'horizontal', refs: ['e1'] }, { id: 'k2', type: 'vertical', refs: ['e2'] }, { id: 'k3', type: 'horizontal', refs: ['e3'] }, { id: 'k4', type: 'vertical', refs: ['e4'] },
        { id: 'k5', type: 'midpoint', refs: ['p1', 'e1'] }],
    },
    { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 5 },
  ],
  seq: 3,
}) as unknown as PartDoc;

async function world() {
  const store = createStore();
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSelection() {}, setSketchEdit() {} } as ViewSink;
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view, kernel });
  await controller.load(doc());
  return { controller, volume: async () => ((await sessions.at(-1)!.massProps()) as { volume: number }).volume };
}

describe('Split Entity through the controller', { skip: !process.env.CK_WASM }, () => {
  it('splits, solves, undoes, redoes and extrudes to the same volume', async () => {
    const w = await world();
    const v0 = await w.volume();
    expect(v0).toBeCloseTo(4000, 4);
    await w.controller.beginSketch('F1');
    const d0 = w.controller.sketchDraft()!;
    const click = { type: 'click', at: { x: 15, y: 0 }, snap: { kind: 'oncurve', at: { x: 15, y: 0 }, entityId: 'e1' }, mods: { shift: false, ctrl: false, alt: false } } as const;
    const out = splitTool.step({}, click, d0, DEFAULT_SETTINGS);
    expect(out.dropped).toEqual(['midpoint']);                       // the midpoint lock cannot survive the split, and the tool says so
    const r = await w.controller.applySketchDraft(out.draft);
    expect(r.ok).toBe(true);
    expect(r.status!.conflicts).toEqual([]);
    expect(r.status!.solved).toBe(true);
    expect(w.controller.sketchDraft()!.entities).toHaveLength(5);
    // undo: the sketch is back as it was, and still solves
    expect(await w.controller.undoSketch()).toBe(true);
    expect(w.controller.sketchDraft()).toEqual(d0);
    expect(w.controller.sketchDraft()!.entities).toHaveLength(4);
    // again, then commit: the extrude over the split sketch has the volume it had
    await w.controller.applySketchDraft(splitTool.step({}, click, d0, DEFAULT_SETTINGS).draft);
    const c = await w.controller.commitSketch();
    expect(c?.ok).not.toBe(false);
    expect(await w.volume()).toBeCloseTo(v0, 6);
  }, 120000);
});
