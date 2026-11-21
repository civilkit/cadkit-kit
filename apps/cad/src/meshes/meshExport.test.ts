import { describe, expect, it } from 'vitest';
import { indexMesh, parseGlb, parseThreeMf, readGlb, readObj, readStl, readThreeMf } from '@kit/io';
import { cube } from '../../../../packages/io/src/testmesh';
import { exportGlb, exportObj, exportStl, exportThreeMf } from '../exportFiles';
import { meshRecFromArrays, type MeshRec } from './meshDoc';
import { mergeTriangles, refMeshBodies, refMeshPositions } from './meshExport';

/** A 1 mm cube as a reference mesh, placed: scaled by 2, turned 90 degrees about Z, moved to (10, 20, 30). */
function placedCube(over: Partial<MeshRec> = {}): MeshRec {
  const rec = meshRecFromArrays(indexMesh(cube()).mesh, { id: 'mesh1', name: 'Ref cube', unit: 'mm', watertight: true, color: '#3366cc' });
  return { ...rec, pos: [10, 20, 30], rot: [0, 0, 90], scale: 2, ...over };
}
/** Its world box: x from 10 - 2 to 10, y 20 to 22, z 30 to 32. */
const PLACED = { min: [8, 20, 30], max: [10, 22, 32] };

function boxOf(p: ArrayLike<number>): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i++) { const c = i % 3; min[c] = Math.min(min[c], p[i]); max[c] = Math.max(max[c], p[i]); }
  return { min, max };
}
const close = (a: number[], b: number[], tol = 1e-3) => a.forEach((x, i) => expect(Math.abs(x - b[i]), `${a} vs ${b}`).toBeLessThan(tol));

describe('reference meshes as export bodies', () => {
  it('apply the placement: every triangle in world coordinates', () => {
    const p = refMeshPositions(placedCube());
    expect(p.length).toBe(12 * 9);
    const b = boxOf(p);
    close(b.min, PLACED.min, 1e-5);
    close(b.max, PLACED.max, 1e-5);
  });
  it('one body per shown record, named and coloured as in the tree; hidden ones are left out', () => {
    const bodies = refMeshBodies([placedCube(), placedCube({ id: 'mesh2', name: 'Hidden', visible: false }), placedCube({ id: 'mesh3', name: 'Scan', pos: [0, 0, 0] })]);
    expect(bodies.map((b) => b.name)).toEqual(['Ref cube', 'Scan']);
    expect(bodies[0].color).toBe('#3366cc');
    expect(bodies.map((b) => b.positions.length / 9)).toEqual([12, 12]);
  });
  it('merge after the part, in order; nothing at all is null', () => {
    const refs = refMeshBodies([placedCube()]);
    const m = mergeTriangles({ positions: cube() }, refs)!;
    expect(m.positions.length / 9).toBe(24);
    expect(Array.from(m.positions.subarray(0, 9))).toEqual(Array.from(cube().subarray(0, 9)));
    expect(Array.from(m.positions.subarray(108))).toEqual(Array.from(refs[0].positions));
    expect(mergeTriangles(null, refs)!.positions.length / 9).toBe(12);
    expect(mergeTriangles(null, [])).toBeNull();
    expect(mergeTriangles({ positions: [] }, [])).toBeNull();
  });
});

describe('exports with reference meshes (no kernel)', () => {
  const refs = refMeshBodies([placedCube()]);
  const part = { positions: cube() };
  const UNION = { min: [0, 0, 0], max: PLACED.max };

  it('without the choice nothing changes', () => {
    const a = exportStl(part, 'P'), b = exportStl(part, 'P', true, []);
    expect(b.notices).toEqual(a.notices);
    expect(Array.from(b.file!.data as Uint8Array)).toEqual(Array.from(a.file!.data as Uint8Array));
  });

  it('STL: the reference triangles are extra triangles; reads back with the same count and box', () => {
    const r = exportStl(part, 'P', true, refs);
    expect(r.notices.map((n) => n.key)).toEqual(['io.done', 'io.refMeshesIncluded']);
    expect(r.notices[1].params).toMatchObject({ count: 1, triangles: 12 });
    const back = readStl(r.file!.data as Uint8Array);
    expect(back.triangles).toBe(24);
    close(back.bbox.min, UNION.min); close(back.bbox.max, UNION.max);
    const ascii = readStl(new TextEncoder().encode(exportStl(part, 'P', false, refs).file!.data as string));
    expect(ascii.triangles).toBe(24);
  });

  it('OBJ: the reference mesh is its own named object', () => {
    const r = exportObj(part, 'P', null, refs);
    const text = String(r.file!.data);
    expect(text.match(/^o .*/gm)).toEqual(['o P', 'o Ref_cube']);
    const back = readObj(text);
    expect(back.triangles).toBe(24);
    close(back.bbox.min, UNION.min); close(back.bbox.max, UNION.max);
  });

  it('3MF: an extra named object', async () => {
    const r = await exportThreeMf([{ name: 'Body 1', positions: cube() }], 'P', refs);
    expect(r.notices[0]).toMatchObject({ key: 'io.done3mf', params: { triangles: 24, bodies: 2 } });
    const bytes = r.file!.data as Uint8Array;
    expect((await parseThreeMf(bytes)).objects.map((o) => o.name)).toEqual(['Body 1', 'Ref cube']);
    const back = await readThreeMf(bytes);
    expect(back.triangles).toBe(24);
    close(back.bbox.min, UNION.min); close(back.bbox.max, UNION.max);
  });

  it('GLB: an extra named node; reads back in millimetres, Z up', () => {
    const r = exportGlb([{ name: 'Body 1', positions: cube() }], 'P', refs);
    const bytes = r.file!.data as Uint8Array;
    expect(parseGlb(bytes).bodies.map((b) => b.name)).toEqual(['Body 1', 'Ref cube']);
    const back = readGlb(bytes);
    expect(back.triangles).toBe(24);
    close(back.bbox.min, UNION.min); close(back.bbox.max, UNION.max);
  });

  it('a part with no solid exports its reference meshes alone, in every mesh format', async () => {
    const stl = exportStl(null, 'Only scan', true, refs);
    expect(readStl(stl.file!.data as Uint8Array).triangles).toBe(12);
    const obj = exportObj(null, 'Only scan', null, refs);
    expect(readObj(String(obj.file!.data)).triangles).toBe(12);
    const tmf = await exportThreeMf([], 'Only scan', refs);
    expect((await readThreeMf(tmf.file!.data as Uint8Array)).triangles).toBe(12);
    const glb = exportGlb(null, 'Only scan', refs);
    const g = readGlb(glb.file!.data as Uint8Array);
    expect(g.triangles).toBe(12);
    close(g.bbox.min, PLACED.min); close(g.bbox.max, PLACED.max);
    // and with neither, the usual no-solid error
    expect(exportStl(null, 'x', true, []).notices).toEqual([{ level: 'error', key: 'io.noBody' }]);
    expect(exportObj(null, 'x', null, []).file).toBeUndefined();
  });

  it('an open scan does not make the part look leaky: the watertight check is the part\'s', () => {
    const open = refMeshBodies([placedCube()]).map((b) => ({ ...b, positions: (b.positions as Float32Array).subarray(9) }));
    expect(exportStl(part, 'P', true, open).notices.some((n) => n.key === 'io.notWatertight')).toBe(false);
    expect(exportStl({ positions: cube().subarray(9) }, 'P', true, refs).notices.some((n) => n.key === 'io.notWatertight')).toBe(true);
  });
});
