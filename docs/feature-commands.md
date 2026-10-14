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

## Editor options

Extrude / cut, revolve, chamfer, fillet and shell have option forms (`apps/cad/src/FeatureOptions.tsx`, rules in
`optionRules.ts`) that plug into the generic Editor through its `options` prop: they replace the plain fields they own
and the Editor keeps the sketch, axis, edges and faces pickers and the shape list. Every control writes a patch; a null
value removes the field from the feature. Only fields the kernel reads are offered.

| Feature | Controls (wire fields) |
|---|---|
| extrude, cut | End condition `end`: blind, mid, through, throughBoth, upToNext; `depth` (blind, mid); `flip`; draft angle `draft` and `draftOut` (not for mid or throughBoth, the kernel refuses a drafted mid-plane extrude) |
| revolve | `end` blind or mid (symmetric); `angle` (total for mid); `flip`; `axis` (the generic pick; the kernel takes a line of the sketch by id) |
| chamfer | `chamferType`: `equal` (`distance`), `distances` (`distance`, `distance2`), `angle` (`distance`, `angle`) |
| fillet | constant `radius` or `filletType: "variable"` with `radii: [start, end]`; `profile` circular, conic (`rho`), chord, curvature (`shape`, G2) |
| shell | `thickness`, `outward` |

Not offered because the kernel does not read them (checked against `ck-model` and by `optionRules.kernel.test.ts`):

- `upToFace`, `offsetFromFace`, `upToPoint`: parsed, but regeneration answers "TODO(rebuild): extrude up to a reference
  needs ck-ops", and no field names the face or point. The forms already have the face pick (`endFace`, `endOffset`,
  `endPoint` are the planned wire names; the Pick button goes through `pickingPath` / `picked` like the other single
  references); flip `KERNEL_END_REFERENCES` in `optionRules.ts` when the kernel cuts them.
- Second direction (`depth2`, `end2`, `flip2`), thin feature (thickness, wall side), merge result: ignored.
- Chamfer `angleDistance` / `distanceDistance` (the `chamferType` enum names) answer `unsupported`; the kernel's working
  names are `distances` and `angle`. `vertex` needs a corner pick and a `distance3`; `fullRound` fillet needs three faces.
- Shell: one thickness for all walls (no per-face thickness), no `inside` flag.
- Revolve: no second angle; the axis cannot be an edge.

## Not supported / limits

- Revolve needs a construction line; with none, the hint "Draw a construction line for the axis" is shown and nothing is
  created. The axis is the first construction line only.
- Chamfer is created as equal distance; the Editor's chamfer type dropdown changes it (see Editor options).
- Circular pattern turns about a world axis through the origin, not through the body centre or the seed's own axis; the
  Editor cannot yet edit the `dir`/`axis` objects (they are not primitive fields). Move the part or edit the JSON for a
  different axis. A seed that falls outside the body after rotation produces no change but no error.
- Linear pattern is one direction, no second direction, no spacing-by-extent.
- Shell grows inward; `outward` can be set in the Editor.
- The `seeds` field is a text list of feature ids (comma separated); it is not filled from the selection (features are not
  picked in the viewport).
- Hole is the simple kind only; counterbore/countersink fields (`cboreDiameter` ...) are not in the Editor yet.
- Selected tree rows influence only the revolve, hole (point sketch) and pattern commands.
