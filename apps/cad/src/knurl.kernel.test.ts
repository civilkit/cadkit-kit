// The Knurl wizard's path against the real kernel through the Controller: read the cylinder from the edges the view has, preview the cuts, commit them as one
// step, undo removes them. The helper itself is tested (every pattern) in packages/script/src/knurl.kernel.test.ts.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import { DEFAULT_KNURL, knurlIssue, knurlOps, knurlTarget, suggestCount, suggestDepth } from './knurl';

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

describe('knurl wizard against the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('reads the cylinder from the view edges, previews, commits as one step, undo removes it', async () => {
    const c = await world();
    const volume = async () => (await c.massProps() as { volume: number }).volume;
    const base = await volume();
    const edges = c.bodyEdges() as Array<{ faces?: string[]; pts?: number[][] }>;
    const cylFace = [...new Set(edges.flatMap((e) => e.faces ?? []))].find((f) => 'target' in knurlTarget(f, edges));
    expect(cylFace, 'a cylindrical face is found').toBeTruthy();
    const found = knurlTarget(cylFace!, edges);
    if (!('target' in found)) throw new Error('no target');
    expect(found.target).toMatchObject({ axis: 'z', radius: 10, from: 0, to: 12 });
    const count = suggestCount(10);
    const params = { ...DEFAULT_KNURL, target: found.target, count, depth: suggestDepth(10, count) };
    expect(knurlIssue(params)).toBeNull();
    const ops = knurlOps(c.document() as never, params);
    const pre = await c.preview(ops, 0);
    expect(pre.ok, JSON.stringify(pre)).toBe(true);
    await c.cancelPreview();
    expect(c.document()!.features.length).toBe(2);
    const r = await c.commit(ops, 'knurl');
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(c.document()!.features.length).toBe(4);
    const removed = base - await volume();
    const d = suggestDepth(10, count);
    expect(removed).toBeGreaterThan(count * d * d * 12 * 0.85);   // a 90 degree V is d^2 across the section
    expect(removed).toBeLessThan(count * d * d * 12 * 1.05);
    expect(c.history().length).toBe(2);
    await c.undo();
    expect(c.document()!.features.length).toBe(2);
    expect(await volume()).toBeCloseTo(base, 3);
  }, 300000);
});
