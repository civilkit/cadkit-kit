# FreeCAD FCStd import

Status: `packages/fcstd` reads the `Document.xml` of an FCStd and maps a PartDesign Body to our feature JSON; what it cannot map becomes
a warning that names the feature, never a crash and never a silent drop. `.FCStd` opens from the picker and by drop
(`apps/cad/src/files`, `main.tsx` `importFcstdBytes`), behind the unsaved-changes guard; the app answers the importer's questions about
edges and faces with the kernel (`resolveReferences` + `fcstdResolvers`).

It is verified against FreeCAD itself: `packages/fcstd/corpus` holds 84 small documents saved by FreeCAD 1.1.4 (our own scripts, see
`corpus/README.md`) and FreeCAD's measurements of the shape it stored for every object. `corpus.kernel.test.ts` imports every document,
builds it with the kernel and compares volume, area, centre of mass and bounding box with those numbers; `corpus/RESULTS.md` is the
current table and `corpus/ROADMAP.md` lists what is left by cause.

| 84 models (226 Body Tips / Part results) | EXACT | CLOSE | UNSUPPORTED | MISMATCH | FAILED |
|---|---|---|---|---|---|
| before the oracle work (models) | 23 | 0 | 37 | 2 | 22 |
| now (models) | 49 | 1 | 33 | 1 | 0 |
| now (Tips and results) | 139 | 1 | 83 | 3 | 0 |

(Class meaning, tolerances and how the gate works: "The oracle test" below.)

## What an FCStd is

A ZIP (deflate) with `Document.xml` (objects and all their properties), `GuiDocument.xml` (visibility, colours; only when saved from the
GUI), one cached `<Object>.Shape.brp` per shape-bearing object (OCCT BRep text; files from 0.14 to 0.16 call them `PartShape<N>.brp`) and
small side files (`Map.txt` element-name tables, colour arrays). The feature tree lives only in `Document.xml`; the cached shapes are
results, per feature, which is what makes per-step verification possible.

Facts that shaped the mapping (each was checked against the corpus):

- FreeCAD is Z-up, the kernel only has the three standard planes (`front` = XY, `top` = XZ, `right` = ZY with `u = -z`). The importer keeps
  FreeCAD coordinates unrotated and maps each sketch to the standard plane that has the same normal axis, plus an `offset` plane feature
  when the sketch is not through the origin. A sketch whose normal is not a coordinate axis cannot be placed (no custom plane frame):
  warning, feature skipped. Body placements are ignored and warned: a Body's features and its Tip shape are in body coordinates.
- A sketch's `Placement` property is already the resolved attachment. A sketch attached to a planar face (`FlatFace`, no offset) is
  additionally put on that face by the kernel once it can name it (`plane: {kind: 'face'}`; its points are rewritten in the frame the
  kernel gives that plane), so it follows the face when the part is edited. The static placement stays when the face is not found.
- A reversed frame (normal opposite to ours) mirrors the sketch: arcs get their ends swapped, pads get `flip`. Pad and Pocket share one flip
  rule, `flip = Reversed xor (FreeCAD normal opposite to the plane normal)`; a Groove turns the other way round from a Revolution.
- FreeCAD 1.0 replaced `Midplane` by `SideType`; old files only have `Midplane`. Pre-0.17 files have no Body `Group` (the order comes from
  the `BaseFeature` chain from the Tip back), the sketch link is `Sketch` not `Profile`, and the pocket `Type` enum differs. Enumerations
  are stored as indices into lists that change between releases; the importer reads the 1.1 lists (see ROADMAP: per-version tables).
- The Body ends at its `Tip`: features after it are not part of the Body (FreeCAD rolled it back) and are reported, not imported.
- 1.x writes mapped names next to index names: `<Sub value="Axis" shadowed="Axis0"/>`; the index name wins. The origin features of the
  second and later Bodies are `X_Axis001`, `YZ_Plane002` ...; they are found by their role (the name without the number).
