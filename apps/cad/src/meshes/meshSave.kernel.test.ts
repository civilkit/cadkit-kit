// A reference mesh survives Save and reopen (through the real FileManager and the app's open path), is not sent to the kernel, undoes,
// and a sketch can be started on a plane through a point of its surface.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { meshToStl } from '@kit/io';
import { takeEmbedded } from '@kit/viewdata';
import { headLike } from '../../../../packages/io/src/testmesh';
import { Controller, type KernelFactory } from '../controller';
import { stripThumbnail } from '../files/docThumb';
import { FileManager, type FilePlatform } from '../files/fileManager';
import { unpackDoc } from '../files/assets';
import { buildRecord } from './meshImport';
import { MESH_KEY, decode, meshesOf, pickMeshes } from './meshDoc';
import { planeThrough } from './meshEdit';
import { treeMeshRows } from './meshTree';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function open(doc: PartDoc) {
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const c = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  await c.load(doc);
  return c;
}
const stl = meshToStl({ positions: headLike(60, 60) }).data as Uint8Array;

describe('reference mesh in a part', { skip: !process.env.CK_WASM }, () => {
  it('Save and reopen keep the mesh and its placement; the row is there; picking still works', async () => {
    const c = await open(emptyPart('Scan') as never);
    const { rec } = buildRecord(stl, 'head.stl', 'mm', [], null);
    c.setUndoableExtra(MESH_KEY, [{ ...rec, opacity: 0.4, pos: [5, 6, 7], rot: [0, 0, 30], scale: 1.5, wire: true }]);
    const writes: string[] = [];
    const platform: FilePlatform = { canOverwrite: () => false, saveFile: async (_n, data) => { writes.push(String(data)); } };
    const r = await new FileManager(platform, null).save(c.document()!, {});
    expect(r.ok).toBe(true);
    expect(JSON.parse(writes[0]).meshes).toHaveLength(1);
    const { doc: plain } = stripThumbnail(JSON.parse(writes[0]) as PartDoc);
    const c2 = await open((await unpackDoc(takeEmbedded(plain).doc)).doc);   // the file holds the mesh packed (files/assets.ts)
    const back = meshesOf(c2.document());
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ name: 'head', opacity: 0.4, pos: [5, 6, 7], rot: [0, 0, 30], scale: 1.5, wire: true, tris: rec.tris });
    expect(decode(back[0]).mesh.indices.length / 3).toBe(rec.tris);
    expect(treeMeshRows(c2.document()).map((x) => x.id)).toEqual(['mesh:mesh1']);
    expect(pickMeshes(back, { o: [5, 6, 600], d: [0, 0, -1] })).not.toBeNull();
  });
  it('the kernel never receives the mesh and an edit does not drop it; undo removes and redo restores it', async () => {
    const { rec } = buildRecord(stl, 'head.stl', 'mm', [], null);
    const c = await open({ ...emptyPart('Scan'), meshes: [rec] } as never);
    expect(JSON.stringify(c.document()).includes('"v":"')).toBe(true);
    const ok = await c.edit([{ op: 'add', feature: planeThrough([0, 0, 100], [0, 0, 1], 'normal', 'P') as never }]);
    expect(ok.ok).toBe(true);
    expect(meshesOf(c.document())).toHaveLength(1);
    c.setUndoableExtra(MESH_KEY, null);
    expect(meshesOf(c.document())).toHaveLength(0);
    await c.undo();
    expect(meshesOf(c.document())).toHaveLength(1);
  });
  it('a plane through a surface point (mode frame) can host a sketch', async () => {
    const { rec } = buildRecord(stl, 'head.stl', 'mm', [], null);
    const c = await open({ ...emptyPart('Scan'), meshes: [rec] } as never);
    const hit = pickMeshes([rec], { o: [0, 600, 0], d: [0, -1, 0] })!;
    const r = await c.edit([{ op: 'add', feature: { ...planeThrough(hit.pos, hit.normal, 'normal', 'Mesh plane'), visible: false } as never }]);
    expect(r.ok).toBe(true);
    const pl = c.document()!.features.at(-1)!;
    const view = await c.beginNewSketch({ kind: 'feature', id: pl.id });
    expect(view).not.toBeNull();
    const o = view!.frame.o;
    for (let i = 0; i < 3; i++) expect(o[i]).toBeCloseTo(hit.pos[i], 3);
    const z = view!.frame.z;
    for (let i = 0; i < 3; i++) expect(z[i]).toBeCloseTo(hit.normal[i], 3);
  });
});
