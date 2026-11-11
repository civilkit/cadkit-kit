import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MeshLayer, type MeshView } from './meshlayer';

const tri = (id: string, over: Partial<MeshView> = {}): MeshView => ({
  id, key: id + '|1', vertices: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]), indices: Uint32Array.from([0, 1, 2, 1, 3, 2]),
  matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1], color: '#c9b8a6', opacity: 1, wire: false, ...over,
});

describe('MeshLayer', () => {
  it('builds one indexed geometry per mesh and shares the arrays', () => {
    const l = new MeshLayer();
    const m = tri('a');
    expect(l.set([m])).toBe(true);
    const g = l.group.children[0] as THREE.Group;
    const geo = (g.children[0] as THREE.Mesh).geometry;
    expect(geo.getAttribute('position').array).toBe(m.vertices);
    expect(geo.getIndex()!.count).toBe(6);
    expect(geo.getAttribute('normal')).toBeDefined();
    expect(g.matrix.elements[12]).toBe(5);
  });
  it('a change of look keeps the geometry; a new key rebuilds it; a missing id is dropped', () => {
    const l = new MeshLayer();
    l.set([tri('a')]);
    const first = ((l.group.children[0] as THREE.Group).children[0] as THREE.Mesh).geometry;
    l.set([tri('a', { opacity: 0.4, wire: true })]);
    const solid = (l.group.children[0] as THREE.Group).children[0] as THREE.Mesh;
    const wire = (l.group.children[0] as THREE.Group).children[1] as THREE.Mesh;
    expect(solid.geometry).toBe(first);
    expect((solid.material as THREE.MeshStandardMaterial).transparent).toBe(true);
    expect((solid.material as THREE.MeshStandardMaterial).depthWrite).toBe(false);
    expect(wire.visible).toBe(true);
    l.set([tri('a', { key: 'a|2' })]);
    expect(((l.group.children[0] as THREE.Group).children[0] as THREE.Mesh).geometry).not.toBe(first);
    l.set([]);
    expect(l.group.children).toHaveLength(0);
  });
  it('never takes part in three.js picking', () => {
    const l = new MeshLayer();
    l.set([tri('a')]);
    const hits: THREE.Intersection[] = [];
    new THREE.Raycaster(new THREE.Vector3(0.2, 0.2, 5), new THREE.Vector3(0, 0, -1)).intersectObject(l.group, true, hits);
    expect(hits).toHaveLength(0);
  });
  it('runs of one material become geometry groups with a material each; opacity multiplies; translucent runs do not write depth', () => {
    const l = new MeshLayer();
    const groups = [{ start: 0, count: 1, color: '#ff0000', opacity: 1 }, { start: 1, count: 1, color: '#0000ff', opacity: 0.4 }];
    l.set([tri('a', { groups, opacity: 0.5 })]);
    const solid = (l.group.children[0] as THREE.Group).children[0] as THREE.Mesh;
    expect(Array.isArray(solid.material)).toBe(true);
    const mats = solid.material as THREE.MeshStandardMaterial[];
    expect(solid.geometry.groups).toEqual([{ start: 0, count: 3, materialIndex: 0 }, { start: 3, count: 3, materialIndex: 1 }]);
    expect(mats.map((m) => m.color.getHexString())).toEqual(['ff0000', '0000ff']);
    expect(mats.map((m) => +m.opacity.toFixed(2))).toEqual([0.5, 0.2]);
    expect(mats.map((m) => m.depthWrite)).toEqual([false, false]);
    l.set([tri('a', { groups, opacity: 1 })]);
    expect(mats.map((m) => [m.opacity, m.transparent, m.depthWrite])).toEqual([[1, false, true], [0.4, true, false]]);
    l.set([]);
  });
});
