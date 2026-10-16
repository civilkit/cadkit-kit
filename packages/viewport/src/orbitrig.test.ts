import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { OrbitRig } from './orbitrig';
import { poseForDirection, viewDirection } from './camerarig';

function setup(up: 'y' | 'z') {
  const dom = document.createElement('div');
  Object.assign(dom, { setPointerCapture: () => {}, releasePointerCapture: () => {} });
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  const pose = poseForDirection([0, 0, 0], viewDirection('iso', up), 30, up);
  camera.position.copy(pose.position); camera.up.copy(pose.up); camera.lookAt(0, 0, 0);
  const controls = new OrbitControls(camera, dom);
  const picked = new THREE.Vector3(4, 0, 0);
  const rig = new OrbitRig(camera, controls, dom, { pickPoint: () => picked.clone(), selectionCentre: () => new THREE.Vector3(0, 2, 0) });
  rig.upAxis = up; rig.syncControls();
  return { camera, controls, rig, dom };
}
const rotate = (controls: OrbitControls, left: number, up: number) => {
  const c = controls as unknown as { _rotateLeft(a: number): void; _rotateUp(a: number): void };
  c._rotateLeft(left); c._rotateUp(up); controls.update();
};

describe('OrbitRig on real OrbitControls', () => {
  for (const up of ['y', 'z'] as const) {
    it(`a left/right drag spins about the ${up} axis: height and distance stay, up stays (turntable)`, () => {
      const { camera, controls } = setup(up);
      const h = up === 'z' ? 2 : 1;
      const before = camera.position.clone();
      rotate(controls, 0.6, 0);
      expect(camera.position.getComponent(h)).toBeCloseTo(before.getComponent(h));
      expect(camera.position.length()).toBeCloseTo(before.length());
      expect(camera.position.distanceTo(before)).toBeGreaterThan(1);
      expect(camera.up.getComponent(h)).toBeCloseTo(1);
    });
  }

  it('trackball lets the camera roll over the pole', () => {
    const { camera, controls, rig } = setup('y');
    rig.mode = 'trackball'; rig.syncControls();
    rotate(controls, 0, -2.5);
    expect(camera.up.y).toBeLessThan(0);
    expect(Math.abs(camera.position.clone().normalize().dot(camera.up))).toBeLessThan(0.9);
  });

  it('pivot on the cursor point keeps that point at the same distance from the camera', () => {
    const { camera, controls, rig, dom } = setup('z');
    rig.pivot = 'cursor';
    dom.dispatchEvent(new Event('pointerdown'));
    const p = new THREE.Vector3(4, 0, 0);
    const d0 = camera.position.distanceTo(p);
    rotate(controls, 0.5, 0.2);
    expect(camera.position.distanceTo(p)).toBeCloseTo(d0);
    expect(controls.target.distanceTo(p)).toBeCloseTo(new THREE.Vector3(0, 0, 0).distanceTo(p));
  });

  it('the view cube orbit uses the same rotation', () => {
    const { camera, rig } = setup('z');
    const before = camera.position.clone();
    rig.orbitBy(20, 0);
    expect(camera.position.z).toBeCloseTo(before.z);
    expect(camera.position.distanceTo(before)).toBeGreaterThan(1);
  });
});
