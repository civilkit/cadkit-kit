# Sketch constraints: the `refs` conventions

Every row below was read from `crates/ck-model/src/sketch/solver.rs` and then proven against the real kernel in
`constraints.kernel.test.ts` (a small sketch, the constraint applied, the solved coordinates checked). A constraint is
`{ id, type, refs: string[], value?, ...extra }`. "point" means a sketch point id (`p1`), "line" / "circle" / "arc" an
entity id (`e1`). Where the solver says "pointish", a circle or arc id also works and stands for its centre, and so does
a `point` entity id.

## Table

| type | refs (in this order) | value | extra fields | what the solver enforces (verified) |
|---|---|---|---|---|
| `horizontal` | `[line]` or `[pointA, pointB]` | none | | the two ends (or the two points) get the same y. 1 ref = a line, 2 refs = two points |
| `vertical` | `[line]` or `[pointA, pointB]` | none | | same x |
| `coincident` | `[pointA, pointB]` | none | | the points are equal. A circle/arc id works as its centre |
| `concentric` | `[curveA, curveB]` | none | | identical to `coincident` in the solver (same code): the two centres are equal. Circle, arc or point ids |
| `equal` | `[A, B]`, both lines or both circle/arc | none | | line length equal, or radius equal. A line against a circle is accepted by the kernel (length = radius); the tools refuse it |
| `parallel` | `[lineA, lineB]` | none | | cross product of the directions is 0. Lines only |
| `perpendicular` | `[lineA, lineB]` | none | | dot product of the directions is 0. Lines only |
| `collinear` | `[lineA, lineB]` | none | | both ends of B lie on the infinite line A |
| `midpoint` | `[point, line]` (point FIRST) | none | | the point is the midpoint of the line |
| `tangent` | `[A, B]`: line+circle, line+arc, circle/arc+circle/arc, either order | none | `internal: true`, `at: pointId` | see below |
| `symmetric` | `[pointA, pointB, axisLine]` | none | | A and B are mirror images in the axis line |
| `fix` | `[point]` | **`[x, y]`** (the target position, an array) | | the point is pinned to `[x, y]`. It is a constraint, not a flag; the alternative is `fixed: true` on the point itself (a constant for the solver) |
| `pointOnLine` | `[point, line]` | none | | the point lies on the infinite line (not in the tools, verified) |
| `pointOnCircle` | `[point, circleOrArc]` | none | | the point is at radius from the centre (not in the tools, verified) |
| `distance` | `[pointA, pointB]` | length | | euclidean distance. A circle/arc id works as its centre |
| `hdist` / `vdist` | `[pointA, pointB]` | length | | `abs(xB - xA)` / `abs(yB - yA)`: the value is absolute, the side the points start on is kept |
| `pldist` | `[point, line]` (point first) | length | | absolute distance from the point to the infinite line |
| `radius` | `[circleOrArc]` | length | | radius. For an arc, the distance of both ends from the centre |
| `diameter` | `[circleOrArc]` | length | | 2 x radius. The stored `r` of a circle is the radius, so a diameter of 8 gives `r = 4` |
| `angle` | `[lineA, lineB]` | **degrees** | `s1`, `s2` (each `1` or `-1`) | see below |

Kernel types not verified here and not used by any tool yet: `pierce` (same as `fix`), `raddiff`, `g1`/`g2`/`g3`,
`onCurve`, `tension`. Any unknown `type`, or a ref that does not resolve (missing point, a point where a line is
needed), makes the whole sketch silently unsolved: `status.solved` is false and no error is raised.

### tangent

- No shared end point: line+curve means `distance(centre, line) = radius`; curve+curve means `centre distance = r1 + r2`
  (external, the default) or `abs(r1 - r2)` when `internal: true` (one circle inside the other). The tools set
  `internal` by looking at which of the two the current geometry is closer to.
- Shared end point (a line and an arc, or two arcs, that have an end point id in common): the constraint becomes a
  tangency AT that point (the line is perpendicular to the radius there). `at: pointId` picks the point when several
  are shared; without it the first shared end is used. `internal` is ignored in this case.
- A line and a line is an error (silently unsolved; read from the solver code, not run).

### angle

- `value` is **degrees**: `a = value * pi / 180`.
- It fixes the signed turn from line A to line B, counter-clockwise positive, where each line is read as the vector
  `p1 -> p2` of its entity, multiplied by `s1` (line A) or `s2` (line B). `s` defaults to 1. Verified: 60 gives
  exactly a 60 degree counter-clockwise turn, 300 gives -60.
