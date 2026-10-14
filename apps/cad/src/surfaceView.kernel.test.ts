// Surface bodies against the real kernel: the surface-patch sample shows its two sheets next to the solid, a part of sheets
// only has no solid, a preview keeps the sheets, Inspect reads the solid only.
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import type { ViewSurface } from '@kit/viewport';

const SAMPLE = resolve(process.cwd(), 'apps/cad/public/samples/surface-patch.ckpart');
const sample = (): PartDoc => JSON.parse(readFileSync(SAMPLE, 'utf8')) as PartDoc;
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

interface Shown { mesh: { faceIds: string[]; triFace: ArrayLike<number> }; edges: Array<{ key?: string }>; box: { min: number[]; max: number[] }; surfaces?: ViewSurface[] }
async function world(doc: PartDoc) {
  const store = createStore();
  const bodies: Array<Shown | null> = [];
  const view: ViewSink = { setBody(b) { bodies.push(b as Shown | null); }, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view, kernel });
  await controller.load(doc);
  return { store, controller, last: () => bodies.at(-1)!, bodies };
}

describe('surface bodies with the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('the surface-patch sample builds clean and hands the viewer a solid and two sheets', async () => {
    const w = await world(sample());
    expect(w.store.featureStatus.value.filter((s) => !s.ok)).toEqual([]);
    const b = w.last();
    expect(b.mesh.triFace.length).toBeGreaterThan(0);               // the base plate
    expect(b.surfaces!.map((x) => x.id)).toEqual(['F5', 'F8']);
    expect(b.surfaces![0].mesh.faceIds.length).toBeGreaterThan(0);
    expect(b.surfaces![0].mesh.faceIds.every((f) => f.startsWith('F5.'))).toBe(true);
    expect(b.surfaces![1].mesh.faceIds.every((f) => f.startsWith('F8.'))).toBe(true);
    expect(b.surfaces!.every((x) => x.mesh.triFace.length > 0 && x.edges.length > 0)).toBe(true);
    // the patch plane is 30 up: the box covers it
    expect(b.box.max[1]).toBeGreaterThanOrEqual(30 - 1e-6);
  }, 60000);

  it('knows which body owns a sheet face or edge, and selects them like the solid', async () => {
    const w = await world(sample());
    const b = w.last();
    const wall = b.surfaces![0];
    expect(w.controller.surfaceOf(wall.mesh.faceIds[0])).toBe('F5');
    expect(w.controller.surfaceOf(wall.edges.find((e) => e.key)!.key!)).toBe('F5');
    expect(w.controller.surfaceOf(b.mesh.faceIds[0])).toBeNull();
    expect(w.controller.surfaceBodies().map((x) => x.id)).toEqual(['F5', 'F8']);
    expect(w.controller.hasSolid()).toBe(true);
    const faces = w.controller.pickableNames('face');
    expect(faces).toEqual(expect.arrayContaining([...wall.mesh.faceIds, ...b.mesh.faceIds]));
    expect(w.controller.pickableNames('edge')).toEqual(expect.arrayContaining(wall.edges.flatMap((e) => (e.key ? [e.key] : []))));
    // selection of a sheet face survives the rebuild (it is a name that still exists)
    w.store.select([wall.mesh.faceIds[0]]);
    await w.controller.rebuild();
    expect(w.store.selection.value).toEqual([wall.mesh.faceIds[0]]);
    // and the measure / section readers see the sheet faces
    expect(w.controller.bodyFaces()!.faceIds).toEqual(expect.arrayContaining(wall.mesh.faceIds));
  }, 60000);

  it('mass properties stay those of the solid plate', async () => {
    const w = await world(sample());
    const m = await w.controller.massProps();
    expect(m!.volume).toBeCloseTo(60 * 40 * 4, 3);
  }, 60000);

  it('a part of sheets only has no solid but still shows them and a box', async () => {
    const doc = sample();
    const only = { ...doc, features: doc.features.filter((f) => !['F1', 'F2'].includes(f.id) && f.id !== 'F3' && f.id !== 'F4' && f.id !== 'F5') } as PartDoc;   // the patch alone
    const w = await world(only);
    expect(w.store.featureStatus.value.filter((s) => !s.ok)).toEqual([]);
    const b = w.last();
    expect(b.mesh.triFace.length).toBe(0);
    expect(b.surfaces!.map((x) => x.id)).toEqual(['F8']);
    expect(w.controller.hasSolid()).toBe(false);
    expect(w.controller.bodyBox()!.max[1]).toBeGreaterThan(w.controller.bodyBox()!.min[1] - 1e-9);
    expect(w.controller.bodyBox()!.max).not.toEqual([0, 0, 0]);
  }, 60000);

  it('a preview that changes the wall keeps both sheets, and cancelling restores them', async () => {
    const w = await world(sample());
    const before = w.last().surfaces![0];
    const r = await w.controller.preview([{ op: 'set', id: 'F5', path: 'depth', value: 12 }], 0);
    expect(r.ok).toBe(true);
    const during = w.last();
    expect(during.surfaces!.map((x) => x.id)).toEqual(['F5', 'F8']);
    expect(during.surfaces![0].box!.max[1]).toBeLessThan(before.box!.max[1]);
    await w.controller.cancelPreview();
    expect(w.last().surfaces![0].box!.max[1]).toBeCloseTo(before.box!.max[1], 6);
  }, 60000);

  it('a document without surface features asks for no extra regen and has no surfaces', async () => {
    const doc = sample();
    const solidOnly = { ...doc, features: doc.features.slice(0, 2) } as PartDoc;
    const w = await world(solidOnly);
    expect(w.last().surfaces).toBeUndefined();
    expect(w.controller.surfaceBodies()).toEqual([]);
  }, 60000);
});
