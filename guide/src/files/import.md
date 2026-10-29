# Importing

This chapter covers every kind of file the app can import: STEP, SolidWorks, SketchUp, FreeCAD, SolidCraft and DXF, plus how parts from samples and the library come in. For each, you will find how to import it, what you get, what is converted, how units and colours are treated, and what to do when an import is slow or fails.

There are two very different results, so check which one you have before you plan to edit:

| Result | Formats | What you can do |
|---|---|---|
| **Editable features** | FreeCAD, SolidCraft, DXF (into a sketch), CadKit parts | Edit the feature tree, change dimensions, add features. Saved with the part. |
| **Editable imported body** | SolidWorks | The solid arrives as one imported body that later features can cut, drill, fillet and measure. It is saved with the part. The design history of the file is not read. |
| **View-only body** | STEP, SketchUp | Look at it, orbit and zoom. The body is not a feature, it is not saved with the part, and the next edit replaces the display. |

A view-only import opens as a new, empty part named after the file. The notice says so ("Imported bodies are view only and are not saved with the part."). In the code, each Export entry is enabled only when the controller holds a built mesh from the part's features, and an import only draws the body in the viewport without storing it there. So the Export entries should stay greyed out for a part that holds only an imported body. This follows from reading the code; it has not been checked in a running app.

## How to import

1. Choose **Open** in the top bar and pick the file, or drag the file onto the window. The app decides by the extension.
2. Or open the **More file actions** menu and choose **Import STEP / SolidWorks / SketchUp**, which only offers those three kinds.

An import never replaces the part you are working on: it opens in a new tab, or in the current tab when that is still blank. A long import shows a progress overlay; for a slow one you can press its cancel button.

## STEP

STEP (`.step`, `.stp`) is the best way to bring a solid from another CAD program.

- **You get** a view-only solid named after the file. The notice gives the face count.
- **Units** are read from the file and converted to millimetres, so an inch file arrives at the right size.
- **Converted**: solids, faces with holes, planes, cylinders, cones, spheres, tori, spline and swept surfaces, and the curves bounding them. All solids in the file arrive in one body, at their own coordinates.
- **Repair**: after reading, the importer closes small gaps and sews edges that do not quite meet, with a tolerance of 0.0001 mm.
- **Colours** and names are ignored, and assembly structure is not read: parts placed by transforms in an assembly file are not positioned.
- **Limits**: a file with only surfaces or open shells and no solid is refused ("noSolid"). Unusual entities are refused with a message that names the code (`parse`, `noSolid`, `unsupported`, `badEntity`, `topology`).

If STEP refuses a file, try exporting it again from the source program, choosing a solid (not surface) output, a standard application protocol and millimetres. The kernel book has the full list of what is read: [STEP](/docs/cad/kernel/io/step.html).

## SolidWorks parts

SolidWorks part files (`.sldprt`) are read directly.

- **You get** the solid of the active configuration as an **editable imported body** in a new part named after the file: the first feature of the tree is the body (written to the part as STEP by the kernel, so it is saved with the part). The notice says "Opened &lt;file&gt; (SolidWorks): N faces, as an editable body." The body has the volume and the box of the solid SolidWorks itself writes to STEP. If the part cannot be built from the solid (the check of its volume fails), the solid is shown view-only as before, with the notice "Imported &lt;file&gt; (SolidWorks): N faces. Imported bodies are view only and are not saved with the part."
- **Converted**: planar, cylindrical, conical, spherical and toroidal faces and spline surfaces. Some blend and intersection curves are approximated, and the import fails if an approximation is off by more than 0.05 mm.
- **Units**: SolidWorks stores metres; the importer scales to millimetres.
- **Not read**: the feature tree and sketches (a file converted to `.solidcraft` by Dutchman brings some of them, see SolidCraft below), dimensions, configurations other than the active one, annotations and flat patterns. Sheet-metal parts arrive as the folded solid. Files with only sheet or wire bodies are refused.
- **Limits**: files with more than 50,000 faces are refused. The oldest tested file is from SolidWorks 2011 and the newest from 2022; newer files are untested.

If a file fails, save it as STEP from SolidWorks and import that instead. More detail: [SolidWorks](/docs/cad/kernel/io/sldprt.html).

## SketchUp

SketchUp files (`.skp`) are surface models made of flat faces, not solids.

