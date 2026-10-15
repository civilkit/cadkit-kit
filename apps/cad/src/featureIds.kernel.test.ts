// Feature ids stay unique and well formed on a document that carries no `seq` (the bundled samples): opening dome_cap,
// then adding a sketch and a hole used to save FNaN / Fnull / F0 / F1 (a duplicate of the first sketch).
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
const sample = (): PartDoc => JSON.parse(readFileSync(`${process.cwd()}/apps/cad/public/samples/bench-dome_cap.ckpart`, 'utf8')) as PartDoc;

describe('feature ids on a document without seq', { skip: !process.env.CK_WASM }, () => {
  it('sketch + hole in one batch get F8, F9, no duplicates', async () => {
    const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {}, setThreads() {} };
    const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
    const c = new Controller({ store: createStore(), view, kernel });
    await c.load(sample());
    expect((sample() as unknown as { seq?: number }).seq).toBeUndefined();
    expect(c.document()!.seq).toBe(8);
    const sk = { type: 'sketch', name: 'hole pt', plane: { kind: 'std', id: 'top' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'h1', x: 20, y: 0 }], entities: [{ id: 'e1', type: 'point', p: 'h1' }], constraints: [] };
    const r = await c.edit([
      { op: 'add', feature: sk as never },
      { op: 'add', feature: { type: 'hole', sketch: 'F8', kind: 'simple', diameter: 12, end: 'through' } as never },
    ]);
    expect(r.ok).toBe(true);
    const ids = c.document()!.features.map((f) => f.id);
    expect(ids.slice(7)).toEqual(['F8', 'F9']);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((i) => /^F\d+$/.test(i))).toBe(true);
  }, 180_000);
});
