import { describe, expect, it } from 'vitest';
import { meshToStl, readStl } from '@kit/io';
import { headLike } from '../../../../packages/io/src/testmesh';
import { allWorldBox, decode, matrixOf, meshRecFromStl, meshesOf, nearestOnMeshes, nextMeshId, pickMeshes, projectAlong, readMeshes, toLocal, toWorld, worldBox, type MeshRec } from './meshDoc';

const headRec = (n = 48, unit: 'mm' | 'cm' = 'mm'): MeshRec => meshRecFromStl(readStl(meshToStl({ positions: headLike(n, n) }, { binary: true }).data as Uint8Array, { unit }), 'mesh1', 'Head', unit);

describe('mesh records', () => {
  const rec = headRec();
  it('survive JSON (the .ckpart text) and decode to the same geometry', () => {
    const back = readMeshes(JSON.parse(JSON.stringify([rec])));
    expect(back).toHaveLength(1);
    expect(back[0]).toEqual(rec);
    const d = decode(back[0]);
    expect(d.mesh.indices.length / 3).toBe(rec.tris);
    expect(d.mesh.vertices.length / 3).toBe(rec.verts);
    expect(rec.watertight).toBe(true);
    expect(d.box.max[2]).toBeGreaterThan(95);
  });
  it('a bad record is dropped and a bad number takes its default', () => {
    const good = JSON.parse(JSON.stringify(rec));
    good.opacity = 'x'; good.pos = [1, 'a', 3]; good.scale = -4; good.unit = 'furlong'; good.color = 'red';
    const out = readMeshes([null, 5, { id: 'q' }, good]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ opacity: 1, pos: [0, 0, 0], unit: 'mm', color: '#c9b8a6' });
    expect(out[0].scale).toBeGreaterThan(0);
    expect(readMeshes(undefined)).toEqual([]);
    expect(meshesOf({ meshes: [rec] })).toHaveLength(1);
  });
  it('ids do not collide', () => expect(nextMeshId([rec, { ...rec, id: 'mesh2' }])).toBe('mesh3'));
});

describe('placement', () => {
  const base = headRec();
  it('world <-> local is an inverse for rotation, scale and move', () => {
    const m = { ...base, pos: [10, -20, 30] as [number, number, number], rot: [20, 35, -50] as [number, number, number], scale: 2.5 };
    const p: [number, number, number] = [3, 4, 5];
    const back = toLocal(m, toWorld(m, p));
    back.forEach((v, i) => expect(v).toBeCloseTo(p[i], 9));
  });
  it('the matrix agrees with toWorld', () => {
    const m = { pos: [1, 2, 3] as [number, number, number], rot: [10, 20, 30] as [number, number, number], scale: 1.5 };
    const e = matrixOf(m), p = [4, -5, 6];
    const w = toWorld(m, p as never);
    for (let r = 0; r < 3; r++) expect(e[r] * p[0] + e[4 + r] * p[1] + e[8 + r] * p[2] + e[12 + r]).toBeCloseTo(w[r], 9);
  });
  it('90 degrees about X sends +Y to +Z', () => {
    const w = toWorld({ pos: [0, 0, 0], rot: [90, 0, 0], scale: 1 }, [0, 1, 0]);
    expect(w[1]).toBeCloseTo(0, 9); expect(w[2]).toBeCloseTo(1, 9);
  });
  it('the world box follows the transform', () => {
    const b0 = worldBox(base);
    const moved = worldBox({ ...base, pos: [100, 0, 0], scale: 2 });
    expect(moved.max[0]).toBeCloseTo(100 + 2 * b0.max[0], 4);
    expect(allWorldBox([{ ...base, visible: false }])).toBeNull();
    expect(allWorldBox([base])!.max[2]).toBeCloseTo(b0.max[2], 6);
  });
});

describe('picking and snapping', () => {
  const rec = headRec(64);
  it('a ray down onto the top of the head hits the surface and gives an outward normal', () => {
    const h = pickMeshes([rec], { o: [0, 0, 500], d: [0, 0, -1] })!;
    expect(h.pos[2]).toBeGreaterThan(95);
    expect(h.pos[2]).toBeLessThan(110);
    expect(h.normal[2]).toBeGreaterThan(0.9);
    expect(h.id).toBe('mesh1');
  });
  it('the transform moves the hit; a hidden mesh is not picked', () => {
    const up = { ...rec, pos: [0, 0, 200] as [number, number, number] };
    expect(pickMeshes([up], { o: [0, 0, 500], d: [0, 0, -1] })!.pos[2]).toBeGreaterThan(295);
    expect(pickMeshes([{ ...rec, visible: false }], { o: [0, 0, 500], d: [0, 0, -1] })).toBeNull();
  });
  it('a scaled and rotated mesh is hit where its surface is', () => {
    const m = { ...rec, rot: [90, 0, 0] as [number, number, number], scale: 2 };   // top of head (+Z) now points along -Y
    const h = pickMeshes([m], { o: [0, -900, 0], d: [0, 1, 0] })!;
    expect(h.pos[1]).toBeLessThan(-190);
    expect(h.normal[1]).toBeLessThan(-0.9);
  });
  it('nearest point and projection along a direction land on the surface', () => {
    const n = nearestOnMeshes([rec], [0, 0, 300])!;
    expect(n.pos[2]).toBeGreaterThan(95);
    const h = pickMeshes([rec], { o: [20, 10, 500], d: [0, 0, -1] })!;
    const p = projectAlong([rec], [20, 10, 300], [0, 0, 1])!;
    expect(p.pos[2]).toBeCloseTo(h.pos[2], 4);
    expect(projectAlong([rec], [900, 900, 0], [0, 0, 1])).toBeNull();
    expect(nearestOnMeshes([rec], [0, 0, 300], 5)).toBeNull();
  });
});