- It is the angle between the DIRECTIONS, so for two lines that meet end to end (A to B, then B to C) the default
  `s1 = s2 = 1` gives the EXTERIOR (turning) angle, i.e. 180 minus the interior angle. To dimension the INTERIOR
  angle at the shared vertex, read both lines away from it: `s = -1` for a line whose `p2` is the vertex (verified: refs
  `[BC, AB]`, `s2: -1`, value 40 gave an interior angle of 40).
- The residual is `sin(turn - value)`, so it has two roots, `value` and `value + 180`, and the solver goes to the one
  nearer the current geometry. If the current turn is clockwise (negative) and the value is small, it lands on the
  anti-parallel root (verified: interior 40 requested, 140 obtained). `angleSpec` in `constraints.ts` therefore orders
  the refs and picks the signs so that the present turn is counter-clockwise (0..180); use it instead of choosing
  refs by hand. Large jumps of the value (more than about 90 degrees from the present angle) can still end on the wrong
  root.

## Solving: what the kernel does and does not return

- `Session.preview([], { sketchStatus: true })` returns `body.sketches[i].status` (`SketchSolverStatus`: `dof`, `state`
  `under|full|over`, `conflicts`, `redundant`, `solved`, `residual`) for every sketch **but only if the part has a
  solid** (otherwise `body` is null). The kernel does not solve a sketch at regen: `sketches[i].sketch.points` are
  echoed exactly as given. It re-solves only when a constraint carries an `expr` whose value differs from its stored
  `value` (a missing `value` counts as changed); then the reply holds the solved coordinates. `status.solved` is
  therefore "the coordinates satisfy every constraint, or a solve from them converges", not "the reply is solved"
  (verified: perpendicular added to a skewed pair gives `solved: true`, `residual` about 1, coordinates unchanged).
- Consequence: appending a constraint changes the sketch's meaning, not its drawn geometry. Somebody (the
  controller) has to ask for a solve if the viewport should move. The only kernel-side way today is the `expr`
  trigger above; `constraints.kernel.test.ts` uses exactly that (`regen(..., solveAll)`) as its solving oracle.
  The solver weights nothing: every non-`fixed` point moves minimum-norm, so pin what must stay with `fixed: true` or
  a `fix` constraint, otherwise the whole sketch shifts.
- Over-constraint: `conflicts` lists constraints that cannot hold together with earlier ones (the LATER constraint is
  blamed, so a just-added constraint is the one reported, `reportStatus(status, addedId).blamesAdded`); `redundant`
  lists implied ones; both make `state: 'over'`. `reportStatus` maps this to hints
  `app.sketch.hint.status.overConstrained | redundant | unsolved | fullyDefined`.
- A solve that would shrink a line or circle to a point (`horizontal` and `vertical` on one line, a rectangle corner
  made the midpoint of the opposite side, a dragged end put on its line's own midpoint) is not taken by the kernel:
  the coordinates stay, `solved: false`, and `status.problems` carries `sketchCurveShrunk` naming the curve. The
  controller then leaves the edit out and shows `app.sketch.problem.curveShrunk` (`problemHint`, `refusedBy`). The
  tools also refuse the direct forms up front (`constraint.conflict`, `pick.ownEnd`, `pick.lineEnds`).
- A 2D sketch uses `x`, `y` of the plane; a circle's unknown is `r`; `dof = free coordinates + radii - rank`.

## How the tools use these (constraint-tools.ts, dimension.ts)

| tool | picks | writes |
|---|---|---|
| horizontal, vertical | a line, or two points | `[line]` / `[pointA, pointB]` |
| coincident | two points | `[pointA, pointB]` |
| concentric | circle/arc/point, circle/arc/point (at least one curve) | `[A, B]` as picked |
| equal | two lines, or two circle/arc | `[A, B]` |
| parallel, perpendicular, collinear | two lines | `[A, B]` |
| midpoint | a point and a line, either order | `[point, line]` |
| tangent | two of line/circle/arc, not two lines | `[A, B]` + `internal` / `at` as above |
| symmetric | two points and a line, any order | `[pointA, pointB, line]` |
| fix | a point | `[point]` + `value: [x, y]` from the draft |
| dimension | see `dimension.ts` header | `distance`, `hdist`, `vdist`, `pldist`, `radius`, `diameter`, `angle` |

Refusals (nothing is added, a hint key is returned): `app.sketch.hint.constraint.exists` (already there, also a
different order of the same refs), `.redundant` (implied through coincident groups, equal chains, parallel and
perpendicular chains, known horizontal/vertical lines), `.conflict` (contradicts a known orientation), and
`app.sketch.hint.pick.invalid | same | none` for a click that does not fit. A dimension for refs that already have one
is refused with `app.sketch.hint.dimension.exists`.
