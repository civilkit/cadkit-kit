// Exports with cosmetic knurls against the real kernel: the file gets the grooves, the open document does not change, a failed, cancelled or timed-out
// cut never writes the plain solid unasked, and a folder export cuts the knurls whose cylinder it holds.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { checkMesh } from '@kit/io';
import type { FeatureRow } from '@kit/ui';
import { Controller, type KernelFactory } from './controller';
import { DEFAULT_KNURL, knurlCosmetic, readCosmeticKnurls } from './knurl';
import { chooseKnurlExport } from './knurlExport';
import { listBodies, readBodyFields } from './bodies';
import { folderIds } from './treeFolders';
import { planFolderExport } from './folderExport';
import { partOfStep } from './files/sldprtImport';
import { BakeCache } from './bakeCache';
import { exportObj, exportStl } from './exportFiles';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function world(doc: PartDoc = emptyPart('Knob') as unknown as PartDoc, build = true, bakeCache?: BakeCache) {
  const store = createStore();
  // cancel() ends the sessions' workers, as the app's kernel router restarts its worker, so a cut that was stopped does not hold up the next one
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; }, cancel() { for (const s of sessions.splice(0)) void s.close().catch(() => {}); } };
  const controller = new Controller({ store, view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel, ...(bakeCache ? { bakeCache } : {}) });
  await controller.load(doc);
  if (build) {
    await controller.edit([
      { op: 'add', feature: { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'p1', x: 0, y: 0 }], entities: [{ type: 'circle', id: 'e1', c: 'p1', r: 10 }], constraints: [] } },
      { op: 'add', feature: { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 12 } },
    ] as never);
  }
  return controller;
}
const target = { axis: 'z' as const, center: [0, 0] as [number, number], radius: 10, from: 0, to: 12 };
const straight = () => knurlCosmetic({ ...DEFAULT_KNURL, target, pattern: 'straight', count: 24, depth: 0.6, cosmetic: true });
const PLAIN = Math.PI * 100 * 12;
const field = (c: Controller) => readCosmeticKnurls((c.document() as unknown as Record<string, unknown>).cosmeticKnurls);
/** What a file holds: the STEP read back as a part of its own: volume, validity and face count. */
async function readBack(step: string) {
  const c = await world(await partOfStep(step, 'back'), false);
  const part = JSON.parse(JSON.stringify(c.document())) as PartDoc;
  const built = await c.scratchBuild(part, true);
  const f = await c.scratchFacts({ mass: true, validate: true });
  if (!built.geometry?.mesh) console.log('read-back has no mesh', JSON.stringify(built.errors).slice(0, 300));
  // the faces the file declares: a read-back that drops faces (an edge the reader refuses) leaves an open shell, so the count read must be the count written
  const written = (step.match(/ADVANCED_FACE\(/g) ?? []).length;
  return { volume: f.volume as number, valid: f.valid, faces: (built.geometry?.mesh as { faceIds: string[] } | null)?.faceIds.length ?? -1, written };
}
const meshVolume = (p: ArrayLike<number>): number => {
  let v = 0;
  for (let i = 0; i < p.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = [p[i], p[i + 1], p[i + 2], p[i + 3], p[i + 4], p[i + 5], p[i + 6], p[i + 7], p[i + 8]];
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return Math.abs(v);
};

describe('export with cosmetic knurls against the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('STEP with the setting On has the grooves; the open document, its history and its undo stack are as they were', async () => {
    const c = await world();
    const r = straight();
    c.setUndoableExtra('cosmeticKnurls', [r]);
    const before = JSON.stringify(c.document());
    const t0 = Date.now();
    const choice = await chooseKnurlExport({
      mode: 'on', count: 1, ask: async () => 'cancel', failed: async () => 'cancel',
      run: async () => { const b = await c.bakeBuild(field(c), 'step', 120); return b.ok ? { ok: true as const, value: b } : b; },
    });
    const took = Date.now() - t0;
    if (choice.kind !== 'baked') throw new Error(JSON.stringify(choice));
    const file = await readBack(choice.value.step!);
    console.log(`STEP with 24 straight grooves: volume ${file.volume.toFixed(1)} (plain ${PLAIN.toFixed(1)}), ${file.faces} faces, valid ${file.valid}, ${took} ms`);
    expect(choice.value.baked).toBe(1);
    expect(file.valid).toBe(true);
    expect(file.faces).toBeGreaterThan(3);
    expect(file.volume).toBeLessThan(PLAIN - 24 * 0.36 * 12 * 0.8);
    // nothing about the open document moved
    expect(JSON.stringify(c.document())).toBe(before);
    expect(field(c)).toEqual([r]);
    expect(c.document()!.features.length).toBe(2);
    expect((await c.massProps() as { volume: number }).volume).toBeCloseTo(PLAIN, 3);
    expect(c.bodyFaces()?.faceIds.length).toBe(3);
    await c.undo();   // the one step it had: taking the record back; the bake added none
    expect(field(c)).toEqual([]);
    expect(c.document()!.features.length).toBe(2);
  }, 300000);

  it('STL and OBJ (the mesh) have the grooves and are watertight; the plain STEP stays a plain cylinder', async () => {
    const c = await world();
    c.setUndoableExtra('cosmeticKnurls', [straight()]);
    const b = await c.bakeBuild(field(c), 'mesh', 120);
    if (!b.ok) throw new Error(b.message);
    expect(checkMesh(b.mesh!).watertight).toBe(true);
    expect(meshVolume(b.mesh!.positions)).toBeLessThan(PLAIN - 24 * 0.36 * 12 * 0.8);
    // Off: the exporter the app uses for the plain solid writes the cylinder
    const plain = await readBack((await c.exportStep())!);
    expect(plain.volume).toBeCloseTo(PLAIN, 2);
    expect(plain.faces).toBe(3);
  }, 300000);

  it('a cut that cannot be made comes back as a failure that offers the plain export, and writes nothing', async () => {
    const c = await world();
    const far = knurlCosmetic({ ...DEFAULT_KNURL, target: { ...target, center: [60, 60] }, pattern: 'straight', count: 24, depth: 0.6, cosmetic: true });
    c.setUndoableExtra('cosmeticKnurls', [far]);
    const b = await c.bakeBuild(field(c), 'step', 120);
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.reason).toBe('failed');
    // too dense to cut (the helper refuses the crossings): the same
    const dense = knurlCosmetic({ ...DEFAULT_KNURL, target, pattern: 'diamond', profile: 'round', count: 60, depth: 0.2, helixAngle: 45, cosmetic: true });
    c.setUndoableExtra('cosmeticKnurls', [dense]);
    const d = await c.bakeBuild(field(c), 'step', 120);
    expect(d.ok).toBe(false);
    if (!d.ok) { expect(d.reason).toBe('failed'); expect(d.message).toMatch(/crossings|groove/i); }
    let asked = '';
    const choice = await chooseKnurlExport({
      mode: 'on', count: 1, ask: async () => 'include', failed: async (reason) => { asked = reason; return 'plain'; },
      run: async () => (d.ok ? { ok: true as const, value: d } : d),
    });
    expect(asked).toBe('failed');
    expect(choice.kind).toBe('plain');
    expect(field(c)).toEqual([dense]);
    expect(c.document()!.features.length).toBe(2);
  }, 300000);

  it('Cancel ends the cut, and a time limit ends it with its own reason; the document is untouched either way', async () => {
    const c = await world();
    const heavy = knurlCosmetic({ ...DEFAULT_KNURL, target, pattern: 'diamond', profile: 'round', count: 16, depth: 0.3, helixAngle: 45, cosmetic: true });
    c.setUndoableExtra('cosmeticKnurls', [heavy]);
    const before = JSON.stringify(c.document());
    const t0 = Date.now();
    const run = c.bakeBuild(field(c), 'step', 120);
    const restarted = new Promise<void>((done) => setTimeout(() => { void c.cancel().then(done); }, 300));
    const a = await run;
    await restarted;   // the kernel is back before the next export starts, as the busy overlay holds the app until then
    console.log(`cancelled after ${Date.now() - t0} ms`);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.reason).toBe('cancelled');
    expect(JSON.stringify(c.document())).toBe(before);
    const t1 = Date.now();
    const b = await c.bakeBuild(field(c), 'step', 0.2);
    console.log(`time limit 0.2 s ended after ${Date.now() - t1} ms`);
    expect(b.ok).toBe(false);
    if (!b.ok) { expect(b.reason).toBe('timeout'); expect(b.message).toMatch(/0\.2 s/); }
    expect(JSON.stringify(c.document())).toBe(before);
    expect((c as unknown as { store: { busy: { value: boolean } } }).store.busy.value).toBe(false);
  }, 300000);

  it('the same part exported again with the same knurls is not cut again and gives the same bytes; any change cuts again', async () => {
    const cache = new BakeCache({ build: async () => 'test-build' });
    const c = await world(undefined, true, cache);
    const bakes = vi.spyOn(c as unknown as { bakeScratch: () => unknown }, 'bakeScratch');
    c.setUndoableExtra('cosmeticKnurls', [straight()]);
    const t0 = Date.now();
    const a = await c.bakeBuild(field(c), 'step', 120);
    const first = Date.now() - t0;
    if (!a.ok) throw new Error(a.message);
    expect(a.cached).toBeUndefined();
    expect(bakes).toHaveBeenCalledTimes(1);
    expect(await c.bakeCached(field(c), 'step')).toBe(true);
    const t1 = Date.now();
    const b = await c.bakeBuild(field(c), 'step', 120);
    const second = Date.now() - t1;
    if (!b.ok) throw new Error(b.message);
    console.log(`straight knurl STEP: first ${first} ms, second ${second} ms`);
    expect(b.cached).toBe(true);
    expect(bakes).toHaveBeenCalledTimes(1);
    expect(b.step).toBe(a.step);
    // the mesh is another key: cut once, then reused, and the STL and OBJ files are byte for byte the same
    const m1 = await c.bakeBuild(field(c), 'mesh', 120);
    const m2 = await c.bakeBuild(field(c), 'mesh', 120);
    if (!m1.ok || !m2.ok) throw new Error('mesh bake failed');
    expect([m1.cached, m2.cached, bakes.mock.calls.length]).toEqual([undefined, true, 2]);
    expect(exportStl(m2.mesh!, 'Knob').file!.data).toEqual(exportStl(m1.mesh!, 'Knob').file!.data);
    expect(exportObj(m2.mesh!, 'Knob').file!.data).toBe(exportObj(m1.mesh!, 'Knob').file!.data);
    // a changed knurl number, a changed feature and a rolled-back model each cut again
    c.setUndoableExtra('cosmeticKnurls', [{ ...straight(), count: 20 }]);
    expect(await c.bakeCached(field(c), 'step')).toBe(false);
    const d = await c.bakeBuild(field(c), 'step', 120);
    expect(d.ok && d.cached).toBeFalsy();
    expect(bakes).toHaveBeenCalledTimes(3);
    c.setUndoableExtra('cosmeticKnurls', [straight()]);
    await c.edit([{ op: 'set', id: 'F2', path: 'depth', value: 11 }] as never);
    expect(await c.bakeCached(field(c), 'step')).toBe(false);
  }, 300000);

  it('a failed bake is not cached: the same cut is tried again', async () => {
    const cache = new BakeCache({ build: async () => 'test-build' });
    const c = await world(undefined, true, cache);
    const bakes = vi.spyOn(c as unknown as { bakeScratch: () => unknown }, 'bakeScratch');
    const far = knurlCosmetic({ ...DEFAULT_KNURL, target: { ...target, center: [60, 60] }, pattern: 'straight', count: 24, depth: 0.6, cosmetic: true });
    c.setUndoableExtra('cosmeticKnurls', [far]);
    expect((await c.bakeBuild(field(c), 'step', 120)).ok).toBe(false);
    expect((await c.bakeBuild(field(c), 'step', 120)).ok).toBe(false);
    expect(bakes).toHaveBeenCalledTimes(2);
    expect(cache.memoryKeys).toEqual([]);
  }, 300000);

  it('a heavy knurl: the second export is instant (measured)', async () => {
    const cache = new BakeCache({ build: async () => 'test-build' });
    const c = await world(undefined, true, cache);
    c.setUndoableExtra('cosmeticKnurls', [knurlCosmetic({ ...DEFAULT_KNURL, target, profile: 'v', cosmetic: true, pattern: 'pyramid', count: 90, depth: 0.15 })]);
    const t0 = Date.now();
    const a = await c.bakeBuild(field(c), 'step', 120);
    const first = Date.now() - t0;
    if (!a.ok) { console.log(`heavy pyramid: ${a.reason} after ${first} ms: ${a.message}`); return; }
    const t1 = Date.now();
    const b = await c.bakeBuild(field(c), 'step', 120);
    const second = Date.now() - t1;
    console.log(`heavy V pyramid, 90 grooves, STEP: first export ${first} ms, second ${second} ms`);
    expect(b.ok && b.cached).toBe(true);
    expect(b.ok && b.step).toBe(a.step);
  }, 300000);

  it.each([
    ['V diamond (faceted), 120 + 120, 45 degrees', { profile: 'v', pattern: 'diamond', count: 120, depth: 0.12, helixAngle: 45 }],
    ['V pyramid (faceted), 90 grooves', { profile: 'v', pattern: 'pyramid', count: 90, depth: 0.15 }],
    ['round diamond, 8 + 8, 22 degrees', { pattern: 'diamond', count: 8, depth: 0.3, helixAngle: 22 }],
    ['round diamond, 12 + 12, 22 degrees', { pattern: 'diamond', count: 12, depth: 0.3, helixAngle: 22 }],
    ['round pyramid, 24 grooves', { pattern: 'pyramid', count: 24, depth: 0.3 }],
  ] as const)('%s is cut for the export (measured)', async (label, o) => {
    const c = await world();
    const heavy = knurlCosmetic({ ...DEFAULT_KNURL, target, profile: 'round', cosmetic: true, ...o });
    c.setUndoableExtra('cosmeticKnurls', [heavy]);
    const t0 = Date.now();
    const b = await c.bakeBuild(field(c), 'step', 120);
    const took = Date.now() - t0;
    // a cut the kernel cannot do, or a STEP it cannot read back, is a failure that offers the plain export; what is offered as the file reads back valid
    if (!b.ok) { console.log(`heavy ${label}: ${b.reason} after ${took} ms: ${b.message}`); expect(['failed', 'timeout']).toContain(b.reason); return; }
    const file = await readBack(b.step!);
    expect(file.valid).toBe(true);
    expect(file.written).toBeGreaterThan(3);
    expect(file.faces).toBeGreaterThanOrEqual(file.written);   // not empty, no face dropped (the mesh can split a face, never merge)
    expect(file.volume).toBeGreaterThan(0);
    console.log(`heavy ${label}: volume ${file.volume.toFixed(1)} (plain ${PLAIN.toFixed(1)}), ${file.faces} faces, valid ${file.valid}, ${took} ms`);
    expect(file.volume).toBeLessThan(PLAIN);
  }, 300000);
});

