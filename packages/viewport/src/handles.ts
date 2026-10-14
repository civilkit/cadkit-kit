// Direct-manipulation handles: the pure part. A handle is a world-space widget (arrow, dot, ring or plane square) drawn
// on top of the model at a constant size on screen. Dragging it maps the pointer to a number (a distance along its axis,
// an angle about it, or a move in its plane); that number becomes a quantity (`base + scale * delta`) which a session
// turns into a live preview and, on release, one edit. Everything here is plain numbers, so it is tested without WebGL.

export type Vec3 = [number, number, number];
export type HandleKind = 'arrow' | 'dot' | 'ring' | 'plane' | 'cube' | 'wire' | 'label';

export interface HandleSpec {
  id: string;
  kind: HandleKind;
  /** Where the widget sits in the world (a dot is shown `offsetPx` along `axis` from here). */
  origin: Vec3;
  /** Unit vector: the line an arrow or dot slides along, the axis a ring turns about, the normal of a plane square. */
  axis: Vec3;
  /** Plane square only: the first in-plane direction (the second is `axis x u`). */
  u?: Vec3;
  color?: string;
  /** What the number means: millimetres (default) or degrees. */
  unit?: 'mm' | 'deg';
  /** The quantity at rest and how much it changes per unit of drag: `q = base + scale * delta`. Defaults 0 and 1. */
  base?: number;
  scale?: number;
  /** Arrow length, dot radius, ring radius and square size in pixels (sensible defaults per kind). */
  sizePx?: number;
  /** Dot: pixels along `axis` from `origin` (negative = against it), so it sits beside the edge instead of on it. */
  offsetPx?: number;
  /** Tooltip / screen reader text. */
  label?: string;
  /** `cube` only: `line` (default) slides along `axis` like a dot; `plane` moves in the plane whose normal is `axis` (`u` is the first direction). */
  drag?: 'line' | 'plane';
  /** The widget's place comes from the specs the sink's `live` returns while it is dragged (the drag does not move it by itself). */
  follow?: boolean;
  /** `wire` only: segment end points, two per segment, in world space. */
  lines?: Vec3[];
  /** `label` only: the text, and the handle whose value typing into it sets. */
  text?: string;
  forId?: string;
  /** Shift snaps the value to `step` (instead of slowing the drag down). */
  shiftSnaps?: boolean;
  /** Hovering shows the value in the readout (the sink's `format` of `base`). */
  hoverReadout?: boolean;
}

/** A widget that is dragged in a plane (a plane square, or a cube with `drag: 'plane'`) rather than along a line. */
export const isPlanar = (s: HandleSpec): boolean => s.kind === 'plane' || (s.kind === 'cube' && s.drag === 'plane');
/** A widget that is dragged along a line (arrow, dot, cube). */
const isLine = (s: HandleSpec): boolean => s.kind === 'arrow' || s.kind === 'dot' || (s.kind === 'cube' && s.drag !== 'plane');

/** The viewport side of a handle drag: the app implements this (see apps/cad/src/handles). Quantities are `base + scale * delta`. */
export interface HandleDragSink {
  onStart?(id: string): void;
  /** `q` is the quantity now; `delta` the raw drag in the handle's own unit; `vec` the world move (planes) or `axis * delta`. */
  onDrag(id: string, q: number, vec: Vec3): void;
  onCommit(id: string, q: number, vec: Vec3): void;
  onCancel(id: string): void;
  /** Text for the readout next to the handle; default is the number with its unit. */
  format?(id: string, q: number): string;
  /** Snap step for Ctrl (default 1 mm / 15 degrees). */
  step?(id: string): number;
  /** While a drag runs: the specs to show now (a `follow` widget, a `wire` and the labels change with the value). Null keeps what is shown. */
  live?(id: string, q: number, vec: Vec3): HandleSpec[] | null;
}

export const V = {
  add: (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a: Vec3): number => Math.hypot(a[0], a[1], a[2]),
  norm: (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]); return l < 1e-12 ? [0, 0, 1] : [a[0] / l, a[1] / l, a[2] / l]; },
};

/** Some unit vector perpendicular to `a`. */
export function perpendicular(a: Vec3): Vec3 {
  const n = V.norm(a);
  const helper: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return V.norm(V.cross(n, helper));
}

/** World units per screen pixel at distance `dist` in front of the camera: keeps a widget the same size on screen.
 *  Uses the real field of view and distance, so the parallel (very narrow field, far away) view needs no correction. */
