// What the Extrude editor says when the kernel refuses an End scale: the kernel's own sentence and hint reach the preview line.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function load(extra: Record<string, unknown>): Promise<{ c: Controller; hint: string | undefined; ok: boolean }> {
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {}, setThreads() {} };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const c = new Controller({ store: createStore(), view, kernel });
  const sketch = { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' },
    points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: -10, y: -10 }, { id: 'p2', x: 10, y: -10 }, { id: 'p3', x: 10, y: 10 }, { id: 'p4', x: -10, y: 10 }],
    entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([id, p1, p2]) => ({ id, type: 'line', p1, p2 })), constraints: [] };
  await c.load({ ...emptyPart('x'), features: [sketch] } as unknown as PartDoc);
  const id = 'F1';
  const r = await c.preview([{ op: 'add', feature: { type: 'extrude', op: 'add', sketch: id, end: 'blind', depth: 10, endScale: 2, ...extra } }] as never, 0);
  return { c, hint: r.hint, ok: r.ok };
}

describe('end scale refusals', { skip: !process.env.CK_WASM }, () => {
  it.each([
    ['through', { end: 'through' }, /set distance.*blind or mid-plane/],
    ['draft', { draft: 5 }, /both taper the sides; use either a draft angle or an end scale/],
    ['twist', { twist: 20 }, /not supported; use either a twist or an end scale/],
    ['zero scale', { endScale: 0 }, /not a positive number; use an end scale above 0/],
  ])('%s', async (_name, extra, want) => {
    const r = await load(extra as Record<string, unknown>);
    expect(r.ok).toBe(false);
    expect(r.hint).toMatch(want);
  }, 120000);
});
