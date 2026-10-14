# Feature commands

Fillet, chamfer, shell, hole, revolve, linear pattern and circular pattern. Each is a palette command and a Home > Features
ribbon button. Each creates its feature as one edit (one undo step), clears the viewport selection that fed it, and opens
the Editor tab on the new feature. Code: `apps/cad/src/featureCommands.ts` (pure rules and edits), registered through
`Actions.features` in `commands.ts` and `featureActions` in `main.tsx`. Tests: `featureCommands.test.ts` (rules, text) and
`featureCommands.kernel.test.ts` (real kernel: no regen errors, face count, volume, box).

Default size: about 5% of the smallest bounding-box dimension of the body on screen, rounded to the nearest of
1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10 times a power of ten (box 40 x 25 x 10 gives 0.5).

| Command | Enabled when | Defaults | Kernel fields |
|---|---|---|---|
| Fillet (`add-fillet`) | edge mode and at least one selected edge | radius = default size | `fillet {radius, edges:[{faces:[a,b], at:[x,y,z]}]}` |
| Chamfer (`add-chamfer`) | same | `chamferType:'equal'`, distance = default size | `chamfer {chamferType, distance, edges}` |
| Shell (`add-shell`) | face mode and at least one selected face | thickness = default size; selected faces are the open faces | `shell {faces:[...], thickness}` |
| Hole (`add-hole`) | a body exists and (exactly one face selected, or the document has a sketch with point entities) | kind `simple`, diameter = 10% of smallest dimension (nice), `end:'through'` | `hole {sketch, kind, diameter, end, flip?}` |
| Revolve (`add-revolve`) | the document has a sketch (the one selected in the tree, else the last) | `op:'add'`, 360 degrees, axis = first construction line | `revolve {op, sketch, axis:<line id>, end:'blind', angle}` |
| Linear pattern (`add-lpattern`) | a feature that is not a sketch or pattern exists | count 3, spacing = 20% of the body length along the longest world axis, direction = that axis | `lpattern {seeds:[id], dir:{kind:'axis',axis}, spacing, count}` |
| Circular pattern (`add-cpattern`) | same | count 3, 360 degrees, equal spacing, axis = the world axis along the body's shortest dimension | `cpattern {seeds:[id], axis:{kind:'axis',axis}, count, angle, equal}` |

The pattern repeats the feature selected in the tree, else the last feature that is not a sketch or pattern.

## Edge and face references

The viewport selects edges by the kernel's name `faceA|faceB#n`. An edge reference in a feature is `{faces:[faceA,faceB], at:[x,y,z]}`
(the two faces it separates and the edge midpoint), built from the body's edge list (`Controller.bodyEdges()`). Face lists are the
plain face names (`F2.C1`).

## Hole flow

- Face selected: the command opens a new sketch on that face with the Point tool active and a hint. Place the hole
  centres, then Confirm sketch: the hole is added from that sketch and the Editor opens on it. Cancel adds nothing. If the
  confirmed sketch has no point, a hint is shown and no hole is made.
- No face selected, but a point sketch exists (the one selected in the tree, else the last): the hole is added from it at once.
- Direction: the kernel drills away from the sketch plane's normal when `flip` is absent for a sketch on a face (the face
  normal points out of the body, so the hole goes in). For a sketch on a plane that the body lies on the normal side of
  (for example the front plane with the body on +z) the hole needs `flip:true`. The command decides with
  `Controller.extrudeFlip(sketch, 'cut')` (the same rule as a default extruded cut) and this is tested on top face, bottom face
  and front plane.

## Editor fields filled from the selection

`edges`, `faces` (and the read-only display of `seeds`) are list fields in the Editor. Each has a "Use selection" button:
it fills the field from the current viewport selection at once (edge mode gives edge references, face mode gives face
names) and keeps following the selection until "Done". Reference fields for a single value (`sketch`, `axis`, `path`,
`neutral`) keep their previous single Pick behaviour. `pickValue` in `featureCommands.ts` does the conversion.

## Not supported / limits

- Revolve needs a construction line; with none, the hint "Draw a construction line for the axis" is shown and nothing is
  created. The axis is the first construction line only.
- Chamfer creates only the equal-distance type (angle/distance and distance/distance can be set only by editing the
  JSON; the Editor shows `distance` and `angle`).
- Circular pattern turns about a world axis through the origin, not through the body centre or the seed's own axis; the
  Editor cannot yet edit the `dir`/`axis` objects (they are not primitive fields). Move the part or edit the JSON for a
  different axis. A seed that falls outside the body after rotation produces no change but no error.
- Linear pattern is one direction, no second direction, no spacing-by-extent.
- Shell grows inward; `outward` can be set in the Editor.
- The `seeds` field is a text list of feature ids (comma separated); it is not filled from the selection (features are not
  picked in the viewport).
- Hole is the simple kind only; counterbore/countersink fields (`cboreDiameter` ...) are not in the Editor yet.
- Selected tree rows influence only the revolve, hole (point sketch) and pattern commands.

# More creators (Features and Surfaces ribbon tabs)

Code: `apps/cad/src/featureCreators.ts` (pure rules and edits, table `CREATORS`; registered next to the commands above
in `commands.ts`). Tests: `featureCreators.kernel.test.ts` (kernel-backed, on a 40 x 25 x 10 box or a bare surface part).
Each command creates its feature as one edit and opens the Editor on it, exactly like the first seven. When the kernel
rejects the first preview the edit is not applied and the structured error is shown (for example `draftParallelFace`).
Reference fields that hold one geometry object (`neutral`, `plane`) are shown as text (`std front`, `face F2.C1`) and are
changed with Pick (a picked face becomes `{kind:'face', id}`); the dropdown for `mode` lists the modes of that feature only.

