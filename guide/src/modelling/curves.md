# Curves on faces

Five commands reshape geometry without making a solid. **Project curve** lays a sketch or an earlier curve onto the faces of a part, **Edit curve** rebuilds edges and curves into one smooth curve, **Offset curve** draws a parallel curve at a distance, **Composite curve** joins curves end to end into one, and **Freeform** pushes a face into a new shape with a control net.

**Project curve**, **Edit curve**, **Offset curve** and **Composite curve** sit in the **Reference** group of the **Features** tab, beside Plane, Axis and Helix. **Freeform** sits on the **Edit** button of the **Surfaces** tab, with Trim surface, Knit and Thicken. All of them are in command search (**F**), and each is greyed out until it has something to work on. Each result is an ordinary feature: it sits in the tree, rebuilds with the part and takes part in undo.

## Project curve

Project curve takes a curve that lies flat (a sketch, or a curve feature you made earlier) and lands it on the faces you choose. What comes out is one smooth curve lying on those faces, which a later Project curve or Edit curve can take as its source.

1. Make a sketch that holds the curve, or select a curve feature in the tree.
2. In Face mode (**Q**) pick the faces the curve should land on. Pick none to use every face of the part and of its surfaces.
3. Choose **Features > Reference > Project**.
4. Set the options, then press **Enter** or the tick.

![A plate with one face picked and the Project curve editor open, showing Project, Onto faces, Direction, Degree and Fit tolerance.](../img/project-curve-editor.png)

| Option | What it does | Default |
|---|---|---|
| Project | The source: a sketch or an earlier curve. With none selected it takes the sketch selected in the tree, else the last sketch that holds a curve. | The last sketch with a curve |
| Onto faces | The faces the curve lands on. | The picked faces, else every face |
| Direction | **Both ways**, **Along the sketch normal** or **Against the sketch normal**. | Both ways |
| Degree | How smooth the curve is. Must be between 2 and 9. | 3 |
| Fit tolerance | How closely the curve follows the faces, in millimetres. | 0.001 mm |
| Keep exact (procedural) | Keeps the projection as its definition instead of a fitted spline, so it stays exact when the face or the sketch changes. It works on exactly one face (the editor warns otherwise) and the curve must stay inside the face. Degree and Direction are not used then; **Project along** chooses the sketch direction, the nearest point of the face, or a direction you type, and **Gap tolerance** is how far apart the pieces of a chain may end. With Keep exact on, **Add curve** lists several curves to project together (sketch curves, edges or earlier curve features, in the order they join end to end); the list replaces the single source, and removing the last curve brings the source back. Turning Keep exact off drops the list. | Off |

The note in the editor says what to expect: the result is one smooth curve lying on the faces, and a curve that misses every face is reported. If the result comes in several separate pieces, the editor's note says so, but check the curve in the view. A projection that reaches no face is refused and the feature is left as it was.

## Offset curve

Offset curve draws a curve parallel to a sketch, a curve or a chain of edges, at a distance. Lines and arcs offset exactly, and the result follows its source when the source changes.

1. Select a sketch or a curve feature in the tree, or in Edge mode (**E**) pick the edges of the chain in order.
2. Choose **Features > Reference > Offset**.
3. Set the distance and where to offset in, then press **Enter**.

| Option | What it does | Default |
|---|---|---|
| From, Curves | A sketch or a curve feature, or the curves listed one by one in the order they follow each other (the list wins when it has curves). | The picked edges, else the selected curve or sketch, else the last sketch with a curve |
| Distance | A positive distance moves to the right of the direction of travel, seen from the side the plane normal points to; a negative one moves to the left. It cannot be 0. | 5 mm |
| Offset in | **The plane of the curve** (the sketch plane, or the plane the curve lies in), **A plane** (a standard or reference plane), **The surface of a face** (the offset stays on the face, found with **Pick**) or **A plane by its normal**. | The plane of the curve |
| Spline tolerance | How closely the exact definition is converted to a spline for later features. | 0.001 mm |
| Gap tolerance | The largest gap allowed between consecutive curves of a chain. | 0.00001 mm |

A corner in the curve is refused (an offset of it would have a gap): round the corner in the sketch first. A distance larger than a bend allows, or one that makes the offset run into another part of the curve, is refused too, with the radius at which it fails. A curve that does not lie in one plane needs a plane or a face to offset in.

## Composite curve

Composite curve joins curves that meet end to end into one curve that keeps its pieces. Each piece is turned to run on from the previous one.

1. Select a sketch or a curve feature in the tree, or in Edge mode (**E**) pick the edges in the order they follow each other.
2. Choose **Features > Reference > Join**.
3. Set the tolerances if the pieces do not quite meet, then press **Enter**.

