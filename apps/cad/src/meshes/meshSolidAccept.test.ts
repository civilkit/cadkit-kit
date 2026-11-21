import { describe, expect, it } from 'vitest';
import type { PartDoc } from '@ck/part-model';
import { sha256Hex } from '@kit/viewdata';
import { acceptMeshSolid, meshSolidPatch, nextFeatureNumber, packMesh } from './meshSolidAccept';
import { base64ToBytes } from './meshDoc';
import type { MeshSolidOptions } from './meshSolid';

const OPTS: MeshSolidOptions = { close: false, fill: true, closeTolerance: null, maxHoleEdges: null, planeTol: null, angleTolDeg: null, fitTol: null, analytic: true } as MeshSolidOptions;
const mesh = { vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]), indices: new Uint32Array([0, 1, 2, 0, 1, 3, 0, 2, 3, 1, 2, 3]) };
const doc = (extra: Record<string, unknown> = {}) => ({ features: [{ id: 'F1', type: 'box' }, { id: 'F4', type: 'box' }], seq: 3, ...extra }) as unknown as PartDoc;
const input = (d = doc()) => ({ doc: d, mesh, options: OPTS, name: 'Van', report: {} as never });

describe('meshToSolid accept', () => {
  it('packs the kernel payload: counts, vertices, corners, little endian', () => {
    const b = packMesh(mesh);
    const dv = new DataView(b.buffer);
    expect([dv.getUint32(0, true), dv.getUint32(4, true)]).toEqual([4, 4]);
    expect(dv.getFloat32(8 + 12, true)).toBe(1);
    expect(dv.getUint32(8 + 48, true)).toBe(0);
    expect(b.length).toBe(8 + 4 * 12 + 4 * 12);
  });
  it('the next feature number is after the highest id and the document seq', () => {
    expect(nextFeatureNumber(doc())).toBe(5);
    expect(nextFeatureNumber(doc({ seq: 9 }))).toBe(9);
  });
  it('one append with the blob under the hash of its base64 text, the options and the seq', async () => {
    const { patch, id } = await meshSolidPatch({ ...input(), sourceName: 'van.stl' });
    expect(id).toBe('F5');
    expect(patch.seq).toBe(6);
    const [key, b64] = Object.entries(patch.blobs!)[0];
    expect(key).toBe(await sha256Hex(new TextEncoder().encode(b64)));
    expect(base64ToBytes(b64)).toEqual(packMesh(mesh));
    expect(patch.append).toEqual([{ type: 'meshToSolid', id: 'F5', name: 'Van', body: 'Van', blob: key, opts: {}, replace: false, source: { name: 'van.stl', format: 'stl' } }]);
  });
  it('keeps the feature only when the kernel rebuilds it, and says why when not', async () => {
    const calls: unknown[] = [];
    const ok = await acceptMeshSolid(input(), async (p, r) => { calls.push([p, r]); return { ok: true }; });
    expect(ok).toEqual({ ok: true, id: 'F5' });
    expect(calls).toHaveLength(1);
    const bad = await acceptMeshSolid(input(), async () => ({ ok: false, errors: [{ feature: 'F5', code: 'meshNotWatertight' }] }));
    expect(bad).toMatchObject({ ok: false, code: 'meshNotWatertight' });
  });
});
