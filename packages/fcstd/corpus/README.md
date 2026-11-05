# FCStd oracle corpus

84 small FreeCAD models, built by our own scripts in a real FreeCAD (headless), saved as `.FCStd`, and measured by FreeCAD itself.
The importer in `packages/fcstd` can be tested against it: for every object FreeCAD stored a shape, and the dump says what FreeCAD
measured on that shape (volume, area, centre of mass, counts), which properties it holds, and what the sketches contain. A second
file per model (`.v1`) is the same recipe after one parameter changed and FreeCAD recomputed ("same recipe, different parameter").

```
packages/fcstd/corpus/
  models/NN_name.py          the model scripts (own work, see NOTICE.md); _helpers.py is shared by them
  generated/NN_name.FCStd    the document, saved by FreeCAD 1.1.4
  generated/NN_name.dump.json        FreeCAD's measurements of that document
  generated/NN_name.v1.FCStd         the document after the variant (only models with a variant() function)
  generated/NN_name.v1.dump.json     its measurements
  generated/schema.json      property types per object type and the enumeration item lists the dumps refer to
  generated/STATUS.json      per model: ok/error, variant result, result of the --reopen check
  COVERAGE.md  VERSION-DIFFS.md  NOTICE.md
tools/fcstd-corpus/          driver.py (runs inside freecadcmd), run.mjs (runner), compare.mjs, coverage.mjs
```

## Regenerate

```
node tools/fcstd-corpus/run.mjs --reopen --freecad /path/FreeCAD.app   # all models (or set FREECAD_APP), writes generated/
node tools/fcstd-corpus/run.mjs --only 25_pocket_types,40     # models by name or number prefix
node tools/fcstd-corpus/run.mjs --freecad /path/FreeCAD_1.1.3.app --out /tmp/fcstd-113 --reopen
node tools/fcstd-corpus/compare.mjs generated /tmp/fcstd-113 --md packages/fcstd/corpus/VERSION-DIFFS.md
node tools/fcstd-corpus/coverage.mjs [--other /tmp/fcstd-113]  # rewrites COVERAGE.md
```

`--freecad` takes the `.app` bundle or the `freecadcmd` binary. Only `freecadcmd` is started (no GUI). FreeCAD is run one process at a
time, in chunks of 12 models (`--chunk`); a chunk that dies is retried model by model. `--reopen` re-opens every saved file in a fresh
FreeCAD process, dumps it again and requires the same dump (numbers within 1e-12 relative, see "Reopen" below), which shows the file is
self-contained: nothing in the dump comes from the live session.

A model script defines `build(doc)` (and optionally `variant(doc)`, returning a one-line description). `doc` is a new document labelled with
the model name and unit system Standard (mm, kg, s, degrees). The driver recomputes, fails the model if any object is not `Valid`, if a
shape is invalid or if a sketch has conflicting/redundant constraints, saves, dumps; then runs `variant`, recomputes, saves `.v1`, dumps.
The header comment of each script says what it covers and the expected key numbers (computed by hand where there is a closed form;
"value from FreeCAD" otherwise). `COVERAGE.md` lists all models with their results.

## Dump format (`format: 1`)

One JSON file per document. It is plain JSON, one top-level key per line and one object per line. Numbers are doubles at full precision
(`nan`/`inf` would appear as strings). Lengths are mm, angles are degrees (see the exception for sketch angle constraints).

| key | content |
|---|---|
| `format`, `model`, `variant` | format version, model name, `null` or the description returned by `variant()` for `.v1` files |
| `freecad` | `version` ("1.1.4"), `build`, `revision`, `raw` (the whole `App.Version()`) |
| `document` | `label`, `properties` (document properties other than the stripped ones) |
| `objects[]` | every object in document order (`doc.Objects`), see below |
| `bodies[]` | per `PartDesign::Body`: `name`, `group` (feature names in order), `tip`, `tipChain` (Tip then each `BaseFeature` back to the first), `placement` |
| `parts[]` | per `App::Part` / `App::DocumentObjectGroup` / `Part::Compound`: `group`, `placement` |
| `links[]` | per `App::Link` / `LinkElement` / `LinkGroup`: `linkedObject`, `placement`, `scale`, `scaleVector`, `elementCount`, `linkTransform`, `showElement`, `globalPlacement` |
| `stripped` | names of properties that were left out of the dump because they change between runs or hold machine specific text (see below) |

The list of property types per object type, and the item lists of enumerations, are not repeated in each file: they are in
`generated/schema.json` (`propertyTypes[typeId][property]` and `enumLists[key]`). Properties of the same name on different object types are
distinguished by the typeId.

### objects[]

