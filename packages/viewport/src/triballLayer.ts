// The drawn and interactive side of the positioning ball: a 2D canvas laid over the viewport (pointer events pass through
// it; the layer listens on the viewport canvas in the capture phase, like the handle layer, so a handle never orbits the
// camera). It draws the frame from triball.ts, finds the handle under the pointer, runs left and right drags with live
// readouts, Ctrl snapping to increments, typed values, Esc to cancel, and reports everything to a sink that the app implements.
import * as THREE from 'three';
import { NumericEntry, V, type Vec3 } from './handles';
import {
  axisDistance, inPoly, moveFrame, planeMove, snapTo, spinAngle, triGeometry, triHit, type Px, type TriFrame, type TriGeom, type TriScreen, type TriTarget, type HitOptions,
} from './triball';

export type TriGesture =
  | { kind: 'axis'; axis: 0 | 1 | 2 }
  | { kind: 'plane'; axis: 0 | 1 | 2 }
  | { kind: 'spin'; axis: 0 | 1 | 2 | 'view' }
  | { kind: 'frame' };

export interface TriValue {
  /** Axis drag: signed distance along the axis. Plane: the length of the move. */
  distance: number;
  /** Plane drag: the move along the next and the one after the normal's axis. */
  d1: number; d2: number;
  /** Spin: degrees (positive is counter-clockwise looking at the axis tip). */
  angle: number;
  /** The world translation of an axis, plane or frame drag. */
  vec: Vec3;
  /** The world axis a spin turns about. */
  dir: Vec3;
}

export interface TriView {
  frame: TriFrame;
  /** Cyan (travels with the object) or white (detached). */
  attached: boolean;
  /** The selected axis (drawn yellow with a minus dot), or null. */
  axis: number | null;
  off?: HitOptions['off'];
}

export interface TriSink {
  start?(g: TriGesture, button: 'left' | 'right'): void;
  update(g: TriGesture, v: TriValue, button: 'left' | 'right'): void;
  /** Released after a drag. A right drag is expected to open the Move / Copy menu at `at`. */
  end(g: TriGesture, v: TriValue, button: 'left' | 'right', at: { x: number; y: number }): void;
  cancel(): void;
  selectAxis(axis: number | null): void;
  /** Right click (no drag) on a handle, or the ring or interior. */
  context(t: TriTarget | null, at: { x: number; y: number }): void;
  /** The handle under the pointer changed (for the status line). */
  hover?(t: TriTarget | null): void;
  increments(): { distance: number; angle: number };
  /** Text of the live readout for a value ("Distance: 12.5"). */
  label?(g: TriGesture, v: TriValue): string[];
}

const COL = { attached: '#5fd4e6', detached: '#e8edf2', hot: '#f5d90a', dot: '#d92b2b', rim: '#4a1010', axis: ['#e5484d', '#30a46c', '#3e63dd'], stub: '#5fd4e6' };
const zero = (): TriValue => ({ distance: 0, d1: 0, d2: 0, angle: 0, vec: [0, 0, 0], dir: [0, 0, 1] });

interface Drag {
  target: TriTarget; button: 'left' | 'right'; g: TriGesture;
  start: { x: number; y: number };
  r0: { o: Vec3; d: Vec3 };
  p0: Px; moved: boolean; entry: NumericEntry; value: TriValue;
  frame0: TriFrame; spinDir: Vec3;
  /** False for a press that only selects or opens a menu (an orientation dot): no gesture runs. */
  live: boolean;
}

export class TriBallLayer {
  private canvas: HTMLCanvasElement;
  private view: TriView | null = null;
  private sink: TriSink | null = null;
  private hover: TriTarget | null = null;
  private drag: Drag | null = null;
  private lastGeom: TriGeom | null = null;
  private readonly ray = new THREE.Raycaster();

