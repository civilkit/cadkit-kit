// Convert mesh to solid against the real kernel (CK_WASM): the request the panel builds, the reply read into the report or the refusal
// it shows, through the controller's transport, on the preview tag (the document is not touched).
import { afterEach, describe, expect, it } from 'vitest';
import { meshToStl, readStl } from '@kit/io';
import { Session } from '@ck/session';
import { emptyPart } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../controller';
import { cube, cylinder } from '../../../../packages/io/src/testmesh';
import { meshRecFromStl, type MeshRec } from './meshDoc';
import { DEFAULT_MESH_SOLID_OPTIONS, MESH_SOLID_TAG, marksOf, previewSurface, releasePreview, runMeshToSolid, worldMesh, type MeshSolidOptions } from './meshSolid';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
const opened = async () => {
  const c = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  await c.load(emptyPart('Host'));
  const k = await c.meshSolidKernel();
  if (!k) throw new Error('no kernel');
  return { c, k };
};
const rec = (soup: Float32Array, name = 'm'): MeshRec => meshRecFromStl(readStl(meshToStl({ positions: soup }).data as Uint8Array, { unit: 'mm' }), 'mesh1', name, 'mm');
const opts = (o: Partial<MeshSolidOptions> = {}): MeshSolidOptions => ({ ...DEFAULT_MESH_SOLID_OPTIONS, ...o });
/** the 10 mm cube without its +X face (the last two triangles) */
const openCube = () => cube(10).slice(0, 10 * 9);
/** the 10 mm cube without one triangle of its +X face */
const holedCube = () => cube(10).slice(0, 11 * 9);