| field | meaning |
|---|---|
| `name`, `label`, `typeId` | internal name, label (fixed by the scripts), type such as `PartDesign::Pad` |
| `status` | `obj.getStatusString()`: `"Valid"` or FreeCAD's error text |
| `properties` | `{property: value}` as FreeCAD stores them, encoded as below. `Shape` and the other shape properties, `Geometry`, `Constraints`, `ExternalGeo` are not here (see `shape`, `sketch`) |
| `outList` | names of the objects this one links to (sorted) |
| `parentGeoGroup` | name of the Body / App::Part that holds the object, or `null` |
| `expressions` | `[{path, expression, value}]`: the expression engine entries, with FreeCAD's evaluated value (the pairs `[path, expression]` are also in `properties.ExpressionEngine` when there is any) |
| `globalPlacement` | only when it differs from the `Placement` property (objects inside Parts or Bodies with a placement, or objects without `Placement`) |
| `shape` | the stored shape's measures, for every object with a `Shape` (see below) |
| `extraShapes` | measures of other shape properties that are not null (for PartDesign features: `AddSubShape`, the additive/subtractive part of a feature) |
| `sketch` | for `Sketcher::SketchObject` |
| `sheet` | for `Spreadsheet::Sheet` |

Property value encoding:

| FreeCAD type | JSON |
|---|---|
| bool, int, float, string | as is |
| `PropertyLength`, `PropertyAngle`, other quantities | `{"value": 10.0, "unit": "Length"}` (value in mm / degrees / SI base; `unit` is FreeCAD's unit type name, `""` plus `signature` for composite units) |
| `PropertyEnumeration` | `{"enum": "One side", "index": 0, "items": "e8b239fe9"}`; `items` is a key into `schema.json` `enumLists` (the list is part of the data: Hole thread lists depend on the thread type) |
| `PropertyVector` | `[x, y, z]` |
| `PropertyPlacement` | `{"pos": [x, y, z], "rot": [qx, qy, qz, qw]}` (unit quaternion, x y z w order) |
| `PropertyLink` | the linked object's name, or `null` |
| `PropertyLinkSub` | `[name, [subnames]]` (e.g. `["Pad", ["Face6"]]`), `null` when empty |
| `PropertyLinkList`, `PropertyLinkSubList` | list of names / list of `[name, [subs]]` |
| `PropertyExpressionEngine` | `[[path, expression], ...]` (omitted when empty) |
| `PropertyPlacementList`, vector lists, ... | lists of the above |
| shape properties | `null` here, measures in `shape` / `extraShapes` |

Empty `ExpressionEngine` and empty `Label2` are omitted. For the Origin axes/planes/point (`App::Line`, `App::Plane`, `App::Point`) only
`Label`, `Role` and `Placement` are kept.

### shape

`{null, shapeType, valid, volume, area, length, centerOfMass, boundBox:{min,max}, solids, shells, faces, edges, vertices, placement}`, measured by
FreeCAD (OCCT) on the shape **stored in the file** for that object (after `--reopen` it is exactly what a reader of the `.brp` sees).
`placement` is the shape's own placement (its bounding box and centre are in global coordinates of the shape as stored).
Notes: for compounds without a single solid FreeCAD cannot give a centre of mass, the driver then uses the volume-weighted centres of the
solids (`null` if there are none); open shells made by `Part::Extrusion(Solid=false)` and `Part::Revolution(Solid=false)` have a negative
`volume` (signed); wires and sketches have `volume` 0 and a `length`. Datum shapes (`PartDesign::Plane`, `Line`, `Point`, `CoordinateSystem`)
are infinite or unit-less, so only `{null:false, datum:true, placement}` is given. FreeCAD's own integration is not exact for some
analytic shapes (a PartDesign ellipsoid of radii 3,4,5 has volume 251.2175 instead of 251.3274); the oracle is FreeCAD's number.

### sketch

```
{"geometry": [{"index", "type", "construction", ...}],
 "constraints": [{"index", "type", "value", "name"?, "first", "firstPos", "second"?, "secondPos"?, "third"?, "thirdPos"?, "driving"?, "active"?, "virtualSpace"?}],
 "externalGeometry": [[objectName, [subs]]], "fullyConstrained",
 "solve", "dof", "conflicting", "redundant", "partiallyRedundant", "malformed"}
```

- Geometry `type` is the class name: `LineSegment` (`start`, `end`), `Circle` (`center`, `radius`, `axis`), `ArcOfCircle` (+ `firstParameter`,
  `lastParameter`, `start`, `end`), `Ellipse` / `ArcOfEllipse` (`center`, `majorRadius`, `minorRadius`, `axis`, `majorAxisDir`), `ArcOfHyperbola`,
  `ArcOfParabola` (`focal`), `Point` (`point`), `BSplineCurve` (`degree`, `periodic`, `poles`, `knots`, `multiplicities`, `weights`, `start`, `end`).
  Coordinates are sketch-local (2D, z = 0); the sketch `Placement` property maps them to the body/document.
- Constraint `type` is FreeCAD's name (`Coincident`, `Horizontal`, `Vertical`, `Parallel`, `Perpendicular`, `Tangent`, `Equal`, `Symmetric`,
  `PointOnObject`, `Distance`, `DistanceX`, `DistanceY`, `Radius`, `Diameter`, `Angle`, `Block`, ...). `first/second/third` are geometry indices
  (`-1` is the sketch's horizontal axis, and `-1` with pos 1 is the origin point; `-2` is the vertical axis; `-3` and below are external geometry; `-2000` is FreeCAD's "undefined"),
  `*Pos` is 0 (edge), 1 (start), 2 (end), 3 (centre). `value` is in mm, **radians for Angle constraints**. Keys at their defaults are omitted:
  `name` "", `second`/`third` = -2000 with pos 0 (undefined), `driving` true, `active` true, `virtualSpace` false.
