// Opening a part on its stored view: the snapshot is on screen at once, the kernel builds the real state behind it, and no change is
// lost or applied to the stored view. Needs CK_WASM.
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Session, type EditOp } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import { decodeSnapshot, encodeSnapshot, type ViewData } from './files/viewCache';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
const sample = (name: string): PartDoc => JSON.parse(readFileSync(`${process.cwd()}/apps/cad/public/samples/${name}.ckpart`, 'utf8')) as PartDoc;

/** A kernel whose `open` waits until `release()` (so the cached view can be inspected while the build is pending). */
function gated(hold: boolean) {
  let release!: () => void;
  const gate = hold ? new Promise<void>((r) => { release = r; }) : Promise.resolve();
  let opens = 0, fail = false;
  const kernel: KernelFactory = { async open(d) { opens++; await gate; if (fail) throw new Error('kernel gone'); const s = await Session.open(d); sessions.push(s); return s; } };
  return { kernel, release: () => release?.(), opens: () => opens, failNext: () => { fail = true; } };
}
const sink = () => { const bodies: unknown[] = []; const view: ViewSink = { setBody: (b) => { bodies.push(b); }, setHighlight() {}, setSketchEdit() {}, setThreads() {} }; return { view, bodies }; };

/** Build `doc` normally and take the view a save would keep, through the real codec. */
async function stored(doc: PartDoc): Promise<ViewData> {
  const g = gated(false); const s = sink();
  const c = new Controller({ store: createStore(), view: s.view, kernel: g.kernel });
  await c.load(doc);
  const data = c.viewData();
  expect(data).not.toBeNull();
  const back = await decodeSnapshot(await encodeSnapshot({ key: 'k', build: 'b', savedAt: 1, data: data! }));
  expect(back).not.toBeNull();
  return back!.data;
}

