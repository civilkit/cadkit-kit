# The size box

Selecting a SHAPE (an `extrude` / cut / `revolve` / `hole` feature together with its sketch) shows its size box at once:
a wireframe box of the profile and depth, a drag handle on every face centre, a handle on each corner of the cap, an
anchor marker and floating number labels. It follows the IronCAD idea; nothing is copied.

Code: `apps/cad/src/handles/sizeBox.ts` (pure: numbers, ops, specs, session), `packages/viewport/src/handleLayer.ts`
(drawing, labels, hover readout), `apps/cad/src/useHandles.tsx` (wiring and the "Resize about" menu),
`apps/cad/src/shapeSelect.ts` (`selectShapeFeature`).

## What selects a shape

* A shape row in the history tree (single click) with nothing picked in the viewport.
* A face of the shape picked in the viewport (names `F2.C1`, `H1.S.h1`, ...): all picked faces must belong to one shape.
* `selectShapeFeature(id)` from `apps/cad/src/shapeSelect.ts`: closes an open editor, clears the picks, selects the row.
  The catalog drop calls it after the feature exists (returns false when no app is mounted).
* Confirming a shape's editor selects the row, so the box shows right after creating or editing.

Not a shape selection: an edge or corner pick (these keep the yellow fillet / chamfer dot, now ONLY there), the whole body
(Alt+click), faces of other features (fillet / chamfer / shell faces keep their own handles), anything while sketching or
with an editor open. The `handles` workspace setting still switches everything off.

## Handles

| Handle | Colour | Edits |
|---|---|---|
| `u1`, `u0` (face centres along sketch x) | red | width: scale the profile |
| `v1`, `v0` (along sketch y) | green | length |
| `df` (far cap; blind extrude / hole) or `d1`, `d0` (mid-plane extrude) | blue | feature `depth` |
| `c++`, `c+-`, `c-+`, `c--` (corners of the cap) | grey | width and length together |
| `move` (the pad: a flat four-arrow cross at the centre of the footprint, on the sketch plane) | magenta | moves the shape in its sketch plane |
| `anchor` (small diamond on the pad: the profile's reference point, a hole's centre) | orange | the same move; the point Anchor mode resizes about |

The quantity of a face handle is the new dimension, so a typed value and a drag are the same operation. Dragging a face
outward grows the dimension in both directions (each of the two faces has its own handle).

* Shift snaps to a round step (1 mm under 20, 5 mm under 100, else 10); Ctrl / Cmd snaps too. Digits while dragging type the value.
* Hovering a handle shows its dimension; the three floating labels (width, length, height) show the numbers always and
  clicking one turns it into an input: Enter commits that exact value, Esc leaves it.
* Release is ONE edit (one undo step); Esc cancels and the part goes back.

## Resize about (menu bottom left, remembered in the browser)

| Mode | A width / length drag |
|---|---|
| Anchor | scales the profile about the anchor (sketch origin) |
| Symmetric | both faces move equally about the centre |
| Opposite face (default) | the opposite face stays |

The depth handle always grows from the sketch plane (a mid-plane extrude stays symmetric); the mode applies to width and
length. A circle, any profile with arcs or ellipses, and a hole scale uniformly (the other direction follows by the same
factor); a polygon scales per direction. The face handle tracks the pointer in every mode.

## What an edit writes

* Extrude / cut / revolve: ONE `replace` of the sketch (its points mapped from the old box to the new, circle radii scaled)
  plus a `set depth` when the height changed. Sketch dimension constraints (`distance`, `hdist`, `vdist`, `pldist`, `radius`,
  `diameter`, `fix`) take their new values so the sketch stays consistent when next solved; a geometric constraint the new
  coordinates break (coincident, horizontal, vertical, equal, parallel, perpendicular, midpoint) is removed and a notice
  names it. A fixed point that would have to move refuses the edit (nothing is shown): use Anchor mode or the other face.
