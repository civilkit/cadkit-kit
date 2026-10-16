# Parts library (BOSL2)

An editable, parametric catalog ported from [BOSL2](https://github.com/BelfrySCAD/BOSL2) (BelfrySCAD/BOSL2, BSD-2-Clause; attribution and licence text in `THIRD_PARTY.md`).
It is the **Parts library (BOSL2)** section at the bottom of the Catalog tab (see `docs/catalog.md` for the shape catalog above it).

Placing an entry does not drop a mesh or an opaque block: it adds REAL features (sketches, extrudes, lofts, revolves, fillets, chamfers) to the open part through the
script API (`docs/scripting.md`), so the result is edited afterwards in the feature tree, the Variables tab and the size box like anything else. Curved faces are exact
(cylinders, cones, spheres, tori); nothing is a polyhedron.

## Using it

* **Search** (BM25 with the skill package's CAD synonym table: "pipe" finds Tube, "hexagon" Regular prism, "ramp" Wedge, "donut" Torus, "printable hole" Teardrop) and **category** chips.
* Click a card to select it: its **parameter form** (typed fields with units; `*` marks a value that becomes a document variable), the BOSL2 module it comes from and the
  **script** it will add (a read-only preview; the same text is what runs).
* **Drag the card onto the model**, or click it and then click a face (Alt turns snapping off, Esc cancels). While the pointer moves the real features are previewed (the
  parameters as plain numbers); the drop commits them as ONE undo step together with the variables.
* First body: drop on the **ground plane**, the horizontal plane of the view's up axis (Top for Y up, Front for Z up), and the shape rises away from it, base on the plane. Edge masks need a body and are placed with the cut items (they act on the edges of the picked face).
* **`mode`** (cuboid, tube, rectangular tube, pie slice, regular prism, cylinder): `add` (default) or `cut`: the same shape removed from the part, going INTO it from the picked face (anchor `bottom`) or symmetric about the face (`center`). A cut needs a body (it is placed with the cut items), cannot be rounded or chamfered and a cone cannot be a cut. The oracle compares it with `difference() { cuboid([100, 100, 20]); up(20) mirror([0, 0, 1]) <shape>; }`.
* The `anchor` parameter is where the shape sits relative to the sketch plane: `bottom` (the default, base on the face) or `center` (BOSL2's `CENTER`: half of it goes into the part).

## What gets created

For `cuboid` with `rounding = 3`, dropped on a face of a slab (the text shown in the form and added to the part, abridged):

```js
variables({ cuboid1_z: 20, cuboid1_rounding: 3, cuboid1_chamfer: 0 });
const body_ = part('Cuboid')
  .sketch(face("F2.C1"), (s) => s.rect(40, 30, [10, -5]))
  .extrude(expr('cuboid1_z'));
const body = body_.handle();
body_.fillet(edges({ createdBy: body, not: edges({ onFace: face('F2.C1') }) }), expr('cuboid1_rounding'));
```

* **Variables.** Parameters that map to a feature parameter (extrude depth, fillet radius, chamfer distance, loft offset) are declared with `variables({...})` under a unique prefix
  (`cuboid1_`, `cuboid2_` for the next drop) and used through `expr()`, so editing the variable in the Variables tab regenerates the part. Parameters that only shape a SKETCH (a
  width, a diameter, an angle) are numbers in the sketch: the script API cannot link sketch geometry to variables ("inside a sketch an expr contributes its current number only").
  Edit those in the sketch (size box, sketch editor) or in the script. This is the main limit of "editable by variables" today.
* **On a face** the entry's fillets and chamfers leave the footprint edges alone (`not: edges({ onFace: face(host) })`), so a rounded boss merges with the face instead of filleting its junction.
* **Revolved entries on a face** (sphere, torus, onion, chamfered or rounded cones) build a helper line sketch on the face and a plane perpendicular to it (its y is the face normal), then
  revolve about that normal; the helper sketch and plane are hidden in the view (still in the tree). On a standard plane they revolve on a standard plane perpendicular to it (Front: Right about Z; Top: Right about Y; Right: Top about X), about the plane normal.

## Placing on a plane (ground, Front / Top / Right, plane features)

BOSL2 shapes are Z-up (a prismoid's height runs along the sketch normal) and the world is Y-up with the ground the Top plane (XZ). So the first body no longer always goes on Front (which, with Y up, stood the shape on its side): with no plane named it goes on the ground plane of the up axis and rises away from it.

* **Where**: while a card is dragged (or armed) the three reference planes are drawn as drop targets; the one under the pointer lights up and the drop hint names it (`First body on the Top plane`, `On the Front plane` when a body exists). Drop on a plane in the viewport, on its row in the history tree, or on a plane feature; or click the card and then click the plane. A face under the pointer wins over a plane; with a body, empty space is not a target (only a drawn plane is). Cuts and masks need a face.
* **Placement row** (top of the Catalog tab; applies to the Shapes items too): *Place on* (Ground by default, or Front / Top / Right; a hovered plane overrides it), *Direction* (Up = away from the plane along its normal, Down = flipped to the other side), *Rotate* 0/90/180/270 about the plane normal, *Mirror*. It changes the live preview. **R** rotates 90 degrees and **F** flips while dragging or armed (hint line `R rotate  F flip  Esc cancel`).
* **How it is built** (`catalog/placement.ts`): in the sketch-plane frame. The sketch goes on the chosen plane; rotate/mirror turn the profile points about the shape centre (a mirror swaps arc ends); flip sets the extrude's own `flip` (a loft's section planes get `flip`; a revolve profile is drawn on the far side). The features stay ordinary: the Flip toggle of the extrude in the feature editor still works, and the history entry reads e.g. `Catalog: Prismoid (Top plane, flipped, turned 90)`. Things already placed keep their old placement.
* **Frames**: Front is x=X, y=Y, normal +Z; Top is x=X, y=-Z, normal +Y; Right is x=-Z, y=Y, normal +X (`STD_FRAMES`). Flip reverses the normal.
* **Limits**: the BOSL2 orientation of Wedge and Teardrop (oracle frame) applies on an unmodified Front placement only; on other planes (or when turned / flipped) they are drawn in plane-local axes like on a face. Dropping on a plane feature or a tree row puts the centre at the plane's origin projection; rotate/mirror/flip do not apply to a face placement (a face has its own frame and the shape grows out of it). Revolved shapes ignore rotate and mirror (they are symmetric about the normal).

## How it is built (files)

| File | Role |
| --- | --- |
| `apps/cad/src/catalog/bosl/entries.ts` | The entry data and two pure functions per entry: `script(params, place)` (script text) and `scad(params)` (the BOSL2 call for the oracle). No runtime imports: `tools/bosl_reference.mjs` loads it under plain node. |
| `apps/cad/src/catalog/bosl/build.ts` | `buildBosl`: runs the entry's script in ATTACH mode (`runScript(..., { prefix })`) against the open document without touching it; returns ops (preview) or a `DocPatch` (variables + features, one step). |
| `apps/cad/src/docFields.ts` | `DocPatch.append` / `seq`: the new features go in with the variables as one history record (redo replays the patch). |
| `apps/cad/src/catalog/placer.ts`, `useCatalog.ts`, `shapes.ts` | The existing placement engine; a catalog item with `bosl: { entryId, params }` is built by `buildBosl` instead of `buildShape`. |
| `apps/cad/src/catalog/BoslSection.tsx`, `bosl/search.ts`, `bosl/state.ts` | The panel section, the search, the form state. |
| `apps/cad/src/catalog/bosl/thumbs.generated.ts` | Thumbnails (PNG data URLs) rendered with `@kit/snapshot` from the kernel body of each entry; regenerate with `BOSL_THUMBS=1 CK_WASM=... npx vitest run apps/cad/src/catalog/bosl.thumbs.kernel.test.ts`. |
| `apps/cad/src/catalog/bosl_reference.json` | OpenSCAD reference values (see below). |
| `apps/cad/src/catalog/bosl.kernel.test.ts`, `bosl.place.kernel.test.ts`, `BoslSection.test.tsx` | The oracle test, the placement tests, the panel / search / parameter tests. |

## Adding an entry

1. Add an object to `entries.ts` (copy the closest one): `id`, `name`, `category`, `tags` (search synonyms), `params` (`length | angle | integer | bool | choice` with `min`, `max`, `default`, `unit`; `linked: true` when the script uses the value through `expr(...)`), `source` (BOSL2 module and file), `notes`,
   `check(params)` (null or the reason the values are invalid), `script(params, place)` and `scad(params)`. Optional `samples` are named parameter sets the defaults leave out (rounding, caps) and become oracle cases too.
   `place.plane` is `'front'` / `'top'` / `'right'` (ground, see `place.base` and `place.axis`) or `face("F2.C1")`; use `place.at` for the footprint centre, `place.prefix` (null: numbers, else the variable prefix), and `ownEdges(place)` for the edges a fillet may touch.
2. Add the i18n keys in `apps/cad/src/locales/en.ts`: `catalog.bosl.entry.<id>` and `catalog.bosl.param.<key>` for every new parameter, and list the new keys in `tools/i18n_dynamic.json` (the section builds them dynamically).
3. Add the card icon mapping in `BoslSection.tsx` (`KIND`) and regenerate the reference and the thumbnails:
   `node tools/bosl_reference.mjs --bosl <dir that contains BOSL2/> --scratch <work dir> --only <id>` and the thumbnail test above.
4. `npx vitest run apps/cad/src/catalog` (with `CK_WASM` set) must be green: the oracle test picks the new entry up from the JSON.

## The oracle

`tools/bosl_reference.mjs` runs the real BOSL2 module in OpenSCAD for every entry and parameter set (defaults, four seeded random sets from `randomParams`, and the entry's `samples`), exports a binary STL and computes the **volume** (signed tetrahedra), **surface area**
and **bounding box**. The values go to `apps/cad/src/catalog/bosl_reference.json` together with the OpenSCAD version, the BOSL2 commit and `$fn` (256), so CI and other machines do NOT need OpenSCAD.
Cases already in the file with the same OpenSCAD call, version and commit are reused (`--only a,b` limits the entries; one OpenSCAD process at a time).

```
git clone --depth 1 https://github.com/BelfrySCAD/BOSL2.git <dir>/BOSL2
node tools/bosl_reference.mjs --bosl <dir> --scratch <work dir>      # all entries; Node 22.18+ (it reads the TypeScript entries)
```

`bosl.kernel.test.ts` builds every case through the real kernel from the entry's script text and asserts: the script runs without errors, ONE valid solid, volume within **1e-6** (relative) for flat shapes and **0.3 percent** for curved ones
(OpenSCAD facets the circle at `$fn = 256`, which makes its volumes about 1e-4 smaller than the exact ones), bounding box within 0.01 mm (flat) or 0.4 percent of the largest side (curved: the display mesh is a tessellation).
Masks are applied to their oracle host block (a 40 x 30 x 20 cuboid) and compared to BOSL2's `diff() cuboid() edge_mask(TOP) ...`.

The bounding box used is the union of the kernel's exact one (`check`) and the display mesh's: the kernel's `check` bbox misses the extent of a full 360 degree revolved face (a sphere reports one half), and the display mesh omits
the cone of a revolved profile that ends in a point (an uncapped onion), so each alone is wrong for some entries.

### Result (BOSL2 `48304c31`, OpenSCAD 2021.01, `$fn = 256`; worst case over the cases of each entry)

| Entry (BOSL2 module) | Parameters | Cases | Volume error | Bbox error (mm) |
| --- | --- | --- | --- | --- |
| Cuboid (`cuboid`) | mode, x, y, z, rounding, chamfer, anchor | 9 | 2.9e-5 | 0 |
| Prismoid (`prismoid`) | x1, y1, x2, y2, h, shiftx, shifty | 5 | 7.4e-8 | 0 |
| Wedge (`wedge`) | x, y, z | 5 | 8.2e-8 | 0 |
| Rectangular tube (`rect_tube`) | mode, h, x, y, wall, anchor | 6 | 4.1e-7 | 0 |
| Cylinder / cone (`cyl`) | mode, h, d1, d2, rounding, chamfer, anchor | 10 | 1.1e-4 | 0.0063 |
| Tube (`tube`) | mode, h, od, id, anchor | 6 | 1.0e-4 | 0 |
| Pie slice (`pie_slice`) | mode, h, d, ang, anchor | 6 | 1.0e-4 | 0.0012 |
| Regular prism (`regular_prism`) | mode, n, h, r, realign, rounding, chamfer, anchor | 8 | 1.0e-5 | 0 |
| Sphere (`spheroid`) | d, anchor | 5 | 2.8e-4 | 0.0022 |
| Torus (`torus`) | rmaj, rmin, anchor | 5 | 2.0e-4 | 0.0104 |
| Teardrop (`teardrop`) | l, r, ang, cap_h | 6 | 8.8e-5 | 0 |
| Onion (`onion`) | r, ang, cap_h | 6 | 2.5e-4 | 0.0063 |
| Round face edges (`rounding_edge_mask`) | r | 5 | 1.3e-5 | 0 |
| Chamfer face edges (`chamfer_edge_mask`) | c | 5 | 1.5e-8 | 0 |

The curved volume errors are the facet error of the OpenSCAD reference (a regular 256-gon is 1e-4 smaller than its circle; the sphere 2.8e-4), not kernel error: the kernel's exact volumes agree with the analytic formulas to 1e-9.

### What does not match BOSL2 exactly

* **Cuboid chamfer corners.** BOSL2 `cuboid(chamfer=)` trims the corner where three chamfers meet by default (`trimcorners=true`, one more small cut: 2.25 mm3 per corner at c = 3). The entry is compared with `trimcorners=false`, which is what the kernel's chamfer makes.
* **Facet counts.** BOSL2 meshes curves with `$fn`, `$fa`, `$fs`; the entries are exact, there is no facet parameter. The oracle uses `$fn = 256`.
* **Not ported** (BOSL2 options of the same modules): `edges` / `except` (partial edge sets) of `cuboid`, `rounding` / `chamfer` of `prismoid` (a ruled loft between rounded rectangles is not an exact kernel surface), `tube` rounding and `shift`, `cyl` `rounding1/2` and the `texture` options, `regular_prism` side/inside radius forms and `shift`, `teardrop` chamfers and bottom corner, `spheroid` styles (`aligned`, `octa`, `icosa`, `stage`: the kernel sphere is exact, those are mesh styles).
* **Anchors.** Only the two that matter for placing on a face (`bottom`, `center`); `spin`, `orient` and named anchors are not ported (rotate the part or place on another face).
* **Teardrop and wedge on a face** extrude along the face normal (their BOSL2 axis is Y and X); on the ground they are in BOSL2's orientation.
* **Curved host faces** are refused ("needs a flat face"); the built-in shapes use a tangent plane there, the revolve helper plane of the entries needs a face frame.

## Kernel and API gaps found

* The script sketch builder rounded point coordinates to 6 decimals, which made a computed arc end point miss its circle by 5e-7 and gave `noClosedProfile` (fixed: 10 decimals).
* `loft`, `sweep` and the other multi-sketch helpers took `at()` planes on STANDARD planes only: `at(face(...), h)` or a plane handle gave `missingReference`. They now use the same plane builder as `sketch(at(...))`.
* A script run in attach mode ignored the open document's variables (features using `expr('v')` failed `badExpression` while the run built). `runScript(code, host, base, opts)` now keeps `base.variables` and appends the script's own.
* Kernel `check` bbox is wrong for a full revolve (extent of one half); the display mesh of a revolve that ends in a point lacks the cone face. Volume, validity and faces are right in both cases.
* The script API cannot link sketch dimensions to variables, so a variable edit changes depths, offsets, fillet and chamfer sizes but not a width or diameter.
* `edges({ onFace: ... })` and `createdBy` both select edges by the faces they bound, so "the footprint edges of a boss on a face" needs `not: edges({ onFace: face(host) })`; there is no "edges of this feature that do not touch older features".
* OpenSCAD 2021.01 (the installed version) has no Manifold backend: BOSL2 shapes with `$fn = 256` take 5 to 8 seconds each in CGAL. The reference file is the reason this does not matter for CI.

## Next BOSL2 sections to port

| Section | What it needs | Kernel / API gaps |
| --- | --- | --- |
| `shapes2d.scad` (ellipse, regular_ngon with rounding, star, trapezoid, teardrop2d, pie_slice 2D) | sketch entries (lines, arcs, splines) as "profile" entries to extrude, revolve or cut | none; ellipse needs an exact ellipse sketch entity (spline otherwise) |
| `masks.scad` (rest) | teardrop edge mask, rounding / chamfer cylinder and hole masks (`rounding_hole_mask`), corner masks | selecting a hole's circular edge from a picked face; corner masks need a vertex pick |
| `screws.scad`, `threading.scad`, `metric_screws.scad` | screws, nuts, screw holes with thread: the kernel has hole threads (cosmetic and modelled) and helix features | modelled external thread on a cylinder (kernel `thread`), screw head drive recesses (profiles + patterns), `screw_hole` tolerance tables |
| `gears.scad` | spur, rack, bevel, worm gears | our gear generator covers spur and helical; rack, bevel, worm and planetary need new profile generators |
| `joiners.scad`, `hinges.scad`, `sliders.scad` | dovetails, snap pins, half joiners, knuckle hinges, rails and sliders: extruded profiles plus patterns and mirrors | hinges need two-part output (the document is one part; use `insertPart` + `mate`) |
| `ball_bearings.scad`, `linear_bearings.scad` | revolved profiles, ball patterns | none (circular pattern about an axis through the origin only) |
| `nema_steppers.scad` | motor body, mount plates with holes and patterns | none |
| `polyhedra.scad`, `cubetruss.scad` | platonic solids, truss modules | no polyhedron / face-from-points feature in the kernel; build from lofts and extrudes per shape |
| `walls.scad`, `modular_hose.scad`, `hooks.scad`, `bottlecaps.scad`, `tripod_mounts.scad` | profile sweeps, patterns | sweep keep-normal; `rounding.scad` (`round_corners`, `offset_sweep`) needs offset curves on sketch profiles |

Cross-cutting next steps: `mode: cut` for the loft and revolve entries (prismoid, cones, sphere, torus, onion, teardrop, wedge), the `edges` / `except` options of `cuboid`, a curved-face placement through a tangent plane, live preview of the parameter form
(re-run the preview while a field is edited; today the preview follows the pointer), and a sketch dimension to variable link in the script API.
