import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from '../controller';
import { planHandles, type PlanCtx } from './plan';
import { HandleRunner } from './runner';
import type { HandleSession } from './session';

const rect = { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' },
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: -20, y: -20 }, { id: 'p2', x: 20, y: -20 }, { id: 'p3', x: 20, y: 20 }, { id: 'p4', x: -20, y: 20 }],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b })), constraints: [] };
const pts = { type: 'sketch', id: 'F3', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'q1', x: 0, y: 0 }], entities: [{ id: 'pt1', type: 'point', p: 'q1' }], constraints: [] };
const block = (extra: unknown[] = []): PartDoc => ({ ...emptyPart('Block'), features: [rect, { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 30 }, ...extra], seq: 10 }) as unknown as PartDoc;

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

type Body = { mesh: { faceIds: string[] }; box: { min: number[]; max: number[] } } | null;

async function world(doc: PartDoc) {
  const store = createStore();
  let shown: Body = null;
  const view: ViewSink = { setBody(b) { shown = b as Body; }, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view, kernel });
  await controller.load(doc);
  const created: string[] = [];
  const runner = new HandleRunner({
    preview: (ops) => controller.preview(ops, 0),
    cancelPreview: () => controller.cancelPreview(),
    commit: async (c) => { const before = controller.document()!.features.length; await controller.commit(c.ops); if (c.create) created.push(controller.document()!.features[before]?.id ?? ''); },
  });
  const plan = (selection: string[], mode: string, over: Partial<PlanCtx> = {}): HandleSession | null =>
    planHandles({ doc: controller.document(), selection, mode, edges: controller.bodyEdges(), mesh: controller.bodyFaces(), box: controller.bodyBox(), editingId: null, sketching: false, enabled: true, ...over });
  const edgeKey = (a: string, b: string) => controller.bodyEdges().find((e) => e.faces?.includes(a) && e.faces?.includes(b))!.key!;
  /** Drag: start, a few steps, then release (or cancel). */
  const drag = async (s: HandleSession, id: string, qs: number[], end: 'commit' | 'cancel' = 'commit') => {
    const sink = runner.sink(s);
    sink.onStart!(id);
    for (const q of qs) { sink.onDrag(id, q, [0, 0, 0]); await new Promise((r) => setTimeout(r, 5)); }
    await new Promise((r) => setTimeout(r, 200));
    const last = qs[qs.length - 1];
    if (end === 'commit') await runner.commit(s.commit(id, last, [0, 0, 0])); else await runner.cancel();
  };
  const volume = async () => ((await sessions.at(-1)!.massProps()) as { volume: number }).volume;
  const errors = async () => (await sessions.at(-1)!.verify()).regen.errors.map(([id, e]) => `${id}:${e.code}`);
  return { controller, plan, edgeKey, drag, volume, errors, created, shown: () => shown, doc: () => controller.document()!, undoDepth: () => sessions.at(-1)!.history().length };
}

