import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import type { SketchDraft } from '@kit/sketch';
import { Controller, type KernelFactory, type SketchEditView, type ViewSink } from './controller';

// Dragging a point in an open sketch and taking edits back: a drop is one undo step, a refused drag is none and leaves
// neither a pin nor a constraint behind, and Undo/Redo walk exactly the steps the user made.

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function newSketch() {
  const edits: Array<SketchEditView | null> = [];
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit(v) { edits.push(v); } };
  const kernel: KernelFactory = { async open(x) { const s = await Session.open(x); sessions.push(s); return s; } };
  const controller = new Controller({ store: createStore(), view, kernel });
  await controller.load({ ...emptyPart('Drag'), features: [], seq: 1 } as unknown as PartDoc);
  expect(await controller.beginNewSketch('front')).not.toBeNull();
  const draft = () => controller.sketchDraft()!;
  const pt = (id: string) => { const p = draft().points.find((q) => q.id === id)!; return [p.x, p.y]; };
  const apply = async (f: (d: SketchDraft) => SketchDraft) => { const r = await controller.applySketchDraft(f(draft())); expect(r.ok).toBe(true); return r; };
  const drag = async (id: string, path: Array<[number, number]>) => {
    for (const [u, v] of path) await controller.dragSketchPoint(id, u, v, 0);
    return controller.endSketchDrag();
  };
  return { controller, edits, draft, pt, apply, drag };
}

/** An arc about the fixed origin from s (on the x axis) to t (on the y axis), radius 10, held by a horizontal and a
 *  vertical line from the origin: s and t cannot move. A free line a-b keeps the sketch under-defined. */
function arcAndLine(d: SketchDraft): SketchDraft {
  return {
    ...d,
    points: [...d.points, { id: 's', x: 10, y: 0 }, { id: 't', x: 0, y: 10 }, { id: 'a', x: 20, y: 5 }, { id: 'b', x: 30, y: 8 }],
    entities: [
      ...d.entities,
      { id: 'arc', type: 'arc', c: 'O', p1: 's', p2: 't' },
      { id: 'ls', type: 'line', p1: 'O', p2: 's' },
      { id: 'lt', type: 'line', p1: 'O', p2: 't' },
      { id: 'lab', type: 'line', p1: 'a', p2: 'b' },
    ],
    constraints: [
      ...d.constraints,
      { id: 'k1', type: 'radius', refs: ['arc'], value: 10 },
      { id: 'k2', type: 'horizontal', refs: ['ls'] },
      { id: 'k3', type: 'vertical', refs: ['lt'] },
    ],
  } as SketchDraft;
}

const addHorizontal = (id: string, line: string) => (d: SketchDraft): SketchDraft => ({ ...d, constraints: [...d.constraints, { id, type: 'horizontal', refs: [line] }] });

