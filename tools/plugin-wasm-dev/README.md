# Developing and testing wasm plugins

A wasm plugin is a SolidCraft `craft:plugin@0.1.0` component (for example the MIT woodwork plugin). The app never compiles it: it installs a **package** made by `tools/plugin_wasm_pack.mjs` (jco output, our `plugin.json`, a sha256 for every file).

## One-time setup (this folder only; jco is not an app dependency)

    cd tools/plugin-wasm-dev && npm install        # @bytecodealliance/jco 1.42.0 (about 340 MB of node_modules, ignored by git)

## Pack a plugin

    node tools/plugin_wasm_pack.mjs \
      --from <folder with the plugin's plugin.json and its .wasm, e.g. an unpacked release> \
      --jco tools/plugin-wasm-dev/node_modules/@bytecodealliance/jco/dist/jco.js \
      --id tomasdjo.woodwork --entries cabinet,corner,joinery,material --preview-off labels,shelf_pins --out <scratch dir>/woodwork
    # --preview-off: boolean switches whose detail is slow to build (an engraved label, rows of holes). The live preview runs with them off and says so; Add builds them.
    # A plugin authored for CivilKit can set `previewOff: true` on the parameter, or `"x-preview-off": true` in a JSON schema.
    # writes <scratch dir>/woodwork.zip: install it from Plugins > Install from a .zip file

## Run the kernel tests against a package

    CK_WASM=<gated kernel wasm> CK_WOODWORK_ZIP=<scratch dir>/woodwork.zip \
      npx vitest run packages/plugin-wasm

The Extrusions plugin has its own: `CK_EXTRUSIONS_ZIP=<release.zip> vitest-queue run packages/plugin-wasm/src/extrusions.kernel.test.ts` (rails and nuts for real, volumes against the catalogue areas).

## Attack the sandbox (needs Chrome, `zip` and a served build)

    tools/serve_local.sh --port 5191
    node tools/plugin_sandbox_check.mjs --zip <woodwork.zip> --work <scratch dir> --port 5191

