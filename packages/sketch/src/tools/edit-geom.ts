/**
 * Pure planar geometry for the edit tools (fillet, chamfer, trim, mirror). No draft access here.
 *
 * Conventions (confirmed against the solver in rebuild/crates/ck-model/src/sketch):
 *  - an arc `{c,p1,p2}` runs COUNTER-CLOCKWISE from p1 to p2 around c (mod.rs, `SketchEntity::Arc`);
 *    its sweep is `(angle(p2) - angle(p1))` taken into (0, 2*PI];
 *  - a mirrored arc therefore swaps its end points (reflection reverses the sense of rotation).
 */
import type { Pt } from './types';

export const EPS = 1e-9;
/** Length tolerance for "same place" decisions, in sketch units. */
export const TOL = 1e-7;
export const TAU = Math.PI * 2;

export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
export const scale = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
export const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
export const len = (a: Pt) => Math.hypot(a.x, a.y);
export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Angle in [0, 2*PI). */
export const angleOf = (a: Pt): number => { const t = Math.atan2(a.y, a.x); return t < 0 ? t + TAU : t; };
/** `a` normalised into [0, 2*PI). */
export const wrap = (a: number): number => { const t = a % TAU; return t < 0 ? t + TAU : t; };

export interface LineG { kind: 'line'; a: Pt; b: Pt }
export interface CircleG { kind: 'circle'; c: Pt; r: number }
/** Counter-clockwise from p1 to p2 around c. */
export interface ArcG { kind: 'arc'; c: Pt; r: number; p1: Pt; p2: Pt }
export type CurveG = LineG | CircleG | ArcG;

export const arcStart = (g: ArcG) => angleOf(sub(g.p1, g.c));
/** Sweep in (0, 2*PI]. */
export function arcSweep(g: ArcG): number {
  const s = wrap(angleOf(sub(g.p2, g.c)) - arcStart(g));
  return s < EPS ? TAU : s;
}
const atAngle = (c: Pt, r: number, t: number): Pt => ({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) });

/** Is the angle `t` on the arc (end points inclusive within a small tolerance)? */
export function onArc(g: ArcG, t: number): boolean {
  const off = wrap(t - arcStart(g));
  const sw = arcSweep(g);
  const tol = TOL / Math.max(g.r, EPS);
  return off <= sw + tol || off >= TAU - tol;
}

/** Line (a,b) vs line (c,d), segments. Parallel and near-parallel (sin of the angle < 1e-9) give none. */
export function lineLine(a: Pt, b: Pt, c: Pt, d: Pt): Pt[] {
  const r = sub(b, a), s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) <= 1e-9 * len(r) * len(s) || den === 0) return [];
  const q = sub(c, a);
  const t = cross(q, s) / den;
  const u = cross(q, r) / den;
  const tt = TOL / len(r), tu = TOL / len(s);
  if (t < -tt || t > 1 + tt || u < -tu || u > 1 + tu) return [];
  return [add(a, scale(r, Math.min(1, Math.max(0, t))))];
}

/** Segment (a,b) vs full circle. A grazing line (distance within tolerance of r) returns the one touch point. */
export function lineCircle(a: Pt, b: Pt, c: Pt, r: number): Pt[] {
  const d = sub(b, a);
  const l = len(d);
  if (l < EPS) return [];
  const u = scale(d, 1 / l);
  const f = sub(a, c);
  const tc = -dot(f, u);                       // parameter (length units) of the closest point
  const h = Math.abs(cross(f, u));             // distance centre to line
  const tol = TOL * Math.max(1, r);
  let ts: number[];
  if (Math.abs(h - r) <= tol) ts = [tc];
  else if (h > r) return [];
  else { const w = Math.sqrt(r * r - h * h); ts = [tc - w, tc + w]; }
  return ts.filter((t) => t >= -TOL && t <= l + TOL).map((t) => add(a, scale(u, Math.min(l, Math.max(0, t)))));
}

