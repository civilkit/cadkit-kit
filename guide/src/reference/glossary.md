# Glossary

Terms you will meet in the app and in this guide, in alphabetical order. Where a chapter covers the idea in depth, the entry links to it. For the technical meaning of a term inside the geometry kernel, see [the kernel glossary](/docs/cad/kernel/reference/glossary.html).

**Assembly** A part document that holds other parts as components and relates them with mates. The ribbon opens the **Assembly** tab for such a document. See [Assemblies and mates](../assemblies/assemblies.md).

**Autosave** A backup of the open part that the app keeps in the browser while you work. It is not a substitute for saving a file. See [Install as an app and work offline](pwa.md).

**Body** One connected solid piece of the model. A part can hold several bodies, for example two blocks that do not touch. You can select a body as a whole in **Body** pick mode. See [Bodies and combining](../modelling/bodies.md).

**Bore** A round hole through the middle of a part, such as a shaft hole in a gear or a propeller hub.

**Catalog** The side-panel tab with ready-made shapes and parts that you drop onto a face. See [Catalog parts](../library/catalog.md).

**Chamfer** A flat bevel that replaces a sharp edge. See [Fillets, chamfers, shells and drafts](../modelling/edges.md).

**Command search** The pop-up opened with **F** that finds any command by name and shows its shortcut. See [Commands and shortcuts](commands.md).

**Component** A part placed inside an assembly. A component can be fixed in place or free to move until mates hold it. See [Assemblies and mates](../assemblies/assemblies.md).

**Configuration** A named set of variable values. Choosing one switches the variables to its values and rebuilds the part. See [Equations and variables](../modelling/equations.md).

**Constraint** A relation inside a sketch, such as horizontal, tangent or equal, that the sketch solver keeps true when you change something. See [Constraints and dimensions](../sketching/constraints.md).

**Construction geometry** Sketch lines and curves that guide the drawing, such as a revolve axis, but do not form part of the outline. See [Sketch tools](../sketching/tools.md).

**Cosmetic thread** A thread shown and described on a hole or a cylinder without modelling the helix. It is quick to rebuild. A **modelled thread** has the real helix and is slower. See [Holes and threads](../modelling/holes.md).

**Cut** A feature that removes material, such as **Extruded cut**. See [Extrude, revolve, sweep and loft](../modelling/solids.md).

**Datum** A reference plane, axis or point you add to build on, such as a **Plane** or **Axis** feature.

**Dimension** A sketch constraint that fixes a size or distance to a value, such as a length or a radius. See [Constraints and dimensions](../sketching/constraints.md).

**Draft** A small taper on a face, so that a moulded or cast part can be released from its mould. See [Fillets, chamfers, shells and drafts](../modelling/edges.md).

**Edge** A line or curve where two faces meet, or the boundary of a face. Edges are what **Fillet** and **Chamfer** work on. See [Selecting things](../getting-started/selection.md).

**Exploded view** An assembly display that moves components apart so you can see each one. It is a view setting and does not change the model.

**Extrude** A feature that pushes a sketch profile along a direction to make a solid. See [Extrude, revolve, sweep and loft](../modelling/solids.md).

**Face** A bounded piece of the surface of a body, such as the top of a block or the wall of a hole. Faces are what you sketch on and what **Shell** opens. Each face has a persistent name so later features can keep referring to it.

**Feature** One step in building a part: a sketch, an extrude, a fillet, a hole, a pattern, a plane and so on. Features run in order from the top of the feature tree to the bottom. See [The feature tree and history](../modelling/history.md).

**Feature tree** The list of features in the left panel. It shows the order of building, which features failed, and what depends on what. Also called the history.

**Fillet** A rounded blend that replaces a sharp edge. See [Fillets, chamfers, shells and drafts](../modelling/edges.md).

**Fully defined** A sketch is fully defined when its constraints and dimensions leave nothing free to move. The sketch status shows whether it is fully defined. See [Constraints and dimensions](../sketching/constraints.md).

**Ground plane** The horizontal reference plane for the current up axis. It is Top when Y is up and Front when Z is up. The first body of a catalog drop sits on it.

**Handle** A small arrow or dot in the viewport that you drag to change a size, a depth or a radius. See [Moving things: the move / rotate ball and handles](../modelling/transforms.md).

**Interference** An overlap between bodies or components. The **Interference check** command finds overlaps. See [Measure and inspect](../analysis/measure.md).

**Kernel** The geometry engine that builds, measures and checks solids. It runs inside your browser, or as a local service on your computer. See [The local kernel service](../automation/local-kernel.md).

**Library** A source of parts you can drop into a model: the bundled samples, the parametric catalog parts, and libraries you add. See [The library and samples](../library/library.md).

