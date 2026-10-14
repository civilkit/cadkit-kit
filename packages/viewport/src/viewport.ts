// Three.js scene for one body: shaded mesh, feature edges, face highlight, picking, standard views.
// Draws on demand (a dirty flag), uses the kernel normals as given, and keeps all geometry in plain
// typed arrays (nothing here is reactive).
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { groupByFace, edgeSegments, type BodyMesh, type Grouped } from './meshgeom';
import { pickFace, nearestEdge } from './pick';
import { sketchPolylines, curvePolylines, planeOutlines, axisLines, type Polyline } from './layers';
import { ViewCube } from './viewcube';
import { planeToWorld, rayPlane, viewSide, sketchEditPolylines, sketchPointWorld } from './sketchedit';

export interface ViewFrame {
  o: number[];
  x: number[];
  y: number[];
  z: number[];
}

export interface ViewBody {
  mesh: BodyMesh;
  edges: Array<{ key?: string; pts: number[][] }>;
  box: { min: number[]; max: number[] };
  sketches?: Array<{ id: string; frame: ViewFrame; sketch: unknown }>;
  curves?: Array<{ id: string; pts: number[][] }>;
  planes?: Array<{ id: string; frame: ViewFrame }>;
  markers?: unknown[];
}

export type PickMode = 'face' | 'edge';

/** What the sketch-edit overlay draws: the solved sketch and its plane frame. */
export interface SketchEditShape {
  featureId: string;
  frame: ViewFrame;
  sketch: { points: Array<{ id: string; x: number; y: number }>; entities: Array<{ id: string; type: string; [key: string]: unknown }> };
}

export interface ViewportOptions {
  onPick(names: string[], additive: boolean, mode: PickMode): void;
  onHover(name: string | null): void;
  /** A sketch point is being dragged: plane coordinates of the pointer. */
  onSketchMove?(pointId: string, u: number, v: number): void;
  /** A sketch tool is active: the pointer in plane coordinates (and in host pixels, for placing fields). */
  onSketchPointer?(ev: SketchPointerEvent): void;
  /** Select mode (no tool): a click that did not hit a point or start a drag, in plane coordinates. */
  onSketchSelect?(ev: SketchPointerEvent): void;
  /** Select mode: the pointer moved over the sketch (for hover highlights). */
  onSketchHover?(ev: SketchPointerEvent): void;
  /** Select mode: a double click on the sketch. */
  onSketchDouble?(ev: SketchPointerEvent): void;
  /** The camera moved while a sketch is open: labels placed with `sketchToScreen` need repositioning. */
  onSketchView?(): void;
}

export interface SketchPointerEvent {
  type: 'move' | 'click' | 'leave';
  /** Plane coordinates of the pointer. */
  u: number;
  v: number;
  /** Pointer position in pixels relative to the viewport element. */
  x: number;
  y: number;
  /** Snap radius in plane units (about 10 px at the current zoom). */
  tol: number;
  /** Grid spacing in plane units at the current zoom (a round number that keeps cells a comfortable size). */
  grid: number;
  mods: { shift: boolean; ctrl: boolean; alt: boolean };
}

/** What a sketch tool wants drawn while it works (plane coordinates). */
export type SketchPreviewShape =
  | { kind: 'line'; a: { x: number; y: number }; b: { x: number; y: number } }
  | { kind: 'circle'; c: { x: number; y: number }; r: number }
  /** A dotted guide, for example from the point a shape is aligned with to the pointer. */
  | { kind: 'guide'; a: { x: number; y: number }; b: { x: number; y: number } }
  /** A snap marker, sized in screen pixels: a square on a point, a triangle on a midpoint, a diamond on an
   *  alignment, a ring on the chain end that flips to an arc when the pointer rests on it. */
  | { kind: 'marker'; at: { x: number; y: number }; style: 'point' | 'midpoint' | 'align' | 'anchor' };

export type StdView = 'iso' | 'front' | 'top' | 'right' | 'back' | 'left' | 'bottom';

const VIEW_DIRS: Record<StdView, [number, number, number]> = {
  iso: [1, 0.8, 1],
  front: [0, 0, 1],
  top: [0, 1, 0.0001],
  right: [1, 0, 0],
  back: [0, 0, -1],
  left: [-1, 0, 0],
  bottom: [0, -1, 0.0001],
};

export class Viewport {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly scene = new THREE.Scene();
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly dom: HTMLCanvasElement;

  private mesh: THREE.Mesh | null = null;
  private edgeLines: THREE.LineSegments | null = null;
  private highlight: THREE.Mesh | null = null;
  private sketchLines: THREE.LineSegments | null = null;
  private curveLines: THREE.LineSegments | null = null;
  private planeLines: THREE.LineSegments | null = null;
  private axisLines: THREE.LineSegments | null = null;
  private grouped: Grouped | null = null;
  private edges: Array<{ key?: string; pts: number[][] }> = [];
  private box: { min: number[]; max: number[] } | null = null;