Woodwork 0.1.7 runs on this host, installed straight from the author's zip (the app converts it at install; no pack step is needed): `cabinet`, `corner`, `joinery` and `material` are wired, and `cutlist` is a read entry (Run instead of Add: it reads the open document, shows a table, and a "Save as" file comes back as a download; the manifest's `permissions.files` is shown at install and no folder is ever read or written). `edit` (the app's own Edit parameters does that) is left out. Placing, labels, turned doors, Match selected and Joinery on a moved cabinet are covered by `packages/plugin-wasm/src/woodwork.kernel.test.ts`; the Cut list by `packages/plugin-wasm/src/cutlist.test.ts` (set `CK_WOODWORK_RELEASE` to the unzipped release). Not done: joints (doors and drawers do not swing, `Place` makes no link between cabinets: the document has no kinematic joints).

The woodwork plugin is MIT licensed (copyright its author); the package carries its LICENSE file. Ask the author before publishing a package or any fixture derived from their sample kitchen.

## Read entries: what the host answers

A `read` entry may call only these commands, and only if the manifest's command list (`runtime.commands` in a release) names them (the host refuses any other, the sandbox page enforces the list too). They answer from the open document and record nothing. Lengths are millimetres, in the plugin's frame (Z up; a Y-up document is turned).

| Command | Arguments | Returns |
|---|---|---|
| `document.inspect` | none | `{ units, parameters, params, bodies, timeline, selection }` |
| `inspect.measure` | `bodies?: string[]`, `names_only?: boolean` | `{ bodies: [{ name, volume_mm3, bbox: { min, max }, material }] }` |
| `selection.get` | `detail?: boolean` | `{ items: [{ type, name?, body?, surface?: { normal } }] }` |
| `material.list` | none | `{ materials: [{ name, density_g_cm3 }] }` |
| `model.mesh` | `body?: string` (what Woodwork sends, with `tolerance`, accepted and ignored), or `bodies?: string[]`; no selector means every body | for `body`: `{ units: 'mm', name, vertex_count, triangle_count, positions: [x,y,z][], indices: number[], triangle_face: number[] }`; otherwise `{ units: 'mm', bodies: [that, ...] }` |
| `model.faces` | `body: string` | `{ units: 'mm', body, faces: [{ index, name, exact, area, centroid, plane_normal?, point, cylinder?: { origin, axis, radius } }] }` |
| `model.edges` | `body: string` | `{ units: 'mm', body, edges: [{ index, name, point, length, curve: 'line' \| 'circle' \| 'curve', centre?, axis?, radius? }] }` |
| `model.threads` | none | `{ threads: [{ id, face, standard, size, length, hand, modeled }] }` (the thread features of the open document; an empty list when there are none) |

`model.faces` / `model.edges` details: all three are reads like `model.mesh` (answered from the open document, nothing recorded; a call after the run has recorded an edit, or for a body that is not in the document, is an error). `faces` come in the body's own order, `index` is the one a face selection carries and `name` is the face's selection name (what `face.delete`, `solid.shell` and `sheet.convert` take in place of a point). Area, normal and cylinder are worked out from the display tessellation: `exact: true` means a plane or a cylinder was recognised, `exact: false` any other face (only `area`, `centroid` and `point` then; `point` lies on the face, `centroid` may not). `edges` carry a point on the edge (the middle of its polyline), its length (the polyline's, so a circle is a little short of the true one) and, for a circle, `centre`, `axis` and `radius`. The reply shapes are the kit's reading of the SolidCraft catalog (0.16.2), not yet checked against the SolidInserts binary.

`model.mesh` details: `positions` is the list of welded vertices, each `[x, y, z]` (rounded to 0.1 micron; Woodwork reads exactly this nested form: a flat list gives it nothing and its cut list prints an unreadable size), `indices` is flat with three per triangle (outward winding), `triangle_face[t]` is the index of triangle `t`'s face in the body's face list (the `index` a face reference from `selection.get` carries). A body that is not shown has an empty mesh. An unknown body name is an error (`model.mesh: no body named "X" in the open document`); so is a call after the same run has recorded an edit (the mesh is the open document's, not the run's), and one that would return more than 200000 triangles (ask for fewer bodies per call). The mesh is the display tessellation, so a curved board is faceted (its volume is slightly under the true one); a size taken from it is a size of the faceted body. The arrays reach the plugin as JSON through `commands.run`, like every other reply.

Checked against the real Woodwork 0.1.7 binary (through the kit's host only): its cut list calls `model.mesh` with `{ body, tolerance: 1 }` for a board whose volume is not its bounding box's, and reads `positions` as `[x,y,z]` points at the top level of the reply. A 24-sided turned spindle (40 mm diameter, 300 mm long) comes out as 300 x 40 x 40 (`cutlist.test.ts`, needs `CK_WOODWORK_RELEASE`).


## What the host does for the Extrusions plugin (rails and slot nuts)

Both entries (`make-extrusion`, `make-t-nut`) run for real. Sketches are recorded (lines, arcs, splines, circles, points, with SolidCraft's curve and point ids), their closed profiles and areas are found, and the replay turns them into kernel sketches and extrusions. How each command is answered:

| Command | State |
|---|---|
| `sketch.line`, `sketch.arc.three_point`, `sketch.spline.fit_point`, `sketch.circle.center`, `sketch.point` | real: drawn into the recorded sketch; a point may be given by its id (`hole1.center`); a point landing on an existing point is one point |
| `sketch.inspect`, `sketch.finish`, `sketch.replace` | real: curves, points, profiles with area, plane; `replace` copies another sketch's geometry |
| `sketch.project` | real for a straight path line: its ends drop onto the sketch plane as a construction line |
| `sketch.dimension`, `sketch.constraint.coincident`, `sketch.constraint.fix` | recorded only. There is no constraint solver here: geometry stays where it was drawn (the plugin draws it already at its dimensions). `fix` marks the point |
| `solid.extrude` | real: profiles picked by index, by a point inside, or by the curves of the region; new, join, cut, intersect |
| `solid.sweep` | real for ONE straight line with the profile square to it (recorded as the extrusion of the line's length). A curve, a chain, rails, twist or scale are refused |
| `solid.sphere` | real (join, cut, intersect or a body of its own) |
| `solid.hole` at the points of a sketch, or with a thread and no diameter | real as a bore of the tap drill (M2 to M12). The thread form is not cut, so `thread_modeled` makes no difference to the solid. A tap whose bore already is that diameter (a rail's core) cuts nothing |
| `construct.plane.along_path`, `construct.plane.axis_point` | real for straight paths; the plane can be named in `sketch.create` (that lookup is one line in `sketchPlane`) |
| `occurrence.move` with `to_matrix`, `occurrence.copy` | real: the first placement moves the part's bodies, a copy is a copy of the part at the origin, named `Body (Part:2)`. All placements are made after everything else |
| `occurrence.reparent`, `browser.visibility` | recorded only (no folders or visibility in the replay) |
| `component.properties` | real: volumes and bounding boxes from a build; the mass uses the body's material density, steel (7.85 g/cm3) when it has none |
| `component.list`, `timeline.inspect`, `model.body_features`, `document.inspect` timeline, `parameters.list`, `parameters.users`, `appearance.list`, `document.metadata.set` | answered from what is recorded, in the shapes the plugin's part inspection reads (feature numbers from 1 for sketches, planes and solids, a definition with `component`, the sketch geometry listed as omitted so `sketch.inspect` is read). `parameters.users` never lists drivers (feature inputs are not parameter driven here) |

Limits: Placement refs (`external_sketch_point`, `external_sketch_curve`) name sketches of the run; sketches of the open document are not yet read into the host, so in the app a rail is placed on the origin until that is wired. Fixed-length rails on several points need the same. The replay of a run is one script, so the 256-command limit is the plugin's own count (a 2020 with taps and holes is about 60 commands).
