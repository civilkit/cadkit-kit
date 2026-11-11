// The 3D Sketch tool against the real kernel through the Controller: a spline drawn with the tool's own code path becomes a sketch3d
// feature the kernel accepts; a circle sketched on the plane normal to its start is swept along it by the Sweep command's own
// creator (which must pick the 3D sketch as the path); the volume is the section area times the path length. Lines, arcs, control
// splines and points regen without errors; editing replaces the sketch in one undo step.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from '../controller';
import type { Ctx, FeatureActions } from '../featureCommands';
import { creatorCommands } from '../featureCreators';
import { splineSamples } from './curves';
import { emptyDraft, finishStroke, movePoint, normalPlane, polylineLength, sketch3dFeature, sketch3dOps, withPoint, type Draft3, type Mode, type P3 } from './model';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

/** What the panel does for a chain of clicks: a point per click, then the chain ends. */
function drawn(mode: Mode, pts: P3[], degree = 3): Draft3 {
  let d = emptyDraft();
  const ids: string[] = [];
  for (const p of pts) { const r = withPoint(d, p); d = r.draft; ids.push(r.id); }
  return finishStroke(d, { mode, ids, degree });
}

async function world() {
  const store = createStore();
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view, kernel });
  await controller.load(emptyPart('Pipe') as unknown as PartDoc);
  const pending: Promise<unknown>[] = [];
  const actions: FeatureActions = {
    context: (): Ctx => ({ doc: controller.document(), selection: store.selection.value, mode: store.mode.value, box: controller.bodyBox(), edges: controller.bodyEdges(), selectedId: null }),
    create: (ops) => { pending.push(controller.commit(ops as never, 'sweep')); },
    holeOnFace: () => {}, addThread: () => {}, holeFlip: () => false, notify: () => {},
  };
  const cmds = creatorCommands(actions);
  const run = async (id: string) => { cmds.find((c) => c.id === id)!.run(); await Promise.all(pending.splice(0)); };
  const errors = async () => (await sessions.at(-1)!.verify()).regen.errors.map(([id, e]) => `${id}:${e.code}`);
  return { controller, run, errors, enabled: (id: string) => cmds.find((c) => c.id === id)!.enabled!() };
}

const PATH: P3[] = [[0, 0, 0], [60, 0, 40], [120, 50, 40], [180, 50, 0], [240, 0, -30]];
const CIRCLE = { type: 'sketch', id: 'F3', plane: { kind: 'feature', id: 'F2' }, points: [{ id: 'c', x: 0, y: 0 }], entities: [{ id: 'k1', type: 'circle', c: 'c', r: 3 }], constraints: [] };

describe('3D Sketch tool against the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('a drawn spline, a profile on the plane normal to its start and the Sweep command make a pipe of the right volume', async () => {
    const w = await world();
    const feature = sketch3dFeature('F1', drawn('spline', PATH));
    const r = await w.controller.commit(sketch3dOps(feature, false, normalPlane('F2', 'F1')) as never, 'sketch3d');
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(await w.errors()).toEqual([]);
    expect((await w.controller.commit([{ op: 'add', feature: CIRCLE }] as never, 'profile')).ok).toBe(true);
    expect(w.enabled('add-sweep')).toBe(true);   // the command finds the 3D sketch as the path
    await w.run('add-sweep');
    const sweep = w.controller.document()!.features.at(-1) as unknown as { type: string; sketch: string; path: { kind: string; id: string } };
    expect(sweep).toMatchObject({ type: 'sweep', sketch: 'F3', path: { kind: 'sketch', id: 'F1' } });
    expect(await w.errors()).toEqual([]);
    const length = polylineLength(splineSamples(PATH, 400));
    const vol = (await w.controller.massProps() as { volume: number }).volume;
    expect(vol / (Math.PI * 9 * length)).toBeGreaterThan(0.995);
    expect(vol / (Math.PI * 9 * length)).toBeLessThan(1.005);
    // the whole tool run is undone in steps: the sweep, the profile, then sketch and plane together
    await w.controller.undo();
    await w.controller.undo();
    await w.controller.undo();
    expect(w.controller.document()!.features).toHaveLength(0);
  }, 300000);

  it('lines, an arc, a control spline and points regen without errors, and a moved point replaces the sketch in one step', async () => {
    const w = await world();
    let d = drawn('line', [[0, 0, 0], [50, 0, 0], [50, 40, 20]]);
    for (const part of [drawn('arc', [[0, 100, 0], [30, 130, 10], [60, 100, 20]]), drawn('cvspline', [[0, 200, 0], [20, 230, 5], [40, 170, 10], [60, 200, 15]], 3), drawn('point', [[80, 80, 80]])]) {
      // merge the drafts under fresh ids, as one sketch holds all of them
      const rename = (id: string) => 'm' + (d.points.length + d.entities.length) + id;
      const map = new Map<string, string>();
      for (const p of part.points) map.set(p.id, rename(p.id));
      for (const e of part.entities) map.set(e.id, rename(e.id));
      d = {
        ...d,
        points: [...d.points, ...part.points.map((p) => ({ ...p, id: map.get(p.id)! }))],
        entities: [...d.entities, ...part.entities.map((e) => ({ ...e, id: map.get(e.id)!, ...(typeof e.p === 'string' ? { p: map.get(e.p)! } : {}), ...(typeof e.p1 === 'string' ? { p1: map.get(e.p1)!, p2: map.get(e.p2 as string)! } : {}), ...(typeof e.c === 'string' ? { c: map.get(e.c)! } : {}), ...(Array.isArray(e.pts) ? { pts: (e.pts as string[]).map((x) => map.get(x)!) } : {}) }))],
      };
    }
    const feature = sketch3dFeature('F1', d);
    expect((await w.controller.commit(sketch3dOps(feature, false) as never, 'sketch3d')).ok).toBe(true);
    expect(await w.errors()).toEqual([]);
    const echoed = w.controller.document()!.features[0] as unknown as { entities: Array<{ type: string }> };
    expect(echoed.entities.map((e) => e.type).sort()).toEqual(['arc', 'cvspline', 'line', 'line', 'point']);
    // editing: the first point moves, the sketch is replaced as one edit
    const moved = sketch3dFeature('F1', movePoint(d, d.points[0].id, [5, 5, 5]), feature);
    expect((await w.controller.commit(sketch3dOps(moved, true) as never, 'sketch3d')).ok).toBe(true);
    expect((w.controller.document()!.features[0] as unknown as { points: Array<{ x: number }> }).points[0].x).toBe(5);
    await w.controller.undo();
    expect((w.controller.document()!.features[0] as unknown as { points: Array<{ x: number }> }).points[0].x).toBe(0);
    await w.controller.undo();
    expect(w.controller.document()!.features).toHaveLength(0);
  }, 300000);

  it('a sketch with a polyline is not a sweep path: the Sweep command does not offer it', async () => {
    const w = await world();
    expect((await w.controller.commit(sketch3dOps(sketch3dFeature('F1', drawn('line', PATH)), false) as never, 'sketch3d')).ok).toBe(true);
    expect((await w.controller.commit([{ op: 'add', feature: { ...CIRCLE, plane: { kind: 'std', id: 'front' } } }] as never, 'profile')).ok).toBe(true);
    expect(w.enabled('add-sweep')).toBe(false);
  }, 300000);
});
