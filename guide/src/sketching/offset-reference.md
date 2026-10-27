# Offsets and references

This chapter covers three ways of building a sketch from geometry that already exists: **Offset**, which draws a parallel copy of a curve; **Project edges**, which brings the edges of the part into the sketch as reference geometry; and **Construction** geometry, which helps you draw without becoming part of the shape. It also explains what these references are not: they are a snapshot, not a live link to the part.

## Offset

**Offset** (`O`, in the **Modify** group) draws a copy of a curve at a set distance. It is the quickest way to make a wall, a pocket inside an outline, or a clearance around a shape.

1. Choose **Offset**.
2. Click a line, arc, circle or spline. For lines and arcs, CadKit selects the whole chain of lines and arcs connected end to end with it (with no branches). Click the chain again to unselect it. `Shift`-click toggles a single entity, which must stay connected to the rest.
3. Press `Enter`.
4. Move the pointer to the side you want. The distance from the chain to the pointer is the offset distance, and the side the pointer is on is the direction. Or type digits: the one field, `dist`, takes them, and `Enter` (or `Tab`) locks the value. Then click on the side. `F` flips the side.
5. Click to place the copy.

`Esc` drops a typed value first, then the selection.

How the copy behaves:

- Where neighbouring curves meet, the offset curves are joined at their intersection, trimmed or extended as needed. A closed chain stays closed.
- A piece that would collapse at this distance (an arc whose radius would reach zero, or a line that would reverse) is left out, and the hint says so.
- The copy is parametric. Every copied line is made parallel to its source and gets a point-to-line distance dimension with the offset distance. Every copied arc or circle shares the centre of its source and keeps the difference in radius. Change a distance and the copy follows. Each segment carries its own distance, so there is no single dimension that changes them all.
- The copy keeps the construction flag of its source.
- The source geometry and its constraints are untouched.

Chains that mix a spline with lines or arcs cannot be offset. Pick the spline on its own. A spline is copied as a new spline through points taken on the exact offset curve (at most 48 points), and it is a free curve, not linked to its source. When the distance is larger than the curve's local radius of curvature, or two sides of a narrow neck would cross, nothing is drawn and the hint says the offset folds over itself: use a smaller distance or the other side.

### Offset a reference outline

You can offset things that are not yet in the sketch:

- **Edges of the part.** Hover an edge of the part. The whole outline of edges in the same plane, joined end to end, lights up. Click it to project it into the sketch and select it, then continue as above: `Enter`, side, distance.
- **Curves of other sketches**, including sketches an extrude has already used. These are not drawn in the 3D view, but Offset and Project can still pick them.
- **The outline of the face you are sketching on.** If you started the sketch from a planar face, choose **Offset** and CadKit takes that face's outer outline, inward, with a distance of 1 mm. The hint reads "Face outline offset inward: type a distance, press F to flip the side, Enter to apply". `Enter` applies, a typed value changes the distance, and `Esc` drops the typed value so the pointer drives the distance.

The projected outline is fixed and counts as a real edge of the sketch's shapes (it is not construction), so the ring between the outline and its offset is a region you can extrude or cut.

### Cut a pocket or a wall

When a sketch holds an outline and an offset inside it, the extrude and cut editors list the **Shapes** by how they nest:

- **Inside the offset (pocket)**: the area inside the offset.
- **Wall between outline and offset**: the ring between the two.

For a cut, `Shift+C` on such a sketch chooses the pocket by default. The wall would remove material whose outer face is the body's own wall, which a pocket does not need. Tick both shapes if you really want the ring.

## Project edges

**Project edges** (`P`, in the **Reference** group) flattens edges of the part onto the sketch plane and adds them to the sketch.

- Hover an edge to preview its projection and click to project it.
- Press `Enter` to project the edges and faces you selected before opening the sketch. That includes the boundary of the face you are sketching on.
- A click on an edge that is already projected says so.

What you get:

- Fixed points: projected geometry never moves and adds no degrees of freedom.
- A line, arc or circle where the projection is one, otherwise a spline.
- Construction geometry, drawn dashed, which is not extruded. A circle is fully defined by its projection.

Limits to know:

- **It is a snapshot.** If the part changes, the projected geometry stays where it was. Project again, or redraw.
- An edge square-on to the sketch plane projects to a point and is skipped, and "That projects to nothing on this plane" appears.
- A circle seen at an angle becomes a spline, not an ellipse.
- Body picking is off while you sketch, so select edges and faces before you open the sketch if you want to use `Enter`.
- A free-form edge is rebuilt from the part's display mesh and follows the true curve only to about 0.01 mm, unless it is the wall of an extruded sketch spline, which projects exactly. Cutting a ring made from an edge that is only that close can fail; cut the inside loop instead.

## Construction geometry

Construction geometry is dashed, takes part in constraints and snaps, and is never extruded or revolved. Use it as an axis, a guide or a mirror line.

- **Centreline** draws a construction line directly.
- **Construction mode**, the **Construction** button in the **Reference** group, makes everything you draw next construction until you turn it off.
- **Make construction** (shown when geometry is selected) switches the selection between normal and construction.
- The **Construction** tool (`X`) flips one curve at a time; `Shift`-click flips the whole connected chain.

Points cannot be construction. See [Sketch tools](tools.md).

## Model snaps

While a sketch is open, the part offers places to snap to, in a different colour from the sketch's own snaps. They come from the part's edges projected into the sketch plane: **model endpoint**, **model midpoint**, **model centre**, **model quadrant**, **model crossing**, **mid-extent** (a dashed guide half way across the part), **body centre** and **mid of extrusion**. They are on by default and can be switched off in the **Snaps** menu.

A model snap only positions your point. Hold `Shift` while you click to attach it: a fixed reference point is added there, and your point is made coincident with it. The attachment is also a snapshot.

## Locking a placed shape to the part

When you place a shape from the catalog, its size box has a **Lock to** list of nearby points (hole centres, corners, edge midpoints). Choosing one adds a fixed reference point to the shape's sketch and holds the shape at the same horizontal and vertical distance from it. The distances are ordinary dimensions in the shape's sketch, so you can edit them there. They record the position at the moment you lock; if the part changes so that the point moves, the shape does not follow. See [Catalog parts](../library/catalog.md).

## What does not exist yet

References that follow the part when it changes (an associative link from a sketch to an edge or a face) are not available. Everything above is a snapshot. If you need a feature to stay tied to a part's dimension, drive both from a variable. See [Equations and variables](../modelling/equations.md).

## Next

- [Sketch tools](tools.md)
- [Constraints and dimensions](constraints.md)
- [When a sketch will not solve](troubleshooting.md)