  constructor(private readonly dom: HTMLCanvasElement, private readonly host: HTMLElement, private readonly camera: THREE.PerspectiveCamera, private readonly invalidate: () => void) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'vp-triball';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:5';
    host.appendChild(this.canvas);
    dom.addEventListener('pointerdown', this.onDown, true);
    dom.addEventListener('pointermove', this.onMove, true);
    dom.addEventListener('pointerup', this.onUp, true);
    dom.addEventListener('pointercancel', this.onCancelEvent, true);
    dom.addEventListener('contextmenu', this.onContextMenu, true);
    window.addEventListener('keydown', this.onKey, true);
  }

  get active(): boolean { return this.view !== null; }
  get dragging(): boolean { return this.drag !== null; }

  dispose(): void {
    this.dom.removeEventListener('pointerdown', this.onDown, true);
    this.dom.removeEventListener('pointermove', this.onMove, true);
    this.dom.removeEventListener('pointerup', this.onUp, true);
    this.dom.removeEventListener('pointercancel', this.onCancelEvent, true);
    this.dom.removeEventListener('contextmenu', this.onContextMenu, true);
    window.removeEventListener('keydown', this.onKey, true);
    this.canvas.remove();
  }

  /** Show the ball (null removes it). A drag in progress is cancelled. */
  set(view: TriView | null, sink: TriSink | null): void {
    if (this.drag) this.finish(true);
    this.view = view;
    this.sink = sink;
    this.hover = null;
    this.dom.style.cursor = '';
    this.invalidate();
  }

  /** Update the frame or state without touching the sink. */
  setView(view: TriView | null): void { if (!this.drag) { this.view = view; this.invalidate(); } }

  /** The ball's screen geometry in page pixels (for tests that drive the pointer), or null when it is not drawn. */
  screen(): (TriGeom & { left: number; top: number }) | null {
    const r = this.rect();
    return this.lastGeom ? { ...this.lastGeom, left: r.left, top: r.top } : null;
  }

  // ---- camera helpers ----

  private rect(): DOMRect { return this.dom.getBoundingClientRect(); }
  private scr: TriScreen = {
    project: (p) => {
      const v = new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(this.camera.matrixWorldInverse);
      if (v.z >= -1e-6) return null;
      v.applyMatrix4(this.camera.projectionMatrix);
      const r = this.rect();
      return [((v.x + 1) / 2) * r.width, ((1 - v.y) / 2) * r.height];
    },
    worldPerPx: (p) => {
      const fwd = new THREE.Vector3();
      this.camera.getWorldDirection(fwd);
      const d = (p[0] - this.camera.position.x) * fwd.x + (p[1] - this.camera.position.y) * fwd.y + (p[2] - this.camera.position.z) * fwd.z;
      return (2 * Math.max(d, 1e-6) * Math.tan((this.camera.fov * Math.PI) / 360)) / Math.max(1, this.rect().height);
    },
  };
  private rayAt(x: number, y: number): { o: Vec3; d: Vec3 } {
    const r = this.rect();
    this.ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), this.camera);
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    return { o: [o.x, o.y, o.z], d: [d.x, d.y, d.z] };
  }
  private local(e: { clientX: number; clientY: number }): Px { const r = this.rect(); return [e.clientX - r.left, e.clientY - r.top]; }
  private toCamera(o: Vec3): Vec3 { return V.norm([this.camera.position.x - o[0], this.camera.position.y - o[1], this.camera.position.z - o[2]]); }
  private geom(frame: TriFrame): TriGeom | null { return triGeometry(frame, this.scr); }

  /** The frame as drawn: it follows an attached drag. */
  private shown(): TriFrame | null {
    if (!this.view) return null;
    const d = this.drag;
    if (!d || !d.live) return this.view.frame;
    const f = d.frame0, v = d.value;
    if (d.g.kind === 'spin') return moveFrame(f, { axis: d.spinDir, origin: f.origin, angle: v.angle }, [0, 0, 0]);
    return moveFrame(f, null, v.vec);
  }

  // ---- hit testing ----

  private hitOpts(): HitOptions { return { axis: this.view?.axis ?? null, off: this.view?.off }; }
  private targetAt(e: { clientX: number; clientY: number }, right = false): TriTarget | null {
    if (!this.view) return null;
    const g = this.geom(this.view.frame);
    if (!g) return null;
    const t = triHit(g, this.hitOpts(), this.local(e));
    // an attached ball with no axis selected has nothing to do with a centre press: let the camera have it
    if (t?.kind === 'centre' && this.view.attached && this.view.axis === null && !right) return null;
    return t;
  }

  // ---- gestures ----

  private gestureFor(t: TriTarget): TriGesture | null {
    const v = this.view!;
    switch (t.kind) {
      case 'end': return { kind: 'axis', axis: t.axis };
      case 'plane': return { kind: 'plane', axis: t.axis };
      case 'ring': case 'inner': return { kind: 'spin', axis: v.axis !== null ? (v.axis as 0 | 1 | 2) : 'view' };
      case 'centre': return v.attached ? (v.axis !== null ? { kind: 'axis', axis: v.axis as 0 | 1 | 2 } : null) : { kind: 'frame' };
      default: return null;
    }
  }

  private readValue(d: Drag, e: { clientX: number; clientY: number; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): TriValue {
    const f = d.frame0, o = f.origin;
    const r1 = this.rayAt(e.clientX, e.clientY);
    const v = zero();
    const inc = this.sink?.increments() ?? { distance: 10, angle: 15 };
    const ctrl = e.ctrlKey || e.metaKey;
    const fine = e.shiftKey ? 0.1 : 1;
    const g = d.g;
    const axisDir = (i: number): Vec3 => f.axes[i];
    const alongAxis = (i: number): number => {
      const dir = axisDir(i);
      const gm = this.geom(f);
      const s: Px = gm ? gm.s[i] : [0, 0];
      const p1 = this.local(e);
      let dist = axisDistance(d.r0, r1, o, dir, { delta: [p1[0] - d.p0[0], p1[1] - d.p0[1]], s });
      dist *= fine;
      return ctrl ? snapTo(dist, inc.distance) : dist;
    };
    if (g.kind === 'axis') {
      v.distance = alongAxis(g.axis);
      v.vec = V.mul(axisDir(g.axis), v.distance);
    } else if (g.kind === 'frame') {
      if (this.view!.axis !== null) { v.distance = alongAxis(this.view!.axis); v.vec = V.mul(axisDir(this.view!.axis), v.distance); }
      else {
        const n = V.mul(this.toCamera(o), 1);
        const m = planeMove(d.r0, r1, o, n);
        if (m) v.vec = V.mul(m, fine);
        v.distance = V.len(v.vec);
      }
    } else if (g.kind === 'plane') {
      const n = axisDir(g.axis), u = axisDir((g.axis + 1) % 3), w = axisDir((g.axis + 2) % 3);
      const m = planeMove(d.r0, r1, o, n);
      if (m) {
        let a = V.dot(m, u) * fine, b = V.dot(m, w) * fine;
        if (ctrl) { a = snapTo(a, inc.distance); b = snapTo(b, inc.distance); }
        v.d1 = a; v.d2 = b;
        v.vec = V.add(V.mul(u, a), V.mul(w, b));
        v.distance = V.len(v.vec);
      }
    } else {
      const dir = d.spinDir;
      v.dir = dir;
      let ang = spinAngle(this.geom(f)?.c ?? [0, 0], d.p0, this.local(e), dir, this.toCamera(o));
      ang *= fine;
      v.angle = ctrl ? snapTo(ang, inc.angle) : ang;
    }
    return v;
  }

  /** Apply a typed number to the drag's value. */
  private typed(d: Drag, n: number): void {
    const f = d.frame0;
    const v = d.value;
    if (d.g.kind === 'axis') { v.distance = n; v.vec = V.mul(f.axes[d.g.axis], n); }
    else if (d.g.kind === 'frame' && this.view!.axis !== null) { v.distance = n; v.vec = V.mul(f.axes[this.view!.axis], n); }
    else if (d.g.kind === 'plane') { v.d1 = n; v.d2 = 0; v.vec = V.mul(f.axes[(d.g.axis + 1) % 3], n); v.distance = Math.abs(n); }
    else if (d.g.kind === 'spin') v.angle = n;
  }

  private onDown = (e: PointerEvent): void => {
    this.swallowContext = false;
    if (!this.view || this.drag || (e.button !== 0 && e.button !== 2)) return;
    const t = this.targetAt(e, e.button === 2);
    if (!t) return;
    const button = e.button === 2 ? 'right' : 'left';
    if (button === 'right') this.swallowContext = true;   // macOS opens the context menu on the press, other systems on the release
    const g = t.kind === 'stub' ? null : this.gestureFor(t);
    e.stopImmediatePropagation();
    e.preventDefault();
    this.dom.setPointerCapture(e.pointerId);
    const frame0 = this.view.frame;
    const spinDir: Vec3 = g?.kind === 'spin' ? (g.axis === 'view' ? V.mul(this.toCamera(frame0.origin), 1) : frame0.axes[g.axis]) : [0, 0, 1];
    this.drag = {
      target: t, button, g: g ?? { kind: 'frame' }, start: { x: e.clientX, y: e.clientY }, r0: this.rayAt(e.clientX, e.clientY), p0: this.local(e),
      moved: false, entry: new NumericEntry(), value: zero(), frame0, spinDir, live: g !== null,
    };
    if (!g) this.drag.g = { kind: 'frame' };
        this.invalidate();
  };

  private onMove = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d) {
      if (!this.view) return;
      const t = this.targetAt(e);
      if (JSON.stringify(t) !== JSON.stringify(this.hover)) {
        this.hover = t;
        this.dom.style.cursor = !t ? '' : t.kind === 'plane' ? 'move' : t.kind === 'ring' || t.kind === 'inner' ? 'grab' : 'pointer';
        this.sink?.hover?.(t);
        this.invalidate();
      }
      return;
    }
    e.stopImmediatePropagation();
    if (!d.live) return;
    if (!d.moved && Math.hypot(e.clientX - d.start.x, e.clientY - d.start.y) > 3) {
      d.moved = true;
      this.sink?.start?.(d.g, d.button);
    }
    if (!d.moved || d.entry.active) return;
    d.value = this.readValue(d, e);
    this.sink?.update(d.g, d.value, d.button);
    this.invalidate();
  };

  private onUp = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d) {
      // a plain click in empty space puts an axis selection down (the viewport still gets the click)
      if (this.view && this.view.axis !== null && e.button === 0 && !this.targetAt(e)) {
        this.sink?.selectAxis(null);
      }
      return;
    }
    e.stopImmediatePropagation();
    try { this.dom.releasePointerCapture(e.pointerId); } catch { /* released */ }
    this.finish(false, e);
  };

  private onContextMenu = (e: MouseEvent): void => {
    // the context menu that follows a right press on a handle or a right drag belongs to the ball, never to the canvas
    if (this.swallowContext) { e.preventDefault(); e.stopImmediatePropagation(); }
  };
  private swallowContext = false;

  private onCancelEvent = (): void => { if (this.drag) this.finish(true); };

  private onKey = (e: KeyboardEvent): void => {
    const d = this.drag;
    if (!d) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.finish(true); return; }
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); this.finish(false); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!d.live) return;
    if (d.entry.key(e.key)) {
      e.preventDefault(); e.stopPropagation();
      if (!d.moved) { d.moved = true; this.sink?.start?.(d.g, d.button); }
      const n = d.entry.value;
      if (n !== null) { this.typed(d, n); this.sink?.update(d.g, d.value, d.button); }
      this.invalidate();
    }
  };

  private finish(cancel: boolean, e?: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (d.button === 'right') { this.swallowContext = true; setTimeout(() => { this.swallowContext = false; }, 400); }
    const live = d.live;
    if (cancel) { if (d.moved) this.sink?.cancel(); this.invalidate(); return; }
    const at = e ? { x: e.clientX, y: e.clientY } : { x: d.start.x, y: d.start.y };
    if (!d.moved && !d.entry.active) {
      // a click without a drag
      if (d.button === 'left') {
        if (d.target.kind === 'end') this.sink?.selectAxis(this.view?.axis === d.target.axis ? null : d.target.axis);
      } else this.sink?.context(d.target, at);
      this.invalidate();
      return;
    }
    if (live) this.sink?.end(d.g, d.value, d.button, at);
    this.invalidate();
  }

  // ---- drawing ----

  render(): void {
    const cv = this.canvas;
    const r = this.host.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    this.lastGeom = null;
    const view = this.view;
    const frame = this.shown();
    if (!view || !frame) return;
    const g = this.geom(frame);
    if (!g) return;
    this.lastGeom = g;
    const base = view.attached ? COL.attached : COL.detached;
    const dr = this.drag;
    const hotKey = (t: TriTarget | null): string => (t ? (t.kind === 'plane' || t.kind === 'stub' || t.kind === 'end' ? `${t.kind}${t.axis}` : t.kind) : '');
    const hot = hotKey(dr && dr.live ? dr.target : this.hover);
    const off = view.off;
    ctx.lineJoin = 'round';

    // trail and dimension feedback under everything
    if (dr && dr.moved && dr.live) this.drawFeedback(ctx, dr, g, view);

    // ring
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = hot === 'ring' || hot === 'inner' ? COL.hot : base;
    ctx.beginPath(); ctx.arc(g.c[0], g.c[1], g.ring, 0, Math.PI * 2); ctx.stroke();

    // selected axis: a line through the centre to both ends
    if (view.axis !== null) {
      const i = view.axis;
      ctx.strokeStyle = COL.hot; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(g.minus[i][0], g.minus[i][1]); ctx.lineTo(g.ends[i][0], g.ends[i][1]); ctx.stroke();
    }
    // plane squares with their stub to the end dot
    for (let i = 0; i < 3; i++) {
      const lit = hot === `plane${i}` || (dr?.g.kind === 'plane' && dr.g.axis === i);
      const col = off?.planes?.[i] === false ? 'rgba(160,170,180,.45)' : lit ? COL.hot : base;
      ctx.strokeStyle = col; ctx.lineWidth = 1.25;
      ctx.beginPath(); g.squares[i].forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(g.ends[i][0], g.ends[i][1]); ctx.lineTo(g.squareCentres[i][0], g.squareCentres[i][1]); ctx.stroke();
    }
    // orientation stubs
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = COL.axis[i]; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(g.c[0], g.c[1]); ctx.lineTo(g.stubs[i][0], g.stubs[i][1]); ctx.stroke();
      this.dot(ctx, g.stubs[i], 3.6, hot === `stub${i}` ? COL.hot : base, '#164e5a');
    }
    // axis end dots (and the minus side of the selected one)
    for (let i = 0; i < 3; i++) {
      const dead = off?.axes?.[i] === false;
      const sel = view.axis === i || hot === `end${i}`;
      this.dot(ctx, g.ends[i], 4.2, dead ? '#8b6b6b' : sel ? COL.hot : COL.dot, sel ? '#5a4a00' : COL.rim);
      if (view.axis === i) this.dot(ctx, g.minus[i], 4.2, COL.hot, '#5a4a00');
    }
    this.dot(ctx, g.c, 4.2, hot === 'centre' ? COL.hot : COL.dot, COL.rim);

    // readout
    if (dr && dr.moved && dr.live) {
      const lines = dr.entry.active ? [`${dr.entry.text}▁`] : this.sink?.label?.(dr.g, dr.value) ?? [];
      const at: Px = dr.g.kind === 'spin' ? [g.c[0] + g.ring * 0.6, g.c[1] - g.ring - 14] : [g.c[0] + 14, g.c[1] - g.ring - 14];
      lines.forEach((t, k) => this.text(ctx, t, at[0], at[1] + k * 16));
    }
  }

  private drawFeedback(ctx: CanvasRenderingContext2D, d: Drag, g: TriGeom, view: TriView): void {
    const a0 = this.geom(d.frame0);
    if (!a0) return;
    if (d.g.kind === 'spin') {
      const c = g.c;
      const p0 = d.p0;
      const start = Math.atan2(p0[1] - c[1], p0[0] - c[0]);
      const sweep = -(d.value.angle * Math.PI) / 180 * (V.dot(d.spinDir, this.toCamera(d.frame0.origin)) >= 0 ? 1 : -1);
      ctx.strokeStyle = COL.hot; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(c[0], c[1], g.ring + 6, start, start + sweep, sweep < 0); ctx.stroke();
      return;
    }
    ctx.strokeStyle = view.attached ? COL.attached : COL.detached; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(a0.c[0], a0.c[1]); ctx.lineTo(g.c[0], g.c[1]); ctx.stroke();
    ctx.setLineDash([]);
    this.dot(ctx, a0.c, 3, 'rgba(255,255,255,.75)', '#456');
  }

  private dot(ctx: CanvasRenderingContext2D, p: Px, r: number, fill: string, rim: string): void {
    ctx.fillStyle = fill; ctx.strokeStyle = rim; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }

  private text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number): void {
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(s).width;
    ctx.fillStyle = 'rgba(14,22,30,.82)';
    ctx.fillRect(x - 4, y - 9, w + 8, 18);
    ctx.fillStyle = COL.attached;
    ctx.fillText(s, x, y);
  }
}

export { inPoly };
