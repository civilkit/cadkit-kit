// The Measure tool on reference meshes: a pick on a mesh is a point (named by the mesh and the world position on its triangles), measured
// like a corner against corners, edges and faces of the body and against other mesh points. The viewport's pick is checked in the browser.
import { describe, expect, it, vi } from 'vitest';
import { indexMesh, meshToStl, readStl } from '@kit/io';
import { meshPointName, parseMeshPointName, pointOfName } from '@kit/store';
import { cube } from '../../../../packages/io/src/testmesh';
import { meshRecFromStl, pickMeshes, type MeshRec } from '../meshes/meshDoc';
import { faceNames, objectRef } from '../featureCommands';
import { measure, resolvePick, type EdgeInfo, type MeasureCtx } from './measure';

const edges: EdgeInfo[] = [{ key: 'x|y#0', pts: [[0, 0, 0], [10, 0, 0]], line: true, faces: ['A', 'B'], mid: [5, 0, 0] }];
const ctx = (mesh: MeasureCtx['mesh'] = null, kernel: MeasureCtx['kernel'] = async () => null): MeasureCtx => ({ edges, mesh, kernel });
const val = (o: { rows: Array<{ id: string; value: unknown }> }, id: string) => o.rows.find((r) => r.id === id)?.value;

describe('mesh point names', () => {
  it('carry the mesh id and the rounded world position, and read back', () => {
    const n = meshPointName('mesh2', [1.234567, -0, 30]);
    expect(n).toBe('mp:mesh2@1.2346,0,30');
    expect(parseMeshPointName(n)).toEqual({ mesh: 'mesh2', p: [1.2346, 0, 30] });
    expect(pointOfName(n)).toEqual([1.2346, 0, 30]);
    expect(pointOfName('v:1,2,3')).toEqual([1, 2, 3]);
    expect(pointOfName('F1.C0')).toBeNull();
    for (const bad of ['mp:', 'mp:mesh1', 'mp:mesh1@1,2', 'mp:mesh1@1,x,3', 'v:1,2,3']) expect(parseMeshPointName(bad), bad).toBeNull();
  });
  it('are a point pick with its mesh; a damaged one is nothing, never a face', () => {
    expect(resolvePick('mp:mesh1@1,2,3', edges)).toEqual({ kind: 'vertex', name: 'mp:mesh1@1,2,3', p: [1, 2, 3], mesh: 'mesh1' });
    expect(resolvePick('mp:mesh1@1,2', edges)).toBeNull();
  });
  it('are left out by the commands that act on faces and objects', () => {
    expect(faceNames(['F1.C0', 'mp:mesh1@1,2,3', 'v:1,2,3'])).toEqual(['F1.C0']);
    expect(objectRef(['mp:mesh1@1,2,3'], [], true)).toBeNull();
  });
});

describe('measuring with mesh points', () => {
  const P = (n: string) => resolvePick(n, edges)!;
  it('two points on a mesh: distance, the x, y, z offsets and a leader, marked as on a mesh', async () => {
    const o = await measure([P('mp:mesh1@0,0,0'), P('mp:mesh1@3,4,12')], ctx());
    expect(val(o, 'distance')).toBeCloseTo(13);
    expect(val(o, 'delta')).toEqual([3, 4, 12]);
    expect(o.marks).toHaveLength(1);
    expect(o.onMesh).toBe(true);
  });
  it('a mesh point and a corner of the body, and a mesh point and an edge', async () => {
    const a = await measure([P('mp:mesh1@0,0,5'), P('v:0,0,0')], ctx());
    expect(val(a, 'distance')).toBeCloseTo(5);
    expect(a.onMesh).toBe(true);
    const b = await measure([P('x|y#0'), P('mp:scan@4,3,0')], ctx());
    expect(val(b, 'distance')).toBeCloseTo(3);
  });
  it('a mesh point against a face of the solid uses the face triangles, never the kernel', async () => {
    const mesh = { positions: [0, 0, 2, 4, 0, 2, 4, 3, 2], triFace: [0], faceIds: ['top'] };
    const kernel = vi.fn(async () => null);
    const o = await measure([P('mp:mesh1@3,1,5'), P('top')], ctx(mesh, kernel));
    expect(val(o, 'distance')).toBeCloseTo(3);
    expect(val(o, 'normalDistance')).toBeCloseTo(3);
    expect(kernel).not.toHaveBeenCalled();
    expect(o.onMesh).toBe(true);
  });
  it('a measurement without mesh points is not marked', async () => {
    expect((await measure([P('v:0,0,0'), P('v:0,0,1')], ctx())).onMesh).toBeUndefined();
  });
});

describe('the pick on a placed mesh', () => {
  /** A 10 mm cube moved to (100, 0, 0) and doubled: it spans x 100..120. */
  const rec: MeshRec = { ...meshRecFromStl(readStl(meshToStl({ positions: cube(10) }).data as Uint8Array), 'mesh1', 'Box scan', 'mm'), pos: [100, 0, 0], scale: 2 };
  it('a ray down onto the mesh gives the world point on its top, and its name measures the right height', async () => {
    expect(indexMesh(cube(10)).mesh.indices.length / 3).toBe(12);
    const h = pickMeshes([rec], { o: [110, 10, 100], d: [0, 0, -1] })!;
    expect(h.id).toBe('mesh1');
    expect(h.pos[2]).toBeCloseTo(20);
    expect(h.t).toBeCloseTo(80);
    const under = pickMeshes([rec], { o: [110, 10, -100], d: [0, 0, 1] })!;
    const o = await measure([resolvePick(meshPointName(h.id, h.pos), edges)!, resolvePick(meshPointName(under.id, under.pos), edges)!], ctx());
    expect(val(o, 'distance')).toBeCloseTo(20);
    expect(val(o, 'delta')).toEqual([0, 0, 20]);
  });
  it('a hidden mesh is not picked', () => {
    expect(pickMeshes([{ ...rec, visible: false }], { o: [110, 10, 100], d: [0, 0, -1] })).toBeNull();
  });
});
