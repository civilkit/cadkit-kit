// Three.js scene for one body: shaded mesh, feature edges, face highlight, picking, standard views.
// Draws on demand (a dirty flag), uses the kernel normals as given, and keeps all geometry in plain
// typed arrays (nothing here is reactive).
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { groupByFace, edgeSegments, type BodyMesh, type Grouped } from './meshgeom';
import { pickFace, nearestEdge } from './pick';
import { sketchPolylines, curvePolylines, planeOutlines, axisLines, type Polyline } from './layers';
import { planeToWorld, rayPlane, sketchEditPolylines, sketchPointWorld } from './sketchedit';

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
  mods: { shift: boolean; ctrl: boolean; alt: boolean };
}

/** What a sketch tool wants drawn while it works (plane coordinates). */
export type SketchPreviewShape =
  | { kind: 'line'; a: { x: number; y: number }; b: { x: number; y: number } }
  | { kind: 'circle'; c: { x: number; y: number }; r: number };

type StdView = 'iso' | 'front' | 'top' | 'right';

const VIEW_DIRS: Record<StdView, [number, number, number]> = {
  iso: [1, 0.8, 1],
  front: [0, 0, 1],
  top: [0, 1, 0.0001],
  right: [1, 0, 0],
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
  private meshFade: number | null = null;

  constructor(private readonly host: HTMLElement, private readonly opts: ViewportOptions) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.dom = this.renderer.domElement;
    host.appendChild(this.dom);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100000);
    this.camera.position.set(60, 50, 60);

    this.controls = new OrbitControls(this.camera, this.dom);
    this.controls.addEventListener('change', () => { this.dirty = true; });

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(1, 2, 1.5);
    this.scene.add(sun);
    const bg = getComputedStyle(host).getPropertyValue('--vp-bottom').trim();
    this.scene.background = new THREE.Color(bg || '#e6eaf0');

    this.dom.addEventListener('pointerdown', this.onDown);
    this.dom.addEventListener('pointerup', this.onUp);
    this.dom.addEventListener('pointermove', this.onMove);
    this.dom.addEventListener('pointerleave', this.onLeave);
    this.resize();
    this.loop();
  }

  /** Re-read the page's background colour (after a theme change). */
  refreshTheme(): void {
    const bg = getComputedStyle(this.host).getPropertyValue('--vp-bottom').trim();
    if (bg) { this.scene.background = new THREE.Color(bg); this.dirty = true; }
  }

  setPickMode(mode: PickMode): void { this.mode = mode; }

  /** Sketch-edit overlay: draw the solved sketch on its plane, fade the body and
   *  turn off body picking. null clears the overlay and restores everything. */
  setSketchEdit(v: SketchEditShape | null): void {
    this.clearSketchOverlay();
    if (!v) this.setSketchTool(false);
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

  /** Draw what the active tool is about to make (dashed amber, on top of everything). */
  setSketchPreview(shapes: SketchPreviewShape[]): void {
    if (this.sketchPreviewGroup) {
      this.scene.remove(this.sketchPreviewGroup);
      this.sketchPreviewGroup.traverse((o) => {
        if (o instanceof THREE.LineSegments) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
      });
      this.sketchPreviewGroup = null;
    }
    const v = this.sketchEdit;
    if (!v || !shapes.length) { this.dirty = true; return; }
    const frame = v.frame as never;
    const verts: number[] = [];
    const add = (p: { x: number; y: number }, q: { x: number; y: number }) => {
      verts.push(...planeToWorld(frame, p.x, p.y), ...planeToWorld(frame, q.x, q.y));
    };
    for (const sh of shapes) {
      if (sh.kind === 'line') add(sh.a, sh.b);
      else {
        const n = 64;
        for (let i = 0; i < n; i++) {
          const a0 = (i / n) * Math.PI * 2;
          const a1 = ((i + 1) / n) * Math.PI * 2;
          add({ x: sh.c.x + sh.r * Math.cos(a0), y: sh.c.y + sh.r * Math.sin(a0) }, { x: sh.c.x + sh.r * Math.cos(a1), y: sh.c.y + sh.r * Math.sin(a1) });
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xe0a030, depthTest: false, transparent: true });
    const lines = new THREE.LineSegments(geo, mat);
    lines.renderOrder = 20;
    const group = new THREE.Group();
    group.userData.pickable = false;
    group.add(lines);
    this.scene.add(group);
    this.sketchPreviewGroup = group;
    this.dirty = true;
  }

  /** Plane units per screen pixel at the sketch, for snap tolerances. */
  private sketchUnitsPerPixel(): number {
    const r = this.dom.getBoundingClientRect();
    const a = this.planeAt(r.left + r.width / 2, r.top + r.height / 2);
    const b = this.planeAt(r.left + r.width / 2 + 1, r.top + r.height / 2);
    if (!a || !b) return 0.1;
    return Math.hypot(b[0] - a[0], b[1] - a[1]) || 0.1;
  }

  private emitSketchPointer(type: 'move' | 'click', e: PointerEvent): void {
    const uv = this.planeAt(e.clientX, e.clientY);
    if (!uv) return;
    const r = this.dom.getBoundingClientRect();
    this.opts.onSketchPointer?.({
      type, u: uv[0], v: uv[1], x: e.clientX - r.left, y: e.clientY - r.top,
      tol: this.sketchUnitsPerPixel() * 10,
      mods: { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey },
    });
  }

  private onLeave = (): void => {
    if (this.sketchEdit && this.sketchTool) this.opts.onSketchPointer?.({ type: 'leave', u: 0, v: 0, x: 0, y: 0, tol: 0, mods: { shift: false, ctrl: false, alt: false } });
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
    const dist = this.camera.position.distanceTo(this.controls.target) || this.radius() * 3;
    this.controls.target.copy(c);
    this.camera.up.copy(y);
    this.camera.position.copy(c).add(z.multiplyScalar(dist));
    this.camera.lookAt(c);
    this.controls.update();
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
    this.dirty = true;
  }

  private layerOn(layer: string): boolean { return this.layers[layer] !== false; }

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
    if (!body) { this.dirty = true; return; }

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
    this.camera.near = Math.max(r / 1000, 0.01);
    this.camera.far = r * 100;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.dirty = true;
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
    }
  };
}
