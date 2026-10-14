// Pure plane math for the sketch-edit mode: world <-> sketch-plane coordinates,
// pointer rays projected onto the plane, and point picking on the drag overlay.
// No Three.js, no DOM: the viewport turns pointer events into these calls.
import { sketchPolylines, type Frame, type Polyline } from './layers';

/** The shape the overlay draws: solved sketch geometry plus its frame. */
export interface SketchEditShape {
  points: Array<{ id: string; x: number; y: number }>;
  entities: Array<{ id: string; type: string; [key: string]: unknown }>;
}

/** Project a world point onto the frame's plane: [u, v] along frame.x / frame.y. */
export function planeCoords(frame: Frame, p: number[]): [number, number] {
  const d = [p[0] - frame.o[0], p[1] - frame.o[1], p[2] - frame.o[2]];
  const dot = (a: number[]) => d[0] * a[0] + d[1] * a[1] + d[2] * a[2];
  return [dot(frame.x), dot(frame.y)];
}

/** Inverse of planeCoords: [u, v] in the plane to a world point. */
export function planeToWorld(frame: Frame, u: number, v: number): [number, number, number] {
  return [
    frame.o[0] + u * frame.x[0] + v * frame.y[0],
    frame.o[1] + u * frame.x[1] + v * frame.y[1],
    frame.o[2] + u * frame.x[2] + v * frame.y[2],
  ];
}

/** Intersect a world-space ray (origin + t*dir, t >= 0) with the plane.
 *  Returns plane coordinates or null when the ray misses (parallel). */
export function rayPlane(origin: number[], dir: number[], frame: Frame): [number, number] | null {
  const denom = dir[0] * frame.z[0] + dir[1] * frame.z[1] + dir[2] * frame.z[2];
  if (Math.abs(denom) < 1e-12) return null;
  const to = [frame.o[0] - origin[0], frame.o[1] - origin[1], frame.o[2] - origin[2]];
  const t = (to[0] * frame.z[0] + to[1] * frame.z[1] + to[2] * frame.z[2]) / denom;
  if (t < 0) return null;
  return planeCoords(frame, [origin[0] + t * dir[0], origin[1] + t * dir[1], origin[2] + t * dir[2]]);
}

/** Closest point id inside `radius` of (u, v) in plane coordinates, else null. */
export function nearestSketchPoint(
  u: number,
  v: number,
  points: Array<{ id: string; x: number; y: number }>,
  radius: number,
): string | null {
  let best: string | null = null;
  let bestD = radius;
  for (const p of points) {
    const d = Math.hypot(p.x - u, p.y - v);
    if (d <= bestD) {
      bestD = d;
      best = p.id;
    }
  }
  return best;
}

/** Solved entities of the sketch being edited, as world-space polylines. */
export function sketchEditPolylines(sketch: SketchEditShape, frame: Frame): Polyline[] {
  return sketchPolylines([{ id: '', frame, sketch: sketch as never }])[0]?.polylines ?? [];
}

/** World positions of every point in the sketch being edited. */
export function sketchPointWorld(
  points: Array<{ id: string; x: number; y: number }>,
  frame: Frame,
): Array<{ id: string; xyz: [number, number, number] }> {
  return points.map((p) => ({ id: p.id, xyz: planeToWorld(frame, p.x, p.y) }));
}

/**
 * Which side of the sketch plane to look from: +1 along the plane's normal, -1 against it. A sketch is read from
 * outside the part, so the camera goes on the side of the plane facing away from the body (looking at its face);
 * with no body, or a plane through the middle of it, the plane's own normal side.
 */
export function viewSide(frame: Frame, bodyCenter: number[] | null): 1 | -1 {
  if (!bodyCenter) return 1;
  const d = (bodyCenter[0] - frame.o[0]) * frame.z[0] + (bodyCenter[1] - frame.o[1]) * frame.z[1] + (bodyCenter[2] - frame.o[2]) * frame.z[2];
  return d > 1e-6 ? -1 : 1;
}
