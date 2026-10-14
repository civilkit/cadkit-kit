# Offset of reference geometry (body edges, face outline, earlier sketches)

Offset used to pick only entities already in the sketch being edited, and only through a midpoint snap (the app
passed `snap.entityId` for midpoints only), so on a fresh sketch on a face nothing could be selected. It now picks:

- **Entities of the current sketch**: lines, arcs, circles and now a **spline** (open or closed, on its own; a chain that mixes a
  spline with lines or arcs gets a hint). The app resolves the curve under the pointer for the Offset tool.
- **Reference geometry**: the edges of the body and the curves of **other sketches** (including sketches an extrude has used,
  which are not drawn or pickable in the 3D view). Hover highlights the whole outline (edges in the same plane joined end to
  end), a click projects it into the sketch (fixed, `ext`, a real outline rather than construction, so the ring between it and
  its offset is a region the extrude / cut Shapes list offers) and selects it. Then the usual Enter, side and distance
  (typed, or dragged with the pointer; `F` flips the side) apply. Project uses the same candidates, so old sketch curves are
  projectable too.
- **Offset the face outline**: choosing Offset in a sketch started on a planar face (the face was selected) takes that face's
  outer loop, inward, with the distance box showing 1 mm; Enter applies, a typed value changes it, `F` flips, Escape drops the
  typed value so the pointer drives the distance.

## Splines

The copy of a fit spline is a new fit spline through points taken on the exact offset curve (resampled by arc length, more
points until it is within 5e-4 of the size; at most 48). It is a free spline (not linked to the original); lines, arcs and circles
keep their distance / radius-difference constraints to the (fixed) reference. When the distance exceeds the local radius of
curvature, or two sides of a narrow neck would cross, nothing is drawn and the hint says the offset folds over itself.
Several free-form kernel edges that form one smooth outline are joined into one spline before offsetting.

## Limits

- A reference outline that mixes free-form edges with lines / arcs is projected edge by edge; offsetting it says to pick the spline alone.
- Reference curves are a snapshot (projected, fixed); the tessellation of a free-form body edge limits how exactly a projected
  spline follows it (at most 48 fit points).
- Extruding the ring as an **add / cut on a free-form (spline) solid** failed in the kernel build tested (`booleanFailed`, also for
  an unrelated spline pocket), so only the ring sketch itself is verified as extruding to the correct volume.
- Trim and Extend still pick only sketch entities (they use the same app-side curve pick now only for Offset).
