// The thread GUI against the real kernel: the sample regenerates clean with its two threads, a wrong hole diameter warns
// (with the kernel's hint and `nearest`), a modeled NPT falls back with a warning, Add thread picks the nearest size.
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import { canThread, featureCommands, type Ctx, type FeatureActions } from './featureCommands';
import { cylinderOfFace, holeThreadOps, suggestedSize, threadOps } from './threadData';

const SAMPLE = resolve(process.cwd(), 'apps/cad/public/samples/threaded-bolt.ckpart');
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
  return { store, controller, threads, lastThreads: () => threads.at(-1) as Array<Record<string, unknown>> };
}
const setFeature = (doc: PartDoc, id: string, patch: Record<string, unknown>): PartDoc =>
  ({ ...doc, features: doc.features.map((f) => (f.id === id ? { ...f, ...patch } : f)) }) as PartDoc;

describe('threads with the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('the threaded-bolt sample regenerates with no errors and lists both threads', async () => {
    const w = await world(sample());
    expect(w.store.featureStatus.value.filter((s) => !s.ok)).toEqual([]);
    const th = w.lastThreads();
    expect(th.map((x) => x.id)).toEqual(['F11', 'F6']);
    expect(th.find((x) => x.id === 'F6')).toMatchObject({ face: 'F4.S.c1', size: 'M10', internal: false, diameter: 10, hand: 'right', dir: [0, -1, 0] });
    expect(th.find((x) => x.id === 'F11')).toMatchObject({ face: 'F10.S.h1', size: 'M8', internal: true, diameter: 6.8, dir: [0, 1, 0] });
    expect(w.store.featureWarnings.value).toEqual({});
  }, 60000);

  it('a hole of the wrong diameter gives threadDiameterMismatch with an actionable hint, in the store', async () => {
    const w = await world(setFeature(sample(), 'F10', { fit: 'normal' }));   // M8 normal clearance is 9.0, the thread wants the 6.8 tap drill
    expect(w.store.featureStatus.value.filter((s) => !s.ok)).toEqual([]);   // a warning, not an error
    const warn = w.store.featureWarnings.value.F11;
    expect(warn.code).toBe('threadDiameterMismatch');
    expect(warn.hint).toMatch(/tap drill/);
    expect(suggestedSize(warn.params)).toMatch(/^M/);
  }, 60000);

  it('previewing another size updates the warning, cancelling restores the committed one', async () => {
    const w = await world(sample());
    expect(w.store.featureWarnings.value).toEqual({});
    const r = await w.controller.preview([{ op: 'set', id: 'F6', path: 'size', value: 'M6' }], 0);
    expect(r.ok).toBe(true);
    expect(w.store.featureWarnings.value.F6?.code).toBe('threadDiameterMismatch');
    expect(w.lastThreads().find((x) => x.id === 'F6')).toMatchObject({ size: 'M6' });
    await w.controller.cancelPreview();
    expect(w.store.featureWarnings.value).toEqual({});
    expect(w.lastThreads().find((x) => x.id === 'F6')).toMatchObject({ size: 'M10' });
  }, 60000);

  it('modeled on a tapered NPT thread falls back with a threadModelFallback warning', async () => {
    const w = await world(setFeature(setFeature(sample(), 'F6', { standard: 'NPT', size: '1/4 NPT', modeled: true }), 'F11', {}));
    const warn = w.store.featureWarnings.value.F6;
    expect(warn).toBeTruthy();
    expect((warn.all ?? [warn]).map((x) => x.code)).toContain('threadModelFallback');
    expect(warn.hint.length).toBeGreaterThan(10);
  }, 60000);

  it('the thread tables are fetched once and cached', async () => {
    const w = await world(sample());
    const std = await w.controller.threadStandards();
    expect(std.map((s) => s.id)).toEqual(['metric', 'metric-fine', 'UNC', 'UNF', 'BSP', 'NPT', 'Tr', 'Acme']);
    expect(await w.controller.threadStandards()).toBe(std);
    const rows = await w.controller.threadSizes('metric');
    expect(rows.find((r) => r.size === 'M8')).toMatchObject({ major: 8, pitch: 1.25, tapDrill: 6.8 });
    expect(await w.controller.threadSizes('metric')).toBe(rows);
    expect(await w.controller.threadRow('UNC', '1/4-20')).toMatchObject({ tapDrillName: '#7' });
    expect(await w.controller.threadRow('UNC', 'nope')).toBeNull();
  }, 60000);

  it('cylinderOfFace reads the shaft, the hole wall and rejects a flat face from the real edges', async () => {
    const w = await world(sample());
    const edges = w.controller.bodyEdges();
    expect(cylinderOfFace('F4.S.c1', edges)!.radius).toBeCloseTo(5, 3);
    const hole = cylinderOfFace('F10.S.h1', edges)!;
    expect(hole.radius).toBeCloseTo(3.4, 3);
    expect(hole.internal).toBe(true);
    expect(cylinderOfFace('F8.C1', edges)).toBeNull();   // the block's flat face with the hole in it
    expect(cylinderOfFace('F8.S.b1', edges)).toBeNull();
    expect(cylinderOfFace('F2.S.e1', edges)).toBeNull();   // a hex side
  }, 60000);

  it('Add thread: enabled for a cylindrical face only, and adds the size nearest to its diameter', async () => {
    const doc = sample();
    const bare = { ...doc, features: doc.features.filter((f) => f.type !== 'thread') } as PartDoc;
    const w = await world(bare);
    const ctx = (face: string): Ctx => ({ doc: w.controller.document(), selection: [face], mode: 'face', box: w.controller.bodyBox(), edges: w.controller.bodyEdges() });
    expect(canThread(ctx('F4.S.c1'))).toBe(true);
    expect(canThread(ctx('F10.S.h1'))).toBe(true);
    expect(canThread(ctx('F8.C1'))).toBe(false);
    expect(canThread({ ...ctx('F4.S.c1'), mode: 'edge' })).toBe(false);
    expect(canThread({ ...ctx('F4.S.c1'), selection: ['F4.S.c1', 'F10.S.h1'] })).toBe(true);   // several cylinder faces: one thread each
    expect(canThread({ ...ctx('F4.S.c1'), selection: ['F4.S.c1', 'F8.C1'] })).toBe(false);
    expect(canThread({ ...ctx('F4.S.c1'), doc: null })).toBe(false);

    // the command asks its host to add a thread on the selected face; the host builds the edit from the cached table
    let selection = ['F4.S.c1'];
    const asked: string[][] = [];
    const actions: FeatureActions = {
      context: () => ({ ...ctx('x'), selection }), create: () => {}, holeOnFace: () => {}, holeFlip: () => false, notify: () => {},
      addThread: (f) => { asked.push(f); },
    };
    const cmd = featureCommands(actions).find((c) => c.id === 'add-thread')!;
    expect(cmd.enabled!()).toBe(true);
    cmd.run();
    selection = ['F8.C1'];
    expect(cmd.enabled!()).toBe(false);
    expect(asked).toEqual([['F4.S.c1']]);

    const rows = await w.controller.threadSizes('metric');
    const shaft = cylinderOfFace('F4.S.c1', w.controller.bodyEdges())!;
    const shaftOps = threadOps('F4.S.c1', shaft.radius * 2, rows, shaft.internal)!;
    expect((shaftOps[0] as unknown as { feature: { size: string } }).feature.size).toBe('M10');
    const r = await w.controller.edit(shaftOps);
    expect(r.ok).toBe(true);
    const added = w.controller.document()!.features.at(-1) as unknown as Record<string, unknown>;
    expect(added).toMatchObject({ type: 'thread', face: 'F4.S.c1', standard: 'metric', size: 'M10', length: 'full', hand: 'right', modeled: false });
    expect(w.lastThreads().map((x) => x.face)).toEqual(['F4.S.c1']);
    expect(w.store.featureWarnings.value).toEqual({});

    const holeCyl = cylinderOfFace('F10.S.h1', w.controller.bodyEdges())!;
    const holeOps = threadOps('F10.S.h1', holeCyl.radius * 2, rows, holeCyl.internal)!;
    expect((holeOps[0] as unknown as { feature: { size: string } }).feature.size).toBe('M8');
  }, 90000);

  it('Add thread to this hole: a tapped hole gets a thread on its wall; a non-tapped hole offers none', async () => {
    const doc = sample();
    const bare = { ...doc, features: doc.features.filter((f) => f.type !== 'thread') } as PartDoc;
    const w = await world(bare);
    const hole = w.controller.document()!.features.find((f) => f.id === 'F10') as unknown as Record<string, unknown>;
    const rows = await w.controller.threadSizes('metric');
    const ops = holeThreadOps(hole, rows)!;
    expect((await w.controller.edit(ops)).ok).toBe(true);
    expect(w.lastThreads()[0]).toMatchObject({ face: 'F10.S.h1', size: 'M8', internal: true });
    expect(w.store.featureWarnings.value).toEqual({});
    expect(holeThreadOps({ ...hole, fit: 'normal' }, rows)).toBeNull();
  }, 90000);
});
