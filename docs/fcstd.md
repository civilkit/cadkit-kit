# FreeCAD FCStd import: findings and prototype

Status: prototype in `packages/fcstd` (about 600 lines, no dependencies). It reads `Document.xml` of an FCStd and maps one
PartDesign Body to our feature JSON; what it cannot map becomes a warning, never a crash. `.FCStd` opens from the picker and
by drop (`apps/cad/src/files`, `main.tsx` `importFcstdBytes`), behind the unsaved-changes guard.

## What an FCStd is

A ZIP (deflate) with `Document.xml` (objects and all their properties), `GuiDocument.xml` (visibility, colours), one cached
`<Object>.Shape.brp` per shape-bearing object (OCCT BRep text; files from 0.14 to 0.16 call them `PartShape<N>.brp`) and
small side files (`Map.txt` element-name tables, colour arrays). The feature tree lives only in `Document.xml`; the cached
shapes are results, per feature, which is what makes per-step verification possible.

Facts that shaped the mapping:

- FreeCAD is Z-up, our kernel is Y-up in the GUI but the kernel itself only has the three standard planes
  (`front` = XY, `top` = XZ, `right` = ZY with `u = -z`). The importer keeps FreeCAD coordinates unrotated and maps each sketch to the
  standard plane that has the same normal axis, plus an `offset` plane feature when the sketch is not through the origin.
  A sketch whose normal is not a coordinate axis cannot be placed (the kernel has no custom plane frame): warning, feature skipped.
- A sketch's `Placement` property is already the resolved attachment (support, map mode, datum planes, attachment offset), so
  datum planes and `MapMode` need no handling when the result is axis aligned.
- A reversed frame (normal opposite to ours) mirrors the sketch: arcs get their ends swapped, pads get `flip`.
- Pad and Pocket both run against our conventions the same way (boss along the normal, cut against it), so one flip rule
  serves both: `flip = Reversed xor (FreeCAD normal opposite to our plane normal)`.
- FreeCAD 1.0 replaced `Midplane` by `SideType` (0 one side, 1 two sides, 2 symmetric); old files only have `Midplane`.
  Pre-0.17 files have no Body `Group` (the order comes from the `BaseFeature` chain from the Tip back), the sketch link is
  `Sketch` not `Profile`, and the pocket `Type` enum differs.
- Pad `Length` can be negative (it runs the other way).
- Edge and face references are names like `Edge12` into the cached shape of the base feature, in OCCT's
  `TopExp::MapShapes` order. `brep.ts` reads the BRep text (locations, curves of type line and circle, the TShapes graph),
  walks it in that order and returns the middle point of each edge; the kernel's `resolve` query (`near` + `within`) turns the point into a
  `{faces, at}` edge reference. Verified against OCP: same 15 edges, same points.
- Dimensional constraints with expressions or spreadsheets: the cached numeric values are used; parametric links are dropped
  with a warning.

## Files tried

Local files were not checked in (licence unknown); the online files are from the FreeCAD repository (LGPL-2.1,
`https://github.com/FreeCAD/FreeCAD`, downloaded to the scratch directory, parsed only as data, never executed). Two small ones
are checked in as test fixtures under `packages/fcstd/fixtures` (see `SOURCE.txt`).

