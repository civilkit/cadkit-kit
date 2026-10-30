// Editing a knurl against the real kernel through the Controller: the marker on a cut knurl survives the kernel, replacing a knurl is one undo step and keeps its
// place in the feature order, and a faceted band is replaced the same way. Pure rules (round trips, dependents): knurlEdit.test.ts.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import { DEFAULT_KNURL, knurlOps, type KnurlParams } from './knurl';
import { knurlOwner, knurlReplaceOps } from './knurlEdit';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function world() {
  const store = createStore();
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view, kernel });
  await controller.load(emptyPart('Knob') as unknown as PartDoc);
  await controller.edit([
    { op: 'add', feature: { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'p1', x: 0, y: 0 }], entities: [{ type: 'circle', id: 'e1', c: 'p1', r: 10 }], constraints: [] } },
    { op: 'add', feature: { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 12 } },
  ] as never);
  return controller;
}
const P = (o: Partial<KnurlParams> = {}): KnurlParams => ({ ...DEFAULT_KNURL, cosmetic: false, count: 24, depth: 0.6, target: { axis: 'z', center: [0, 0], radius: 10, from: 0, to: 12 }, ...o });
const ids = (c: Controller) => c.document()!.features.map((f) => f.id);
const feats = (c: Controller) => c.document()!.features as unknown as Array<Record<string, unknown> & { id: string; type: string }>;

describe('editing a knurl against the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('a cut knurl keeps its marker through the kernel, and an edit replaces it in place as one undo step', async () => {
    const c = await world();
    const volume = async () => (await c.massProps() as { volume: number }).volume;
    expect((await c.commit(knurlOps(c.document() as never, P()), 'knurl')).ok).toBe(true);
    // a later feature that does not use the knurl: a second sketch, so the knurl is not last
    expect((await c.commit([{ op: 'add', feature: { type: 'sketch', id: 'F5', plane: { kind: 'std', id: 'top' }, points: [], entities: [], constraints: [] } }] as never, 'later')).ok).toBe(true);
    expect(ids(c)).toEqual(['F1', 'F2', 'F3', 'F4', 'F5']);
    const owner = knurlOwner(feats(c), 'F4');
    expect(owner, 'the marker came back from the kernel').not.toBeNull();
    expect(owner!.ids).toEqual(['F3', 'F4']);
    expect(owner!.params).toMatchObject({ pattern: 'straight', count: 24, depth: 0.6 });
    const v24 = await volume();
    const history = c.history().length;
    const ops = knurlReplaceOps(c.document() as never, { ...owner!.params, count: 36 }, owner!);
    const pre = await c.preview(ops, 0);   // the wizard's live preview: the same ops, nothing committed
    expect(pre.ok, JSON.stringify(pre)).toBe(true);
    await c.cancelPreview();
    expect(ids(c)).toEqual(['F1', 'F2', 'F3', 'F4', 'F5']);
    expect(c.history().length).toBe(history);
    const r = await c.commit(ops, 'knurl');
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(c.history().length).toBe(history + 1);   // one step
    expect(feats(c).map((f) => f.type)).toEqual(['sketch', 'extrude', 'sketch', 'extrude', 'sketch']);   // same place: the later sketch is still last
    expect(feats(c)[4].id).toBe('F5');
    expect(knurlOwner(feats(c), feats(c)[3].id)?.params.count).toBe(36);
    expect(await volume()).toBeLessThan(v24);   // more grooves, more removed
    await c.undo();
    expect(ids(c)).toEqual(['F1', 'F2', 'F3', 'F4', 'F5']);
    expect(await volume()).toBeCloseTo(v24, 3);
    expect(knurlOwner(feats(c), 'F3')?.params.count).toBe(24);
  }, 300000);

  it('a faceted band is replaced in place by another pattern, one undo step', async () => {
    const c = await world();
    const p = P({ pattern: 'diamond', count: 12, depth: 0.4, helixAngle: 30 });
    const made = await c.commit(knurlOps(c.document() as never, p), 'knurl');
    expect(made.ok, JSON.stringify(made)).toBe(true);
    expect(feats(c)[2].type).toBe('knurlBand');
    const owner = knurlOwner(feats(c), 'F3')!;
    expect(owner.kind).toBe('band');
    expect(owner.params).toMatchObject({ pattern: 'diamond', count: 12, depth: 0.4, helixAngle: 30 });
    const history = c.history().length;
    const r = await c.commit(knurlReplaceOps(c.document() as never, { ...owner.params, pattern: 'pyramid' }, owner), 'knurl');
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(c.history().length).toBe(history + 1);
    expect(feats(c).map((f) => f.type)).toEqual(['sketch', 'extrude', 'knurlBand']);
    expect(feats(c)[2].pattern).toBe('pyramid');
    await c.undo();
    expect(feats(c)[2].pattern).toBe('diamond');
    expect(feats(c)[2].id).toBe('F3');
  }, 300000);
});
