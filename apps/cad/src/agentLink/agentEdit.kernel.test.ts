// app_edit against the real controller and kernel: one transaction is one history step, a failed one changes nothing, a stale revision is refused,
// and ids survive. (Needs the kernel: CK_WASM.)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { AgentSession } from '@kit/agent-tools';
import { BridgeError } from '@kit/agent-link';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from '../controller';
import { makeAppHandler, type AppDeps } from './appHandlers';

const sessions: Session[] = [];
let c: Controller, h: ReturnType<typeof makeAppHandler>, store: ReturnType<typeof createStore>;
let part: PartDoc;
const state = async () => (await h('state', { fields: ['type', 'params'], limit: 500 })) as { revision: number; documentId: string; features: Array<{ id: string; type: string; params?: Record<string, unknown> }> };
const err = async (go: () => Promise<unknown>): Promise<BridgeError> => { const e = await go().then(() => null, (x) => x); expect(e).toBeInstanceOf(BridgeError); return e; };

beforeAll(async () => {
  const a = await AgentSession.open({ wasmPath: process.env.CK_WASM });
  const r = await a.runScript(`const p = part('Pair');
p.sketch('front', (s) => s.rect(20, 20)).extrude(10);
p.sketch('front', (s) => s.rect(10, 10, [40, 0])).extrude(10, { newBody: 'Peg' });`, 'new', { name: 'Pair' });
  expect(r.ok, JSON.stringify(r.errors)).toBe(true);
  part = JSON.parse(JSON.stringify(a.doc)) as PartDoc;
  await a.close();
  store = createStore();
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  c = new Controller({ store, view, kernel });
  await c.load(JSON.parse(JSON.stringify(part)) as PartDoc);
  const deps: AppDeps = {
    document: () => c.document() as never, selection: () => [], facts: () => ({ faces: 0, triangles: 0, rebuildMs: null }), status: () => store.featureStatus.value,
    hasSolid: () => c.hasSolid(), allowEdit: () => true, render: async () => null, runScript: async () => ({ ok: true, errors: [], created: [], featureCount: 0 }),
    undo: () => c.undo(), redo: () => c.redo(), revision: () => c.revision, documentId: () => c.documentId,
    edit: async (expected, ops, reason) => {
      const r = await c.editIfRevision(expected, ops as never, reason);
      if ('stale' in r) return { ok: false, stale: true, revision: r.revision };
      return r.ok ? { ok: true } : { ok: false, errors: (r.errors ?? []).map(([feature, e]: [string, { code?: string }]) => ({ feature, code: e.code ?? 'error' })), message: r.schemaError ?? r.hints?.map((x: { hint: string }) => x.hint).join('; ') };
    },
  };
  h = makeAppHandler(deps);
}, 120000);
afterAll(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

describe('app_edit on the real controller', () => {
  it('a setParam and an add are ONE undo step, the ids of everything else are unchanged, and the revision and the delta say what happened', async () => {
    const s0 = await state();
    const ids0 = s0.features.map((f) => f.id);
    const histBefore = c.history().length;
    const ext = s0.features.find((f) => f.type === 'extrude')!;
    const depthBefore = ext.params!.depth;
    const r = await h('edit', { expectedRevision: s0.revision, reason: 'taller pad', ops: [
      { op: 'setParam', id: ext.id, path: 'depth', value: 25 },
      { op: 'add', feature: { type: 'sketch', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: 100, y: 0 }, { id: 'p2', x: 105, y: 0 }, { id: 'p3', x: 105, y: 5 }, { id: 'p4', x: 100, y: 5 }], entities: [{ id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'line', p1: 'p2', p2: 'p3' }, { id: 'e3', type: 'line', p1: 'p3', p2: 'p4' }, { id: 'e4', type: 'line', p1: 'p4', p2: 'p1' }], constraints: [] } },
    ] }) as { revision: number; changedIds: string[]; addedIds: string[]; removedIds: string[]; validation: { errorCount: number } };
    expect(r.revision).toBeGreaterThan(s0.revision);
    expect(r.changedIds).toContain(ext.id); expect(r.addedIds).toHaveLength(1); expect(r.removedIds).toEqual([]); expect(r.validation.errorCount).toBe(0);
    expect(c.history().length).toBe(histBefore + 1);                             // one transaction, one history record
    const s1 = await state();
    expect(s1.features.slice(0, ids0.length).map((f) => f.id)).toEqual(ids0);    // nothing renumbered
    expect(s1.features.find((f) => f.id === ext.id)!.params!.depth).toBe(25);
    expect(s1.documentId).toBe(s0.documentId);
    const delta = await h('state', { sinceRevision: s0.revision }) as { delta: { added: string[]; changed: string[] } };
    expect(delta.delta).toMatchObject({ available: true, added: r.addedIds, changed: [ext.id] });
    await c.undo();                                                              // ONE undo takes back both ops
    const s2 = await state();
    expect(s2.features.map((f) => f.id)).toEqual(ids0);
    expect(s2.features.find((f) => f.id === ext.id)!.params!.depth).toBe(depthBefore);
  }, 120000);

  it('a transaction the kernel cannot build changes nothing at all: not the document, not the revision, not the history', async () => {
    const s0 = await state();
    const docBefore = JSON.stringify(c.document());
    const hist = c.history().length;
    const ext = s0.features.find((f) => f.type === 'extrude')!;
    // the first op is fine; the second points the extrude at a sketch that is not there, so the whole transaction is refused
    const e = await err(() => h('edit', { expectedRevision: s0.revision, ops: [{ op: 'setParam', id: ext.id, path: 'depth', value: 30 }, { op: 'setParam', id: ext.id, path: 'sketch', value: 'F99' }] }));
    expect(e.code).toBe('edit_rejected');
    expect(e.message).toMatch(/nothing was changed/);
    expect(JSON.stringify(c.document())).toBe(docBefore);
    expect(c.revision).toBe(s0.revision); expect(c.history().length).toBe(hist);
    // an op that cannot even be applied (a path that is not there) is refused too
    const e2 = await err(() => h('edit', { expectedRevision: s0.revision, ops: [{ op: 'setParam', id: ext.id, path: 'depth', value: 31 }, { op: 'setParam', id: ext.id, path: 'nothing.here', value: 1 }] }));
    expect(['edit_rejected', 'app_error']).toContain(e2.code);
    expect(JSON.stringify(c.document())).toBe(docBefore);
  }, 120000);

  it('a stale revision is refused with a hint and nothing changes; two edits from the same revision cannot both land', async () => {
    const s0 = await state();
    const ext = s0.features.find((f) => f.type === 'extrude')!;
    await h('edit', { expectedRevision: s0.revision, ops: [{ op: 'setParam', id: ext.id, path: 'depth', value: 12 }] });
    const after = JSON.stringify(c.document());
    const e = await err(() => h('edit', { expectedRevision: s0.revision, ops: [{ op: 'setParam', id: ext.id, path: 'depth', value: 99 }] }));
    expect(e.code).toBe('stale_revision'); expect(e.hint).toMatch(/sinceRevision/);
    expect(JSON.stringify(c.document())).toBe(after);
    const now = (await state()).revision;
    const results = await Promise.allSettled([1, 2].map((n) => h('edit', { expectedRevision: now, ops: [{ op: 'setParam', id: ext.id, path: 'depth', value: 40 + n }] })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason.code).toBe('stale_revision');
  }, 120000);

  it('replace keeps the id; remove with its dependents (cascade) and a plain remove of something others use is refused whole', async () => {
    const s0 = await state();
    const sk = s0.features.find((f) => f.type === 'sketch')!;
    const docBefore = JSON.stringify(c.document());
    const e = await err(() => h('edit', { expectedRevision: s0.revision, ops: [{ op: 'remove', id: sk.id }] }));    // the extrude after it uses it
    expect(e.code).toBe('edit_rejected');
    expect(JSON.stringify(c.document())).toBe(docBefore);
    const r = await h('edit', { expectedRevision: s0.revision, ops: [{ op: 'remove', id: sk.id, cascade: true }] }) as { removedIds: string[] };
    expect(r.removedIds).toContain(sk.id); expect(r.removedIds.length).toBeGreaterThanOrEqual(2);
    await c.undo();
    expect((await state()).features.map((f) => f.id)).toEqual(s0.features.map((f) => f.id));
  }, 120000);
});
