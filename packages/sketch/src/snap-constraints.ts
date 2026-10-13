/**
 * Turn what a click snapped to into real constraints. A snap only moves the pointer; the constraint is what keeps
 * the sketch that way when it is edited later. After a tool step on a click, any NEW point that sits exactly where
 * the snap said gets the matching constraint:
 *   midpoint -> `midpoint` [point, line]   (the point is the midpoint of that line; kernel convention, see CONSTRAINTS.md)
 *   align    -> `vertical` [point, other]  for a matching x, `horizontal` [point, other] for a matching y
 * Existing points are never constrained (a click that reuses a point adds nothing), and a typed value that moved the
 * new point off the snap position adds nothing either.
 */
import type { SketchDraft } from './index';
import { addConstraintOf } from './tools/builders';
import type { SnapHit } from './tools/types';

const EPS = 1e-6;

export function applySnapConstraints(before: SketchDraft, after: SketchDraft, snap: SnapHit | undefined): SketchDraft {
  if (!snap || (snap.kind !== 'midpoint' && snap.kind !== 'align')) return after;
  const known = new Set(before.points.map((p) => p.id));
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
    if (snap.kind === 'align' && snap.alignTo) {
      if (snap.alignTo.x) d = addConstraintOf(d, 'vertical', [p.id, snap.alignTo.x]);
      if (snap.alignTo.y) d = addConstraintOf(d, 'horizontal', [p.id, snap.alignTo.y]);
      break;
    }
  }
  return d;
}