/** Two full circles. Tangent touch (external or internal) returns the single touch point. Concentric: none. */
export function circleCircle(c1: Pt, r1: number, c2: Pt, r2: number): Pt[] {
  const d = dist(c1, c2);
  if (d < EPS) return [];
  const tol = TOL * Math.max(1, r1, r2);
  if (d > r1 + r2 + tol || d < Math.abs(r1 - r2) - tol) return [];
  const u = scale(sub(c2, c1), 1 / d);
  const x = (d * d + r1 * r1 - r2 * r2) / (2 * d);
  const h2 = r1 * r1 - x * x;
  const base = add(c1, scale(u, x));
  if (h2 <= tol * tol || Math.abs(d - (r1 + r2)) <= tol || Math.abs(d - Math.abs(r1 - r2)) <= tol) return [base];
  const h = Math.sqrt(h2);
  const n = { x: -u.y, y: u.x };
  return [add(base, scale(n, h)), add(base, scale(n, -h))];
}

const keepOnArc = (g: ArcG, pts: Pt[]): Pt[] => pts.filter((p) => onArc(g, angleOf(sub(p, g.c))));

export const lineArc = (a: Pt, b: Pt, g: ArcG): Pt[] => keepOnArc(g, lineCircle(a, b, g.c, g.r));
export const arcArc = (g: ArcG, h: ArcG): Pt[] => keepOnArc(g, circleCircle(g.c, g.r, h.c, h.r)).filter((p) => onArc(h, angleOf(sub(p, h.c))));
export const circleArc = (c: Pt, r: number, h: ArcG): Pt[] => keepOnArc(h, circleCircle(c, r, h.c, h.r));

/** Intersection points of any two supported curves. */
export function intersect(p: CurveG, q: CurveG): Pt[] {
  if (p.kind === 'line' && q.kind === 'line') return lineLine(p.a, p.b, q.a, q.b);
  if (p.kind === 'line' && q.kind === 'circle') return lineCircle(p.a, p.b, q.c, q.r);
  if (p.kind === 'line' && q.kind === 'arc') return lineArc(p.a, p.b, q);
  if (p.kind === 'circle' && q.kind === 'line') return lineCircle(q.a, q.b, p.c, p.r);
  if (p.kind === 'arc' && q.kind === 'line') return lineArc(q.a, q.b, p);
  if (p.kind === 'circle' && q.kind === 'circle') return circleCircle(p.c, p.r, q.c, q.r);
  if (p.kind === 'circle' && q.kind === 'arc') return circleArc(p.c, p.r, q);
  if (p.kind === 'arc' && q.kind === 'circle') return circleArc(q.c, q.r, p);
  if (p.kind === 'arc' && q.kind === 'arc') return arcArc(p, q);
  return [];
}

/** Position of a point along a curve: line = length from a; arc = counter-clockwise angle from p1; circle = angle from +x. */
export function paramOf(g: CurveG, p: Pt): number {
  if (g.kind === 'line') { const d = sub(g.b, g.a); const l = len(d); return dot(sub(p, g.a), d) / l; }
  if (g.kind === 'arc') return wrap(angleOf(sub(p, g.c)) - arcStart(g));
  return angleOf(sub(p, g.c));
}
export function pointAt(g: CurveG, t: number): Pt {
  if (g.kind === 'line') { const d = sub(g.b, g.a); return add(g.a, scale(d, t / len(d))); }
  if (g.kind === 'arc') return atAngle(g.c, g.r, arcStart(g) + t);
  return atAngle(g.c, g.r, t);
}
/** Parameter range of the curve: line [0,length], arc [0,sweep], circle [0,2*PI). */
export const paramEnd = (g: CurveG): number => (g.kind === 'line' ? dist(g.a, g.b) : g.kind === 'arc' ? arcSweep(g) : TAU);

/** Reflect a point over the infinite line through a and b. */
export function reflect(p: Pt, a: Pt, b: Pt): Pt {
  const u = scale(sub(b, a), 1 / len(sub(b, a)));
  const v = sub(p, a);
  const along = scale(u, dot(v, u));
  const foot = add(a, along);
  return { x: 2 * foot.x - p.x, y: 2 * foot.y - p.y };
}
/** Distance from a point to the infinite line through a and b. */
export const distToLine = (p: Pt, a: Pt, b: Pt): number => Math.abs(cross(sub(p, a), sub(b, a))) / len(sub(b, a));