const addBox = (id: string): EditOp[] => [
  { op: 'add', feature: { type: 'sketch', name: 'S2', id, plane: { kind: 'std', id: 'top' },
    points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 4, y: 0 }, { id: 'p3', x: 4, y: 4 }, { id: 'p4', x: 0, y: 4 }],
    entities: [{ id: 'e5', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e6', type: 'line', p1: 'p2', p2: 'p3' }, { id: 'e7', type: 'line', p1: 'p3', p2: 'p4' }, { id: 'e8', type: 'line', p1: 'p4', p2: 'p1' }], constraints: [] } as never },
];

describe('cached open', { skip: !process.env.CK_WASM }, () => {
  it('shows the stored view before the kernel has opened the part, then the real one', async () => {
    const doc = sample('bench-clevis');
    const data = await stored(doc);
    const g = gated(true); const s = sink(); const store = createStore();
    const c = new Controller({ store, view: s.view, kernel: g.kernel });
    await c.load(doc, { cached: data });                        // returns while the kernel is still held back
    expect(c.isCached()).toBe(true); expect(store.cached.value).toBe(true);
    expect(g.opens()).toBe(1);
    expect(s.bodies).toHaveLength(1);
    expect((s.bodies[0] as { mesh: { positions: Float32Array } }).mesh.positions.length).toBeGreaterThan(0);
    expect(c.hasSolid()).toBe(true); expect(c.bodyFaces()).not.toBeNull();
    expect(store.featureStatus.value).toEqual(data.status);
    expect(c.document()!.features.map((f) => f.id)).toEqual(doc.features.map((f) => f.id));
    expect(c.features().length).toBe(doc.features.length);
    g.release(); await c.settled();
    expect(c.isCached()).toBe(false); expect(s.bodies.length).toBeGreaterThan(1);
    // the real mesh equals the stored one: the stored view was the same regen
    const real = c.bodyFaces()!;
    expect(Array.from(real.positions)).toEqual(Array.from((data.body as { mesh: { positions: Float32Array } }).mesh.positions));
  }, 120_000);

  it('an edit made on the cached view waits for the build and is applied to the real state', async () => {
    const doc = sample('bench-clevis');
    const data = await stored(doc);
    const g = gated(true); const s = sink();
    const c = new Controller({ store: createStore(), view: s.view, kernel: g.kernel });
    await c.load(doc, { cached: data });
    let done = false;
    const p = c.edit(addBox('F900'), 'test').then((r) => { done = true; return r; });
    await new Promise((r) => setTimeout(r, 50));
    expect(done).toBe(false);                                   // still waiting: not applied to the stored view, not dropped
    g.release();
    const r = await p;
    expect(r.ok).toBe(true);
    expect(c.isCached()).toBe(false);
    expect(c.document()!.features.some((f) => f.id === 'F900')).toBe(true);
    expect(c.history()).toHaveLength(1);
    expect(await c.massProps()).not.toBeNull();                 // inspect works on the real state
  }, 120_000);

  it('queries and a rebuild issued on the cached view wait too; material and name set meanwhile survive', async () => {
    const doc = sample('bench-clevis');
    const data = await stored(doc);
    const g = gated(true); const s = sink();
    const c = new Controller({ store: createStore(), view: s.view, kernel: g.kernel });
    await c.load(doc, { cached: data });
    expect(c.setMaterial('Mild steel')).toBe(true); c.setPartName('Renamed');
    const mass = c.massProps(); const rb = c.rebuild();
    g.release();
    expect(await mass).not.toBeNull(); await rb;
    expect(c.document()!.material).toBe('Mild steel'); expect(c.document()!.name).toBe('Renamed');
  }, 120_000);

  it('a snapshot that does not fit the recipe (a status for a feature it lacks) is ignored: the part is built normally', async () => {
    const doc = sample('bench-clevis');
    const data = await stored(doc);
    const bad: ViewData = { ...data, status: [...data.status, { id: 'F_gone', ok: true }] };
    const g = gated(false); const s = sink(); const store = createStore();
    const c = new Controller({ store, view: s.view, kernel: g.kernel });
    await c.load(doc, { cached: bad });
    expect(c.isCached()).toBe(false); expect(store.cached.value).toBe(false);
    expect(store.featureStatus.value.map((x) => x.id)).toEqual(doc.features.map((f) => f.id));
  }, 120_000);

  it('a build that fails leaves the cached view, says so, and lets nothing be applied to it', async () => {
    const doc = sample('bench-clevis');
    const data = await stored(doc);
    const g = gated(true); g.failNext(); const s = sink(); const store = createStore();
    const c = new Controller({ store, view: s.view, kernel: g.kernel });
    await c.load(doc, { cached: data });
    const p = c.edit(addBox('F901'), 'test').then(() => 'ok', (e: Error) => e.message);
    g.release();
    await c.settled();
    expect(store.cached.value).toBe(false);
    expect(store.notices.value.some((n) => n.level === 'error')).toBe(true);
    expect(await p).toBe('no document loaded');                 // refused, not applied to the stored view
  }, 120_000);

  it('opening another part while the first is still building waits for it', async () => {
    const a = sample('bench-clevis'), b = sample('bench-hex_nut');
    const data = await stored(a);
    const g = gated(true); const s = sink();
    const c = new Controller({ store: createStore(), view: s.view, kernel: g.kernel });
    await c.load(a, { cached: data });
    const second = c.load(b);
    await new Promise((r) => setTimeout(r, 50));
    expect(g.opens()).toBe(1);
    g.release(); await second;
    expect(c.document()!.name).toBe(b.name);
    expect(c.isCached()).toBe(false);
  }, 120_000);

  it('a view is not offered for a state that is not the built document (rolled back)', async () => {
    const g = gated(false); const s = sink();
    const c = new Controller({ store: createStore(), view: s.view, kernel: g.kernel });
    await c.load(sample('bench-clevis'));
    expect(c.viewData()).not.toBeNull();
    await c.setRollback(1);
    expect(c.viewData()).toBeNull();
    await c.setRollback(null);
    expect(c.viewData()).not.toBeNull();
  }, 120_000);

  // CACHE_MEASURE=1 CK_WASM=... npx vitest run apps/cad/src/controller.cached.kernel.test.ts -t measure
  it.skipIf(!process.env.CACHE_MEASURE)('measure: open time with and without the stored view', async () => {
    for (const name of ['bench-fan_shroud', 'heavy/matx-case']) {
      const doc = sample(name);
      const ms = (t0: number) => Math.round(performance.now() - t0);
      let g = gated(false); let s = sink();
      let c = new Controller({ store: createStore(), view: s.view, kernel: g.kernel });
      let t0 = performance.now();
      await c.load(doc);
      const cold = ms(t0);
      const data = c.viewData()!;
      const tri = (data.body as { mesh: { triFace: ArrayLike<number> } }).mesh.triFace.length;
      t0 = performance.now(); const bytes = await encodeSnapshot({ key: 'k', build: 'b', savedAt: 1, data }); const enc = ms(t0);
      const { recipeKey } = await import('./files/viewCache');
      t0 = performance.now(); const key = await recipeKey(doc); const hashMs = ms(t0);
      t0 = performance.now(); const back = await decodeSnapshot(bytes); const dec = ms(t0);
      g = gated(true); s = sink();
      c = new Controller({ store: createStore(), view: s.view, kernel: g.kernel });
      t0 = performance.now();
      await c.load(doc, { cached: back!.data });
      const show = ms(t0);
      g.release(); await c.settled();
      const rawMesh = (data.body as { mesh: { positions: Float32Array; normals: Float32Array } }).mesh;
      console.log(`measure ${name}: ${doc.features.length} features, ${tri} triangles; cold load ${cold} ms (native node wasm, kernel already warm); stored view ${Math.round(bytes.length / 1024)} KB `
        + `(raw mesh ${Math.round((rawMesh.positions.byteLength + rawMesh.normals.byteLength) / 1024)} KB); encode ${enc} ms; recipe hash ${hashMs} ms (${key.slice(0, 8)}); decode ${dec} ms; cached view on screen after ${show} ms`);
    }
  }, 900_000);
});
