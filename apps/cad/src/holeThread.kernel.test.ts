// The Threaded hole against the real kernel: a hole with four positions gets one thread per wall in a single edit (one undo
// step), the tap drill makes them fit, editing the hole again changes all of them, clearing Threaded removes them.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import { newHole } from './holeData';
import { defaultHoleThread, holeThreadEditOps, linkedThreads, tapHolePatch } from './holeThread';
import { cylindersOfFaces, holeWallFaces, sameSizeFaces, threadGroup, threadOpsForFaces } from './threadData';

const rect = { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' },
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: -20, y: -20 }, { id: 'p2', x: 20, y: -20 }, { id: 'p3', x: 20, y: 20 }, { id: 'p4', x: -20, y: 20 }],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b })), constraints: [] };
const corners = [[-14, -14], [14, -14], [14, 14], [-14, 14]];
const pts = { type: 'sketch', id: 'F3', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, ...corners.map(([x, y], i) => ({ id: `q${i}`, x, y }))],
  entities: corners.map((_, i) => ({ id: `pt${i}`, type: 'point', p: `q${i}` })), constraints: [] };
const doc = (): PartDoc => ({ ...emptyPart('Block'), features: [rect, { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 30 }, pts, { ...newHole('F3', true), id: 'H', size: 'M8', fit: 'normal' }], seq: 5 }) as unknown as PartDoc;

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
async function world() {
  const store = createStore();
  const threads: unknown[][] = [];
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {}, setThreads: (i) => { threads.push(i); } };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view, kernel });
  await controller.load(doc());
  return { store, controller, shown: () => threads.at(-1) as Array<Record<string, unknown>> };
}
const feats = (c: Controller) => c.document()!.features as unknown as Array<Record<string, unknown>>;

describe('Threaded hole against the kernel', { skip: !process.env.CK_WASM }, () => {
  it('four positions: walls are found, Threaded adds one thread per wall in one edit, all fit the tap drill', async () => {
    const w = await world();
    const c = w.controller;
    const walls = holeWallFaces('H', c.bodyEdges());
    expect(walls.length).toBe(4);
    const rows = await c.threadSizes('metric');
    const d = defaultHoleThread({ ...feats(c).find((f) => f.id === 'H')!, size: 'M8' }, rows)!;
    expect(d.cfg).toMatchObject({ standard: 'metric', size: 'M8', length: 'full' });
    const hole = feats(c).find((f) => f.id === 'H')!;
    const patch = tapHolePatch(d.row);
    expect(patch).toEqual({ size: 'M8', fit: 'tap', diameter: null });
    const before = (c as unknown as { session: Session }).session.history().length;
    const ops = [{ op: 'set' as const, id: 'H', path: 'fit', value: 'tap' }, ...holeThreadEditOps('H', linkedThreads(feats(c), 'H'), d.cfg, walls)];
    expect(ops.filter((o) => o.op === 'add')).toHaveLength(4);
    expect((await c.preview(ops, 0)).ok).toBe(true);
    expect(w.shown().map((x) => x.face).sort()).toEqual([...walls].sort());   // the cosmetic markers of all four, already in the preview
    expect((await c.commit(ops)).ok).toBe(true);
    expect((c as unknown as { session: Session }).session.history().length).toBe(before + 1);   // one undo step
    expect(linkedThreads(feats(c), 'H').map((t) => t.face).sort()).toEqual([...walls].sort());
    expect(w.store.featureStatus.value.filter((s) => !s.ok)).toEqual([]);
    expect(w.store.featureWarnings.value).toEqual({});   // the tap drill fits every thread
    expect(hole.id).toBe('H');

    // editing the hole again: all four threads follow (size and hand), one more step
    expect(tapHolePatch(rows.find((r) => r.size === 'M6')!)).toEqual({ size: 'M6', fit: 'tap', diameter: null });
    const cfg = { ...d.cfg, size: 'M6', class: '6H', hand: 'left' as const };
    const ops2 = [{ op: 'replace' as const, id: 'H', feature: { ...hole, size: 'M6', fit: 'tap' } as never }, ...holeThreadEditOps('H', linkedThreads(feats(c), 'H'), cfg, walls)];
    expect(ops2.filter((o) => o.op === 'replace')).toHaveLength(5);
    expect((await c.commit(ops2)).ok).toBe(true);
    const now = linkedThreads(feats(c), 'H');
    expect(now.every((t) => t.size === 'M6' && t.hand === 'left')).toBe(true);
    expect(w.store.featureWarnings.value).toEqual({});
    expect(w.shown().every((x) => x.size === 'M6' && x.hand === 'left')).toBe(true);

    // Threaded cleared: the four threads go in one edit
    const off = holeThreadEditOps('H', now, null, walls);
    expect(off).toHaveLength(4);
    expect((await c.commit(off)).ok).toBe(true);
    expect(linkedThreads(feats(c), 'H')).toEqual([]);
    expect(w.shown()).toEqual([]);
  }, 180000);

  it('Select same size finds the four walls of the one diameter', async () => {
    const w = await world();
    const edges = w.controller.bodyEdges();
    const walls = holeWallFaces('H', edges);
    expect(sameSizeFaces(walls[0], edges).sort()).toEqual([...walls].sort());
  }, 60000);

  it('Shift+T on the four walls: one thread each in one edit, shared settings, edited together as a group', async () => {
    const w = await world();
    const c = w.controller;
    const edges = c.bodyEdges();
    const walls = sameSizeFaces(holeWallFaces('H', edges)[0], edges);
    const rows = await c.threadSizes('metric');
    const ops = threadOpsForFaces(cylindersOfFaces(walls, edges)!, rows)!;
    expect(ops).toHaveLength(4);
    const s = (c as unknown as { session: Session }).session;
    const before = s.history().length;
    expect((await c.edit(ops)).ok).toBe(true);
    expect(s.history().length).toBe(before + 1);
    const threads = feats(c).filter((f) => f.type === 'thread');
    expect(threads.map((t) => t.face).sort()).toEqual([...walls].sort());
    const ids = threads.map((t) => String(t.id));
    expect(threadGroup(feats(c), ids[2]).sort()).toEqual([...ids].sort());
    // the group is edited together: one size for all four, and the kernel flags the ones the hole does not fit
    const sets = ids.map((id) => ({ op: 'set' as const, id, path: 'size', value: 'M10' }));
    expect((await c.preview(sets, 0)).ok).toBe(true);
    const bad = Object.entries(w.store.featureWarnings.value).filter(([, x]) => (x.all ?? [x]).some((y) => y.code === 'threadDiameterMismatch')).map(([id]) => id);
    expect(bad.sort()).toEqual([...ids].sort());
  }, 120000);
});
