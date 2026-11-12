# Importing

This chapter covers every kind of file the app can import: STEP, STL, OBJ, GLB and 3MF meshes, SolidWorks, SketchUp, FreeCAD, SolidCraft, DXF and SVG, plus how parts from samples and the library come in. For each, you will find how to import it, what you get, what is converted, how units and colours are treated, the import report and repair, and what to do when an import is slow or fails.

There are two very different results, so check which one you have before you plan to edit:

| Result | Formats | What you can do |
|---|---|---|
| **Editable features** | FreeCAD, SolidCraft, DXF and SVG (into a sketch), CivilKit CAD parts | Edit the feature tree, change dimensions, add features. Saved with the part. |
| **Imported solid feature** | STEP (the default choice) | The solid is the first feature of a new part: later features can cut, drill, fillet, mate and sketch on its faces. The STEP text is saved inside the part and the part rebuilds when it is opened. |
| **Editable imported body** | SolidWorks | The solid arrives as one imported body that later features can cut, drill, fillet and measure. It is saved with the part. When the kernel can rebuild the file's feature history (sketches, extrudes, fillets and so on), the part opens with that history instead and you can edit it. |
| **Reference mesh** | STL, OBJ, GLB, 3MF, SketchUp (the default choice) | A mesh to look at and draw on: it is saved with the part, can be moved, turned, scaled and made see-through, and the 3D Sketch tool snaps onto its surface. A SketchUp, GLB or 3MF mesh keeps its colours and translucent materials, and an OBJ does when its material file comes with it. It is not a solid and not part of the feature history. |
| **View-only body** | STEP and SketchUp when you choose "View only" | Look at it, orbit and zoom. The body is not a feature, it is not saved with the part, and the next edit replaces the display. |

STEP and SketchUp files ask which of the two you want in a small box (the choice is remembered per kind; the first option is the default). A view-only import opens as a new, empty part named after the file. The notice says so ("Imported bodies are view only and are not saved with the part."). In the code, each Export entry is enabled only when the controller holds a built mesh from the part's features, and an import only draws the body in the viewport without storing it there. So the Export entries should stay greyed out for a part that holds only an imported body. This follows from reading the code; it has not been checked in a running app.

## How to import

1. Choose **Open** in the top bar and pick the file, or drag the file onto the window. The app decides by the extension.
2. Or open the **More file actions** menu and choose **Import STEP / STL / OBJ / GLB / 3MF / SolidWorks / SketchUp**, which only offers those kinds.

An import never replaces the part you are working on: it opens in a new tab, or in the current tab when that is still blank. A long import shows a progress overlay; for a slow one you can press its cancel button.

## STEP

STEP (`.step`, `.stp`) is the best way to bring a solid from another CAD program.

- **You get**, with the default choice **Part feature**, a new part named after the file whose first feature is the solid (an *Imported STEP body* row in the tree). The notice gives the face count. The STEP text is stored inside the part, compressed, so **Save** keeps it, the part rebuilds when you open the file, and the solid can be used in booleans, mates and sketches on its faces. If the part cannot be built from the text, the solid is shown view only and the notice says why. Choose **View only** in the box for the old behaviour: a body to look at that is not saved.
- **Units** are read from the file and converted to millimetres, so an inch file arrives at the right size.
- **Converted**: solids, faces with holes, planes, cylinders, cones, spheres, tori, spline and swept surfaces, and the curves bounding them. All solids in the file arrive in one body, at their own coordinates.
- **Repair**: after reading, the importer closes small gaps and sews edges that do not quite meet, with a tolerance of 0.0001 mm.
- **Colours** and names are ignored, and assembly structure is not read: parts placed by transforms in an assembly file are not positioned.
- **Limits**: a file with only surfaces or open shells and no solid is refused ("noSolid"). Unusual entities are refused with a message that names the code (`parse`, `noSolid`, `unsupported`, `badEntity`, `topology`).

If STEP refuses a file, try exporting it again from the source program, choosing a solid (not surface) output, a standard application protocol and millimetres. The kernel book has the full list of what is read: [STEP](/docs/cad/kernel/io/step.html).

