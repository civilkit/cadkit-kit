// Reference meshes (an imported STL) in the viewport: one indexed THREE mesh each, shaded, optionally translucent and with its triangle
// edges, placed by a 4 x 4 matrix. The vertex and index arrays are shared with the caller (no copy); normals are computed once per
// geometry. Never picked by the body picker: the app asks the mesh's own BVH.
import * as THREE from 'three';

export interface MeshView {
  id: string;
  /** changes when the vertex or index arrays do: the geometry is rebuilt then, and only then */
  key: string;
  vertices: Float32Array;
  indices: Uint32Array;
  /** column-major local -> world */
  matrix: number[];
  /** `#rrggbb` */
  color: string;
  /** 0 to 1 */
  opacity: number;
  wire: boolean;
  selected?: boolean;
  /** one entry per run of triangles of the same material (a SketchUp import): triangles `start` .. `start + count`, drawn in `color` at `opacity` (times the mesh's). Absent: the whole mesh in `color`. Fixed for a `key`. */
  groups?: ReadonlyArray<{ start: number; count: number; color: string; opacity: number }>;
  /** world box, for framing */
  box?: { min: number[]; max: number[] };
}

interface Item { key: string; geo: THREE.BufferGeometry; solid: THREE.Mesh; wire: THREE.Mesh; group: THREE.Group; mats: THREE.MeshStandardMaterial[] }

export class MeshLayer {
  readonly group = new THREE.Group();
  private items = new Map<string, Item>();

  constructor() { this.group.name = 'reference-meshes'; }

  /** Show exactly these meshes. Returns whether anything changed on screen. */
  set(list: readonly MeshView[]): boolean {
    let changed = false;
    const keep = new Set(list.map((m) => m.id));
    for (const [id, it] of this.items) if (!keep.has(id)) { this.drop(it); this.items.delete(id); changed = true; }
    for (const m of list) {
      let it = this.items.get(m.id);
      if (it && it.key !== m.key) { this.drop(it); this.items.delete(m.id); it = undefined; }
      if (!it) { it = this.make(m); this.items.set(m.id, it); }
      changed = true;
      it.group.matrix.fromArray(m.matrix);
      it.group.matrixWorldNeedsUpdate = true;
      it.mats.forEach((solid, k) => {
        const g = m.groups?.[k];
        const op = (g ? g.opacity : 1) * m.opacity;
        solid.color.set(g ? g.color : m.color);
        solid.opacity = op;
        solid.transparent = op < 1;
        solid.depthWrite = op >= 1;
        solid.emissive.set(m.selected ? '#223a5e' : '#000000');
        solid.needsUpdate = true;
      });
      it.wire.visible = m.wire;
      (it.wire.material as THREE.MeshBasicMaterial).opacity = Math.min(1, 0.25 + 0.5 * m.opacity);
    }
    return changed;
  }

  private make(m: MeshView): Item {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(m.vertices, 3));
    geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mk = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    // a material per run of triangles: three.js draws each geometry group with its own material (and sorts the translucent ones apart)
    const mats = m.groups?.length ? m.groups.map((g) => mk(g.color)) : [mk(m.color)];
    if (m.groups?.length) m.groups.forEach((g, k) => geo.addGroup(g.start * 3, g.count * 3, k));
    const solid = new THREE.Mesh(geo, m.groups?.length ? mats : mats[0]);
    const wm = new THREE.MeshBasicMaterial({ color: '#2b2b2b', wireframe: true, transparent: true, opacity: 0.6 });
    const wire = new THREE.Mesh(geo, wm);
    wire.visible = false;
    for (const o of [solid, wire]) { o.raycast = () => { /* picked through the BVH, not by three.js */ }; o.frustumCulled = false; }
    const group = new THREE.Group();
    group.matrixAutoUpdate = false;
    group.add(solid, wire);
    this.group.add(group);
    return { key: m.key, geo, solid, wire, group, mats };
  }

  private drop(it: Item): void {
    this.group.remove(it.group);
    it.geo.dispose();
    for (const m of it.mats) m.dispose();
    (it.wire.material as THREE.Material).dispose();
  }

  dispose(): void { for (const it of this.items.values()) this.drop(it); this.items.clear(); }
}
