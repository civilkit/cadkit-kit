# 3D sketches

This is the reference page. If you are new to 3D sketching, start with [Introduction to 3D sketching](intro-3d-sketching.md).

A normal sketch is flat: it lies on a plane or a face. A **3D sketch** is not: its points have three coordinates, so it can run in any direction. It has no profile and cannot be extruded. It is made to be a **path**, for example for a sweep along a curve that bends in all three directions, like a handrail, a hose or a wire.

## Drawing one

Choose **3D Sketch** on the **Home** tab, in the **Sketch** group (on a phone, on the **Sketch** tab of the tools sheet), or search for "3D Sketch" in the command search. The tool opens in the left panel and takes over the 3D view.

Pick what to draw:

| Mode | What it makes |
| --- | --- |
| **Line** | A polyline: click the corners. Click the last point again, or **End chain**, to stop; click the first point to close it. |
| **Arc** | Click the start, a point on the arc, then the end. An arc of more than half a turn is made of several arcs that join up. |
| **Spline** | A smooth curve that passes through every point you click. **End chain** stops it; clicking the first point again closes it. |
| **Control spline** | A curve pulled towards the points but not through them. Set its **Degree** (3 by default; fewer points give a lower degree). |
| **Points** | Single points. |

Draw on the **Work plane**: **Ground** (the plane of the grid), **Front**, **Top**, **Right**, or any plane of the part. A plane you selected in the feature tree is the starting choice. Each click lands where your pointer meets the work plane.

### Lifting points off the plane

- **Height above plane** moves the work plane along its normal: set it to 40 and the next clicks land 40 mm above the ground. Change it between clicks to build a curve that rises and falls.
- Under **Add by coordinates**, type **X**, **Y** and **Z** and press **Add** (or Enter): the point goes there, wherever it is.
- Every point is in the **Points** list with its three coordinates. Type in a field to move it.

### Snapping

With **Snap to model and sketch points** on, a click near one of these snaps to it, in space, ignoring the work plane:

- a corner of the model (the end of an edge) and the middle of an edge;
- a point of another sketch, flat or 3D;
- a point you have already placed in this sketch (the click then reuses it, so lines and curves join).

A yellow cross shows where a click will land on the plane; a green cross shows a snap.

### Editing while you draw

- **Drag a diamond** to move that point in the work plane. For the third direction, type its coordinate.
- **Hover** a diamond and it brightens and grows slightly. **Click** it to select it: the diamond turns red and its row in the list is highlighted (clicking a row selects the diamond too). The click area is larger than the drawn diamond, and larger again on a touch screen.
- **While you draw a chain**, a click on an existing point does not select it: it joins the chain there, so the line or spline continues through that point, a click on the chain's first point closes the outline, and a click on the last point ends the chain. **Shift+click** an existing point with no chain under way starts a new chain from it. Placing a new point clears the selection.
- Select a point (click its diamond or its row) and press Backspace or Delete, or press **×** in the list, to remove it. A polyline closes up over the gap; a spline just loses that point.
- **Undo point** removes the last point of the chain you are drawing. Ctrl+Z (Cmd+Z) steps back through the tool, not through the part.
- **Enter** or **Create** finishes: one **3D sketch** feature is added, as one undo step. **Esc** drops the chain you are drawing, and a second **Esc** cancels the tool.

Double-click the 3D sketch in the feature tree to open it again, with the same tools, and press **Update**. It is hidden, shown and suppressed like any other sketch, and drawn as a teal curve (the **Curves** display layer).

## Sweeping along a 3D sketch

The kernel sweeps along a 3D sketch that holds **exactly one spline** (and nothing but points). A polyline or arcs in a 3D sketch are fine for reference, but cannot be a sweep path; the Sweep editor does not list them.

The [introduction](intro-3d-sketching.md) walks through this step by step with pictures. In short, a pipe along a curve:

1. Open **3D Sketch**, keep **Spline**, and click four or five points. Lift some of them with **Height above plane**. Leave **Also add a plane normal to the start** ticked, and press **Create**. You now have the 3D sketch and a **Plane** at its start, square to the curve.
2. Select that plane in the tree and choose **Sketch**. Draw a circle (or any closed outline) around the origin and finish the sketch.
3. Run **Sweep** (**Home** tab, **Create** group, in the list of the **Loft** button; Shift+W; or the command search). **Profile** is the new sketch; **Path (open)** offers the 3D sketch. Confirm.

The same path list is used by **Path pattern**.

### What cannot use a 3D sketch

Guide curves of a sweep or loft, loft sections, **Project curve** and Rib take curves of flat sketches only; they do not list 3D sketches.

## Not in the tool

The constraint solver for 3D sketches is in the kernel, but the tool does not offer constraints: you place and move points directly. Constraints already in a 3D sketch (for example from an import) are kept when you edit it, except ones that refer to a point you delete.

## Next

- [Introduction to 3D sketching](intro-3d-sketching.md)
- [Starting a sketch](start.md)
- [Sketch tools](tools.md)
- [Extrude, revolve, sweep and loft](../modelling/solids.md)
- [Importing](../files/import.md)
