import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import { renameOps } from './treeActions';

const rect = (id: string, x0: number, y0: number, x1: number, y1: number) => ({
  type: 'sketch', id, plane: { kind: 'std', id: 'front' },
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: x0, y: y0 }, { id: 'p2', x: x1, y: y0 }, { id: 'p3', x: x1, y: y1 }, { id: 'p4', x: x0, y: y1 }],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b })),
  constraints: [],
});
/** Two stacked slabs: F1/F2 a 40 x 25 x 10 plate, F3/F4 a second extrude of a smaller rectangle (depth 30), so the box height tells how far the build went. */
const doc = (): PartDoc => ({
  ...emptyPart('Slabs'),
  features: [
    rect('F1', 0, 0, 40, 25), { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 10 },
    rect('F3', 5, 5, 15, 15), { type: 'extrude', id: 'F4', op: 'add', sketch: 'F3', end: 'blind', depth: 30 },
  ],
  seq: 5,
}) as unknown as PartDoc;

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function world() {
  const store = createStore();
  const bodies: Array<{ box: { min: number[]; max: number[] } } | null> = [];
  const view: ViewSink = { setBody(b) { bodies.push(b as never); }, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view, kernel });
  await controller.load(doc());
  const height = () => { const b = controller.bodyBox(); return b ? Math.abs(b.max[2] - b.min[2]) : 0; };
  return { store, controller, bodies, height };
}

describe('tree interaction against the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('renames a feature with a set name edit and undoes it', async () => {
    const w = await world();
    const r = await w.controller.edit(renameOps('F2', 'Base plate'));
    expect(r.ok).toBe(true);
    expect(w.controller.features().find((f) => f.id === 'F2')?.name).toBe('Base plate');
    await w.controller.undo();
    expect(w.controller.features().find((f) => f.id === 'F2')?.name).toBeUndefined();
  });

  it('renames the part in the app: document() carries the name, a load resets it', async () => {
    const w = await world();
    w.controller.setPartName('  Bracket ');
    expect(w.controller.document()!.name).toBe('Bracket');
    w.controller.setPartName('   ');
    expect(w.controller.document()!.name).toBe('Bracket');
    await w.controller.load(doc());
    expect(w.controller.document()!.name).toBe('Slabs');
  });

  it('delete removes a feature; a used one is refused with the session reason; selected dependents go together', async () => {
    const w = await world();
    const refused = await w.controller.deleteFeatures(['F3']);
    expect(refused!.ok).toBe(false);
    expect(w.store.notices.value.at(-1)!.text).toMatch(/F3 is still referenced by F4/);
    expect(w.controller.features().length).toBe(4);
    const r = await w.controller.deleteFeatures(['F4']);
    expect(r!.ok).toBe(true);
    expect(w.controller.features().map((f) => f.id)).toEqual(['F1', 'F2', 'F3']);
    const both = await w.controller.deleteFeatures(['F1', 'F2', 'F3']);
    expect(both!.ok).toBe(true);
    expect(w.controller.features()).toEqual([]);
  });

  it('rollback shows the model at that point and leaves the document alone', async () => {
    const w = await world();
    expect(w.height()).toBeCloseTo(30, 3);
    expect(w.controller.rollbackCount()).toBeNull();
    await w.controller.setRollback(2);
    expect(w.controller.rollbackCount()).toBe(2);
    expect(w.height()).toBeCloseTo(10, 3);
    expect(w.controller.document()!.features.length).toBe(4);
    expect(w.controller.document()!.rollback).toBeNull();
    await w.controller.setRollback(null);
    expect(w.height()).toBeCloseTo(30, 3);
    await w.controller.setRollback(4);
    expect(w.controller.rollbackCount()).toBeNull();
  });

  it('a feature added while rolled back is inserted at the marker and the marker moves past it', async () => {
    const w = await world();
    await w.controller.setRollback(2);
    const r = await w.controller.edit([
      { op: 'add', feature: rect('F5', 20, 5, 30, 15) },
      { op: 'add', feature: { type: 'extrude', id: 'F6', op: 'add', sketch: 'F5', end: 'blind', depth: 20 } },
    ]);
    expect(r.ok).toBe(true);
    expect(w.controller.features().map((f) => f.id)).toEqual(['F1', 'F2', 'F5', 'F6', 'F3', 'F4']);
    expect(w.controller.rollbackCount()).toBe(4);
    expect(w.height()).toBeCloseTo(20, 3);
    await w.controller.setRollback(null);
    expect(w.height()).toBeCloseTo(30, 3);
  });

  it('deleting the feature the marker sits on moves it back; undo keeps the view consistent', async () => {
    const w = await world();
    await w.controller.setRollback(4);
    await w.controller.setRollback(3);               // F3 is the last one on
    await w.controller.deleteFeatures(['F3', 'F4']);
    expect(w.controller.rollbackCount()).toBe(2);
    expect(w.height()).toBeCloseTo(10, 3);
    await w.controller.undo();
    expect(w.controller.features().length).toBe(4);
    expect(w.controller.rollbackCount()).toBe(2);
  });

  it('a preview while rolled back builds up to the marker', async () => {
    const w = await world();
    await w.controller.setRollback(2);
    const r = await w.controller.preview([{ op: 'set', id: 'F2', path: 'depth', value: 15 }], 0);
    expect(r.ok).toBe(true);
    const b = w.bodies.at(-1)!.box;
    expect(b.max[2] - b.min[2]).toBeCloseTo(15, 3);   // the sink got the previewed body (the controller's own box only follows committed state)
    await w.controller.cancelPreview();
    const b2 = w.bodies.at(-1)!.box;
    expect(b2.max[2] - b2.min[2]).toBeCloseTo(10, 3);
  });

  it('rebuild and pickable names', async () => {
    const w = await world();
    await w.controller.rebuild();
    expect(w.controller.pickableNames('face').length).toBeGreaterThan(6);
    expect(w.controller.pickableNames('edge').length).toBeGreaterThan(10);
    expect(w.controller.pickableNames('vertex').length).toBeGreaterThan(8);
  });
});
