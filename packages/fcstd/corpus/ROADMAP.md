# FCStd importer: what remains, by cause

State of `corpus/RESULTS.md` (84 models, 226 Body Tips / Part results; FreeCAD 1.1.4): models 49 EXACT, 1 CLOSE, 33 UNSUPPORTED, 1 MISMATCH,
0 FAILED; Tips and results 139 EXACT, 1 CLOSE, 83 UNSUPPORTED, 3 MISMATCH. Variants (79): the v1 file imported directly matches in 49
(a); the same parameter changed on the base import matches in 42 (b). Before the oracle work: 23 EXACT, 22 FAILED (silent drops, kernel
errors), (b) 0.

Ordered by value (targets = Body Tips / Part results that stay UNSUPPORTED or wrong because of it). "Next step" says what to do first.

| # | cause | models (targets) | next step |
|---|---|---|---|
| 1 | **Part workbench objects other than the primitives**: `importFcstd(bytes, {object})` imports Box, Cylinder, Sphere, Cone, Torus, Prism (also turned about Z); everything else says `unsupportedObject` by name (Extrusion, Revolution, Cut/Fuse/Common, Fillet/Chamfer, Mirroring, Loft, Sweep, Offset, Thickness, Wedge, Ellipsoid, Plane, Helix, Circle, partial cylinder) | 60-69 (10 models, ~45 targets); no model reaches EXACT until all its objects do | `Part::Extrusion` / `Part::Revolution` of a sketch next (extrude / revolve with `LengthFwd`/`LengthRev`/`Symmetric`; `Solid=false` shells and custom directions stay unsupported), then `Part::Mirroring`. Booleans need `combine` with `newBody` for the operands. |
| 2 | **Stored-shape fallback** (not implemented, see below) | loft, pipe, helix, boolean, binder, Scaled, MultiTransform, Wedge, Ellipsoid, Part ops: about 40 targets | Full BRep text reader plus a kernel "body from faces" entry; then a base feature that holds the stored shape and later features continue on. |
| 3 | **Loft / Pipe / Helix** (AdditiveLoft, SubtractiveLoft, AdditivePipe, SubtractivePipe, AdditiveHelix, SubtractiveHelix) | 52, 53, 54 (14) | The kernel has `loft`, `sweep`, `helix`. Map two-section ruled lofts first (sections are sketches, usually on offset planes: `Profile` + `Sections`), then pipes along a line / arc spine (`Spine`, `Mode`: Standard, Frenet, Fixed), then helices (`Mode`, Pitch, Height, Turns, growth). Check each against the dump before adding the next. |
| 4 | **Custom pad / pocket direction** (`UseCustomVector`, `ReferenceAxis`) | 23, 26 (3) | The kernel `extrude` has no direction field (sheared prism). Needs a kernel option first; the importer side is the existing flip logic plus a direction vector in sketch coordinates. |
| 5 | **Sketch curves**: B-spline, arc of ellipse, hyperbola, parabola as profile curves (the feature using the sketch is skipped and names them) | 13_conics, 14, 15 (3) | A kernel spline entity with knots and weights. `cvspline` is uniform, FreeCAD's interpolated splines are not, so sampling would not be EXACT. Arc of ellipse: kernel `ellipse` has no arc form. |
| 6 | **Sketch planes not aligned to a coordinate plane** (rotated datum planes, tilted faces) | 18 (1), and any tilted attachment | Use the kernel frame the way sketches on faces do (`plane: {kind: 'face'}` + frame probe); for datum planes the kernel's `plane` modes `angle` / `threePoints` plus the same frame probe (the sketch points are rewritten in the frame the kernel reports). |
| 7 | **Revolve about a datum line or a body edge** | 32 (2) | Project the axis into the sketch plane when it lies in it and add a construction line (the origin-axis path does this); `brep.ts` needs the line direction of an edge, not only its middle. |
| 8 | **Pad end types**: up to last, up to shape, profile from a face of an earlier feature | 22, 28, 29 (3) | Up to last = up to the farthest face: the stored shape tells which (ray from the profile), then `upToFace` through the face resolver. Profile from a face needs an extrude of a face (kernel). |
| 9 | **Booleans between Bodies, binders** | 57, 58 (5) | One part with several named bodies (`newBody` + `body`), `PartDesign::Boolean` -> `combine` with the tool Bodies; SubShapeBinder as a reference to another Body's sketch / face. |
| 10 | **Holes**: counterdrill, tapered, modelled threads; the cosmetic thread is not imported | 43, 45, 46 (4) | Tapered and counterdrill need kernel hole options. Cosmetic thread: the kernel `thread` feature takes `standard` / `size`; reading FreeCAD's size needs the per-version enum list (item 12). |
| 11 | **MultiTransform, Scaled, whole-shape patterns** | 50, 51, 79 (3) | MultiTransform = a chain of patterns of the previous result (kernel patterns take `seeds`); Scaled needs the `scale` feature on a copy plus MitCad's note: 1.0 and 1.1 drop non-original copies with factor 1 once Scaled follows other transforms. |
| 12 | **Enum tables per FreeCAD version**: the importer reads 1.1 numbering (Pad/Pocket `Type`, `SideType`, hole `HoleCutType`, chamfer type, draft/thickness modes) and the older special cases (0.14-0.16) | all older files | Generate the lists by instantiating every object type in each FreeCAD version (`schema.json` already holds the 1.1.4 lists), merge, pick own version else nearest older (MitCad `enums.py` idea, to be written fresh). Needs 0.21 / 1.0 FreeCAD runs: not possible from this tree. |
| 13 | **Sketch constraint coverage**: point on object, symmetric, block, internal alignment, angle to an axis are dropped; the solved positions of FreeCAD are kept | 16 (b), 13-15, most real files | Add the mappings in the order real files use them; add MitCad's acceptance check (solve the imported sketch, require every point within 1e-4 of FreeCAD's saved geometry, else demote the fewest constraints and say so). The corpus dump has the sketch geometry and constraints for a parser test (`sketch.constraints` against the imported ones). |
| 14 | **Conditionals in expressions** (`a ? b : c`, comparisons, IF-style spreadsheet tables) have no kernel form, the computed number is kept | 83, 88 (b) | Kernel `if()` (or `step()`); then `emitKit` can map them. |
| 15 | **Expression coverage**: placements (`.Placement.Base.x`, `.AttachmentOffset` other than z), Part primitive properties, Body placements; `Pad.Length`-style properties of objects we do not import | 59, 71, 87 (b) NA | Placement fields as variables once planes / moves take expressions. |
| 16 | **Multi-body, App::Part, Link, assemblies**: only one Body is imported, placements ignored | 71-77 (placements), real assemblies | One part per Body with its placement; `insertPart` / `mate` for assemblies. |
| 17 | **Hostile input** bounds (XML depth, expression depth, object counts, `.brp` size) | | Add limits with tests (MitCad: depth 256). |
| 18 | **Colours and visibility** (`GuiDocument.xml`, absent from the headless corpus) | | Needs GUI-saved documents; not in the oracle. |

