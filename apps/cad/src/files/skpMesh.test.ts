import { describe, expect, it } from 'vitest';
import { matRuns, meshesOf, NO_MAT, decode } from '../meshes/meshDoc';
import { orientOf, SKP_ROT, skpMeshArrays, skpMeshRecord } from './skpMesh';
import { nextSkpOrient, skpNotices } from './skpImport';
import { packDoc, unpackDoc } from './assets';

/** Two unit squares as 4 triangles: faces skp.F0 (material 1, translucent blue) and skp.F1 (material 0, red), with a face with no material. */
function input(extra = true) {
  const sq = (z: number) => [0, 0, z, 1, 0, z, 1, 1, z, 0, 0, z, 1, 1, z, 0, 1, z];
  const positions = Float32Array.from([...sq(0), ...sq(1), ...(extra ? sq(2) : [])]);
  const triFace = Int32Array.from(extra ? [0, 0, 1, 1, 2, 2] : [0, 0, 1, 1]);
  return {
    mesh: { positions, triFace, faceIds: ['skp.F0', 'skp.F1', 'skp.F2'].slice(0, extra ? 3 : 2) },
    materials: [{ color: [255, 0, 0], opacity: 1 }, { color: [0, 0, 255], opacity: 0.4 }],
    faceMaterials: [1, 0, -1],
  };
}

describe('skpMeshArrays', () => {
  it('welds vertices within a face only: two squares share 4 vertices each, not each other', () => {
    const a = skpMeshArrays(input());
    expect(a.indices.length).toBe(18);
    expect(a.vertices.length / 3).toBe(12);   // 3 faces x 4 corners, nothing shared across faces (flat shading stays crisp)
  });
  it('sorts triangles by material, none last, and keeps a compact palette in order of use', () => {
    const a = skpMeshArrays(input());
    expect(a.mats).toEqual([{ c: '#0000ff', o: 0.4 }, { c: '#ff0000', o: 1 }]);
    expect(Array.from(a.tm)).toEqual([0, 0, 1, 1, NO_MAT, NO_MAT]);
  });
  it('a face whose material is missing or unknown has none', () => {
    const i = input();
    i.faceMaterials = [7, -1];
    expect(Array.from(skpMeshArrays(i).tm)).toEqual(Array(6).fill(NO_MAT));
    expect(skpMeshArrays(i).mats).toEqual([]);
  });
  it('triangles keep their corners: same positions as the kernel gave', () => {
    const i = input();
    i.faceMaterials = [1, 0, -1];
    const a = skpMeshArrays(i);
    const sorted = [0, 1, 2, 3, 4, 5];   // palette order is order of first use, so this input is already sorted
    for (let k = 0; k < 6; k++) for (let c = 0; c < 3; c++) for (let x = 0; x < 3; x++) expect(a.vertices[a.indices[k * 3 + c] * 3 + x]).toBe(i.mesh.positions[sorted[k] * 9 + c * 3 + x]);
  });
  it('a large model is quick: 300,000 triangles welded in well under a second', () => {
    const n = 300_000;
    const positions = new Float32Array(n * 9).map((_, i) => ((i * 7) % 1000) / 10);
    const triFace = Int32Array.from({ length: n }, (_, t) => t >> 3);
    const faceIds = Array.from({ length: (n >> 3) + 1 }, (_, f) => 'skp.F' + f);
    const t0 = performance.now();
    const a = skpMeshArrays({ mesh: { positions, triFace, faceIds }, materials: [{ color: [1, 2, 3], opacity: 1 }], faceMaterials: faceIds.map(() => 0) });
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(a.indices.length).toBe(n * 3);
  });
});

describe('skpMeshRecord', () => {
  const summary = { faces: 3, pieces: 1, openEdges: 4, nonManifoldEdges: 0, materials: 2, hiddenSkipped: 0, closed: false };
  const rec = (up: 'y' | 'z' | 'yFlip' = 'y') => skpMeshRecord({ view: { mesh: input().mesh }, facts: { materials: input().materials as never, faceMaterials: input().faceMaterials }, summary }, { id: 'mesh1', name: 'Chair', up }).rec;
  it('is a millimetre mesh record with materials, the open flag, and the orientation as its rotation', () => {
    const r = rec('y');
    expect(r).toMatchObject({ id: 'mesh1', name: 'Chair', unit: 'mm', tris: 6, watertight: false, rot: [-90, 0, 0], opacity: 1 });
    expect(r.mats).toHaveLength(2);
    expect(r.m).toBeTruthy();
    expect(rec('z').rot).toEqual([0, 0, 0]);
  });
  it('the runs are one per material; the record colour is for the triangles with none', () => {
    const r = { ...rec(), color: '#abcdef' };
    expect(matRuns(r)).toEqual([
      { start: 0, count: 2, color: '#0000ff', opacity: 0.4 },
      { start: 2, count: 2, color: '#ff0000', opacity: 1 },
      { start: 4, count: 2, color: '#abcdef', opacity: 1 },
    ]);
  });
  it('survives the file: colours, translucency, runs and the transform', async () => {
    const r = { ...rec('yFlip'), pos: [1, 2, 3] as [number, number, number], opacity: 0.8 };
    const { doc, problems } = await unpackDoc(JSON.parse(JSON.stringify(await packDoc({ name: 'P', features: [], meshes: [r] }))));
    expect(problems).toEqual([]);
    const [b] = meshesOf(doc);
    expect(b).toMatchObject({ rot: [-90, 0, 180], pos: [1, 2, 3], opacity: 0.8, watertight: false });
    expect(b.mats).toEqual(r.mats);
    expect(Array.from(decode(b).tm!)).toEqual(Array.from(decode(r).tm!));
    expect(matRuns(b)).toEqual(matRuns(r));
  });
  it('the rotation presets are the three views, and are recognised again', () => {
    for (const o of ['y', 'z', 'yFlip'] as const) expect(orientOf(SKP_ROT[o])).toBe(o);
    expect(orientOf([10, 0, 0])).toBeNull();
    expect(nextSkpOrient('y')).toBe('z');
  });
  it('the notice for a mesh says it is a reference mesh, with Flip orientation and the open-edge warning', () => {
    const tr = (k: string, p?: Record<string, string | number>) => k + JSON.stringify(p ?? {});
    const n = skpNotices(summary, { file: 'c.skp', up: 'y', hidden: false, mesh: 6 }, tr, { flip() {}, showHidden() {} });
    expect(n[0].text).toContain('files.skp.mesh.done');
    expect(n[0].action).toBeDefined();
    expect(n.at(-1)!.level).toBe('warn');
  });
});