export function pixelScale(dist: number, fovDeg: number, heightPx: number): number {
  return (2 * dist * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(1, heightPx);
}

/** Parameter `t` of the point on the line `p + t a` that is nearest to the ray `o + s d` (a is unit). Null when the two are parallel. */
export function rayLineParam(o: Vec3, d: Vec3, p: Vec3, a: Vec3): number | null {
  const w = V.sub(o, p);
  const b = V.dot(d, a), dd = V.dot(d, d), aa = V.dot(a, a);
  const den = dd * aa - b * b;
  if (den < 1e-9 * dd * aa) return null;
  const dw = V.dot(d, w), aw = V.dot(a, w);
  return (aw * dd - b * dw) / den;
}

/** Where the ray meets the plane through `p` with normal `n` (null when parallel or behind the origin). */
export function rayPlanePoint(o: Vec3, d: Vec3, p: Vec3, n: Vec3): Vec3 | null {
  const den = V.dot(d, n);
  if (Math.abs(den) < 1e-9) return null;
  const s = V.dot(V.sub(p, o), n) / den;
  if (s < 0) return null;
  return V.add(o, V.mul(d, s));
}

export interface DragStart { spec: HandleSpec; ray: { o: Vec3; d: Vec3 }; }
export interface DragState {
  spec: HandleSpec;
  /** Where the widget is drawn at rest (dot offset included). */
  rest: Vec3;
  t0: number;
  p0: Vec3 | null;
  r0: Vec3 | null;
}
export interface DragReading { delta: number; vec: Vec3 }

/** The point the widget is drawn at before any drag, in world units (`worldPerPx` converts the dot offset). */
export function restPosition(spec: HandleSpec, worldPerPx: number): Vec3 {
  return spec.kind === 'dot' && spec.offsetPx ? V.add(spec.origin, V.mul(V.norm(spec.axis), spec.offsetPx * worldPerPx)) : spec.origin;
}

/** Begin a drag: remember where on the handle's line, plane or circle the pointer started. Null when the ray cannot reach it. */
export function beginDrag(spec: HandleSpec, ray: { o: Vec3; d: Vec3 }, worldPerPx: number): DragState | null {
  const rest = restPosition(spec, worldPerPx);
  const axis = V.norm(spec.axis);
  if (isLine(spec)) {
    const t0 = rayLineParam(ray.o, ray.d, rest, axis);
    return t0 === null ? null : { spec, rest, t0, p0: null, r0: null };
  }
  const hit = rayPlanePoint(ray.o, ray.d, rest, axis);
  if (!hit) return null;
  if (isPlanar(spec)) return { spec, rest, t0: 0, p0: hit, r0: null };
  const r0 = V.sub(hit, rest);
  if (V.len(r0) < 1e-9) return null;
  return { spec, rest, t0: 0, p0: hit, r0 };
}

/** Map the pointer ray to the drag so far. Null when the ray is parallel to the line or plane (the caller keeps the last reading). */
export function readDrag(st: DragState, ray: { o: Vec3; d: Vec3 }): DragReading | null {
  const axis = V.norm(st.spec.axis);
  if (isLine(st.spec)) {
    const t = rayLineParam(ray.o, ray.d, st.rest, axis);
    if (t === null) return null;
    return { delta: t - st.t0, vec: V.mul(axis, t - st.t0) };
  }
  const hit = rayPlanePoint(ray.o, ray.d, st.rest, axis);
  if (!hit) return null;
  if (isPlanar(st.spec)) {
    const vec = V.sub(hit, st.p0!);
    return { delta: V.len(vec), vec };
  }
  const r = V.sub(hit, st.rest);
  if (V.len(r) < 1e-9) return null;
  const ang = Math.atan2(V.dot(V.cross(st.r0!, r), axis), V.dot(st.r0!, r));
  return { delta: (ang * 180) / Math.PI, vec: V.mul(axis, (ang * 180) / Math.PI) };
}

export interface Mods { shift: boolean; ctrl: boolean }
export const FINE = 0.1;

/** Shift: a tenth of the drag. Ctrl: the quantity snaps to a multiple of `step`. Typed values are never touched. */
export function applyMods(delta: number, base: number, scale: number, mods: Mods, step: number): { delta: number; q: number } {
  let d = mods.shift ? delta * FINE : delta;
  let q = base + scale * d;
  if (mods.ctrl && step > 0) {
    q = Math.round(q / step) * step;
    d = scale === 0 ? d : (q - base) / scale;
  }
  return { delta: d, q: +q.toFixed(9) };
}

export const defaultStep = (unit: 'mm' | 'deg' | undefined): number => (unit === 'deg' ? 15 : 1);

/** The number typed while dragging. Digits, a point and a leading minus; Backspace edits; Enter and Escape are returned to the caller. */
export class NumericEntry {
  text = '';
  get active(): boolean { return this.text.length > 0; }
  get value(): number | null { const n = Number(this.text); return this.text === '' || this.text === '-' || this.text === '.' || !Number.isFinite(n) ? null : n; }
  /** True when the key was used (so it must not reach the shortcuts). */
  key(k: string): boolean {
    if (/^[0-9]$/.test(k)) { this.text += k; return true; }
    if (k === '.' || k === ',') { if (!this.text.includes('.')) this.text += this.text === '' || this.text === '-' ? '0.' : '.'; return true; }
    if (k === '-') { this.text = this.text.startsWith('-') ? this.text.slice(1) : '-' + this.text; return true; }
    if (k === 'Backspace') { this.text = this.text.slice(0, -1); return true; }
    return false;
  }
}

export function formatQuantity(q: number, unit: 'mm' | 'deg' | undefined): string {
  const r = Math.round(q * 100) / 100;
  return unit === 'deg' ? `${r}°` : `${r} mm`;
}

// ---- hit testing (screen space) ----

export type Project = (p: Vec3) => [number, number] | null;

function distToSegment(px: number, py: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

export const DEFAULT_SIZE: Record<HandleKind, number> = { arrow: 70, dot: 8, ring: 64, plane: 22, cube: 5, wire: 0, label: 0 };

/** Points (world) that outline a ring handle. */
export function ringPoints(centre: Vec3, axis: Vec3, radius: number, n = 48): Vec3[] {
  const a = V.norm(axis), u = perpendicular(a), v = V.cross(a, u);
  const out: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    out.push(V.add(centre, V.add(V.mul(u, Math.cos(t) * radius), V.mul(v, Math.sin(t) * radius))));
  }
  return out;
}

/** The four corners (world) of a plane square handle: it spans from the origin along u and v, at an offset from the axes. */
export function planeCorners(spec: HandleSpec, worldPerPx: number): Vec3[] {
  const n = V.norm(spec.axis), u = V.norm(spec.u ?? perpendicular(n)), v = V.cross(n, u);
  const s = (spec.sizePx ?? DEFAULT_SIZE.plane) * worldPerPx;
  const gap = s * 0.6;
  const o = V.add(spec.origin, V.add(V.mul(u, gap), V.mul(v, gap)));
  return [o, V.add(o, V.mul(u, s)), V.add(V.add(o, V.mul(u, s)), V.mul(v, s)), V.add(o, V.mul(v, s))];
}

function inQuad(px: number, py: number, q: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    const [xi, yi] = q[i], [xj, yj] = q[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const PRIORITY: Record<HandleKind, number> = { cube: 0, dot: 0, arrow: 1, plane: 2, ring: 3, wire: 9, label: 9 };

/** The handle under the pointer (pixels), or null. A dot wins over an arrow, an arrow over a plane square, a square over a ring. */
export function hitHandle(specs: HandleSpec[], project: Project, px: number, py: number, worldPerPx: (p: Vec3) => number, tol = 7): string | null {
  let best: { id: string; d: number; pr: number } | null = null;
  for (const s of specs) {
    const w = worldPerPx(s.origin);
    const size = s.sizePx ?? DEFAULT_SIZE[s.kind];
    const axis = V.norm(s.axis);
    let d: number | null = null;
    if (s.kind === 'wire' || s.kind === 'label') continue;
    if (s.kind === 'dot' || s.kind === 'cube') {
      const c = project(restPosition(s, w));
      if (c) { const e = Math.hypot(px - c[0], py - c[1]) - size; d = e <= tol ? Math.max(0, e) : null; }
    } else if (s.kind === 'arrow') {
      const a = project(s.origin), b = project(V.add(s.origin, V.mul(axis, size * w)));
      if (a && b) { const e = distToSegment(px, py, a, b); d = e <= tol ? e : null; }
    } else if (s.kind === 'ring') {
      const pts = ringPoints(s.origin, axis, size * w).map(project);
      let m = Infinity;
      for (let i = 0; i + 1 < pts.length; i++) if (pts[i] && pts[i + 1]) m = Math.min(m, distToSegment(px, py, pts[i]!, pts[i + 1]!));
      d = m <= tol ? m : null;
    } else {
      const q = planeCorners(s, w).map(project);
      if (q.every(Boolean) && inQuad(px, py, q as [number, number][])) d = 0;
    }
    if (d === null) continue;
    const pr = PRIORITY[s.kind];
    if (!best || pr < best.pr || (pr === best.pr && d < best.d)) best = { id: s.id, d, pr };
  }
  return best?.id ?? null;
}
