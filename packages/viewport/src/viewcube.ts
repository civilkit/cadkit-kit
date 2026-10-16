/**
 * Orientation view cube: a small cube in the corner of the viewport that follows the camera. Drag it to orbit the
 * main view, click a face, edge or corner to snap to that view; the +X, +Y and +Z axis arms are labelled and coloured.
 *
 * Ported from CivilKit's `viewcube.js` / `viewcubeui.js` (the same owner's code), adapted to this viewport: Y is up by default
 * (front looks along -Z from +Z; with Z up the faces are relabelled, see camerarig.ts), the colours come from the app's theme, and the cube owns its own canvas so the host
 * only supplies the camera, an orbit step and a way to snap. The face labels read RIGHT, LEFT, TOP, BOT, FRONT, BACK
 * in the order of BoxGeometry's materials (+x, -x, +y, -y, +z, -z).
 */
import * as THREE from 'three';
import { cubeFaceLabels, type UpAxis } from './camerarig';

export type Dir = [number, number, number];

/** A click in the outer 0.3 of a face reaches the edge or corner: those snap to a diagonal view. */
const ZONE = 0.45;

/** The view direction (from the target towards the camera) for a point on the cube, in the cube's local frame. */
export function zoneOf(p: { x: number; y: number; z: number }): Dir {
  const s = (v: number) => (Math.abs(v) > ZONE ? Math.sign(v) : 0);
  return [s(p.x), s(p.y), s(p.z)];
}

export interface ViewCubeOptions {
  /** Canvas size in CSS pixels. */
  size?: number;
  /** Snap the main camera to look from this direction (a unit-ish axis or diagonal). */
  snapTo(dir: Dir): void;
  /** Orbit the main camera by a pointer drag of dx, dy pixels. */
  orbit(dx: number, dy: number): void;
  /** The host should redraw (the hover marker moved, a drag orbited). */
  onChange(): void;
}


export class ViewCube {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly cam = new THREE.PerspectiveCamera(40, 1, 0.1, 20);
  private readonly cube: THREE.Mesh;
  private readonly hoverDot: THREE.Mesh;
  private readonly raycaster = new THREE.Raycaster();
  private upAxis: UpAxis = 'y';
  private dragging = false;
  private moved = false;
  private last = { x: 0, y: 0 };

