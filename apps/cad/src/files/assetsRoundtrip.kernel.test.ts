// Save and open with the real kernel and the app's own paths (FileManager.save, unpackDoc, Controller.load): a STEP held as a part
// feature, a reference mesh, a file with a damaged asset, a library insert and a file from the first mesh version.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { meshToStl } from '@kit/io';
import { takeEmbedded } from '@kit/viewdata';
import { headLike } from '../../../../packages/io/src/testmesh';
import { Controller, type KernelFactory } from '../controller';
import { buildRecord } from '../meshes/meshImport';
import { MESH_KEY, decode, meshesOf, pickMeshes } from '../meshes/meshDoc';
import { insertPart } from '../library/actions';
import { clearAssetCaches, unpackDoc } from './assets';
import { stripThumbnail } from './docThumb';
import { FileManager, type FilePlatform } from './fileManager';
import { partOfStep } from './sldprtImport';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); clearAssetCaches(); });
const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
const newController = () => new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
async function openDoc(doc: PartDoc) { const c = newController(); await c.load(doc); return c; }

/** A 100 x 100 x 10 plate with an n x n grid of 4 mm holes, as a part of sketches. */
function plate(n: number): PartDoc {
  const pts: unknown[] = [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 100, y: 0 }, { id: 'p3', x: 100, y: 100 }, { id: 'p4', x: 0, y: 100 }];
  const ents: unknown[] = [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b }));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    pts.push({ id: `c${i}_${j}`, x: (100 / (n + 1)) * (i + 1), y: (100 / (n + 1)) * (j + 1) });
    ents.push({ id: `h${i}_${j}`, type: 'circle', c: `c${i}_${j}`, r: 2 });
  }
  return { ...emptyPart('Plate'), features: [
    { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' }, points: pts, entities: ents, constraints: [] },
    { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 10 },
  ], seq: 3 } as unknown as PartDoc;
}
const cutBox = (): unknown[] => [
  { type: 'sketch', id: 'F10', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'a', x: 10, y: 10 }, { id: 'b', x: 20, y: 10 }, { id: 'c', x: 20, y: 20 }, { id: 'd', x: 10, y: 20 }],
    entities: [['e1', 'a', 'b'], ['e2', 'b', 'c'], ['e3', 'c', 'd'], ['e4', 'd', 'a']].map(([i, p, q]) => ({ id: i, type: 'line', p1: p, p2: q })), constraints: [] },
  { type: 'extrude', id: 'F11', op: 'cut', sketch: 'F10', end: 'throughBoth' },
];

/** Save through the app's FileManager and open the written text the way load() does. */
async function saveAndOpen(c: Controller, name = 'Part'): Promise<{ text: string; c2: Controller; problems: unknown[] }> {
  const writes: string[] = [];
  const platform: FilePlatform = { canOverwrite: () => false, saveFile: async (_n, data) => { writes.push(String(data)); } };
  const r = await new FileManager(platform, null).save(c.document()!, { fileName: name + '.ckpart' });
  expect(r.ok).toBe(true);
  const { doc: plain } = stripThumbnail(JSON.parse(writes[0]) as PartDoc);
  const { doc, problems } = await unpackDoc(takeEmbedded(plain).doc);
  return { text: writes[0], c2: await openDoc(doc), problems };
}
const factsOf = async (c: Controller) => { const s = await Session.open(c.document()!); sessions.push(s); return s.facts(); };

describe('STEP imported as a part feature, saved and opened', { skip: !process.env.CK_WASM }, () => {
  it('the same faces and volume come back; the STEP text is stored deflated and restored identical', async () => {
    const s0 = await Session.open(plate(5)); sessions.push(s0);
    const step = await s0.step();
    const c = await openDoc(await partOfStep(step, 'Imported plate', 'plate.step'));
    const before = await factsOf(c);
    expect(before.solids).toBe(1);
    expect(before.faces.length).toBe(6 + 25);
    const { text, c2, problems } = await saveAndOpen(c);
    expect(problems).toEqual([]);
    const written = JSON.parse(text) as { blobs?: unknown; blobsZ: Record<string, { z: string }> };
    expect(written.blobs).toBeUndefined();
    expect(Object.keys(written.blobsZ)).toHaveLength(1);
    expect(text.length).toBeLessThan(step.length * 0.4);
    const after = await factsOf(c2);
    expect(after.faces).toEqual(before.faces);
    expect(after.volume).toBe(before.volume);
    expect(after.solids).toBe(1);
    expect((c2.document() as unknown as { blobs: Record<string, string> }).blobs[Object.keys(written.blobsZ)[0]]).toBe(step);
    expect(c2.buildErrors()).toEqual([]);
  });
  it('later features act on the imported body, survive Save as under a new name, and undo / redo work', async () => {
    const s0 = await Session.open(plate(3)); sessions.push(s0);
    const c = await openDoc(await partOfStep(await s0.step(), 'Plate', 'plate.step'));
    const v0 = (await factsOf(c)).volume!;
    const ops = cutBox().map((feature) => ({ op: 'add' as const, feature: feature as never }));
    expect((await c.edit(ops)).ok).toBe(true);
    const v1 = (await factsOf(c)).volume!;
    expect(v0 - v1).toBeCloseTo(10 * 10 * 10, 3);
    const { c2 } = await saveAndOpen(c, 'Renamed copy');
    expect((await factsOf(c2)).volume).toBe(v1);
    expect(c2.document()!.features.map((f) => f.type)).toEqual(['importStep', 'sketch', 'extrude']);
    await c.undo();
    expect((await factsOf(c)).volume).toBe(v0);
    await c.redo();
    expect((await factsOf(c)).volume).toBe(v1);
  });
  it('a damaged STEP asset: the part still opens, the feature reports the missing data', async () => {
    const s0 = await Session.open(plate(2)); sessions.push(s0);
    const c = await openDoc(await partOfStep(await s0.step(), 'Plate', 'plate.step'));
    const { text } = await saveAndOpen(c);
    const j = JSON.parse(text) as { blobsZ: Record<string, { z: string }> };
    const key = Object.keys(j.blobsZ)[0];
    j.blobsZ[key].z = j.blobsZ[key].z.slice(0, 60);
    const { doc, problems } = await unpackDoc(j as unknown as PartDoc);
    expect(problems).toEqual([{ kind: 'blob', key, reason: 'damaged' }]);
    const c2 = await openDoc(doc);   // does not throw
    expect(c2.document()!.features).toHaveLength(1);
    expect(c2.buildErrors()[0]?.[1].code).toBe('importStepInvalid');
  });
  it('inserting a saved part from a library brings the STEP text with it', async () => {
    const s0 = await Session.open(plate(2)); sessions.push(s0);
    const part = await partOfStep(await s0.step(), 'Plate', 'plate.step');
    const { text } = await saveAndOpen(await openDoc(part));
    const target = await openDoc(emptyPart('Target') as never);
    const lib = { id: 'l', name: 'L', source: 'local:l', parts: 1, addedAt: 0 };
    const data = { part: { id: 'plate', title: 'Plate' }, doc: JSON.parse(text), bytes: new Uint8Array(), sha256: 'x', licence: undefined, fromCache: false };
    const r = await insertPart(target, lib as never, data as never);
    expect(r.ok).toBe(true);
    expect(target.buildErrors()).toEqual([]);
    expect((await factsOf(target)).solids).toBe(1);
  });
});

