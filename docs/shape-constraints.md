# Constraints between a shape and the body it sits on

## What exists now (GUI only, no kernel change)

The move fields have a **Lock to** list: the few body points nearest the shape (hole centres, corners, edge midpoints). Choosing one
(`lockOps` in `apps/cad/src/handles/sizeBox.ts`):

* adds the point to the shape's sketch the way the Project tool does: a fixed point plus a construction `point` entity, both `ext`;
* ties the profile point nearest to it (a hole's centre point for a hole) with `coincident` when they are at the same place
  (concentric / aligned with that centre), else an `hdist` and a `vdist` holding the offset the shape has now;
* later moves keep those values current (`transformSketch`), and `translateSketch` leaves `ext` geometry where it is.

The distances are ordinary sketch dimensions, so the sketch editor shows and edits them, and the kernel solver holds them on regen.

Limits: the reference is a snapshot of the point (same as Project). If the body changes so the hole moves, the shape does not follow.
A distance from a straight edge ("always 10 mm from the left side") is the same lock to the edge's end point or midpoint, not a
point-to-line distance (`pldist`); a lock needs a profile point, so a shape whose sketch has no free point is refused.

## What needs the kernel (not done)

Associative references: the constraint should name a body element (`{ref: "F2.E5", at: "centre"}`) and follow it.

1. Sketch points/entities with an `extRef` (feature id + topological name + which part: centre / start / end / mid / line) that the
   regen resolves against the body built so far, then feeds to the solver as a fixed point or line (today `ext` only marks a
   constant).
2. Regen order: a sketch on face F reads bodies up to its own place in the tree, which is what its plane already does, so no cycle.
3. Failure mode: the named edge disappears; the constraint reports `unresolved` (like a broken face reference) and the solver drops it.
4. Constraint kinds for the solver: `pldist` to an external line (exists for fixed points), `concentric` to an external circle,
   `pointOnLine`.
5. GUI: Lock to would store the reference instead of a snapshot point; the constraint is shown with a link badge; Project would
   offer "keep linked".

Effort: kernel about 4 to 6 days (resolution and solver inputs, tests with edits upstream), GUI about 2 days on top of the present Lock to.
