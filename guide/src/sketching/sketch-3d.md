# 3D sketches

CadKit sketches are flat: every sketch lies on a plane or a face. This page says what exists beyond that, so you know what to expect when you meet a 3D sketch and what to use instead.

## What exists

The part format and the geometry kernel have a feature called a **3D sketch**. It holds points with three coordinates and curves in space (lines, arcs, splines and control-point splines), with its own constraints. It is not on a plane and has no profile, so you cannot extrude it. It exists to serve as a path, for example for a sweep along a curve that bends in all three directions.

In the application:

- A 3D sketch in a part appears in the feature tree with the name **3D sketch**, and is hidden and shown like any other sketch.
- A 3D sketch arrives with a part that was made elsewhere: when an import converts a sweep that follows a spline path, it builds a 3D sketch for the path and a sweep along it. See [Importing](../files/import.md).
- A part file that contains one opens, rebuilds and saves it unchanged.

## What does not exist

- **There is no tool to draw a 3D sketch.** The **New sketch** commands and the sketch tools work only on planes and faces.
- **There is no editor for one.** You cannot add a point, drag a curve or add a constraint to a 3D sketch from the interface.
- **Scripts can create them.** A script can add a `sketch3d` feature with its raw feature call, even though the interface has no tool for it. See [Scripting](../automation/scripting.md).
- **The Sweep editor offers only flat sketches** as its **Path (open)**. A 3D sketch can be the path of a sweep that came with the file, but you cannot pick one for a new sweep.

If you need to change a 3D sketch, the part format describes its fields in [3D sketches](/docs/cad/kernel/format/features-surfaces.html#3d-sketches) in the kernel book.

## What to use instead

| You want | Use |
| --- | --- |
| A path that curves in one plane | A flat sketch with a line, arc or spline as the sweep path. See [Extrude, revolve, sweep and loft](../modelling/solids.md). |
| A coil or a spring path | **Helix** (Features tab, **Reference** group), made from a sketch with a circle. |
| A shape that follows a curve in space | A loft between profile sketches on several planes, steered by guide curves. CadKit cannot sweep along a path that you draw in 3D. See [Extrude, revolve, sweep and loft](../modelling/solids.md). |
| A plane at an angle to the sketch you are in | **Plane** (Features tab, **Reference** group), then a sketch on that plane. See [Starting a sketch](start.md). |
| A reference curve from the part's own edges | **Project edges** in a sketch. See [Offsets and references](offset-reference.md). |

## Next

- [Starting a sketch](start.md)
- [Sketch tools](tools.md)
- [Extrude, revolve, sweep and loft](../modelling/solids.md)
- [Importing](../files/import.md)
