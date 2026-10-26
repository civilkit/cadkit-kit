# SolidCraft import (`.solidcraft`)

`packages/solidcraft` (`@kit/solidcraft`) turns a `.solidcraft` file into a feature tree. Open it like any other file (Open, or drop it on the window); the part opens as a new, unsaved part named after the file.

A `.solidcraft` file is either a zip (newer files) or the bare JSON document (older files, format tags `solidcraft/1` to about `/21`). Only `document.json` is read; the `cache/` folder of a zip is derived data tied to the SolidCraft app build and is ignored. The format tag runs from 1 to 33 (the app writes 33 since 0.21; the project's own test files are 1 to 30 and the two SELENE files are 28), and the shapes differ between versions: an extent has no `convention` before the later versions (read as a total distance), and profiles chosen by curve ids appear from about format 13 (they become `regions`).

## Orientation

SolidCraft is Z-up and this kit is Y-up. Everything is rotated by -90 degrees about X on the way in: a point (x, y, z) becomes (x, z, -y), so a part keeps its shape and stands the right way up. Their ground plane XY is our top plane; their XZ plane is our front plane (with the sketch's y reversed); their YZ plane (x = +Y, y = +Z) is our right plane exactly. The planes follow their geometry source; their XZ plane changed at file format 6 (before it sketch y was +Z, normal -Y), so the importer reads the file's format and uses the frame the file was drawn on. A mirrored sketch plane reverses arcs, and horizontal and vertical constraints swap when the plane axes swap.

## What is mapped

Written from three sample files; every other construct is reported, never guessed.

| In the file | Becomes |
|---|---|
| sketch on an origin plane, an offset of one, a construction plane, a **face** or a **custom plane** | a sketch on our front / top / right plane at an offset. A face or custom plane carries its own frame (origin and axes), so it needs no face lookup; a frame that lies flat on one of the three standard planes with its axes along ours becomes a sketch on that plane; any other frame (tilted, or turned about its normal by an angle that is not a multiple of 90 degrees) becomes a `plane` feature in `frame` mode (origin and the two directions) and the sketch stands on it. A hole or a rim still needs a standard plane |
| line, arc (counter-clockwise start to end), circle, construction flag | the same entities |
| coincident constraint | the two points are merged into one (the geometry is closed without the solver) |
| horizontal, vertical, length constraints | horizontal, vertical, distance |
| midpoint, distance_x / distance_y, distance, radius, diameter, tangent, symmetric, collinear, point_on_curve | midpoint, hdist / vdist (swapped with the plane axes), distance, radius, diameter, tangent, symmetric, collinear, pointOnLine / pointOnCircle |
| extrude (new body / join / cut, either direction, a negative distance = the other way, **through all**) | extrude `add` / `cut`, `flip` set so the direction matches |
| profiles: all, or chosen by curve ids | all regions, or the regions bounded by the chosen curves (`regions`). A loop that runs along only part of a longer line gets a small hidden profile sketch of its own outline, because selecting by curve id would also pick the neighbouring regions that share the line |
| box, cylinder along any axis (along +X / +Y / +Z or the negative way it stands on a standard plane; along another direction on a `frame` plane through the base with the axis as its normal) | a sketch and an extrude |
| fillet, chamfer (equal distance) | fillet / chamfer; the edges are found by the kernel from the edge positions stored in the file, so they need the kernel |
| shell (inside or outside), offset face | shell / move face; the faces are found by the kernel from the positions stored in the file (the nearest face, only when clearly the nearest) |
| revolve about the sketch's own x or y axis | revolve with a construction line along that axis |
| loft | loft through the section sketches |
| mirror about an origin, offset or construction plane | mirror of the named features (a join or cut limited to named bodies: its tool body is mirrored with `moveBody` `mirror` and combined again) |
| sweep of a circle or other profile along a path that is one spline | a 3D sketch holding the spline (through the same points) and a sweep along it; the spline passes through the stored points, so a path that is a B-spline with control points gives a slightly different curve |
| coil (round or square wire; diameter, turns, pitch or height, wire size, inside / centred / outside, either hand) | a helix of the wire's centre-line radius on a plane across the axis, the wire's section on a plane through the axis, and a sweep along the helix; the wire size is its diameter (a square wire's side) and `diameter` is the centre line's unless the section is inside or outside |
| circular pattern of whole bodies (any axis, whole circle or part of one) | rotated copies of each body (`moveBody` copy), named `<body> 2`, `<body> 3`... |
| rectangular pattern of named features | one or two linear patterns (the second also repeats the first row) |
| construction plane | remembered by name; sketches carry their own plane, so no feature is added |
| named parameters and expressions (`thickness + 14 mm`) | evaluated to numbers (`expr.ts`; mm, deg, rad only) |

Parameters are evaluated once on import: the numbers are kept, the names are not (there is no parameter link back to the file).

## What is reported

Each feature gets a row: converted, unsupported (with the reason) or skipped (suppressed in the file).

- An unsupported feature stays in the tree as a suppressed `importedUnsupported` feature that carries the original JSON, so the tree still regenerates and nothing is lost silently. Its dependants are reported too ("depends on sketch 5, which was not imported"). The geometry is partial and the notice says so.
- A constraint kind we do not carry, or one with no usable value or that names a curve that is not in the sketch (lettering outlines), is dropped and counted in a note; the geometry is kept as stored. Every constraint in the 22 corpus files is carried.
- A file that is refused as a whole is not opened and the open part is left alone: not a zip, no `document.json`, unknown format tag, units other than mm.
- A second `new_body` in one document is unsupported: the kit keeps one connected body per part.

A malformed feature (a curve pointing at a missing point, say) is an unsupported row, not an error.

## Tests

`packages/solidcraft/src/*.test.ts` (no kernel) and `import.kernel.test.ts` (with `CK_WASM`): the slot file and the sample plate are checked against volumes worked out by hand. The sample files are not in this repository: the tests that need them read `cadkit/corpus/solidcraft` (next to the kit; see its README) and are skipped when it is missing, so the kernel and file-based tests do not run on a machine without the corpus. The synthetic tests build their documents in the test and always run. The platform layer reads `.solidcraft` as bytes (`packages/platform/src/web.ts`); `web.test.ts` covers it.

## Coverage today

Run over the project's 22 sample files (the 19 in its repository plus the 3 from the app; `corpus.kernel.test.ts`, folder `corpus/solidcraft` next to the kit), against the numbers their own evaluator saved next to them where those exist (`expected/`):

- **Import completely (17).** Ten match the volume (and bounding box where it is saved) their own evaluator saved: `issue-489-stacked-join`, `issue-616-lid-ribs`, `m0-box-fillet-hole`, `m0-revolve-primitives`, `modern-path-pattern`, `modern-plastic`, `modern-sheet-metal`, `move-bodies`, `naming-split-pieces` and `split-body-pieces`. Sample Plate and the slot file are checked against closed-form volumes (the slot by hand: the stadium minus half an end cap). `pi-case`, `pi-case-0.8` (with its lettering), `logo-up-down-join` and `battery-tpu-case` and `battery-tpu-case-v2` (with the kernel changes below) import with no feature left out and have no saved numbers. `crazy-geom-cuts` imports completely and regenerates without errors with the kernel's classification fix for tool pieces that touch (a point on two opposite faces of the other solid is inside it). `cubeish-chamfer-too-large` imports completely but its last chamfer fails in our kernel on purpose (`blendOverflow`: the design is named for a chamfer that is too large); it is listed as known in the corpus test.
- **In part (0).** The battery files (`battery-tpu-case`, `battery-tpu-case-v2`) import completely with the newer kernel: the case in them is a copy of the battery, shelled outward, and filleted. That needs a `moveBody` copy with no motion (copy in place), the `body` filter of `resolve`, a shell and a fillet/chamfer that act on their own lump (a coincident copy beside them otherwise breaks the blend), a mirror of a tool body without a recipe, and, for v2, a `moveBody` copy that mirrors (`mirror: <plane>`) so the mirrored pleats cut and join the case only. Their saved edge positions in v2 are stale (the file was saved with the wall at 2.5 after the edges were picked at 3.0), so those edges are found by the names the file gives their faces (`F2:side:l2@F5.1|F2:start@F5.1`), the nearest edge between faces of those names; the position and direction are tried first.
- **Sheet metal.** A contour flange (`sheet_contour`) along lines becomes a thin extrude of the path with its bends drawn as tangent arcs. The file stores neither the thickness nor the bend radius; 2.5 mm and an inner radius of 2.5 mm are what reproduces the volume and box their evaluator saved for the sample (12097.62 against their 12097.48), so they are assumed, and the row says so. The sheet lies to the right of the path as it runs; the extrusion runs along the sketch normal. Other sheet-metal features (base flange, edge flange, unfold) are not imported.
- **Spheres.** A sphere (centre, radius) becomes the kernel's `sphere` feature: one row, one spherical face. It takes part in new body, join and cut like any other solid.
- **Holes.** A hole (simple, drilled, counterbore or countersink, blind or through, at a position or at the points of a sketch) becomes a sketch of points on the face with our `hole` feature drilled into it, checked against the removed volume. The drilling direction is the one the file stores (into the material). Files saved by 0.9.0 can store a direction that points out of the material; their engine drills toward the material anyway, we do not, and the hole then reports `cutNoEffect`. A hole placed by distances from edges is kept at the place those distances give now (a note says so), a hole drilled up to a face or point is reported, and a cosmetic thread on a hole (`M6x1`) is a note. A thread feature that is cosmetic is skipped (an annotation with no geometry); a modelled one is reported.
- **Scale.** A scale of named bodies (one factor, or one per axis; `factors` wins over the dead `factor`; their y is our z) becomes the kernel's `scale` about the file's origin point. The kernel keeps the result exact for planes, cylinders and cones stretched along their own axis, free-form faces, and spheres and tori under one factor; a round face stretched across its axis is refused with a hint (it would be an elliptic cylinder). A scale inside a component whose bodies arrive by a body transfer is not converted yet (SELENE's 8 scales are all of that kind), for the reason under Body transfers.
- **Body transfers.** Large assemblies build every body in the top level and then hand each to the component it belongs to (`body_transfer`, thousands of rows in a robot-arm assembly). With the identity transform nothing moves, so the row is skipped: the bodies stay in the main part and the component that owns them is not kept (so a joint does not carry them). A transfer that also moves the bodies is reported as unsupported.
- **Newer files (format 31 to 33), read from the project's change notes and synthetic tests; no real file of those formats is in the corpus.** Pieces of a split face carry `#1`, `#2` on their names (`F5:side:l2#1`): the number is ignored and the nearest edge between those faces is taken, the stored position first. A design lists the body names a rename freed (`reserved_body_names`): the counter of unnamed bodies skips them. Expressions may begin with `=`, be a definition `name = expression` (the expression is read) and use a decimal comma (`2,5`, `,5`). An extent with the convention `legacy_per_side` is read as the plain distance when it runs one way (it only differs for a symmetric extent, which is still unsupported); an extrude with a second distance (two sides) is reported.
- **Components and occurrences:** each component becomes a part of its own, inserted once per occurrence (`insertPart`, placed by the occurrence's transform, `fixed` when grounded). Features of no component stay in the main part. The saved transforms already include the joint values, so the pose is right. A revolute joint between two circle centres also becomes a `hinge` mate between the cylinders the circles belong to (found by the kernel; the saved angle stays as the pose, its limits are not imported); any other joint is reported as skipped. `components-arm` and `joints-hinge` import completely (the hinge matches their volume to 6e-5 and their box).

**Several bodies** (kernel ADR 0004): when a file names bodies (a target, `move`, `combine`, `remove`, `intersect`) or makes more than one, every new body is a named `newBody` lump (unnamed ones are `Body1`, `Body2`, ... in creation order, as in their app). A join, cut or intersect limited to named bodies becomes the shape as a body of its own plus a `combine` with each target. `move` becomes `moveBody` (rotation about the world origin, then translation; a copy takes its name), `combine` and `remove` map one to one. A file of a single body keeps the plain `add`. Needs the kernel with `newBody`.

Plastic features become ordinary sketches and extrudes, checked against the volumes of their own tests: a **boss** (draft, hole and hole depth; a fillet at its foot and ribs are reported, not guessed), a **rest** (rectangle, round, hollow, drafted), a **snap fit** (arm and triangular catch) and a **lip / groove** (a band along the inner or outer edge of a flat rim, read from the kernel's outline of the rim; a clearance `gap`, a rim with curved edges or a face without an inner edge are reported). A lip needs the kernel's rim resolver (`kernelResolvers`); without it the row says so.

Edges and faces are found by the position stored in the file. When a parameter changed after the pick (the file's own `height` is 32 but its fillet edges were stored at 24), the position is off the body, so the importer then tries, in order: the straight edge parallel to the stored direction whose line passes through the point; the point moved along the one axis on which the body's box differs from the box stored with the edge; and, for a face named as an extrude's start or end cap (`F2:top`), that cap by name.

Extents: a **start offset** is the same sketch on an offset plane in the extrude direction; an extent **to** a point or face runs towards the plane through that point (parallel to the sketch) and keeps the depth it has now, with a note (the stored distance is only the value the file last had).

Lettering is kept as text: a sketch that links glyph outlines to a string becomes our text entity (string, height, position, angle; the built-in sans stands in for their font, with a note), and an extrude that selects those outlines selects the text.

Pattern **along a path** (a line or arc, instances `spacing` apart, the first being the seed): kernel has no such pattern, so each instance is the seed's sketch moved along the path and extruded the same way. Only for round seeds (holes, round bosses); other seeds are reported.

Left out most often: sheet metal other than a contour flange, joints other than revolute (as mates), limits of joints, a path pattern of non-round seeds, and edges and faces that are not found on a body built differently from theirs.

## Not done

Assemblies (occurrence placement, joints and multi-body components), sweeps along a path that is not one spline, modelled threads, circular patterns of features, and the other feature types listed above. The placeholder row shows its raw type name.


## Colours and hidden bodies

`appearances.bodies[name]` of the file (colour 0-255, opacity, and in newer files `pbr`: metallic, roughness, dielectric_ior) becomes the part's
`appearance` field (`#rrggbb`, `opacity`, `metallic`, `roughness`), keyed by the feature that made the body (the first feature carrying its name; a
file of one unnamed body colours its first adding feature). `visibility.hidden_bodies` that are still alive at the end become `view.hiddenBodies`
(feature ids). Bodies of an inserted component are keyed `feature@insert`. Not imported: the index of refraction, per-face colours, hidden joints.
