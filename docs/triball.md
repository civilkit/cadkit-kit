# The move / rotate ball (F10)

A screen-space manipulator that moves, rotates, copies and patterns the current selection. It follows the study in
`ironcad-triball.md` (read from tutorial videos; the frames in `img/ironcad-triball/` are the reference for the look).
Code: pure maths `packages/viewport/src/triball.ts`, drawing and pointer work `triballLayer.ts`, app side
`apps/cad/src/triball/` (`ops.ts` the edits, `rigid.ts` motion composition, `useTriBall.tsx` the wiring,
`FieldsDialog.tsx`, `triballPrefs.ts`). Tests: `triball.test.ts`, `triball/ops.test.ts`, `triball/triball.kernel.test.ts`
(needs `CK_WASM`), `triball/FieldsDialog.test.tsx`.

## Turning it on

F10, the Position button (Select tab and the tool rail), or Move body in the canvas menu for a body. The target is the
current selection:

| Selection | Target | What moves |
|---|---|---|
| Whole body (Alt+click, `B`) | body | `moveBody` (every lump; the original lump only once copies exist) |
| A `moveBody` feature selected in the tree | that feature | edits that feature in place |
| A feature built from a sketch on a standard plane (extrude, cut, hole, ...) selected in the tree | feature | shifts the free points of its sketch in the sketch plane (the part along the sketch normal is ignored) |
| One or more faces | faces | `moveFace`: planar faces translate along their normal, curved faces use offset. Only the face-normal handle is live |
| Edges, corners, nothing | none | F10 is greyed (nothing selected) or says why |

Esc turns it off (and does not clear the selection). While it is on the contextual handles step aside. Selecting something
else re-targets the ball; a click on empty space keeps it. Undo, redo and edits elsewhere re-read the frame from the
selection (the ball is UI state, not saved).

## Look (from the frames)

Thin cyan ring that always faces the camera (95 px radius, constant on screen), red centre dot, three orientation stubs
(X red, Y green, Z blue) ending in cyan dots, three red axis-end dots on the ring each with a plane square 17 px inside it
(the square lies in the plane perpendicular to that axis, so it foreshortens with the view). A selected axis turns yellow
and gains a line through the centre and a minus dot. Hover and drag light the part yellow. Attached = cyan, detached = white.
While dragging: a dashed trail from the start, a white start dot, the readout ("Distance: 12.5", "Distance 1 / 2" for a
plane, "Angle: 30°"), and for a rotation a yellow arc on the ring. The status line uses the IronCAD wording. The selection
outline stays at the start position while the body previews (the ghost).

## Gestures

| Gesture | Result |
|---|---|
| Click an axis end dot | selects the axis (click again or click empty space to deselect) |
| Left-drag an axis end dot | translate along that axis |
| Left-drag a plane square | translate in that plane (two distances) |
| Left-drag the ring | rotate about the view direction; with an axis selected, about that axis |
| Left-drag inside the ring with an axis selected | rotate about that axis |
| Left-drag the centre dot with an axis selected | translate along it |
| Ctrl while dragging | snap to the increments (default 10 mm and 15 degrees; Settings > Positioning, or right-click the ring > Snap Increments) |
| Shift while dragging | a tenth of the movement |
| Digits while dragging, Enter | type the exact distance or angle |
| Esc | cancel the drag (the body returns); a second Esc turns the ball off |
| Space | attach / detach. Detached (white): every drag moves or turns only the ball |
| Right-drag a handle | same drag, then the release menu: Move Here, Copy Here, Link Here (disabled, reason in the tooltip), Create Radial Pattern (rotation) or Create Linear Pattern (axis), Cancel |
| Right-click an axis end dot | Edit Distance (with a Move / Copy choice), Create Linear Pattern |
| Right-click the ring | Edit Angle (about X, Y, Z or the view; Move / Copy), Create Radial Pattern, Snap Increments |
| Right-click an orientation dot | Parallel to Axis (pick a cylinder), Perpendicular To Face (pick a flat face), Parallel To Edge (pick an edge), Reverse, Mirror (Copy) |
| Right-click the centre dot | Edit Position (X, Y, Z), To Point (pick a corner), To Center Point (pick a full circle edge), To Midpoint (pick an edge) |