- `solve` is the return value of `Sketch.solve()` (0 = ok), `dof` the remaining degrees of freedom. A model fails if any list of constraint
  indices (`conflicting`, `redundant`, `malformed`) is not empty. Conics and splines built through the Python API have free degrees of freedom
  (the GUI adds internal alignment constraints for them): they are blocked or left free on purpose, and `dof` says which.
- The sketch's own `shape` is the wire/compound of its edges (`length`, `edges`, `vertices`, bounding box).

### sheet

`{"cells": [{"address": "B1", "content": "=a * 10 mm", "alias": "len", "value": {"value": 30.0, "unit": "Length"}}]}`: `content` is the raw
cell text, `value` FreeCAD's computed value (number, quantity or string), `alias` the alias or `null`; `error` replaces `value` when a cell
fails. Aliases are also properties of the sheet, in `properties`.

### Variants

`NN.v1.FCStd` / `NN.v1.dump.json` are the same document after `variant()` changed something (a sketch dimension through `setDatum`, a
spreadsheet cell, a VarSet property, an offset, a Tip, a pattern count, ...) and FreeCAD recomputed everything. `variant` in the v1 dump
holds the description, including FreeCAD's expected effect where easy. The importer test is: import the base file, change the same
parameter on the imported model, and reproduce the numbers in the v1 dump (or import the v1 file and compare).

### Stripped and unstable data

- Stripped (listed in `stripped` of every dump): document `Uid`, `Id`, `CreationDate`, `LastModifiedDate`, `FileName`, `TransientDir`,
  `CreatedBy`, `LastModifiedBy`, `Comment`, `Company`, `License`, `LicenseURL`; object `Uid` (random UUID of App::Part), `_LinkOwner`
  (object id of link elements), `_ElementMapVersion`, `_ExternalGeoVersion`, `ShapeMaterial`, `_Part_ShapeCache` (runtime cache).
- Reopen: a document saved and loaded again is dumped identically except (all documented, none hides a geometry difference):
  last-bit differences of floats (compared at 1e-12 relative); `items` lists of dynamic enumerations of PartDesign Hole (`ThreadSize`,
  `ThreadClass`, `ThreadFit`): FreeCAD rebuilds them on load, so only the stored `index` is compared (the dump of the live document carries
  the list of its thread type); `ThreadDiameter` of a Hole, which FreeCAD derives again on load.
- Run to run: the files are produced by a multi-threaded geometry kernel; numbers can differ in the last digit between two runs
  (`compare.mjs` with `--rel 1e-12` shows no difference between two runs of the same version). Do not diff generated files byte for byte.
- Element names such as `Face6` in `Profile`, `Base`, `AttachmentSupport` are what FreeCAD 1.1 stores; they are indices into the
  referenced object's stored shape (OCCT `TopExp::MapShapes` order). The `.Map.txt` files inside the `.FCStd` hold the mapped names.

## Reading an FCStd next to its dump (for the importer test)

For each object in `objects[]` with `shape` and a matching `<Name>.Shape.brp` in the zip: the importer's own shape for that feature
must reproduce `shape.volume`, `shape.area`, `shape.centerOfMass`, `shape.solids` (MitCad-style per-feature check; relative 1e-5 is a
reasonable first tolerance, FreeCAD's stored results agree to 1e-9 with themselves). For sketches compare `sketch.geometry` with the
imported geometry and `sketch.constraints` with the imported constraints. For expressions compare `expressions[].value`.

## The importer test

`packages/fcstd/src/corpus.kernel.test.ts` is the oracle for the importer (run on the CI box, see `docs/fcstd.md`): it builds every model with
our importer and the kernel and compares the Body Tip (or each Part result) with the dump, then does the same for the `.v1` files and for
"base file, same parameter changed through the importer". `RESULTS.md` / `RESULTS.json` are its report (written with `UPDATE_CORPUS=1`),
`expected.json` the class each model and each Tip must at least reach (the test fails on a worse class and on a model missing from it),
`ROADMAP.md` what remains by cause. `src/import.corpus.test.ts` checks what the importer maps without a kernel.