describe('Convert mesh to solid, real kernel', { skip: !process.env.CK_WASM }, () => {
  it('a closed cube: six planar faces, the volume of the mesh, no closing, and the document untouched', async () => {
    const { c, k } = await opened();
    const before = JSON.stringify(c.document());
    const o = await runMeshToSolid(k, worldMesh(rec(cube(10))), opts(), { name: 'cube' });
    expect(o.ok).toBe(true);
    if (!o.ok) return;
    expect(o.report.faces).toBe(6);
    expect(o.report.kinds).toEqual({ planar: 6, faceted: 0, cylinder: 0, cone: 0, sphere: 0, other: 0 });
    expect(o.report.volume.body).toBeCloseTo(1000, 6);
    expect(Math.abs(o.report.volume.relative ?? 1)).toBeLessThan(1e-9);
    expect(o.report.deviation!.max).toBeLessThan(1e-9);
    expect(o.report.closing).toBeNull();
    expect(previewSurface(o.body)!.mesh.faceIds.length).toBe(6);
    expect(JSON.stringify(c.document())).toBe(before);
    await releasePreview(k, MESH_SOLID_TAG);
  });
  it('a cylinder becomes one cylinder face and two planes; with the analytic fit off it stays faceted', async () => {
    const { k } = await opened();
    const fit = await runMeshToSolid(k, worldMesh(rec(cylinder(5, 10, 32))), opts(), { name: 'cyl' });
    expect(fit.ok && fit.report.kinds).toMatchObject({ planar: 2, cylinder: 1 });
    expect(fit.ok && fit.report.volume.relative).toBeGreaterThan(0);
    const flat = await runMeshToSolid(k, worldMesh(rec(cylinder(5, 10, 32))), opts({ analytic: false }), { name: 'cyl' });
    expect(flat.ok && flat.report.kinds.cylinder).toBe(0);
    expect(flat.ok && flat.report.kinds.planar).toBeGreaterThan(30);
  });
  it('Decimate thins a dense mesh within the deviation set, reports before and after, and the solid still has the volume', async () => {
    const { k } = await opened();
    const dense = rec(cylinder(5, 10, 240));
    const plain = await runMeshToSolid(k, worldMesh(dense), opts({ analytic: false }), { name: 'dense' });
    expect(plain.ok && plain.report.decimation).toBeNull();
    const o = await runMeshToSolid(k, worldMesh(dense), opts({ analytic: false, decimate: true, decimateTol: 0.05 }), { name: 'dense' });
    expect(o.ok).toBe(true);
    if (!o.ok || !plain.ok) return;
    const d = o.report.decimation!;
    expect(d.inputTriangles).toBe(dense.tris);
    expect(d.triangles).toBeLessThan(d.inputTriangles / 2);
    expect(d.tol).toBe(0.05);
    expect(d.deviation).toBeLessThanOrEqual(0.05 + 1e-9);
    expect(Math.abs(o.report.volume.body! - plain.report.volume.body!) / plain.report.volume.body!).toBeLessThan(0.02);
    await releasePreview(k, MESH_SOLID_TAG);
  });
  it('Decimate with a target stops at it, and a tolerance of nothing to remove leaves the mesh as it was', async () => {
    const { k } = await opened();
    const dense = rec(cylinder(5, 10, 240));
    const t = await runMeshToSolid(k, worldMesh(dense), opts({ analytic: false, decimate: true, decimateTol: 0.5, decimateTarget: 400 }), { name: 'dense' });
    expect(t.ok && t.report.decimation!.triangles).toBeGreaterThanOrEqual(400);
    expect(t.ok && t.report.decimation!.triangles).toBeLessThan(600);
    const none = await runMeshToSolid(k, worldMesh(rec(cube(10))), opts({ decimate: true, decimateTol: 0.0001 }), { name: 'cube' });
    expect(none.ok && none.report.decimation!.triangles).toBe(12);
    await releasePreview(k, MESH_SOLID_TAG);
  });
  it('a cube with a hole is refused with the places of the open edges; a moved mesh gives moved places', async () => {
    const { k } = await opened();
    const o = await runMeshToSolid(k, worldMesh(rec(holedCube())), opts(), { name: 'holed' });
    expect(o.ok).toBe(false);
    if (o.ok || !('refusal' in o)) throw new Error('expected a refusal');
    expect(o.refusal.code).toBe('meshNotWatertight');
    expect(o.refusal.message).toMatch(/open edges/);
    expect(o.refusal.hint.length).toBeGreaterThan(10);
    expect(o.refusal.positions.length).toBe(3);
    for (const p of o.refusal.positions) expect(p[0]).toBeCloseTo(10, 6);   // all on the +X side, where the triangle is missing
    expect(marksOf(o).length).toBe(3);
    const moved = { ...rec(holedCube()), pos: [100, 0, 0] as [number, number, number] };
    const m = await runMeshToSolid(k, worldMesh(moved), opts(), { name: 'holed' });
    if (m.ok || !('refusal' in m)) throw new Error('expected a refusal');
    for (const p of m.refusal.positions) expect(p[0]).toBeCloseTo(110, 4);
  });
  it('a cube with a missing face and Close on: the hole is filled flat, reported with its place, and the volume is the cube`s', async () => {
    const { k } = await opened();
    const refused = await runMeshToSolid(k, worldMesh(rec(openCube())), opts(), { name: 'open' });
    expect(!refused.ok && 'refusal' in refused && refused.refusal.code).toBe('meshNotWatertight');
    const o = await runMeshToSolid(k, worldMesh(rec(openCube())), opts({ close: true }), { name: 'open' });
    expect(o.ok).toBe(true);
    if (!o.ok) return;
    const cl = o.report.closing!;
    expect(cl.filledHoles).toBe(1);
    expect(cl.holes[0]).toMatchObject({ edges: 4, area: 100, planar: true, method: 'ear' });
    expect(cl.holes[0].at![0]).toBeCloseTo(10, 6);
    expect(o.report.faces).toBe(6);
    expect(o.report.volume.body).toBeCloseTo(1000, 6);
    expect(marksOf(o)).toEqual([{ kind: 'hole', at: cl.holes[0].at }]);
    // fill off: only welding and stitching, so the missing face stays a gap
    const weldOnly = await runMeshToSolid(k, worldMesh(rec(openCube())), opts({ close: true, fill: false }), { name: 'open' });
    expect(weldOnly.ok).toBe(false);
  });
  it('a hole larger than the limit is refused with the hole and its place', async () => {
    const { k } = await opened();
    const o = await runMeshToSolid(k, worldMesh(rec(openCube())), opts({ close: true, maxHoleEdges: 3 }), { name: 'open' });
    if (o.ok || !('refusal' in o)) throw new Error('expected a refusal');
    expect(o.refusal.code).toBe('meshHoleTooLarge');
    expect(o.refusal.holes.length).toBe(1);
    expect(o.refusal.holes[0].edges).toBe(4);
    expect(marksOf(o).length).toBeGreaterThan(0);
  });
});