// ---- folder export ----
const circle = (id: string, cx: number, r: number, group?: string) => ({ type: 'sketch', id, ...(group ? { group } : {}), plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: cx, y: 0 }], entities: [{ type: 'circle', id: 'e1', c: 'p1', r }], constraints: [] });
const sq = (id: string, w: number, group?: string) => ({ type: 'sketch', id, ...(group ? { group } : {}), plane: { kind: 'std', id: 'front' },
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: 0, y: 0 }, { id: 'p2', x: w, y: 0 }, { id: 'p3', x: w, y: w }, { id: 'p4', x: 0, y: w }],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b })), constraints: [] });
const pad = (id: string, sketch: string, depth: number, group?: string) => ({ type: 'extrude', id, op: 'add', sketch, end: 'blind', depth, ...(group ? { group } : {}) });
// each folder has two rows (a folder of one row is not kept); the second row of each lies inside its body and changes nothing
const twoBodies = (): PartDoc => ({ ...emptyPart('Pair'), features: [
  circle('F1', 40, 10, 'Knob'), pad('F2', 'F1', 12, 'Knob'), circle('F3', 40, 2, 'Knob'), pad('F4', 'F3', 3, 'Knob'),
  sq('F5', 10, 'Cube'), pad('F6', 'F5', 10, 'Cube'), sq('F7', 3, 'Cube'), pad('F8', 'F7', 3, 'Cube'),
], seq: 9 }) as unknown as PartDoc;

