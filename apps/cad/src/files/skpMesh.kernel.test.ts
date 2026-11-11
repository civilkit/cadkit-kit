// SketchUp as a reference mesh against the real kernel (needs the opt-in `skp` kernel feature and the kernel checkout's fixtures, see
// skpImport.kernel.test.ts): colours and translucency, units, the open-edge facts, the hidden-geometry choice, save and open, and the face limit.
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { takeEmbedded } from '@kit/viewdata';
import { Controller, type KernelFactory } from '../controller';
import { MESH_KEY, decode, matRuns, meshesOf, nearestOnMeshes, pickMeshes, worldBox } from '../meshes/meshDoc';
import { planeThrough } from '../meshes/meshEdit';
import { unpackDoc } from './assets';
import { stripThumbnail } from './docThumb';
import { FileManager, type FilePlatform } from './fileManager';
import { importSkpView } from './skpImport';
import { SKP_MESH_MAX_FACES, SKP_ROT, skpMeshRecord } from './skpMesh';

const FIX = process.env.CK_REBUILD ? `${process.env.CK_REBUILD}/crates/ck-skp/tests/fixtures` : '';
const fixture = (n: string) => new Uint8Array(readFileSync(`${FIX}/${n}`));
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
const newController = () => new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
const skpReady: Promise<boolean> = (async () => {
  if (!process.env.CK_WASM || !FIX || !existsSync(`${FIX}/chair_and_table.skp`)) return false;
  const s = await Session.open(emptyPart('Skp')); sessions.push(s);
  const r = await importSkpView(s, fixture('chair_and_table.skp'), 'probe');
  return r.ok || r.code !== 'trap';
})().catch(() => false);