describe('sketch point drags and undo', { skip: !process.env.CK_WASM }, () => {
  it('a drop leaves no pin behind: a constraint added after two drags still solves', async () => {
    const w = await newSketch();
    await w.apply((d) => ({ ...d, points: [...d.points, { id: 'a', x: 5, y: 5 }, { id: 'b', x: 15, y: 8 }], entities: [...d.entities, { id: 'l', type: 'line', p1: 'a', p2: 'b' }] }));
    const r1 = await w.drag('a', [[4.5, 4.6], [4, 4]]);
    expect(r1.ok).toBe(true);
    const r2 = await w.drag('b', [[16, 9]]);
    expect(r2.ok).toBe(true);
    expect(w.draft().temp).toEqual([]);
    expect(w.pt('a')[0]).toBeCloseTo(4, 6);
    expect(w.pt('b')[1]).toBeCloseTo(9, 6);
    // the line goes horizontal: neither end is held where it was dropped
    const r = await w.controller.applySketchDraft(addHorizontal('h1', 'l')(w.draft()));
    expect(r.ok).toBe(true);
    expect(r.status?.solved).toBe(true);
    expect(r.status?.conflicts ?? []).toEqual([]);
    expect(w.pt('a')[1]).toBeCloseTo(w.pt('b')[1], 6);
    // a free line: 4 degrees of freedom less the horizontal, no drag pin counted
    expect(w.controller.sketchStatus()?.dof).toBe(3);
  }, 60000);

  it('each drop is one undo step; Undo walks back drag, drag, line; Redo brings them back in order', async () => {
    const w = await newSketch();
    await w.apply((d) => ({ ...d, points: [...d.points, { id: 'a', x: 5, y: 5 }, { id: 'b', x: 15, y: 8 }], entities: [...d.entities, { id: 'l', type: 'line', p1: 'a', p2: 'b' }] }));
    const dof0 = w.controller.sketchStatus()?.dof;
    await w.drag('a', [[4, 4]]);
    await w.drag('b', [[16, 9]]);
    expect(await w.controller.undoSketch()).toBe(true);
    expect(w.pt('b')).toEqual([15, 8]);
    expect(w.pt('a')[0]).toBeCloseTo(4, 6);
    expect(await w.controller.undoSketch()).toBe(true);
    expect(w.pt('a')).toEqual([5, 5]);
    expect(w.controller.sketchStatus()?.dof).toBe(dof0);
    expect(await w.controller.undoSketch()).toBe(true);
    expect(w.draft().entities).toEqual([]);
    expect(await w.controller.undoSketch()).toBe(false);
    // Redo: the line, then each drag
    expect(await w.controller.redoSketch()).toBe(true);
    expect(w.draft().entities.map((e) => e.id)).toEqual(['l']);
    expect(await w.controller.redoSketch()).toBe(true);
    expect(w.pt('a')[0]).toBeCloseTo(4, 6);
    expect(await w.controller.redoSketch()).toBe(true);
    expect(w.pt('b')[1]).toBeCloseTo(9, 6);
    expect(await w.controller.redoSketch()).toBe(false);
    expect(w.draft().temp).toEqual([]);
  }, 60000);

  it('dragging an arc end the constraints hold is refused cleanly: no constraint, no pin, no over-constrained badge, no undo step', async () => {
    const w = await newSketch();
    await w.apply(arcAndLine);
    await w.apply(addHorizontal('h1', 'lab'));
    const before = w.draft();
    const status = w.controller.sketchStatus();
    expect(status?.solved).toBe(true);
    expect(status?.dof).toBeGreaterThan(0);
    const shown = w.edits.at(-1);

    const mid = await w.controller.dragSketchPoint('t', 0, 11, 0);
    expect(mid.ok).toBe(false);
    // the sketch is not fully defined (the free line can move): the hint says the move conflicts, not that the sketch is fully defined
    expect(mid.hint).toBe('app.sketch.conflict');
    // the badge keeps the verdict of the sketch, not of the refused drag
    expect(w.controller.sketchStatus()).toEqual(status);
    const end = await w.controller.endSketchDrag();
    expect(end.ok).toBe(false);
    expect(end.hint).toBe('app.sketch.conflict');

    expect(w.draft()).toEqual(before);
    expect(w.draft().temp).toEqual([]);
    expect(w.draft().constraints.map((c) => c.id)).toEqual(before.constraints.map((c) => c.id));
    expect(w.controller.sketchStatus()).toEqual(status);
    expect(w.edits.at(-1)).toEqual(shown);   // the point is drawn where it was: it snapped back
    // the refused drag is no step: one Undo takes back the horizontal added before it
    expect(await w.controller.undoSketch()).toBe(true);
    expect(w.draft().constraints.some((c) => c.id === 'h1')).toBe(false);
    expect(w.draft().entities.some((e) => e.id === 'arc')).toBe(true);
  }, 60000);

  it('the reported sequence: two horizontals, a free drag, a refused arc-end drag; two Undos take back the free drag and the second horizontal', async () => {
    const w = await newSketch();
    await w.apply(arcAndLine);
    await w.apply((d) => ({ ...d, points: [...d.points, { id: 'c', x: 20, y: 20 }, { id: 'e', x: 30, y: 24 }], entities: [...d.entities, { id: 'lce', type: 'line', p1: 'c', p2: 'e' }] }));
    await w.apply(addHorizontal('h1', 'lab'));
    await w.apply(addHorizontal('h2', 'lce'));
    const afterH2 = w.controller.sketchStatus();
    const free = await w.drag('a', [[21, 5], [22, 6]]);
    expect(free.ok).toBe(true);
    const refused = await w.drag('t', [[0, 10.5], [0, 11]]);
    expect(refused.ok).toBe(false);
    expect(w.controller.sketchStatus()?.solved).toBe(true);
    expect(w.controller.sketchStatus()?.state).not.toBe('over');

    expect(await w.controller.undoSketch()).toBe(true);   // the free drag
    expect(w.pt('a')[0]).toBeCloseTo(20, 6);
    expect(w.draft().constraints.some((c) => c.id === 'h2')).toBe(true);
    expect(w.controller.sketchStatus()?.dof).toBe(afterH2?.dof);
    expect(await w.controller.undoSketch()).toBe(true);   // the second horizontal
    expect(w.draft().constraints.some((c) => c.id === 'h2')).toBe(false);
    expect(w.draft().constraints.some((c) => c.id === 'h1')).toBe(true);
    expect(w.controller.sketchStatus()?.dof).toBe((afterH2?.dof ?? 0) + 1);
  }, 60000);

  it('Undo of a drop gives back the draft from before the drag, with its constraints and no pin', async () => {
    const w = await newSketch();
    await w.apply(arcAndLine);
    const before = w.draft();
    const r = await w.drag('b', [[31, 9]]);
    expect(r.ok).toBe(true);
    expect(await w.controller.undoSketch()).toBe(true);
    expect(w.draft().constraints).toEqual(before.constraints);
    expect(w.draft().temp).toEqual([]);
    for (const p of before.points) {
      const q = w.draft().points.find((x) => x.id === p.id)!;
      expect(q.x).toBeCloseTo(p.x, 9); expect(q.y).toBeCloseTo(p.y, 9);
    }
  }, 60000);

  it('a click on a handle with no move is no drag and no step', async () => {
    const w = await newSketch();
    await w.apply(arcAndLine);
    const r = await w.controller.endSketchDrag();
    expect(r.ok).toBe(true);
    expect(r.view).toBeUndefined();
    expect(await w.controller.undoSketch()).toBe(true);   // the arc and line, nothing else
    expect(await w.controller.undoSketch()).toBe(false);
  }, 60000);
});