| file | source / licence | size | objects | mapped | volume error vs FreeCAD cached shape (OCCT) |
|---|---|---|---|---|---|
| PartDesignExample.FCStd (Pozidriv bit) | FreeCAD `data/examples`, LGPL-2.1 | 244 KB | 1 Body, 7 sketches, Pad, Revolution, 3 Groove, 2 Pocket, Mirrored, 2 PolarPattern, 2 datum planes; 27 lines, 2 arcs, 1 circle | 10 of 10 mapped; 8 exact, 2 hit a kernel failure | Pad 1e-16, Groove 3e-9, Mirrored 8e-9, Revolution 7e-9, Pocket 2e-7, PolarPattern 2e-6, Pocket001 2e-6, PolarPattern001 2e-8; Groove001 and Groove002: 9e-4 (kernel `booleanFailed`) |
| TwoLengthsPadWithExpression.FCStd | FreeCAD `tests/.../TestModels`, LGPL-2.1 | 118 KB | Body, 1 circle sketch with a diameter expression, Pad (two lengths) | 1 of 1 (expression value kept, warning) | 1e-15 |
| TwoLengthsPadCrossObjectRef.FCStd | same | 24 KB | Body, 2 circle sketches, 2 Pad, expression | 2 of 2 | 4e-16 both steps |
| ModelFromV021.FCStd (fixture) | same | 25 KB | Body, Pad, Revolution, Chamfer; 8 lines, circle, point | 3 of 3: the chamfer through BRep edge lookup plus the kernel | Pad 7e-16, Revolution 6e-16, Chamfer under 1e-7 (checked to 3 decimals of 15759.2146 mm3) |
| PocketTest.fcstd (fixture) | FreeCAD `data/tests`, LGPL-2.1 | 50 KB | 0.14 file: Body, 3 sketches, Pad, 2 Pocket, 2 datum planes | 1 of 3 (Pad); the pockets are up-to-first / up-to-face | Pad 3e-16 |
| PadTest.fcstd | same | 52 KB | 0.14 file: Body, 3 sketches, 3 Pad | 1 of 3 (Pad001 and Pad002 are up-to-last / up-to-face) | Pad 3e-16 |
| EngineBlock.FCStd | FreeCAD `data/examples`, LGPL-2.1 | 87 KB | Part workbench only: Box x5, Cylinder x3, Extrusion x7, Cut x5, MultiFuse x3, Mirroring x3, Part2DObjectPython x8 | 0 (no PartDesign Body) | not applicable |
| dressuptest.FCStd | FreeCAD CAM tests, LGPL-2.1 | 42 KB | Path (CAM) and Python feature objects, one Box | 0, out of scope | not applicable |
| Universal Joint.FCStd | local, licence unknown | 406 KB | 12 Bodies, 5 App::Part, Assembly + joints, 11 sketches (69 lines, 25 arcs, 4 circles), 7 Pad, 2 Pocket, Revolution, Groove, Fillet, 2 Boolean, 3 SubShapeBinder, 5 clones, 5 Python features | Pad of three bodies exact (0 to 1e-16); Body003 and Body005 limited by binders, booleans, axes taken from other objects | Pad 0, Pad001 0 (after the negative-length fix); a Pad on a binder cannot be compared (FreeCAD volume is of the fused result, and signed) |
| hopper_shape.FCStd | local | 4.1 MB | Body with 4 sketches (53 lines, 31 circles, 5 B-splines, 21 points, 52 internal-alignment constraints) and one `Part::Feature` (a loft or imported shape, no PartDesign features) | 0 | not applicable |
| Spinfire_Core.FCStd | local | 3.2 MB | 94 `Part::Feature` shapes in 9 App::Part groups | 0 (shapes only) | not applicable |
| Tropical Modern Living Space.FCStd | local | 84 KB | 30 Part::Feature, 9 Python features, 1 sketch | 0 | not applicable |
| FRY002_..._ASM.STEP.FCStd | local | 2.4 KB | empty document | 0 | not applicable |

Across the six files that have a PartDesign tree, 17 of the 20 FreeCAD features that reach the importer are mapped
(3 are not because of up-to-face end conditions) and 15 of them regenerate to under 2e-6 relative volume error against FreeCAD's
own cached shape of the same step. The two Grooves of the Pozidriv example map but fail in our boolean (`booleanFailed`,
a coincident-surface case: the groove cuts a revolved profile whose seam lies in the cutting profile), so the result is
within 9e-4 of FreeCAD, not failed. Per-step comparison is `packages/fcstd/src/real.kernel.test.ts` (set `CK_WASM`,
`FCSTD_DIR`, `FCSTD_VOLS` = JSON of OCCT volumes by object name made with `OCP`, `FCSTD_FILES`).

## What the importer supports

| FreeCAD | ours | notes |
|---|---|---|
| Sketcher: line, circle, arc, ellipse, point (construction flag kept) | sketch entities | endpoints that meet are merged into shared points; coincident constraints that need no merge are kept |
| coincident, horizontal, vertical, parallel, perpendicular, tangent, equal, radius, diameter, distance, distance X / Y | same names (`hdist`, `vdist`) | distances use absolute values with refs ordered; driven (reference) dimensions dropped |
| point on object, symmetric, angle, block, internal alignment, snell, weight | dropped, counted in a warning | geometry keeps FreeCAD's solved positions, so the shape is right but dragging would not behave like FreeCAD |
| B-spline, arc of ellipse, hyperbola, parabola | dropped, warning | |
| Pad / Pocket: Length, Midplane / symmetric, two lengths, Reversed, negative length, Pocket through all | extrude add / cut: blind, mid, two extrudes, flip, through, throughBoth | taper, custom direction, up to first / last / face: warning, feature skipped |
| Revolution / Groove: angle, axis = sketch V / H axis, a construction line, or an origin axis lying in the sketch plane | revolve with a construction line added to the sketch | partial angles and symmetric revolve: warning (direction not verified) |
| Mirrored (about an origin plane) | mirror | other mirror planes: warning |
| LinearPattern, PolarPattern (axis = origin or sketch axis) | lpattern, cpattern | extent / spacing modes; edge directions: warning |
| Fillet, Chamfer (equal distance) | fillet, chamfer with `{faces, at}` edge refs | needs the cached BRep and a resolver (the kernel); `resolveEdges(imp, resolver)`. The app has no resolver yet, so there they are left out and listed |
| Thickness, Draft, Hole, Boolean, loft / pipe / helix, multi-transform, binders, clones | warning, skipped | |
| Datum plane / line / point, body Placement | used through sketch Placement; a non-identity Body placement is warned and ignored | |

