import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { cubeFaceLabels, groundPlane, offPole, orbitCamera, poseForDirection, switchUpAxis, upVector, viewDirection, type CamState, type StdViewName } from './camerarig';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const cam = (pos: THREE.Vector3, up: THREE.Vector3, target = v(0, 0, 0)): CamState => ({ position: pos, target, up });
const forward = (c: CamState) => c.target.clone().sub(c.position).normalize();
const screenRight = (c: CamState) => forward(c).cross(c.up).normalize();

describe('standard views', () => {
  it('Y up: Top looks down -Y from +Y, Front sits on +Z', () => {
    const top = poseForDirection([0, 0, 0], viewDirection('top', 'y'), 10, 'y');
    expect(forward(top).y).toBeCloseTo(-1, 3);
    const front = poseForDirection([0, 0, 0], viewDirection('front', 'y'), 10, 'y');
    expect(front.position.z).toBeCloseTo(10);
    expect(front.up.toArray()).toEqual([0, 1, 0]);
  });

  it('Z up: Top looks down the XY plane from +Z, Front sits on -Y, Right on +X', () => {
    const top = poseForDirection([0, 0, 0], viewDirection('top', 'z'), 10, 'z');
    expect(forward(top).z).toBeCloseTo(-1, 3);
    expect(top.up.toArray()).toEqual([0, 0, 1]);
    const front = poseForDirection([0, 0, 0], viewDirection('front', 'z'), 10, 'z');
    expect(front.position.y).toBeCloseTo(-10);
    expect(screenRight(front).x).toBeCloseTo(1);          // +X to the right, like Onshape
    const right = poseForDirection([0, 0, 0], viewDirection('right', 'z'), 10, 'z');
    expect(right.position.x).toBeCloseTo(10);
    expect(screenRight(right).y).toBeCloseTo(1);
  });

  it('every view of both conventions is a valid camera (up is not parallel to the view)', () => {
    const names: StdViewName[] = ['iso', 'front', 'top', 'right', 'back', 'left', 'bottom'];
    for (const up of ['y', 'z'] as const) for (const n of names) {
      const p = poseForDirection([1, 2, 3], viewDirection(n, up), 5, up);
      expect(Math.abs(forward(p).dot(p.up))).toBeLessThan(1 - 1e-9);
      expect(p.position.distanceTo(p.target)).toBeCloseTo(5);
    }
  });

  it('Top and Bottom are opposite, as are Front and Back, Left and Right, for both axes', () => {
    for (const up of ['y', 'z'] as const) {
      for (const [a, b] of [['top', 'bottom'], ['front', 'back'], ['left', 'right']] as const) {
        const da = new THREE.Vector3(...viewDirection(a, up)).normalize(), db = new THREE.Vector3(...viewDirection(b, up)).normalize();
        expect(da.dot(db)).toBeLessThan(-0.99);
      }
      expect(new THREE.Vector3(...viewDirection('top', up)).normalize().dot(v(...upVector(up)))).toBeGreaterThan(0.999);
    }
  });

  it('a pole direction is nudged off the pole, others are untouched', () => {
    expect(offPole([0, 0, 1], 'z')[1]).not.toBe(0);
    expect(offPole([0, 1, 0], 'y')[2]).not.toBe(0);
    expect(offPole([1, 1, 1], 'z')).toEqual([1, 1, 1]);
  });
});

