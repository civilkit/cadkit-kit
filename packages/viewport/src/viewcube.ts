/**
 * Orientation view cube: a small chamfered cube in the corner of the viewport that follows the camera. Drag it to orbit the
 * main view; tap a face, an edge bevel or a corner to snap to that view (the region under the pointer lights up); the +X, +Y and
 * +Z axis arms are labelled and coloured. The arrows around it are DOM buttons (the app's ViewNav), not part of this canvas.
 *
 * Ported from CivilKit's `viewcube.js` / `viewcubeui.js` (the same owner's code), adapted to this viewport: Y is up by default
 * (front looks along -Z from +Z; with Z up the faces are relabelled, see camerarig.ts), the colours come from the app's theme, and the cube owns its own canvas so the host
 * only supplies the camera, an orbit step and a way to snap. The face labels read RIGHT, LEFT, TOP, BOT, FRONT, BACK
 * in the order of BoxGeometry's materials (+x, -x, +y, -y, +z, -z).
 */
import * as THREE from 'three';
import { cubeFaceLabels, type UpAxis } from './camerarig';
import { chamferCube, type CubeGeometry } from './viewcubeGeom';

export type Dir = [number, number, number];

/** Kept for hosts that pick by a point on a plain box: a click in the outer part of a face reaches the edge or corner. The cube itself now picks by its chamfer regions. */
const ZONE = 0.45;
/** A finger dragging the cube turns the model this many times as far as a mouse does (the cube is only about 80 px wide). */
export const TOUCH_GAIN = 1.8;

/** The view direction (from the target towards the camera) for a point on the cube, in the cube's local frame. */
export function zoneOf(p: { x: number; y: number; z: number }): Dir {
  const s = (v: number) => (Math.abs(v) > ZONE ? Math.sign(v) : 0);
  return [s(p.x), s(p.y), s(p.z)];
}

export interface ViewCubeOptions {
  /** Canvas size in CSS pixels (the page's CSS sizes it on screen). */
  size?: number;
  /** Snap the main camera to look from this direction (a unit-ish axis or diagonal). */
  snapTo(dir: Dir): void;
  /** Orbit the main camera by a pointer drag of dx, dy pixels. */
  orbit(dx: number, dy: number): void;
  /** The host should redraw (the highlight moved, a drag orbited). */
  onChange(): void;
}

/** The camera sits this far from the cube: close enough that the cube fills the canvas, far enough that the axis tips stay in frame. */
const CAM_DIST = 4.6;

export class ViewCube {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly cam = new THREE.PerspectiveCamera(40, 1, 0.1, 20);
  private cube: THREE.Mesh;
  private shape: CubeGeometry;
  private readonly raycaster = new THREE.Raycaster();
  private upAxis: UpAxis = 'y';
  private dragging = false;
  private moved = false;
  private last = { x: 0, y: 0 };
  /** The page colours the face textures were drawn in (a cube drawn before the theme was applied would stay in the fallback colours: black). */
  private paint = '';
  private frames = 0;
  private drag: { id: number; x: number; y: number } | null = null;
  /** The region under the pointer (hover) or the finger (press), lit in the accent colour. */
  private lit = -1;
  private lits: Array<{ plain: THREE.Texture | null; hot: THREE.Texture | null; color: THREE.Color; hotColor: THREE.Color }> = [];