- Edge and face references are names like `Edge12` / `Face6` into the cached shape of the base feature, in OCCT's `TopExp::MapShapes`
  order. `brep.ts` reads the BRep text (locations, lines, circles, planes and the other analytic surfaces, the TShapes graph with
  orientations), walks it in that order and returns the middle point of each edge and the outward normal and an inner point of each planar
  face. The kernel's `resolve` query turns a point (and normal) into an edge reference or a face id.
- Expressions: see "Expressions and parameters".

## What the importer supports

| FreeCAD | ours | notes |
|---|---|---|
| Sketcher: line, circle, arc, ellipse, point (construction flag kept) | sketch entities | endpoints that meet are merged into shared points |
| coincident, horizontal, vertical, parallel, perpendicular, tangent, equal, radius, diameter, distance, distance X / Y, angle between two lines | same names (`hdist`, `vdist`) | distances use absolute values with refs ordered; driven (reference) dimensions dropped |
| point on object, symmetric, block, internal alignment, angle to an axis | dropped, counted in a warning | geometry keeps FreeCAD's solved positions, so the shape is right but dragging would not behave like FreeCAD |
| B-spline, arc of ellipse, hyperbola, parabola as profile curves | the feature that uses the sketch is skipped, with the curve types named | construction curves of these types are dropped silently |
| Pad / Pocket: Length, Midplane, two lengths, Reversed, negative length, taper (one-sided), through all, up to first, up to a planar face | extrude add / cut: blind, mid, two extrudes, flip, `draft` / `draftOut`, through, `upToNext`, `upToFace` | custom direction, reference axis, profile from a face, up to last / shape, offset from the face: warning, feature skipped |
| Revolution / Groove: angle, Midplane, Reversed, axis = sketch H / V axis, a construction line (`Axis0`), or an origin axis lying in the sketch plane | revolve (`end: 'mid'`, `flip`) | up to face / two angles, datum or edge axes: warning |
| Mirrored (origin plane, or a sketch axis along a coordinate plane) | mirror | other planes: warning |
| LinearPattern, PolarPattern (axis = origin axis or sketch axis through the origin), Length / Offset modes | lpattern, cpattern | second direction, edge directions, MultiTransform, whole-shape mode: warning |
| Fillet, Chamfer (equal, two distances, distance and angle), all edges | fillet, chamfer with `{faces, at}` edge refs | needs the cached BRep and the kernel; a feature whose edges are not found is removed and reported |
| Thickness (planar faces to remove, inward, or outward with sharp corners), Draft (planar faces, neutral plane = a face) | shell, draft | outward Arc join, pull direction: warning |
| Hole: diameter, depth or through all, flat / 118 degree drill point (`DrillForDepth`), counterbore, countersink, sketch circles / arcs / points | hole on a point sketch | the cosmetic thread is not imported (the stored tapped diameter is used); tapered, counterdrill, modelled thread: warning |
| Additive / Subtractive Box, Cylinder, Sphere, Cone, Torus, Prism (also the Part workbench ones, by `opts.object`; a turn about Z is carried) | constrained sketch + extrude, revolve, or `sphere` | Wedge, Ellipsoid, partial cylinder, turns about other axes: warning |
| Boolean, loft, pipe, helix, binders, Scaled, MultiTransform; Part workbench objects; App::Link / App::Part | warning, skipped | `unsupportedObject` names each Part object |
| Datum plane / line / point | used through the sketch Placement | |

Warnings carry `{object, code, message}`; the app shows the first in a notice and counts the rest. `FcImport.steps` records which of our
feature ids each FreeCAD feature produced and its cached shape file; `skipped` lists the features left out. The rule that no feature is
dropped silently is a test (`import.corpus.test.ts`): every feature of every Body of the corpus is in `steps` or in `skipped` with a warning
that names it.

One Body is imported per call (the one with the most features, or `opts.body`); the others are listed in `bodies`.

## Expressions and parameters