  private mode: PickMode = 'face';
  private dirty = true;
  private raf = 0;
  private disposed = false;
  private down: { x: number; y: number } | null = null;
  private hoverPending: { x: number; y: number } | null = null;
  private lastHover: string | null = null;

  // Sketch-edit mode: overlay of the solved sketch, faded body, point dragging.
  private sketchEdit: SketchEditShape | null = null;
  private sketchOverlay: THREE.Group | null = null;
  private sketchDrag: string | null = null;
  private sketchTool = false;
  private sketchPreviewGroup: THREE.Group | null = null;
  private sketchPreviewShapes: SketchPreviewShape[] = [];
  private sketchGridGroup: THREE.Group | null = null;
  private sketchRefreshPending = false;
  private viewCube: ViewCube | null = null;
  private groundGrid: THREE.LineSegments | null = null;
  private meshFade: number | null = null;

  constructor(private readonly host: HTMLElement, private readonly opts: ViewportOptions) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.dom = this.renderer.domElement;
    host.appendChild(this.dom);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100000);
    this.camera.position.set(60, 50, 60);

    this.controls = new OrbitControls(this.camera, this.dom);
    this.controls.addEventListener('change', () => { if (this.ortho) this.updateClip(); this.dirty = true; this.scheduleSketchRefresh(); });

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(1, 2, 1.5);
    this.scene.add(sun);
    const bg = getComputedStyle(host).getPropertyValue('--vp-bottom').trim();
    this.scene.background = new THREE.Color(bg || '#e6eaf0');

    this.viewCube = new ViewCube(host, {
      snapTo: (dir) => this.setViewDir(dir),
      orbit: (dx, dy) => this.orbitBy(dx, dy),
      onChange: () => { this.dirty = true; },
    });
    this.dom.addEventListener('pointerdown', this.onDown);
    this.dom.addEventListener('pointerup', this.onUp);
    this.dom.addEventListener('pointermove', this.onMove);
    this.dom.addEventListener('pointerleave', this.onLeave);
    this.dom.addEventListener('dblclick', this.onDouble);
    this.resize();
    this.loop();
  }

  /** Re-read the page's background colour (after a theme change). */
  refreshTheme(): void {
    const bg = getComputedStyle(this.host).getPropertyValue('--vp-bottom').trim();
    if (bg) { this.scene.background = new THREE.Color(bg); this.dirty = true; }
    this.buildGroundGrid(this.box);
    this.viewCube?.refreshTheme();
  }

  setPickMode(mode: PickMode): void { this.mode = mode; }

  /** Sketch-edit overlay: draw the solved sketch on its plane, fade the body and
   *  turn off body picking. null clears the overlay and restores everything. */
  setSketchEdit(v: SketchEditShape | null): void {
    this.clearSketchOverlay();
    if (this.groundGrid) this.groundGrid.visible = !v && this.layerOn('grid');   // the sketch has its own grid
    if (!v) { this.setSketchTool(false); this.disposeGroup(this.sketchGridGroup); this.sketchGridGroup = null; }
    this.sketchEdit = v;
    this.sketchDrag = null;
    if (!v) {
      if (this.mesh && this.meshFade !== null) {
        const m = this.mesh.material as THREE.MeshStandardMaterial;
        m.opacity = this.meshFade;
        m.transparent = this.meshFade < 1;
        this.meshFade = null;
      }
      this.dirty = true;
      return;
    }
    // Fade the body so the sketch reads on top of it.
    if (this.mesh) {
      const m = this.mesh.material as THREE.MeshStandardMaterial;
      this.meshFade = m.opacity;
      m.transparent = true;
      m.opacity = 0.25;
    }
    if (this.sketchLines) this.sketchLines.visible = false; // no double-draw of the same sketch
    const group = new THREE.Group();
    group.userData.pickable = false;
    // Solved entities as bright lines.
    const polys = sketchEditPolylines(v.sketch, v.frame as never);
    const seg = this.segmentsOf(polys);
    if (seg.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(seg, 3));
      group.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x0b74dc })));
    }
    // Points as a marker cloud.
    const world = sketchPointWorld(v.sketch.points, v.frame as never);
    if (world.length) {
      const pos = new Float32Array(world.length * 3);
      world.forEach((p, i) => { pos[i * 3] = p.xyz[0]; pos[i * 3 + 1] = p.xyz[1]; pos[i * 3 + 2] = p.xyz[2]; });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const dots = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x0b74dc, size: 7, sizeAttenuation: false }));
      group.add(dots);
    }
    this.scene.add(group);
    this.sketchOverlay = group;
    this.rebuildSketchGrid();
    this.dirty = true;
  }

  /** A sketch tool is active: the pointer drives the tool instead of dragging points, and the left button
   *  no longer orbits (right button rotates, middle pans, the wheel zooms). */
  setSketchTool(on: boolean): void {
    this.sketchTool = on;
    this.sketchDrag = null;
    this.dom.style.cursor = on ? 'crosshair' : '';
    this.controls.mouseButtons = on
      ? { LEFT: -1 as never, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }
      : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    if (!on) this.setSketchPreview([]);
  }

  /** Draw what the active tool is about to make: amber lines, dotted guides and snap markers, on top of everything. */
  setSketchPreview(shapes: SketchPreviewShape[]): void {
    this.sketchPreviewShapes = shapes;
    this.rebuildSketchPreview();
  }

  private disposeGroup(g: THREE.Group | null): void {
    if (!g) return;
    this.scene.remove(g);
    g.traverse((o) => {
      if (o instanceof THREE.LineSegments || o instanceof THREE.Line) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    });
  }

  private rebuildSketchPreview(): void {
    this.disposeGroup(this.sketchPreviewGroup);
    this.sketchPreviewGroup = null;
    const v = this.sketchEdit;
    const shapes = this.sketchPreviewShapes;
    if (!v || !shapes.length) { this.dirty = true; return; }
    const frame = v.frame as never;
    const upp = this.sketchUnitsPerPixel();
    const solid: number[] = [];
    const dotted: number[] = [];
    const seg = (out: number[], p: { x: number; y: number }, q: { x: number; y: number }) => { out.push(...planeToWorld(frame, p.x, p.y), ...planeToWorld(frame, q.x, q.y)); };
    const loop = (out: number[], pts: Array<{ x: number; y: number }>) => { for (let i = 0; i < pts.length; i++) seg(out, pts[i], pts[(i + 1) % pts.length]); };
    for (const sh of shapes) {
      if (sh.kind === 'line') seg(solid, sh.a, sh.b);
      else if (sh.kind === 'guide') seg(dotted, sh.a, sh.b);
      else if (sh.kind === 'circle') {
        const n = 64;
        for (let i = 0; i < n; i++) {
          const a0 = (i / n) * Math.PI * 2;
          const a1 = ((i + 1) / n) * Math.PI * 2;
          seg(solid, { x: sh.c.x + sh.r * Math.cos(a0), y: sh.c.y + sh.r * Math.sin(a0) }, { x: sh.c.x + sh.r * Math.cos(a1), y: sh.c.y + sh.r * Math.sin(a1) });
        }
      } else {
        const { x, y } = sh.at;
        const k = upp * (sh.style === 'anchor' ? 11 : 7);
        if (sh.style === 'point') loop(solid, [{ x: x - k, y: y - k }, { x: x + k, y: y - k }, { x: x + k, y: y + k }, { x: x - k, y: y + k }]);
        else if (sh.style === 'midpoint') loop(solid, [{ x, y: y + k }, { x: x + k, y: y - k * 0.8 }, { x: x - k, y: y - k * 0.8 }]);
        else if (sh.style === 'align') loop(solid, [{ x, y: y + k }, { x: x + k, y }, { x, y: y - k }, { x: x - k, y }]);
        else {
          const n = 24;
          const ring = Array.from({ length: n }, (_, i) => ({ x: x + k * Math.cos((i / n) * Math.PI * 2), y: y + k * Math.sin((i / n) * Math.PI * 2) }));
          loop(solid, ring);
        }
      }
    }
    const group = new THREE.Group();
    group.userData.pickable = false;
    if (solid.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(solid), 3));
      const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xe0a030, depthTest: false, transparent: true }));
      lines.renderOrder = 20;
      group.add(lines);
    }
    if (dotted.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(dotted), 3));
      const mat = new THREE.LineDashedMaterial({ color: 0xe0a030, dashSize: upp * 4, gapSize: upp * 4, depthTest: false, transparent: true, opacity: 0.85 });
      const lines = new THREE.LineSegments(geo, mat);
      lines.computeLineDistances();
      lines.renderOrder = 19;
      group.add(lines);
    }
    this.scene.add(group);
    this.sketchPreviewGroup = group;
    this.dirty = true;
  }

  /** Grid step in plane units for the current zoom: 1, 2 or 5 times a power of ten, giving cells of about 20 to 50 px. */
  private gridStep(): number {
    const raw = this.sketchUnitsPerPixel() * 20;
    const mag = 10 ** Math.floor(Math.log10(raw));
    for (const m of [1, 2, 5, 10]) if (m * mag >= raw) return m * mag;
    return 10 * mag;
  }

  /** The grid on the sketch plane (finer lines, stronger every fifth), the u and v axes through the origin and an
   *  origin marker. Rebuilt when the camera moves, because the step follows the zoom. */
  private rebuildSketchGrid(): void {
    this.disposeGroup(this.sketchGridGroup);
    this.sketchGridGroup = null;
    const v = this.sketchEdit;
    if (!v) { this.dirty = true; return; }
    const frame = v.frame as never;
    const r = this.dom.getBoundingClientRect();
    const corners = [[r.left, r.top], [r.right, r.top], [r.right, r.bottom], [r.left, r.bottom]].map(([x, y]) => this.planeAt(x, y));
    if (corners.some((c) => c === null)) { this.dirty = true; return; }
    const us = corners.map((c) => c![0]);
    const vs = corners.map((c) => c![1]);
    const step = this.gridStep();
    const pad = step * 2;
    const u0 = Math.floor((Math.min(...us) - pad) / step);
    const u1 = Math.ceil((Math.max(...us) + pad) / step);
    const v0 = Math.floor((Math.min(...vs) - pad) / step);
    const v1 = Math.ceil((Math.max(...vs) + pad) / step);
    if ((u1 - u0) * 1 > 400 || (v1 - v0) > 400) { this.dirty = true; return; }
    const css = getComputedStyle(this.host);
    const colour = (name: string, fallback: string) => new THREE.Color(css.getPropertyValue(name).trim() || fallback);
    const minor: number[] = [];
    const major: number[] = [];
    const add = (out: number[], a: [number, number], b: [number, number]) => { out.push(...planeToWorld(frame, a[0], a[1]), ...planeToWorld(frame, b[0], b[1])); };
    const uMin = u0 * step, uMax = u1 * step, vMin = v0 * step, vMax = v1 * step;
    for (let i = u0; i <= u1; i++) if (i !== 0) add(i % 5 === 0 ? major : minor, [i * step, vMin], [i * step, vMax]);
    for (let j = v0; j <= v1; j++) if (j !== 0) add(j % 5 === 0 ? major : minor, [uMin, j * step], [uMax, j * step]);
    const group = new THREE.Group();
    group.userData.pickable = false;
    const layer = (verts: number[], color: THREE.Color, opacity: number, order: number) => {
      if (!verts.length) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
      const l = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity }));
      l.renderOrder = order;
      group.add(l);
    };
    layer(minor, colour('--line-soft', '#cdd3da'), 0.9, 1);
    layer(major, colour('--line', '#aab2bd'), 1, 2);
    const axisU: number[] = [];
    const axisV: number[] = [];
    if (uMin <= 0 && uMax >= 0) add(axisV, [0, vMin], [0, vMax]);
    if (vMin <= 0 && vMax >= 0) add(axisU, [uMin, 0], [uMax, 0]);
    layer(axisU, new THREE.Color(0xd05a4a), 1, 3);
    layer(axisV, new THREE.Color(0x4aa86a), 1, 3);
    // origin marker: a small ring where the axes cross
    const k = this.sketchUnitsPerPixel() * 6;
    const ring: number[] = [];
    for (let i = 0; i < 24; i++) {
      const a0 = (i / 24) * Math.PI * 2, a1 = ((i + 1) / 24) * Math.PI * 2;
      add(ring, [k * Math.cos(a0), k * Math.sin(a0)], [k * Math.cos(a1), k * Math.sin(a1)]);
    }
    layer(ring, colour('--text-2', '#7a8591'), 1, 4);
    this.scene.add(group);
    this.sketchGridGroup = group;
    this.dirty = true;
  }

  /** Camera moved: rebuild what depends on the zoom (grid step, marker sizes), at most once per frame. */
  private scheduleSketchRefresh(): void {
    if (!this.sketchEdit || this.sketchRefreshPending) return;
    this.sketchRefreshPending = true;
    requestAnimationFrame(() => {
      this.sketchRefreshPending = false;
      if (!this.sketchEdit) return;
      this.rebuildSketchGrid();
      this.rebuildSketchPreview();
      this.opts.onSketchView?.();
    });
  }

  /** Pixel position (relative to the viewport element) of a point on the sketch plane, or null if it is behind the camera. */
  sketchToScreen(u: number, v: number): { x: number; y: number } | null {
    const s = this.sketchEdit;
    if (!s) return null;
    const w = planeToWorld(s.frame as never, u, v);
    const p = new THREE.Vector3(w[0], w[1], w[2]).project(this.camera);
    if (p.z > 1) return null;
    const r = this.dom.getBoundingClientRect();
    return { x: (p.x * 0.5 + 0.5) * r.width, y: (-p.y * 0.5 + 0.5) * r.height };
  }

  /** Plane units per screen pixel at the sketch, for snap tolerances. */
  private sketchUnitsPerPixel(): number {
    const r = this.dom.getBoundingClientRect();
    const a = this.planeAt(r.left + r.width / 2, r.top + r.height / 2);
    const b = this.planeAt(r.left + r.width / 2 + 1, r.top + r.height / 2);
    if (!a || !b) return 0.1;
    return Math.hypot(b[0] - a[0], b[1] - a[1]) || 0.1;
  }

  private emitSketchPointer(type: 'move' | 'click', e: PointerEvent, cb = this.opts.onSketchPointer): void {
    const uv = this.planeAt(e.clientX, e.clientY);
    if (!uv) return;
    const r = this.dom.getBoundingClientRect();
    cb?.({
      type, u: uv[0], v: uv[1], x: e.clientX - r.left, y: e.clientY - r.top,
      tol: this.sketchUnitsPerPixel() * 12,
      grid: this.gridStep(),
      mods: { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey },
    });
  }

  private onDouble = (e: MouseEvent): void => {
    if (this.sketchEdit && !this.sketchTool) this.emitSketchPointer('click', e as PointerEvent, this.opts.onSketchDouble);
  };

  private onLeave = (): void => {
    if (this.sketchEdit && this.sketchTool) this.opts.onSketchPointer?.({ type: 'leave', u: 0, v: 0, x: 0, y: 0, tol: 0, grid: 0, mods: { shift: false, ctrl: false, alt: false } });
  };

  /** Point the camera normal to the sketch plane, looking at its centre. */
  orientToSketch(): void {
    const v = this.sketchEdit;
    if (!v) return;
    const pts = v.sketch.points;
    const c = new THREE.Vector3();
    if (pts.length) {
      const world = sketchPointWorld(pts, v.frame as never);
      for (const p of world) c.add(new THREE.Vector3(...p.xyz));
      c.divideScalar(world.length);
    } else {
      c.set(v.frame.o[0], v.frame.o[1], v.frame.o[2]);
    }
    const z = new THREE.Vector3(v.frame.z[0], v.frame.z[1], v.frame.z[2]).normalize();
    const y = new THREE.Vector3(v.frame.y[0], v.frame.y[1], v.frame.y[2]).normalize();
    // an empty sketch (just the origin) on a part: look at the part's middle, projected onto the sketch plane
    if (pts.length <= 1 && this.mesh) {
      const g = this.mesh.geometry;
      g.computeBoundingBox();
      if (g.boundingBox) {
        const bc = g.boundingBox.getCenter(new THREE.Vector3());
        const o = new THREE.Vector3(v.frame.o[0], v.frame.o[1], v.frame.o[2]);
        c.copy(bc).sub(z.clone().multiplyScalar(bc.clone().sub(o).dot(z)));
      }
    }
    const dist = this.camera.position.distanceTo(this.controls.target) || this.radius() * 3;
    this.controls.target.copy(c);
    this.camera.up.copy(y);
    // read the sketch from outside the part: the side of its plane facing away from the body
    let centre: number[] | null = null;
    if (this.mesh) {
      const g = this.mesh.geometry;
      g.computeBoundingBox();
      if (g.boundingBox) { const bc = g.boundingBox.getCenter(new THREE.Vector3()); centre = [bc.x, bc.y, bc.z]; }
    }
    const side = viewSide(v.frame as never, centre);
    this.camera.position.copy(c).add(z.multiplyScalar(dist * side));
    this.camera.lookAt(c);
    this.controls.update();
    this.rebuildSketchGrid();
    this.dirty = true;
  }

  private clearSketchOverlay(): void {
    if (!this.sketchOverlay) return;
    this.scene.remove(this.sketchOverlay);
    this.sketchOverlay.traverse((o) => {
      if (o instanceof THREE.Points || o instanceof THREE.LineSegments) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    this.sketchOverlay = null;
  }

  private layers: Record<string, boolean> = {};
  /** Show or hide a display layer (sketches, curves, planes, axes, edges). */
  setLayerVisible(layer: string, on: boolean): void {
    this.layers[layer] = on;
    if (layer === 'edges' && this.edgeLines) this.edgeLines.visible = on;
    if (layer === 'sketches' && this.sketchLines) this.sketchLines.visible = on;
    if (layer === 'curves' && this.curveLines) this.curveLines.visible = on;
    if (layer === 'planes' && this.planeLines) this.planeLines.visible = on;
    if (layer === 'axes' && this.axisLines) this.axisLines.visible = on;
    if (layer === 'grid' && this.groundGrid) this.groundGrid.visible = on;
    this.dirty = true;
  }

  private layerOn(layer: string): boolean { return this.layers[layer] !== false; }

  /** A ground grid under the part (at the part's lowest y), in the 3D view: fine lines, stronger every fifth, the step a
   *  round number that gives about twenty cells across the part. */
  private buildGroundGrid(box: { min: number[]; max: number[] } | null): void {
    if (this.groundGrid) {
      this.scene.remove(this.groundGrid);
      this.groundGrid.geometry.dispose();
      (this.groundGrid.material as THREE.Material).dispose();
      this.groundGrid = null;
    }
    const cx = box ? (box.min[0] + box.max[0]) / 2 : 0;
    const cz = box ? (box.min[2] + box.max[2]) / 2 : 0;
    const y = box ? box.min[1] : 0;
    const size = box ? Math.max(box.max[0] - box.min[0], box.max[2] - box.min[2], 20) : 100;
    const half = size * 1.6;
    const raw = (half * 2) / 24;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
    const n = Math.ceil(half / step);
    const ox = Math.round(cx / step) * step;
    const oz = Math.round(cz / step) * step;
    const pos: number[] = [];
    const col: number[] = [];
    const css = getComputedStyle(this.host);
    const minor = new THREE.Color(css.getPropertyValue('--line').trim() || '#aab2bd');
    const major = new THREE.Color(css.getPropertyValue('--text-2').trim() || '#7a8591');
    for (let i = -n; i <= n; i++) {
      const c = i % 5 === 0 ? major : minor;
      const x = ox + i * step;
      const z = oz + i * step;
      pos.push(x, y, oz - n * step, x, y, oz + n * step, ox - n * step, y, z, ox + n * step, y, z);
      for (let k = 0; k < 4; k++) col.push(c.r, c.g, c.b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
    const grid = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55 }));
    grid.userData.pickable = false;
    grid.visible = this.layerOn('grid');
    this.scene.add(grid);
    this.groundGrid = grid;
  }

  /** Flatten polylines to a segment soup (pairs of xyz) for one LineSegments. */
  private segmentsOf(polys: Polyline[]): Float32Array {
    let n = 0;
    for (const p of polys) n += Math.max(0, p.length - 1) * 2 * 3;
    const out = new Float32Array(n);
    let i = 0;
    for (const p of polys) {
      for (let k = 0; k + 1 < p.length; k++) {
        out[i++] = p[k][0]; out[i++] = p[k][1]; out[i++] = p[k][2];
        out[i++] = p[k + 1][0]; out[i++] = p[k + 1][1]; out[i++] = p[k + 1][2];
      }
    }
    return out;
  }

  private addLayerLines(polys: Polyline[], color: number, visible: boolean): THREE.LineSegments | null {
    const seg = this.segmentsOf(polys);
    if (!seg.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(seg, 3));
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color }));
    lines.visible = visible;
    lines.userData.pickable = false;
    this.scene.add(lines);
    return lines;
  }

  private clearLayers(): void {
    for (const o of [this.sketchLines, this.curveLines, this.planeLines, this.axisLines]) {
      if (!o) continue;
      this.scene.remove(o);
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
    this.sketchLines = this.curveLines = this.planeLines = this.axisLines = null;
  }

  /** Show a body, or clear the scene when body is null (empty or failed document). */
  setBody(body: ViewBody | null): void {
    this.clearBody();
    if (!body) { this.buildGroundGrid(null); this.dirty = true; return; }
    this.buildGroundGrid(body.box ?? null);

    // Display layers first: they draw even when the mesh is empty (sketch-only docs).
    const diag = body.box
      ? Math.hypot(body.box.max[0] - body.box.min[0], body.box.max[1] - body.box.min[1], body.box.max[2] - body.box.min[2])
      : 0;
    const scale = diag > 0 ? diag * 0.25 : 25;
    if (body.sketches?.length) {
      const polys = sketchPolylines(body.sketches as never).flatMap((s) => s.polylines);
      this.sketchLines = this.addLayerLines(polys, 0xc4781a, this.layerOn('sketches'));
    }
    if (body.curves?.length) {
      const polys = curvePolylines(body.curves as never).flatMap((c) => c.polylines);
      this.curveLines = this.addLayerLines(polys, 0x1f8f86, this.layerOn('curves'));
    }
    if (body.planes?.length) {
      const quads = planeOutlines(body.planes as never, scale).map((q) => q.quad);
      this.planeLines = this.addLayerLines(quads, 0x6f7f99, this.layerOn('planes'));
      const axes = axisLines(body.planes as never, scale * 0.4);
      this.axisLines = this.addLayerLines(axes, 0x2d3a4a, this.layerOn('axes'));
    }

    if (body.mesh.triFace.length === 0) { this.dirty = true; return; }
    const g = groupByFace(body.mesh);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(g.normals, 3)); // kernel normals, not recomputed
    this.mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: 0xb8c4d6, metalness: 0.1, roughness: 0.6, side: THREE.DoubleSide,
    }));
    this.scene.add(this.mesh);

    const seg = edgeSegments(body.edges);
    if (seg.length) {
      const eg = new THREE.BufferGeometry();
      eg.setAttribute('position', new THREE.BufferAttribute(seg, 3));
      this.edgeLines = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x1c2129 }));
      this.edgeLines.visible = this.layerOn('edges');
      this.scene.add(this.edgeLines);
    }
    this.grouped = g;
    this.edges = body.edges;
    this.box = body.box;
    this.fit();
  }

  setHighlight(names: string[]): void {
    if (this.highlight) {
      this.scene.remove(this.highlight);
      this.highlight.geometry.dispose();
      (this.highlight.material as THREE.Material).dispose();
      this.highlight = null;
    }
    if (this.grouped && names.length) {
      const want = new Set(names);
      const pos: number[] = [];
      const nor: number[] = [];
      for (const r of this.grouped.ranges) {
        if (!want.has(r.name)) continue;
        pos.push(...this.grouped.positions.subarray(r.start * 3, (r.start + r.count) * 3));
        nor.push(...this.grouped.normals.subarray(r.start * 3, (r.start + r.count) * 3));
      }
      if (pos.length) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        this.highlight = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
          color: 0x0b74dc, emissive: 0x0b74dc, emissiveIntensity: 0.35,
          polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide,
        }));
        this.scene.add(this.highlight);
      }
    }
    this.dirty = true;
  }

  /** Look at the target from this direction (an axis or a diagonal), keeping the distance. The up vector is Y, with a
   *  tiny tilt for the straight-down and straight-up views so the camera never flips. */
  setViewDir(dir: [number, number, number]): void {
    const d = new THREE.Vector3(dir[0], dir[1], dir[2]);
    if (d.lengthSq() === 0) return;
    if (d.x === 0 && d.z === 0) d.z = 0.0001;
    d.normalize();
    const dist = this.camera.position.distanceTo(this.controls.target) || this.radius() * 3;
    this.camera.up.set(0, 1, 0);
    this.camera.position.copy(this.controls.target).add(d.multiplyScalar(dist));
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    if (this.sketchEdit) this.rebuildSketchGrid();
    this.dirty = true;
  }

  /** Orbit about the target by a drag of dx, dy pixels (about world Y and the camera's own right axis). */
  orbitBy(dx: number, dy: number): void {
    const off = this.camera.position.clone().sub(this.controls.target);
    const sph = new THREE.Spherical().setFromVector3(off);
    sph.theta -= dx * 0.012;
    sph.phi = Math.max(0.001, Math.min(Math.PI - 0.001, sph.phi - dy * 0.012));
    off.setFromSpherical(sph);
    this.camera.position.copy(this.controls.target).add(off);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.dirty = true;
  }

  setView(v: StdView): void {
    const c = this.center();
    const d = VIEW_DIRS[v];
    const dist = this.camera.position.distanceTo(this.controls.target) || this.radius() * 3;
    const dir = new THREE.Vector3(...d).normalize().multiplyScalar(dist);
    this.controls.target.copy(c);
    this.camera.position.copy(c).add(dir);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(c);
    this.controls.update();
    this.dirty = true;
  }

  fit(): void {
    const c = this.center();
    const r = this.radius();
    const dist = (r * 1.2) / Math.sin((this.camera.fov * Math.PI) / 360);
    const dir = this.camera.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-9) dir.set(1, 0.8, 1);
    dir.normalize().multiplyScalar(dist);
    this.controls.target.copy(c);
    this.camera.position.copy(c).add(dir);
    this.updateClip();
    this.controls.update();
    this.dirty = true;
  }

  private ortho = false;
  /** Parallel projection is a perspective camera with a very narrow field of view, moved back to keep the same framing:
   *  one camera, so orbit, pan, zoom, picking and the sketch overlay all keep working unchanged. */
  setOrtho(on: boolean): void {
    if (on === this.ortho) return;
    const oldFov = this.camera.fov;
    const newFov = on ? 1 : 45;
    const dir = this.camera.position.clone().sub(this.controls.target);
    const d = dir.length() || this.radius() * 3;
    dir.normalize().multiplyScalar(d * (Math.tan((oldFov * Math.PI) / 360) / Math.tan((newFov * Math.PI) / 360)));
    this.ortho = on;
    this.camera.fov = newFov;
    this.camera.position.copy(this.controls.target).add(dir);
    this.updateClip();
    this.controls.update();
    this.dirty = true;
  }
  isOrtho(): boolean { return this.ortho; }

  /** Clip planes that hug the model: with the narrow field of view the camera is far away, so a fixed near plane would cut it. */
  private updateClip(): void {
    const r = this.radius();
    if (this.ortho) {
      const d = this.camera.position.distanceTo(this.controls.target);
      this.camera.near = Math.max(d - 6 * r, d * 0.1);
      this.camera.far = d + 6 * r;
    } else {
      this.camera.near = Math.max(r / 1000, 0.01);
      this.camera.far = r * 100;
    }
    this.camera.updateProjectionMatrix();
  }

  resize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.dom.style.width = '100%';
    this.dom.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.dom.removeEventListener('pointerdown', this.onDown);
    this.dom.removeEventListener('pointerleave', this.onLeave);
    this.dom.removeEventListener('dblclick', this.onDouble);
    this.viewCube?.dispose();
    this.viewCube = null;
    this.dom.removeEventListener('pointerup', this.onUp);
    this.dom.removeEventListener('pointermove', this.onMove);
    this.controls.dispose();
    this.clearSketchOverlay();
    this.clearBody();
    this.renderer.dispose();
    this.dom.remove();
  }

  // ---- internals ----

  private center(): THREE.Vector3 {
    if (!this.box) return new THREE.Vector3();
    const { min, max } = this.box;
    return new THREE.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  }

  private radius(): number {
    if (!this.box) return 50;
    const { min, max } = this.box;
    return Math.max(Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2, 1e-3);
  }

  private clearBody(): void {
    this.clearLayers();
    for (const o of [this.mesh, this.edgeLines, this.highlight]) {
      if (!o) continue;
      this.scene.remove(o);
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
    this.mesh = this.edgeLines = this.highlight = null;
    this.grouped = null;
    this.edges = [];
    this.box = null;
  }

  private ndc(x: number, y: number): THREE.Vector2 {
    const r = this.dom.getBoundingClientRect();
    return new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -(((y - r.top) / r.height) * 2 - 1));
  }

  private hit(x: number, y: number): THREE.Intersection | null {
    if (!this.mesh) return null;
    this.raycaster.setFromCamera(this.ndc(x, y), this.camera);
    return this.raycaster.intersectObject(this.mesh, false)[0] ?? null;
  }

  private nameAt(h: THREE.Intersection | null): string | null {
    if (!h || !this.grouped) return null;
    if (this.mode === 'edge') {
      const i = nearestEdge(this.edges, [h.point.x, h.point.y, h.point.z], this.radius() * 0.03);
      return i === null ? null : this.edges[i].key ?? `edge#${i}`;
    }
    return pickFace(this.grouped, h.faceIndex == null ? null : { faceIndex: h.faceIndex });
  }

  /** Nearest sketch point within ~12 px of the cursor, else null. */
  private sketchPick(x: number, y: number): string | null {
    const v = this.sketchEdit;
    if (!v) return null;
    const r = this.dom.getBoundingClientRect();
    const world = sketchPointWorld(v.sketch.points, v.frame as never);
    const p3 = new THREE.Vector3();
    let best: string | null = null;
    let bestD = 12;
    for (const p of world) {
      p3.set(p.xyz[0], p.xyz[1], p.xyz[2]).project(this.camera);
      const px = r.left + ((p3.x + 1) / 2) * r.width;
      const py = r.top + ((1 - p3.y) / 2) * r.height;
      const d = Math.hypot(px - x, py - y);
      if (d <= bestD) { bestD = d; best = p.id; }
    }
    return best;
  }

  /** Pointer projected onto the sketch plane: [u, v], or null off-plane. */
  private planeAt(x: number, y: number): [number, number] | null {
    const v = this.sketchEdit;
    if (!v) return null;
    this.raycaster.setFromCamera(this.ndc(x, y), this.camera);
    const o = this.raycaster.ray.origin;
    const d = this.raycaster.ray.direction;
    return rayPlane([o.x, o.y, o.z], [d.x, d.y, d.z], v.frame as never);
  }

  private onDown = (e: PointerEvent): void => {
    this.down = { x: e.clientX, y: e.clientY };
    if (this.sketchEdit && this.sketchTool) return; // a tool is active: clicks go to the tool on release
    if (this.sketchEdit) {
      const id = this.sketchPick(e.clientX, e.clientY);
      if (id) {
        this.sketchDrag = id;
        this.controls.enabled = false; // orbit off while dragging a point
        this.dom.setPointerCapture(e.pointerId);
      }
    }
  };

  private onUp = (e: PointerEvent): void => {
    const d = this.down;
    this.down = null;
    if (this.sketchEdit && this.sketchTool) {
      if (d && e.button === 0 && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) this.emitSketchPointer('click', e);
      return;
    }
    if (this.sketchEdit) {
      const wasDrag = !!this.sketchDrag;
      if (!wasDrag && d && e.button === 0 && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) this.emitSketchPointer('click', e, this.opts.onSketchSelect);
      if (this.sketchDrag) {
        this.sketchDrag = null;
        this.controls.enabled = true;
        this.dom.releasePointerCapture(e.pointerId);
      }
      return; // body picking stays off in sketch mode
    }
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) >= 4) return; // a drag, not a click
    const name = this.nameAt(this.hit(e.clientX, e.clientY));
    this.opts.onPick(name ? [name] : [], e.shiftKey || e.ctrlKey || e.metaKey, this.mode);
  };

  private onMove = (e: PointerEvent): void => {
    if (this.sketchEdit && this.sketchTool) { this.emitSketchPointer('move', e); return; }
    if (this.sketchEdit && !this.sketchDrag) this.emitSketchPointer('move', e, this.opts.onSketchHover);
    if (this.sketchDrag) {
      const uv = this.planeAt(e.clientX, e.clientY);
      if (uv) this.opts.onSketchMove?.(this.sketchDrag, uv[0], uv[1]);
      return;
    }
    this.hoverPending = { x: e.clientX, y: e.clientY };
  };

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (this.hoverPending && !this.down && !this.sketchEdit) {
      const p = this.hoverPending;
      this.hoverPending = null;
      const name = this.nameAt(this.hit(p.x, p.y));
      if (name !== this.lastHover) { this.lastHover = name; this.opts.onHover(name); }
    }
    if (this.dirty) {
      this.dirty = false;
      this.renderer.render(this.scene, this.camera);
      this.viewCube?.render(this.camera, this.controls.target);
    }
  };
}