Repeated Copy dialog: Number of copies (the original stays, so 5 copies are 6 bodies), Distance (linear, prefilled with
the dragged distance), Angle (radial, prefilled), Step up (radial: a lift along the axis per copy). A pattern is one edit
(one undo step) of N `moveBody` copies, each made from the original lump (a chain would copy its own copies).

## Edits and undo

* One gesture is one edit: the preview goes through `Controller.preview` (latest wins, one in flight, like the other
  handles); release, a menu choice, an Edit Distance / Angle OK, a To-command and a pattern each commit once.
* A second plain move of the same bodies folds into the existing `moveBody` (the two motions are composed into one
  rotate-about-origin plus translate) when that feature is the last one, is not a copy and has numeric fields. Otherwise a
  new feature is added. A copy is always a new feature. A repeated face push updates the last `moveFace` the same way.
* Angles follow the kernel: right-handed about the axis, rotation first, then translation (checked against the real
  kernel in `triball.kernel.test.ts` with an asymmetric part and a skewed axis).

## Limits and UNCONFIRMED

* **Link Here** is disabled: the kernel has no instances. How IronCAD defines Link is UNCONFIRMED.
* **Mirror (Move)** is disabled: the kernel `mirror` unites the mirror image with the body. **Mirror (Copy)** works only
  when the handle lies along a world axis and the ball is on that standard plane through the origin; the kernel does not
  mirror about an arbitrary plane (probed with the shipped wasm). The IronCAD plane definition itself is UNCONFIRMED.
* Patterns are chains of copies, not the `lpattern` / `cpattern` features (those take feature seeds and a world axis).
  Copy and pattern act on one lump (the one holding the first face of the original); a part with several original lumps
  would copy only that one. Copy Along Curve / Link Along Curve are not built (UNCONFIRMED in the study too).
* Faces: only the face-normal handle, no rotation, no copy. Several faces move together along the first face's normal
  (planar) or each by the same offset (curved). A `moveFace` the kernel refuses (for example a face that would collapse)
  shows the kernel hint in the status line and changes nothing.
* Features: only sketch-based features on a standard plane (front, top, right). Faces as sketch planes, 3D sketches and
  features without a sketch say so when F10 is pressed. Moving the sketch also moves everything else that uses it, and a
  sketch whose points are pinned by location constraints may be pulled back by the solver.
* Orientation menu: Edit Direction and Point To Point are not built (the study marks Edit Direction UNCONFIRMED). The
  orientation commands re-aim the ball only (they never rotate the object), in both states. Dragging an orientation dot
  does nothing; the menu is the way.
* Free (3-axis) translation and free (trackball) rotation: not built, UNCONFIRMED in the study. An attached ball with no axis
  selected lets a press on the centre pass to the camera.
* Rotation by typing is built as Edit Angle (the study has no frame of it; the dialog layout is ours).
* The default frame is the world axes at the centre of the selection box (a body or a feature's sketch points) or the face
  point; IronCAD's rule is UNCONFIRMED. Ring size is constant on screen.
* Create Attachment Point, Create Multiple, Edit Distance's Apply button: not built (UNCONFIRMED in the study).
* Picks for the menus (corner, edge, face) use the viewport picker in the matching mode; hover highlights as in the normal
  picks (the green highlight of the study is not drawn). A detached ball is not saved with the part.
* The camera is not refitted while the ball is on (it would follow the body being dragged).
* Verified in headless Chrome with synthetic mouse events: look, axis / plane / ring drags with live readouts, Ctrl snap,
  typed value, Esc, Space detach, right-drag menu, Edit Distance, Repeated Copy, orientation and centre menus with picks,
  face and feature targets. Not verified: touch, a real GPU, Windows / Linux context-menu timing (the layer swallows the
  canvas menu on press and release both), high-DPI screens beyond a 1x capture.
