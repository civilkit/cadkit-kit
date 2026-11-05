import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';

const rect = (id: string, x0: number, y0: number, x1: number, y1: number) => ({
  type: 'sketch', id, plane: { kind: 'std', id: 'front' },
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: x0, y: y0 }, { id: 'p2', x: x1, y: y0 }, { id: 'p3', x: x1, y: y1 }, { id: 'p4', x: x0, y: y1 }],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b })),
  constraints: [],
});
/** F1 a lone sketch; F2/F3 a sketch and the extrude that uses it. */
const doc = (): PartDoc => ({
  ...emptyPart('Ghost'),
  features: [rect('F1', 0, 0, 30, 30), rect('F2', 0, 0, 20, 20), { type: 'extrude', id: 'F3', op: 'add', sketch: 'F2', end: 'blind', depth: 10 }],
  seq: 4,
}) as unknown as PartDoc;
const loneDoc = (): PartDoc => ({ ...emptyPart('Lone'), features: [rect('F1', 0, 0, 30, 30)], seq: 2 }) as unknown as PartDoc;

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function world(d: PartDoc) {
  const store = createStore();
  const bodies: Array<{ sketches?: Array<{ id: string }> } | null> = [];
  const edits: Array<unknown | null> = [];
  const view: ViewSink = { setBody(b) { bodies.push(b as never); }, setHighlight() {}, setSketchEdit(v) { edits.push(v); } };
  const kernel: KernelFactory = { async open(x) { const s = await Session.open(x); sessions.push(s); return s; } };
  const controller = new Controller({ store, view, kernel });
  await controller.load(d);
  const shownSketches = () => (bodies.at(-1)?.sketches ?? []).map((s) => s.id);
  const overlayOpen = () => edits.length > 0 && edits.at(-1) !== null;
  return { store, controller, shownSketches, overlayOpen, edits };
}

