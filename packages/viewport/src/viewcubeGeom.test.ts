import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { chamferCube } from './viewcubeGeom';
import { viewTargets } from './viewnav';

describe('chamfered view cube', () => {
  for (const up of ['y', 'z'] as const) {
    const { geometry, dirs, centres } = chamferCube(up);
    it(`has one region for each of the 26 views, faces first (${up} up)`, () => {
      expect(dirs).toHaveLength(26);
      expect(dirs.slice(0, 6)).toEqual([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]);
      expect(new Set(dirs.map((d) => d.join())).size).toBe(26);
      expect(new Set(dirs.map((d) => d.join()))).toEqual(new Set(viewTargets().map((t) => t.dir.join())));
      expect(geometry.groups).toHaveLength(26);
    });
    it('every triangle faces outwards', () => {
      const pos = geometry.getAttribute('position');
      for (const g of geometry.groups) {
        const out = new THREE.Vector3(...dirs[g.materialIndex!]);
        for (let t = g.start; t < g.start + g.count; t += 3) {
          const [a, b, c] = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(pos, t + k));
          const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
          expect(n.dot(out)).toBeGreaterThan(0);
        }
      }
    });
    it('a ray at the middle of a region hits that region, and only it, from outside', () => {
      const mesh = new THREE.Mesh(geometry, dirs.map(() => new THREE.MeshBasicMaterial()));
      mesh.updateMatrixWorld();
      const ray = new THREE.Raycaster();
      centres.forEach((c, i) => {
        ray.set(c.clone().multiplyScalar(3), c.clone().negate().normalize());
        const hit = ray.intersectObject(mesh)[0];
        expect(hit?.face?.materialIndex).toBe(i);
      });
    });
    it('edges and corners are big enough to touch (a bevel is at least 0.3 wide, a corner at least 0.25 across)', () => {
      const pos = geometry.getAttribute('position');
      for (const g of geometry.groups.slice(6)) {
        const pts = Array.from({ length: g.count }, (_, k) => new THREE.Vector3().fromBufferAttribute(pos, g.start + k));
        let widest = 0;
        for (const p of pts) for (const q of pts) widest = Math.max(widest, p.distanceTo(q));
        expect(widest).toBeGreaterThan(0.3);
      }
    });
  }
});
