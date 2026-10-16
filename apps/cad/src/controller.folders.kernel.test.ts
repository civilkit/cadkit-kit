import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import { dropPlan, groupPlan, patchOf, renameFolderPlan, ungroupPlan, type Plan } from './treeFolders';
import type { FeatureRow } from '@kit/ui';

const rect = (id: string, x0: number, y0: number, x1: number, y1: number) => ({
  type: 'sketch', id, plane: { kind: 'std', id: 'front' },
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: x0, y: y0 }, { id: 'p2', x: x1, y: y0 }, { id: 'p3', x: x1, y: y1 }, { id: 'p4', x: x0, y: y1 }],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b })),
  constraints: [],
});
/** Two independent slabs and a third one: tops F2, F4, F6. */
const doc = (): PartDoc => ({
  ...emptyPart('Slabs'),
  features: [
    rect('F1', 0, 0, 40, 25), { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 10 },
    rect('F3', 5, 5, 15, 15), { type: 'extrude', id: 'F4', op: 'add', sketch: 'F3', end: 'blind', depth: 30 },
    rect('F5', 50, 0, 60, 10), { type: 'extrude', id: 'F6', op: 'add', sketch: 'F5', end: 'blind', depth: 5 },
  ],
  seq: 7,
}) as unknown as PartDoc;

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function world() {
  const store = createStore();
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view, kernel });
  await controller.load(doc());
  const feats = () => controller.document()!.features as unknown as Array<{ id: string; group?: string }>;
  const rows = (): FeatureRow[] => feats().map((f) => ({ id: f.id, type: f.id === 'F1' || f.id === 'F3' || f.id === 'F5' ? 'sketch' : 'extrude', group: f.group, uses: f.id === 'F2' ? ['F1'] : f.id === 'F4' ? ['F3'] : f.id === 'F6' ? ['F5'] : undefined }));
  const groups = () => feats().map((f) => f.group ?? '-').join(' ');
  return { controller, feats, rows, groups };
}
const ops = (p: Plan) => { if (!p.ok) throw new Error(p.reason); return p.ops; };
/** What the app does with a plan: ops through edit, a reorder through the document patch. */
const go = async (w: Awaited<ReturnType<typeof world>>, p: Plan) => {
  if (!p.ok) throw new Error(p.reason);
  return p.order ? w.controller.applyDocPatch(patchOf(w.feats(), p), 'tree folders') : w.controller.edit(p.ops);
};

describe('folders through the controller, on the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('grouping is one undo step; undo and redo restore the folder', async () => {
    const w = await world();
    const before = w.controller.history().length;
    const r = await w.controller.edit(ops(groupPlan(w.rows(), w.feats(), ['F2', 'F4'], 'Folder')));
    expect(r.ok).toBe(true);
    expect(w.controller.history().length).toBe(before + 1);
    expect(w.groups()).toBe('Folder Folder Folder Folder - -');
    await w.controller.undo();
    expect(w.groups()).toBe('- - - - - -');
    await w.controller.redo();
    expect(w.groups()).toBe('Folder Folder Folder Folder - -');
  });

  it('rename, ungroup and a move with a join are each one step and undo cleanly', async () => {
    const w = await world();
    await w.controller.edit(ops(groupPlan(w.rows(), w.feats(), ['F2', 'F4'], 'Folder')));
    const n = w.controller.history().length;

    await w.controller.edit(ops(renameFolderPlan(w.feats(), 'Folder', 'Plates')));
    expect(w.controller.history().length).toBe(n + 1);
    expect(w.groups()).toBe('Plates Plates Plates Plates - -');
    await w.controller.undo();
    expect(w.groups()).toBe('Folder Folder Folder Folder - -');

    await w.controller.edit(ops(ungroupPlan(w.feats(), 'Folder')));
    expect(w.controller.history().length).toBe(n + 1);
    expect(w.groups()).toBe('- - - - - -');
    expect(w.feats().some((f) => 'group' in f)).toBe(false);
    await w.controller.undo();
    expect(w.groups()).toBe('Folder Folder Folder Folder - -');

    // F6 (and the sketch under it) follow the folder's end: join in one edit
    const joined = await go(w, dropPlan(w.rows(), w.feats(), { kind: 'row', id: 'F6' }, { kind: 'folder', name: 'Folder' }));
    expect(joined.ok).toBe(true);
    expect(w.controller.history().length).toBe(n + 1);
    expect(w.groups()).toBe('Folder Folder Folder Folder Folder Folder');   // F6 and the sketch under it
    await w.controller.undo();
    expect(w.groups()).toBe('Folder Folder Folder Folder - -');
  });

  it('a drag moves a feature with its sketch as one step; undo puts it back', async () => {
    const w = await world();
    const n = w.controller.history().length;
    const r = await go(w, dropPlan(w.rows(), w.feats(), { kind: 'row', id: 'F6' }, { kind: 'row', id: 'F2' }));
    expect(r.ok).toBe(true);
    expect(w.controller.history().length).toBe(n + 1);
    expect(w.feats().map((f) => f.id)).toEqual(['F5', 'F6', 'F1', 'F2', 'F3', 'F4']);
    await w.controller.undo();
    expect(w.feats().map((f) => f.id)).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'F6']);
  });

  it('moving a folder past another row is one step, and the build is the same part', async () => {
    const w = await world();
    await w.controller.edit(ops(groupPlan(w.rows(), w.feats(), ['F2', 'F4'], 'Folder')));
    const box = () => JSON.stringify(w.controller.bodyBox());
    const was = box();
    const n = w.controller.history().length;
    const r = await go(w, dropPlan(w.rows(), w.feats(), { kind: 'folder', name: 'Folder' }, { kind: 'row', id: 'F6' }));
    expect(r.ok).toBe(true);
    expect(w.controller.history().length).toBe(n + 1);
    expect(w.feats().map((f) => f.id)).toEqual(['F5', 'F6', 'F1', 'F2', 'F3', 'F4']);
    expect(w.groups()).toBe('- - Folder Folder Folder Folder');
    expect(box()).toBe(was);   // independent slabs added in another order: same solid
    await w.controller.undo();
    expect(w.feats().map((f) => f.id)).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'F6']);
    expect(w.groups()).toBe('Folder Folder Folder Folder - -');
    await w.controller.redo();
    expect(w.feats().map((f) => f.id)).toEqual(['F5', 'F6', 'F1', 'F2', 'F3', 'F4']);
  });

  it('the folder is in the saved document and comes back after a reload', async () => {
    const w = await world();
    await w.controller.edit(ops(groupPlan(w.rows(), w.feats(), ['F4', 'F6'], 'Folder')));
    const saved = JSON.parse(JSON.stringify(w.controller.document())) as PartDoc;   // what a .ckpart holds
    const again = await world();
    await again.controller.load(saved);
    expect(again.groups()).toBe('- - Folder Folder Folder Folder');
  });
});