**Loft** A feature that joins two or more sketch profiles with a smooth solid. See [Extrude, revolve, sweep and loft](../modelling/solids.md).

**Mass properties** The volume, surface area, centre of mass and mass of a body, computed exactly from its faces. The mass uses the part's material. See [Measure and inspect](../analysis/measure.md).

**Mate** A relation between two components of an assembly, such as coincident, angle or hinge, that fixes some of their relative motion. See [Assemblies and mates](../assemblies/assemblies.md).

**Mesh** The triangles the app draws. The exact solid is turned into a mesh for display. Sizes and volumes come from the exact solid, not from the mesh.

**Move / rotate ball** The ball you place on a selection (**F10**) to move, turn and copy it. See [Moving things: the move / rotate ball and handles](../modelling/transforms.md).

**Part** One document, saved as a `.ckpart` file, that holds a list of features and builds a model. Files saved by earlier versions still open. See [Saving and opening](../files/files.md).

**Pattern** A feature that repeats other features in a line (**Linear pattern**) or around an axis (**Circular pattern**). See [Patterns, mirror and scale](../modelling/patterns.md).

**Persistent name** The stable name of a face or edge, such as `F2.C1`. Because it comes from the feature that made it, later features that use it keep working after you edit earlier ones.

**Profile** A closed outline in a sketch that a feature uses, for example the outer rectangle and the circles inside it. An outline with gaps is not a profile, and the app says "the sketch is not a closed outline". See [Starting a sketch](../sketching/start.md).

**Rebuild** Running all the features again, from the top, to produce the model. The app rebuilds after most edits, and the **Rebuild** command forces it. Also called regeneration.

**Reference plane** One of the three standard planes (**Front**, **Top**, **Right**) or a plane feature you add. Sketches sit on planes and on flat faces. See [Starting a sketch](../sketching/start.md).

**Revolve** A feature that spins a sketch profile around an axis to make a solid. It needs a construction line for the axis. See [Extrude, revolve, sweep and loft](../modelling/solids.md).

**Rollback** Moving the build point back up the feature tree, so the model shows only the features above it. **Roll forward** returns. Features below the marker are kept but not built. See [The feature tree and history](../modelling/history.md).

**Section view** A cut-away display that shows the inside of a body at a plane. It is a view setting. See [Measure and inspect](../analysis/measure.md).

**Shell** A feature that hollows a body, leaving walls of a chosen thickness and opening the faces you select. See [Fillets, chamfers, shells and drafts](../modelling/edges.md).

**Size box** The box of handles shown around a selected shape, for resizing and moving it. See [Moving things: the move / rotate ball and handles](../modelling/transforms.md).

**Sketch** A flat drawing of lines, arcs, circles and curves on a plane or a face, with constraints and dimensions. Features turn sketches into solids. See [Starting a sketch](../sketching/start.md).

**Solver** The part of the app that moves sketch points so the constraints and dimensions are satisfied. See [When a sketch will not solve](../sketching/troubleshooting.md).

**Suppress** Switch a feature off without deleting it. A suppressed feature is skipped on rebuild, and features that depend on it fail until you **Unsuppress** it. See [The feature tree and history](../modelling/history.md).

**Surface** A face or group of faces with no thickness, not a closed solid. You can build surfaces, trim and knit them, and **Thicken** them into solids. See [Surfaces](../modelling/surfaces.md).

**Sweep** A feature that moves a profile along a path to make a solid. See [Extrude, revolve, sweep and loft](../modelling/solids.md).

**Thin feature** An extrude or revolve that makes a wall of a set thickness instead of a filled solid.

**Tolerance** A distance below which two things are treated as the same. It matters when files from other programs have tiny gaps, and when two bodies almost touch. The check tools report problems that exceed it. See [Checks and diagnostics](../analysis/checks.md).


**Valid** A body is valid when the check finds no open edges, bad orientation or other defects. A feature can build and still produce an invalid body. See [Checks and diagnostics](../analysis/checks.md).

**Variable** A named value, such as a width, that features use through an expression and that you edit in the **Variables** tab. Changing it rebuilds the part. See [Equations and variables](../modelling/equations.md).

**View-only body** A body from an imported STEP, SolidWorks or SketchUp file. You can look at and measure it, but it is not a feature of the part and is not saved with it. See [Importing](../files/import.md).

**Wizard** A guided panel that builds a whole part from a few parameters, such as the gear, propeller and impeller wizards. See [Parametric wizards](../library/wizards.md).

## Next

- [Commands and shortcuts](commands.md)
- [Limits and known gaps](limits.md)
- [Your first part](../getting-started/first-part.md)
