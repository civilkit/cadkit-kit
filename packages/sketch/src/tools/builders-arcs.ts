/**
 * Helpers shared by the circle and arc tools. Kernel conventions (read from the solver and confirmed by the
 * real-kernel tests in `arcs.kernel.test.ts`):
 *  - `circle {c, r}`: `r` is a number. `arc {c, p1, p2}` runs COUNTER-CLOCKWISE from p1 to p2 around c; the solver
 *    keeps |c-p1| = |c-p2| itself, so no equal-radius constraint is needed.
 *  - `radius` / `diameter` constraints take refs `[entityId]` (a circle OR an arc) and `value` = the radius, resp.
 *    the diameter. For an arc the radius is |c-p1|.
 *  - `tangent` takes refs `[entityId, entityId]` (line/arc/circle in either order); the shared end point is found
 *    automatically, or named by an extra `at: pointId` field, which these tools always write.
 */
import type { SketchDraft, DraftEntity } from '../index';
import { addConstraintOf, nextId } from './builders';
import type { Pt, PreviewShape } from './types';

const TAU = Math.PI * 2;

export function addCircle(draft: SketchDraft, c: string, r: number): { draft: SketchDraft; id: string } {
  const id = nextId(draft, 'e');
  const entity: DraftEntity = { id, type: 'circle', c, r };
  return { draft: { ...draft, entities: [...draft.entities, entity] }, id };
}

/** Counter-clockwise arc from `p1` to `p2` around `c`. */
export function addArc(draft: SketchDraft, c: string, p1: string, p2: string): { draft: SketchDraft; id: string } {
  const id = nextId(draft, 'e');
  const entity: DraftEntity = { id, type: 'arc', c, p1, p2 };
  return { draft: { ...draft, entities: [...draft.entities, entity] }, id };
}

/** `radius` (value = radius) or `diameter` (value = diameter) on a circle or arc entity. */
export const addSizeConstraint = (draft: SketchDraft, kind: 'radius' | 'diameter', entityId: string, value: number): SketchDraft =>
  addConstraintOf(draft, kind, [entityId], value);

/** Tangent between two entities at their shared end point. */
export function addTangent(draft: SketchDraft, a: string, b: string, at: string): SketchDraft {
  const withIt = addConstraintOf(draft, 'tangent', [a, b]);
  const last = withIt.constraints[withIt.constraints.length - 1];
  return { ...withIt, constraints: [...withIt.constraints.slice(0, -1), { ...last, at }] };
}

export const dist = (a: Pt, b: Pt): number => Math.hypot(b.x - a.x, b.y - a.y);
export const angleOf = (c: Pt, p: Pt): number => Math.atan2(p.y - c.y, p.x - c.x);
/** Counter-clockwise sweep from angle `a0` to `a1`, in [0, 2pi). */
export const sweepCcw = (a0: number, a1: number): number => ((a1 - a0) % TAU + TAU) % TAU;

/** Circle through three points, or null when they are (nearly) collinear or coincide. */
export function circumcircle(a: Pt, b: Pt, c: Pt): { c: Pt; r: number } | null {
  const ab = dist(a, b), bc = dist(b, c);
  if (ab < 1e-9 || bc < 1e-9) return null;
  const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
  if (Math.abs(cross) / (ab * bc) < 1e-9) return null;
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
  const centre = { x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d, y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d };
  return { c: centre, r: dist(centre, a) };
}

/** True when a -> b -> c turns counter-clockwise (so the arc a..c through b runs CCW from a to c). */
export const turnsCcw = (a: Pt, b: Pt, c: Pt): boolean => (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) > 0;

/** Counter-clockwise unit tangent of a circle at `p` (centre `c`). */
export function ccwTangent(c: Pt, p: Pt): Pt {
  const l = dist(c, p) || 1;
  return { x: -(p.y - c.y) / l, y: (p.x - c.x) / l };
}

/** An arc drawn as line segments; the preview vocabulary has no arc shape. */
export function arcPolyline(c: Pt, r: number, a0: number, sweep: number): PreviewShape[] {
  const n = Math.max(4, Math.ceil(sweep / (Math.PI / 24)));
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (sweep * i) / n; pts.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) }); }
  return pts.slice(1).map((b, i) => ({ kind: 'line' as const, a: pts[i], b }));
}

/** Line and arc entities of the draft that end at `pointId` (an end point, not a centre). */
export function ownersAt(draft: SketchDraft, pointId: string): DraftEntity[] {
  return draft.entities.filter((e) => (e.type === 'line' || e.type === 'arc') && (e.p1 === pointId || e.p2 === pointId));
}