describe('handle gestures against the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('edge dot: dragging out previews a fillet, in a chamfer, and release makes ONE feature', async () => {
    const w = await world(block());
    const base = await w.volume();
    const s = w.plan([w.edgeKey('F2.C1', 'F2.S.e1')], 'edge')!;
    expect(s.kind).toBe('round-new');
    const before = w.undoDepth();
    await w.drag(s, 'round', [0.5, 1, 2, 3], 'cancel');
    expect(w.shown()?.mesh.faceIds).toContain('F2.C1');        // the body is back
    expect(w.doc().features.length).toBe(2);                    // cancel wrote nothing
    expect(w.undoDepth()).toBe(before);
    await w.drag(s, 'round', [1, 2, 3, 4]);
    expect(w.doc().features.length).toBe(3);
    const f = w.doc().features[2] as unknown as { type: string; radius: number; edges: unknown[] };
    expect(f.type).toBe('fillet');
    expect(f.radius).toBe(4);
    expect(f.edges).toHaveLength(1);
    expect(await w.errors()).toEqual([]);
    expect(await w.volume()).toBeLessThan(base);
    expect(w.undoDepth()).toBe(before + 1);
    expect(w.created).toHaveLength(1);
    // a chamfer when dragged in
    await w.controller.undo();
    await w.drag(s, 'round', [-1, -3]);
    const c = w.doc().features[2] as unknown as { type: string; distance: number };
    expect(c.type).toBe('chamfer');
    expect(c.distance).toBe(3);
    expect(await w.errors()).toEqual([]);
  }, 60000);

  it('the same dot on the rounded edge edits the fillet in place with a `set`', async () => {
    const w = await world(block());
    await w.drag(w.plan([w.edgeKey('F2.C1', 'F2.S.e1')], 'edge')!, 'round', [3]);
    const v1 = await w.volume();
    const next = w.controller.bodyEdges().find((e) => e.faces?.some((f) => f.startsWith(w.doc().features[2].id + '.')));
    expect(next).toBeTruthy();
    const s = w.plan([next!.key!], 'edge')!;
    expect(s.kind).toBe('round-edit');
    const n = w.doc().features.length;
    await w.drag(s, 'round', [4, 5]);
    expect(w.doc().features.length).toBe(n);
    expect((w.doc().features[2] as unknown as { radius: number }).radius).toBe(5);
    expect(await w.errors()).toEqual([]);
    expect(await w.volume()).toBeLessThan(v1);
  }, 60000);

  it('corner dot rounds every edge that meets there', async () => {
    const w = await world(block());
    const s = w.plan(['v:-20,-20,30'], 'vertex')!;
    expect(s).not.toBeNull();
    await w.drag(s, 'round', [1, 2]);
    const f = w.doc().features[2] as unknown as { type: string; edges: unknown[] };
    expect(f.type).toBe('fillet');
    expect(f.edges).toHaveLength(3);
    expect(await w.errors()).toEqual([]);
  }, 60000);

  it('end cap arrow: depth follows the drag, typed value and flip through zero', async () => {
    const w = await world(block());
    const s = w.plan(['F2.C1'], 'face')!;
    expect(s.kind).toBe('extrude-depth');
    await w.drag(s, 'depth', [35, 40], 'cancel');
    expect((w.doc().features[1] as unknown as { depth: number }).depth).toBe(30);
    await w.drag(s, 'depth', [35, 40]);
    expect((w.doc().features[1] as unknown as { depth: number }).depth).toBe(40);
    expect(w.controller.bodyBox()!.max[2]).toBe(40);
    expect(w.created).toHaveLength(0);                           // an in-place edit does not open a new feature
    await w.drag(w.plan(['F2.C1'], 'face')!, 'depth', [-5]);
    const e = w.doc().features[1] as unknown as { depth: number; flip?: boolean };
    expect(e.depth).toBe(5);
    expect(e.flip).toBe(true);
    expect(w.controller.bodyBox()!.min[2]).toBe(-5);
    expect(w.controller.bodyBox()!.max[2]).toBe(0);
    expect(await w.errors()).toEqual([]);
  }, 60000);

  it('a cut: the pocket floor arrow deepens the cut when dragged into the part', async () => {
    const small = { ...rect, id: 'F3', points: rect.points.map((p) => (p.id === 'O' ? p : { ...p, x: (p.x as number) / 4, y: (p.y as number) / 4 })) };
    const w = await world(block([small, { type: 'extrude', id: 'F4', op: 'cut', sketch: 'F3', end: 'blind', depth: 10, flip: true }]));
    const names = new Set(w.controller.bodyFaces()!.faceIds);
    expect(names.has('F4.C1')).toBe(true);
    const s = w.plan(['F4.C1'], 'face')!;
    expect(s.kind).toBe('extrude-depth');
    expect(s.specs[0].scale).toBe(-1);
    const v0 = await w.volume();
    // the floor faces out of the part (towards the pocket opening): moving it further that way is a SHALLOWER cut
    expect(s.specs[0].axis[2]).toBe(-1);
    await w.drag(s, 'depth', [12, 15]);
    expect((w.doc().features[3] as unknown as { depth: number }).depth).toBe(15);
    expect(await w.errors()).toEqual([]);
    expect(await w.volume()).toBeLessThan(v0);   // deeper pocket, less material
  }, 60000);

  it('shell: the inner wall arrow sets the thickness', async () => {
    const w = await world(block([{ type: 'shell', id: 'SH', faces: ['F2.C1'], thickness: 2 }]));
    const names = [...new Set(w.controller.bodyFaces()!.faceIds)];
    const wall = names.find((n) => w.plan([n], 'face')?.kind === 'shell-thickness');
    expect(wall).toBeTruthy();
    const s = w.plan([wall!], 'face')!;
    const v0 = await w.volume();
    await w.drag(s, 'thickness', [3, 4]);
    expect((w.doc().features[2] as unknown as { thickness: number }).thickness).toBe(4);
    expect(await w.errors()).toEqual([]);
    expect(await w.volume()).toBeGreaterThan(v0);               // a thicker wall is more material
    // an outer wall has no arrow
    const outer = names.filter((n) => n.includes('~')).filter((n) => w.plan([n], 'face') === null);
    expect(outer.length).toBeGreaterThan(0);
  }, 60000);

  it('hole wall dot sets the diameter', async () => {
    const hole = { type: 'hole', id: 'H', sketch: 'F3', kind: 'simple', size: 'M6', fit: 'normal', end: 'through', flip: true };
    const w = await world(block([pts, hole]));
    const s = w.plan(['H.S.h1'], 'face')!;
    expect(s.kind).toBe('hole-diameter');
    const v0 = await w.volume();
    await w.drag(s, 'diameter', [8, 10]);
    expect((w.doc().features[3] as unknown as { diameter: number }).diameter).toBe(10);
    expect(await w.errors()).toEqual([]);
    expect(await w.volume()).toBeLessThan(v0);
    expect(w.volume).toBeTruthy();
  }, 60000);

  it('moveBody and moveFace are implemented by the kernel (see triball/triball.kernel.test.ts); a bare face selection still gets no contextual arrow', async () => {
    const w = await world(block());
    expect(w.plan(['F2.S.e1'], 'face')).toBeNull();
  }, 60000);
});
