// Cosmetic knurls through the real Controller and kernel: the record is one undo step that rebuilds nothing, it leaves volume, faces and validity of the
// solid as they were, and it survives undo, redo, save and load. Converting to real cuts changes the solid and takes two undo steps.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import { DEFAULT_KNURL, cosmeticToCutOps, knurlCosmetic, readCosmeticKnurls } from './knurl';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function world(doc: PartDoc = emptyPart('Knob') as unknown as PartDoc, build = true) {
  const store = createStore();
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view, kernel });
  await controller.load(doc);
  if (build) {
    await controller.edit([
      { op: 'add', feature: { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'p1', x: 0, y: 0 }], entities: [{ type: 'circle', id: 'e1', c: 'p1', r: 10 }], constraints: [] } },
      { op: 'add', feature: { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 12 } },
    ] as never);
  }
  return controller;
}
const target = { axis: 'z' as const, center: [0, 0] as [number, number], radius: 10, from: 0, to: 12 };
const rec = (o = {}) => knurlCosmetic({ ...DEFAULT_KNURL, target, pattern: 'diamond', count: 120, depth: 0.2, helixAngle: 45, cosmetic: true, ...o });
const facts = async (c: Controller) => ({ vol: ((await c.massProps()) as { volume: number }).volume, faces: c.bodyFaces()?.faceIds.length, features: c.document()!.features.length });
const field = (c: Controller) => readCosmeticKnurls((c.document() as unknown as Record<string, unknown>).cosmeticKnurls);

describe('cosmetic knurl against the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('leaves volume, faces and features as they were; undo and redo move only the record', async () => {
    const c = await world();
    const base = await facts(c);
    const r = rec();
    c.setUndoableExtra('cosmeticKnurls', [r]);
    expect(field(c)).toEqual([r]);
    expect(await facts(c)).toEqual(base);
    expect(base.faces).toBe(3);
    await c.undo();
    expect(field(c)).toEqual([]);
    expect(c.document()!.features.length).toBe(2);
    await c.redo();
    expect(field(c)).toEqual([r]);
    expect(await facts(c)).toEqual(base);
  }, 300000);

  it('undo follows the order of edits: a feature added after the record is undone first', async () => {
    const c = await world();
    const r = rec();
    c.setUndoableExtra('cosmeticKnurls', [r]);
    await c.edit([{ op: 'add', feature: { type: 'sketch', id: 'F3', plane: { kind: 'std', id: 'top' }, points: [{ id: 'p1', x: 0, y: 0 }], entities: [], constraints: [] } }] as never);
    expect(c.document()!.features.length).toBe(3);
    await c.undo();
    expect(c.document()!.features.length).toBe(2);
    expect(field(c)).toEqual([r]);
    await c.undo();
    expect(field(c)).toEqual([]);
  }, 300000);

  it('survives save and load: the document carries it, a reload shows it, and the solid is still the plain cylinder', async () => {
    const c = await world();
    const base = await facts(c);
    const r = rec({ pattern: 'pyramid', helixAngle: 30 });
    c.setUndoableExtra('cosmeticKnurls', [r]);
    const saved = JSON.parse(JSON.stringify(c.document())) as PartDoc;
    expect((saved as unknown as Record<string, unknown>).cosmeticKnurls).toEqual([r]);
    const c2 = await world(saved, false);
    expect(field(c2)).toEqual([r]);
    expect(await facts(c2)).toEqual(base);
    // an edit of the reloaded part keeps the record, and its own undo works
    c2.setUndoableExtra('cosmeticKnurls', [r, rec()]);
    expect(field(c2).length).toBe(2);
    await c2.undo();
    expect(field(c2)).toEqual([r]);
  }, 300000);

  it('converting to real cuts changes the solid; undo brings the plain cylinder and the record back in two steps', async () => {
    const c = await world();
    const base = await facts(c);
    const r = knurlCosmetic({ ...DEFAULT_KNURL, target, pattern: 'straight', count: 24, depth: 0.6, cosmetic: true });
    c.setUndoableExtra('cosmeticKnurls', [r]);
    const ops = cosmeticToCutOps(c.document() as never, field(c));
    c.setUndoableExtra('cosmeticKnurls', []);
    const done = await c.commit(ops, 'knurl');
    expect(done.ok, JSON.stringify(done)).toBe(true);
    expect(field(c)).toEqual([]);
    expect((await facts(c)).vol).toBeLessThan(base.vol - 24 * 0.36 * 12 * 0.8);
    await c.undo();   // the cuts
    expect(await facts(c)).toEqual(base);
    expect(field(c)).toEqual([]);
    await c.undo();   // the clearing of the record
    expect(field(c)).toEqual([r]);
  }, 300000);
});