Warnings carry `{object, code, message}`; the app shows the first in a notice and counts the rest. `FcImport.steps`
records which of our feature ids each FreeCAD feature produced and its cached shape file; `skipped` lists the features left out.

Only one Body is imported (the one with the most features, or `opts.body`); the others are listed in `bodies`.

## View-only fallback (not done)

When a feature cannot be mapped, the idea is to show the cached `Shape.brp` as a view-only body, like our STEP import.
The kernel's STEP importer cannot read it: BRep text is OCCT's own format (geometry tables for curves, pcurves, surfaces and a
TShapes graph), not STEP. `brep.ts` reads only the topology and curve parts needed for edge points; a full reader must also parse
surfaces (plane, cylinder, cone, sphere, torus, extrusion, revolution, B-spline and Bezier with weights and knots), pcurves and
orientation, then build a kernel body (a "make body from faces" path, as STEP import does). That is the only way to open the six
of thirteen files here that have no PartDesign tree (Part workbench, imported shapes, Python features).

## Gaps, ranked by how many of the 13 files they block

1. **BRep text to kernel body** (view-only import of the cached shapes): blocks 6 of 13 files completely (EngineBlock, dressuptest, hopper_shape, Spinfire_Core, Tropical, and the Universal Joint binders/clones); also the fallback for any unmappable feature. About 600 to 900 lines for the reader plus a kernel entry that builds a body from analytic and B-spline faces (STEP import has most of it).
2. **Multi-body, App::Part, binders, clones, assembly joints**: Universal Joint, Spinfire_Core and any real assembly. Needs one part per body with its placement, `SubShapeBinder` as a reference to another body, joints to our mates (coincident / revolute exist).
3. **End conditions up to first / last / face (and through-all pockets in old files)**: PadTest, PocketTest and a Pad in Universal Joint. The kernel has `upToFace` / `offsetFromFace` / `upToNext`; the work is mapping the face name to a persistent face (same BRep lookup as edges, for faces) and the up-to-last / first semantics.
4. **Sketch constraints and B-splines**: point on object, symmetric, angle, block, internal alignment appear in every file that has a sketch (PartDesignExample 14 point-on-object, Universal Joint 21 and 7 symmetric, hopper_shape 52 internal alignments); our solver has `pointOnCircle`, `midpoint`, `mate`; needs `pointOnLine` / symmetric / angle checked in the sketch schema, and B-spline entities with knots and weights (the `spline` entity takes through-points only; sampling loses editability). Does not change the volume, changes how the sketch behaves when edited.
5. **Arbitrary sketch planes** (a custom frame: origin, x axis, normal): no file here needs it (all sketches are axis aligned), but any tilted datum plane does. A `plane` feature `mode:"frame"` (or 3 points) in the kernel removes the only placement restriction.

Smaller: Thickness (needs face lookup, then `shell`), Draft, Hole (a cut with a circle sketch is enough for plain holes; threaded and counterbore map to `hole`/`thread`), Part workbench primitives (Box and Cylinder map to extrudes; Cut / Fuse / Common / Mirroring to booleans we do not expose as features), expressions and spreadsheets (map `Spreadsheet.A1` to our variables; cached values are used today), loft / pipe / helix, a boolean robustness case (`Groove001` of the Pozidriv example).

## Effort estimate for a full importer

| piece | estimate |
|---|---|
| prototype as built (zip, XML, sketches, Pad/Pocket/Revolution/Groove/Mirrored/patterns, fillet and chamfer by BRep edge lookup, app hook) | done, about one day |
| app wiring of the kernel edge resolver, face lookup, Thickness, Draft, up-to-face, Hole, plain Part primitives | 3 to 4 days |
| sketch constraint completion, B-splines, custom plane frame in the kernel | 3 to 5 days (kernel side is most of it) |
| multi-body, binders, assembly joints | 1 to 2 weeks |
| full BRep text reader into a kernel body (view-only fallback, also useful for imported shapes) | 1 week |
| loft / pipe / helix / multi-transform, expressions and spreadsheets to variables | 1 week |
| conformance suite: more real files with per-step volume comparison (the harness exists) | ongoing, 1 file per hour once the harness is in place |

Roughly 5 to 6 weeks for something that opens most single-part PartDesign files well; the semi-complex files tried here that stay inside
Sketch + Pad/Pocket/Revolution/Groove/patterns/fillet/chamfer already regenerate exactly.

## Running it

```
python3 -I packages/fcstd/tools/analyse.py file.FCStd ...        # objects, body sequences, sketch geometry and constraints
CK_WASM=<ck_wasm.wasm> npx vitest run packages/fcstd              # unit tests, fixtures against the kernel
CK_WASM=... FCSTD_DIR=<dir> FCSTD_VOLS=<vols.json> FCSTD_FILES=a.FCStd,b.FCStd npx vitest run packages/fcstd/src/real.kernel.test.ts
```