`fcexpr.ts` parses FreeCAD's expression language (units, `Sheet.alias`, `Obj.Prop`, `Obj.Constraints.Name`, `<<Label>>.Prop`, ranges,
functions with `;`, conditionals) and `fcparams.ts` turns the expressions that bind a property into part variables: spreadsheet cells and
aliases, VarSet and custom properties, named sketch constraints and other bound properties become `part.variables`; a bound field holds the
kernel expression over them (`"=depth"`), a bound sketch dimension its variable in `expr`. Every translation is evaluated and must give
the value FreeCAD stored (1e-6 relative); otherwise the number is kept and the reason is reported. Expressions with no kernel form
(conditionals, comparisons) keep the computed number.

`FcImport.params` lists the editable parameters (`Pad.Length`, `Sketch.Constraints.Width`, `Params.alias:width`, `Vars.Wd`, ...), each with
a `set(part, value)` that writes the value where it belongs (a variable, a field, or a constraint `expr`, which is what makes the kernel
solve the sketch again). The corpus uses them to test "same recipe, different parameter".

## The oracle test

`packages/fcstd/src/corpus.kernel.test.ts` (helpers `corpusOracle.ts`, `corpusVariant.ts`), kernel-backed, run on the CI box:

```
tools/remote_vitest.sh --worktree <kit> --kernel <kernel> --wasm <ck_wasm.wasm> -- packages/fcstd
UPDATE_CORPUS=1 tools/remote_vitest.sh ... -- packages/fcstd/src/corpus.kernel.test.ts > log && node packages/fcstd/tools/extract-results.mjs log
```

For each model it imports every Body (and, for models without a Body, every Part result object), builds it, and compares the Body Tip's
(or the result's) volume, area, centre of mass and bounding box with the dump. The box counts one-sided (ours must not stick out of
FreeCAD's: OCCT boxes of curved shapes are loose); face counts are shown, not gated. Classes: EXACT (relative 1e-5 on volume and area,
1e-5 mm on centre and box), CLOSE (1e-3), APPROX (1e-2), UNSUPPORTED (the importer says which feature it cannot map), MISMATCH (builds but
differs), FAILED (importer or kernel error, or a silent drop). Ranked in that order: an honest refusal beats a silently different shape.
When a build is not EXACT the harness also builds the prefix after each imported feature and compares it with that feature's stored shape,
to name the first feature that deviates.

`corpus/expected.json` holds the class every model and every Tip reaches today. The test fails when one gets worse, notes when one gets
better (run with `UPDATE_CORPUS=1` and review the diff), fails when a model is missing, and fails when a model of the `mustBeGood` set is
not EXACT or CLOSE. The output ends with a totals line, e.g. `FCStd corpus models: 84 total, 49 EXACT, 1 CLOSE, ...`.

Variants: for each model with a `.v1` file, (a) the `.v1.FCStd` is imported and compared with the v1 dump, and (b) the base file is
imported, the parameter(s) that differ between the two dumps are changed through `FcImport.params`, and the result is compared with the v1
dump. `NA` means the importer has no parameter for a change (placements, datum offsets, expression text).

## View-only fallback (not done)

When a feature cannot be mapped, the idea is to show the cached `Shape.brp` as a view-only body, like our STEP import. The kernel's STEP
importer cannot read it: BRep text is OCCT's own format. `brep.ts` reads topology, lines, circles and the analytic surfaces; a full reader
must also parse pcurves, B-spline and extrusion/revolution surfaces and build a kernel body (a "make body from faces" path, as STEP import
does). It would also open the Part workbench files. See ROADMAP.

## Running it

```
python3 -I packages/fcstd/tools/analyse.py file.FCStd ...        # objects, body sequences, sketch geometry and constraints
npx vitest run packages/fcstd/src/import.test.ts packages/fcstd/src/import.corpus.test.ts packages/fcstd/src/brep.test.ts   # no kernel needed
tools/remote_vitest.sh ... -- packages/fcstd                      # everything, on the CI box
CK_WASM=... FCSTD_DIR=<dir> FCSTD_VOLS=<vols.json> FCSTD_FILES=a.FCStd,b.FCStd npx vitest run packages/fcstd/src/real.kernel.test.ts   # your own files, per-step volumes
```

FreeCAD documents other than the corpus are not checked in (the two FreeCAD sample files this package used to carry were LGPL-2.1 and
have been removed; their tests now use corpus models).