- **You get** a view-only body with each face in its SketchUp colour. Translucent materials are drawn translucent. Texture images are not imported.
- **Units**: SketchUp stores inches and the importer converts to millimetres.
- **Orientation**: SketchUp is Z up and the app is Y up, so the model opens upright. The notice has a **Flip orientation** button that cycles through three views: upright, as in the file (Z up, so the model lies on its side here), and upside down. **Rotate imported model** in More file actions does the same while a SketchUp model is shown.
- **Hidden geometry** is left out by default, and the notice says how many hidden faces were skipped, with a **Show hidden geometry** button. **Import SketchUp with hidden geometry** in More file actions imports a file with them included.
- **Open surfaces**: if the model is not closed, the notice warns ("SketchUp surface model: N open edges; solids operations may not apply"). A closed model has volume; an open one does not.
- **Not imported**: scenes, cameras, text, dimensions, construction lines, true arcs (curves become many short flat faces), and styles other than face colours.
- **Limits**: models over 50,000 faces are refused ("limit.faces"), and a file with no faces, or with everything hidden, is refused ("body.empty").

## FreeCAD

A FreeCAD file (`.FCStd`) becomes an editable part.

- **You get** a new part with the features that could be mapped. The notice says how many of the total mapped and shows the first warning, and counts the rest.
- **Which body**: only one PartDesign body is imported, the one with the most features. A notice says if there were more.
- **Converted**:

| FreeCAD | Becomes |
|---|---|
| Sketches: lines, circles, arcs, ellipses, points, construction geometry | Sketch geometry. Points that meet are merged. |
| Coincident, horizontal, vertical, parallel, perpendicular, tangent, equal, radius, diameter, distance constraints | The same constraints |
| Pad, Pocket (blind, symmetric, two lengths, through all, reversed) | Extrude, add or cut |
| Revolution, Groove (about a sketch axis, a construction line or an origin axis) | Revolve |
| Mirrored (about an origin plane) | Mirror |
| LinearPattern, PolarPattern | Linear and circular patterns |

- **Not converted**: point-on-object, symmetric, angle and block constraints and splines (counted in a warning; the shape is right but dragging it will not behave as it did in FreeCAD); tapered or custom-direction pads; "up to face/first/last" end conditions; Thickness, Draft, Hole, Boolean, Loft, Pipe, Helix, MultiTransform and clones; sketches on planes that are not parallel to a standard plane. **Fillets and chamfers are left out in this version**, and each is listed. Parameter expressions and spreadsheet links are dropped; the numbers they had are kept.
- **Units** are millimetres, as in FreeCAD.
- **Colours** are not imported.
- **Files with no PartDesign body** (built in the Part workbench, or only imported shapes) import nothing and the notice says why. Export STEP from FreeCAD and import that instead.

## SolidCraft

A SolidCraft file (`.solidcraft`) becomes an editable part.

