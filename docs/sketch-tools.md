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
measured on the copy; `fix` never). Tests: `transform.test.ts`, `transform.kernel.test.ts` (move, rotate 30 and 90 degrees,
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
| 6 | on curve | plus in a square | nearest point of a line, circle or arc; names the entity (`entityId`) |
| 7 | alignment | diamond + dotted guide | horizontal / vertical with another point (the inference lines) |
| 8 | grid | | |

A snap shows its glyph and a name beside the pointer; Alt at a click turns snapping off for it. The **Snaps** popover in the aux
bar switches each kind on or off (kept in `cad.sketchPrefs`), and "Add constraints from snaps" (the old auto-constraints
setting) decides whether a snapped click also writes the constraint (`snap-constraints.ts`): midpoint, alignment as before;
on curve, perpendicular and tangent -> `pointOnLine` / `pointOnCircle`; intersection -> on both; quadrant -> on the circle plus
`horizontal` / `vertical` with the centre. A perpendicular or tangent snap keeps only the point-on-curve part: the direction
of the new segment is not constrained.

On curve is also what lets the edit and constraint tools (patterns, trim, offset, fillet, the constraint tools) pick a
**line by clicking on it**: they read `snap.entityId`, which until now only the midpoint snap set.

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
