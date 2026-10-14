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
| `anchor` (at the sketch origin; a hole: its centre) | orange | moves the shape in the sketch |

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
* The anchor drag moves the shape relative to the sketch origin. The marker stays on the origin after the release.

## Limits

* The sketch is shared: another feature using the same sketch changes with it.
* Through / up-to extrudes get width, length and corners but no depth handle (their box depth is the body extent).
* Revolve: the box is the flat profile rectangle (no angle or axis handle). Slots resize uniformly like other arc profiles,
  not by lengthening only the straight part. Angle constraints are not recomputed under non-uniform scaling.
* The box is drawn in the sketch frame, so it is the profile's bounding rectangle: for a rotated profile it is not tight.
* The front half of the box is not depth-tested (it is drawn over the part, like all handles).

## Tests

`sizeBox.test.ts` (numbers, sketch edits, selection, layout, session), `sizeBox.kernel.test.ts` (real kernel through the
controller and runner: width / length / depth / corner / anchor / circle / hole / cut / cancel), cube cases in
`packages/viewport/src/handles.test.ts`. Run with `CK_WASM=<repo>/apps/cad/public/kernel/ck_wasm.wasm`.
