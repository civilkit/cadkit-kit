/**
 * Replaces what OrbitControls does with a rotate drag, without touching how drags are mapped to buttons: the controls
 * still turn pointer movement into rotate angles, this rig collects those angles and applies them with `orbitCamera`
 * (turntable about the up axis or free trackball, about the model centre or a pivot point). Pan and zoom stay with
 * the controls.
 */
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { orbitCamera, upVector, type OrbitMode, type OrbitPivot, type UpAxis } from './camerarig';

type Internals = {
  _rotateLeft(angle: number): void; _rotateUp(angle: number): void;
  _quat: THREE.Quaternion; _quatInverse: THREE.Quaternion;
  update(dt?: number | null): boolean;
};

export interface RigHost {
  /** The point on the model under a client position, or null. */
  pickPoint(x: number, y: number): THREE.Vector3 | null;
  /** The middle of the current selection, or null. */
  selectionCentre(): THREE.Vector3 | null;
}

export class OrbitRig {
  upAxis: UpAxis = 'y';
  mode: OrbitMode = 'turntable';
  pivot: OrbitPivot = 'centre';
  private theta = 0;
  private phi = 0;
  private fixed: THREE.Vector3 | null = null;

  constructor(private readonly camera: THREE.PerspectiveCamera, private readonly controls: OrbitControls, private readonly dom: HTMLElement, private readonly host: RigHost) {
    const c = controls as unknown as Internals;
    c._rotateLeft = (angle) => { this.theta -= angle; };
    c._rotateUp = (angle) => { this.phi -= angle; };
    const update = c.update.bind(c);
    c.update = (dt) => {
      this.applyPending();
      this.syncControls();
      return update(dt);
    };
    dom.addEventListener('pointerdown', this.onDown, true);
  }

  /** Where the pivot of the drag that is starting is, decided at the press. */
  private onDown = (e: PointerEvent): void => {
    this.fixed = null;
    if (this.pivot === 'cursor') this.fixed = this.host.pickPoint(e.clientX, e.clientY);
    else if (this.pivot === 'selection') this.fixed = this.host.selectionCentre();
  };

  /** Turn by the view cube's drag: same rotation as the main view, about the model centre. */
  orbitBy(dx: number, dy: number, speed = 0.012): void {
    this.fixed = null;
    this.theta -= dx * speed;
    this.phi -= dy * speed;
    this.controls.update();
  }

  /** The controls' own "up" space follows the up axis (turntable) or the camera (trackball). */
  syncControls(): void {
    const c = this.controls as unknown as Internals;
    const up = this.mode === 'trackball' ? this.camera.up.clone().normalize() : new THREE.Vector3(...upVector(this.upAxis));
    c._quat.setFromUnitVectors(up, new THREE.Vector3(0, 1, 0));
    c._quatInverse.copy(c._quat).invert();
  }

  private applyPending(): void {
    const { theta, phi } = this;
    this.theta = this.phi = 0;
    if (!theta && !phi) return;
    const s = orbitCamera(
      { position: this.camera.position, target: this.controls.target, up: this.camera.up },
      theta, phi, this.mode, this.upAxis, this.fixed ?? undefined,
    );
    this.camera.position.copy(s.position);
    this.controls.target.copy(s.target);
    this.camera.up.copy(s.up);
  }

  dispose(): void { this.dom.removeEventListener('pointerdown', this.onDown, true); }
}
