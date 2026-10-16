// A 500-feature part must open without per-feature bookkeeping piling up: no undo entry for the load, one copy of the document per
// state (not one 1.4 MB deep copy per read), and a bounded heap. Needs CK_WASM; the load takes about a minute.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
const sample = (): PartDoc => JSON.parse(readFileSync(`${process.cwd()}/apps/cad/public/samples/heavy/matx-case.ckpart`, 'utf8')) as PartDoc;

describe('heavy sample (matx-case)', { skip: !process.env.CK_WASM }, () => {
  it('loads with no undo entries, one document copy per state and a bounded heap', async () => {
    const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {}, setThreads() {} };
    const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
    const c = new Controller({ store: createStore(), view, kernel });
    const before = process.memoryUsage().heapUsed;
    const t0 = performance.now();
    await c.load(sample());
    const loadMs = performance.now() - t0;
    const doc = c.document()!;
    expect(doc.features.length).toBeGreaterThan(400);
    expect(sessions[0].history()).toHaveLength(0);                   // loading is not an edit
    // reads of the document are free once it is held: the same object, not a fresh deep copy
    const t1 = performance.now();
    for (let i = 0; i < 50; i++) expect(c.document()).toBe(doc);
    expect(performance.now() - t1).toBeLessThan(100);
    const grownMb = (process.memoryUsage().heapUsed - before) / 1e6;
    console.log(`bigdoc: ${doc.features.length} features, load ${Math.round(loadMs)} ms, heap +${Math.round(grownMb)} MB`);
    expect(grownMb).toBeLessThan(800);
  }, 600_000);
});
