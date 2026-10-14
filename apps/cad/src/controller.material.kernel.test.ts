import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';

const sketch = { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' },
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 10, y: 0 }, { id: 'p3', x: 10, y: 10 }, { id: 'p4', x: 0, y: 10 }],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b })), constraints: [] };
const doc = (): PartDoc => ({ ...emptyPart('Cube'), features: [sketch, { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 10 }], seq: 3 }) as unknown as PartDoc;

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
async function world() {
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store: createStore(), view, kernel });
  await controller.load(doc());
  return controller;
}
const reset = [{ op: 'set' as const, id: 'F2', path: 'depth', value: 20 }];

describe('part material in the controller', { skip: !process.env.CK_WASM }, () => {
  it('sets the document material as one undo step, and redo brings it back', async () => {
    const c = await world();
    expect(c.document()!.material).toBe('steel');
    expect(c.setMaterial('Aluminium 6061')).toBe(true);
    expect(c.document()!.material).toBe('Aluminium 6061');
    expect(c.setMaterial('Aluminium 6061')).toBe(false);   // unchanged: no step
    await c.undo();
    expect(c.document()!.material).toBe('steel');
    await c.redo();
    expect(c.document()!.material).toBe('Aluminium 6061');
    await c.undo();
    expect(c.document()!.material).toBe('steel');
  });
  it('keeps material steps in order with feature edits', async () => {
    const c = await world();
    c.setMaterial('Brass');
    await c.edit(reset);
    expect(c.document()!.material).toBe('Brass');
    await c.undo();   // the edit
    expect((c.document()!.features[1] as { depth: number }).depth).toBe(10);
    expect(c.document()!.material).toBe('Brass');
    await c.undo();   // the material
    expect(c.document()!.material).toBe('steel');
    await c.redo();
    expect(c.document()!.material).toBe('Brass');
    await c.redo();
    expect((c.document()!.features[1] as { depth: number }).depth).toBe(20);
  });
  it('two changes are two steps; a new edit clears redo; load starts fresh', async () => {
    const c = await world();
    c.setMaterial('Oak'); c.setMaterial('Pine');
    await c.undo();
    expect(c.document()!.material).toBe('Oak');
    await c.edit(reset);
    await c.redo();   // nothing to redo after a new edit
    expect(c.document()!.material).toBe('Oak');
    await c.load(doc());
    expect(c.document()!.material).toBe('steel');
    await c.undo();
    expect(c.document()!.material).toBe('steel');
  });
  it('ignores an empty name', async () => {
    const c = await world();
    expect(c.setMaterial('  ')).toBe(false);
  });
  it('the material survives into the saved document and the mass path still reads the volume', async () => {
    const c = await world();
    c.setMaterial('Mild steel');
    expect(JSON.parse(JSON.stringify(c.document())).material).toBe('Mild steel');
    const m = await c.massProps();
    expect(m!.volume).toBeCloseTo(1000, 0);
  });
});