## Findings that are not importer work

- **Kernel: a cut whose tool lies fully inside the body** (56_primitives_subtractive: a 10 x 10 x 10 box cut at z 10..20 of a 60 x 60 x 40
  block) gives volume 143000 (right) but area 17200 instead of 17400, 11 faces instead of 12 and a centre of mass 0.07 mm off: the inner
  shell is missing one cap. Three MISMATCH targets (SubBox, SubCylinder, SubPrism) are this.
- **Kernel: the sketch is solved again only when a dimension has an `expr` that differs from its `value`**; setting `value` alone changes
  nothing. The importer's parameters therefore set `expr`.
- **Kernel: ChAll** (36_chamfer, chamfer of all 12 edges of a block) is CLOSE (volume 1.1e-4, 18 faces vs 26): vertex blends differ from OCCT's.
- **Kernel solver on under-constrained figures** (16_sketch_constraint_zoo, change Len / Dia) lands on another valid solution than FreeCAD:
  centre of mass 0.46 mm apart.
- **FreeCAD's bounding boxes of curved shapes are loose** (OCCT adds tolerance / uses poles); the oracle therefore compares boxes one-sided
  (ours must not stick out of FreeCAD's).

## What the oracle found in the importer (fixed)

- `PartDesign::LinearPattern` was dropped without a word: a type test `startsWith('PartDesign::Line')` (meant for datum lines) matched it.
- The Body `Tip` was ignored (features after a rolled-back Tip were imported).
- A Pad whose profile is a face, a Pad along a reference axis, and sketches with unmappable profile curves built something else (or
  failed in the kernel with `noClosedProfile`) instead of being refused.
- `Sub value="Axis" shadowed="Axis0"` (FreeCAD 1.x) and origin features named `X_Axis005` were not understood.
- Groove turns the other way round from Revolution; the kernel's two-distance chamfer lies on the other face; a Pad taper grows the
  profile for positive angles. All three were found by the first mismatch and are now tests.

## Falling back to the stored shape (not implemented)

FreeCAD saves the result of every feature (`<Name>.Shape.brp`). MitCad replaces a feature it cannot reproduce by a base feature that holds
that shape and continues on top of it, after checking the other features against the stored shapes. Here that needs:

1. A BRep text reader that builds faces and not only topology: `brep.ts` already parses locations, lines, circles, the analytic
   surfaces (plane, cylinder, cone, sphere, torus) and the TShapes graph with orientations; missing are B-spline / Bezier curves and
   surfaces with knots and weights, surfaces of extrusion / revolution / offset, curves on surfaces (Curve2ds) to trim faces, shell and
   solid assembly with tolerances.
2. A kernel entry that builds a body from such faces (STEP import has most of it) and a feature type that carries the shape (a `blobs`
   entry like `importStep`).
3. The check that decides when to fall back: volume, area, centre of mass and solid count of the feature against the stored shape at the
   tolerances of the oracle (this tree already compares them), so the fallback is labelled and a deviation is reported, not hidden.

About a week, and it is the only route for the loft, pipe, helix, Boolean, Part workbench and imported-shape files; those results are not
parametric.
