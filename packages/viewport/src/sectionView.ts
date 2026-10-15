// The three.js side of the section view: clipping planes on the body and its edges, and the cap that closes the cut.
// The cap is the stencil technique of three.js' webgl_clipping_stencil example: the clipped body is drawn twice with
// colour off (back faces count up, front faces count down), so the stencil is non-zero exactly where the plane cuts
// through solid; a plane quad is then drawn where the stencil is non-zero. The renderer needs `stencil: true`.
import * as THREE from 'three';
import { capFrame, clipPlane, type SectionSpec } from './section';

export class SectionView {
  private group: THREE.Group | null = null;
  private plane: THREE.Plane | null = null;
  private clipped: THREE.Object3D[] = [];

  constructor(private readonly scene: THREE.Scene, private readonly renderer: THREE.WebGLRenderer) {}

  get active(): boolean { return this.plane !== null; }

  /** Show the cut, or (spec null) remove it. Call again after the body was rebuilt: `mesh` / `edges` are the new objects. */
  set(spec: SectionSpec | null, mesh: THREE.Mesh | null, edges: THREE.Object3D | null, box: { min: number[]; max: number[] } | null): void {
    this.clear();
    if (!spec) return;
    const c = clipPlane(spec);
    this.plane = new THREE.Plane(new THREE.Vector3(...c.normal), c.constant);
    this.renderer.localClippingEnabled = true;
    for (const o of [mesh, edges] as Array<THREE.Object3D | null>) {
      if (!o) continue;
      ((o as THREE.Mesh).material as THREE.Material).clippingPlanes = [this.plane];
      ((o as THREE.Mesh).material as THREE.Material).needsUpdate = true;
      this.clipped.push(o);
    }
    if (!mesh || !box) return;
    const group = new THREE.Group();
    group.userData.pickable = false;
    const stencil = (side: THREE.Side, op: THREE.StencilOp) => {
      const m = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({
        side, clippingPlanes: [this.plane!], depthWrite: false, depthTest: false, colorWrite: false,
        stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, stencilFail: op, stencilZFail: op, stencilZPass: op,
      }));
      m.renderOrder = 1; m.userData.pickable = false;
      return m;
    };
    group.add(stencil(THREE.BackSide, THREE.IncrementWrapStencilOp), stencil(THREE.FrontSide, THREE.DecrementWrapStencilOp));
    const f = capFrame(spec, box);
    const cap = new THREE.Mesh(new THREE.PlaneGeometry(f.size, f.size), new THREE.MeshStandardMaterial({
      color: 0xd9822b, metalness: 0.1, roughness: 0.8, side: THREE.DoubleSide,
      stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc,
      stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp,
    }));
    cap.position.set(...f.center);
    cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...spec.normal));
    cap.renderOrder = 1.1; cap.userData.pickable = false;
    cap.onAfterRender = (r) => r.clearStencil();
    group.add(cap);
    this.group = group;
    this.scene.add(group);
  }

  /** Remove the clipping and the cap. */
  clear(): void {
    for (const o of this.clipped) { ((o as THREE.Mesh).material as THREE.Material).clippingPlanes = null; ((o as THREE.Mesh).material as THREE.Material).needsUpdate = true; }
    this.clipped = [];
    this.plane = null;
    if (this.group) {
      this.scene.remove(this.group);
      this.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.geometry !== undefined) { (m.material as THREE.Material).dispose(); if (m.geometry.type === 'PlaneGeometry') m.geometry.dispose(); } });
      this.group = null;
    }
  }
}
