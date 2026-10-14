// The drawn and interactive side of the handles: an overlay scene rendered after the model with the depth buffer cleared
// (so handles are never hidden by the part), every widget scaled each frame to a constant size on screen, a hover look,
// pointer capture for dragging, and a live readout. While a handle is hovered or dragged the event is stopped before it
// reaches the orbit controls or the selection code, so a handle never orbits the camera or changes the selection.
import * as THREE from 'three';
import {
  applyMods, beginDrag, defaultStep, DEFAULT_SIZE, formatQuantity, hitHandle, NumericEntry, perpendicular, pixelScale, readDrag, restPosition, V,
  type DragState, type HandleDragSink, type HandleSpec, type Vec3,
} from './handles';

const KIND_COLOUR: Record<HandleSpec['kind'], string> = { arrow: '#2f7fd6', dot: '#f5b400', ring: '#2fa968', plane: '#9b59d0' };

interface Built { spec: HandleSpec; group: THREE.Group; materials: THREE.MeshBasicMaterial[] }

export class HandleLayer {
  readonly scene = new THREE.Scene();
  private built: Built[] = [];
  private specs: HandleSpec[] = [];
  private sink: HandleDragSink | null = null;
  private hover: string | null = null;
  private drag: { st: DragState; start: { x: number; y: number }; delta: number; vec: Vec3; q: number; moved: boolean; entry: NumericEntry } | null = null;
  private readout: HTMLDivElement | null = null;
  private readonly ray = new THREE.Raycaster();

  constructor(
    private readonly dom: HTMLCanvasElement,
    private readonly host: HTMLElement,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly invalidate: () => void,
  ) {
    // Registered before the orbit controls' own listeners and in the capture phase: a handle gets the press first.
    dom.addEventListener('pointerdown', this.onDown, true);
    dom.addEventListener('pointermove', this.onMove, true);
    dom.addEventListener('pointerup', this.onUp, true);
    dom.addEventListener('pointercancel', this.onCancelEvent, true);
    window.addEventListener('keydown', this.onKey, true);
  }

  get active(): boolean { return this.specs.length > 0; }
  get dragging(): boolean { return this.drag !== null; }

  dispose(): void {
    this.dom.removeEventListener('pointerdown', this.onDown, true);
    this.dom.removeEventListener('pointermove', this.onMove, true);
    this.dom.removeEventListener('pointerup', this.onUp, true);
    this.dom.removeEventListener('pointercancel', this.onCancelEvent, true);
    window.removeEventListener('keydown', this.onKey, true);
    this.clear();
  }

  /** Show these handles (null or empty removes them). A drag in progress is cancelled first. */
  set(specs: HandleSpec[] | null, sink: HandleDragSink | null): void {
    if (this.drag) this.finish(true);
    this.clear();
    this.specs = specs ?? [];
    this.sink = sink;
    this.hover = null;
    for (const s of this.specs) this.add(s);
    this.dom.style.cursor = '';
    this.invalidate();
  }

  private clear(): void {
    for (const b of this.built) {
      this.scene.remove(b.group);
      b.group.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
      b.materials.forEach((m) => m.dispose());
    }
    this.built = [];
    this.hideReadout();
  }