- **You get** a new, unsaved part named after the file, with one feature for each feature that could be converted. A progress overlay shows "Importing &lt;file&gt;: feature N of M" and has a cancel button, because a large file can take minutes.
- **Orientation**: SolidCraft is Z up and the app is Y up. The importer turns the model so that it stands the right way up and keeps its shape. A file converted from a SolidWorks part (its original solid names a `.sldprt`) is already Y up, like the app, and is not turned.
- **Converted**: sketches on planes and faces with their geometry (lines, arcs, circles, ellipses, splines) and constraints (including parallel, perpendicular, equal, fixed points and point-to-line distances); extrudes (new body, join, cut, through all; symmetric, two-sided and tapered; starting or stopping at a face; regions picked by their outlines); boxes, cylinders, spheres and tori; fillets and chamfers; shells; revolves about a line of the sketch, a line in space or the sketch axis (also symmetric); lofts, including to a point and along guide rails; mirrors of features and of whole bodies; sweeps along a spline or along lines and arcs (with a twist); coils; circular patterns (of features about a coordinate axis through the origin, of bodies about any axis) and rectangular patterns; holes, also up to a face; sheet-metal base flanges (as a plate of the sheet thickness); scale; moving and copying bodies; combining and removing bodies; text; and plastic features such as bosses, rests, snap fits and lips. Named parameters arrive as the part's variables (see below). Expressions may use `+ - * / ^`, parentheses, `pi`, the functions `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `sqrt`, `abs`, `min`, `max`, `floor`, `ceil`, `round`, `trunc`, `exp`, `ln`, `log10`, `hypot`, `pow` and `mod` (angles in degrees), and the units `mm`, `cm`, `m`, `in`, `ft`, `deg` and `rad`.
- **Assemblies**: each component becomes a part of its own, inserted once per occurrence and placed by its transform. A component placed inside another one (a sub-assembly) is inserted into the part of that component, so it moves with it. A placement the file hides has its bodies hidden here too (in every copy of the component that holds it). A revolute joint between two circles becomes a hinge mate. Other joints are reported as skipped. Timeline folders of the file become tree folders.
- **Parameters**: the named parameters of the file become the part's variables, so you can change one and the part follows. A field written as a name or a simple expression over them (an extrude depth, a hole or sphere size, a fillet radius, a chamfer or shell thickness, a revolve angle, a sweep twist, a pattern spacing, a cylinder height) stays an expression, and so does a sketch dimension that names a parameter. What the part's expressions cannot hold (functions other than `sqrt`, `sin`, `cos`, `tan` and `abs`, a parameter whose name the part cannot take) is kept as the number it evaluates to, and the row of that feature says so. Other fields, such as a box size or a position, are plain numbers.
- **Colours**: body colours and opacity, metallic and roughness, and hidden bodies are carried over. Per-face colours and hidden joints are not.
- **The stored solid** of a file converted from another CAD system (SolidWorks, Fusion 360 and others) is kept as an imported body. The importer reads it through the kernel first: a converter that restates the geometry can turn some faces the wrong way, and then the body is healed (the kernel's own STEP of it is used). When the file also builds a body from sketches and operations, the importer rebuilds it and compares its volume with the stored solid; if they differ by more than 0.5%, the stored solid is the body, the operations that build bodies are shown as skipped with both volumes, and the sketches stay.
- **What cannot be converted** stays as a suppressed placeholder row in the tree that shows the raw feature type, so nothing is lost silently. Features that depend on it are reported too. The notice says how many converted, names the first problem, and counts the rest. The geometry is then partial.
- **Refused as a whole**: a file that is not a valid SolidCraft file, has an unknown format version, or uses units other than millimetres. The part you had open is untouched.
- **Known gaps**: sheet metal other than base and contour flanges, joint limits, patterns along a path of non-round seeds, circular patterns of features about an axis that is not a coordinate axis through the origin, sweeps that keep the profile at a fixed angle or scale it, surface features, conic curves in sketches, per-face colours, and modelled threads. A tapered extrude that is also symmetric, two-sided or stops at a face is reported, as is an end offset from a face.

A `.solidcraft` file is either a zip archive or a bare JSON document. Both are read.

## DXF

A DXF file (`.dxf`) brings 2D geometry into a sketch. It does not make a part.

- **Into the sketch you are editing**: while a sketch is open, choose **Import DXF into sketch** (Home tab, Sketch group), or drop the file onto the window.
- **As a new sketch**: choose **New sketch from DXF**, in the new-sketch menu of the Home tab. The sketch goes on the selected face or plane, or on the front plane when nothing is selected. Dropping a DXF with no sketch open does the same.
- **Read**: lines, circles, arcs, polylines (bulges become arcs, a closed flag closes the outline), splines and points. Entities on a layer named CONSTRUCTION become construction geometry.
- **Units** come from the file's drawing units and are converted (inches, feet, centimetres, metres and others). Unitless or millimetre drawings are used as drawn. An unknown unit code is read as millimetres, with a notice.
- **Not read**, and listed in a notice: blocks, text, hatches, dimensions, ellipses and 3D entities.
- **Connected outlines**: end points closer than 0.000001 mm are merged, so outlines close. No constraints are added.
- **Limits**: more than 20,000 entities, coordinates further than 1,000,000 mm from the origin, binary DXF and DWG are refused with a message. The origin is kept as drawn (the drawing is not re-centred), so move a far-away drawing to the origin first.

## Parts from samples and the library

**Samples** (top bar) opens a sample part as a new part, fully editable. Parts from a library, and the Catalog, are added to the part you have open as ordinary features in one undo step; they are not imports of a file. See [The library and samples](../library/library.md).

To use another saved part inside an assembly, see [Assemblies and mates](../assemblies/assemblies.md).

## When an import is slow or fails

- **Wait for the overlay.** A large STEP or SolidWorks file can take seconds and a large SolidCraft file minutes. A busy overlay with a cancel button is shown, and nothing else is changed until it ends.
- **A notice names the cause.** "Could not import &lt;file&gt;: ..." gives the reason or the error code. Read the notice before trying again; the Console tab of the drawer keeps recent notices.
- **Nothing to import.** STEP with no solid, SketchUp with no visible faces and FreeCAD with no PartDesign body are refused. Check the source model has a solid and that nothing is hidden.
- **Too large.** Over 50,000 faces for SolidWorks and SketchUp. Simplify the model in the source program or split it.
- **Wrong size.** Imports apply the file's units. If the part is 25.4 times too big or small, the units in the source file were wrong; fix them there.
- **Gaps or open edges** on a STEP or SketchUp import mean the surface is not closed. Fix it in the source program, or run it through STEP export.
- **Imported but a feature is missing** (FreeCAD, SolidCraft): look at the notice and at the tree. Placeholder rows are suppressed; the rest is real. You can rebuild the missing features yourself on top of what came in.
- **Still stuck?** [Troubleshooting](../reference/troubleshooting.md) has more.

## Next

- [Exporting](export.md)
- [File formats at a glance](formats.md)
- [Sketch tools](../sketching/tools.md)
- [Limits and known gaps](../reference/limits.md)
