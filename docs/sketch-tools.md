# Sketch editor: definition, transforms, snaps, selection

What the sketch editor does beyond drawing tools. Pure logic is in `packages/sketch`, the screen is in `apps/cad`
(`SketchAuxBar.tsx`, `main.tsx`) and `packages/viewport`. Tool conventions are in `packages/sketch/src/tools/README.md`.

## How defined is the sketch

The kernel's solver status (`dof`, `state`, `conflicts`, `redundant`, `solved`) is shown in the **aux bar** under the sketch
banner as a chip: blue "N degrees of freedom" (under defined), dark "Fully defined", red "Over-constrained". The same
three colours are used on the geometry (`define.ts`, `definitionMap`):

| colour | meaning |
|---|---|
| blue | something about the entity can still move or change |
| dark (light on a dark background) | fully defined: nothing can move |
| red | a constraint that names it is in conflict |

At zero degrees of freedom every entity is dark. Otherwise each free point (and each circle radius) is **probed**: the
sketch is solved once more with a pin (`fix` at the present position, `radius` for circles); if the degrees of freedom do not
drop the pin added nothing and the point was already determined (a point fixed in one direction only, such as one on a
circle about a fixed centre, is half determined: the pin still removes a freedom, so it counts as under defined). This is up to 60 kernel round trips, started 350 ms after the sketch stops
changing, dropped when it changes again, and it never touches the sketch itself (`Controller.probeSketch`). Display >
"Colour by definition" turns it off.

Over-constrained sketches list the blamed constraints in the aux bar ("Conflicting: Distance 25 (k8) x") with a delete
button each; the constraint panel marks the same rows red (conflict) or amber (redundant); hovering one lights what it names.

### Fully define

`fullyDefine(draft, solve)` adds constraints until the degrees of freedom are 0, never more than the solver accepts:

1. **Relations as drawn**: horizontal / vertical for lines within one degree of an axis, parallel / perpendicular within one
   degree, equal length / equal radius, unless already stated (two axis-aligned lines get no parallel on top). All at once;
   what the solver blames (conflict or redundant) is dropped and it re-solves.
2. **Dimensions**, one at a time and in this order: radii, line lengths, angles at shared corners, then positions from the origin
   (`hdist` + `vdist`, or `coincident` when at the origin, or `fix` when the sketch has no origin point). Each is
   taken from the present geometry (rounded to 1e-4), kept only if it lowers the degrees of freedom, else counted as refused.

It does nothing when the sketch is already fully defined or has conflicts (it says so). The whole result is one undo step,
and the message says how many relations and dimensions were added, and how many degrees of freedom remain when no
dimension could remove them (for example a spline). Tests: `define.kernel.test.ts`.

## Equation curve

