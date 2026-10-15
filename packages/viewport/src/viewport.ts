// Three.js scene for one body: shaded mesh, feature edges, face highlight, picking, standard views.
// Draws on demand (a dirty flag), uses the kernel normals as given, and keeps all geometry in plain
// typed arrays (nothing here is reactive).
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { groupByFace, edgeSegments, facesGeometry, namesBox, nameOwner, withoutOwned, type BodyMesh, type Grouped } from './meshgeom';
import { pickFace, nearestEdge } from './pick';
import { sketchPolylines, curvePolylines, planeOutlines, axisLines, type Polyline } from './layers';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { ViewCube } from './viewcube';
import { vertexName, parseVertexName, BODY } from '@kit/store';
import { boxPick, type Project, type ScreenRect } from './boxselect';
import { buildBoxDimensions, label as textLabel } from './dimensions';
import { RefPlanes, type RefPlaneId } from './refplanes';
import { HandleLayer } from './handleLayer';
import { TriBallLayer, type TriSink, type TriView } from './triballLayer';
import type { HandleDragSink, HandleSpec } from './handles';
export type { RefPlaneId } from './refplanes';
import { applyBodyLook, makeBodyMaterial, styleSpec, edgeColor, edgePixels, HIDDEN_EDGE_OPACITY, effectiveLight, backgroundColors, materialParams, DEFAULT_APPEARANCE, type BodyLook, type LightPreset, type BackgroundMode, type EdgeWidth, type Appearance } from './styles';
import { buildStudioEnv } from './studioEnv';
const TECHNICAL_FACE = '#f2f4f7';
import { makeHullMaterial } from './hull';
import { mergeBodies, mergedBox, SURFACE_TINT, type ViewSurface } from './surfaces';
import { AnalysisLayer } from './analysisLayer';
import { DEFAULT_ANALYSIS, sanitizeAnalysis, type AnalysisOptions, type Legend } from './analysis';
import { planeToWorld, rayPlane, viewSide, sketchEditPolylines, sketchPointWorld } from './sketchedit';

export interface ViewFrame {
  o: number[];
  x: number[];
  y: number[];
  z: number[];
}

/** The soft tint of a feature hovered in the history tree (fill and lines): a pale amber, quieter than the hover and selection colours. */
const FEATURE_HOVER = 0xffd98a;
const FEATURE_HOVER_LINE = 0xf2a93b;

export interface ViewBody {
  mesh: BodyMesh;
  edges: Array<{ key?: string; pts: number[][] }>;
  box: { min: number[]; max: number[] };
  sketches?: Array<{ id: string; frame: ViewFrame; sketch: unknown }>;
  curves?: Array<{ id: string; pts: number[][] }>;
  planes?: Array<{ id: string; frame: ViewFrame }>;
  markers?: unknown[];
  /** Surface bodies (sheets), drawn with the solid in a tint; each can be hidden by its feature id. */
  surfaces?: ViewSurface[];
}

/** What the catalog wants from the pointer while a shape is armed (see Viewport.setPlacementHook). */
export interface PlacementHook {
  move(x: number, y: number, mods: { alt: boolean }): void;
  tap(x: number, y: number, mods: { alt: boolean }): void;
  leave?(): void;
}

/** Append a typed-array slice to a plain array without spreading it (a spread of a big face overflows the call stack). */
function pushAll(out: number[], src: ArrayLike<number>): void { for (let i = 0; i < src.length; i++) out.push(src[i]); }

export type PickMode = 'face' | 'edge' | 'vertex' | 'body';

/** A thread entry of the regen result (see the kernel's `thread` feature). */
export interface ViewThread {
  id: string; size: string; standard?: string; major: number; minor: number; pitch?: number; length: number;
  hand?: 'right' | 'left'; internal: boolean; modeled?: boolean; start: number[]; dir: number[];
  /** Set on the copies a pattern or mirror makes of a thread: the id of the thread they follow. */
  instanceOf?: string;
}


/** What the sketch-edit overlay draws: the solved sketch and its plane frame. */
export interface SketchEditShape {
  featureId: string;
  frame: ViewFrame;
  sketch: { points: Array<{ id: string; x: number; y: number }>; entities: Array<{ id: string; type: string; [key: string]: unknown }> };
}

export interface ViewportOptions {
  onPick(names: string[], additive: boolean, mode: PickMode): void;
  onHover(name: string | null): void;
  /** A click landed on a reference plane (shown for an empty part or by the tree) and on no body face. */
  onRefPlanePick?(id: RefPlaneId): void;
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
  /** Right click (without a drag) on the canvas: what is under the pointer (a face, edge or corner name; null for empty space) and where, in client pixels. */
  onContextMenu?(name: string | null, x: number, y: number, mode: PickMode): void;
  /** A double click on a body face (not while a sketch is open): the name of the face under the pointer. */
  onBodyDouble?(face: string): void;
  /** A box was dragged in the 3D view (Box select mode, or Shift+drag from empty space): the names it picked in the current mode, and whether it adds to the selection. */
  onBoxSelect?(names: string[], additive: boolean, mode: PickMode): void;
  /** Select mode: a rubber band dragged on empty sketch space. `move` while dragging (pixels relative to the viewport element,
   *  `crossing` when dragged right to left), `end` on release with the corners in plane coordinates, `cancel` if it ended too small. */
  onSketchBox?(ev: SketchBoxEvent): void;
  /** The camera moved while a sketch is open: labels placed with `sketchToScreen` need repositioning. */
  onSketchView?(): void;
  /** The surface analysis on screen changed: what its colour legend shows (null when nothing is drawn). */
  onAnalysisLegend?(legend: Legend | null): void;
}

export interface SketchBoxEvent {
  phase: 'move' | 'end' | 'cancel';
  /** Corners in pixels relative to the viewport element. */
  x0: number; y0: number; x1: number; y1: number;
  /** Dragged right to left: select what the box touches, not only what it contains. */
  crossing: boolean;
  /** Corners in plane coordinates (phase `end` only). */
  u0: number; v0: number; u1: number; v1: number;
  mods: { shift: boolean; ctrl: boolean; alt: boolean };
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
  | { kind: 'marker'; at: { x: number; y: number }; style: 'point' | 'midpoint' | 'align' | 'anchor' | 'center' | 'quadrant' | 'intersection' | 'perpendicular' | 'tangent' | 'oncurve' };

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

import { SectionView } from './sectionView';
import type { SectionSpec } from './section';
import { buildMeasureMarks, type MeasureMark } from './measureMarks';

export class Viewport {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly scene = new THREE.Scene();
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly dom: HTMLCanvasElement;

  private mesh: THREE.Mesh | null = null;
  private readonly analysis = new AnalysisLayer(this.scene, (l) => this.opts.onAnalysisLegend?.(l));
  private analysisOpts: AnalysisOptions = DEFAULT_ANALYSIS;
  /** The colour attribute of the mesh without analysis (surface tints), and the polylines a comb is drawn over. */
  private baseTints: Float32Array | null = null;
  private combLines: number[][][] = [];
  private edgeLines: LineSegments2 | null = null;
  private hull: THREE.Mesh | null = null;
  private edgeMats: LineMaterial[] = [];
  private edgeWidth: EdgeWidth = 'thin';
  private silhouette = true;
  private darkBg = false;
  private lightPreset: LightPreset = 'studio';
  private lightIntensity = 1;
  private reflections = true;
  private compLooks = new Map<string, Appearance>();
  private envTex: THREE.Texture | null = null;
  private readonly sunOffset = new THREE.Vector3();
  private highlight: THREE.Mesh | null = null;
  private sketchLines: THREE.LineSegments | LineSegments2 | null = null;
  private curveLines: THREE.LineSegments | LineSegments2 | null = null;
  private fatMaterials: LineMaterial[] = [];
  private dimGroup: THREE.Group | null = null;
  private sketchQuiet: LineSegments2 | null = null;
  private consumedSketches = new Set<string>();
  /** Sketches a feature already uses are drawn thin and quiet; the rest (still to be used) stay bright and thick. */
  setConsumedSketches(ids: string[]): void { this.consumedSketches = new Set(ids); }
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
  /** Cmd/Ctrl + left drag pans the view in a sketch (a click without movement stays a Ctrl-click). */
  private modPan: { x: number; y: number; moved: boolean } | null = null;
  private hoverPending: { x: number; y: number } | null = null;
  private lastHover: string | null = null;

  // Sketch-edit mode: overlay of the solved sketch, faded body, point dragging.
  private sketchEdit: SketchEditShape | null = null;
  private sketchOverlay: THREE.Group | null = null;
  /** The dashed material of the construction lines, resized with the zoom. */
  private constructionMat: THREE.LineDashedMaterial | null = null;
  private sketchDrag: string | null = null;
  /** Rubber band in progress in Select mode: where it started (client pixels, element pixels, plane coordinates). */
  private rubber: { cx: number; cy: number; x: number; y: number; moved: boolean } | null = null;
  /** How defined each entity of the open sketch is (blue under, dark fully, red over); entities not listed stay blue. */
  private sketchDef: Record<string, 'under' | 'full' | 'over'> | null = null;
  private sketchDefLines: THREE.LineSegments[] = [];
  private sketchTool = false;
  private sketchPreviewGroup: THREE.Group | null = null;
  private sketchPreviewShapes: SketchPreviewShape[] = [];
  private sketchGridGroup: THREE.Group | null = null;
  private sketchRefreshPending = false;
  private viewCube: ViewCube | null = null;
  private readonly handleLayer: HandleLayer;
  private readonly triball: TriBallLayer;
  /** While set, a click on the body goes here (the name picked and the point on the surface) instead of selecting. */
  private pickIntercept: ((name: string | null, point: [number, number, number] | null) => void) | null = null;
  private groundGrid: THREE.LineSegments | null = null;
  private static readonly SKETCH_FADE = 0.25;
  private readonly hemi = new THREE.HemisphereLight(0xffffff, 0x8a95a5, 0.18);
  private readonly sun = new THREE.DirectionalLight(0xffffff, 0.9);
  private look: BodyLook = { style: 'shadedEdges', ghostOpacity: 0.35, appearance: { ...DEFAULT_APPEARANCE } };
  private bgMode: BackgroundMode = 'theme';
  private bgTexture: THREE.Texture | null = null;
  /** faint edges seen through the body (wireframe) */
  private hiddenEdgeLines: LineSegments2 | null = null;
  private bodyHidden = false;
  private hiddenIds = new Set<string>();
  private lastBody: ViewBody | null = null;