| Command (key) | Tab / group | Enabled when | Defaults | Kernel feature | Status |
|---|---|---|---|---|---|
| Plane `add-plane` (Shift+N) | Features / Reference | a document | no face: offset 10 from the front plane; one face: offset 10 from it; two faces: `mode:'mid'` between them | `plane {mode, base, base2, offset}` | done; `angle`, `parallel`, three-point modes and the axis / point refs only by editing numbers (object refs `base`, `axis` are not editable) |
| Axis `add-axis` (Shift+A) | Features / Reference | a document | no face: front and top planes meet; one face: its cylinder axis; two faces: where their planes meet | `axis {refs:[{kind,id}]}` | done; one flat face gives `faceNotCylindrical` (nothing is added); `refs` is not shown in the Editor |
| Draft `add-draft` (Shift+T) | Features / Modify | body and at least one picked face | angle 3, neutral = the plane of the first sketch (the base of the first boss), faces = the picked faces | `draft {neutral, faces, angle, flip}` | done; a face parallel to the neutral plane gives `draftParallelFace` |
| Rib `add-rib` | Features / Modify | body and an OPEN sketch (the one selected in the tree, else the last open one) | thickness = 10% of the smallest body size (nice) | `rib {sketch, thickness, flip}` | done; the line must reach the body, else `ribNoContact` |
| Lip / groove `add-lip` | Features / Modify | body and a picked face that has edges | `kind:'lip'`, width = height = 5% of the smallest size, edges = every edge of the picked faces | `lip {kind, faces, edges, width, height}` | done; `kind` can be switched to `groove` |
| Mirror `add-mirror` (Shift+M) | Features / Modify | body and a feature to repeat (as for patterns) | the selected / last feature about the right plane; one picked face: about that face; `body:false` | `mirror {seeds, plane, body}` | done; `body:true` mirrors the whole body (set in the Editor) |
| Helix `add-helix` | Features / Curves | a sketch with a circle (selected, else last) | `pitchRevs`, pitch = 10% of the smallest size, 5 revolutions | `helix {sketch, definedBy, pitch, revolutions, height}` | done (a curve: no body change; use it as a sweep path) |
| Pipe cut `add-pipe-cut` | Features / Modify | body and picked edges (edge mode) or picked faces (face mode) | radius = 10% of the smallest size | `pipeCut {radius, edges, faces}` | done; the solid becomes a SURFACE body (kernel behaviour) |
| Delete body `add-delete-body` | Features / Bodies | body and a picked face | `mode:'delete'`, one `{face}` entry per picked face (the body holding it) | `deleteBody {mode, bodies}` | done; `mode:'keep'` in the Editor; surface bodies by `{surface:id}` are editor only |
| Planar surface `add-surface-planar` | Surfaces / Create | a closed sketch (selected, else last) | none | `surfacePlanar {sketch}` | done |
| Extruded surface `add-surface-extrude` | Surfaces / Create | a sketch with curves | blind, depth 10 | `surfaceExtrude {sketch, end, depth}` | done |
| Revolved surface `add-surface-revolve` | Surfaces / Create | a closed sketch with a construction line | 360 degrees about the first construction line | `surfaceRevolve {sketch, axis, end, angle}` | done |
| Trim surface `add-trim-surface` | Surfaces / Edit | a surface feature and a tool | tool = picked face's plane, else another surface, else the last plane feature; keeps the side unflipped | `trimSurface {surface, plane or toolSurface, mutual, flip}` | done (preview can be slow on big surfaces) |
| Knit `add-knit` | Surfaces / Edit | any surface feature | the surface selected in the tree, else all surface features; `solid:false` | `knit {surfaces, solid}` | done; surfaces that do not close give `knitNotClosed` when `solid` is turned on |
| Thicken `add-thicken` | Surfaces / Edit | any surface feature | surface = selected, else last; thickness 10% of the body (1 without a body) | `thicken {surface, thickness, side, op}` | done; `side` front / back / both in the Editor |
| Delete face `add-delete-face` | Surfaces / Edit | body and a picked face | `mode:'delete'` | `deleteFace {faces, mode, edges}` | done; `heal` / `fill` modes are kernel TODO |

The surface tools use the id of a surface feature as its name (the surface is registered under the feature id). Surface
bodies are not drawn in the viewport yet (`Session.bodyForView` returns only the solid), so a surface made with these
commands shows in the tree and Editor but not on screen, and its faces and edges cannot be picked.

## Editor only / not offered

| Feature | Why there is no command |
|---|---|
| `moveFace`, `dome`, `scale`, `fillpattern`, `spattern`, `curvepattern`, `splitLine`, `surfaceOffset`, `cutWithSurface`, `moveBody` | The kernel answers `TODO(rebuild): <type> needs ck-ops` (probed with the shipped wasm). A command would always fail. The builders are one-liners once the kernel lands (field names are in `packages/part-model/src/features.ts`; `spattern` wants a point sketch, `curvepattern` a path sketch, `fillpattern` a planar face). |
| `fill`, `extend` | Need edges of a surface body; surface bodies are not in the viewport, so no edge can be picked. Add the feature by editing the document, or after surface display lands. |
| `plane` modes other than offset / mid | Need axis / point / curve references (objects the Editor cannot pick yet). |
| `deleteBody` on a surface body | Needs a surface to be pickable. |