The **Equation curve** tool (Draw palette, with the splines) adds a spline from formulas `x(t)`, `y(t)`: a click places a wave starting
there and the panel (presets, x(t), y(t), t from / to, tolerance) edits it. Each change is checked with the kernel's `equationCurve`
query (`Controller.fetchEquationCurve`, with the document's variables) and goes into the sketch only when it fits, so the panel shows
the point count, warnings or the refusal in plain words while the sketch keeps its last good curve. The entity carries only the
formulas (`spline {pts: [], equation}`); the kernel writes the points as fixed points `<id>_start`, `<id>_p<n>`, `<id>_end`, which
`foldSolution` takes from the solved sketch. Deleting the curve deletes them. Code: `packages/sketch/src/equation.ts`,
`tools/equation.ts`, `apps/cad/src/EquationPanel.tsx`. Guide: `guide/src/sketching/equation-curves.md`; kernel: `docs/equation-curve.md`.

## Text

The **Text** tool (Draw palette, key `Q`) places a lettering entity; its panel (string, cap height, font, 3 x 3 anchor grid, angle,
spacing, mirror, on an arc with radius, direction, centre and side) edits it with a live preview. Code: `packages/sketch/src/text.ts`
(request, cache, editing, notes), `tools/text.ts` (the tool), `apps/cad/src/TextPanel.tsx`; the outlines come from the kernel
(`textOutline`, `Controller.fetchTextOutline`) and are cached by the entity's fields. Guide: `docs/text.md`.

## Reference (driven) dimensions

A reference dimension measures but does not constrain. The kernel has none, so they live in the sketch feature as
`refDims: [{ id, type, refs, s1?, s2? }]` (the kernel carries unknown sketch fields; `refdims.kernel.test.ts` proves it)
and are measured from the solved geometry each time they are drawn, shown in italic brackets: `(20)`.

* **Automatic**: a dimension added by a tool that the solver then reports redundant or conflicting is turned into a reference
  dimension, with a notice, instead of over-constraining the sketch.
* **By hand**: the arrows button on a dimension row in the constraint panel, right-click on a dimension label (to
  reference or back to driving), double-click on a reference label (to driving at its present value).
* Double-click a driving label to edit its value (unchanged). Reference dimensions are deleted from the panel like any row.

## Move, Copy, Rotate, Scale

Four tools in the Edit group (`tools/transform.ts`). Select first (Select mode: click, Ctrl/Shift click, or a box) and choose
the tool, or choose the tool and click entities then press Enter. Then click the **base point** (the centre for Rotate),
then move the pointer and click, or type the values:

* Move: `dx`, `dy` (a pointer move within about one degree of an axis snaps to it with auto-constraints on).
* Copy: `dx`, `dy`, `copies` (default 1, at most 99), copy k sits at k times the displacement.
* Rotate: `a` in degrees, counter-clockwise positive, and `copies` (0 turns the originals).
* Scale: `f`, the factor (the pointer's distance from the base against its distance at the first move), and `copies`
  (0 scales the originals; copy k is scaled by `f` to the k).

In place, dimensions that mention what changed are **re-measured** (a moved line is still "this long", an angle dimension
keeps its sign convention), a `fix` follows its point, horizontal / vertical on lines turned off the axes are replaced by parallel (between the turned
horizontals, between the turned verticals) and one perpendicular, so a rectangle stays a rectangle with one freedom left (its turn); a quarter
turn swaps them. Relations to geometry that did not move are kept, so the solver can pull the shape back; when
it refuses, the usual solver hint appears and Ctrl+Z restores the sketch. A fixed point cannot be moved (the tool says so).
Copies get fresh points and entities, and the constraints that live entirely inside the copied set (dimensions
measured on the copy; `fix` never). Constraints tied to the axes (horizontal, vertical, hdist, vdist) are copied only when they still hold: always for
Move / Copy / Scale, and for Rotate only when the copy is a whole number of quarter turns from the original (swapped to the other axis on an odd number),
so a rotated pattern is the original geometry turned by k times the angle and nothing pins it to the axes. Tests: `transform.test.ts`, `transform.kernel.test.ts` (move, rotate 30 and 90 degrees,
scale, two copies, then Fully define on a copy).

## Selection

* Select mode: left drag on empty space is a **box**: left to right = *window* (solid blue, only what is entirely inside),
  right to left = *crossing* (dashed green, inside or touching). Shift or Ctrl adds to the selection; Ctrl+A selects all;
  Delete removes the selection; Escape clears it. The aux bar shows "N selected".
* In a sketch the **right** mouse button now turns the view and the middle one pans (they already did while a tool was
  active); the left button picks and rubber-bands (a finger on a touch screen still turns the view, so no box there).
* Click on a line, circle or arc with an edit or constraint tool: see "on curve" below. `boxSelect` is in `select.ts`.

## Snaps

`snapAt` (`snap.ts`) returns the first kind that has a candidate within the pick radius; within a kind the nearest.

| order | kind | glyph | notes |
|---|---|---|---|
| 1 | endpoint / centre / origin (existing point) | square / ringed dot | `role` says which; the point is reused |
| 2 | intersection of two curves | cross | line, circle, arc in any pair |
| 3 | quadrant of a circle or arc | diamond with bar | 0, 90, 180, 270 degrees; on an arc only inside the sweep |
| 4 | midpoint of a line | triangle | |
| 5 | perpendicular foot / tangent point | right angle / circle on a line | from the start of the shape being drawn (the line tool's chain end); foot only on the span |
| 6 | on curve | hourglass | nearest point of a line, circle or arc; names the entity (`entityId`) |
| 7 | alignment | diamond + dotted guide | horizontal / vertical with another point (the inference lines) |
| 8 | grid | small plus | the point lands on a displayed minor grid crossing when the pointer is within about 4 px of it (`gridCapture`: a third of the pick radius, at most a quarter of the step); between crossings the pointer is free |

A snap shows its glyph and a name beside the pointer; Alt or Ctrl turns snapping off for that move or click (Alt on the Rectangle tool also makes a square). Dragging a rectangle, circle, line or slot is free between grid crossings: the W / H (radius, length) boxes show the live value, and typing in one fixes only that one. The **Snaps** popover in the aux
bar switches each kind on or off (kept in `cad.sketchPrefs`), and "Add constraints from snaps" (the old auto-constraints
setting) decides whether a snapped click also writes the constraint (`snap-constraints.ts`): midpoint, alignment as before;
on curve, perpendicular and tangent -> `pointOnLine` / `pointOnCircle`; intersection -> on both; quadrant -> on the circle plus
`horizontal` / `vertical` with the centre. A perpendicular or tangent snap keeps only the point-on-curve part: the direction
of the new segment is not constrained.

On curve is also what lets the edit and constraint tools (patterns, trim, offset, fillet, the constraint tools) pick a
**line by clicking on it**: they read `snap.entityId`, which until now only the midpoint snap set.

## Snaps and status bar

**Glyphs** (`packages/viewport/src/snapMarks.ts`): `markerStyleFor(hit)` picks the glyph, `markerSegments` draws it. Square = endpoint,
triangle = midpoint, circle = centre, diamond = quadrant, X = intersection, right-angle mark = perpendicular, circle on a line =
tangent, hourglass = on curve, small plus = grid point, diamond (with the dotted guide) = alignment. The model snaps use the same
glyphs (endpoint, midpoint, centre, extent as a diamond) in cyan; the sketch's own are orange. The glyph is about 11 px across at
every zoom (half size `MARKER_HALF_PX` times plane units per pixel), and the shade changes with the viewport background (darker on
light, brighter on dark). The text tag beside the pointer stays.

**Cursor label** (`CursorLabel` in `sketchReadout.tsx`; text and placement in `cursorLabel()`, `sketchStatus.ts`): the same coordinates as the status bar, in a small box 14 px down and right of the pointer
(flipped at the right and bottom edges), drawn in `#vp-layer`. The viewport reports the pointer's position in `onPlaneCursor` (`x`, `y`, `w`, `h`, `touch`); a finger (`touch`) and the phone layout show
nothing, and the setting `SketchPrefs.cursorLabel` (default on) turns it off. It shows the snapped point when a snap is active. The status bar fields stay.

**Status bar** while a sketch is open (`SketchReadout`, `sketchReadout.tsx`; text in `sketchStatus.ts`). The slots never move: left to right
**Snap**, **Grid**, **Zoom**, **Spacing**, then three fixed-width text boxes that are blank when there is nothing to show (`data-testid`
`status-snap`, `status-grid`, `status-zoom`, `status-spacing`, `status-coords`, `status-delta`, `status-snapname`; the inputs have `aria-label`s):

* **Snap** switches all point snapping (every kind and the model snaps) and **Grid** switches grid snapping and the grid lines;
  both are in `cad.sketchPrefs` (`snapOn`, `gridSnap`) beside the Snaps popover;
* **Zoom** (percent of real size at 96 dpi) and **Spacing** (grid) are inputs, always shown, also with the pointer off the canvas
  (`onSketchZoom`): type `50`, or `2.5` / `0.25 in` / `0` for automatic, Enter commits, Escape cancels. The fields keep their keys:
  Enter, digits and letters typed there never reach the sketch shortcuts (Enter would confirm the sketch, 7 would switch the view);
* the pointer on the sketch plane in the display unit, for example `232.1 mm, -5.1 mm`, with one more decimal per tenfold zoom; with a
  snap it is the snapped position; any tool (also Select) feeds it, once per animation frame;
* while drawing, the delta from the last point: `dx 12.0  dy 3.5  len 12.5  angle 16°`;
* the active snap: `Snap: midpoint`.

**View in a sketch.** A new sketch squares the view up to its plane (`Auto look normal for new sketches`, default on); re-entering an
existing sketch keeps the camera (`Keep the view`, default on) and offers `Look normal (N)` when it is angled; with Keep view off every
entry squares up. Fit (button or Z) frames the sketch's own geometry (an empty sketch: 100 mm around the plane origin). The wheel and
a trackpad pinch zoom about the point of the plane under the pointer (`zoomAbout` in `navButtons.ts`).

**Typed entry (Line tool).** Before the first click Tab shows X and Y: type, Tab or Enter to lock each; with both locked the first point
is placed exactly there (on an existing point at those coordinates, so a profile can start at 0, 0). While a chain runs, type a length and
an angle (Tab locks each). A typed segment that ends exactly on the chain's first point (from the third segment on) closes the loop on
that point, like a click on it, and ends the chain; Escape clears typed values, then ends the chain. The hint line says what to do next
for the Line tool and both splines (double-click the last point or Enter finishes, the first point closes, Escape cancels).

**Dimension graphics** (`annotations.ts`, pure, sketch coordinates; drawn by `SketchAnnotations` as SVG under the labels, projected by
`dimGraphics.ts`): a length has extension lines, a dimension line 26 px off the geometry with arrowheads and the label centred on it (text
along the line, kept upright); horizontal / vertical distances run on their axis; an angle between two lines is an arc inside the corner with
the degrees beside it; a radius or diameter is a leader through the circle. Driving dimensions are pale violet (tokens `--dim-line`, `--dim-chip-bg`, `--dim-chip-text`, light and dark), reference ones the
secondary text colour, dashed and in brackets; a conflicting dimension turns the error colour. Labels are `1 500 mm`, `R12 mm`, `Ø8 mm`, `110°` (at most two decimals, space as thousands
separator); labels that would overlap are pushed apart on screen (`nudgeLabels`). The value is drawn as a **chip**: a dark rounded pill with the text in a monospace face (`Ø80.00 mm`, `40.00 mm`, `90.0°`). The chip stays the hit target:
a click selects it (Delete removes the dimension), double-click edits, right-click opens the menu. In the phone and tablet layouts every chip has a
44 px tap target (an invisible area around the chip; `annotChips.ts` `hitSize`) and the layout measures chips with the same box it draws them with (`labelBox`).

**Constraint glyph chips** (`annotChips.ts`, drawn by `SketchAnnotations`): a geometric constraint is a small rounded square with an icon of its own
(horizontal, vertical, tangent, equal, parallel, perpendicular, concentric, fix, midpoint, symmetric, collinear, point on line / circle, coincident), placed
at the constrained point or entity. The chip is 14 px with a 1 px border and a 10 px glyph, in muted tokens (`--mark-bg`, `--mark-line`, `--mark-text`, light and dark) and semi-transparent until hovered. On a desktop pointer its hit target is 24 px; in the phone and tablet layouts it is 44 px (an invisible area around the chip; `hitSize`). Hover shows the constraint name as a tooltip and highlights what it names; click selects the chip and Delete
(or Backspace) removes the constraint; Escape clears the selection. A chip that would sit on a dimension value or on another chip is moved clear
(`separateMarks`). While a sketch tool is active the glyph chips let the pointer through, so they never take a click meant for the drawing.

**Which chips show.** Settings, Sketching, **Constraint markers** (`constraintMarkers`): **Hovered or selected** (default) shows the chips of the entities under the pointer (kept a third of a second after it leaves, so a chip beside the line can be reached), of the selected entities and of the point under the pointer; **Always** shows every chip; **Off** hides them all. A constraint the solver reports as conflicting or redundant is always shown (red or amber), in every mode, and the chip you hover or select stays. When the horizontal and vertical locks only close a rectangle (four lines in a loop, every side locked to an axis, `rectangleAxisLocks`), their chips show for the hovered or selected side only, in every mode but Off, so a drawn rectangle carries no row of identical chips. The constraints are never hidden from the sketch Report and the constraint list; only their glyphs on the canvas follow the setting.

**Placement of dimensions** (`dimLayout.ts`, pure, in pixels through the view's projection). Longest dimensions first; each tries the dimension line
at 26, 52, 78 and 104 px on one side of its geometry, then on the other, and takes the first place where its label (an oriented rectangle, kept
upright) touches no placed label or arrowhead, no hit zone (4 px) of another segment, nothing outside the view and no control (Display, view cube,
buttons); the extension lines stretch to the chosen level. A segment shorter on screen than its label gets the text outside the extension lines
with arrowheads pointing in and a short leader. With no free place the label is hidden and shows while what it measures is hovered or selected.
**Dimensions** in the Display menu (kept in `cad.sketchPrefs` as `dimDisplay`): All, Driving only (no reference dimensions), Selected only (a
dimension shows when its entity is selected or hovered, or the Dimension tool is active).

**Typed angles are dimensions.** A segment of the Line tool committed with a typed angle also gets a driving `angle` constraint between the new line and
the chain's previous line (`angleSpec`: the interior angle at their shared corner, 0..180; with a relative turn it is 180 minus the turn, left or
right). The angle is drawn as an arc with the degrees (a right angle as a small square corner when "Right angles as a square" is on). Not made:
for a clicked segment; for the first segment of a chain (a typed 0 / 180 or 90 there gets the horizontal / vertical constraint when auto
constraints are on, any other first angle stays a plain direction: there is no line to measure against, and the X axis is not an entity); for the
segment that closes the chain; after an arc; when the angle repeats or contradicts one (the hint line says so). A dimension the solver finds already
given by the others (a closed outline over-determines one corner) is turned into a reference dimension at once, with a notice (`settleDimensions`).
Both settings are in the Display menu next to Dimensions and kept in `cad.sketchPrefs` (`typedAngleDims`, `rightAngleSquare`). On the typed bottle
outline (14 lines, all lengths and angles typed from a typed first point) the sketch goes from 13 degrees of freedom to 2 (the position of the first
point); `typedAngles.kernel.test.ts`. The Dimension tool on two lines of one corner offers their angle at once with its field focused and selected; double-click on an angle
label edits it.

**Escape and fields.** Escape steps back (typed text, the chain, the tool) and never discards a sketch that has geometry; the red X does. Typing
a digit with the Line tool active and no field focused collects the characters and puts them in the first field (replacing its text); every field
selects its text when it gets focus. Snapping to an alignment keeps the other coordinate on the grid.

**Relative angle.** Once a chain has a segment, the ANG box has a `turn` switch (or the T key): the typed angle is then the turn from the previous
segment's direction (left is positive), shown as such; off (the default) it is measured from the x axis. The choice is kept for the session
(`setRelativeAngle` in `line.ts`); switching drops a typed angle that the other mode would misread.

**Open profile card** (Extrude / Cut): closed shapes and open chains are found by joining end points that coincide within `JOIN_TOL`
(`shapes.ts`), so curves that do not share point ids (script-made lens shapes) still form loops.

In model mode the status bar keeps its content (Ready, features, faces, triangles, rebuild time, errors) and adds the coordinates of the
surface point under the pointer (`onHoverPoint`, one ray cast per frame; faces only, so an edge hover shows the face point behind it).

**Grid** (`gridSpacing.ts`): the minor spacing is a 1-2-5 step that keeps neighbouring lines 8 to 80 px apart (about 20 px preferred),
so the grid subdivides and merges as you zoom; every 10th line (every 5th after a 2 or 5 step, and for a user spacing) is stronger,
the axes are red (u) and green (v), and a ring marks the origin. A typed spacing is the base: the displayed step is that spacing
times 1, 2, 5 and powers of ten. Grid snapping uses the displayed minor step.

**Cursors** (`cursorPolicy.ts`, pure, one function `cursorFor({ tool, hover, drag, panHeld, overField, zoomOut, invalid })`):
crosshair in drawing tools, arrow for Select, pointer over a sketch point or a handle, grabbing while dragging, move over plane and pad
handles, resize cursors for size-box handles, a rotate cursor over rings, not-allowed over a fixed point, zoom-in or zoom-out for a zoom
drag, grab while Space or the middle button is held (Space with a drag pans), text over typed fields. The sketch view and the
handle layer apply it; the TriBall keeps its own for now.

## Picking the sketch plane in the view

`S` (`sketch-here`) with no face, plane or tree row selected, and the command `sketch-pick-plane`, call `beginPlanePick` (`main.tsx`): the pick state `planePick` shows the three origin planes through the existing
`setRefPlanes` (`RefPlanes`, `refplanes.ts`: translucent sheets, axes, orange fill and edge plus label for the hovered one) and turns on the viewport's plane-picking mode, `setRefPlanePick(true)`, which draws the
sheets stronger and adds a fallback to the exact ray test: `nearestSheet` takes the sheet whose screen outline is within `PLANE_PICK_TOL` px of the pointer (8 for a mouse, 28 for a finger), so an edge-on sheet can
be hit. The click goes through the usual `onRefPlanePick`, which starts the sketch; a datum plane feature (`onPlaneFeaturePick`) and a flat face (the single selected face, face mode is set) start the sketch on
that. `Esc` and the bar's Cancel end the mode; starting any sketch ends it. The tree and `Sketch on selected face or plane` work as before.

## Sketch Report

`sketchReport(draft, status)` (`reportData.ts`, pure) turns the draft and the solver status (`SketchSolverStatus`: dof, state, conflicts, redundant, problems) into counts: points, lines, arcs, circles, splines, other
curves, construction entities, constraints by kind, driving dimensions (`DIM_TYPES` with a numeric value) and reference ones (`refDimsOf`), closed profiles (`sketchShapes`), open chains (`sketchOpenChains`) and the list of
conflicting and redundant constraints. `reportState` ranks conflict over over-constrained over unsolved. `SketchReport.tsx` draws one body in `SketchReportWindow` (desktop, over `#vp`, not modal) or `SketchReportSheet`
(phone and tablet, the shared `Sheet`). The button is `onReport` in `SketchStatus` (Status group); the command is `sketch-report` in the F search. Clicking an issue selects the entities the constraint names
(`constraintTargets`); a constraint on points only is lit like a hovered row. It re-renders with the sketch, so it follows edits while open, and closes when the sketch ends.

## Display

The **Display** popover: driving dimensions, relation glyphs (H, V, =, tangent ...), reference dimensions, colour by
definition, the constraint panel. Each is remembered. (The 3D view's Display menu is a different thing.)

## What is not here

* **Associative convert / project entities.** The kernel has no associative sketch geometry: its only `ext` is a circle flag
  that frees the radius from the solver (and `from` is the same), and the sketch constraint set has no edge reference. Our Project
  tool stays a snapshot of the model edges at the time (`project.ts`). Associative projection needs a kernel sketch entity that
  refers to a model edge and is re-evaluated at regen.
* **3D sketch** (unchanged).
* The definition colour is per entity: a point half determined counts as under defined (blue); there is no per-axis colour and no
  separate colour for "defined but for its size".
* Constraint glyph toggles are per kind of display (dimensions / relations / reference), not per constraint type.
* Move / Rotate / Scale keep relations to geometry that did not move; there is no "break relations" option yet.

## Model snaps

While a sketch is open the existing body offers places to land on, drawn in a cyan model colour (the sketch's own snaps stay amber) with a tag beside the cursor.
The body's edges are projected into the sketch plane (`packages/sketch/src/modelSnaps.ts`): an edge that crosses the plane contributes the point where it pierces it,
an edge parallel to the plane keeps its projection, an edge seen end-on is one point.

| Tag | What | Snaps menu entry |
| --- | --- | --- |
| model endpoint / model crossing | ends of projected edges, piercing points, crossings of edges with each other and with sketch entities | Model ends and crossings |
| model midpoint | midpoint of a projected line or arc | Model midpoints |
| model centre / model quadrant | centres and quadrant points of projected circles and arcs | Model centres and quadrants |
| mid-extent | dashed guide half way between the two outermost parallel edges of the body (the middle of its thickness or height), the middle of its extent in u and v | Mid-extent and body centre |
| body centre | the centre of the body's extent in the plane (and where the two mid-extent guides meet) | Mid-extent and body centre |
| mid of extrusion | for an Extrude selected or being edited: the plane half its depth along its normal, as a dashed line in a sketch plane that cuts it (a symmetric extrude: the sketch plane itself) | Mid-extent and body centre |

All four entries are on by default and persist with the other snap preferences. Priority: the sketch's own points, crossings, quadrants and midpoints first, then the model points, then the sketch's perpendicular / tangent / on-curve, then the model guide lines, then alignment and grid.

A model snap only positions the point. Hold Shift while clicking to attach it to the model: a fixed reference point is added at that place and the new point is made coincident with it.
The candidate list is built once per sketch session and again when the body, the plane or the picked extrusion changes (not per pointer move), capped at 4000 candidates.

## Choosing regions to extrude

With an Extrude or Revolve editor open on a sketch with two or more closed shapes, click a region of the sketch in the viewport to switch it on or off (the same toggle as the Shapes list); pointing at a region lights its outline.
A click on the ring between an outer and an inner loop is the outer shape, a click inside the inner loop is the inner one. Outer alone is the filled disc, inner alone the inner disc, both the ring (the inner loop is a hole).
Loops that share points are separate shapes too: five petals that all start at the sketch origin are five shapes, and each can be extruded alone. This needs the Extrude or Revolve editor, not the sketch open for drawing: finish the sketch first.