  constructor(private readonly host: HTMLElement, private readonly opts: ViewportOptions) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.NeutralToneMapping;   // keeps colours as they are and only rolls off the highlights
    this.renderer.toneMappingExposure = 1;
    this.dom = this.renderer.domElement;
    this.sectionView = new SectionView(this.scene, this.renderer);
    host.appendChild(this.dom);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100000);
    this.camera.position.set(60, 50, 60);

    // before the orbit controls, so a handle gets the press first (see HandleLayer)
    this.handleLayer = new HandleLayer(this.dom, host, this.camera, () => { this.dirty = true; });
    this.triball = new TriBallLayer(this.dom, host, this.camera, () => { this.dirty = true; });
    this.controls = new OrbitControls(this.camera, this.dom);
    this.controls.addEventListener('change', () => { if (this.ortho) this.updateClip(); this.dirty = true; this.scheduleSketchRefresh(); });

    this.scene.add(this.hemi);
    this.sun.position.set(1, 2, 1.5);
    this.scene.add(this.sun);
    try { this.envTex = buildStudioEnv(this.renderer); this.scene.environment = this.envTex; } catch { this.envTex = null; }   // no float targets: lit by the lamps alone
    this.setLighting(this.lightPreset);
    this.applyBackground();

    this.viewCube = new ViewCube(host, {
      snapTo: (dir) => this.setViewDir(dir),
      orbit: (dx, dy) => this.orbitBy(dx, dy),
      onChange: () => { this.dirty = true; },
    });
    this.dom.addEventListener('pointerdown', this.onBoxDown, true);
    window.addEventListener('pointermove', this.onBoxMove);
    window.addEventListener('pointerup', this.onBoxUp, true);
    this.dom.addEventListener('pointerdown', this.onDown);
    this.dom.addEventListener('pointerup', this.onUp);
    this.dom.addEventListener('pointermove', this.onMove);
    this.dom.addEventListener('pointerleave', this.onLeave);
    this.dom.addEventListener('dblclick', this.onDouble);
    this.dom.addEventListener('contextmenu', this.onContext);
    this.dom.addEventListener('pointerdown', this.onRightDown);
    this.resize();
    this.loop();
  }

  /** Re-read the page's background colour (after a theme change). */
  refreshTheme(): void {
    this.applyBackground();
    this.buildGroundGrid(this.box);
    this.viewCube?.refreshTheme();
  }

  setPickMode(mode: PickMode): void { this.mode = mode; }

  private bodyList: Array<{ name: string; faces: string[] }> = [];
  private faceBody = new Map<string, string>();
  /** The bodies (connected sets of faces) the app found: Body pick mode and the highlight of a body name use them. */
  setBodies(bodies: Array<{ name: string; faces: string[] }>): void {
    this.bodyList = bodies;
    this.faceBody = new Map(bodies.flatMap((b) => b.faces.map((f) => [f, b.name] as const)));
  }
  private expandNames(names: string[]): string[] {
    if (!names.some((n) => n === BODY || n.startsWith('@body:'))) return names;
    const out: string[] = [];
    for (const n of names) {
      if (n === BODY) out.push(...(this.grouped?.ranges.map((r) => r.name) ?? []));
      else if (n.startsWith('@body:')) out.push(...(this.bodyList.find((b) => b.name === n)?.faces ?? []));
      else out.push(n);
    }
    return out;
  }

  private boxMode = false;
  private boxDrag: { x0: number; y0: number; id: number; add: boolean } | null = null;
  private boxEl: HTMLDivElement | null = null;
  /** Box select mode: a left drag draws a box instead of orbiting. */
  setBoxMode(on: boolean): void { this.boxMode = on; this.dom.style.cursor = on ? 'crosshair' : ''; }
  isBoxMode(): boolean { return this.boxMode; }

  private onBoxDown = (e: PointerEvent): void => {
    if (e.button !== 0 || this.sketchEdit || this.placement || this.pickIntercept || !this.opts.onBoxSelect) return;
    // Box select mode starts anywhere; otherwise Shift+drag starting on empty space (a click on the body still adds to the selection)
    if (!this.boxMode && !(e.shiftKey && this.pickName(e.clientX, e.clientY) === null && !this.hit(e.clientX, e.clientY))) return;
    this.boxDrag = { x0: e.clientX, y0: e.clientY, id: e.pointerId, add: e.shiftKey };
    this.controls.enabled = false;
    try { this.dom.setPointerCapture(e.pointerId); } catch { /* synthetic events have no active pointer */ }
  };
  private onBoxMove = (e: PointerEvent): void => {
    const d = this.boxDrag;
    if (!d) return;
    if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 4 && !this.boxEl) return;
    if (!this.boxEl) {
      this.boxEl = document.createElement('div');
      this.boxEl.className = 'box-select';
      this.boxEl.style.cssText = 'position:absolute;pointer-events:none;z-index:5;box-sizing:border-box';
      this.host.appendChild(this.boxEl);
    }
    const r = this.host.getBoundingClientRect();
    const crossing = e.clientX < d.x0;
    const el = this.boxEl;
    el.style.left = Math.min(d.x0, e.clientX) - r.left + 'px'; el.style.top = Math.min(d.y0, e.clientY) - r.top + 'px';
    el.style.width = Math.abs(e.clientX - d.x0) + 'px'; el.style.height = Math.abs(e.clientY - d.y0) + 'px';
    el.dataset.kind = crossing ? 'crossing' : 'window';
    el.style.border = crossing ? '1.5px dashed #2f9e5b' : '1.5px solid #0b74dc';
    el.style.background = crossing ? 'rgba(47,158,91,.12)' : 'rgba(11,116,220,.12)';
  };
  private onBoxUp = (e: PointerEvent): void => {
    const d = this.boxDrag;
    if (!d) return;
    this.boxDrag = null;
    this.controls.enabled = true;
    try { this.dom.releasePointerCapture(d.id); } catch { /* not captured */ }
    const had = !!this.boxEl;
    this.boxEl?.remove();
    this.boxEl = null;
    if (!had) {
      // no drag: a plain click in Box select mode is an ordinary pick
      if (this.boxMode) this.opts.onPick(((n) => (n ? [n] : []))(this.pickName(e.clientX, e.clientY)), e.shiftKey || e.ctrlKey || e.metaKey, this.mode);
      this.suppressUp = true;
      return;
    }
    this.suppressUp = true;
    this.opts.onBoxSelect?.(this.pickBox({ x0: d.x0, y0: d.y0, x1: e.clientX, y1: e.clientY }), d.add || e.shiftKey, this.mode);
  };
  private suppressUp = false;

  /** The names a screen-space box (client pixels) picks in the current mode; dragging right is a window, dragging left a crossing box. */
  pickBox(r: ScreenRect): string[] {
    const hostR = this.host.getBoundingClientRect();
    const v = new THREE.Vector3();
    const project: Project = (p) => {
      v.set(p[0], p[1], p[2]).project(this.camera);
      if (v.z > 1 || v.z < -1) return null;
      return [hostR.left + ((v.x + 1) / 2) * hostR.width, hostR.top + ((1 - v.y) / 2) * hostR.height];
    };
    return boxPick({ rect: r, crossing: r.x1 < r.x0, project, mode: this.mode, grouped: this.grouped, edges: this.edges, bodies: this.bodyList, vertexName });
  }

  /** Direct-manipulation handles drawn over the model (arrows, dots, rings, plane squares). Null removes them. A drag is
   *  reported to `sink`; the handle never orbits the camera and never changes the selection. */
  setHandles(specs: HandleSpec[] | null, sink: HandleDragSink | null, onShape?: ((faceName: string) => boolean) | null): void {
    // `onShape`: pressing and dragging on a face it accepts moves the shape (the move pad's drag); a plain click still selects
    this.handleLayer.set(specs, sink, onShape ? {
      hit: (x, y) => { const h = this.hit(x, y); const n = this.nameAt(h); return h && n && onShape(n) ? [h.point.x, h.point.y, h.point.z] : null; },
      click: (e) => { this.down = { x: e.clientX, y: e.clientY }; this.onUp(e); },
    } : null);
  }
  /** The positioning ball over the selection (null removes it); see triballLayer.ts. */
  setTriBall(view: TriView | null, sink: TriSink | null): void { this.triball.set(view, sink); }
  /** Move or recolour the ball without resetting a gesture. */
  setTriBallView(view: TriView | null): void { this.triball.setView(view); }
  /** Where the camera is, for the ball's view-axis rotation. */
  cameraPosition(): [number, number, number] { const c = this.camera.position; return [c.x, c.y, c.z]; }
  triBallScreen() { return this.triball.screen(); }
  triBallDragging(): boolean { return this.triball.dragging; }
  /** Route the next clicks on the body to `fn` (a pick for the ball's menus); null restores selecting. */
  setPickIntercept(fn: ((name: string | null, point: [number, number, number] | null) => void) | null): void { this.pickIntercept = fn; this.dom.style.cursor = fn ? 'crosshair' : ''; }
  /** True while a handle is being dragged. */
  handleDragging(): boolean { return this.handleLayer.dragging; }

  /** Sketch-edit overlay: draw the solved sketch on its plane, fade the body and
   *  turn off body picking. null clears the overlay and restores everything. */
  setSketchEdit(v: SketchEditShape | null): void {
    this.clearSketchOverlay();
    if (this.groundGrid) this.groundGrid.visible = !v && this.layerOn('grid');   // the sketch has its own grid
    if (!v) { this.setSketchTool(false); this.disposeGroup(this.sketchGridGroup); this.sketchGridGroup = null; this.sketchDef = null; }
    this.sketchDefLines = [];
    this.sketchEdit = v;
    this.sketchDrag = null;
    this.applySketchButtons();
    if (!v) {
      this.applyMeshLook();   // the fade is gone: back to the style's own opacity
      this.dirty = true;
      return;
    }
    // Fade the body so the sketch reads on top of it.
    this.applyMeshLook();   // applyBodyLook caps the opacity at SKETCH_FADE while a sketch is open
    if (this.sketchLines) this.sketchLines.visible = false; // no double-draw of the same sketch
    if (this.sketchQuiet) this.sketchQuiet.visible = false;
    const group = new THREE.Group();
    group.userData.pickable = false;
    // Solved entities as bright lines.
    const polys = sketchEditPolylines(v.sketch, v.frame as never, 'solid');
    const seg = this.segmentsOf(polys);
    if (seg.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(seg, 3));
      group.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x0b74dc })));
    }
    // Construction geometry: dashed and lighter (it is never extruded)
    const cons = this.segmentsOf(sketchEditPolylines(v.sketch, v.frame as never, 'construction'));
    this.constructionMat = null;
    if (cons.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(cons, 3));
      const upp = this.sketchUnitsPerPixel();
      const mat = new THREE.LineDashedMaterial({ color: 0x0b74dc, dashSize: upp * 6, gapSize: upp * 4, transparent: true, opacity: 0.75 });
      const lines = new THREE.LineSegments(geo, mat);
      lines.computeLineDistances();
      group.add(lines);
      this.constructionMat = mat;
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
    this.rebuildSketchDef();
    this.rebuildSketchGrid();
    this.dirty = true;
  }

  /** Colour the sketch's geometry by how defined it is: dark when fully defined, red when over-constrained (blue stays for under-defined). Null clears. */
  setSketchDefinition(map: Record<string, 'under' | 'full' | 'over'> | null): void {
    this.sketchDef = map;
    this.rebuildSketchDef();
  }

  private rebuildSketchDef(): void {
    for (const l of this.sketchDefLines) { l.parent?.remove(l); l.geometry.dispose(); (l.material as THREE.Material).dispose(); }
    this.sketchDefLines = [];
    const v = this.sketchEdit, group = this.sketchOverlay, map = this.sketchDef;
    this.dirty = true;
    if (!v || !group || !map) return;
    const bg = getComputedStyle(this.host).getPropertyValue('--vp-bottom').trim() || '#e6eaf0';
    const c = new THREE.Color(bg);
    const dark = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b < 0.4;
    const colours = { full: dark ? 0xf2f2f2 : 0x151515, over: 0xe03131 } as const;
    for (const state of ['full', 'over'] as const) {
      const ents = v.sketch.entities.filter((e) => map[e.id] === state && e.construction !== true);
      if (!ents.length) continue;
      const seg = this.segmentsOf(sketchEditPolylines({ ...v.sketch, entities: ents }, v.frame as never, 'solid'));
      if (!seg.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(seg, 3));
      const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: colours[state], depthTest: false, transparent: true }));
      lines.renderOrder = 10;
      group.add(lines);
      this.sketchDefLines.push(lines);
    }
  }

  /** A sketch tool is active: the pointer drives the tool instead of dragging points, and the left button
   *  no longer orbits (right button rotates, middle pans, the wheel zooms). */
  setSketchTool(on: boolean): void {
    this.sketchTool = on;
    this.sketchDrag = null;
    this.dom.style.cursor = on ? 'crosshair' : '';
    this.applySketchButtons();
    if (!on) this.setSketchPreview([]);
  }

  /** In a sketch the left button picks and rubber-bands (tool or Select), so the right button turns the view and the middle one pans. */
  private applySketchButtons(): void {
    const sketching = this.sketchTool || !!this.sketchEdit;
    this.controls.zoomToCursor = sketching;   // in a sketch the wheel zooms towards the pointer, so a small detail can be reached without panning first
    this.controls.mouseButtons = sketching
      ? { LEFT: -1 as never, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }
      : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
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
        else if (sh.style === 'quadrant') { loop(solid, [{ x, y: y + k }, { x: x + k, y }, { x, y: y - k }, { x: x - k, y }]); seg(solid, { x: x - k, y }, { x: x + k, y }); }
        else if (sh.style === 'intersection') { seg(solid, { x: x - k, y: y - k }, { x: x + k, y: y + k }); seg(solid, { x: x - k, y: y + k }, { x: x + k, y: y - k }); }
        else if (sh.style === 'perpendicular') { loop(solid, [{ x: x - k, y: y - k }, { x: x - k, y: y + k }]); seg(solid, { x: x - k, y: y - k }, { x: x + k, y: y - k }); seg(solid, { x: x - k, y: y }, { x, y }); seg(solid, { x, y }, { x, y: y - k }); }
        else if (sh.style === 'tangent') {
          const n = 20;
          const r = k * 0.7;
          const ring = Array.from({ length: n }, (_, i) => ({ x: x + r * Math.cos((i / n) * Math.PI * 2), y: y + k * 0.25 + r * Math.sin((i / n) * Math.PI * 2) }));
          loop(solid, ring);
          seg(solid, { x: x - k * 1.3, y: y - k * 0.45 }, { x: x + k * 1.3, y: y - k * 0.45 });
        } else if (sh.style === 'center') {
          const n = 20;
          loop(solid, Array.from({ length: n }, (_, i) => ({ x: x + k * Math.cos((i / n) * Math.PI * 2), y: y + k * Math.sin((i / n) * Math.PI * 2) })));
          seg(solid, { x: x - k * 0.3, y }, { x: x + k * 0.3, y }); seg(solid, { x, y: y - k * 0.3 }, { x, y: y + k * 0.3 });
        } else if (sh.style === 'oncurve') {
          seg(solid, { x: x - k * 0.7, y }, { x: x + k * 0.7, y }); seg(solid, { x, y: y - k * 0.7 }, { x, y: y + k * 0.7 });
          loop(solid, [{ x: x - k * 0.5, y: y - k * 0.5 }, { x: x + k * 0.5, y: y - k * 0.5 }, { x: x + k * 0.5, y: y + k * 0.5 }, { x: x - k * 0.5, y: y + k * 0.5 }]);
        } else {
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
      if (this.constructionMat) { const upp = this.sketchUnitsPerPixel(); this.constructionMat.dashSize = upp * 6; this.constructionMat.gapSize = upp * 4; }
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
    if (this.sketchEdit) { if (!this.sketchTool) this.emitSketchPointer('click', e as PointerEvent, this.opts.onSketchDouble); return; }
    const face = this.nameAt(this.hit(e.clientX, e.clientY));
    if (face) this.opts.onBodyDouble?.(face);
  };

  /** Opacity of the body: faded while a sketch is open, translucent while a catalog shape is being placed. */
  private bodyFade(): number { return this.sketchEdit ? Viewport.SKETCH_FADE : this.previewFade ?? 1; }
  private previewFade: number | null = null;
  /** Draw the body translucent (0..1) while a shape from the catalog is previewed on it; null puts it back. */
  setPreviewFade(opacity: number | null): void {
    if (this.previewFade === opacity) return;
    this.previewFade = opacity;
    this.applyMeshLook();
    this.dirty = true;
  }

  private placement: PlacementHook | null = null;
  /**
   * Hand the pointer to the catalog: while a hook is set, moving over the canvas calls `move` and a click (no drag) calls `tap`
   * instead of hovering and selecting. Orbiting with the buttons held still works. null gives the pointer back.
   */
  setPlacementHook(hook: PlacementHook | null): void {
    this.placement = hook;
    this.dom.style.cursor = hook ? 'copy' : '';
    if (hook) { this.setHover(null); this.lastHover = null; }
  }
  /** Whether a screen position is over the canvas. */
  containsClient(x: number, y: number): boolean {
    const r = this.dom.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }
  /** The ray through a screen position, in model coordinates. */
  rayAt(x: number, y: number): { o: [number, number, number]; d: [number, number, number] } | null {
    if (!this.containsClient(x, y)) return null;
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.ndc(x, y), this.camera);
    const { origin: o, direction: d } = this.raycaster.ray;
    return { o: [o.x, o.y, o.z], d: [d.x, d.y, d.z] };
  }
  /** How many model units one screen pixel spans at a point (for snapping distances that stay the same on screen). */
  worldPerPixel(p: number[]): number {
    const r = this.dom.getBoundingClientRect();
    const dist = this.camera.position.distanceTo(new THREE.Vector3(p[0], p[1], p[2]));
    return (2 * dist * Math.tan((this.camera.fov * Math.PI) / 360)) / Math.max(1, r.height);
  }

  private onLeave = (): void => {
    this.placement?.leave?.();
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

  private layers: Record<string, boolean> = { issues: false };
  /** Show or hide a display layer (sketches, curves, planes, axes, edges). */
  setLayerVisible(layer: string, on: boolean): void {
    this.layers[layer] = on;
    if (layer === 'edges') this.applyMeshLook();
    if (layer === 'sketches') { if (this.sketchLines) this.sketchLines.visible = on; if (this.sketchQuiet) this.sketchQuiet.visible = on; }
    if (layer === 'curves' && this.curveLines) this.curveLines.visible = on;
    if (layer === 'planes' && this.planeLines) this.planeLines.visible = on;
    if (layer === 'axes' && this.axisLines) this.axisLines.visible = on;
    if (layer === 'grid' && this.groundGrid) this.groundGrid.visible = on;
    if (layer === 'dimensions' && this.dimGroup) this.dimGroup.visible = on;
    if (layer === 'threads' && this.threadGroup) this.threadGroup.visible = on;
    if (layer === 'issues') for (const m of this.issueMeshes) m.visible = on;
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
    const grid = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.35 }));
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

  /** Lines a few pixels wide (WebGL's own lines are always one pixel), drawn in front of the coplanar surface they lie on. */
  private addFatLines(polys: Polyline[], color: number, width: number, visible: boolean, opacity = 1): LineSegments2 | null {
    const seg = this.segmentsOf(polys);
    if (!seg.length) return null;
    const geo = new LineSegmentsGeometry();
    geo.setPositions(seg);
    const mat = new LineMaterial({ color, linewidth: width, worldUnits: false });
    mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -2;
    if (opacity < 1) { mat.transparent = true; mat.opacity = opacity; }
    mat.resolution.set(Math.max(1, this.host.clientWidth), Math.max(1, this.host.clientHeight));
    this.fatMaterials.push(mat);
    const lines = new LineSegments2(geo, mat);
    lines.visible = visible;
    lines.userData.pickable = false;
    lines.renderOrder = 3;
    this.scene.add(lines);
    return lines;
  }

  private clearLayers(): void {
    this.fatMaterials = [];
    for (const o of [this.sketchLines, this.sketchQuiet, this.curveLines, this.planeLines, this.axisLines]) {
      if (!o) continue;
      this.scene.remove(o);
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
    this.sketchLines = this.sketchQuiet = this.curveLines = this.planeLines = this.axisLines = null;
    if (this.dimGroup) {
      this.scene.remove(this.dimGroup);
      this.dimGroup.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        const mat = m.material as (THREE.Material & { map?: THREE.Texture | null }) | undefined;
        mat?.map?.dispose?.(); mat?.dispose?.();
      });
      this.dimGroup = null;
    }
  }

  /** Show a body, or clear the scene when body is null (empty or failed document). */
  setBody(body: ViewBody | null): void {
    this.lastBody = body;
    this.clearBody();
    if (!body) { this.buildGroundGrid(null); this.applySection(); this.analysis.clearLegend(); this.dirty = true; return; }
    this.buildGroundGrid(body.box ?? null);
    this.buildThreads();
    if (body.box && body.mesh.triFace.length > 0) {
      this.dimGroup = buildBoxDimensions(body.box);
      if (this.dimGroup) { this.dimGroup.visible = this.layers.dimensions === true; this.scene.add(this.dimGroup); }
    }

    // Display layers first: they draw even when the mesh is empty (sketch-only docs).
    const diag = body.box
      ? Math.hypot(body.box.max[0] - body.box.min[0], body.box.max[1] - body.box.min[1], body.box.max[2] - body.box.min[2])
      : 0;
    const scale = diag > 0 ? diag * 0.25 : 25;
    const shown = <T extends { id: string }>(xs: T[] | undefined): T[] => (xs ?? []).filter((x) => !this.hiddenIds.has(x.id));
    this.sketchItems = shown(body.sketches) as never;
    if (body.sketches?.length) {
      const all = sketchPolylines(shown(body.sketches) as never);
      const polys = all.filter((s) => !this.consumedSketches.has(s.id)).flatMap((s) => s.polylines);
      const quiet = all.filter((s) => this.consumedSketches.has(s.id)).flatMap((s) => s.polylines);
      this.sketchLines = this.addFatLines(polys, 0xe8730c, 2.6, this.layerOn('sketches'));
      this.sketchQuiet = this.addFatLines(quiet, 0xe8730c, 1.5, this.layerOn('sketches'), 0.6);
    }
    if (body.curves?.length) {
      const polys = curvePolylines(shown(body.curves) as never).flatMap((c) => c.polylines);
      this.curveLines = this.addFatLines(polys, 0x1f8f86, 2.2, this.layerOn('curves'));
    }
    if (body.planes?.length) {
      const quads = planeOutlines(shown(body.planes) as never, scale).map((q) => q.quad);
      this.planeLines = this.addLayerLines(quads, 0x6f7f99, this.layerOn('planes'));
      const axes = axisLines(body.planes as never, scale * 0.4);
      this.axisLines = this.addLayerLines(axes, 0x2d3a4a, this.layerOn('axes'));
    }

    // The solid (unless hidden) and the surface bodies not hidden, as one mesh: picking and highlights then treat them alike.
    const solidMesh = this.hiddenIds.size ? withoutOwned(body.mesh, body.edges, this.hiddenIds, this.ownerFn) : { mesh: body.mesh, edges: body.edges };
    const solidShown = !this.bodyHidden && solidMesh.mesh.triFace.length > 0;
    const surfaces = (body.surfaces ?? []).filter((x) => !this.hiddenIds.has(x.id) && x.mesh.triFace.length > 0);
    this.lastScale = scale;
    const merged = mergeBodies(solidShown ? solidMesh : null, surfaces);
    if (body.mesh.triFace.length > 0 || body.surfaces?.length) this.box = mergedBox(body.box, body.mesh.triFace.length > 0, body.surfaces ?? []);
    if (merged.mesh.triFace.length === 0) { this.setFeatureHover(this.featureHoverIds); this.dirty = true; return; }
    const g = groupByFace(merged.mesh);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(g.normals, 3)); // kernel normals, not recomputed
    this.surfaceFaces = merged.surfaceFaces;
    geo.setAttribute('aSurf', new THREE.BufferAttribute(new Float32Array((g.positions.length / 3) * 2).fill(-1), 2));
    this.grouped = g;
    this.faceLooks(geo);
    const bodyMat = makeBodyMaterial(this.shownLook(), this.bodyFade(), this.baseTints !== null);
    this.analysis.install(bodyMat);
    this.analysis.reset();
    this.mesh = new THREE.Mesh(geo, bodyMat);
    this.scene.add(this.mesh);
    this.hull = new THREE.Mesh(geo, makeHullMaterial());
    this.hull.raycast = () => { /* an outline is never picked */ };
    this.hull.userData.pickable = false;
    this.hull.renderOrder = -2;
    this.hullSize();
    this.scene.add(this.hull);

    const seg = edgeSegments(merged.edges);
    if (seg.length) {
      const eg = new LineSegmentsGeometry();
      eg.setPositions(seg);
      const px = edgePixels(this.edgeWidth), size = new THREE.Vector2(Math.max(1, this.host.clientWidth), Math.max(1, this.host.clientHeight));
      const em = new LineMaterial({ color: 0x2b3542, linewidth: px, worldUnits: false });
      const hm = new LineMaterial({ color: 0x2b3542, linewidth: px, worldUnits: false, depthTest: false, transparent: true, opacity: HIDDEN_EDGE_OPACITY });
      em.resolution.copy(size); hm.resolution.copy(size);
      this.edgeMats = [em, hm];
      this.edgeLines = new LineSegments2(eg, em);
      this.edgeLines.userData.pickable = false;
      this.scene.add(this.edgeLines);
      this.hiddenEdgeLines = new LineSegments2(eg, hm);
      this.hiddenEdgeLines.userData.pickable = false;
      this.hiddenEdgeLines.renderOrder = -1;
      this.scene.add(this.hiddenEdgeLines);
    }
    this.grouped = g;
    this.edges = merged.edges;
    this.combLines = [...merged.edges.map((e) => e.pts), ...(body.sketches?.length ? sketchPolylines(shown(body.sketches) as never).flatMap((x) => x.polylines) : [])];
    this.buildIssueMeshes();
    this.setFeatureHover(this.featureHoverIds);
    this.applyMeshLook();
    this.applySection();
    // the camera is framed once per document (load, new part, first body); edits, drags, previews and undo keep the user's view
    // the reference planes are sized from the body, so a new body (an imported part, a much bigger edit) resizes them
    if (this.lastRefPlanes) this.setRefPlanes(...this.lastRefPlanes);
    if (this.needFit && !this.keepView && !this.holdView && this.previewFade === null && !this.triball.active && this.edges.length > 0) { this.fit(); this.needFit = false; }
  }

  private keepView = false;
  private holdView = false;
  /** True until a body has been framed; `requestFit()` asks for the next body to be framed (a document was loaded or started). */
  private needFit = true;
  requestFit(): void { this.needFit = true; }
  /** While true a new body does not re-fit the camera (the catalog keeps the view still while shapes are placed on a part). */
  setHoldView(on: boolean): void { this.holdView = on; }
  /** names of the faces and edges that belong to surface bodies (tinted) */
  private surfaceFaces = new Set<string>();

  /** Display style, ghost opacity and the body's appearance (colour and material). Cheap; safe to call any time. */
  setLook(look: BodyLook): void {
    this.look = { style: look.style, ghostOpacity: look.ghostOpacity, appearance: { ...look.appearance } };
    this.applyMeshLook();
  }

  private applyMeshLook(): void {
    const spec = styleSpec(this.look.style);
    if (this.mesh) {
      this.faceLooks(this.mesh.geometry);
      const mat = this.mesh.material as THREE.MeshStandardMaterial;
      applyBodyLook(mat, this.shownLook(), this.bodyFade(), this.baseTints !== null);
      if (this.baseTints && spec.faces === 'shaded') mat.color.setHex(0xffffff);   // the colour is in the vertices
      else if (this.baseTints && spec.faces === 'translucent') mat.color.setHex(0xffffff);
    }
    const ecol = edgeColor(this.look.style, this.lightPreset, this.darkBg);
    const px = edgePixels(this.edgeWidth);
    for (const m of this.edgeMats) { m.color.setHex(ecol); m.linewidth = px; }
    if (this.hull) {
      const hm = this.hull.material as THREE.ShaderMaterial;
      hm.uniforms.uColor.value.setHex(ecol); hm.uniforms.uWidth.value = px * 0.9;
      const faces = styleSpec(this.look.style).faces;
      this.hull.visible = this.silhouette && (faces === 'shaded' || faces === 'white') && !this.sectionView.active && this.bodyFade() >= 1;
    }
    const edgesOn = (spec.edges === 'always' || (spec.edges === 'layer' && this.layerOn('edges')));
    if (this.edgeLines) {
      this.edgeLines.visible = edgesOn;
    }
    if (this.hiddenEdgeLines) this.hiddenEdgeLines.visible = edgesOn && spec.hiddenEdges;
    this.applyAnalysis();
    this.dirty = true;
  }

  /** Surface analysis (zebra, curvature maps, draft colours, curvature comb), viewer-only like the look. */
  setAnalysis(o: Partial<AnalysisOptions>): void {
    this.analysisOpts = sanitizeAnalysis({ ...this.analysisOpts, ...o });
    this.applyAnalysis();
    this.dirty = true;
  }
  getAnalysis(): AnalysisOptions { return this.analysisOpts; }
  private applyAnalysis(): void {
    const b = this.box;
    const size = b ? Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) : 1;
    const faces = ['shaded', 'translucent'].includes(styleSpec(this.look.style).faces);
    this.analysis.apply({ mesh: this.mesh, grouped: this.grouped, faces, tints: this.baseTints, o: this.analysisOpts, lines: this.combLines, size, combVisible: true });
  }

  /** Light preset (studio, flat, high contrast, technical), the intensity slider (0.3 to 2) and the reflections switch. */
  setLighting(p: LightPreset, intensity = this.lightIntensity, reflections = this.reflections): void {
    this.lightPreset = p; this.lightIntensity = intensity; this.reflections = reflections;
    const l = effectiveLight(p, intensity, reflections);
    this.hemi.color.set(l.sky); this.hemi.groundColor.set(l.ground); this.hemi.intensity = l.hemi;
    this.sun.intensity = l.sun;
    this.scene.environment = this.envTex && l.env > 0 ? this.envTex : null;
    this.scene.environmentIntensity = l.env;
    this.metalScale = Math.min(1, l.env);
    this.renderer.toneMappingExposure = l.exposure;
    this.sunOffset.set(-0.42, 0.62, 0.66).multiplyScalar(100);
    this.applyMeshLook();
  }

  /** Edge line width and the silhouette outline (a dark outline around the body where no feature edge lies). */
  setEdges(width: EdgeWidth, silhouette: boolean): void { this.edgeWidth = width; this.silhouette = silhouette; this.applyMeshLook(); }

  /** The appearance of each component of an assembly (by component id); a face of a component not listed takes the body's. */
  setComponentLooks(m: ReadonlyMap<string, Appearance> | null): void {
    this.compLooks = new Map(m ?? []);
    this.applyMeshLook();
  }

  /** Per-face colour (and finish) of the body: the surface tint, the component's colour in an assembly, white for technical. Sets `baseTints`. */
  private faceLooks(geo: THREE.BufferGeometry): void {
    const g = this.grouped;
    if (!g) return;
    const technical = this.lightPreset === 'technical';
    const comps = !technical && this.compLooks.size > 0 && styleSpec(this.look.style).faces !== 'white';
    if (!comps && !this.surfaceFaces.size) {
      this.baseTints = null;
      if (geo.getAttribute('color')) geo.deleteAttribute('color');
      const a = geo.getAttribute('aSurf') as THREE.BufferAttribute | undefined;
      if (a) { a.array.fill(-1); a.needsUpdate = true; }
      return;
    }
    const nv = g.positions.length / 3;
    let col = geo.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (!col || col.count !== nv || this.analysisColored()) { col = new THREE.BufferAttribute(new Float32Array(nv * 3), 3); geo.setAttribute('color', col); }
    const surf = geo.getAttribute('aSurf') as THREE.BufferAttribute;
    const c = this.tmpColor, own = this.shownLook().appearance;
    for (const r of g.ranges) {
      const app = (comps && this.compLooks.get(this.ownerFn(r.name) ?? '')) || own;
      c.set(app.color);
      if (this.surfaceFaces.has(r.name)) c.multiply(this.tintColor.setRGB(SURFACE_TINT[0], SURFACE_TINT[1], SURFACE_TINT[2]));
      const mp = this.scaledFinish(materialParams(app.material));
      for (let v = r.start; v < r.start + r.count; v++) {
        col.setXYZ(v, c.r, c.g, c.b);
        surf.setXY(v, comps ? mp.roughness : -1, comps ? mp.metalness : -1);
      }
    }
    col.needsUpdate = true; surf.needsUpdate = true;
    this.baseTints = col.array as Float32Array;
  }
  /** The look the body is drawn with: technical paints every face matte white. */
  private shownLook(): BodyLook {
    const l = this.look;
    const appearance = this.lightPreset === 'technical' ? { color: TECHNICAL_FACE, material: 'matte' as const } : l.appearance;
    return { ...l, appearance, metalScale: this.metalScale };
  }
  /** Metal needs reflections: with little or no studio light the metalness fades out so faces do not go black. */
  private metalScale = 1;
  private scaledFinish(p: { roughness: number; metalness: number }): { roughness: number; metalness: number } {
    return { roughness: p.roughness, metalness: p.metalness * this.metalScale };
  }
  private readonly tmpColor = new THREE.Color();
  private readonly tintColor = new THREE.Color();
  private analysisColored(): boolean { return this.analysisOpts.mode === 'gaussian' || this.analysisOpts.mode === 'mean' || this.analysisOpts.mode === 'draft'; }

  /** The outline reads the canvas size in pixels. */
  private hullSize(): void {
    if (!this.hull) return;
    (this.hull.material as THREE.ShaderMaterial).uniforms.uInvSize.value.set(2 / Math.max(1, this.host.clientWidth), 2 / Math.max(1, this.host.clientHeight));
  }

  setBackground(mode: BackgroundMode): void { this.bgMode = mode; this.applyBackground(); }

  private applyBackground(): void {
    const css = getComputedStyle(this.host);
    const theme = { top: css.getPropertyValue('--vp-top').trim() || '#cfd8e4', bottom: css.getPropertyValue('--vp-bottom').trim() || '#e6eaf0' };
    const c = backgroundColors(this.bgMode, theme);
    this.darkBg = new THREE.Color(c.bottom).getHSL({ h: 0, s: 0, l: 0 }).l < 0.4;
    this.bgTexture?.dispose(); this.bgTexture = null;
    if (c.top === c.bottom) this.scene.background = new THREE.Color(c.bottom);
    else {
      const cv = document.createElement('canvas'); cv.width = 2; cv.height = 256;
      const g = cv.getContext('2d');
      if (g) {
        const grad = g.createLinearGradient(0, 0, 0, 256);
        grad.addColorStop(0, c.top); grad.addColorStop(1, c.bottom);
        g.fillStyle = grad; g.fillRect(0, 0, 2, 256);
        const tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
        this.bgTexture = tex; this.scene.background = tex;
      } else this.scene.background = new THREE.Color(c.bottom);
    }
    this.dirty = true;
  }

  /** Viewer-only hiding: the whole body, and sketches / curves / planes by id (never saved in the document). */
  setHidden(o: { body: boolean; ids: Iterable<string> }): void {
    const ids = new Set(o.ids);
    const changed = o.body !== this.bodyHidden || ids.size !== this.hiddenIds.size || [...ids].some((i) => !this.hiddenIds.has(i));
    this.bodyHidden = o.body;
    this.hiddenIds = ids;
    this.applyMeshLook();
    if (changed && this.lastBody) {
      const names = [...this.selectedNames];
      this.keepView = true;
      try { this.setBody(this.lastBody); } finally { this.keepView = false; }
      this.setHighlight(names);
    }
  }

  private threadItems: ViewThread[] = [];
  private threadGroup: THREE.Group | null = null;
  /** Cosmetic threads from the regen result (modelled ones are real geometry and need no marker). Kept, so a rebuilt body redraws them. */
  setThreads(items: ViewThread[]): void {
    this.threadItems = items;
    this.buildThreads();
    this.buildThreadFocus();
  }
  private threadFocusId: string | null = null;
  private threadFocusObj: THREE.Object3D | null = null;
  /**
   * Light up the thread being edited: a bracket along the axis for its length (an orange line beside the face with a tick at
   * each end), drawn from the thread's entry (modelled or cosmetic alike). null clears it. The threaded face itself is lit by the
   * selection highlight (the app adds it); this adds only the length range.
   */
  setThreadFocus(id: string | null): void {
    this.threadFocusId = id;
    this.buildThreadFocus();
  }
  private buildThreadFocus(): void {
    this.dropFat(this.threadFocusObj);
    this.threadFocusObj = null;
    this.dirty = true;
    const th = this.threadFocusId ? this.threadItems.find((x) => x.id === this.threadFocusId) : undefined;
    if (!th || !th.start || !th.dir) return;
    const dir = new THREE.Vector3(...(th.dir as [number, number, number])).normalize();
    const o = new THREE.Vector3(...(th.start as [number, number, number]));
    const seed = Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(dir, seed).normalize();
    const r = th.major / 2;
    const off = r + Math.max(1.5, r * 0.3);
    const at = (radial: number, d: number) => o.clone().addScaledVector(u, radial).addScaledVector(dir, d);
    const pt = (v: THREE.Vector3) => [v.x, v.y, v.z];
    const segs = [[pt(at(off, 0)), pt(at(off, th.length))], [pt(at(r, 0)), pt(at(off * 1.08, 0))], [pt(at(r, th.length)), pt(at(off * 1.08, th.length))]];
    const l = this.addFatLines(segs as never, 0xff8a00, this.hlWidth + 0.8, true);
    if (l) { l.renderOrder = 8; (l.material as LineMaterial).depthTest = false; this.threadFocusObj = l; }
  }
  private buildThreads(): void {
    this.dropThreadGroup();
    this.threadMats = [];
    const items = this.threadItems.filter((th) => !th.modeled && th.start && th.dir);
    if (!items.length) { this.dirty = true; return; }
    this.drawThreads(items);
  }
  private dropThreadGroup(): void {
    if (this.threadGroup) {
      this.scene.remove(this.threadGroup);
      this.threadGroup.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        const mat = m.material as (THREE.Material & { map?: THREE.Texture | null }) | undefined;
        mat?.map?.dispose?.(); mat?.dispose?.();
      });
      this.fatMaterials = this.fatMaterials.filter((m) => this.threadMats.indexOf(m) < 0);
      this.threadGroup = null;
    }
  }
  private drawThreads(items: ViewThread[]): void {
    const group = new THREE.Group();
    group.userData.pickable = false;
    for (const th of items) {
      const dir = new THREE.Vector3(...(th.dir as [number, number, number])).normalize();
      const o = new THREE.Vector3(...(th.start as [number, number, number]));
      const seed = Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      const u = new THREE.Vector3().crossVectors(dir, seed).normalize();
      const v = new THREE.Vector3().crossVectors(dir, u).normalize();
      // the root of an external thread, the major diameter of an internal one: the thin line CAD drawings use
      const r = (th.internal ? th.major : th.minor) / 2;
      const at = (a: number, d: number) => o.clone().addScaledVector(u, Math.cos(a) * r).addScaledVector(v, Math.sin(a) * r).addScaledVector(dir, d);
      const segs: number[][][] = [];
      const ring = (d: number) => { const p: number[][] = []; for (let i = 0; i <= 48; i++) { const q = at((i / 48) * Math.PI * 2, d); p.push([q.x, q.y, q.z]); } return p; };
      segs.push(ring(0));
      segs.push(ring(th.length));
      for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) { const p0 = at(a, 0), p1 = at(a, th.length); segs.push([[p0.x, p0.y, p0.z], [p1.x, p1.y, p1.z]]); }
      const lines = this.addFatLines(segs as never, 0x1f6feb, 1.2, true, 0.8);
      if (lines) {
        this.scene.remove(lines);                       // addFatLines adds to the scene; the thread group owns it
        const m = lines.material as LineMaterial;
        m.depthTest = false; m.dashed = true; m.dashSize = r * 0.18; m.gapSize = r * 0.12;
        lines.computeLineDistances(); lines.renderOrder = 5;
        this.threadMats.push(m);
        group.add(lines);
      }
      const s = textLabel(th.size + (th.hand === 'left' ? ' LH' : ''));
      const p = at(0, th.length / 2).addScaledVector(u, r * 0.0 + Math.max(r * 0.35, 1));
      s.position.copy(p);
      group.add(s);
    }
    group.visible = this.layerOn('threads');
    this.scene.add(group);
    this.threadGroup = group;
    this.dirty = true;
  }
  private threadMats: LineMaterial[] = [];

  private sketchItems: Array<{ id: string; frame: ViewFrame; sketch: unknown }> = [];
  private shapeHover: THREE.Object3D | null = null;
  /** Light up some entities of a sketch of the body (the shape row the pointer is over in the editor); null clears it. */
  highlightSketchEntities(sketchId: string | null, entityIds: string[]): void {
    this.dropFat(this.shapeHover);
    this.shapeHover = null;
    this.dirty = true;
    if (!sketchId || !entityIds.length) return;
    const item = this.sketchItems.find((s) => s.id === sketchId);
    if (!item) return;
    const sk = item.sketch as { entities: Array<{ id: string }> };
    const only = { ...item, sketch: { ...sk, entities: sk.entities.filter((e) => entityIds.includes(e.id)) } };
    const polys = sketchPolylines([only as never]).flatMap((s) => s.polylines);
    const l = this.addFatLines(polys, 0x0b74dc, Math.max(this.hlWidth, 3), true);
    if (l) { l.renderOrder = 9; (l.material as LineMaterial).depthTest = false; this.shapeHover = l; }   // on top: the sketch may lie on a face turned away
  }
  private gapMark: THREE.Object3D | null = null;
  /** Mark the gap between the loose ends of an almost closed sketch chain: a red line from `a` to `b` (sketch coordinates). Null clears it. */
  highlightSketchGap(sketchId: string | null, a?: [number, number], b?: [number, number]): void {
    this.dropFat(this.gapMark);
    this.gapMark = null;
    this.dirty = true;
    if (!sketchId || !a || !b) return;
    const item = this.sketchItems.find((s) => s.id === sketchId);
    if (!item) return;
    const marker = {
      ...item,
      sketch: { ...(item.sketch as object), points: [{ id: 'gap1', x: a[0], y: a[1] }, { id: 'gap2', x: b[0], y: b[1] }], entities: [{ id: 'gap', type: 'line', p1: 'gap1', p2: 'gap2' }] },
    };
    const polys = sketchPolylines([marker as never]).flatMap((x) => x.polylines);
    const l = this.addFatLines(polys, 0xd62828, Math.max(this.hlWidth, 3) + 1, true);
    if (l) { l.renderOrder = 9; (l.material as LineMaterial).depthTest = false; this.gapMark = l; }
  }
  private hlWidth = 3;
  /** Thickness in pixels of the hover and selection lines of edges. */
  setHighlightWidth(w: number): void {
    this.hlWidth = w;
    for (const o of [this.hoverObj, this.edgeHighlight]) {
      const m = (o as LineSegments2 | null)?.material as LineMaterial | undefined;
      if (m && 'linewidth' in m) m.linewidth = w;
    }
    this.dirty = true;
  }
  private selectedNames = new Set<string>();
  private edgeHighlight: LineSegments2 | null = null;
  private hoverObj: THREE.Object3D | null = null;

  private edgeIndex(name: string): number {
    return this.edges.findIndex((e, i) => (e.key ?? `edge#${i}`) === name);
  }
  /** Round dots, a fixed size on screen, drawn on top, for hovered or selected corners. */
  private vertexDots(points: number[][], color: number): THREE.Points {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
    const mat = new THREE.PointsMaterial({ color, size: Math.max(9, this.hlWidth * 3 + 4), sizeAttenuation: false, depthTest: false, transparent: true });
    const pts = new THREE.Points(geo, mat);
    pts.renderOrder = 8; pts.userData.pickable = false;
    this.scene.add(pts);
    return pts;
  }

  private dropFat(o: THREE.Object3D | null): void {
    if (!o) return;
    this.scene.remove(o);
    const l = o as LineSegments2 | THREE.Mesh;
    l.geometry.dispose();
    const m = l.material as THREE.Material;
    this.fatMaterials = this.fatMaterials.filter((x) => x !== (m as unknown));
    m.dispose();
  }

  /** The face or edge under the pointer: a lighter fill for a face, an amber thick line for an edge (selected ones keep their own look). */
  setHover(name: string | null, force = false): void {
    this.dropFat(this.hoverObj);
    this.hoverObj = null;
    this.dirty = true;
    if (!name || (!force && this.selectedNames.has(name))) return;
    const vp = parseVertexName(name);
    if (vp) { this.hoverObj = this.vertexDots([vp], 0xffa21f); return; }
    const ei = this.edgeIndex(name);
    if (ei >= 0) {
      const l = this.addFatLines([this.edges[ei].pts as never], 0xffa21f, this.hlWidth, true);
      if (l) { l.renderOrder = 6; this.hoverObj = l; }
      return;
    }
    if (!this.grouped) return;
    const pos: number[] = [], nor: number[] = [];
    const faces = new Set(this.expandNames([name]));
    for (const r of this.grouped.ranges) {
      if (!faces.has(r.name)) continue;
      pushAll(pos, this.grouped.positions.subarray(r.start * 3, (r.start + r.count) * 3));
      pushAll(nor, this.grouped.normals.subarray(r.start * 3, (r.start + r.count) * 3));
    }
    if (!pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: force ? 0xffa21f : 0x7fc1ff, emissive: force ? 0xffa21f : 0x7fc1ff, emissiveIntensity: force ? 0.5 : 0.25, transparent: true, opacity: force ? 0.85 : 0.55,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, side: THREE.DoubleSide, depthWrite: false,
    }));
    m.userData.pickable = false;
    this.scene.add(m);
    this.hoverObj = m;
  }

  private ownerFn: (name: string) => string | null = nameOwner;
  /** Which feature (or component) owns a face / edge name; the default reads the id before the first dot. The app swaps it in assemblies. */
  setOwnerFn(fn: ((name: string) => string | null) | null): void { this.ownerFn = fn ?? nameOwner; }
  private featureHoverIds: string[] = [];
  private featureHoverObjs: THREE.Object3D[] = [];
  private lastScale = 25;
  private dropFeatureHover(): void {
    for (const o of this.featureHoverObjs) this.dropFat(o);
    this.featureHoverObjs = [];
  }
  /** Soft tint on everything the features with these ids made: their faces and edges (names that start with the id), their
   *  sketch curves, curves and plane. A different, quieter colour than a hovered or selected face. Empty list clears it. */
  setFeatureHover(ids: string[]): void {
    this.featureHoverIds = [...ids];
    this.dropFeatureHover();
    this.dirty = true;
    if (!ids.length) return;
    const want = new Set(ids);
    if (this.grouped) {
      const names = this.grouped.ranges.map((r) => r.name).filter((n) => want.has(this.ownerFn(n) ?? ''));
      const g = names.length ? facesGeometry(this.grouped, names) : null;
      if (g && g.positions.length) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(g.positions, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.normals, 3));
        const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
          color: FEATURE_HOVER, emissive: FEATURE_HOVER, emissiveIntensity: 0.3, transparent: true, opacity: 0.5,
          polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide, depthWrite: false,
        }));
        m.userData.pickable = false;
        m.renderOrder = 3;
        this.scene.add(m);
        this.featureHoverObjs.push(m);
      }
    }
    const polys: Polyline[] = this.edges.filter((e) => e.key && want.has(this.ownerFn(e.key) ?? '')).map((e) => e.pts as never);
    const b = this.lastBody;
    if (b) {
      polys.push(...sketchPolylines((b.sketches ?? []).filter((x) => want.has(x.id) && !this.hiddenIds.has(x.id)) as never).flatMap((x) => x.polylines));
      polys.push(...curvePolylines((b.curves ?? []).filter((x) => want.has(x.id) && !this.hiddenIds.has(x.id)) as never).flatMap((x) => x.polylines));
      polys.push(...planeOutlines((b.planes ?? []).filter((x) => want.has(x.id) && !this.hiddenIds.has(x.id)) as never, this.lastScale).map((q) => q.quad as never));
    }
    if (polys.length) {
      const l = this.addFatLines(polys, FEATURE_HOVER_LINE, this.hlWidth, true);
      if (l) { l.renderOrder = 6; this.featureHoverObjs.push(l); }
    }
  }

  private issueFaces: Record<string, 'error' | 'warn' | 'info'> = {};
  private issueMeshes: THREE.Mesh[] = [];
  private issueHover: THREE.Object3D[] = [];
  private static readonly ISSUE_COLOUR = { error: 0xd1242f, warn: 0xe5a00d, info: 0x2f7fd6 };

  /** Tint the faces named by design-check issues (worst severity per face). Shown while the `issues` layer is on; kept across rebuilds. */
  setIssueFaces(map: Record<string, 'error' | 'warn' | 'info'>): void {
    this.issueFaces = { ...map };
    this.buildIssueMeshes();
  }
  private dropIssueMeshes(): void {
    for (const m of this.issueMeshes) { this.scene.remove(m); m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    this.issueMeshes = [];
  }
  private buildIssueMeshes(): void {
    this.dropIssueMeshes();
    this.dirty = true;
    if (!this.grouped) return;
    for (const sev of ['error', 'warn', 'info'] as const) {
      const names = Object.keys(this.issueFaces).filter((n) => this.issueFaces[n] === sev);
      if (!names.length) continue;
      const { positions, normals } = facesGeometry(this.grouped, names);
      if (!positions.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: Viewport.ISSUE_COLOUR[sev], transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      }));
      m.userData.pickable = false;
      m.visible = this.layerOn('issues');
      m.renderOrder = 2;
      this.scene.add(m);
      this.issueMeshes.push(m);
    }
  }

  private dropIssueHover(): void {
    for (const o of this.issueHover) this.dropFat(o);
    this.issueHover = [];
  }
  /** Light several faces and edges at once (an issue under the pointer in the list), amber like a hovered face or edge. */
  setIssueHover(names: string[]): void {
    this.dropIssueHover();
    this.dirty = true;
    if (!this.grouped || !names.length) return;
    const g = facesGeometry(this.grouped, names);
    if (g.positions.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(g.positions, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.normals, 3));
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color: 0xffa21f, emissive: 0xffa21f, emissiveIntensity: 0.35, transparent: true, opacity: 0.7,
        polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, side: THREE.DoubleSide, depthWrite: false,
      }));
      m.userData.pickable = false;
      this.scene.add(m);
      this.issueHover.push(m);
    }
    const polys = names.map((n) => this.edgeIndex(n)).filter((i) => i >= 0).map((i) => this.edges[i].pts as never);
    if (polys.length) {
      const l = this.addFatLines(polys, 0xffa21f, this.hlWidth, true);
      if (l) { l.renderOrder = 6; this.issueHover.push(l); }
    }
  }

  /** Bring the named faces and edges into view: aim at the middle of their box and move closer or further, keeping the view direction. */
  frameNames(names: string[]): void {
    const b = namesBox(this.grouped, this.edges, names);
    if (!b) return;
    const c = new THREE.Vector3((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    const rad = Math.max(Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2, this.radius() * 0.05);
    const dist = Math.min((rad * 2.4) / Math.sin((this.camera.fov * Math.PI) / 360), this.radius() * 6);
    const dir = this.camera.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-9) dir.set(1, 0.8, 1);
    dir.normalize().multiplyScalar(dist);
    this.controls.target.copy(c);
    this.camera.position.copy(c).add(dir);
    this.updateClip();
    this.controls.update();
    this.dirty = true;
  }

  setHighlight(names: string[]): void {
    const asked = names;
    names = this.expandNames(names);
    this.selectedNames = new Set([...asked, ...names]);
    this.dropFat(this.edgeHighlight);
    this.edgeHighlight = null;
    const verts = names.map(parseVertexName).filter((p): p is number[] => !!p);
    if (verts.length) this.edgeHighlight = this.vertexDots(verts, 0x0b74dc) as never;
    const polys = names.map((n) => this.edgeIndex(n)).filter((i) => i >= 0).map((i) => this.edges[i].pts as never);
    if (polys.length) {
      const l = this.addFatLines(polys, 0x0b74dc, this.hlWidth, true);
      if (l) { l.renderOrder = 7; this.edgeHighlight = l; }
    }
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
        pushAll(pos, this.grouped.positions.subarray(r.start * 3, (r.start + r.count) * 3));
        pushAll(nor, this.grouped.normals.subarray(r.start * 3, (r.start + r.count) * 3));
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

  /** Move the view sideways / up by a number of pixels on screen (the camera and its target move together). */
  panBy(dx: number, dy: number): void {
    const dist = this.camera.position.distanceTo(this.controls.target);
    const perPx = (2 * dist * Math.tan((this.camera.fov * Math.PI) / 360)) / Math.max(1, this.dom.clientHeight || this.host.clientHeight);
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    const move = right.multiplyScalar(-dx * perPx).add(up.multiplyScalar(dy * perPx));
    this.camera.position.add(move);
    this.controls.target.add(move);
    this.camera.updateMatrixWorld();
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

  private lastPick: [number, number, number] | null = null;
  /** Where the last face click landed on the body (world coordinates), for tools that need a point on a curved face. */
  lastPickPoint(): [number, number, number] | null { return this.lastPick; }
  private readonly refPlanes = new RefPlanes();
  private lastRefPlanes: [RefPlaneId[], RefPlaneId | null, Record<RefPlaneId, string>] | null = null;
  /** Show reference planes: `show` faintly (an empty part shows all three), `highlight` in orange with its label. */
  setRefPlanes(show: RefPlaneId[], highlight: RefPlaneId | null, labels: Record<RefPlaneId, string>): void {
    this.lastRefPlanes = [show, highlight, labels];
    if (!this.refPlanes.group.parent) this.scene.add(this.refPlanes.group);
    this.refPlanes.set(this.box ? this.radius() * 1.4 : 60, show, highlight, labels);
    this.dirty = true;
  }

  /** Constant-size sprites are sized as a fraction of the screen times the projection's focal factor, so a narrow field of view
   *  (the parallel view) would blow them up. Scale them by the field of view relative to the 45 degrees they are designed for. */
  private fixSpriteScale(): void {
    const k = Math.tan((this.camera.fov * Math.PI) / 360) / Math.tan((45 * Math.PI) / 360);
    for (const g of [this.refPlanes.group, this.dimGroup, this.threadGroup, this.measureGroup]) {
      g?.traverse((o) => {
        const base = o.userData.base as [number, number] | undefined;
        if (base && (o as THREE.Sprite).isSprite) o.scale.set(base[0] * k, base[1] * k, 1);
      });
    }
  }


  // ---- Inspect: section view and measurement leaders (see section.ts, sectionView.ts, measureMarks.ts) ----
  private readonly sectionView: SectionView;
  private sectionSpec: SectionSpec | null = null;
  private measureGroup: THREE.Group | null = null;

  /** Cut the body open with a plane (null removes the cut). The cut face is capped. Survives rebuilds of the body. */
  setSection(spec: SectionSpec | null): void {
    this.sectionSpec = spec;
    this.applySection();
  }
  private applySection(): void {
    this.sectionView.set(this.sectionSpec, this.mesh, this.edgeLines, this.box);
    this.applyMeshLook();   // the silhouette outline is not clipped, so it hides while a section shows
    this.dirty = true;
  }

  /** Draw measurement leaders (null or empty removes them). */
  setMeasure(marks: MeasureMark[] | null): void {
    if (this.measureGroup) {
      this.scene.remove(this.measureGroup);
      this.measureGroup.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh || (o as THREE.Line).isLine) m.geometry?.dispose(); });
      this.measureGroup = null;
    }
    const diag = this.box ? Math.hypot(this.box.max[0] - this.box.min[0], this.box.max[1] - this.box.min[1], this.box.max[2] - this.box.min[2]) : 100;
    this.measureGroup = marks ? buildMeasureMarks(marks, diag) : null;
    if (this.measureGroup) this.scene.add(this.measureGroup);
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
    for (const m of this.fatMaterials) m.resolution.set(w, h);
    for (const m of this.edgeMats) m.resolution.set(w, h);
    this.hullSize();
    this.dirty = true;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.dom.removeEventListener('pointerdown', this.onBoxDown, true);
    window.removeEventListener('pointermove', this.onBoxMove);
    window.removeEventListener('pointerup', this.onBoxUp, true);
    this.dom.removeEventListener('pointerdown', this.onDown);
    this.dom.removeEventListener('pointerleave', this.onLeave);
    this.dom.removeEventListener('dblclick', this.onDouble);
    this.dom.removeEventListener('contextmenu', this.onContext);
    this.dom.removeEventListener('pointerdown', this.onRightDown);
    this.viewCube?.dispose();
    this.viewCube = null;
    this.handleLayer.dispose();
    this.triball.dispose();
    this.dom.removeEventListener('pointerup', this.onUp);
    this.dom.removeEventListener('pointermove', this.onMove);
    this.controls.dispose();
    this.sectionView.clear(); this.setMeasure(null);
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
    this.dropThreadGroup();
    this.dropFat(this.threadFocusObj); this.threadFocusObj = null;
    this.dropFat(this.hoverObj); this.hoverObj = null;
    this.dropFeatureHover();
    this.dropFat(this.shapeHover); this.shapeHover = null;
    this.dropFat(this.edgeHighlight); this.edgeHighlight = null;
    this.dropIssueMeshes(); this.dropIssueHover();
    if (this.hiddenEdgeLines) { this.scene.remove(this.hiddenEdgeLines); (this.hiddenEdgeLines.material as THREE.Material).dispose(); this.hiddenEdgeLines = null; }
    for (const o of [this.mesh, this.edgeLines, this.highlight]) {
      if (!o) continue;
      this.scene.remove(o);
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
    this.mesh = this.edgeLines = this.highlight = null;
    if (this.hull) { this.scene.remove(this.hull); (this.hull.material as THREE.Material).dispose(); this.hull = null; }
    this.edgeMats = [];
    this.analysis.dispose();
    this.combLines = [];
    this.baseTints = null;
    this.surfaceFaces = new Set();
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
    return pickFace(this.grouped, h.faceIndex == null ? null : { faceIndex: h.faceIndex });
  }

  /** What a click or hover at this screen position picks: an edge within a few pixels in edge mode (hidden edges are skipped),
   *  else the face under the pointer. */
  private pickName(x: number, y: number): string | null {
    if (this.mode === 'vertex') return this.vertexAtScreen(x, y, 12);
    if (this.mode === 'edge') {
      const i = this.edgeAtScreen(x, y, 8);
      return i === null ? null : this.edges[i].key ?? `edge#${i}`;
    }
    const f = this.nameAt(this.hit(x, y));
    return this.mode === 'body' && f ? this.faceBody.get(f) ?? f : f;
  }

  /** The corner (end of an edge) within a few pixels of the pointer, not hidden behind the body. */
  private vertexAtScreen(x: number, y: number, tolPx: number): string | null {
    if (!this.edges.length) return null;
    const r = this.dom.getBoundingClientRect();
    const px = x - r.left, py = y - r.top;
    const v = new THREE.Vector3();
    let best: { p: number[]; d: number } | null = null;
    for (const e of this.edges) {
      for (const p of [e.pts[0], e.pts[e.pts.length - 1]]) {
        if (!p) continue;
        v.set(p[0], p[1], p[2]).project(this.camera);
        if (v.z > 1) continue;
        const d = Math.hypot(((v.x + 1) / 2) * r.width - px, ((1 - v.y) / 2) * r.height - py);
        if (d <= tolPx && (!best || d < best.d)) best = { p, d };
      }
    }
    if (!best) return null;
    if (this.mesh) {
      const w = new THREE.Vector3(best.p[0], best.p[1], best.p[2]);
      const dir = w.clone().sub(this.camera.position);
      const dist = dir.length();
      this.raycaster.set(this.camera.position, dir.normalize());
      const h = this.raycaster.intersectObject(this.mesh, false)[0];
      if (h && h.distance < dist - Math.max(this.radius() * 0.004, 1e-4)) return null;
    }
    return vertexName(best.p);
  }

  private edgeAtScreen(x: number, y: number, tolPx: number): number | null {
    if (!this.edges.length) return null;
    const r = this.dom.getBoundingClientRect();
    const px = x - r.left, py = y - r.top;
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    let best: { i: number; d: number; t: number; j: number } | null = null;
    const toScreen = (p: number[], out: THREE.Vector3) => { out.set(p[0], p[1], p[2]).project(this.camera); out.x = ((out.x + 1) / 2) * r.width; out.y = ((1 - out.y) / 2) * r.height; };
    for (let i = 0; i < this.edges.length; i++) {
      const pts = this.edges[i].pts;
      for (let j = 0; j + 1 < pts.length; j++) {
        toScreen(pts[j], a); toScreen(pts[j + 1], b);
        if (a.z > 1 || b.z > 1) continue;                       // behind the camera
        const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
        const t = len2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2));
        const d = Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
        if (d <= tolPx && (!best || d < best.d)) best = { i, d, t, j };
      }
    }
    if (!best) return null;
    // hidden behind the body? compare the edge point's distance with the first surface the ray meets there
    if (this.mesh) {
      const pts = this.edges[best.i].pts, p0 = pts[best.j], p1 = pts[best.j + 1];
      const w = new THREE.Vector3(p0[0] + (p1[0] - p0[0]) * best.t, p0[1] + (p1[1] - p0[1]) * best.t, p0[2] + (p1[2] - p0[2]) * best.t);
      const dir = w.clone().sub(this.camera.position);
      const dist = dir.length();
      this.raycaster.set(this.camera.position, dir.normalize());
      const h = this.raycaster.intersectObject(this.mesh, false)[0];
      if (h && h.distance < dist - Math.max(this.radius() * 0.004, 1e-4)) return null;
    }
    return best.i;
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

  private rightDown: { x: number; y: number } | null = null;
  private onRightDown = (e: PointerEvent): void => { this.rightDown = e.button === 2 ? { x: e.clientX, y: e.clientY } : null; };
  /** The canvas context menu: only for a right click that did not pan, and not while a sketch is open (the sketch has its own). */
  private onContext = (e: MouseEvent): void => {
    e.preventDefault();
    const d = this.rightDown;
    this.rightDown = null;
    if (this.sketchEdit || !this.opts.onContextMenu) return;
    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) >= 4) return;
    this.opts.onContextMenu(this.pickName(e.clientX, e.clientY), e.clientX, e.clientY, this.mode);
  };

  /** Move the camera and its target by a screen-space drag, so the point under the pointer follows it. */
  private dragPan(dx: number, dy: number): void {
    const cam = this.camera;
    const target = this.controls.target;
    const dist = cam.position.distanceTo(target);
    const h = this.dom.clientHeight || 1;
    const perPixel = (2 * dist * Math.tan((cam.fov * Math.PI) / 360)) / h;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 1);
    const move = right.multiplyScalar(-dx * perPixel).add(up.multiplyScalar(dy * perPixel));
    cam.position.add(move);
    target.add(move);
    this.controls.update();
    this.dirty = true;
  }

  private onDown = (e: PointerEvent): void => {
    this.down = { x: e.clientX, y: e.clientY };
    if (this.sketchEdit && e.button === 0 && e.pointerType !== 'touch' && (e.metaKey || e.ctrlKey)) { this.modPan = { x: e.clientX, y: e.clientY, moved: false }; this.dom.setPointerCapture(e.pointerId); }
    if (this.sketchEdit && this.sketchTool) return; // a tool is active: clicks go to the tool on release
    if (this.sketchEdit) {
      const id = this.sketchPick(e.clientX, e.clientY);
      if (id) {
        this.sketchDrag = id;
        this.controls.enabled = false; // orbit off while dragging a point
        this.dom.setPointerCapture(e.pointerId);
      } else if (e.button === 0 && e.pointerType !== 'touch') {   // a finger keeps turning the view
        const r = this.dom.getBoundingClientRect();
        this.rubber = { cx: e.clientX, cy: e.clientY, x: e.clientX - r.left, y: e.clientY - r.top, moved: false };
        this.dom.setPointerCapture(e.pointerId);
      }
    }
  };

  private onUp = (e: PointerEvent): void => {
    const d = this.down;
    this.down = null;
    if (this.modPan) {
      const moved = this.modPan.moved;
      this.modPan = null;
      this.dom.style.cursor = '';
      if (moved) {   // the drag was a pan: it is neither a tool click nor a rubber band
        if (this.rubber) { this.rubber = null; this.opts.onSketchBox?.({ phase: 'cancel', x0: 0, y0: 0, x1: 0, y1: 0, crossing: false, u0: 0, v0: 0, u1: 0, v1: 0, mods: { shift: false, ctrl: false, alt: false } } as never); }
        this.sketchDrag = null;
        this.controls.enabled = true;
        return;
      }
    }
    if (this.suppressUp) { this.suppressUp = false; return; }
    if (this.placement && !this.sketchEdit) {
      if (d && e.button === 0 && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) this.placement.tap(e.clientX, e.clientY, { alt: e.altKey });
      return;
    }
    if (this.sketchEdit && this.sketchTool) {
      if (d && e.button === 0 && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) this.emitSketchPointer('click', e);
      return;
    }
    if (this.sketchEdit && this.rubber) {
      const b = this.rubber;
      this.rubber = null;
      try { this.dom.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
      if (b.moved) {
        const r = this.dom.getBoundingClientRect();
        const a = this.planeAt(b.cx, b.cy), z = this.planeAt(e.clientX, e.clientY);
        if (a && z) {
          this.opts.onSketchBox?.({ phase: 'end', x0: b.x, y0: b.y, x1: e.clientX - r.left, y1: e.clientY - r.top, crossing: e.clientX < b.cx, u0: a[0], v0: a[1], u1: z[0], v1: z[1], mods: { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey } });
          return;
        }
        this.opts.onSketchBox?.({ phase: 'cancel', x0: 0, y0: 0, x1: 0, y1: 0, crossing: false, u0: 0, v0: 0, u1: 0, v1: 0, mods: { shift: false, ctrl: false, alt: false } });
        return;
      }
      if (d && e.button === 0 && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) this.emitSketchPointer('click', e, this.opts.onSketchSelect);
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
    if (e.button !== 0) return; // a right click only opens the context menu: it keeps a multi-selection
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) >= 4) return; // a drag, not a click
    const hit0 = this.hit(e.clientX, e.clientY);
    if (!hit0 && this.mode !== 'edge' && this.refPlanes.group.visible) {
      this.raycaster.setFromCamera(this.ndc(e.clientX, e.clientY), this.camera);
      const plane = this.refPlanes.pick(this.raycaster);
      if (plane) { this.opts.onRefPlanePick?.(plane); return; }
    }
    this.lastPick = hit0 ? [hit0.point.x, hit0.point.y, hit0.point.z] : null;
    if (this.pickIntercept) { this.pickIntercept(this.pickName(e.clientX, e.clientY), this.lastPick as [number, number, number] | null); return; }
    // Alt+click on the part selects the whole body (the placement gizmo's target); empty space still deselects
    if (e.altKey && hit0) { this.opts.onPick([BODY], false, this.mode); return; }
    const name = this.pickName(e.clientX, e.clientY);
    this.opts.onPick(name ? [name] : [], e.shiftKey || e.ctrlKey || e.metaKey, this.mode);
  };

  private onMove = (e: PointerEvent): void => {
    if (this.modPan) {
      const m = this.modPan;
      if (!m.moved && Math.hypot(e.clientX - m.x, e.clientY - m.y) >= 4) { m.moved = true; this.dom.style.cursor = 'grabbing'; }
      if (m.moved) { this.dragPan(e.clientX - m.x, e.clientY - m.y); m.x = e.clientX; m.y = e.clientY; return; }
    }
    if (this.placement && !this.sketchEdit) { if (!this.down) this.placement.move(e.clientX, e.clientY, { alt: e.altKey }); return; }
    if (this.sketchEdit && this.sketchTool) { this.emitSketchPointer('move', e); return; }
    if (this.sketchEdit && this.rubber) {
      const b = this.rubber;
      if (!b.moved && Math.hypot(e.clientX - b.cx, e.clientY - b.cy) >= 4) b.moved = true;
      if (b.moved) {
        const r = this.dom.getBoundingClientRect();
        this.opts.onSketchBox?.({ phase: 'move', x0: b.x, y0: b.y, x1: e.clientX - r.left, y1: e.clientY - r.top, crossing: e.clientX < b.cx, u0: 0, v0: 0, u1: 0, v1: 0, mods: { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey } });
      }
      return;
    }
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
      const name = this.pickName(p.x, p.y);
      if (name !== this.lastHover) { this.lastHover = name; this.opts.onHover(name); this.setHover(name); }
    }
    if (this.dirty) {
      this.dirty = false;
      this.fixSpriteScale();
      this.sun.position.copy(this.sunOffset).applyQuaternion(this.camera.quaternion);   // the key light travels with the camera
      this.scene.environmentRotation.setFromQuaternion(this.camera.quaternion);   // the studio stays fixed to the screen, like a lit turntable
      this.renderer.render(this.scene, this.camera);
      this.handleLayer.render(this.renderer);
      this.triball.render();
      this.viewCube?.render(this.camera, this.controls.target);
    }
  };
}
