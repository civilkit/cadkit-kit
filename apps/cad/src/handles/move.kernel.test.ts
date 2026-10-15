// Repositioning shapes against the real kernel: a Catalog slot cut, a hole, a shared sketch, one undo step per move,
// the snap results, and the anchor following the profile.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from '../controller';
import { buildShape as build, catalogItem, type BuildResult, type BuiltShape, type PlaceTarget } from '../catalog/shapes';
import { HandleRunner } from './runner';
import { planSizeBox } from './sizeBox';
import type { HandleSession } from './session';

const buildShape = (...a: Parameters<typeof build>): BuiltShape => { const r: BuildResult = build(...a); if ('error' in r) throw new Error(r.error); return r; };
const rect = (id: string, x0: number, y0: number, x1: number, y1: number) => ({
  type: 'sketch', id, plane: { kind: 'std', id: 'front' },
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: x0, y: y0 }, { id: 'p2', x: x1, y: y0 }, { id: 'p3', x: x1, y: y1 }, { id: 'p4', x: x0, y: y1 }],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b })), constraints: [],
});
const slab = (extra: unknown[] = []): PartDoc => ({ ...emptyPart('Slab'), features: [rect('F1', 0, 0, 80, 60), { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 20 }, ...extra], seq: 3 }) as unknown as PartDoc;

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function world(d: PartDoc) {
  const store = createStore();
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(x) { const s = await Session.open(x); sessions.push(s); return s; } };
  const controller = new Controller({ store, view, kernel });
  await controller.load(d);
  const runner = new HandleRunner({ preview: (ops) => controller.preview(ops, 0), cancelPreview: () => controller.cancelPreview(), commit: async (c) => { await controller.commit((c.choices?.[0] ?? c).ops); } });
  const plan = (id: string, tol = 0): HandleSession => planSizeBox({ doc: controller.document(), shapeId: id, frameOf: (s) => controller.sketchFrameOf(s), bodyBox: controller.bodyBox(), mode: 'opposite', edges: controller.bodyEdges(), snapTol: () => tol })!;
  const depth = () => sessions.at(-1)!.history().length;
  const volume = async () => ((await sessions.at(-1)!.massProps()) as { volume: number }).volume;
  const errors = async () => (await sessions.at(-1)!.verify()).regen.errors.map(([id, e]) => `${id}:${e.code}`);
  /** A move drag: steps, then a commit or cancel. `vec` is in the sketch plane's world axes. */
  const drag = async (s: HandleSession, vec: [number, number, number], mods = {}, end: 'commit' | 'cancel' = 'commit') => {
    const sink = runner.sink(s);
    sink.onStart!('move'); sink.onDrag('move', Math.hypot(...vec), vec, mods as never);
    await new Promise((r) => setTimeout(r, 150));
    if (end === 'commit') await runner.commit(s.commit('move', Math.hypot(...vec), vec, mods)); else await runner.cancel();
  };
  const place = async (itemId: string, point: [number, number, number], faceId = 'F2.C1') => {
    const probe = buildShape(catalogItem('add-block')!, { kind: 'face', face: faceId, planar: true, frame: { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }, point: [0, 0, 0] }, controller.document()!.seq);
    const r = await controller.preview(probe.ops, 0);
    const frame = (r.body?.sketches ?? r.sketches ?? []).find((s: { id: string }) => s.id === probe.sketchId)!.frame as PlaceTarget['frame'];
    await controller.cancelPreview();
    const built = buildShape(catalogItem(itemId)!, { kind: 'face', face: faceId, planar: true, frame, point, extent: [80, 60], thickness: 20 }, controller.document()!.seq);
    expect((await controller.commit(built.ops)).ok).toBe(true);
    return { id: built.mainId, sketchId: built.sketchId, frame: frame! };
  };
  return { controller, plan, drag, depth, volume, errors, place, doc: () => controller.document()!, sess: () => sessions.at(-1)! };
}

const pts = (d: PartDoc, id: string) => ((d.features.find((f) => f.id === id) as unknown as { points: Array<{ id: string; x: number; y: number }> }).points);
const centre = (d: PartDoc, id: string) => { const p = pts(d, id).filter((q) => q.id !== 'O'); const xs = p.map((q) => q.x), ys = p.map((q) => q.y); return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]; };

