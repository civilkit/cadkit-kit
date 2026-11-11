# Sheet metal

The **Sheet** tab (ribbon, command search, tool palette) makes sheet metal parts: a plate from a sketch, bent flanges, hems and folds,
the flat pattern, and the files a laser or press brake shop asks for. The kernel does the work (its description of the wire shapes and the
arithmetic is `docs/sheet-metal.md` in the kernel repository); this page is about the interface. Code: `apps/cad/src/sheet/`.

## The tab

| Group | Commands |
|---|---|
| Rules | **Rules**: the one rules editor (thickness, k-factor, bend radius, relief settings) |
| Create | **Base flange**, **Edge flange**, **Contour flange**, **Convert to sheet**, **Hem**, **Fold**, **Cut**, **Corner** |
| Flatten | **Unfold**, **Refold**, **Flat pattern** (the view) |
| Export | **Flat pattern DXF** (with options), **Bend table (CSV)**, **Bend table (JSON)** |

The tab is always in the ribbon, like Frame and Surfaces. A part that gets its first plate opens on it; it is a suggestion, not a mode:
the other tabs stay as they are. Commands that cannot run say why in their tooltip (no plate yet, the sheet is unfolded, no edge picked).
While a feature editor is open the model commands are greyed like on every tab; the flat pattern view and the exports are not, because
they only read the sheet.

## Making a part

1. **Rules.** A part without a rule gets one when you make the base flange: 2 mm, k-factor 0.44 ("Sheet 2 mm"). **Rules** opens the rule
   of the part (the selected rule in the tree, else the active one, else the last); on a part with none it adds one. The form has two
   sections:
   * *Stock*: name, thickness, k-factor, bend radius, and "Use for the next base flange" (the active rule).
   * *Relief*: relief width and depth, corner relief and its shape (notch, round, rectangular, tear), the gap between flanges and the hem gap.
     A field left empty follows the thickness (bend radius = thickness, relief width = thickness, relief depth = thickness / 2, corner
     relief = 4 x thickness); **Follow the thickness again** clears them. Inside a rule a field may be an expression of the rule's own
     thickness: `=Thickness*2`. The corner shape is stored; the kernel builds and unfolds every corner as a notch for now (the form says so).
2. **Base flange.** Needs a closed sketch (the selected one in the tree, else the last; holes inside it are allowed). One per part, and it
   is the first body feature. The form has the profile sketch, the rule (the active one or one by name) and "Build on the other side".
3. **Edge flange.** Select an edge of the plate (edge mode, E) and run the command; the new flange is 10 x thickness high. In the editor
   the edge list is the usual one (chips with a count, **Use selection**, each click adds or removes an edge until **Done**). A flange
   bends towards the face its edge was picked on: the top edge (the cap side) bends up, the bottom edge down; **Flip direction** reverses.
   The other fields: height, angle (the angle the leg turns through, default 90), bend radius, where the height is measured to (the outer
   sharp, the inner sharp or the end of the bend) and the flange position (inside the outline, outside, middle). **Chained bends** adds
   further bends after the flange, each with its own angle, height and flip (up to 16), for a return lip or a Z. The editor also has
   **Width**, **Shape**, **Holes** and **Relief** sections: see "Part of an edge and shaped legs" below.
4. **Contour flange.** An open chain of sketch lines becomes the plate, bent at every corner and extruded by a distance (default 50 mm).
   Untick lines to leave them out; "Material on the other side of the line" and "Extrude against the sketch normal" flip the two sides.
   Needs an open chain and no plate yet.
5. **Hem.** Select an edge and run the command: a 180 degree fold 5 x thickness long with the rule's hem gap. Length and gap in the editor.
   Hems on neighbouring edges are refused by the kernel, and so is a hem next to an edge flange. A hem can cover part of its edge too (the
   **Width** section, below); it has no shaped leg and no holes.
6. **Fold.** Bends the plate along a sketch line (the last line of the last sketch other than the plate's own outline; choose the sketch
   and line in the editor). The fold angle, the radius, where the line sits in the bend (centre, start, end, outer sharp) and a flip. The
   bend follows the sketch line when the sketch changes. A fold and an edge flange or hem cannot share a base yet (the kernel says so).
7. **Unfold / Refold.** Unfold turns the body into the flat sheet; flanges, hems and folds wait until **Refold**. Both are one edit with no
   editor. Unfold then Refold gives the same solid back.
