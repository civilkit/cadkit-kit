# Contextual handles and the canvas menu

Select something on the canvas and a small handle appears on it. Dragging the handle edits the model live: the part
redraws while you drag (a speculative preview, nothing is written), releasing makes ONE edit, Esc puts everything back.

Built from `packages/viewport/src/handles.ts` (maths), `handleLayer.ts` (drawing and pointer capture),
`apps/cad/src/handles/` (what each selection offers and the ops each drag stands for) and `apps/cad/src/useHandles.tsx`
(wiring). The `handles` workspace setting (Settings > Layout, default on) switches them all off.

**Update:** selecting a shape feature (extrude, cut, revolve, hole) now shows the size box instead of the single depth /
diameter handle; see `docs/size-box.md`. The fillet / chamfer dot remains for edge and corner picks.

## Gestures

| Select | Handle | While dragging | On release | Editor tab |
|---|---|---|---|---|
| An edge (Edge mode, Q/E/V pick modes) | Yellow dot beside the edge midpoint, on the outward bisector of its two faces | out = new `fillet` (radius = drag), in = new `chamfer` (equal, distance = drag) | one `add` of `fillet` or `chamfer` with `edges` refs built like `filletOps` | opens on the new feature |
| Several edges | Dot on the last selected edge | the same, all edges in one feature | one feature | opens |
| A corner (Corner mode) | Dot at the corner on the mean bisector of the edges that end there | same; every edge that ends at the corner is rounded (`edgeRefs` expands it) | one feature | opens |
| An edge or face next to a fillet / chamfer face (name `<id>.…` of that feature) | Dot on the blend face | `set radius` (fillet) or `set distance` (chamfer) | one `set` | stays closed (in-place edit) |
| End cap `Fn.C1` of a blind `extrude` (planar) | Arrow along the face normal | `set depth`; a cut deepens when the cap moves INTO the part; dragged past the sketch plane it becomes `depth = \|q\|` plus `flip` toggled | one or two `set`s in one edit | stays closed |
| Inner (cavity) wall of a `shell` (a `~` face that is not on the part's outer box) | Arrow along the wall normal | `set thickness` (the wall grows when the cavity wall moves into the cavity) | one `set` | stays closed |
| Wall `Hn.S.h1` of a plain (`simple`) `hole` | Dot on the wall, sliding into the material | `set diameter` = start + 2 x drag (a plain `diameter` wins over `size` in the kernel) | one `set` | stays closed |
| Thread editor open, on the thread being edited | Dot on the axis at the far end of the thread (`start + dir * length`) | `set length` of the editor's whole draft, held between one pitch and the face length, "full" at the face | nothing is committed: the value goes into the editor's draft | the editor stays open |
| Whole body (Alt+click, or the Select body command, key `B`) | Placement gizmo: 3 axis arrows, 3 plane squares, 3 rotation rings, a centre dot | would create / update ONE `moveBody` (translate / rotate, copy with a modifier) | **off in the app: the kernel has no `moveBody`** (see gaps) | n/a |
| Any other face | none | none (the kernel has no `moveFace`) | | |

Dragging back to (almost) zero shows the original part; releasing at zero makes no edit (the minimum size is 0.01).

## Keys while a handle is dragged

| Key | Effect |
|---|---|
| Shift | fine: a tenth of the pointer movement |
| Ctrl / Cmd | snap the value to whole millimetres (15 degrees for rings) |
| digits, `.`, `-`, Backspace | type the value: it replaces the drag and shows in the readout. It is the quantity itself (radius, depth, thickness, diameter, degrees). For the edge dot a typed minus is a chamfer, a plus a fillet (Plasticity's convention) |
| Enter | commit now (with the typed value if any) |
| Esc | cancel: the part goes back, no edit is made |

A click on a handle without moving does nothing. The handle follows the pointer along its line (or plane, or circle), and a
live readout next to it shows the number ("Fillet 3 mm", "Depth 42 mm", "Thickness 2.5 mm").

## Selection rules

* Face, Edge and Corner pick modes are as before. **Body** selection: Alt+click on the part (any pick mode), or the
  Select body command (key `B`). A click on empty space still deselects. Selecting the body highlights all its faces.
* Handles never take clicks away from selection: a press that does not start on a handle goes to the orbit controls and the
  selection code as usual (the handle listener runs first only when the pointer is on a handle).
* Hidden while sketching, while the Editor tab is open on any feature (its own preview would fight the handle's), except the Thread editor's length handle, which previews the editor's whole draft, when the
  setting is off, and when nothing selected has a gesture.
* The handle keeps its screen size in the parallel (narrow field of view) camera: the scale is computed from the real field
  of view and distance, so `fixSpriteScale`'s correction is not needed for them.

## Right-click menu

Right-click (without dragging, which pans) on the canvas selects what is under the pointer if it is not selected, then lists
the registry commands that fit the selection, with their shortcuts and enabled state, and a line naming the drag gesture the
selection offers. Arrow keys move over the enabled rows, Enter or a click runs one, Esc or a click outside closes.

| Selection | Rows |
|---|---|
| edge, corner | Fillet, Chamfer |
| face | Sketch on face, Hole, Shell, Linear pattern, Circular pattern |
| body | Select body, Move body (disabled: "The kernel cannot move bodies yet"), patterns, Shell |
| nothing | New sketch (front, top, right), Extrude, Extruded cut, Select body, Fit |

Not done: the menu on feature-tree rows (the tree lives in `packages/ui` and has its own row model).

## Kernel gaps found

* `moveBody` and `moveFace` are known feature types but unimplemented: a preview of either answers
  `TODO(rebuild): moveBody needs ck-ops` (checked with the wasm kernel; `crates/ck-model/src/regen.rs` lists them in
  `KNOWN_TYPES`, `EMPTY_FEATURE_ERRORS`; the inventory marks both "not yet"). So there is no body gizmo and no face-move arrow.
  The gizmo is built and tested against the `Placement` interface in `handles/placement.ts` with a fake; the field names of
  the `moveBody` feature there are provisional. To turn it on, implement a `Placement` over the real feature and pass it as
  `placement` in `useHandles.tsx`.
* `insertPart` placement and `mate` exist as types but were not looked at for placement: they place another part, not move
  this body.
* Right-drag copy (IronCAD) is in the `Placement` contract (`copy`) but nothing sets it yet.

## Limits

* Shell: only the inner wall gets the arrow, because the outer wall does not move when the thickness changes. Faces are
  matched by the `~` in their name and the last `shell` feature, so with two shells the arrow edits the later one.
* Extrude: only the far cap `Fn.C1` of a blind end condition with a numeric depth. `through`, `mid`, `upTo...` and
  expression depths get no arrow. Mirrored / both-sides extrudes were not checked.
* Hole: simple holes only; counterbore and countersink sizes come from the ISO table, there is nothing to drag.
* The fillet / chamfer drag maps the distance along the edge bisector to the size 1:1; for a 90 degree edge the surface
  distance is about 1.4 times that.
* Previews run on the kernel's speculative regen, so a large model makes the drag step coarser (one preview in flight, the
  latest drag position waits).