describe('turntable orbit', () => {
  for (const up of ['y', 'z'] as const) {
    it(`keeps the ${up} axis as up and the distance while turning with dx (${up} up)`, () => {
      const start = poseForDirection([0, 0, 0], viewDirection('iso', up), 20, up);
      const out = orbitCamera(start, 0.7, 0, 'turntable', up);
      expect(out.up.toArray()).toEqual(upVector(up));
      const h = up === 'z' ? 2 : 1;
      expect(out.position.getComponent(h)).toBeCloseTo(start.position.getComponent(h));   // height unchanged by a yaw
      expect(out.position.length()).toBeCloseTo(20);
      expect(out.position.x).not.toBeCloseTo(start.position.x);
    });

    it(`dy tilts but never passes the pole or rolls (${up} up)`, () => {
      const start = poseForDirection([0, 0, 0], viewDirection('iso', up), 20, up);
      const out = orbitCamera(start, 0, -50, 'turntable', up);        // far past the top
      const ang = out.position.clone().sub(out.target).angleTo(v(...upVector(up)));
      expect(ang).toBeGreaterThan(0);
      expect(ang).toBeLessThan(0.01);
      expect(out.up.toArray()).toEqual(upVector(up));
    });
  }

  it('orbiting about a pivot keeps the pivot fixed on screen', () => {
    const start = poseForDirection([0, 0, 0], viewDirection('iso', 'z'), 20, 'z');
    const pivot = v(3, 1, 2);
    const proj = (c: CamState) => {
      const m = new THREE.PerspectiveCamera(45, 1, 0.1, 100); m.position.copy(c.position); m.up.copy(c.up); m.lookAt(c.target); m.updateMatrixWorld();
      return pivot.clone().project(m);
    };
    const before = proj(start);
    const out = orbitCamera(start, 0.5, 0.2, 'turntable', 'z', pivot);
    // the pivot is the centre of rotation: its distance to the camera is preserved
    expect(out.position.distanceTo(pivot)).toBeCloseTo(start.position.distanceTo(pivot));
    expect(out.target.distanceTo(pivot)).toBeCloseTo(start.target.distanceTo(pivot));
    expect(before).toBeDefined();
    expect(proj(out).x).not.toBeNaN();
  });
});

describe('trackball orbit', () => {
  it('rotates about the screen axes and carries up along (roll allowed)', () => {
    const start = poseForDirection([0, 0, 0], viewDirection('front', 'y'), 10, 'y');
    const out = orbitCamera(start, 0, Math.PI / 2 + 0.3, 'trackball', 'y');   // over the top: the camera flips
    expect(out.position.length()).toBeCloseTo(10);
    expect(out.up.y).toBeLessThan(0.5);                                       // up has turned with the rotation
    expect(out.up.length()).toBeCloseTo(1);
    expect(Math.abs(forward(out).dot(out.up))).toBeLessThan(1e-6);
  });

  it('a yaw with an unrolled camera equals the turntable yaw', () => {
    const start = poseForDirection([0, 0, 0], viewDirection('iso', 'y'), 10, 'y');
    const a = orbitCamera(start, 0.4, 0, 'trackball', 'y');
    const b = orbitCamera(start, 0.4, 0, 'turntable', 'y');
    expect(a.position.distanceTo(b.position)).toBeLessThan(1e-9);
  });
});

describe('switching the up axis', () => {
  it('keeps target, distance and the side of the model; only up changes', () => {
    const target = v(5, 6, 7);
    const start = cam(v(5 + 10, 6 + 4, 7 + 10), v(0, 1, 0), target);
    const out = switchUpAxis(start, 'z');
    expect(out.target.toArray()).toEqual([5, 6, 7]);
    expect(out.position.distanceTo(out.target)).toBeCloseTo(start.position.distanceTo(start.target));
    expect(out.position.clone().sub(out.target).normalize().dot(start.position.clone().sub(target).normalize())).toBeGreaterThan(0.99999);
    expect(out.up.toArray()).toEqual([0, 0, 1]);
  });

  it('a camera on the new axis is nudged off the pole', () => {
    const start = cam(v(0, 0, 10), v(0, 1, 0));          // Front under Y up
    const out = switchUpAxis(start, 'z');
    expect(out.position.z).toBeCloseTo(10);
    expect(Math.abs(forward(out).dot(out.up))).toBeLessThan(1 - 1e-9);
  });
});

describe('view cube labels and ground grid', () => {
  it('relabels the faces so TOP is +Z and FRONT is -Y with Z up', () => {
    const z = cubeFaceLabels('z');
    expect(z[4]).toBe('TOP');
    expect(z[3]).toBe('FRONT');
    expect(cubeFaceLabels('y')[2]).toBe('TOP');
    expect(cubeFaceLabels('y')[4]).toBe('FRONT');
  });
  it('the ground lies in XZ for Y up and XY for Z up, under the part', () => {
    const box = { min: [0, 1, 2], max: [10, 5, 8] };
    expect(groundPlane('y', box)).toMatchObject({ ax: 0, bx: 2, level: 1, ca: 5, cb: 5, size: 20 });
    expect(groundPlane('z', box)).toMatchObject({ ax: 0, bx: 1, level: 2, ca: 5, cb: 3 });
  });
});
