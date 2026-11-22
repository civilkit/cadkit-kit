import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import { redefinePlaneOps } from './redefinePlane';

const sketch = {
  type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' },
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 20, y: 0 }, { id: 'p3', x: 20, y: 20 }, { id: 'p4', x: 0, y: 20 }],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b })),
  constraints: [],
};
const doc = (): PartDoc => ({ ...emptyPart('R'), features: [sketch, { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 10 }], seq: 3 }) as unknown as PartDoc;

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

describe('Redefine Sketch Plane edit', { skip: !process.env.CK_WASM }, () => {
  it('moves a sketch (and the extrude built on it) to another origin plane in one edit', async () => {
    const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
    const kernel: KernelFactory = { async open(x) { const s = await Session.open(x); sessions.push(s); return s; } };
    const controller = new Controller({ store: createStore(), view, kernel });
    await controller.load(doc());
    const r = await controller.edit(redefinePlaneOps('F1', { kind: 'std', id: 'top' }), 'redefine sketch plane');
    expect(r.ok).toBe(true);
    const f = controller.document()!.features.find((x) => x.id === 'F1') as unknown as { plane: { kind: string; id: string } };
    expect(f.plane).toEqual({ kind: 'std', id: 'top' });
  });
});
