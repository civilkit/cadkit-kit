# Surfaces

A surface is a sheet: it has faces and edges but encloses no volume. You build surfaces when a shape is easier to describe by its skin than by a solid, then trim, join and thicken them. This chapter covers the commands on the **Surfaces** tab, how sheets show in the view, and the tools that check a surface.

## Surface bodies

A feature that makes a sheet leaves a **surface body**. Surface features are Planar surface, Extruded surface, Revolved surface, Lofted surface, Trim surface, Fill surface, Extend surface, Pipe cut, a Knit that is not made into a solid, and Delete face on a solid. A surface body is named after the feature that made it.

How sheets look and behave:

- Sheets are drawn with a cool teal tint so you can tell them from solids. Both sides are lit.
- You can pick the faces and edges of a sheet exactly as for a solid, including the border edges (one face) that Fill and Extend use.
- **H** hides the body that holds the selection (a sheet or the solid), and **Alt+H** (Show all) brings everything back. Hiding is for the view only and is not saved.
- Mass properties and interference counts solids only. A part with no solid reports that sheets have no volume or mass. See [Measure and inspect](../analysis/measure.md).
- A section view clips sheets, but a sheet has no inside, so the cut is not capped.

![The Surfaces tab of the ribbon with a wavy extruded surface standing on a plate, tinted teal, and the Create and Edit groups visible.](../img/surfaces-tab.png)

## Where the commands are

| Group | Commands |
|---|---|
| Surfaces > Create | **Planar surface**, **Extruded surface**, **Revolved surface**, **Lofted surface**, **Sweep surface**, **Blend surface** and **Fill surface** (Shift+I), each its own button |
| Surfaces > Edit | **Offset surface**, **Extend surface** (Shift+X), **Trim surface**, **Knit**, **Thicken** and **Freeform**, each its own button |
| Features > Modify | **Pipe cut** |
| Features > Bodies | **Delete body** and **Delete face** |

Each command makes its feature at once, opens the Editor with a live preview, and is one undo step. A command that has nothing to work on says "Nothing to build this feature from: pick what it needs first", or is greyed with a tooltip.

## Making a sheet