describe('reference meshes, saved and opened', { skip: !process.env.CK_WASM }, () => {
  const stl = meshToStl({ positions: headLike(60, 60) }).data as Uint8Array;
  it('the mesh is written packed (no raw arrays) and opens with its placement, indices exact, picking working', async () => {
    const c = await openDoc(emptyPart('Scan') as never);
    const { rec } = buildRecord(stl, 'head.stl', 'mm', [], null);
    c.setUndoableExtra(MESH_KEY, [{ ...rec, opacity: 0.4, pos: [5, 6, 7], rot: [0, 0, 30], scale: 1.5, wire: true }]);
    const { text, c2, problems } = await saveAndOpen(c);
    expect(problems).toEqual([]);
    const w = JSON.parse(text) as { assets: number; meshes: Array<Record<string, unknown>> };
    expect(w.assets).toBe(2);
    expect(w.meshes[0].v).toBeUndefined();
    expect(text.length).toBeLessThan((rec.v.length + rec.i.length) * 0.4);
    const [back] = meshesOf(c2.document());
    expect(back).toMatchObject({ name: 'head', opacity: 0.4, pos: [5, 6, 7], rot: [0, 0, 30], scale: 1.5, wire: true, tris: rec.tris });
    expect(Array.from(decode(back).mesh.indices)).toEqual(Array.from(decode(rec).mesh.indices));
    expect(pickMeshes([back], { o: [5, 6, 600], d: [0, 0, -1] })).not.toBeNull();
  });
  it('a file written by the first mesh version (raw base64 arrays) still opens, and is packed by the next save', async () => {
    const { rec } = buildRecord(stl, 'head.stl', 'mm', [], null);
    const old = JSON.parse(JSON.stringify({ ...emptyPart('Old'), meshes: [rec] })) as PartDoc;
    const { doc, problems } = await unpackDoc(old);
    expect(problems).toEqual([]);
    const c = await openDoc(doc);
    expect(meshesOf(c.document())).toHaveLength(1);
    const { text } = await saveAndOpen(c);
    expect(JSON.parse(text).meshes[0].fmt).toBe(2);
  });
  it('a cut-off mesh asset: the part and its other mesh open, the notice list names the one that was lost', async () => {
    const c = await openDoc(emptyPart('Two') as never);
    const a = buildRecord(stl, 'one.stl', 'mm', [], null).rec;
    const b = { ...buildRecord(stl, 'two.stl', 'mm', [a], null).rec };
    c.setUndoableExtra(MESH_KEY, [a, b]);
    const { text } = await saveAndOpen(c);
    const j = JSON.parse(text) as { meshes: Array<{ z: string }> };
    j.meshes[1].z = j.meshes[1].z.slice(0, j.meshes[1].z.length >> 1);
    const { doc, problems } = await unpackDoc(j as unknown as PartDoc);
    expect(problems).toEqual([{ kind: 'mesh', name: 'two', reason: 'damaged' }]);
    const c2 = await openDoc(doc);
    expect(meshesOf(c2.document()).map((m) => m.name)).toEqual(['one']);
  });
  it('library insert: the part\'s meshes are added with ids that do not clash, in one undo step', async () => {
    const c = await openDoc(emptyPart('Src') as never);
    const m = buildRecord(stl, 'head.stl', 'mm', [], null).rec;
    c.setUndoableExtra(MESH_KEY, [m]);
    const { text } = await saveAndOpen(c);
    const target = await openDoc({ ...emptyPart('Target'), meshes: [m] } as never);
    const lib = { id: 'l', name: 'L', source: 'local:l', parts: 1, addedAt: 0 };
    const r = await insertPart(target, lib as never, { part: { id: 'p', title: 'P' }, doc: JSON.parse(text), bytes: new Uint8Array(), sha256: 'x', licence: undefined, fromCache: false } as never);
    expect(r.ok && r.meshes).toBe(1);
    expect(meshesOf(target.document()).map((x) => x.id)).toEqual(['mesh1', 'mesh2']);
    await target.undo();
    expect(meshesOf(target.document()).map((x) => x.id)).toEqual(['mesh1']);
  });
});