  constructor(private readonly host: HTMLElement, private readonly opts: ViewCubeOptions) {
    const size = opts.size ?? 120;   // the drawing buffer; the page's CSS sets the size on screen
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'viewcube';
    this.canvas.setAttribute('aria-hidden', 'true');   // the arrows and the standard views carry the keyboard and screen reader route
    // the page's CSS places and sizes it (the arrow ring is laid out around it); these keep it a pointer surface
    this.canvas.style.cssText = `position:absolute;z-index:4;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none`;
    host.appendChild(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(size, size, false);
    this.cam.position.set(0, 0, CAM_DIST);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const light = new THREE.DirectionalLight(0xffffff, 0.6);
    light.position.set(3, 5, 4);
    this.scene.add(light);

    this.shape = chamferCube(this.upAxis);
    this.cube = new THREE.Mesh(this.shape.geometry, this.regionMaterials());
    this.scene.add(this.cube);
    // Coloured axis arms and labelled tips: the model's global axes at a glance. The arms inside the cube are hidden
    // by its opaque faces; the labels draw on top so they stay readable at every angle.
    this.scene.add(new THREE.AxesHelper(1.15));
    this.scene.add(this.axisLabel('+X', '#e35d6a', new THREE.Vector3(1.3, 0, 0)));
    this.scene.add(this.axisLabel('+Y', '#5cb85c', new THREE.Vector3(0, 1.3, 0)));
    this.scene.add(this.axisLabel('+Z', '#5b9bd5', new THREE.Vector3(0, 0, 1.3)));

    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointercancel', this.onCancel);
    this.canvas.addEventListener('pointerleave', this.onLeave);
    // a phone can drop the GPU context under memory pressure (a long rebuild): draw the faces again when it comes back
    this.canvas.addEventListener('webglcontextlost', this.onLost);
    this.canvas.addEventListener('webglcontextrestored', this.onRestored);
  }

  private onLost = (e: Event): void => { e.preventDefault(); };
  private onRestored = (): void => { this.refreshTheme(); };

  private themeColours(): { face: string; edge: string; text: string; accent: string } {
    const css = getComputedStyle(this.host);
    const get = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    return { face: get('--panel-2', '#1b1f27'), edge: get('--text-2', '#aab2c0'), text: get('--text', '#e6e9ef'), accent: get('--accent', '#3b82f6') };
  }

  /** Any CSS colour as a three colour (a 1 px canvas reads back what the browser made of it). */
  private static colour(css: string): THREE.Color {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const g = c.getContext('2d');
    if (!g) return new THREE.Color(0x808080);
    g.fillStyle = css;
    g.fillRect(0, 0, 1, 1);
    const [r, gr, b] = g.getImageData(0, 0, 1, 1).data;
    return new THREE.Color(r / 255, gr / 255, b / 255);
  }

  /** One face's label drawn on a square: plain, or in the accent for the lit state. */
  private faceTexture(label: string, fill: string, edge: string, text: string): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = fill;
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = edge;
    g.lineWidth = 8;
    g.strokeRect(4, 4, 120, 120);
    g.fillStyle = text;
    let px = 32;
    g.font = `700 ${px}px system-ui, sans-serif`;
    // long words (BOTTOM) shrink to fit the face
    while (px > 14 && g.measureText(label).width > 108) { px -= 2; g.font = `700 ${px}px system-ui, sans-serif`; }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, 64, 66);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    return t;
  }

  private regionMaterials(): THREE.MeshBasicMaterial[] {
    const { face, edge, text, accent } = this.themeColours();
    this.paint = face + edge + text + accent;
    const labels = cubeFaceLabels(this.upAxis);
    const faceC = ViewCube.colour(face), textC = ViewCube.colour(text), hot = ViewCube.colour(accent);
    // edges and corners are a shade towards the text colour, so the bevels read as separate targets
    const bevel = faceC.clone().lerp(textC, 0.34);
    this.lits = this.shape.dirs.map((_, i) => i < 6
      ? { plain: this.faceTexture(labels[i], face, edge, text), hot: this.faceTexture(labels[i], '#' + hot.getHexString(), '#ffffff', '#ffffff'), color: new THREE.Color(0xffffff), hotColor: new THREE.Color(0xffffff) }
      : { plain: null, hot: null, color: bevel, hotColor: hot });
    return this.lits.map((l, i) => new THREE.MeshBasicMaterial(l.plain ? { map: i === this.lit ? l.hot : l.plain } : { color: i === this.lit ? l.hotColor : l.color }));
  }

  private disposeMaterials(): void {
    for (const m of this.cube.material as THREE.MeshBasicMaterial[]) m.dispose();
    for (const l of this.lits) { l.plain?.dispose(); l.hot?.dispose(); }
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
    sprite.scale.set(0.42, 0.42, 0.42);
    sprite.renderOrder = 3;
    return sprite;
  }

  /** Z up relabels the faces (TOP on +Z, FRONT on -Y); the camera's own up vector orients the cube. */
  setUpAxis(up: UpAxis): void {
    if (up === this.upAxis) return;
    this.upAxis = up;
    this.disposeMaterials();
    this.cube.geometry.dispose();
    this.shape = chamferCube(up);   // the labels' orientation follows the up axis
    this.cube.geometry = this.shape.geometry;
    this.cube.material = this.regionMaterials();
    this.opts.onChange();
  }

  /** Re-read the page colours (after a theme change): the face textures are drawn in them. */
  refreshTheme(): void {
    this.disposeMaterials();
    this.cube.material = this.regionMaterials();
    this.opts.onChange();
  }

  /** Light one region (or none): faces swap their texture, bevels and corners their colour. */
  private light(i: number): void {
    if (i === this.lit) return;
    const set = (k: number, on: boolean) => {
      const l = this.lits[k], m = (this.cube.material as THREE.MeshBasicMaterial[])[k];
      if (!l || !m) return;
      if (l.plain) { m.map = on ? l.hot : l.plain; m.needsUpdate = true; } else m.color.copy(on ? l.hotColor : l.color);
    };
    if (this.lit >= 0) set(this.lit, false);
    this.lit = i;
    if (i >= 0) set(i, true);
    this.opts.onChange();
  }

  /** Point the cube at the main camera's orientation and draw it. Call whenever the host draws. */
  render(camera: THREE.Camera, target: THREE.Vector3): void {
    if (++this.frames % 20 === 1) { const c = this.themeColours(); if (c.face + c.edge + c.text + c.accent !== this.paint) this.refreshTheme(); }
    const dir = camera.position.clone().sub(target).normalize();
    this.cam.position.copy(dir.multiplyScalar(CAM_DIST));
    this.cam.up.copy(camera.up);
    this.cam.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.cam);
  }

  /** The region under a pointer: its index (the view direction is `shape.dirs[i]`), or -1. */
  private hit(e: PointerEvent): number {
    const r = this.canvas.getBoundingClientRect();
    const p = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(p, this.cam);
    const h = this.raycaster.intersectObject(this.cube)[0];
    return h?.face ? h.face.materialIndex : -1;
  }

  private onDown = (e: PointerEvent): void => {
    if (this.dragging) return;   // a second finger on the cube is not a second drag
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    this.dragging = true;
    this.moved = false;
    this.last = { x: e.clientX, y: e.clientY };
    this.canvas.style.cursor = 'grabbing';
    this.light(this.hit(e));   // a finger has no hover: the press shows what a tap will do
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    e.preventDefault();
    e.stopPropagation();
  };

  private onMove = (e: PointerEvent): void => {
    if (this.dragging) {
      if (this.drag && e.pointerId !== this.drag.id) return;
      const dx = e.clientX - this.last.x;
      const dy = e.clientY - this.last.y;
      // a finger wobbles: it is a drag (not a tap on a face) once it has gone a few pixels from where it went down
      if (!this.moved && Math.hypot(e.clientX - (this.drag?.x ?? this.last.x), e.clientY - (this.drag?.y ?? this.last.y)) > (e.pointerType === 'touch' ? 6 : 2)) { this.moved = true; this.light(-1); }
      // the cube is small and a finger covers it: its drag turns the model faster than a mouse drag does, so one stroke across it is a good turn
      const k = e.pointerType === 'touch' ? TOUCH_GAIN : 1;
      if (this.moved) { this.opts.orbit(dx * k, dy * k); this.last = { x: e.clientX, y: e.clientY }; }
      return;
    }
    this.light(this.hit(e));
  };

  /** The system took the finger (a scroll, a palm, a call): end the drag without snapping to whatever is under it. */
  private onCancel = (e: PointerEvent): void => {
    if (!this.dragging) return;
    this.dragging = false; this.moved = true; this.drag = null;
    this.canvas.style.cursor = 'grab';
    this.light(-1);
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
  };

  private onUp = (e: PointerEvent): void => {
    if (!this.dragging || (this.drag && e.pointerId !== this.drag.id)) return;
    this.dragging = false; this.drag = null;
    this.canvas.style.cursor = 'grab';
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    if (this.moved) return;
    const i = this.hit(e);
    if (e.pointerType === 'touch') this.light(-1); else this.light(i);   // the mouse is still over it; the finger has lifted
    if (i >= 0) this.opts.snapTo(this.shape.dirs[i]);
  };

  private onLeave = (): void => { if (!this.dragging) this.light(-1); };

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onCancel);
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    this.canvas.removeEventListener('pointerleave', this.onLeave);
    this.disposeMaterials();
    this.cube.geometry.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