* Which entities: the shapes the feature uses (`regions`), else every closed outline of the sketch.
* Hole: `set diameter` (plain `simple` holes only; cbore / countersink holes show the box and anchor, no width or length handles),
  `set depth` for blind holes, and the hole point of its sketch moves for the anchor or an off-centre resize.
* The anchor is the profile's own reference point (its footprint centre), not the sketch origin, so it follows the shape after a move.

## Moving a shape

Four ways, all the same edit: drag the **move pad**; press-drag **the shape itself** (its cut region, walls or boss top; a movement of
under 4 px is still a click and selects; orbit with the right or middle button is unchanged); type the offset (**Tab** or double-click the
pad: "X offset", "Y offset" from where the shape is now along the sketch axes, numbers or expressions, and "Distance from edge": pick
the left / right / bottom / top edge of the face it sits on and type the clear distance); or **arrow keys** (canvas focus, no field
focused): nudge by the grid step, 1 mm (5 above 100 mm parts, 10 above a metre), Shift 10x, Alt 0.1x, along the sketch's x and y axes;
a burst of presses is one edit, Esc drops it.

* The move translates the profile IN ITS SKETCH PLANE by editing the sketch: every outline point, the points of construction geometry
  (a revolve axis) and the dimension constraints that follow (a pinned point moves too and its `fix` value follows). Constraints that the move
  breaks are removed and named. A hole moves its hole point. Live preview through the normal preview path, ONE undo step per drag.
  Only the whole profile moves; there is no single-point move here (use the sketch editor).
* Modifiers: **Shift** one axis (the larger), **Ctrl** snap to the grid step, **Alt** no snapping (they can be pressed or released mid-drag).
* Snapping is the Catalog's (`catalog/geometry.ts`: `snapTo`, `circleCentre`): the shape's centre catches corners, hole-rim centres,
  edge midpoints, the face centre and the centres of other shapes on the same plane, within 14 px, with a chip in the readout
  ("Move dx 10, dy 2 mm - face centre"). Candidates are the body's edges lying IN the sketch plane; the shape's own outline is skipped.
  When no point catches, each axis aligns the shape's centre or a side with a candidate coordinate or an edge of the host face, with a
  dotted magenta inference line.
* While dragging the original footprint stays as a grey ghost and the readout shows (dx, dy). Esc cancels.
* A sketch used by several features asks on release: **Move all** (everything that uses it moves) or **Duplicate sketch** (a copy
  of the moved sketch is inserted before this shape and only this shape reads it).
* Handles that would crowd a small shape hide until the view is zoomed in: face handles below 90 px, corner handles below
  100 px, the depth handle below 50 px; the number labels stay (click to type). The move ball (F10) still does 3D moves.
* Code: `handles/move.ts` (snap candidates, `resolveMove`, edge distance), `handles/MoveFields.tsx` (typed fields), `useHandles.tsx`
  (keys, dialogs), `translateSketch` / `moveCommit` in `sizeBox.ts`, the pad and the shape-surface drag in `packages/viewport/src/handleLayer.ts`.

## Limits

* A sketch shared by several features is moved only after the Move all / Duplicate sketch question; a resize still changes every user.
* Through / up-to extrudes get width, length and corners but no depth handle (their box depth is the body extent).
* Revolve: the box is the flat profile rectangle (no angle or axis handle). Slots resize uniformly like other arc profiles,
  not by lengthening only the straight part. Angle constraints are not recomputed under non-uniform scaling.
* The box is drawn in the sketch frame, so it is the profile's bounding rectangle: for a rotated profile it is not tight.
* The front half of the box is not depth-tested (it is drawn over the part, like all handles).

## Tests

`sizeBox.test.ts` (numbers, sketch edits, selection, layout, session), `sizeBox.kernel.test.ts` (real kernel through the
controller and runner: width / length / depth / corner / anchor / circle / hole / cut / cancel), cube cases in
`packages/viewport/src/handles.test.ts`. Run with `CK_WASM=<repo>/apps/cad/public/kernel/ck_wasm.wasm`.
