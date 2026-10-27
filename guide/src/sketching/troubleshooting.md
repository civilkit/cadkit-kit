# When a sketch will not solve

This chapter helps when a sketch misbehaves: it moves when you do not want it to, it refuses a constraint, it says it is over-constrained, or it will not extrude. It explains what under-constrained, over-constrained and conflicting mean, how an open or crossing outline affects extrusion, and where CadKit tells you what is wrong.

## First, read the signs

CadKit shows the state of the sketch in three places. Check them before you change anything.

- **The chip in the Status group** of the **Editing** tab: `N DOF`, **Fully defined** or **Over-constrained**.
- **The colours of the geometry** (with **Colour by definition** on): blue can still move, dark is fully defined, red belongs to a conflicting constraint.
- **The Constraints list**, opened by clicking the chip. Red rows are conflicts, amber rows are redundant. Hover a row to see what it names.

The hint line, in the status bar or under the sketch bar, says why the last action did not work. The table at the end of this page lists the hints.

## Under-constrained: it moves too much

A sketch with degrees of freedom left (`N DOF`, blue geometry) can still change. Dragging one point may move others; changing a dimension may slide the shape. That is normal for a sketch in progress, and a sketch does not need to be fully defined to extrude.

To pin it down:

1. Click **Fully define** in the **Status** group. CadKit adds relations your drawing already shows, then dimensions taken from the present geometry. Check them afterwards: they copy your drawing, so a line that is 59.98 mm long gets a 59.98 mm dimension. See [Constraints and dimensions](constraints.md).
2. Or add the constraints yourself. Blue items tell you where something is missing: a line with no length, a circle with no radius, a corner with no position.
3. If **Fully define** adds nothing for part of the sketch, that part may be a spline or another curve that dimensions cannot pin; the message says how many degrees of freedom remain.

If you cannot drag a point, the sketch may be fully defined, and CadKit says "Sketch is fully defined: remove a constraint to move this point." Delete a constraint or dimension first.

## Over-constrained and conflicting

A sketch is over-constrained when two constraints cannot both hold, or when one repeats what the others already imply.

- A **conflict** is a constraint that contradicts the ones before it. For example, two **Distance** dimensions between the same two points, one 30 mm and one 40 mm. The chip turns red and reads **Over-constrained**; the geometry named by the conflict turns red; the Constraints list opens by itself and shows the culprits.
- A **redundant** constraint is one the sketch already implies, for example a **Parallel** on two lines that are already horizontal. It is shown in amber. It does no harm to the shape, but it counts as over-constraining and may become a conflict if you change a value later.

When you add a constraint with a tool, CadKit checks it first. It refuses a constraint that is already there ("That constraint is already there"), one that adds nothing ("That would add nothing: the sketch already implies it") and one that contradicts a known orientation ("That conflicts with the existing constraints"). Conflicts that arise later, from a value you change, are found by the solver, which blames the later of the clashing constraints.

To fix it:

1. Open the Constraints list. The rows under **Conflicting** are the ones to look at.
2. Delete one conflicting constraint with its **×** button. Usually the one you added last is the right one. Or change its value.
3. If you only wanted to read a size, make the dimension a **reference dimension** instead: click the arrows button on its row. A reference dimension measures and never conflicts. CadKit does this automatically when you add a dimension the sketch already fixes, and tells you.
4. If you are not sure what changed, press `Ctrl+Z` to undo steps inside the sketch.

If the chip or the list says **Does not solve**, the constraints cannot all be met at once at any shape. Typical causes are a dimension larger than the shapes around it allow, a **Tangent** between two lines, and a triangle whose sides cannot meet. Delete the last constraint you added and try a different value.

A conflict does not stop the part from building: the sketch is used as it was last drawn and the rest of the model continues. But the dimensions no longer mean what they say, so fix it.

## A value change goes the wrong way

When you change an **Angle** dimension by a large amount (more than about 90 degrees from the present angle), the solver can land on the other solution, with a line pointing the opposite way. Change the angle in smaller steps.

## It will not extrude

Extrude, Revolve and the other sketch features need closed outlines. These are the usual reasons they do not work.

### The outline is open

The **Extrude** editor shows a card titled **This profile is open**: "A solid needs a closed loop. Give the curve a wall thickness, close it, or make a surface from it." It offers three ways out:

| Button | What it does |
| --- | --- |
| **Make thin wall** | Gives the open curve a wall thickness, so it becomes a thin solid. |
| **Close with a line** | Adds a line across the gap between the two loose ends. If the sketch has no single chain with two loose ends, CadKit says so. |
| **Extrude as surface** | Makes a surface instead of a solid. |

