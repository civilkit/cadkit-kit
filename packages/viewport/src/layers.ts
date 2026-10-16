// Pure conversion of sketch/curve/plane display data into world-space polylines.
// No Three.js, no DOM: the viewport turns these into scene geometry.
import { bsplineCurve, fitCurve } from '@kit/sketch';
import type { SketchEntity, SketchFeature, SketchPoint } from '@ck/part-model';

export interface Frame {
  o: number[];
  x: number[];
  y: number[];
  z: number[];
}

export interface SketchLayerItem {
  id: string;
  frame: Frame;
  sketch: SketchFeature;
}

export interface CurveLayerItem {
  id: string;
  pts: number[][];
}

export interface PlaneLayerItem {
  id: string;
  frame: Frame;
}

/** One polyline in world coordinates. */
export type Polyline = number[][];

export interface IdPolylines {
  id: string;
  polylines: Polyline[];
}

export interface IdQuad {
  id: string;
  quad: Polyline;
}

const CIRCLE_SEGS = 48;

/** Map sketch-local (u, v) onto the world through the frame: o + u*x + v*y. */
function toWorld(f: Frame, u: number, v: number): number[] {
  return [
    f.o[0] + u * f.x[0] + v * f.y[0],
    f.o[1] + u * f.x[1] + v * f.y[1],
    f.o[2] + u * f.x[2] + v * f.y[2],
  ];
}

/** CCW sweep in (0, 2π], matching the kernel's norm_sweep. */
function sweepOf(from: number, to: number): number {
  let s = to - from;
  while (s <= 1e-12) s += 2 * Math.PI;
  while (s > 2 * Math.PI + 1e-12) s -= 2 * Math.PI;
  return s;
}

function arcPolyline(
  f: Frame,
  cu: number, cv: number, r: number,
  a0: number, sweep: number,
): Polyline {
  const n = Math.max(2, Math.ceil((sweep / (2 * Math.PI)) * CIRCLE_SEGS));
  const out: Polyline = [];
  for (let i = 0; i <= n; i++) {
    const t = a0 + (sweep * i) / n;
    out.push(toWorld(f, cu + r * Math.cos(t), cv + r * Math.sin(t)));
  }
  return out;
}

function entityPolyline(e: SketchEntity, byId: Map<string, SketchPoint>, f: Frame): Polyline | null {
  const pt = (id: string): SketchPoint | undefined => byId.get(id);
  switch (e.type) {
    case 'line': {
      const a = pt(e.p1);
      const b = pt(e.p2);
      if (!a || !b) return null;
      return [toWorld(f, a.x, a.y), toWorld(f, b.x, b.y)];
    }
    case 'circle': {
      const c = pt(e.c);
      if (!c) return null;
      return arcPolyline(f, c.x, c.y, e.r, 0, 2 * Math.PI);
    }
    case 'arc': {
      const c = pt(e.c);
      const a = pt(e.p1);
      const b = pt(e.p2);
      if (!c || !a || !b) return null;
      const a0 = Math.atan2(a.y - c.y, a.x - c.x);
      const a1 = Math.atan2(b.y - c.y, b.x - c.x);
      const r = Math.hypot(a.x - c.x, a.y - c.y);
      return arcPolyline(f, c.x, c.y, r, a0, sweepOf(a0, a1));
    }
    case 'ellipse': {
      const c = pt(e.c);
      const p = pt(e.p);
      if (!c || !p) return null;
      // major semi-axis = |p - c| along (p - c); minor semi-axis = r perpendicular
      const major = Math.hypot(p.x - c.x, p.y - c.y);
      const rot = Math.atan2(p.y - c.y, p.x - c.x);
      const n = CIRCLE_SEGS;
      const out: Polyline = [];
      for (let i = 0; i <= n; i++) {
        const t = (2 * Math.PI * i) / n;
        const u = c.x + major * Math.cos(t) * Math.cos(rot) - e.r * Math.sin(t) * Math.sin(rot);
        const v = c.y + major * Math.cos(t) * Math.sin(rot) + e.r * Math.sin(t) * Math.cos(rot);
        out.push(toWorld(f, u, v));
      }
      return out;
    }
    case 'spline':
    case 'cvspline': {
      // the real curve (the kernel's interpolating spline, or its B-spline with the stored degree), not the point polygon
      const ps: Array<{ x: number; y: number }> = [];
      for (const id of e.pts) {
        const p = pt(id);
        if (!p) return null;
        ps.push({ x: p.x, y: p.y });
      }
      const closed = (e as { closed?: boolean }).closed === true;
      const degree = Number((e as { degree?: number }).degree ?? 3);
      const dense = ps.length >= 2 ? (e.type === 'spline' ? fitCurve(ps, closed, 12) : bsplineCurve(ps, degree, closed, 48)) : [];
      if (dense.length >= 2) return dense.map((q) => toWorld(f, q.x, q.y));
      const out: Polyline = ps.map((q) => toWorld(f, q.x, q.y));
      if (closed && out.length) out.push([...out[0]]);
      return out.length >= 2 ? out : null;
    }
    default:
      return null;
  }
}

/** Sketch features to world-space polylines, one entry per sketch (possibly empty). */
export function sketchPolylines(sketches: SketchLayerItem[]): IdPolylines[] {
  return sketches.map(({ id, frame, sketch }) => {
    const byId = new Map(sketch.points.map((p) => [p.id, p]));
    const polylines: Polyline[] = [];
    for (const e of sketch.entities) {
      const line = entityPolyline(e, byId, frame);
      if (line) polylines.push(line);
    }
    return { id, polylines };
  });
}

/** Kernel curves (already 3D points) to polylines. */
export function curvePolylines(curves: CurveLayerItem[]): IdPolylines[] {
  return curves.map(({ id, pts }) => ({ id, polylines: [pts.map((p) => [...p])] }));
}

/** Datum planes to a square outline in the plane's own x/y axes, closed (5 points). */
export function planeOutlines(planes: PlaneLayerItem[], size: number): IdQuad[] {
  const h = size / 2;
  return planes.map(({ id, frame }) => ({
    id,
    quad: [
      toWorld(frame, -h, -h),
      toWorld(frame, h, -h),
      toWorld(frame, h, h),
      toWorld(frame, -h, h),
      toWorld(frame, -h, -h),
    ],
  }));
}

/** Per plane: three short axis lines from the origin along frame x, y, z. */
export function axisLines(planes: PlaneLayerItem[], size: number): Polyline[] {
  const out: Polyline[] = [];
  for (const { frame } of planes) {
    for (const axis of [frame.x, frame.y, frame.z]) {
      out.push([
        [...frame.o],
        [frame.o[0] + size * axis[0], frame.o[1] + size * axis[1], frame.o[2] + size * axis[2]],
      ]);
    }
  }
  return out;
}
