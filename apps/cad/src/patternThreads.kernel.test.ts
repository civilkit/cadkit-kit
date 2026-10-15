// Threads in patterns against the real kernel: the patterned-threaded-holes sample (one M5 hole, its thread, a circular
// pattern of 6) shows a cosmetic marker on every instance, editing the source thread moves all copies, Carry threads off
// leaves plain holes, and a thread added after the pattern still follows. Needs CK_WASM.
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import { followedFaces, instanceCount, patternedBy, type ThreadEntry } from './patternThreads';

const SAMPLE = resolve(process.cwd(), 'apps/cad/public/samples/patterned-threaded-holes.ckpart');
const sample = (): PartDoc => JSON.parse(readFileSync(SAMPLE, 'utf8')) as PartDoc;
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function world(doc: PartDoc) {
  const store = createStore();
  const threads: unknown[][] = [];
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {}, setThreads: (i) => { threads.push(i); } };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view, kernel });
  await controller.load(doc);
  return { store, controller, shown: () => (threads.at(-1) ?? []) as Array<Record<string, unknown>> };
}
const feats = (c: Controller) => c.document()!.features as unknown as Array<Record<string, unknown>>;

describe('threads in patterns with the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('the sample: one thread entry per instance, markers on all six, the pattern is noted in the tree rules', async () => {
    const w = await world(sample());
    const c = w.controller;
    expect(w.store.featureStatus.value.filter((s) => !s.ok)).toEqual([]);
    const shown = w.shown();
    expect(shown.map((x) => x.id)).toEqual(['F5', 'F5@F7.1', 'F5@F7.2', 'F5@F7.3', 'F5@F7.4', 'F5@F7.5']);
    expect(shown.slice(1).every((x) => x.instanceOf === 'F5' && x.size === 'M5' && x.modeled === false)).toBe(true);
    expect(shown[3].face).toBe('F4.S.h1@F7.3');
    expect(w.store.featureWarnings.value).toEqual({});
    expect(instanceCount(c.threadsNow() as ThreadEntry[], 'F5')).toBe(6);
    expect(followedFaces(['F4.S.h1@F7.2', 'F4.S.h1'], c.threadsNow() as ThreadEntry[])).toEqual({ 'F4.S.h1@F7.2': 'F5' });
    expect(patternedBy(feats(c))).toEqual({ F4: ['F7'], F5: ['F7'] });
  }, 120000);

  it('editing the source thread (size, hand, length) moves every copy; Carry threads off leaves one', async () => {
    const w = await world(sample());
    const c = w.controller;
    const hole = feats(c).find((f) => f.id === 'F4')!;
    expect((await c.commit([
      { op: 'replace', id: 'F4', feature: { ...hole, size: 'M6' } as never },
      { op: 'set', id: 'F5', path: 'size', value: 'M6' }, { op: 'set', id: 'F5', path: 'hand', value: 'left' }, { op: 'set', id: 'F5', path: 'length', value: 6 },
    ])).ok).toBe(true);
    expect(w.shown().length).toBe(6);
    expect(w.shown().every((x) => x.size === 'M6' && x.hand === 'left' && x.length === 6)).toBe(true);
    expect((await c.commit([{ op: 'set', id: 'F7', path: 'carryThreads', value: false }])).ok).toBe(true);
    expect(w.shown().map((x) => x.id)).toEqual(['F5']);
    expect((await c.commit([{ op: 'replace', id: 'F7', feature: (({ carryThreads: _drop, ...rest }) => ({ ...rest, count: 3 }))(feats(c).find((f) => f.id === 'F7')!) as never }])).ok).toBe(true);
    expect(w.shown().map((x) => x.id)).toEqual(['F5', 'F5@F7.1', 'F5@F7.2']);
  }, 180000);

  it('a thread added after the pattern still follows onto the copies', async () => {
    const doc = sample();
    const noThread = { ...doc, features: doc.features.filter((f) => f.id !== 'F5') } as PartDoc;
    const w = await world(noThread);
    expect(w.shown()).toEqual([]);
    const add = { type: 'thread', face: 'F4.S.h1', standard: 'metric', size: 'M5', class: '6H', length: 'full', hand: 'right', modeled: false };
    expect((await w.controller.commit([{ op: 'add', feature: add as never }])).ok).toBe(true);
    expect(w.shown().length).toBe(6);
    expect(w.shown().filter((x) => x.instanceOf !== undefined).length).toBe(5);
  }, 120000);
});