| Command | Needs | Defaults |
|---|---|---|
| Planar surface | A closed sketch: the one selected in the tree, else the last that fits | A flat sheet filling the sketch |
| Extruded surface | A sketch with curves, open or closed | Blind, 10 mm |
| Revolved surface | A closed sketch with a construction line as the axis | 360 degrees about the first construction line |
| Lofted surface | Two or more sketches, open or closed, all of one kind | As Loft, with Make a surface on. See [Extrude, revolve, sweep and loft](solids.md#loft) |
| Sweep surface | A profile and a path: the path is the open sketch or curve selected in the tree (else the last open sketch), the profile the closed sketch before it | The profile follows the path, no caps, 0.001 mm tolerance. See [Sweep surface](#sweep-surface) |
| Blend surface | Two picked faces | A ball one tenth of the smallest dimension of the model, along the edge the faces share. See [Blend surface](#blend-surface) |

An open sketch extruded as a surface gives a wall you can thicken later. The Editor for an Extruded or Revolved surface shows the sketch, the End condition and the Depth or Angle. A sheet made by sweeping a profile along a path is **Sweep surface**, below.

## Sweep surface

Sweep surface moves a profile along a path and keeps the sheet it sweeps. The sheet is kept as its definition, so it follows the profile and the path when they change. A path that is an offset curve or a composite curve is swept along its definition. Use it for a tube, a pipe wall, a swept trim or any surface that follows a rail.

1. Make the profile and the path as sketches, or as curves (see [Curves on faces](curves.md)).
2. Select the path in the tree, then choose **Surfaces > Create > Sweep surface**.
3. Check the **Profile** and **Path** in the Editor, set the **Frame**, and press **Enter**.

| Option | What it does | Default |
|---|---|---|
| Profile, Path | A sketch, or a curve feature (including Offset curve, Composite curve and a helix). A list of curves written by a script is shown as it is, with a button to go back to a plain choice. | The selected path, and the last closed sketch |
| Frame | **Follow the path** turns the profile with the path. **Keep orientation** carries it along without turning, so every section stays parallel to the first. | Follow the path |
| Up direction | Follow the path only. Automatic uses the normal of the plane of a flat path, else the world axis furthest from the path. Or choose a world axis or a vector. It must never run along the path. | Automatic |
| Cap the ends | Shown when the profile is a closed sketch: a plane face closes each end, so the sweep is a closed shell that Knit can make into a solid. | Off |
| Tolerance, Gap tolerance (Advanced) | How closely the sweep is converted to a spline, and the largest gap between curves of a profile or path made of several pieces. | 0.001 mm, 0.00001 mm |

The sheet is one face (`W`), and with caps two more (`C0` at the start, `C1` at the end). A closed profile or a closed path gives a seam instead of an open side; both closed (a circle round a circle) give a closed sheet. To make a solid, turn caps on (or sweep a closed profile round a closed path), then choose **Knit** with the solid option.

The Editor warns when there is no profile or no path, when both are the same curve, and when a tolerance is not above 0. A refusal says why and what to change:

| The kernel says | What to do |
|---|---|
| The up direction runs along the path | Choose another up direction, leave it Automatic, or use Keep orientation |
| The profile reaches past a bend of the path (the surface folds) | Use a path with a larger bend radius, or a smaller profile |
| The sweep has no area | The path has no direction at one point, or the profile runs along the sweep direction. Turn the profile away from the path |
| The ends cannot be capped | Caps need a closed, flat profile. Turn them off |
| Curves do not meet, or are not one chain | Close the gap in the sketch, list the curves in order, or raise the gap tolerance |

## Blend surface

Blend surface rolls a ball between two faces and keeps the surface it leaves: a round or a fillet as a sheet of its own, along the edge the faces share or between two points. Its radius can change along the way. The sheet is kept as its definition and follows the faces when they change.

1. In Face mode (**F**) pick the two faces.
2. Choose **Surfaces > Create > Blend surface**.
3. Set the **Radius** and the **Which side** of each face, then press **Enter**.

| Option | What it does | Default |
|---|---|---|
| Blend between | The two faces, with Use selection. They may be faces of the part or of a surface. | The first two picked faces |
| Radius | The radius of the ball. | One tenth of the smallest dimension of the model |
| Vary the radius, End radius | The radius changes in a straight line along the span, from the Radius at its start to the End radius. | Off |
| Which side | For each face, the side the ball lies on. **Flip** moves it to the other side of that face; **Each face toward the other** goes back to the automatic choice. | Each face toward the other |
| Span | **The shared edge** (the one nearest a chosen point when the faces share several), or **Two points**: the blend runs along the line between them, for faces that share no edge. Two points start where the two faces come closest: along the edge they share, or along the middle of the gap between their nearest borders, from the end with the lower x (then y, then z). Picking other faces moves the points there again; you can still type over them. | The shared edge |
| Tolerance (Advanced) | How closely the blend is converted to a spline. | 0.001 mm |

Each side row shows a small picture of the face (the line), its outward normal (the arrow) and the ball on its side, and says in words which side that is. By default each face turns toward the other: inside both on a convex edge (a round), outside both on a concave corner (a fillet). The result is shown live, so a wrong side is easy to see; **Flip** it.

The Editor warns when fewer or more than two faces are picked, when the two faces are the same, when a radius is not above 0, and when the two points of a span are the same. A refusal says why and what to change:

| The kernel says | What to do |
|---|---|
| The ball does not fit | The message names the largest radius that does. Use it, or a smaller one |
| No ball touches both faces along the span | Flip the side of a face, use a smaller radius, or move the span onto the faces |
| There is no span | The faces share no edge. Choose Two points and give the start and the end |
| The side is undefined | One face lies in the surface of the other. Flip a side, or pick other faces |

A closed blend (a full torus round a circular edge) can be knitted into a solid like any closed sheet.

## Trim, knit, thicken

**Trim surface.** Trim cuts a surface with a plane or with another surface and keeps one side.

1. Select what trims. Either pick the faces of the two surfaces (the first is trimmed by the second), or pick a face of a solid (its plane is the tool).
2. Choose **Surfaces > Edit > Trim surface**.

With nothing picked it uses the surface selected in the tree, then another surface, then the last reference plane. The Editor has:

| Option | What it does | Default |
|---|---|---|
| Surface to trim | The sheet that is cut. | The target chosen as above |
| Trimmed by | A plane (pick a face) or another surface. | The tool chosen as above |
| Keep the other side | Keeps the part on the opposite side. | Off |
| Trim both surfaces | The tool surface is trimmed by the first too. | Off |

If the tool no longer crosses the sheet, the trim fails with "the surfaces do not cut each other". Move the tool or change the sheet.

**Knit.** Knit joins sheets along their shared edges into one sheet.

- With faces picked, Knit uses the surfaces they belong to. Otherwise it uses the one selected in the tree, else every surface in the part.
- The Editor lists the surfaces with a checkbox each.
- **Make a solid when the result is closed** turns a sealed shell into a solid. It is off by default. If the shell still has open edges, the Editor reports that it is not closed.

**Thicken.** Thicken turns a sheet into a solid. The Editor has Surface, **Thickness**, Side (Front, Back or Both) and Operation (Add or Cut). Thickness starts at about 10% of the body size at first, or 1 mm with no body. A thickness larger than the surface's tightest bend radius allows is refused, and the message gives the largest thickness that works (for example "its smallest radius of curvature is 3.63 mm, use at most 2.90 mm"). For a sheet that tight, set Side to **Both** instead.

Tick **Variable thickness** and the single thickness becomes a ramp: the sheet is thick at one end and thin at the other, which is what a blade or a tapered plate needs.

| Control | What it does | Default |
|---|---|---|
| Ramp along | **X axis**, **Y axis** or **Z axis**: the direction the positions are measured along. A direction that is none of those (set by a script, say) is shown as its vector | Z axis |
| Position | Where a stop sits, in millimetres along that direction | 0, then 10 |
| Thickness | How thick the sheet is at that stop, in millimetres | The thickness you had, then half of it |
| Add stop, Remove | Stops are added at the end and removed from anywhere: 2 to 6 in all | Two stops |

The note in the editor gives the rules: "Thickness at positions along the axis (2 to 6, rising). The stops must cover the whole surface." Between two stops the thickness is interpolated, so the sheet changes smoothly. Positions run from the smallest to the largest, and stops that do not reach across the whole sheet are refused.

**Delete face.** Select faces in Face mode and choose **Features > Bodies > Delete face**. The faces are removed; deleting a face of a solid leaves a sheet.

## Fill and extend

**Fill surface** closes a loop of boundary edges with a patch. Pick the edges in Edge mode, or select a surface in the tree, and choose **Fill surface** (Shift+I). Without picked edges it uses the first open loop of the surface.

| Option | What it does | Default |
|---|---|---|
| Continuity | How the patch meets its neighbours: G0 (touching), G1 (tangent), G2 (curvature), G3. An N-sided patch takes G0 or G1 only. | G0 |
| Fairing | How the patch is smoothed: Smooth net, Thin plate, Curvature or Variation. Not used by an N-sided patch. | Smooth net |
| Patch | **Single face** fills the loop with one face. **N-sided** fills a closed loop of at least three edges with one smooth face for each edge, meeting at a new centre point. | Single face |
| Tolerance | N-sided only: the largest distance of a patch side from the edge it stands for. | 0.0001 mm |
| Merge with the surface | Joins the patch to the surface it fills. | On |
| Edges | The boundary edges, with Use selection. | The picked edges |

**Extend surface** continues an open border of a sheet along its own shape. Pick one border edge (or select the surface) and choose **Extend surface** (Shift+X). Distance is about 10% of the model size at first. The command extends the border edges you picked, or else the first open edge of the surface. In the Editor you can add more border edges with Use selection. The kernel extends each open border edge, but only one edge of any one face: two edges of the same face are refused with the code `extendNotBoundary`, and so is an edge that is not an open border (an edge shared by two faces). The kernel's detail text is "only open boundary edges extend". So pick border edges only, at most one per face, or make several Extend features. A wavy edge may report that it cannot be extended at the default distance; try a shorter distance.

## Pipe cut

Pipe cut rolls a ball of a given radius along edges and cuts away everything it touches. Select edges in Edge mode, or select faces to use their rim edges, and choose **Features > Modify > Pipe cut**. Radius is about 10% of the smallest dimension at first. The solid becomes a surface body.

## Offset surface

Offset surface makes a new surface body a set distance from faces. Pick faces of a solid (or choose a surface in the tree) and choose **Offset surface** (Surfaces > Edit). A positive **Distance** goes outward on a solid, a negative one into it; the source stays unless you turn **Keep the source** off for a surface. Only flat, cylindrical, conical, spherical and ring faces can be offset, and a distance that reaches the centre of a round face is refused with the limit.

## Not available

- **Project curve**, **Edit curve** and **Freeform** are covered in [Curves on faces](curves.md). Inside a sketch, the Project tool is a different thing: it projects model edges onto the sketch plane. See [Offsets and references](../sketching/offset-reference.md).
- Cut with surface is not built yet.
- Guide curves and strength for Fill are not offered.

For the exact definitions, see [Surfaces and curves](/docs/cad/kernel/format/features-surfaces.html) in the kernel book: [knit](/docs/cad/kernel/format/features-surfaces.html#knit), [fill](/docs/cad/kernel/format/features-surfaces.html#fill), [trim surface](/docs/cad/kernel/format/features-surfaces.html#trimsurface), [thicken](/docs/cad/kernel/format/features-surfaces.html#thicken), [extend](/docs/cad/kernel/format/features-surfaces.html#extend).

## Surface analysis

Four views and a comb help you judge whether a surface is smooth. They colour or decorate the displayed mesh and are never saved with the part. Turn them on from **Evaluate > Surface analysis**.

| Command | Keys | Shows |
|---|---|---|
| Zebra stripes | Alt+Z | Stripes reflected in the surface. A break in a stripe is a break in tangency, a kink a break in curvature. Has a stripe density control. |
| Gaussian curvature | | Red where the surface is dome-like, blue where saddle-like, white where flat or rolled. |
| Mean curvature | | Red where it bulges out, blue where it dips in. |
| Draft analysis | Alt+D | Colours faces by their angle to a pull direction: green has draft, red has none, blue faces the other way. Controls: Pull direction and Least draft (degrees). |
| Curvature comb | Alt+C | Teeth along edges and sketch curves, as long as the curvature there. Smooth teeth mean a smooth curve. Has a Comb size control. |

Use only one colour mode at a time; the comb can be added to it. The analysis reads the displayed mesh, not the exact surface, and it does not show continuity (G1, G2) between faces as a number. The Hidden-lines and Wireframe display styles draw no faces, so only the comb shows there.

## Next

- [Extrude, revolve, sweep and loft](solids.md)
- [Curves on faces](curves.md)
- [Bodies and combining](bodies.md)
- [Measure and inspect](../analysis/measure.md)
- [Offsets and references](../sketching/offset-reference.md)
