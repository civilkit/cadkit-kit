import { beforeEach, describe, expect, it } from 'vitest';
import { meshToStl } from '@kit/io';
import { headLike } from '../../../../packages/io/src/testmesh';
import { buildRecord } from '../meshes/meshImport';
import { clearMeshCache, decode, meshRecFromArrays, meshesOf, type MeshRec } from '../meshes/meshDoc';
import { assetSize, clearAssetCaches, hasRawAssets, lightDoc, packDoc, packDocCached, packMesh, packText, unpackDoc, warmPackCache } from './assets';

const stl = (n: number) => meshToStl({ positions: headLike(n, n) }).data as Uint8Array;
const rec = (n = 40): MeshRec => buildRecord(stl(n), 'head.stl', 'mm', [], null).rec;
const STEP = 'ISO-10303-21;\nHEADER;\n' + 'FILE_NAME(\'x\');\n'.repeat(2000) + 'ENDSEC;\nEND-ISO-10303-21;\n';
async function keyOf(text: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('');
}
beforeEach(() => { clearAssetCaches(); clearMeshCache(); });

describe('packDoc / unpackDoc', () => {
  it('a mesh survives: indices exact, vertices within the grid, settings and transform untouched', async () => {
    const r = { ...rec(), name: 'Scan', opacity: 0.4, pos: [5, 6, 7] as [number, number, number], rot: [0, 0, 30] as [number, number, number], scale: 1.5, wire: true, color: '#112233' };
    const packed = await packDoc({ name: 'P', features: [], meshes: [r] });
    const m0 = (packed as { meshes: Array<Record<string, unknown>> }).meshes[0];
    expect(m0.v).toBeUndefined(); expect(m0.i).toBeUndefined();
    expect(m0).toMatchObject({ fmt: 2, name: 'Scan', opacity: 0.4, pos: [5, 6, 7], rot: [0, 0, 30], scale: 1.5, wire: true, color: '#112233' });
    expect((packed as { assets?: number }).assets).toBe(2);
    const JSONed = JSON.parse(JSON.stringify(packed));   // through the file
    const { doc, problems } = await unpackDoc(JSONed);
    expect(problems).toEqual([]);
    const [back] = meshesOf(doc);
    expect(back).toMatchObject({ id: r.id, name: 'Scan', opacity: 0.4, pos: [5, 6, 7], rot: [0, 0, 30], scale: 1.5, wire: true, color: '#112233', tris: r.tris, verts: r.verts });
    expect((doc as { assets?: unknown }).assets).toBeUndefined();
    const a = decode(r), b = decode(back);
    expect(Array.from(b.mesh.indices)).toEqual(Array.from(a.mesh.indices));
    let worst = 0;
    for (let i = 0; i < a.mesh.vertices.length; i++) worst = Math.max(worst, Math.abs(a.mesh.vertices[i] - b.mesh.vertices[i]));
    expect(worst).toBeLessThan(0.0006);   // half a micron grid plus float32 resolution at 100 mm
  });
  it('a second save of a loaded mesh writes the same bytes', async () => {
    const first = await packDoc({ name: 'P', features: [], meshes: [rec()] });
    const { doc } = await unpackDoc(JSON.parse(JSON.stringify(first)));
    clearAssetCaches();
    const second = await packDoc(doc);
    expect((second as unknown as { meshes: Array<{ z: string }> }).meshes[0].z).toBe((first as unknown as { meshes: Array<{ z: string }> }).meshes[0].z);
  });
  it('colours: materials and the material of every triangle survive', async () => {
    const base = rec(20);
    const d = decode(base);
    const tm = new Uint16Array(base.tris).map((_, t) => (t < 100 ? 0 : t < 300 ? 1 : 0xffff));
    const r = meshRecFromArrays({ vertices: d.mesh.vertices, indices: d.mesh.indices, tm }, { id: 'mesh1', name: 'Colour', unit: 'mm', watertight: true, mats: [{ c: '#ff0000', o: 1 }, { c: '#0000ff', o: 0.3 }] });
    const { doc } = await unpackDoc(JSON.parse(JSON.stringify(await packDoc({ name: 'P', features: [], meshes: [r] }))));
    const [back] = meshesOf(doc);
    expect(back.mats).toEqual([{ c: '#ff0000', o: 1 }, { c: '#0000ff', o: 0.3 }]);
    expect(Array.from(decode(back).tm!)).toEqual(Array.from(tm));
  });
  it('STEP text in the blobs table is stored deflated and comes back identical', async () => {
    const key = await keyOf(STEP);
    const packed = await packDoc({ name: 'P', features: [], blobs: { [key]: STEP } }) as unknown as { blobs?: unknown; blobsZ: Record<string, { z: string; n: number }> };
    expect(packed.blobs).toBeUndefined();
    expect(packed.blobsZ[key].n).toBe(new TextEncoder().encode(STEP).length);
    expect(packed.blobsZ[key].z.length).toBeLessThan(STEP.length / 8);
    const { doc, problems } = await unpackDoc(JSON.parse(JSON.stringify(packed)));
    expect(problems).toEqual([]);
    expect((doc as { blobs: Record<string, string>; blobsZ?: unknown }).blobs[key]).toBe(STEP);
    expect((doc as { blobsZ?: unknown }).blobsZ).toBeUndefined();
  });
  it('files from earlier versions load as they are (raw meshes, plain blobs, no assets)', async () => {
    const r = rec();
    const old = { name: 'Old', features: [], meshes: [r], blobs: { k: 'text' } };
    const { doc, problems } = await unpackDoc(old);
    expect(problems).toEqual([]);
    expect(doc).toBe(old);
    const plain = { name: 'Plain', features: [] };
    expect((await unpackDoc(plain)).doc).toBe(plain);
    expect(await packDoc(plain)).toBe(plain);
  });
  it('a damaged mesh is dropped and said; the other mesh and the rest of the part load', async () => {
    const a = rec(30), b = { ...rec(20), id: 'mesh2', name: 'Second' };
    const packed = await packDoc({ name: 'P', features: [{ id: 'F1' }], meshes: [a, b] }) as unknown as { meshes: Array<Record<string, unknown>> };
    const cut = JSON.parse(JSON.stringify(packed));
    cut.meshes[0].z = (cut.meshes[0].z as string).slice(0, 200);
    const { doc, problems } = await unpackDoc(cut);
    expect(problems).toEqual([{ kind: 'mesh', name: a.name, reason: 'damaged' }]);
    expect(meshesOf(doc).map((m) => m.id)).toEqual(['mesh2']);
    expect((doc as { features: unknown[] }).features).toHaveLength(1);
  });
  it('flipped bytes, a wrong checksum, junk base64 and a payload that lies about its size are all caught', async () => {
    const packed = JSON.parse(JSON.stringify(await packDoc({ name: 'P', features: [], meshes: [rec(20)] })));
    const variants: Array<(m: Record<string, unknown>) => void> = [
      (m) => { const z = m.z as string; m.z = z.slice(0, 40) + (z[40] === 'A' ? 'B' : 'A') + z.slice(41); },
      (m) => { m.crc = (m.crc as number) + 1; },
      (m) => { m.z = '%%% not base64 %%%'; },
      (m) => { m.n = 5; },
      (m) => { delete m.z; },
      (m) => { m.c = 0; },   // says "not deflated" about deflated bytes
    ];
    for (const v of variants) {
      const c = JSON.parse(JSON.stringify(packed));
      v(c.meshes[0]);
      const r = await unpackDoc(c);
      expect(r.problems.length, String(v)).toBe(1);
      expect(meshesOf(r.doc)).toHaveLength(0);
    }
  });
  it('a record from a newer build is left out with its own reason', async () => {
    const packed = JSON.parse(JSON.stringify(await packDoc({ name: 'P', features: [], meshes: [rec(20)] })));
    packed.meshes[0].fmt = 3;
    expect((await unpackDoc(packed)).problems).toEqual([{ kind: 'mesh', name: 'head', reason: 'newer' }]);
  });
  it('a STEP blob whose text does not match its key is dropped, not trusted', async () => {
    const key = await keyOf(STEP);
    const packed = JSON.parse(JSON.stringify(await packDoc({ name: 'P', features: [], blobs: { [key]: STEP } })));
    packed.blobsZ[key].z = (await packDoc({ name: 'x', features: [], blobs: { other: 'different text' } }) as unknown as { blobsZ: { other: { z: string } } }).blobsZ.other.z;
    packed.blobsZ[key].n = 14;
    const r = await unpackDoc(packed);
    expect(r.problems).toHaveLength(1);
    expect((r.doc as { blobs?: unknown }).blobs).toBeUndefined();
  });
});