If the gap is small, the card tells you how big: "Almost closed: the ends are 0.02 mm apart." That is almost always two end points that look joined but are separate points. Fix it in the sketch by making the two end points **Coincident**, or by drawing the outline with one chain of the **Line** tool and clicking the first point again to close it.

In the Diagnostics tab and on the feature, the same problem reads **The sketch is not a closed outline. Close the gaps, then try again.**

### The curves cross

CadKit finds closed regions by cutting every curve at its crossings. A line that crosses a rectangle divides it into two regions, and the parts of the line outside the rectangle are dropped as loose ends. Circles that overlap make several regions, and a figure-eight outline becomes two loops. This is not an error. Choose what to extrude:

- In the **Extrude** editor, the **Shapes** list shows each region, with a note on how it nests (for example **Inside shape 1**). Click a shape in the list, or click its area in the viewport, to switch it on or off. "Click regions to choose what to extrude (outer, inner or both)".
- A shape inside another: the outer alone is a filled disc, the inner alone is the inner disc, and both together make a ring.

If you want one outline, remove the stray crossings with **Trim**, or delete the curve that crosses.

Two exact duplicates are merged. Curves that overlap along a line without crossing are not split, which can leave a region closed in the wrong place; delete the overlap.

### Something is construction

Construction geometry (dashed) is never part of an outline. If a shape you need is dashed, select it and click **Make construction** to turn it back to a normal curve. Projected edges are construction too; see [Offsets and references](offset-reference.md).

### The cut removes nothing

A cut needs the sketch to overlap the body. If it does not, the editor says "Nothing to cut: no body under this sketch" or "Nothing to cut: this cut does not reach any body", with an **Add instead** button, and a hint "The cut does not touch the body in this direction. Flip?". Tick **Flip direction**, move the sketch so it overlaps the body, or change the **End condition**.

### The revolve has no axis, or crosses it

A revolve needs a construction line as the axis ("Draw a construction line for the axis") and a profile on one side of it ("The profile crosses the axis").

### Text

Lettering that does not engrave usually has overlapping strokes, a cap height under 0.8 mm, or sits in a sketch with other curves. See [Text](text.md).

## How CadKit tells you

| Where | What you see |
| --- | --- |
| The sketch chip and colours | The degrees of freedom, fully defined, or over-constrained. |
| The Constraints list | The conflicting and redundant constraints, each with a delete button. |
| The hint line | The reason the last click was refused. |
| The editor of the next feature | A card with the problem and, where it can, a button to fix it. |
| The feature tree | A feature that fails turns red with its reason underneath. Features built on it say "blocked by" the cause. |
| **Diagnostics** in the drawer | The first failed feature, the cause in words, advice, **Undo this change**, and a list of the later features that failed because of it. |
| The status bar | **Errors**, counting the causes. |

The **Diagnostics** tab is described in [Checks and diagnostics](../analysis/checks.md).

## Hints you may see

| Hint | What it means and what to do |
| --- | --- |
| Too small: move the pointer farther | The shape would have no size. |
| The three points lie on one line | A 3-point arc needs points that are not in a row. |
| Not enough points for this curve | A spline needs more points; a control-point spline needs more than its degree. |
| A polygon needs at least 3 sides | Press `+` to add sides. |
| These two lines do not meet at a corner | Fillet and Chamfer need two lines that share an end point. |
| The lines are parallel | The two lines never meet, so there is no corner. |
| The radius is too large for these lines / The distance is too large for these lines | Use a smaller radius or distance. |
| A circle needs two cuts to trim | Trim a circle where two other curves cross it. |
| Nothing ahead to extend to | No curve lies in the path of the end. |
| Start from the end of a line or arc | A tangent arc continues from a free end. |
| Already tangent | The end is straight along the tangent: an arc would have an infinite radius. |
| Pick a free curve end | The bridge curve joins open ends. |
| The offset collapses the whole chain / The offset curves no longer meet | Use a smaller offset distance. |
| Pick lines and arcs that form one chain (no branches) | Offset needs a connected chain. |
| That projects to nothing on this plane (it is square-on to it) | The edge is edge-on to the sketch plane. |
| Select edges or faces before the sketch, or click an edge | Nothing was selected to project. |
| Type a valid value | A dimension must be a positive length, or an angle from 0 up to 360 degrees. |

## Next

- [Constraints and dimensions](constraints.md)
- [Sketch tools](tools.md)
- [Checks and diagnostics](../analysis/checks.md)
- [Troubleshooting](../reference/troubleshooting.md)