export interface Corner {
  /** unit directions from the corner along line A and line B */
  u: Pt; v: Pt;
  /** tangent / cut points on A and B */
  t1: Pt; t2: Pt;
  /** fillet centre (undefined for a chamfer) */
  c?: Pt;
  /** the fillet needs the whole of line A / B (within TOL): the line is used up and the arc ends on its far end */
  wholeA?: boolean; wholeB?: boolean;
}
/** sin of the corner angle below which two lines count as in line (2e-6 rad) */
export const PARALLEL_SIN = 2e-6;
export type CornerFail = 'parallel' | 'tooLarge' | 'degenerate';

/**
 * Corner at `s` between the line towards `a` and the line towards `b`. `kind` 'fillet': tangent arc of
 * radius `amount`; 'chamfer': cut at distance `amount` along both lines. Fails with 'parallel' (collinear or
 * parallel lines), 'tooLarge' (the cut would consume a whole line) or 'degenerate' (amount <= 0 / zero-length line).
 */
export function cornerGeometry(s: Pt, a: Pt, b: Pt, kind: 'fillet' | 'chamfer', amount: number): Corner | CornerFail {
  const la = dist(s, a), lb = dist(s, b);
  if (!(amount > EPS) || la < TOL || lb < TOL) return 'degenerate';
  const u = scale(sub(a, s), 1 / la), v = scale(sub(b, s), 1 / lb);
  const sinT = Math.abs(cross(u, v));
  // lines lying on each other or in line (within PARALLEL_SIN) are no corner: the cut would be a hair long
  if (sinT < PARALLEL_SIN) return 'parallel';
  const cosT = dot(u, v);
  const theta = Math.atan2(sinT, cosT);        // interior angle between the lines, (0, PI)
  const reach = kind === 'fillet' ? amount / Math.tan(theta / 2) : amount;
  // a fillet that needs exactly what is left of a line (half a side after the first corner) takes that line
  const wholeA = kind === 'fillet' && Math.abs(reach - la) <= TOL, wholeB = kind === 'fillet' && Math.abs(reach - lb) <= TOL;
  if (kind === 'fillet' ? reach > Math.min(la, lb) + TOL : reach >= Math.min(la, lb) - TOL) return 'tooLarge';
  const t1 = wholeA ? a : add(s, scale(u, reach)), t2 = wholeB ? b : add(s, scale(v, reach));
  if (kind === 'chamfer') return { u, v, t1, t2 };
  const w = scale(add(u, v), 1 / len(add(u, v)));
  return { u, v, t1, t2, c: add(s, scale(w, amount / Math.sin(theta / 2))), ...(wholeA ? { wholeA } : {}), ...(wholeB ? { wholeB } : {}) };
}

/** Polyline preview of a curve piece between two parameters (circle/arc), as line segments. */
export function sample(g: CurveG, t0: number, t1: number, steps = 24): Array<{ a: Pt; b: Pt }> {
  const out: Array<{ a: Pt; b: Pt }> = [];
  if (g.kind === 'line') return [{ a: pointAt(g, t0), b: pointAt(g, t1) }];
  const n = Math.max(2, Math.ceil(steps * Math.abs(t1 - t0) / TAU) + 1);
  let prev = pointAt(g, t0);
  for (let i = 1; i <= n; i++) { const p = pointAt(g, t0 + (t1 - t0) * i / n); out.push({ a: prev, b: p }); prev = p; }
  return out;
}

/** The nearest point of a line segment, or of a circle / arc (the arc's ends when the pointer is off its span). */
export function nearestOn(g: CurveG, p: Pt): Pt | null {
  if (g.kind === 'line') {
    const d = sub(g.b, g.a), l2 = dot(d, d);
    if (l2 < 1e-18) return null;
    const t = Math.max(0, Math.min(1, dot(sub(p, g.a), d) / l2));
    return { x: g.a.x + d.x * t, y: g.a.y + d.y * t };
  }
  const v = sub(p, g.c);
  const l = len(v);
  if (l < 1e-12) return null;
  const t = angleOf(v);
  if (g.kind === 'arc' && !onArc(g, t)) return dist(p, g.p1) <= dist(p, g.p2) ? { ...g.p1 } : { ...g.p2 };
  return { x: g.c.x + (v.x / l) * g.r, y: g.c.y + (v.y / l) * g.r };
}