describe('the backups', () => {
  it('packDocCached uses what is warm, keeps the rest raw, and leaves meshes out past the budget (never a blob)', async () => {
    const a = rec(30), b = { ...rec(20), id: 'mesh2', name: 'Second' };
    const key = await keyOf(STEP);
    const doc = { name: 'P', features: [], meshes: [a, b], blobs: { [key]: STEP } };
    const cold = packDocCached(doc);
    expect(cold.doc).toMatchObject({ meshes: [{ v: a.v }, { v: b.v }], blobs: { [key]: STEP } });
    await warmPackCache(doc);
    const warm = packDocCached(doc);
    expect((warm.doc as unknown as { meshes: Array<{ fmt: number }> }).meshes.every((m) => m.fmt === 2)).toBe(true);
    expect((warm.doc as { blobs?: unknown }).blobs).toBeUndefined();
    expect(JSON.stringify(warm.doc).length).toBeLessThan(JSON.stringify(doc).length / 4);
    const tight = packDocCached(doc, 100);
    expect(tight.omitted).toEqual(['head', 'Second']);
    expect(tight.doc).toMatchObject({ blobsZ: { [key]: expect.anything() } });
    expect((tight.doc as { meshes?: unknown }).meshes).toBeUndefined();
    // and what it wrote opens again
    const { doc: back } = await unpackDoc(JSON.parse(JSON.stringify(warm.doc)));
    expect(meshesOf(back)).toHaveLength(2);
  });
  it('lightDoc keeps settings and signatures but not the arrays or the STEP text', () => {
    const r = rec(20);
    const l = lightDoc({ name: 'P', meshes: [r], blobs: { k: 'x'.repeat(1000) } }) as { meshes: Array<{ v: unknown; sig: string }>; blobs: { k: unknown } };
    expect(l.meshes[0].v).toBe(r.v.length);
    expect(l.meshes[0].sig).toBe(r.sig);
    expect(l.blobs.k).toBe(1000);
    expect(JSON.stringify(l).length).toBeLessThan(2000);
  });
  it('packText packs a document file text and leaves other text alone', async () => {
    const key = await keyOf(STEP);
    const t = JSON.stringify({ format: 'ck-part', name: 'F', features: [], blobs: { [key]: STEP } });
    const out = await packText(t);
    expect(out.length).toBeLessThan(t.length / 4);
    expect(JSON.parse(out).blobsZ[key]).toBeDefined();
    expect(await packText('not json')).toBe('not json');
    const plain = JSON.stringify({ name: 'x', features: [] });
    expect(await packText(plain)).toBe(plain);
  });
});

describe('size', () => {
  it('a 80,000 triangle mesh in the file is well under a quarter of its JSON number-array size', async () => {
    const r = buildRecord(stl(200), 'head.stl', 'mm', [], null).rec;
    const d = decode(r);
    const naive = JSON.stringify({ v: Array.from(d.mesh.vertices), i: Array.from(d.mesh.indices) }).length;
    const packed = JSON.stringify(await packDoc({ name: 'P', features: [], meshes: [r] })).length;
    expect(hasRawAssets({ meshes: [r] })).toBe(true);
    expect(assetSize({ meshes: [r] }).meshes).toBeGreaterThan(packed);
    expect(r.tris).toBeGreaterThan(70000);
    expect(packed).toBeLessThan(naive * 0.25);
    await packMesh(r);
  });
});