## Mesh files: STL, OBJ, GLB and 3MF (a model to sketch on)

STL (`.stl`, binary or text), OBJ (`.obj`), binary glTF (`.glb`) and 3MF (`.3mf`) are meshes of triangles, typically a 3D scan or a model from a mesh tool. CivilKit CAD keeps each as a **reference mesh**: you can look at it and draw on it, but it does not become a solid. The four go the same way; what differs is what each file carries (see the table below the steps).

1. Drop the file on the window, or use **Open** or **Import**. Unlike the other formats, a mesh is added to the part you have open (it does not open a new tab), so it needs a part to be open. To bring an OBJ in with its colours, drop the `.obj` and its `.mtl` together.
2. A dialog shows what the file holds: triangles, vertices, size, and whether the surface is closed. STL and OBJ files have **no units**, so pick the one the file was made in (millimetres, centimetres, metres or inches). A GLB (always metres) and a 3MF (it states its unit) are converted to millimetres for you and the dialog says so instead of asking. The size line updates as you choose, and a hint appears when the size looks wrong (a model under 2 mm across is usually a file in metres). Tick **Move to the origin and sit on the ground** to place it at the origin; otherwise it keeps the file's own coordinates.
3. The mesh appears shaded, the view frames it, and a row for it appears in the feature tree with an **eye** (show or hide) and a pencil. A mesh of up to about a million triangles stays responsive.

**The Mesh panel** (click the row or its pencil): name, shown, **opacity** (lower it to see your sketch through the surface), colour, triangle edges, position, rotation and scale, quarter turns about X, Y or Z, **Move to the origin**, **Sit on the ground**, and **Delete mesh**. Changes show at once and are one undo step when you press **Done**; **Cancel** puts everything back. A scan is often Y up or Z up in its file: use the quarter turn buttons to stand it upright.

**Two ways to draw on it**

- **Sketch on mesh**: click a point on the surface. Then choose the plane of the sketch through that point: **Surface normal** (square to the surface there), or one of **Front**, **Top**, **Right** (parallel to the base planes). The ordinary sketch editor opens on that plane with the mesh still visible.
- **3D Sketch on mesh** (or the **3D Sketch** tool with a mesh in the part): clicks that land on the mesh snap to its surface, so a spline you click across the head lies on it. Points, ends and other sketch points still snap first. The tick **Draw on the imported mesh surface** turns this off. **Fit curves** resamples the lines, splines and control splines of the sketch into many points and puts each on the surface (**To the nearest surface point**, or **Along the work plane normal**), so the curve follows the surface between your clicks. The result is an ordinary 3D sketch feature.

| File | Read | Not kept (the dialog and a notice say which applied) |
|---|---|---|
| STL | Triangles, binary or text | Colours, textures |
| OBJ | Vertices and faces (negative indices, `v/vt/vn` forms, polygons cut into triangles), colours from the `.mtl` (`Kd`, `d` or `Tr`) when it is dropped with the file, and the `x y z r g b` vertex colours some tools write | Normals, textures, smoothing groups, lines, free-form curves. Several objects or groups are joined into one mesh. Without the `.mtl` there are no colours, and a notice says so |
| GLB | The scene's meshes with every node's transform, triangle lists (indexed or not), base colours and alpha of the materials. Metres and Y up become millimetres and Z up | Textures, colours per vertex, normals, animation and skinning (the model is shown at rest), lines and points. A GLB with Draco or meshopt compression, or with its data in a separate file, is refused with a message |
| 3MF | Objects, components and build items with their transforms, the model unit (converted to millimetres), colours from base materials and colour groups, models split over several files | Textures, colour gradients inside a triangle, print supports, slicer settings. Several build items are joined into one mesh |

A file that holds several objects comes in as **one** mesh (one row in the tree) with its colours kept; the parts cannot be moved apart afterwards. OBJ has no up direction: a model that lies on its back is stood upright with the quarter turn buttons in the Mesh panel.