| Option | What it does | Default |
|---|---|---|
| From, Curves | As for Offset curve. A sketch is walked into one chain from a free end. | The picked edges, else the selected curve or sketch, else the last sketch with a curve |
| Gap tolerance | The largest distance between the end of one piece and the start of the next. A larger gap is refused. | 0.00001 mm |
| Spline tolerance | How closely the joined curve is converted to a spline. Lines, arcs and splines convert exactly. | 0.001 mm |

Sketch curves that do not form one chain are refused: connect them in the sketch, or list them in order.

## Edit curve

Edit curve rebuilds a chain of edges, sketch curves or an earlier curve into one smooth curve, keeping the ends and the corners you ask it to keep. The pieces must meet end to end, in the order you add them.

1. In Edge mode (**E**) pick the edges of the chain, or select a curve feature or a sketch in the tree.
2. Choose **Features > Reference > Edit curve**.
3. Set the rebuild and the keep options, add control point edits if you want to shape it, then press **Enter**.

![A two-line chain rebuilt as one smooth curve, with the Edit curve editor open showing the Curves list, Rebuild and Control point edits.](../img/edit-curve-editor.png)

| Option | What it does | Default |
|---|---|---|
| Curves | The chain, one row each, with **Add curve**. | The picked edges, else the sketch or curve feature selected in the tree, else the last one |
| Rebuild, Fit by | **Tolerance** follows the picks to a tolerance; **Number of control points** fits a fixed count. | Tolerance |
| Degree, Tolerance or Control points | The numbers of the chosen fit. The degree must be between 2 and 9. | Degree 3, tolerance 0.01 mm |
| Keep the ends, Keep the end tangents, Keep corners | What the rebuilt curve must match at its ends and at a corner. | Ends and corners kept |
| Flatten onto a plane, Plane | Puts the curve flat on a plane instead of following the picks. | Off |
| Control point edits | **Add edit**, then a control point number, a direction (the world axes, or the curve's tangent, normal and binormal), an offset and a weight. An edit past the last point is skipped. | None |

## Freeform

Freeform rebuilds a face as a net of control points and lets you push some of them. Pick faces in Face mode (**Q**) and choose **Surfaces > Edit > Freeform**. The editor has two sections.

**Control net**

| Option | What it does | Default |
|---|---|---|
| Face | The faces to rebuild. | The picked face |
| Degree U, Degree V | How smooth the net is along each direction. | 3 and 3 |
| Spans U, Spans V | How many pieces the net is cut into along each direction. | 2 and 2 |

The note under the fields gives the size of the net: with the defaults the face is rebuilt as a 5 x 5 net of points, numbered from 0. Rebuilding alone does not change the shape.

**Point moves**

- **Add move** adds a row. **Points (column,row)** names the points to shift: `2,2`, or `2,2; 2,3` for several, counted from 0 in the corner of the net.
- **Offset X**, **Offset Y** and **Offset Z** move them by that many millimetres. **Offset along** chooses the frame: the world axes, the face (X and Y along it, Z out of it), or a plane with **Plane**.
- **Spread to neighbours** shares the move with the points around it (0 is none). **Mirror about** repeats it across a plane. **Skip this edit** turns a row off without deleting it.

The outer ring of the net never moves, so the face keeps the border it shares with its neighbours. Moving points works on exactly one face: the editor says so when you have picked several. Several faces can be rebuilt at once, but their points cannot be moved by these edits.

## Common problems

| Symptom | Fix |
|---|---|
| Project curve is greyed out | It needs a body or a surface, and a sketch or curve to project. Start a sketch, or select one in the tree |
| The curve misses every face | Move the sketch over the part, or pick the faces the curve does cross, or change the direction |
| A degree is refused | The degree must be between 2 and 9 |
| Offset curve is refused at a corner | An offset cannot follow a corner. Round the corner in the sketch, or offset the pieces one at a time |
| Offset curve is refused at a distance | The distance is larger than a bend of the curve allows. Use a smaller distance, or offset to the other side |
| Composite curve says two curves do not meet | The gap is larger than the gap tolerance. Close the gap in the sketch, list the curves in order, or raise the tolerance |
| Keep exact says it needs one face | A procedural projection works on exactly one face. Pick one face, or turn Keep exact off |
| Edit curve will not build | The chain must meet end to end. Keep **Keep corners** on for a chain with a corner, and check the order of the rows in **Curves** |
| Freeform says to pick a single face | Point moves work on one face only. Clear the extra picks, or delete the moves |
| The face will not move at its border | The outer ring never moves. Move points inside the ring |
| An edit does nothing | An edit past the last point of the net is skipped. Check the control point number |

## Next

- [Surfaces](surfaces.md)
- [Reference geometry](reference-geometry.md)
- [Offsets and references](../sketching/offset-reference.md)
- [Commands and shortcuts](../reference/commands.md)
