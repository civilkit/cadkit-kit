// The drawn and interactive side of the handles: an overlay scene rendered after the model with the depth buffer cleared
// (so handles are never hidden by the part), every widget scaled each frame to a constant size on screen, a hover look,
// pointer capture for dragging, and a live readout. While a handle is hovered or dragged the event is stopped before it
// reaches the orbit controls or the selection code, so a handle never orbits the camera or changes the selection.
import * as THREE from 'three';
import {
  applyMods, beginDrag, defaultStep, DEFAULT_SIZE, formatQuantity, hitHandle, isPlanar, NumericEntry, perpendicular, pixelScale, readDrag, restPosition, shownAt, V,
  type DragState, type HandleDragSink, type HandleMods, type HandleSpec, type Vec3,
} from './handles';

const KIND_COLOUR: Record<HandleSpec['kind'], string> = { arrow: '#2f7fd6', dot: '#f5b400', ring: '#2fa968', plane: '#9b59d0', cube: '#2f7fd6', pad: '#d6409f', wire: '#4da3ff', label: '#ffffff' };

interface Built { spec: HandleSpec; group: THREE.Group; materials: THREE.Material[]; el?: HTMLDivElement; line?: THREE.LineSegments }

function wireGeometry(lines: Vec3[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(lines.flatMap((p) => p), 3));
  return g;
}

/** Dragging the shape itself: where the pointer is on the selected shape's own surface (world point), and the click to hand back to the viewport when the press did not turn into a drag. */
export interface HandleSurface { hit(x: number, y: number): Vec3 | null; click(e: PointerEvent): void }

/** A press on the shape's surface that has not moved far enough to be a drag yet. */
const SURFACE_DRAG_PX = 4;