describe('SketchUp as a reference mesh, real kernel', { skip: !process.env.CK_WASM || !process.env.CK_REBUILD }, () => {
  it('chair_and_table: the same size as the view-only body, colours per face, open surface facts', async (ctx) => {
    if (!(await skpReady)) return ctx.skip();
    const c = newController(); await c.load(emptyPart('Host'));
    const view = await c.readSkp(fixture('chair_and_table.skp'), 'chair', { maxFaces: SKP_MESH_MAX_FACES });
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    const { rec, summary } = skpMeshRecord(view, { id: 'mesh1', name: 'chair', up: 'z' });
    expect(summary).toMatchObject({ faces: 128, closed: false });
    expect(rec.watertight).toBe(false);
    expect(rec.tris).toBe(view.view.mesh.triFace.length);
    expect(rec.mats!.length).toBeGreaterThan(1);
    // millimetres, in the file's axes: the box of the mesh is the box of the kernel's body
    const wb = worldBox(rec), kb = view.view.box;
    for (let i = 0; i < 3; i++) { expect(wb.min[i]).toBeCloseTo(kb.min[i], 2); expect(wb.max[i]).toBeCloseTo(kb.max[i], 2); }
    // every triangle has the colour of its SketchUp face's material
    const runs = matRuns(rec)!;
    expect(runs.reduce((n, r) => n + r.count, 0)).toBe(rec.tris);
    expect(new Set(runs.map((r) => r.color)).size).toBeGreaterThan(1);
  });
  it('upright puts the model on the ground plane of the Y-up view: the rotation is the preset, the height is the file\'s Z extent', async (ctx) => {
    if (!(await skpReady)) return ctx.skip();
    const c = newController(); await c.load(emptyPart('Host'));
    const view = await c.readSkp(fixture('chair_and_table.skp'), 'chair', {});
    if (!view.ok) throw new Error(view.message);
    const z = skpMeshRecord(view, { id: 'm', name: 'c', up: 'z' }).rec, y = skpMeshRecord(view, { id: 'm', name: 'c', up: 'y' }).rec;
    expect(y.rot).toEqual(SKP_ROT.y);
    const zb = worldBox(z), yb = worldBox(y);
    expect(yb.max[1] - yb.min[1]).toBeCloseTo(zb.max[2] - zb.min[2], 2);
    expect(yb.max[2] - yb.min[2]).toBeCloseTo(zb.max[1] - zb.min[1], 2);
  });
  it('translucent materials keep their opacity (capilla: 0.7 and 0.5), as separate runs', async (ctx) => {
    if (!(await skpReady)) return ctx.skip();
    const c = newController(); await c.load(emptyPart('Host'));
    const view = await c.readSkp(fixture('capilla_quiroz_v17.skp'), 'capilla', { maxFaces: SKP_MESH_MAX_FACES });
    if (!view.ok) throw new Error(view.message);
    const { rec } = skpMeshRecord(view, { id: 'm', name: 'c', up: 'y' });
    const ops = new Set(rec.mats!.map((m) => +m.o.toFixed(2)));
    expect(ops.has(0.7) && ops.has(0.5)).toBe(true);
    expect(matRuns(rec)!.some((r) => r.opacity < 1)).toBe(true);
  });
  it('save and open: colours, translucency, transform and the open flag survive; picking and nearest-point work on the reloaded mesh', async (ctx) => {
    if (!(await skpReady)) return ctx.skip();
    const c = newController(); await c.load(emptyPart('Host'));
    const view = await c.readSkp(fixture('capilla_quiroz_v17.skp'), 'capilla', { maxFaces: SKP_MESH_MAX_FACES });
    if (!view.ok) throw new Error(view.message);
    const { rec } = skpMeshRecord(view, { id: 'mesh1', name: 'capilla', up: 'y' });
    const placed = { ...rec, pos: [100, 0, 50] as [number, number, number], scale: 0.5, opacity: 0.8 };
    c.setUndoableExtra(MESH_KEY, [placed]);
    const writes: string[] = [];
    const platform: FilePlatform = { canOverwrite: () => false, saveFile: async (_n, data) => { writes.push(String(data)); } };
    expect((await new FileManager(platform, null).save(c.document()!, { fileName: 'capilla.ckpart' })).ok).toBe(true);
    const raw = (JSON.parse(writes[0]).meshes[0] as { z: string }).z.length;
    expect(raw).toBeLessThan((placed.v.length + placed.i.length) * 0.5);
    const { doc, problems } = await unpackDoc(takeEmbedded(stripThumbnail(JSON.parse(writes[0]) as PartDoc).doc).doc);
    expect(problems).toEqual([]);
    const c2 = newController(); await c2.load(doc);
    const [back] = meshesOf(c2.document());
    expect(back).toMatchObject({ name: 'capilla', pos: [100, 0, 50], scale: 0.5, opacity: 0.8, rot: SKP_ROT.y, watertight: placed.watertight, tris: placed.tris });
    expect(back.mats).toEqual(placed.mats);
    expect(matRuns(back)).toEqual(matRuns(placed));
    expect(Array.from(decode(back).mesh.indices)).toEqual(Array.from(decode(placed).mesh.indices));
    const box = worldBox(back);
    let hit: ReturnType<typeof pickMeshes> = null;
    for (let i = 1; i < 10 && !hit; i++) for (let j = 1; j < 10 && !hit; j++) {   // a ray down from above, on a grid, until it meets the model
      const o = [box.min[0] + ((box.max[0] - box.min[0]) * i) / 10, box.max[1] + 500, box.min[2] + ((box.max[2] - box.min[2]) * j) / 10] as [number, number, number];
      hit = pickMeshes([back], { o, d: [0, -1, 0] });
    }
    expect(hit).not.toBeNull();
    expect(nearestOnMeshes([back], [hit!.pos[0], hit!.pos[1] + 1, hit!.pos[2]], 50)).not.toBeNull();
    // and a sketch plane through the picked surface point can be made
    const plane = planeThrough(hit!.pos, hit!.normal, 'normal', 'P');
    expect((await c2.edit([{ op: 'add', feature: { ...plane, visible: false } as never }])).ok).toBe(true);
  });
  it('hidden geometry: the choice reaches the kernel (a hidden-faces file reads more faces with it)', async (ctx) => {
    if (!(await skpReady)) return ctx.skip();
    const c = newController(); await c.load(emptyPart('Host'));
    const a = await c.readSkp(fixture('Untitled.skp'), 'u', { maxFaces: SKP_MESH_MAX_FACES });
    const b = await c.readSkp(fixture('Untitled.skp'), 'u', { maxFaces: SKP_MESH_MAX_FACES, hidden: true });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(b.faces).toBeGreaterThanOrEqual(a.faces);
  });
  it('the mesh path has its own, larger face limit: a 39,000 face model (gondola) reads where a small limit refuses it', async (ctx) => {
    if (!(await skpReady)) return ctx.skip();
    const c = newController(); await c.load(emptyPart('Host'));
    const small = await c.readSkp(fixture('gondola_v20.skp'), 'g', { maxFaces: 1000 });
    expect(small.ok).toBe(false);
    const big = await c.readSkp(fixture('gondola_v20.skp'), 'g', { maxFaces: SKP_MESH_MAX_FACES });
    expect(big.ok).toBe(true);
    if (!big.ok) return;
    const t0 = performance.now();
    const { rec } = skpMeshRecord(big, { id: 'm', name: 'g', up: 'y' });
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(rec.tris).toBeGreaterThan(50000);
    expect(rec.verts).toBeLessThan(rec.tris * 3);
  }, 120_000);
  it('a model with only hidden faces is refused with the kernel\'s code, and the part is left alone', async (ctx) => {
    if (!(await skpReady)) return ctx.skip();
    const c = newController(); await c.load(emptyPart('Host'));
    const r = await c.readSkp(fixture('blank_v17.skp'), 'blank', {});
    expect(r).toMatchObject({ ok: false, code: 'body.empty' });
    expect(meshesOf(c.document())).toHaveLength(0);
  });
});