**What is stored.** The mesh travels in the `.ckpart` as welded vertices and triangle indices, packed and compressed (about 1.2 MB for a 500,000 triangle scan; see [Imported meshes and STEP data in the file](files.md#imported-meshes-and-step-data-in-the-file)), with the vertices rounded to a grid of at most one micron. The browser's automatic backup keeps a mesh up to about 2 MB packed and otherwise leaves it out and says so, so save to a file. Save as to a new name, dragging the saved file back in, and inserting the part from a library all keep the mesh; exporting a folder's geometry or extracting a folder does not (those are bodies and features, not meshes). A mesh that is damaged in a file is left out with a notice and the rest of the part opens. The mesh is not sent to the kernel, is not counted in mass or volume, and is not in STL, STEP or other exports.

**Not done**: converting a mesh to a solid, remeshing or simplifying, mesh booleans, repairing holes (the dialog only reports them), colours or textures from an STL file, textures from any mesh file, importing the parts of a multi-part file as separate meshes, and constraints to mesh points.

## SolidWorks parts

SolidWorks part files (`.sldprt`) are read directly.

- **You get** the part with its **feature history** (sketches, extrudes, cuts, fillets, chamfers, holes, shells, patterns and revolves) when the kernel can rebuild it, and you can edit those features. A feature it cannot read back ends the history there, and the rest of the part is the file's exact solid as an imported body. A part it cannot rebuild at all opens as that solid alone. More parts now rebuild further than before, including chamfers along a chain of edges and fillets that end at a neighbouring feature. A part with a loft opens in about a second. The solid of the active configuration arrives as an **editable imported body** in a new part named after the file: the first feature of the tree is the body (written to the part as STEP by the kernel, so it is saved with the part). The notice says "Opened &lt;file&gt; (SolidWorks): N faces, as an editable body." The body has the volume and the box of the solid SolidWorks itself writes to STEP. If the part cannot be built from the solid (the check of its volume fails), the solid is shown view-only as before, with the notice "Imported &lt;file&gt; (SolidWorks): N faces. Imported bodies are view only and are not saved with the part."
- **Converted**: planar, cylindrical, conical, spherical and toroidal faces and spline surfaces. Some blend and intersection curves are approximated, and the import fails if an approximation is off by more than 0.05 mm.
- **History folder**: a SolidWorks history opens inside one **SolidWorks history** folder in the feature tree, with an eye toggle. Off shows exactly the file's body; on shows the rebuilt history. A partial history shows the rebuilt features followed by an **Imported remainder** row. Features you add after the **Imported body** step refer to the file's face names, so they may not survive switching the folder back on.
- **Units**: SolidWorks stores metres; the importer scales to millimetres.
- **Not read**: equations, configurations other than the active one, annotations and flat patterns. Sheet-metal parts arrive as the folded solid. Files with only sheet or wire bodies are refused.
- **Limits**: files with more than 50,000 faces are refused. The oldest tested file is from SolidWorks 2011 and the newest from 2022; newer files are untested.

If a file fails, save it as STEP from SolidWorks and import that instead. More detail: [SolidWorks](/docs/cad/kernel/io/sldprt.html).

## SketchUp

SketchUp files (`.skp`) are surface models made of flat faces, not solids.

The picture shows a SketchUp file imported with the default Reference mesh choice, with the chair and table test file from the OpenSKP project (MIT).

![A SketchUp file imported as a Reference mesh, with the chair and table test file from the OpenSKP project (MIT): the chair and table in the viewport in their SketchUp colours, the imported mesh listed in the feature tree as chair_and_table (mesh), and the open-surface warning in the status bar.](../img/import-skp.png)

- **You get**, with the default choice **Reference mesh**, a mesh added to the open part (like an STL, so a part must be open) with each face in its SketchUp colour and translucent materials kept translucent. Everything an STL mesh does works: **Sketch on mesh**, **3D Sketch on mesh** with **Fit curves**, opacity, move, turn and scale, show or hide, delete, and it is saved with the part. Choose **View only** for the old behaviour (a new part showing a body that is not saved). Texture images are not imported either way.
- **Units**: SketchUp stores inches and the importer converts to millimetres.
- **Orientation**: SketchUp is Z up and the app is Y up, so the model opens upright. The notice has a **Flip orientation** button that cycles through three views: upright, as in the file (Z up, so the model lies on its side here), and upside down. **Rotate imported model** in More file actions does the same while a SketchUp model is shown. For a mesh this sets its rotation (one undo step; the Mesh panel shows it), for a view-only body it imports the file again.
- **Hidden geometry** is left out by default, and the notice says how many hidden faces were skipped, with a **Show hidden geometry** button (for a mesh it replaces the mesh, keeping where you put it). The box has an **Include hidden geometry** tick, and **Import SketchUp with hidden geometry** in More file actions opens it ticked.
- **Open surfaces**: if the model is not closed, the notice warns ("SketchUp surface model: N open edges; solids operations may not apply"). A closed model has volume; an open one does not.
- **Not imported**: scenes, cameras, text, dimensions, construction lines, true arcs (curves become many short flat faces), and styles other than face colours.
- **Limits**: as a mesh there is no practical face limit (the limit is 5,000,000 faces and the mesh is stored compactly); as a view-only body, models over 50,000 faces are refused ("limit.faces"). A file with no faces, or with everything hidden, is refused ("body.empty"). Reading a very large file is the kernel's work and takes seconds (a 39,000 face model took about 8 seconds on a busy machine); building and drawing the mesh afterwards is quick.

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
- **Parameters**: the named parameters of the file become the part's variables, so you can change one and the part follows. A field written as a name or an expression over them (an extrude depth, a hole or sphere size, a fillet radius, a chamfer or shell thickness, a revolve angle, a sweep twist, a pattern spacing, a cylinder height) stays an expression, and so does a sketch dimension that names a parameter. The expressions may use `+ - * / ^`, `pi`, and the functions `sqrt`, `sin`, `cos`, `tan`, `abs`, `min`, `max`, `pow`, `mod`, `hypot`, `atan2`, `asin`, `acos`, `atan`, `round`, `floor`, `ceil`, `trunc`, `exp`, `ln` and `log10`. What the part cannot hold (a parameter whose name it cannot take, such as `sin` or `mm`) is kept as the number it evaluates to, and the row of that feature says so. Other fields, such as a box size or a position, are plain numbers.
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

## SVG

An SVG file (`.svg`) brings 2D drawing geometry into a sketch, the same way a DXF does. It does not make a part.

- **Into the sketch you are editing**: while a sketch is open, choose **Import SVG into sketch** (Home tab, Sketch group), or drop the file onto the window.
- **As a new sketch**: choose **New sketch from SVG**, in the new-sketch menu of the Home tab. The sketch goes on the selected face or plane, or on the front plane when nothing is selected. Dropping an SVG with no sketch open does the same.
- **Read**: paths (lines, arcs and curves, written absolute or relative), rectangles (also with rounded corners), circles, ellipses, lines, polylines and polygons, inside groups and with any transform (move, scale, rotate, skew). A shape that is defined once and reused with `use` is placed wherever it is used.
- **How curves arrive**: straight lines stay lines and circular arcs stay arcs, circles stay circles and ellipses stay ellipses, also after the drawing is rotated or mirrored. Bezier curves become splines that follow the curve exactly; an elliptical arc becomes a short chain of splines. A closed outline (a path ending in `Z`, a rectangle, a circle) closes in the sketch, so you can extrude it, and an outline inside another one cuts a hole.
- **Size**: the file's width and height in millimetres, centimetres, inches or points, together with its viewBox, set the size. SVG's Y axis points down and the sketch's points up, so the drawing is turned upright and its lower left corner is at the sketch origin. A file with no size in those units is read at 96 pixels to the inch (1 px = 0.2646 mm) and a notice tells you; check the dimensions of the result.
- **Not read**, and listed in a notice: text (convert it to outlines in your drawing program first), images, scripts and other elements. Fills, strokes, gradients and styles are ignored. Shapes that use a clip path, mask or filter are imported whole, and the notice counts them. Shapes drawn twice on top of each other are imported once.
- **Safety**: the file is only read as drawing data. Scripts are never run and nothing is fetched from other addresses; a file that declares entities is refused.
- **Limits**: more than 20,000 entities, a file over 10 MB, and coordinates further than 1,000,000 mm from the origin are refused with a message. No constraints are added, and the origin is kept as drawn.

## Parts from samples and the library

**Library** (top bar) opens a sample part as a new part, fully editable. Parts from a library, and the Catalog, are added to the part you have open as ordinary features in one undo step; they are not imports of a file. See [The Library](../library/library.md).

To use another saved part inside an assembly, see [Assemblies and mates](../assemblies/assemblies.md).

## The import report and repair

An import that brings in every part as a solid has nothing to report. When it does not, a notice says what became of the parts ("2 of 3 parts came in as solids. 1 came in as surface bodies of the faces that could be read and need repair before they can be modelled on.") and offers **Import report**. The same report is behind the **Diagnostics** tab of the drawer (press **\\**, choose Diagnostics): the import step gets a warning that says how many parts came in as surface bodies, with **Import report** and **Repair** buttons.

1. Press **Import report** in the notice or in the Diagnostics warning.
2. Read the summary, then one row per part of the file: **Solid (42 faces)**, **Surface body: 31 of 42 faces, needs repair**, or **Not imported: none of its 60 faces could be read**. Under a part that is not a solid, each reason is the kernel's own sentence with its code and the faces concerned (six faces are named, then "and n more").
3. Press **Repair** to fix what can be fixed, or **Close**.

**Repair** adds one undoable repair step after the import (listed in History as **Repair**): it rebuilds the faces that could not be read on their own surface, sews small gaps and fills flat holes. A notice then says how it went: "repaired into a solid (3 faces rebuilt, 1 gap sewn, 2 holes filled)", "still a surface body after repair (...)", or "not repaired: ...". A repair the kernel refuses is not added to the history and the notice gives its reason. Undo removes a repair like any other step.

A file that came in **view only** is repaired the other way round: **Repair** first makes it an editable part (the solid as imported is kept inside it) and then adds the repair step. The report says so before you press the button. This applies to STEP, SolidWorks and SketchUp files that came in as a view-only body.

### Common problems

| Symptom | Fix |
|---|---|
| No Import report after an import | Every part came in as a solid, so there is nothing to report |
| A part says "Not imported" | None of its faces could be read. Fix the file in the source program and import it again |
| Repair says "not repaired" | The kernel's reason follows the colon. The step is not added, so nothing has changed |
| Repair left a surface body | The remaining faces are listed in the notice. Repair what is left, or rebuild those faces yourself on top of the import |
| The report is gone | Open it again from the Diagnostics tab of the drawer |

## When an import is slow or fails

- **Wait for the overlay.** A large STEP or SolidWorks file can take seconds and a large SolidCraft file minutes. A busy overlay with a cancel button is shown, and nothing else is changed until it ends.
- **A notice names the cause.** "Could not import &lt;file&gt;: ..." gives the reason or the error code. Read the notice before trying again; the Console tab of the drawer keeps recent notices.
- **Nothing to import.** STEP with no solid, SketchUp with no visible faces and FreeCAD with no PartDesign body are refused. Check the source model has a solid and that nothing is hidden.
- **Too large.** Over 50,000 faces for SolidWorks and SketchUp. Simplify the model in the source program or split it.
- **Wrong size.** Imports apply the file's units. If the part is 25.4 times too big or small, the units in the source file were wrong; fix them there.
- **Gaps or open edges** on a STEP or SketchUp import mean the surface is not closed. Fix it in the source program, or run it through STEP export. When parts come in as surface bodies rather than solids, the **Import report** lists them and **Repair** tries to rebuild them: see [The import report and repair](#the-import-report-and-repair).
- **Imported but a feature is missing** (FreeCAD, SolidCraft): look at the notice and at the tree. Placeholder rows are suppressed; the rest is real. You can rebuild the missing features yourself on top of what came in.
- **Still stuck?** [Troubleshooting](../reference/troubleshooting.md) has more.

## Next

- [Exporting](export.md)
- [File formats at a glance](formats.md)
- [Sketch tools](../sketching/tools.md)
- [Limits and known gaps](../reference/limits.md)