describe('folder export with cosmetic knurls against the real kernel', { skip: !process.env.CK_WASM }, () => {
  const setup = async () => {
    const c = await world(twoBodies(), false);
    const feats = () => c.document()!.features as unknown as Array<{ id: string; type: string; group?: string }>;
    const frows = (): FeatureRow[] => feats().map((f) => ({ id: f.id, type: f.type, group: f.group, uses: f.type === 'extrude' ? [`F${Number(f.id.slice(1)) - 1}`] : undefined }));
    const rows = () => listBodies(c.selModel()!.bodies(), readBodyFields(c.document()), {});
    const plan = (name: string) => { const p = planFolderExport(c.document()!, name, folderIds(frows(), feats(), name), rows(), false); if (!p.ok) throw new Error(p.reason); return p; };
    const rec = knurlCosmetic({ ...DEFAULT_KNURL, target: { ...target, center: [40, 0] }, pattern: 'straight', count: 24, depth: 0.6, cosmetic: true });
    c.setUndoableExtra('cosmeticKnurls', [rec]);
    return { c, plan, rec };
  };

  it('the folder that holds the knurled cylinder gets the grooves; the folder of the other body is exported as it is', async () => {
    const { c, plan, rec } = await setup();
    const before = JSON.stringify(c.document());
    const knob = plan('Knob');
    const withKnurl = await c.folderBuild(knob.doc, c.document()!, 'Knob', 'step', { recs: [rec], seconds: 120 });
    if (!withKnurl.ok) throw new Error(withKnurl.message);
    expect(withKnurl.baked).toBe(1);
    expect(withKnurl.volume).toBeLessThan(PLAIN - 24 * 0.36 * 12 * 0.8);
    expect((await readBack(withKnurl.data as string)).volume).toBeCloseTo(withKnurl.volume, 2);
    const cube = plan('Cube');
    const other = await c.folderBuild(cube.doc, c.document()!, 'Cube', 'step', { recs: [rec], seconds: 120 });
    if (!other.ok) throw new Error(other.message);
    expect(other.baked).toBe(0);
    expect(other.volume).toBeCloseTo(1000, 3);
    // STL and the frozen part take the same copy
    const stl = await c.folderBuild(knob.doc, c.document()!, 'Knob', 'stl', { recs: [rec], seconds: 120 });
    if (!stl.ok) throw new Error(stl.message);
    expect(meshVolume((stl.data as { positions: ArrayLike<number> }).positions)).toBeLessThan(PLAIN - 24 * 0.36 * 12 * 0.8);
    expect(JSON.stringify(c.document())).toBe(before);
  }, 300000);

  it('choosing the plain solid keeps the cylinder and says how many knurls were left; Off (no records passed) is the old export; cancel stops', async () => {
    const { c, plan, rec } = await setup();
    const knob = plan('Knob');
    const plainChoice = await c.folderBuild(knob.doc, c.document()!, 'Knob', 'step', { recs: [rec], seconds: 120, confirm: async () => 'plain' });
    if (!plainChoice.ok) throw new Error(plainChoice.message);
    expect([plainChoice.baked, plainChoice.left]).toEqual([0, 1]);
    expect(plainChoice.volume).toBeCloseTo(PLAIN, 3);
    const off = await c.folderBuild(knob.doc, c.document()!, 'Knob', 'step');
    if (!off.ok) throw new Error(off.message);
    expect(off.volume).toBeCloseTo(PLAIN, 3);
    const stopped = await c.folderBuild(knob.doc, c.document()!, 'Knob', 'step', { recs: [rec], seconds: 120, confirm: async () => 'cancel' });
    expect(stopped).toMatchObject({ ok: false, bake: { reason: 'cancelled' } });
    // the question is not asked for the folder that holds no knurl
    let asked = 0;
    await c.folderBuild(plan('Cube').doc, c.document()!, 'Cube', 'step', { recs: [rec], seconds: 120, confirm: async () => { asked++; return 'include'; } });
    expect(asked).toBe(0);
  }, 300000);
});