  constructor(private readonly host: HTMLElement, private readonly opts: ViewCubeOptions) {
    const size = opts.size ?? 112;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'viewcube';
    this.canvas.setAttribute('aria-label', 'Camera orientation cube: click a face to snap the view');
    this.canvas.style.cssText = `position:absolute;top:54px;right:12px;width:${size}px;height:${size}px;z-index:4;cursor:grab;touch-action:none`;
    host.appendChild(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(size, size, false);
    // Far enough that the labelled axis tips (about 1.7 from the centre) stay inside the frame as the cube turns.
    this.cam.position.set(0, 0, 5.5);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const light = new THREE.DirectionalLight(0xffffff, 0.6);
    light.position.set(3, 5, 4);
    this.scene.add(light);

    this.cube = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), this.faceMaterials());
    this.scene.add(this.cube);
    // Coloured axis arms and labelled tips: the model's global axes at a glance. The arms inside the cube are hidden
    // by its opaque faces; the labels draw on top so they stay readable at every angle.
    this.scene.add(new THREE.AxesHelper(1.3));
    this.scene.add(this.axisLabel('+X', '#e35d6a', new THREE.Vector3(1.45, 0, 0)));
    this.scene.add(this.axisLabel('+Y', '#5cb85c', new THREE.Vector3(0, 1.45, 0)));
    this.scene.add(this.axisLabel('+Z', '#5b9bd5', new THREE.Vector3(0, 0, 1.45)));
    this.hoverDot = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x5b9bd5, transparent: true, opacity: 0.85, depthTest: false }),
    );
    this.hoverDot.renderOrder = 2;
    this.hoverDot.visible = false;
    this.scene.add(this.hoverDot);

    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointercancel', this.onUp);
    this.canvas.addEventListener('pointerleave', this.onLeave);
  }

  private themeColours(): { face: string; edge: string; text: string } {
    const css = getComputedStyle(this.host);
    const get = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    return { face: get('--panel-2', '#1b1f27'), edge: get('--line', '#3a4150'), text: get('--text-2', '#aab2c0') };
  }

  private faceMaterials(): THREE.MeshBasicMaterial[] {
    const { face, edge, text } = this.themeColours();
    return cubeFaceLabels(this.upAxis).map((label) => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d')!;
      g.fillStyle = face;
      g.fillRect(0, 0, 128, 128);
      g.strokeStyle = edge;
      g.lineWidth = 6;
      g.strokeRect(3, 3, 122, 122);
      g.fillStyle = text;
      g.font = '700 26px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(label, 64, 64);
      return new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c) });
    });
  }

  private axisLabel(text: string, color: string, at: THREE.Vector3): THREE.Sprite {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = color;
    g.font = '700 30px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 32, 34);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
    sprite.position.copy(at);
    sprite.scale.set(0.5, 0.5, 0.5);
    sprite.renderOrder = 3;
    return sprite;
  }

  /** Z up relabels the faces (TOP on +Z, FRONT on -Y); the camera's own up vector orients the cube. */
  setUpAxis(up: UpAxis): void {
    if (up === this.upAxis) return;
    this.upAxis = up;
    this.refreshTheme();
  }

  /** Re-read the page colours (after a theme change): the face textures are drawn in them. */
  refreshTheme(): void {
    for (const m of this.cube.material as THREE.MeshBasicMaterial[]) { m.map?.dispose(); m.dispose(); }
    this.cube.material = this.faceMaterials();
    this.opts.onChange();
  }

  /** Point the cube at the main camera's orientation and draw it. Call whenever the host draws. */
  render(camera: THREE.Camera, target: THREE.Vector3): void {
    const dir = camera.position.clone().sub(target).normalize();
    this.cam.position.copy(dir.multiplyScalar(this.cam.position.length() || 5.5));
    this.cam.up.copy(camera.up);
    this.cam.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.cam);
  }

  private hit(e: PointerEvent): THREE.Intersection | undefined {
    const r = this.canvas.getBoundingClientRect();
    const p = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(p, this.cam);
    return this.raycaster.intersectObject(this.cube)[0];
  }

  private onDown = (e: PointerEvent): void => {
    this.dragging = true;
    this.moved = false;
    this.last = { x: e.clientX, y: e.clientY };
    this.canvas.style.cursor = 'grabbing';
    this.hoverDot.visible = false;
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    e.preventDefault();
    e.stopPropagation();
  };

  private onMove = (e: PointerEvent): void => {
    if (this.dragging) {
      const dx = e.clientX - this.last.x;
      const dy = e.clientY - this.last.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) this.moved = true;
      if (this.moved) { this.opts.orbit(dx, dy); this.last = { x: e.clientX, y: e.clientY }; }
      return;
    }
    const h = this.hit(e);
    this.hoverDot.visible = !!h;
    if (h) { const z = zoneOf(h.point); this.hoverDot.position.set(z[0] * 0.75, z[1] * 0.75, z[2] * 0.75); }
    this.opts.onChange();
  };

  private onUp = (e: PointerEvent): void => {
    if (!this.dragging) return;
    this.dragging = false;
    this.canvas.style.cursor = 'grab';
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    if (this.moved) return;
    const h = this.hit(e);
    if (!h) return;
    const z = zoneOf(h.point);
    if (z[0] || z[1] || z[2]) this.opts.snapTo(z);
  };

  private onLeave = (): void => {
    if (!this.dragging && this.hoverDot.visible) { this.hoverDot.visible = false; this.opts.onChange(); }
  };

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onUp);
    this.canvas.removeEventListener('pointerleave', this.onLeave);
    for (const m of this.cube.material as THREE.MeshBasicMaterial[]) { m.map?.dispose(); m.dispose(); }
    this.cube.geometry.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
