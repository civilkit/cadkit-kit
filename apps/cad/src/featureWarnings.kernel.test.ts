// A fillet that builds with a kernel warning reaches the tree marker data through the controller: a 4 x 10 x 6 box
// with both top edges rounded at r = 3 (wider together than the 4 wide top face) builds with `blendRoundsCross`.
// Needs a kernel that has that warning: set CK_WASM to such a build and CK_WASM_ROUNDS_CROSS=1. Older kernels refuse
// the fillet instead, so without the flag the test is skipped.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { registerCatalog } from '@kit/i18n';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import { warningEntries, warningTips } from './featureWarnings';
import { en } from './locales/en';

registerCatalog('en', en);
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

const doc = {
  format: 'ck-part', version: 1, name: 'Crossing rounds',
  features: [
    { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'top' }, points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 4, y: 0 }, { id: 'p3', x: 4, y: 10 }, { id: 'p4', x: 0, y: 10 }],
      entities: [{ type: 'line', id: 'e1', p1: 'p1', p2: 'p2' }, { type: 'line', id: 'e2', p1: 'p2', p2: 'p3' }, { type: 'line', id: 'e3', p1: 'p3', p2: 'p4' }, { type: 'line', id: 'e4', p1: 'p4', p2: 'p1' }], constraints: [] },
    { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 6 },
    { type: 'fillet', id: 'F3', radius: 3, edges: [{ faces: ['F2.S.e1', 'F2.S.e4'], at: [0, 3, 0] }, { faces: ['F2.S.e1', 'F2.S.e2'], at: [4, 3, 0] }] },
  ],
} as unknown as PartDoc;

describe('crossing rounds warning', { skip: !process.env.CK_WASM || process.env.CK_WASM_ROUNDS_CROSS !== '1' }, () => {
  it('shows on the fillet, clears when the radius no longer crosses, and comes back on undo', async () => {
    const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {}, setThreads() {} };
    const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
    const store = createStore();
    const c = new Controller({ store, view, kernel });
    await c.load(doc);
    const now = () => warningEntries(store.featureWarnings.value, c.document()!.features as never, c.rollbackCount());
    expect(c.diagnosis().roots).toEqual([]);
    const e = now();
    expect(e.map((x) => [x.featureId, x.code])).toEqual([['F3', 'blendRoundsCross']]);
    expect(e[0].advice).toBe(en['diag.advice.blendRoundsCross']);
    expect(warningTips(e).F3.code).toBe('blendRoundsCross');
    expect(store.featureWarnings.value.F3.params?.meetRadius).toBe(2);

    await c.edit([{ op: 'set', id: 'F3', path: 'radius', value: 1.5 }]);
    expect(now()).toEqual([]);
    await c.undo();
    expect(now().map((x) => x.code)).toEqual(['blendRoundsCross']);
    await c.redo();
    expect(now()).toEqual([]);
  });
});