  private add(spec: HandleSpec): void {
    const size = spec.sizePx ?? DEFAULT_SIZE[spec.kind];
    const col = new THREE.Color(spec.color ?? KIND_COLOUR[spec.kind]);
    const materials: THREE.MeshBasicMaterial[] = [];
    const mat = (opacity = 1) => {
      const m = new THREE.MeshBasicMaterial({ color: col, depthTest: false, depthWrite: false, transparent: true, opacity, side: THREE.DoubleSide });
      materials.push(m);
      return m;
    };
    const group = new THREE.Group();
    group.matrixAutoUpdate = false;
    const put = (geo: THREE.BufferGeometry, m: THREE.MeshBasicMaterial, pos?: [number, number, number]) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.renderOrder = 1000;
      if (pos) mesh.position.set(...pos);
      group.add(mesh);
      return mesh;
    };
    if (spec.kind === 'arrow') {
      const head = Math.min(18, size * 0.26);
      const shaft = put(new THREE.CylinderGeometry(1.8, 1.8, size - head, 10), mat());
      shaft.rotation.x = Math.PI / 2;
      shaft.position.set(0, 0, (size - head) / 2);
      const cone = put(new THREE.ConeGeometry(6.5, head, 16), mat());
      cone.rotation.x = Math.PI / 2;
      cone.position.set(0, 0, size - head / 2);
    } else if (spec.kind === 'dot') {
      put(new THREE.SphereGeometry(size, 20, 14), mat());
      put(new THREE.TorusGeometry(size + 2.5, 1.2, 6, 28), mat(0.55));
    } else if (spec.kind === 'ring') {
      put(new THREE.TorusGeometry(size, 1.8, 8, 72), mat());
    } else {
      const gap = size * 0.6;
      put(new THREE.PlaneGeometry(size, size), mat(0.5), [gap + size / 2, gap + size / 2, 0]);
    }
    this.scene.add(group);
    this.built.push({ spec, group, materials });
  }

  // ---- projection helpers ----

  private rect(): DOMRect { return this.dom.getBoundingClientRect(); }

  private project = (p: Vec3): [number, number] | null => {
    const v = new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(this.camera.matrixWorldInverse);
    if (v.z >= -1e-6) return null;                  // behind the camera
    v.applyMatrix4(this.camera.projectionMatrix);
    const r = this.rect();
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
  };

  private worldPerPx = (p: Vec3): number => {
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    const d = (p[0] - this.camera.position.x) * fwd.x + (p[1] - this.camera.position.y) * fwd.y + (p[2] - this.camera.position.z) * fwd.z;
    return pixelScale(Math.max(d, 1e-6), this.camera.fov, this.rect().height);
  };

  private rayAt(x: number, y: number): { o: Vec3; d: Vec3 } {
    const r = this.rect();
    this.ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), this.camera);
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    return { o: [o.x, o.y, o.z], d: [d.x, d.y, d.z] };
  }

  private hitAt(x: number, y: number): string | null {
    return this.specs.length ? hitHandle(this.specs, this.project, x, y, this.worldPerPx) : null;
  }

  // ---- drawing ----

  /** Place every widget for the current camera; called before the overlay is rendered. */
  update(): void {
    const m = new THREE.Matrix4();
    for (const b of this.built) {
      const s = b.spec;
      const w = this.worldPerPx(s.origin);
      const n = V.norm(s.axis);
      const u = s.kind === 'plane' ? V.norm(s.u ?? perpendicular(n)) : perpendicular(n);
      const v = V.cross(n, u);
      let pos = restPosition(s, w);
      if (this.drag && this.drag.st.spec.id === s.id && (s.kind === 'arrow' || s.kind === 'dot' || s.kind === 'plane')) pos = V.add(pos, this.drag.vec);
      const hot = this.hover === s.id || this.drag?.st.spec.id === s.id;
      const k = w * (hot ? 1.18 : 1);
      m.makeBasis(new THREE.Vector3(...u), new THREE.Vector3(...v), new THREE.Vector3(...n));
      m.scale(new THREE.Vector3(k, k, k));
      m.setPosition(pos[0], pos[1], pos[2]);
      b.group.matrix.copy(m);
      b.group.matrixWorldNeedsUpdate = true;
      const lift = hot ? 0.45 : 0;
      for (const mt of b.materials) mt.color.set(s.color ?? KIND_COLOUR[s.kind]).lerp(new THREE.Color('#ffffff'), lift);
      b.group.visible = !this.drag || this.drag.st.spec.id === s.id;
    }
    this.placeReadout();
  }

  render(renderer: THREE.WebGLRenderer): void {
    if (!this.built.length) return;
    this.update();
    const prev = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = prev;
  }

  // ---- readout ----

  private showReadout(): void {
    if (this.readout) return;
    const el = document.createElement('div');
    el.className = 'vp-handle-readout';
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:absolute;pointer-events:none;z-index:6;padding:2px 7px;border-radius:5px;font:600 12px/1.4 system-ui,sans-serif;white-space:nowrap;background:var(--panel,rgba(20,24,32,.92));color:var(--text,#fff);border:1px solid var(--accent,#2f7fd6);box-shadow:0 2px 8px rgba(0,0,0,.25)';
    this.host.appendChild(el);
    this.readout = el;
  }
  private hideReadout(): void { this.readout?.remove(); this.readout = null; }
  private readoutText(): string {
    const d = this.drag!;
    const sp = d.st.spec;
    const text = this.sink?.format?.(sp.id, d.q) ?? formatQuantity(d.q, sp.unit);
    return d.entry.active ? `${d.entry.text}▁ ${sp.unit === 'deg' ? '°' : 'mm'}` : text;
  }
  private placeReadout(): void {
    const d = this.drag;
    if (!d) { this.hideReadout(); return; }
    this.showReadout();
    const el = this.readout!;
    el.textContent = this.readoutText();
    const sp = d.st.spec;
    const w = this.worldPerPx(sp.origin);
    const p = this.project(V.add(restPosition(sp, w), d.vec));
    const hr = this.host.getBoundingClientRect();
    if (p) { el.style.left = `${p[0] - hr.left + 16}px`; el.style.top = `${p[1] - hr.top - 30}px`; }
  }

  // ---- interaction ----

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || !this.specs.length || this.drag) return;
    const id = this.hitAt(e.clientX, e.clientY);
    if (!id) return;
    const spec = this.specs.find((s) => s.id === id)!;
    const st = beginDrag(spec, this.rayAt(e.clientX, e.clientY), this.worldPerPx(spec.origin));
    if (!st) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    this.dom.setPointerCapture(e.pointerId);
    this.drag = { st, start: { x: e.clientX, y: e.clientY }, delta: 0, vec: [0, 0, 0], q: spec.base ?? 0, moved: false, entry: new NumericEntry() };
    this.sink?.onStart?.(id);
    this.invalidate();
  };

  private qOf(delta: number, spec: HandleSpec): number { return (spec.base ?? 0) + (spec.scale ?? 1) * delta; }

  private onMove = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d) {
      if (!this.specs.length) return;
      const id = this.hitAt(e.clientX, e.clientY);
      if (id !== this.hover) { this.hover = id; this.dom.style.cursor = id ? 'pointer' : ''; this.invalidate(); }
      return;
    }
    e.stopImmediatePropagation();
    if (Math.hypot(e.clientX - d.start.x, e.clientY - d.start.y) > 2) d.moved = true;
    if (d.entry.active) return;   // a typed number wins until it is cleared
    const r = readDrag(d.st, this.rayAt(e.clientX, e.clientY));
    if (!r) return;
    const sp = d.st.spec;
    const scale = sp.kind === 'plane' ? 1 : (sp.scale ?? 1);
    const base = sp.kind === 'plane' ? 0 : (sp.base ?? 0);
    const step = this.sink?.step?.(sp.id) ?? defaultStep(sp.unit);
    const m = applyMods(r.delta, base, scale, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey }, step);
    d.delta = m.delta;
    d.q = m.q;
    d.vec = sp.kind === 'plane' ? (e.shiftKey ? V.mul(r.vec, 0.1) : r.vec) : V.mul(V.norm(sp.axis), m.delta);
    this.sink?.onDrag(sp.id, d.q, d.vec);
    this.invalidate();
  };

  private onUp = (e: PointerEvent): void => {
    if (!this.drag) return;
    e.stopImmediatePropagation();
    try { this.dom.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    this.finish(!this.drag.moved && !this.drag.entry.active);   // a click on a handle without a drag does nothing
  };

  private onCancelEvent = (): void => { if (this.drag) this.finish(true); };

  private onKey = (e: KeyboardEvent): void => {
    const d = this.drag;
    if (!d) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.finish(true); return; }
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); this.finish(false); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (d.entry.key(e.key)) {
      e.preventDefault(); e.stopPropagation();
      const v = d.entry.value;
      if (v !== null) {
        const sp = d.st.spec;
        d.q = v;
        const scale = sp.kind === 'plane' ? 1 : (sp.scale ?? 1);
        const base = sp.kind === 'plane' ? 0 : (sp.base ?? 0);
        d.delta = scale === 0 ? 0 : (v - base) / scale;
        d.vec = sp.kind === 'plane' ? V.mul(V.norm(sp.u ?? perpendicular(sp.axis)), v) : V.mul(V.norm(sp.axis), d.delta);
        this.sink?.onDrag(sp.id, d.q, d.vec);
      }
      this.invalidate();
    }
  };

  private finish(cancel: boolean): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.hideReadout();
    const id = d.st.spec.id;
    if (cancel) this.sink?.onCancel(id); else this.sink?.onCommit(id, d.q, d.vec);
    this.invalidate();
  }
}