export class HandleLayer {
  readonly scene = new THREE.Scene();
  private built: Built[] = [];
  private specs: HandleSpec[] = [];
  private sink: HandleDragSink | null = null;
  private hover: string | null = null;
  private drag: { st: DragState; start: { x: number; y: number }; delta: number; vec: Vec3; q: number; moved: boolean; entry: NumericEntry; mods: HandleMods; last: { x: number; y: number } } | null = null;
  private surface: HandleSurface | null = null;
  private press: { x: number; y: number; pid: number; pt: Vec3; spec: HandleSpec } | null = null;
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
    dom.addEventListener('dblclick', this.onDouble, true);
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('keyup', this.onModKey, true);
  }

  get active(): boolean { return this.specs.length > 0; }
  get dragging(): boolean { return this.drag !== null; }

  dispose(): void {
    this.dom.removeEventListener('pointerdown', this.onDown, true);
    this.dom.removeEventListener('pointermove', this.onMove, true);
    this.dom.removeEventListener('pointerup', this.onUp, true);
    this.dom.removeEventListener('pointercancel', this.onCancelEvent, true);
    this.dom.removeEventListener('dblclick', this.onDouble, true);
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('keyup', this.onModKey, true);
    this.clear();
  }

  /** Show these handles (null or empty removes them). A drag in progress is cancelled first. */
  set(specs: HandleSpec[] | null, sink: HandleDragSink | null, surface: HandleSurface | null = null): void {
    if (this.drag) this.finish(true);
    this.press = null;
    this.clear();
    this.specs = specs ?? [];
    this.sink = sink;
    this.surface = specs?.length ? surface : null;
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
      b.el?.remove();
    }
    this.built = [];
    this.hideReadout();
  }

  private add(spec: HandleSpec): void {
    const size = spec.sizePx ?? DEFAULT_SIZE[spec.kind];
    const col = new THREE.Color(spec.color ?? KIND_COLOUR[spec.kind]);
    const materials: THREE.Material[] = [];
    const mat = (opacity = 1) => {
      const m = new THREE.MeshBasicMaterial({ color: col, depthTest: false, depthWrite: false, transparent: true, opacity, side: THREE.DoubleSide });
      materials.push(m);
      return m;
    };
    if (spec.kind === 'label') { this.addLabel(spec); return; }
    if (spec.kind === 'wire') {
      const m = new THREE.LineBasicMaterial({ color: col, depthTest: false, depthWrite: false, transparent: true, opacity: 0.95 });
      materials.push(m);
      const line = new THREE.LineSegments(wireGeometry(spec.lines ?? []), m);
      line.renderOrder = 999;
      line.frustumCulled = false;
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      g.add(line);
      this.scene.add(g);
      this.built.push({ spec, group: g, materials, line });
      return;
    }
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
    } else if (spec.kind === 'pad') {
      // a flat pad: a translucent disc under a four-arrow cross, in the plane of the shape
      put(new THREE.CircleGeometry(size * 1.12, 32), mat(0.3));
      const dark = new THREE.LineBasicMaterial({ color: 0x3a0f2a, depthTest: false, transparent: true });
      materials.push(dark);
      for (let k = 0; k < 4; k++) {
        const pts = [[-0.13, 0.2], [-0.13, 0.6], [-0.4, 0.6], [0, 1], [0.4, 0.6], [0.13, 0.6], [0.13, 0.2]].map(([x, y]) => new THREE.Vector2(x * size, y * size));
        const geo = new THREE.ShapeGeometry(new THREE.Shape(pts));
        geo.rotateZ((k * Math.PI) / 2);
        put(geo, mat());
        const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p.x, p.y, 0))).rotateZ((k * Math.PI) / 2), dark);
        line.renderOrder = 1001;
        group.add(line);
      }
      put(new THREE.PlaneGeometry(size * 0.4, size * 0.4), mat());
    } else if (spec.kind === 'cube' && spec.look === 'diamond') {
      const r = size * 1.5;
      const pts = [new THREE.Vector2(0, r), new THREE.Vector2(r, 0), new THREE.Vector2(0, -r), new THREE.Vector2(-r, 0)];
      put(new THREE.ShapeGeometry(new THREE.Shape(pts)), mat());
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p.x, p.y, 0))), new THREE.LineBasicMaterial({ color: 0x3a2306, depthTest: false, transparent: true }));
      materials.push(line.material as THREE.Material);
      line.renderOrder = 1001;
      group.add(line);
    } else if (spec.kind === 'cube') {
      put(new THREE.BoxGeometry(size * 2, size * 2, size * 2), mat());
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size * 2, size * 2, size * 2)), new THREE.LineBasicMaterial({ color: 0x10202f, depthTest: false, transparent: true }));
      materials.push(edges.material as THREE.Material);
      edges.renderOrder = 1001;
      group.add(edges);
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
      if (s.kind === 'wire') { b.group.matrix.identity(); b.group.matrixWorldNeedsUpdate = true; continue; }
      if (s.kind === 'label') { this.placeLabel(b); continue; }
      const w = this.worldPerPx(s.origin);
      const n = V.norm(s.axis);
      const u = s.kind === 'plane' ? V.norm(s.u ?? perpendicular(n)) : perpendicular(n);
      const v = V.cross(n, u);
      let pos = restPosition(s, w);
      if (this.drag && this.drag.st.spec.id === s.id && !s.follow && (s.kind === 'arrow' || s.kind === 'dot' || s.kind === 'plane' || s.kind === 'cube' || s.kind === 'pad')) pos = V.add(pos, this.drag.vec);
      const hot = this.hover === s.id || this.drag?.st.spec.id === s.id;
      const k = w * (hot ? 1.18 : 1);
      m.makeBasis(new THREE.Vector3(...u), new THREE.Vector3(...v), new THREE.Vector3(...n));
      m.scale(new THREE.Vector3(k, k, k));
      m.setPosition(pos[0], pos[1], pos[2]);
      b.group.matrix.copy(m);
      b.group.matrixWorldNeedsUpdate = true;
      const lift = hot ? 0.45 : 0;
      for (const mt of b.materials) if (mt instanceof THREE.MeshBasicMaterial) mt.color.set(s.color ?? KIND_COLOUR[s.kind]).lerp(new THREE.Color('#ffffff'), lift);
      b.group.visible = (!this.drag || this.drag.st.spec.id === s.id) && shownAt(s, w);
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
    if (!d) {
      // hovering a widget that shows its value (the size box handles)
      const hs = this.hover ? this.specs.find((x) => x.id === this.hover && x.hoverReadout) : undefined;
      if (!hs) { this.hideReadout(); return; }
      this.showReadout();
      this.readout!.textContent = this.sink?.format?.(hs.id, hs.base ?? 0) ?? formatQuantity(hs.base ?? 0, hs.unit);
      const hp = this.project(restPosition(hs, this.worldPerPx(hs.origin)));
      const hr = this.host.getBoundingClientRect();
      if (hp) { this.readout!.style.left = `${hp[0] - hr.left + 14}px`; this.readout!.style.top = `${hp[1] - hr.top - 30}px`; }
      return;
    }
    this.showReadout();
    const el = this.readout!;
    el.textContent = this.readoutText();
    const sp = d.st.spec;
    const w = this.worldPerPx(sp.origin);
    const p = this.project(V.add(restPosition(sp, w), d.vec));
    const hr = this.host.getBoundingClientRect();
    if (p) { el.style.left = `${p[0] - hr.left + 16}px`; el.style.top = `${p[1] - hr.top - 30}px`; }
  }

  // ---- floating number labels (size box): click one to type an exact value ----

  private addLabel(spec: HandleSpec): void {
    const el = document.createElement('div');
    el.className = 'vp-size-label';
    el.dataset.for = spec.forId ?? '';
    el.setAttribute('role', 'button');
    el.title = spec.label ?? '';
    el.style.cssText = `position:absolute;z-index:5;transform:translate(-50%,-50%);padding:1px 6px;border-radius:4px;font:600 11px/1.5 system-ui,sans-serif;white-space:nowrap;cursor:${spec.forId ? 'text' : 'default'};background:var(--panel,rgba(20,24,32,.88));color:var(--text,#fff);border:1px solid ${spec.color ?? '#4da3ff'};user-select:none`;
    el.textContent = spec.text ?? '';
    if (spec.forId) {
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
      el.addEventListener('click', (e) => { e.stopPropagation(); this.editLabel(el, spec.id); });
    }
    this.host.appendChild(el);
    this.built.push({ spec, group: new THREE.Group(), materials: [], el });
  }

  private placeLabel(b: Built): void {
    const el = b.el;
    if (!el) return;
    if (el.querySelector('input')) return;     // being typed into
    const p = this.project(b.spec.origin);
    const hr = this.host.getBoundingClientRect();
    el.style.display = p ? '' : 'none';
    if (p) { el.style.left = `${p[0] - hr.left}px`; el.style.top = `${p[1] - hr.top}px`; }
    if (el.textContent !== (b.spec.text ?? '')) el.textContent = b.spec.text ?? '';
    el.style.visibility = this.drag && this.drag.st.spec.id !== b.spec.forId ? 'hidden' : 'visible';
  }

  private editLabel(el: HTMLDivElement, id: string): void {
    const b = this.built.find((x) => x.spec.id === id);
    const target = b?.spec.forId;
    if (!b || !target || el.querySelector('input')) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = (b.spec.text ?? '').replace(/[^0-9.\-]/g, '');
    input.style.cssText = 'width:64px;font:inherit;color:inherit;background:transparent;border:0;outline:0;text-align:center';
    el.textContent = '';
    el.appendChild(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      const v = Number(input.value.replace(',', '.'));
      input.remove();
      el.textContent = b.spec.text ?? '';
      if (ok && Number.isFinite(v) && input.value.trim() !== '') {
        this.sink?.onStart?.(target);
        this.sink?.onDrag(target, v, [0, 0, 0]);
        this.sink?.onCommit(target, v, [0, 0, 0]);
      }
      this.invalidate();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(false));
  }

  /** Replace the specs by id with the ones the sink says are current (positions, wire, label text). */
  private applyLive(next: HandleSpec[]): void {
    for (const n of next) {
      const b = this.built.find((x) => x.spec.id === n.id);
      if (!b) continue;
      b.spec = n;
      const i = this.specs.findIndex((x) => x.id === n.id);
      if (i >= 0) this.specs[i] = n;
      if (b.line && n.lines) { b.line.geometry.dispose(); b.line.geometry = wireGeometry(n.lines); }
    }
  }

  // ---- interaction ----

  private mods = (e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): HandleMods => ({ shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey });

  private startDrag(spec: HandleSpec, e: PointerEvent, at: { x: number; y: number }, origin?: Vec3): boolean {
    const sp = origin ? { ...spec, origin } : spec;
    const st = beginDrag(sp, this.rayAt(at.x, at.y), this.worldPerPx(sp.origin));
    if (!st) return false;
    this.dom.setPointerCapture(e.pointerId);
    this.drag = { st, start: { x: at.x, y: at.y }, delta: 0, vec: [0, 0, 0], q: spec.base ?? 0, moved: false, entry: new NumericEntry(), mods: this.mods(e), last: { x: at.x, y: at.y } };
    this.sink?.onStart?.(spec.id);
    this.invalidate();
    return true;
  }

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || !this.specs.length || this.drag) return;
    const id = this.hitAt(e.clientX, e.clientY);
    if (!id) {
      // a press on the selected shape's own surface may become a move; a plain click still selects (handed back on release)
      const move = this.surface && e.pointerType !== 'touch' ? this.specs.find((s) => s.kind === 'pad') : undefined;
      const pt = move ? this.surface!.hit(e.clientX, e.clientY) : null;
      if (move && pt) {
        e.stopImmediatePropagation();
        e.preventDefault();
        this.dom.setPointerCapture(e.pointerId);
        this.press = { x: e.clientX, y: e.clientY, pid: e.pointerId, pt, spec: move };
      }
      return;
    }
    const spec = this.specs.find((s) => s.id === id)!;
    e.stopImmediatePropagation();
    e.preventDefault();
    this.startDrag(spec, e, { x: e.clientX, y: e.clientY });
  };

  private qOf(delta: number, spec: HandleSpec): number { return (spec.base ?? 0) + (spec.scale ?? 1) * delta; }

  /** One drag step at pointer position (x, y) with these modifiers. */
  private step(x: number, y: number, mods: HandleMods, shiftKey: boolean, ctrlKey: boolean, metaKey: boolean): void {
    const d = this.drag!;
    d.last = { x, y };
    d.mods = mods;
    if (Math.hypot(x - d.start.x, y - d.start.y) > 2) d.moved = true;
    if (d.entry.active) return;   // a typed number wins until it is cleared
    const r = readDrag(d.st, this.rayAt(x, y));
    if (!r) return;
    const sp = d.st.spec;
    if (sp.reportMods) {
      // the sink reads the modifiers (one axis, grid, no snapping): the drag is the raw pointer move in the plane
      d.vec = r.vec;
      d.q = V.len(r.vec);
      this.sink?.onDrag(sp.id, d.q, d.vec, mods);
      const live = this.sink?.live?.(sp.id, d.q, d.vec, mods);
      if (live) this.applyLive(live);
      this.invalidate();
      return;
    }
    const planar = isPlanar(sp);
    const scale = planar ? 1 : (sp.scale ?? 1);
    const base = planar ? 0 : (sp.base ?? 0);
    const step = this.sink?.step?.(sp.id) ?? defaultStep(sp.unit);
    const snapKey = sp.shiftSnaps ? shiftKey || ctrlKey || metaKey : ctrlKey || metaKey;
    const m = applyMods(r.delta, base, scale, { shift: sp.shiftSnaps ? false : shiftKey, ctrl: snapKey }, step);
    d.delta = m.delta;
    d.q = m.q;
    if (planar && sp.kind === 'cube') {
      // a cube dragged in a plane: Shift (or Ctrl) snaps each in-plane component to the step
      let vec = r.vec;
      if (snapKey && step > 0) {
        const n = V.norm(sp.axis), u = V.norm(sp.u ?? perpendicular(n)), v = V.cross(n, u);
        vec = V.add(V.mul(u, Math.round(V.dot(vec, u) / step) * step), V.mul(v, Math.round(V.dot(vec, v) / step) * step));
      }
      d.vec = vec;
      d.q = V.len(vec);
    } else d.vec = planar ? (shiftKey ? V.mul(r.vec, 0.1) : r.vec) : V.mul(V.norm(sp.axis), m.delta);
    this.sink?.onDrag(sp.id, d.q, d.vec, mods);
    const live = this.sink?.live?.(sp.id, d.q, d.vec, mods);
    if (live) this.applyLive(live);
    this.invalidate();
  }

  private onMove = (e: PointerEvent): void => {
    if (this.press) {
      e.stopImmediatePropagation();
      const p = this.press;
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < SURFACE_DRAG_PX) return;
      this.press = null;
      if (!this.startDrag(p.spec, e, { x: p.x, y: p.y }, p.pt)) { try { this.dom.releasePointerCapture(e.pointerId); } catch { /* released */ } return; }
      this.dom.style.cursor = 'move';
    }
    const d = this.drag;
    if (!d) {
      if (!this.specs.length) return;
      const id = this.hitAt(e.clientX, e.clientY);
      if (id !== this.hover) { this.hover = id; this.dom.style.cursor = id ? 'pointer' : ''; this.invalidate(); }
      else if (!id && this.surface && e.buttons === 0) this.dom.style.cursor = this.surface.hit(e.clientX, e.clientY) ? 'move' : '';
      return;
    }
    e.stopImmediatePropagation();
    this.step(e.clientX, e.clientY, this.mods(e), e.shiftKey, e.ctrlKey, e.metaKey);
  };

  private onUp = (e: PointerEvent): void => {
    if (this.press) {
      const p = this.press;
      this.press = null;
      e.stopImmediatePropagation();
      try { this.dom.releasePointerCapture(p.pid); } catch { /* already released */ }
      this.surface?.click(e);        // a click, not a drag: select as usual
      return;
    }
    if (!this.drag) return;
    e.stopImmediatePropagation();
    try { this.dom.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    this.finish(!this.drag.moved && !this.drag.entry.active);   // a click on a handle without a drag does nothing
  };

  private onCancelEvent = (): void => { this.press = null; if (this.drag) this.finish(true); };

  /** A double click on a handle (the move pad: type the offset). */
  private onDouble = (e: MouseEvent): void => {
    if (!this.specs.length || this.drag) return;
    const id = this.hitAt(e.clientX, e.clientY);
    const spec = id ? this.specs.find((s) => s.id === id) : undefined;
    if (!spec || !this.sink?.onActivate) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    this.sink.onActivate(spec.id);
  };

  /** A modifier pressed or released mid-drag changes the move at once, without the pointer moving. */
  private onModKey = (e: KeyboardEvent): void => {
    const d = this.drag;
    if (!d || !d.st.spec.reportMods || !['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
    this.step(d.last.x, d.last.y, this.mods(e), e.shiftKey, e.ctrlKey, e.metaKey);
  };

  private onKey = (e: KeyboardEvent): void => {
    if (this.press && e.key === 'Escape') { this.press = null; return; }
    const d = this.drag;
    if (!d) return;
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) { if (d.st.spec.reportMods) this.step(d.last.x, d.last.y, this.mods(e), e.shiftKey, e.ctrlKey, e.metaKey); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.finish(true); return; }
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); this.finish(false); return; }
    if (d.st.spec.reportMods) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (d.entry.key(e.key)) {
      e.preventDefault(); e.stopPropagation();
      const v = d.entry.value;
      if (v !== null) {
        const sp = d.st.spec;
        d.q = v;
        const scale = isPlanar(sp) ? 1 : (sp.scale ?? 1);
        const base = isPlanar(sp) ? 0 : (sp.base ?? 0);
        d.delta = scale === 0 ? 0 : (v - base) / scale;
        d.vec = isPlanar(sp) ? V.mul(V.norm(sp.u ?? perpendicular(sp.axis)), v) : V.mul(V.norm(sp.axis), d.delta);
        this.sink?.onDrag(sp.id, d.q, d.vec, d.mods);
        const live = this.sink?.live?.(sp.id, d.q, d.vec, d.mods);
        if (live) this.applyLive(live);
      }
      this.invalidate();
    }
  };

  private finish(cancel: boolean): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.hideReadout();
    this.dom.style.cursor = '';
    const id = d.st.spec.id;
    if (cancel) this.sink?.onCancel(id); else this.sink?.onCommit(id, d.q, d.vec, d.mods);
    this.invalidate();
  }
}