describe('deleting a sketch closes its sketch session and overlay', { skip: !process.env.CK_WASM }, () => {
  it('(a) the sketch is open in edit mode: deleting its feature closes the session and clears the overlay; Undo brings it back once, not open', async () => {
    const w = await world(loneDoc());
    expect(await w.controller.beginSketch('F1')).not.toBeNull();
    expect(w.controller.sketchDraft()).not.toBeNull();
    expect(w.overlayOpen()).toBe(true);
    const r = await w.controller.deleteFeatures(['F1']);
    expect(r!.ok).toBe(true);
    expect(w.controller.sketchDraft()).toBeNull();
    expect(w.controller.sketchFrame()).toBeNull();
    expect(w.controller.sketchStatus()).toBeNull();
    expect(w.overlayOpen()).toBe(false);
    expect(w.shownSketches()).toEqual([]);
    await w.controller.undo();   // the toast's Undo: it takes back the delete (not a sketch step of a session that is gone)
    expect(w.controller.features().map((f) => f.id)).toEqual(['F1']);
    expect(w.controller.sketchDraft()).toBeNull();
    expect(w.overlayOpen()).toBe(false);
    expect(w.shownSketches()).toEqual(['F1']);
  });

  it('(b) a finished sketch: delete removes it from the viewport; Undo draws it once', async () => {
    const w = await world(loneDoc());
    expect(w.shownSketches()).toEqual(['F1']);
    expect((await w.controller.deleteFeatures(['F1']))!.ok).toBe(true);
    expect(w.shownSketches()).toEqual([]);
    expect(w.controller.sketchDraft()).toBeNull();
    await w.controller.undo();
    expect(w.shownSketches()).toEqual(['F1']);
    await w.controller.redo();
    expect(w.shownSketches()).toEqual([]);
  });

  it('(c) the sketch and the extrude that uses it go together while the sketch is open: nothing of either is left', async () => {
    const w = await world(doc());
    await w.controller.beginSketch('F2');
    const r = await w.controller.deleteFeatures(['F2', 'F3']);
    expect(r!.ok).toBe(true);
    expect(w.controller.features().map((f) => f.id)).toEqual(['F1']);
    expect(w.controller.sketchDraft()).toBeNull();
    expect(w.overlayOpen()).toBe(false);
    expect(w.shownSketches()).toEqual(['F1']);
    await w.controller.undo();
    expect(w.controller.features().map((f) => f.id)).toEqual(['F1', 'F2', 'F3']);
    expect(w.shownSketches().sort()).toEqual(['F1', 'F2']);
    expect(w.controller.sketchDraft()).toBeNull();
  });

  it('(f) a sketch an extrude uses: the delete is refused and the open session and its overlay stay; with the extrude it goes', async () => {
    const w = await world(doc());
    await w.controller.beginSketch('F2');
    const refused = await w.controller.deleteFeatures(['F2']);
    expect(refused!.ok).toBe(false);
    expect(w.controller.sketchDraft()).not.toBeNull();
    expect(w.overlayOpen()).toBe(true);
    expect(w.controller.features().map((f) => f.id)).toEqual(['F1', 'F2', 'F3']);
  });

  it('deleting a feature before the open sketch keeps the session and moves its place in the tree', async () => {
    const w = await world(doc());
    await w.controller.beginSketch('F2');
    expect((await w.controller.deleteFeatures(['F1']))!.ok).toBe(true);
    expect(w.controller.sketchDraft()).not.toBeNull();
    expect(w.overlayOpen()).toBe(true);
    expect(((w.controller as unknown as { sketchOpen: { upTo: number } }).sketchOpen).upTo).toBe(1);
  });

  it('a new sketch that is not in the document yet survives an unrelated delete; loading another part closes any session', async () => {
    const w = await world(doc());
    await w.controller.beginNewSketch('front');
    expect((await w.controller.deleteFeatures(['F1']))!.ok).toBe(true);
    expect(w.controller.sketchDraft()).not.toBeNull();
    await w.controller.load(loneDoc());
    expect(w.controller.sketchDraft()).toBeNull();
    expect(w.overlayOpen()).toBe(false);
  });

  const entitiesOf = (v: unknown) => ((v as { sketch: { entities: unknown[] } } | null)?.sketch.entities.length ?? -1);

  it('a new sketch after the old one was deleted starts empty, in the session and in the overlay', async () => {
    const w = await world(loneDoc());
    await w.controller.beginSketch('F1');
    expect(entitiesOf(w.edits.at(-1))).toBe(4);
    await w.controller.deleteFeatures(['F1']);
    const v = await w.controller.beginNewSketch('top');
    expect(v).not.toBeNull();
    expect(w.controller.sketchDraft()!.entities).toEqual([]);
    expect(entitiesOf(w.edits.at(-1))).toBe(0);
    expect(w.controller.sketchDraft()!.constraints).toEqual([]);
  });

  it('a new sketch on another plane after a finished sketch starts empty', async () => {
    const w = await world(loneDoc());
    await w.controller.beginSketch('F1');
    await w.controller.commitSketch();
    expect(w.overlayOpen()).toBe(false);
    await w.controller.beginNewSketch('top');
    expect(w.controller.sketchDraft()!.entities).toEqual([]);
    expect(entitiesOf(w.edits.at(-1))).toBe(0);
  });

  it('starting a sketch while an old session was left open replaces it (nothing of the old draft carries over)', async () => {
    const w = await world(loneDoc());
    await w.controller.beginSketch('F1');
    await w.controller.beginNewSketch('top');
    expect(w.controller.sketchDraft()!.entities).toEqual([]);
    expect(entitiesOf(w.edits.at(-1))).toBe(0);
  });

  it('a second part (its own controller, as a document tab) has its own sketch session: empty, and the first part keeps its own', async () => {
    const a = await world(loneDoc());
    const b = await world({ ...emptyPart('Part3'), features: [], seq: 1 } as unknown as PartDoc);
    await a.controller.beginSketch('F1');
    await b.controller.beginNewSketch('top');
    expect(b.controller.sketchDraft()!.entities).toEqual([]);
    expect(entitiesOf(b.edits.at(-1))).toBe(0);
    expect(a.controller.sketchDraft()!.entities.length).toBe(4);
  });
});
