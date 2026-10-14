/**
 * Turn what a click snapped to into real constraints. A snap only moves the pointer; the constraint is what keeps
 * the sketch that way when it is edited later. After a tool step on a click, any NEW point that sits exactly where
 * the snap said gets the matching constraint:
 *   midpoint -> `midpoint` [point, line]   (the point is the midpoint of that line; kernel convention, see CONSTRAINTS.md)
 *   align    -> `vertical` [point, other]  for a matching x, `horizontal` [point, other] for a matching y
 *   oncurve / perpendicular / tangent -> `pointOnLine` [point, line] or `pointOnCircle` [point, circle or arc]
 *   intersection -> the same, once for each of the two curves
 *   quadrant -> `pointOnCircle` plus `horizontal` / `vertical` [point, centre] (the point sits level with or above the centre)
 * (perpendicular and tangent keep only the point-on-curve part: the direction of the new segment is not constrained.)
 * Existing points are never constrained (a click that reuses a point adds nothing), and a typed value that moved the
 * new point off the snap position adds nothing either.
 */
import type { SketchDraft } from './index';
import { addConstraintOf } from './tools/builders';
import type { SnapHit } from './tools/types';

const EPS = 1e-6;
const HANDLED = new Set(['midpoint', 'align', 'oncurve', 'perpendicular', 'tangent', 'intersection', 'quadrant']);

/** The constraint that puts point `p` on entity `id` (a line, circle or arc); none for other shapes. */
function onEntity(d: SketchDraft, p: string, id: string): SketchDraft {
  const e = d.entities.find((x) => x.id === id);
  if (!e) return d;
  if (e.type === 'line') return addConstraintOf(d, 'pointOnLine', [p, id]);
  if (e.type === 'circle' || e.type === 'arc') return addConstraintOf(d, 'pointOnCircle', [p, id]);
  return d;
}

export function applySnapConstraints(before: SketchDraft, after: SketchDraft, snap: SnapHit | undefined): SketchDraft {
  if (!snap || !HANDLED.has(snap.kind)) return after;
  const known = new Set(before.points.map((p) => p.id));
  // the tool may already have inferred the same horizontal or vertical for this segment: never add it twice
  const had = new Set(before.constraints.map((c) => c.id));
  const inferred = new Set(after.constraints.filter((c) => !had.has(c.id)).map((c) => c.type));
  let d = after;
  for (const p of after.points) {
    if (known.has(p.id)) continue;
    const onX = Math.abs(p.x - snap.at.x) < EPS;
    const onY = Math.abs(p.y - snap.at.y) < EPS;
    if (!onX || !onY) continue;
    if (snap.kind === 'midpoint' && snap.entityId) {
      d = addConstraintOf(d, 'midpoint', [p.id, snap.entityId]);
      break;
    }
    if (snap.kind === 'oncurve' || snap.kind === 'perpendicular' || snap.kind === 'tangent') {
      if (snap.entityId) d = onEntity(d, p.id, snap.entityId);
      break;
    }
    if (snap.kind === 'intersection') {
      for (const id of snap.entityIds ?? []) d = onEntity(d, p.id, id);
      break;
    }
    if (snap.kind === 'quadrant' && snap.entityId) {
      d = onEntity(d, p.id, snap.entityId);
      const e = d.entities.find((x) => x.id === snap.entityId);
      const c = e && typeof e.c === 'string' ? d.points.find((q) => q.id === e.c) : undefined;
      if (c) {
        const level = Math.abs(p.y - c.y) < EPS;
        d = addConstraintOf(d, level ? 'horizontal' : 'vertical', [p.id, c.id]);
      }
      break;
    }
    if (snap.kind === 'align' && snap.alignTo) {
      if (snap.alignTo.x && !inferred.has('vertical')) d = addConstraintOf(d, 'vertical', [p.id, snap.alignTo.x]);
      if (snap.alignTo.y && !inferred.has('horizontal')) d = addConstraintOf(d, 'horizontal', [p.id, snap.alignTo.y]);
      break;
    }
  }
  return d;
}