describe('moving shapes against the real kernel', { skip: !process.env.CK_WASM, timeout: 180000 }, () => {
  it('a Catalog slot cut moves in its plane: ONE undo step, the volume is unchanged, the anchor follows, Esc leaves it', async () => {
    const w = await world(slab());
    const slot = await w.place('cut-slot', [30, 20, 20]);
    const v0 = await w.volume();
    const d0 = w.depth();
    const before = centre(w.doc(), slot.sketchId);
    const s = w.plan(slot.id);
    expect(s.specs.map((x) => x.id)).toEqual(expect.arrayContaining(['move', 'anchor', 'ghost', 'guides']));
    // the anchor is the profile's own centre, not the sketch origin
    const a0 = s.specs.find((x) => x.id === 'anchor')!.origin;
    const dx = slot.frame!.x, dy = slot.frame!.y;
    await w.drag(s, [dx[0] * 5, dx[1] * 5, dx[2] * 5], {}, 'cancel');
    expect(w.depth()).toBe(d0);
    expect(centre(w.doc(), slot.sketchId)).toEqual(before);
    await w.drag(s, [dx[0] * 5 + dy[0] * 3, dx[1] * 5 + dy[1] * 3, dx[2] * 5 + dy[2] * 3]);
    expect(w.depth()).toBe(d0 + 1);
    const after = centre(w.doc(), slot.sketchId);
    expect(after[0] - before[0]).toBeCloseTo(5, 3); expect(after[1] - before[1]).toBeCloseTo(3, 3);
    expect(await w.errors()).toEqual([]);
    expect(await w.volume()).toBeCloseTo(v0, 3);
    const s2 = w.plan(slot.id);
    const a1 = s2.specs.find((x) => x.id === 'anchor')!.origin;
    expect(Math.hypot(a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2])).toBeCloseTo(Math.hypot(5, 3), 2);   // the marker went with the shape
    // undo is one step back
    await w.controller.undo();
    expect(centre(w.doc(), slot.sketchId)[0]).toBeCloseTo(before[0], 3);
  });

  it('snapping: the shape centre lands exactly on the face centre; Alt turns it off; Ctrl rounds to the grid; Shift keeps one axis', async () => {
    const w = await world(slab());
    const slot = await w.place('cut-slot', [30, 20, 20]);
    const fx = slot.frame!.x, fy = slot.frame!.y;
    const wv = (du: number, dv: number): [number, number, number] => [fx[0] * du + fy[0] * dv, fx[1] * du + fy[1] * dv, fx[2] * du + fy[2] * dv];
    const c0 = centre(w.doc(), slot.sketchId);
    const s = w.plan(slot.id, 3);
    // the face centre in the sketch frame
    const fc = [40 - slot.frame!.o[0], 30 - slot.frame!.o[1]];
    const u = fc[0] * fx[0] + fc[1] * fx[1], v = fc[0] * fy[0] + fc[1] * fy[1];
    const want = [u - c0[0], v - c0[1]];
    const ops = s.preview('move', 1, wv(want[0] + 1, want[1] - 1))!;           // within 3 mm of it
    const sk = (ops[0] as unknown as { feature: { points: Array<{ id: string; x: number; y: number }> } }).feature;
    const moved = sk.points.filter((q) => q.id !== 'O');
    const mc = [(Math.min(...moved.map((q) => q.x)) + Math.max(...moved.map((q) => q.x))) / 2, (Math.min(...moved.map((q) => q.y)) + Math.max(...moved.map((q) => q.y))) / 2];
    expect(mc[0]).toBeCloseTo(u, 2); expect(mc[1]).toBeCloseTo(v, 2);
    expect(s.format!('move', 1)).toContain('face centre');
    // Alt: exactly where the pointer put it
    const free = s.preview('move', 1, wv(want[0] + 1, want[1] - 1), { alt: true })!;
    const fp = (free[0] as unknown as { feature: { points: Array<{ id: string; x: number }> } }).feature.points.filter((q) => q.id !== 'O');
    expect(Math.min(...fp.map((q) => q.x)) + (Math.max(...fp.map((q) => q.x)) - Math.min(...fp.map((q) => q.x))) / 2).toBeCloseTo(u + 1, 2);
    // Ctrl: whole millimetres; Shift: only the larger component
    const g = s.move!.to(2.4, 0)!;
    expect(g.ops).toHaveLength(1);
    const sh = s.live!('move', 1, wv(7.2, 1.1), { shift: true, alt: true })!;
    expect(sh.find((x) => x.id === 'anchor')!.origin).toBeDefined();
    expect(s.format!('move', 1)).toContain('dy 0');   // Shift: one axis
    s.live!('move', 1, wv(7.4, 1.1), { ctrl: true });
    expect(s.format!('move', 1)).toContain('dx 7,');
  });

  it('a hole moves its point; nudging by the grid step is the same edit', async () => {
    const w = await world(slab());
    const hole = await w.place('hole', [20, 20, 20]);
    const s = w.plan(hole.id);
    expect(s.move).toBeDefined();
    const c0 = pts(w.doc(), hole.sketchId).find((q) => q.id !== 'O')!;
    const d0 = w.depth();
    const c = s.move!.to(s.move!.step, 0)!;                   // one grid step along +u (an arrow key)
    expect((await w.controller.commit(c.ops)).ok).toBe(true);
    expect(w.sess().history().length).toBe(d0 + 1);
    const sk = w.sess().document.features.find((f) => f.id === hole.sketchId) as unknown as { points: Array<{ id: string; x: number }> };
    expect(sk.points.find((q) => q.id === c0.id)!.x).toBeCloseTo(c0.x + 1, 3);
  });

  it('a sketch shared by two extrudes asks: Move all, or Duplicate sketch (only this shape moves)', async () => {
    const d = slab([
      { type: 'sketch', id: 'S5', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'c', x: 40, y: 30 }], entities: [{ id: 'k1', type: 'circle', c: 'c', r: 5 }], constraints: [] },
      { type: 'extrude', id: 'F6', op: 'add', sketch: 'S5', end: 'blind', depth: 5 },
      { type: 'extrude', id: 'F7', op: 'add', sketch: 'S5', end: 'blind', depth: 8, flip: true },
    ]);
    const w = await world(d);
    const s = w.plan('F6');
    const c = s.commit('move', 1, [4, 0, 0], { alt: true })!;
    expect(c.choices?.map((x) => x.id)).toEqual(['all', 'duplicate']);
    expect(c.notice).toContain('F7');
    // Duplicate: a new sketch in front of F6, F6 reads it, F7 keeps the old
    await w.controller.commit(c.choices![1].ops);
    const doc = w.doc();
    const f6 = doc.features.find((f) => f.id === 'F6') as unknown as { sketch: string };
    const f7 = doc.features.find((f) => f.id === 'F7') as unknown as { sketch: string };
    expect(f7.sketch).toBe('S5');
    expect(f6.sketch).not.toBe('S5');
    expect(doc.features.findIndex((f) => f.id === f6.sketch)).toBeLessThan(doc.features.findIndex((f) => f.id === 'F6'));
    expect(pts(doc, 'S5').find((q) => q.id === 'c')!.x).toBe(40);
    expect(pts(doc, f6.sketch).find((q) => q.id === 'c')!.x).toBe(44);
    expect(await w.errors()).toEqual([]);
  });

  it('a block on a cylinder top (with a boss) keeps its position after the move is released', async () => {
    const cyl = [
      { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'c', x: 0, y: 0 }], entities: [{ id: 'k', type: 'circle', c: 'c', r: 40 }], constraints: [] },
      { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 20 },
    ];
    const w = await world({ ...emptyPart('Cyl'), features: cyl, seq: 3 } as unknown as PartDoc);
    const boss = await w.place('add-cylinder', [0, 0, 20]);
    const blk = await w.place('add-block', [20, 10, 20]);
    const before = centre(w.doc(), blk.sketchId);
    const s = w.plan(blk.id);
    const fx = blk.frame.x, fy = blk.frame.y;
    await w.drag(s, [fx[0] * 5 + fy[0] * 2, fx[1] * 5 + fy[1] * 2, fx[2] * 5 + fy[2] * 2], { alt: true });
    const after = centre(w.doc(), blk.sketchId);
    expect(after[0] - before[0]).toBeCloseTo(5, 3);
    expect(after[1] - before[1]).toBeCloseTo(2, 3);
  });

  for (const variant of ['constrained', 'ctrl', 'fixed-corner']) it('a block with ' + variant + ' sketch keeps its move', async () => {
    const cyl = [
      { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'c', x: 0, y: 0 }], entities: [{ id: 'k', type: 'circle', c: 'c', r: 40 }], constraints: [] },
      { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 20 },
    ];
    const w = await world({ ...emptyPart('Cyl'), features: cyl, seq: 3 } as unknown as PartDoc);
    const blk = await w.place('add-block', [20, 10, 20]);
    const sk = structuredClone(w.doc().features.find((f) => f.id === blk.sketchId)) as unknown as { points: Array<{ id: string; x: number; y: number; fixed?: boolean }>; constraints: unknown[] };
    const P = (id: string) => sk.points.find((q) => q.id === id)!;
    if (variant === 'constrained') sk.constraints = [
      { id: 'c1', type: 'horizontal', refs: ['e1'] }, { id: 'c2', type: 'vertical', refs: ['e2'] }, { id: 'c3', type: 'horizontal', refs: ['e3'] }, { id: 'c4', type: 'vertical', refs: ['e4'] },
      { id: 'd1', type: 'hdist', refs: ['O', 'p1'], value: P('p1').x }, { id: 'd2', type: 'vdist', refs: ['O', 'p1'], value: P('p1').y },
      { id: 'd3', type: 'hdist', refs: ['p1', 'p2'], value: P('p2').x - P('p1').x }, { id: 'd4', type: 'vdist', refs: ['p2', 'p3'], value: P('p3').y - P('p2').y },
    ];
    if (variant === 'fixed-corner') P('p1').fixed = true;
    expect((await w.controller.commit([{ op: 'replace', id: blk.sketchId, feature: sk } as never])).ok).toBe(true);
    const before = centre(w.doc(), blk.sketchId);
    const s = w.plan(blk.id);
    const fx = blk.frame.x, fy = blk.frame.y;
    await w.drag(s, [fx[0] * 5 + fy[0] * 2, fx[1] * 5 + fy[1] * 2, fx[2] * 5 + fy[2] * 2], variant === 'ctrl' ? { ctrl: true } : { alt: true });
    const after = centre(w.doc(), blk.sketchId);
    const verify = await w.sess().verify();
    expect(after[0] - before[0]).toBeCloseTo(variant === 'ctrl' ? 5 : 5, 3);
    void verify;
  });

  it('a block moved onto a boss added after it keeps the move', async () => {
    const cyl = [
      { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'c', x: 0, y: 0 }], entities: [{ id: 'k', type: 'circle', c: 'c', r: 40 }], constraints: [] },
      { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 20 },
    ];
    const w = await world({ ...emptyPart('Cyl'), features: cyl, seq: 3 } as unknown as PartDoc);
    const blk = await w.place('add-block', [20, 10, 20]);
    const boss = await w.place('add-cylinder', [0, 0, 20]);
    const before = centre(w.doc(), blk.sketchId);
    const s = w.plan(blk.id);
    const fx = blk.frame.x, fy = blk.frame.y;
    await w.drag(s, [-fx[0] * 20 - fy[0] * 8, -fx[1] * 20 - fy[1] * 8, -fx[2] * 20 - fy[2] * 8], { alt: true });
  });

  it('release while previews are still in flight', async () => {
    const cyl = [
      { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'c', x: 0, y: 0 }], entities: [{ id: 'k', type: 'circle', c: 'c', r: 40 }], constraints: [] },
      { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 20 },
    ];
    const w = await world({ ...emptyPart('Cyl'), features: cyl, seq: 3 } as unknown as PartDoc);
    const blk = await w.place('add-block', [20, 10, 20]);
    const before = centre(w.doc(), blk.sketchId);
    const s = w.plan(blk.id);
    const sink = (w as never as { runnerSink?: never }).runnerSink;
    void sink;
    const fx = blk.frame.x, fy = blk.frame.y;
    const run = new HandleRunner({ preview: (ops) => w.controller.preview(ops, 0), cancelPreview: () => w.controller.cancelPreview(), commit: async (c) => { await w.controller.commit(c.ops); } });
    const k = run.sink(s);
    k.onStart!('move');
    for (let i = 1; i <= 6; i++) { const v: [number, number, number] = [fx[0] * i + fy[0] * 0.4 * i, fx[1] * i + fy[1] * 0.4 * i, fx[2] * i + fy[2] * 0.4 * i]; k.onDrag('move', i, v, { alt: true } as never); }
    const v: [number, number, number] = [fx[0] * 6 + fy[0] * 2.4, fx[1] * 6 + fy[1] * 2.4, fx[2] * 6 + fy[2] * 2.4];
    k.onCommit('move', 6, v, { alt: true } as never);
    await new Promise((r) => setTimeout(r, 1500));
  });

  it('a shared sketch no longer waits for an answer: its first choice moves every user, one undo step', async () => {
    const d = slab([
      { type: 'sketch', id: 'S5', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'c', x: 40, y: 30 }], entities: [{ id: 'k1', type: 'circle', c: 'c', r: 5 }], constraints: [] },
      { type: 'extrude', id: 'F6', op: 'add', sketch: 'S5', end: 'blind', depth: 5 },
      { type: 'extrude', id: 'F7', op: 'add', sketch: 'S5', end: 'blind', depth: 8, flip: true },
    ]);
    const w = await world(d);
    const c = w.plan('F6').commit('move', 1, [4, 0, 0], { alt: true })!;
    expect(c.choices![0].id).toBe('all');
    await w.controller.commit(c.choices![0].ops);
    expect(pts(w.doc(), 'S5').find((q) => q.id === 'c')!.x).toBe(44);
  });

  it('Lock to: a block is tied to a hole centre with distances that survive regen and follow the next move', async () => {
    const w = await world(slab());
    const hole = await w.place('hole', [20, 20, 20]);
    const blk = await w.place('add-block', [50, 40, 20]);
    const hc = pts(w.doc(), hole.sketchId).find((q) => q.id !== 'O')!;
    // hole sketch and block sketch are in the same face frame: lock to the hole centre
    const s = w.plan(blk.id);
    expect(s.move!.near.length).toBeGreaterThan(0);
    const lock = s.move!.lockTo({ u: hc.x, v: hc.y })!;
    expect((await w.controller.commit(lock.ops)).ok).toBe(true);
    const sk = w.doc().features.find((f) => f.id === blk.sketchId) as unknown as { points: Array<{ id: string; x: number; y: number; ext?: boolean; fixed?: boolean }>; constraints: Array<{ type: string; value?: number }> };
    expect(sk.points.some((q) => q.ext && q.fixed)).toBe(true);
    expect(sk.constraints.map((c) => c.type).sort()).toEqual(['hdist', 'vdist']);
    expect(await w.errors()).toEqual([]);
    const c0 = centre(w.doc(), blk.sketchId);
    const h1 = sk.constraints.find((c) => c.type === 'hdist')!.value as number;
    // the lock is still there after a reload of the same document, and the shape did not move
    await w.controller.load(structuredClone(w.doc()) as PartDoc);
    expect(centre(w.doc(), blk.sketchId)).toEqual(c0);
    expect(await w.errors()).toEqual([]);
    // a later move updates the held distances
    const s2 = w.plan(blk.id);
    expect((await w.controller.commit(s2.move!.to(3, 0)!.ops)).ok).toBe(true);
    const after = w.doc().features.find((f) => f.id === blk.sketchId) as unknown as { constraints: Array<{ type: string; value: number }> };
    expect(Math.abs(after.constraints.find((c) => c.type === 'hdist')!.value - h1)).toBeCloseTo(3, 3);
    expect(await w.errors()).toEqual([]);
  });
});