8. **Convert to sheet.** On a part with a solid bent plate and no sheet yet (a thin-wall extrude with round bends, say), **Convert to sheet**
   turns the solid into a sheet: panels, bends, flat pattern, bend table and DXF. The editor has the thickness (empty: the kernel reads it
   from the body, the gap between its facing flat faces; **Use ... of rule X** fills in the active rule's thickness) and the rule that supplies
   the k-factor (the active one by default; the command names it). The converted rule is called "Converted" and becomes the active one.
   After it the part is a sheet: edge flanges, hems, folds, cuts and corners work on it, and the base flange and contour flange are off. The
   kernel refuses a body that is not a constant-thickness chain of flat panels and straight round bends (sharp corners between panels, cones,
   embossing, reliefs), and one whose rebuilt sheet differs from the body by more than 1 % of the volume; the card says which.
9. **Cut.** Cuts the closed regions of a sketch out of the sheet *through the flat pattern*, across bends too: a slot over a bend shows in the
   flat pattern and the DXF as a hole across the bend zone (layer `CUT_INNER`), and the bent solid loses the matching wedge of the bend.
   Draw the sketch on the plane of the base or one parallel to it: its coordinates are flat coordinates (so read the position off the flat
   pattern, not off a folded flange). The command takes the selected closed sketch, else the last one that is not a plate outline or a cut already.
   The editor is the profile picker plus **Shapes**: tick the regions to cut, or click them in the view. A region that misses the sheet,
   removes or splits a panel, or holds an island is refused with the kernel's reason (for example "the cut removes the whole panel P0").
   Rectangular cuts along and across a bend are exact in the solid; other outlines across a bend are a staircase of small wedges (the flat
   pattern is exact).
10. **Corner.** Select one or more corners (vertex mode, V) of a free panel corner and run **Corner**: a round of three thicknesses by
    default. In the editor the corners are chips (**Pick in view** switches the view to vertex picking, click to add, click again to take
    one out, **Done**), the treatment is **Round** (radius) or **Chamfer** (distance; the size carries over when you switch). Both walls
    of the corner must be free of bends, the corner convex, and the walls at least as long as the radius (or the distance); a corner next
    to a bend is refused ("the corner of panel P0 touches the bend side e1"). The round is a true cylinder face in the solid and an arc in the DXF.

**Part of an edge and shaped legs.** The **Edge flange** editor (and, for the width and relief, the **Hem** editor) can limit a flange to part
of its edge and give its leg another outline than a rectangle. The fields are the kernel's (its `docs/sheet-metal.md`, stage 5); the forms
write them on the feature, or, when the single picked edge already carries them (the SolidWorks importer writes them on the pick), on that
pick, so an imported flange opens with its fields shown and keeps its outline and holes when other fields are edited. Several edges that
each carry a width of their own are flagged, and **Use one width for all** clears them.

* **Width.** *The whole edge* (default), *Start and length*, or *Between two points*. Start counts along the picked edge from its start vertex
  (the outline runs anticlockwise, so Start is the left end seen from inside the sheet) and Length is how far the flange runs from there;
  both take expressions. *Between two points* has the two points as `x, y, z` text, or **Pick two points**: click the first and the second
  point in the view (a click beside the picked edge lands on it; the kernel projects the points onto the edge anyway). The preview shows the
  flange on the chosen part as soon as the numbers are in. A hem has *From a start to the end* (no Length: its length is the hem's size) and the
  two points. The span must lie inside one free piece of the edge; after a partial flange the edge is split and a later pick names the piece it is
  nearest to (use two points for positions that do not depend on that).
* **Shape.** *Rectangle* (default: as wide as the flange, as high as Height), *Sketch outline* or *Imported outline* (only shown for a flange
  whose file gave an inline outline of lines and arcs). **Sketch outline** takes a sketch from the list: its outer loop is the leg. In the sketch
  x runs along the flange (from the start of the span) and y outward from the height line, and the lower left corner of its box is the start of
  the leg; circles inside the outline are holes. **New sketch for the outline** makes such a sketch for you: a plane through the flange (a
  Reference plane in `frame` mode, put before the flange and named "Flange plane") with x along the flange and y outward, the default leg
  drawn on it as a rectangle, the flange pointed at it, and the sketcher opened on it; confirm the sketch and the flange follows it. If the
  leg's frame cannot be read the sketch is on the Front plane and says so (the outline is placed by its numbers, not by where it is drawn).
  The plane is fixed (it does not follow the edge if you move the plate), and the span is pinned to two points in the sketch's direction.
  **Edit the sketch** applies the draft and opens the sketcher. With an outline, the height is the top of the outline and the Height field is
  not used. **Convert to an editable sketch** (an imported outline) makes the same kind of sketch of the imported lines and arcs, with its
  circle holes as circles, and points the flange at it. A sketch outline always starts at the bend line (its box's lower left corner is the
  origin), so an imported outline that starts above it, at the end of the bend as SolidWorks outlines do, is carried down to it through its
  straight bottom edge (the kernel takes the part below the end of the bend as the bend, so the leg is unchanged); one that starts beside the
  start of the flange or has no straight bottom edge on the end of the bend cannot be carried over without moving and stays an imported outline
  (the form says how far it would move). The kernel measures a sketch outline along the edge from the first point of the span to the second
  and cannot cut an outline whose span runs against the edge's direction; the editor therefore builds the flange both ways when it makes a
  sketch (the second time with the outline mirrored and the two points swapped) and keeps the first that builds.
* **Holes.** Only with an outline. Circles of the leg by centre (along, outward) and radius, **Add a hole**, **Remove**; an outline that is a
  loop of segments is listed and kept. **Circles of a sketch** lists the circles of a sketch (the outline's own, or another) to tick into the
  holes, measured from the lower left corner of the outline sketch; a circle inside the outline sketch is a hole already and is shown ticked
  and fixed (listing it twice makes two coincident cylinders, which the kernel refuses). Holes must lie beyond the end of the bend.
* **Relief.** Shown for a flange that covers part of its edge: *None (only the notch)*, *By the rule* (the rule's relief width x depth, shown in
  the list) or *My own size* (width and depth, each starting from the rule's): a rectangle cut into the plate beside each end of the flange that
  stops inside the edge. Not made where the flange reaches a corner.

**Panels.** Once the sheet has more than one panel (a flange, a fold or a converted bend), the **Edge flange** and **Hem** editors get an
*Edge of a panel* section: choose the panel (P0 is the base plate, then the legs in the order made), then one of its walls as the kernel
names them (`tip` the free end, `side.start` and `side.end`, or the walls of a converted or folded panel such as `side.w6`) or an edge by its
number in the panel's outline, and **Add this edge**. The edge joins the others in the chips list (`P2.tip`, `P1 edge 3`). The **Fold** editor
gets a **Panel** list (Automatic or P0, P1 ...) for a fold line on a folded panel. With a single panel the lists are not shown.

Every command makes one edit (one undo step) and opens the Editor on the new feature with a live preview, Confirm and Cancel. The
features appear in the tree as Sheet metal rules, Base flange, Edge flange, Contour flange, Hem, Fold, Unfold and Refold, each with its own icon.

## The flat pattern

**Flat pattern** opens a panel with the drawing of the blank: the outline and the holes, the bend zones (light), each bend line dashed
with its number and angle (one colour for up bends, another for down bends), and the width and length of the blank. Under it: the size
and thickness, the rule and k-factor, the number of holes, and a row per bend (direction, angle, radius, allowance, length). It follows the
document, and while a feature editor is open it follows the draft, so a changed height or radius shows in the flat pattern at once.
The panel carries the three exports. Esc closes it.

## Export

* **Flat pattern DXF** asks for the options and writes `<part>-flat.dxf`: version (R2000 or R12), units (mm, cm, m, in, ft), layers
  by role or everything on layer 0, layer names (`CUT_OUTER` / `CUT_INNER`, or `OUTLINE` / `CUT`), the bend lines, the tangent lines
  (both ends of each allowance) and bend notes (`B1 UP 90 R2`, with a text height). The last choice is remembered.
* **Bend table (CSV / JSON)** writes `<part>-bends.csv` or `.json`: one row per bend with angle, direction, radius, allowance, length and
  the line in flat coordinates.

Both are made by the kernel from the flat pattern of the current document (`sheetDxf`, `sheetBendTable`); a refusal names the field.

## Adding a sheet metal command

Every command is one entry of `SHEET_COMMANDS` in `sheet/sheetCommands.ts`: an id, a group, when it is enabled (a function of the document
and the selection) and either the edit it makes (`ops`, then the Editor opens on the new feature), an edit applied without an Editor
(`applyOps`), or a `run`. `registerSheetCommand(def)` adds one from another module. The ribbon appends a command its layout does not place
to the tab and group the entry names, and the command search lists it, so a new tool needs its entry, its strings (`cmd.<id>`,
`tip.<id>`, `why.<id>`), an icon and, for a new feature type, an options form in `sheet/SheetOptions.tsx` plus its fields in `sheet/options.ts`.
A command that picks vertices (Corner) reads the selection (`v:x,y,z` names) and its editor switches the view to vertex picking; a feature that
cuts a sketch uses the generic profile picker and the Shapes list (`sheetCut` is listed with `extrude` and `revolve` in `FeatureEditor`).

## Not done

* A sketch made from the editor is on a fixed plane; **Pick two points** takes points of the surface under the click (projected onto the
  picked edge), not a snapped vertex. The width section does not edit one width per edge: spans carried by several picks are shown as a note.
* An outline that starts beside the flange's start or has no straight bottom on the end of the bend cannot be converted to a sketch; a hole of
  a loop with arcs is kept but not editable.
* The fold's `fixed` side (which side stays) is in the kernel but has no control; a flange pick is a point on the edge (resolved to the nearest
  wall of the folded sheet), a role or a ring edge of a panel.
* A corner is picked as a world point (the nearest panel vertex wins); `{ panel, vertex }` picks written by hand are kept and shown, not made.
* A cut across a bend does not follow the sketch onto folded panels (use a sketch parallel to the base plane), and does not split panels.
* A fold given by two points (`points`) is kept when a file has one but cannot be made from the interface; pick a sketch line.
* Edge flanges after a fold, flanges on contour flange walls and arcs in the chain: not supported by the kernel yet.
* The flat pattern drawing is a view; it cannot be dimensioned or put on a drawing sheet yet.
* The feature types are registered with the part model at load (`sheet/register.ts`) because the TypeScript part-model package does not
  list them yet; the registration does nothing once it does.
