# Limits and known gaps

This chapter lists what the app does not do, or does not do reliably, so you can plan around it. Each item says what happens and, where there is one, the workaround. Items are ordered roughly by how soon you are likely to meet them.

The geometry kernel has its own, more technical list of limits in [the kernel guide](/docs/cad/kernel/quality/limits.html).

## Check the result

- **A part can build and still be wrong.** In some cases the kernel returns a valid-looking solid whose volume differs from the true one. This has been seen with overlapping curved primitives, outward shells and three-section lofts. Run **Check** and compare **Mass properties** with what you expect. See [Checks and diagnostics](../analysis/checks.md).
- **The picture is a mesh.** The 3D view draws a tessellation of the exact solid. Exact volumes, areas and sizes come from **Mass properties** and **Measure**, not from the mesh. Rarely, a small crack appears in the mesh of an imported or text part (`TESSELLATION_OPEN` in the check). The solid is still valid.
- **Misspelled settings in files you edit by hand can be ignored.** A field with an unknown name is skipped without a warning, and the feature uses its default. If you edit a part file as text, compare the result with Mass properties.

## Rounding, shells and booleans

- **Large fillet radii are refused.** A radius that approaches half the thinnest side of the part answers "the radius is too large for these edges" or "the rounding runs off the faces beside it", even when the shape is geometrically possible. Use a smaller radius, or round in steps.
- **Corner blends are limited.** Unequal radii at a corner where three edges meet end in a mitre, not a smooth patch. Variable-radius fillets are the weakest case. Rounding a loop of tangent edges can occasionally take very long or fail.
- **Outward shells** and shells of drafted cylinders often give a wrong volume. Prefer inward shells, or build the wall with offsets and cuts.
- **Booleans on curved shapes** are the weak spot, especially anything involving a torus, cones against cylinders, or chains of three curved bodies. If **combine** fails ("the combine failed"), make the bodies overlap in a volume, nudge one by a small amount, or reorder the operations.
- **Long patterns** (about 100 instances) make a combine take seconds to tens of seconds.
- **Lofts:** there is no closed (ring) loft. A three-section circle loft is a different surface from a smooth loft-through-sections, so volumes can differ noticeably. There is no sweep control over the profile's orientation along the path.
- **Threads:** pipe-thread tapers, threads on conical faces and rounded thread roots are not modelled.
- **No sheet metal.** There are no bend features or flat patterns.
- **Sketch text** is planar and single-line. It does not wrap onto curved faces and does not support complex scripts.

## Surfaces and analysis

- There is no surface sweep, no offset surface, no surface-by-network, and no mesh-to-solid conversion.
- Surface analysis (zebra, curvature maps, draft analysis, curvature comb) is computed on the displayed mesh, not on the exact surfaces. It does not compare continuity between faces.
- **Extend surface** takes one border edge at a time.

## Assemblies and appearance

- A part can hold inserted components and mates. A mate refers to faces, not edges.
- Some mate kinds are not available: profile centre, path, linear coupler, cam and universal joint. A hinge has no built-in angle limit; add a **Limits** mate (distance or angle) to restrict its range.
- A part has one material for mass properties. A custom material lives in the browser that made it. A file that names a custom material, opened elsewhere, keeps the name, and **Inspect** then asks for a density.
- Colours and appearance are view settings. They are not an undo step, and they are not exported to STEP.
- **Insert** from the library does not carry over the appearance of the inserted part.

## Importing

- **View only is a choice, not the rule.** STEP and SketchUp ask which of the two you want when they open, and remember it per kind. The default for STEP is an imported solid feature saved with the part; the default for SketchUp is a reference mesh saved with the part. **View only** gives a body that is drawn but not saved with the part, and the next edit replaces it. A **SolidWorks** part opens as an editable imported body that is saved with the part. When both the feature history and the exact-solid import fail, the part opens view only.
- **STEP** import does not read assemblies, placements, colours or names. Shell-based surface models and open shells are not imported. A small share of files in real use import with defects.
- **SolidWorks** import reads the geometry of the active configuration only, and rebuilds the feature history only where the kernel can; otherwise the part opens as the file's exact solid with no feature tree. Sheet and wire bodies are refused. A file whose geometry the kernel cannot read to a closed solid is refused.
- **SketchUp** import is a surface body of planar faces: no curves, dimensions, scenes or text. Files over 50,000 faces are refused by default.
- **OBJ, GLB and 3MF open as reference meshes only.** They do not become a solid, textures are not read, and a file with several objects comes in as one mesh. Ask for a STEP file when you need a solid.
- **DXF** import reads ASCII DXF only, up to 20,000 entities and coordinates within 1,000,000 mm of the origin. Splines with a general knot vector become short line segments. Unsupported entity types, such as text and dimensions, are skipped and listed.
- **SVG** import reads paths, rectangles, circles, ellipses, lines, polylines and polygons (with groups, `use` of shapes in the same file, and transforms), up to 20,000 entities, a 10 MB file and coordinates within 1,000,000 mm of the origin. Text, images, scripts, fills, strokes, gradients and clip paths are not read; an element with a clip path or mask is imported whole. A file that declares entities is refused. Without a size in mm, cm, in or pt, a pixel is taken as 0.2646 mm (96 dpi).
- **FreeCAD** files convert feature by feature. Features the app cannot convert are listed, and the resulting geometry may be partial. Fillets and chamfers are left out; add them again in the app. See [Importing](../files/import.md).

## Exporting

- Model export formats are STEP, binary and ASCII STL, OBJ, 3MF, glTF (GLB), and DXF (a sketch, or three views). Drawings have their own exports: PDF, SVG, DXF and print. The bill of materials saves as CSV. See [Exporting](../files/export.md) and [Drawings](../files/drawings.md).
- **STEP** export writes geometry only: no colours, names, layers or assemblies.
- **DXF** export of a sketch uses layer 0 and a CONSTRUCTION layer. The three-view model DXF has no hidden lines, dimensions or text and uses a single layer. The drawing DXF is richer, with one layer per line style (see [Drawings](../files/drawings.md)).
- **STL** and **OBJ** are meshes, with the mesh tolerance noted above. Use STEP when you need exact surfaces.

## Library and catalog

- **Mirror** in the Placement row is not applied to library parts. **Rotate** and **Direction** apply only to drops on a plane or the ground.
- A library part drawn on several planes, tied to fixed directions, or an assembly, lands at its own origin.
- Parametric catalog parts need a flat face, edge rounders act on every edge of the face, and only two anchors (bottom and centre) are offered.
- Private GitHub repositories are not supported, and a folder library is remembered only through its saved copy.
- There is no download progress bar.

## Wizards

- **Gears:** spur, ring, helical, herringbone and rack. No bevel or worm gears. Large gears rebuild slowly.
- **Marine propeller:** joining a blade to the hub can fail for some section spacings, especially for a low pitch at the hub. The wizard retries other spacings. The root of the blade has no fillet. A rake of about 25 degrees or more can leave small gaps in the display mesh.
- **Impeller:** one blade shape, no shroud surface, no root fillet, fixed hub contour.
- **Airfoil propeller:** no root fillet; the blade shape is fixed when built, so change it in the wizard.
- **Corner holes:** exact only for a flat rectangular face with equal corner radii. Other outlines use the bounding box.
- None of the wizards calculates strength or performance.

## Automation

- A script always builds a **new** part. It cannot change the part you have open.
- Scripts are limited to 40,000 characters and 2,000 steps. They are not sandboxed against hostile code.
- Script sketches have no constraints.
- The MCP server is a separate local program with its own document, started from a source checkout. See [Agents and the MCP server](../automation/mcp.md).
- The [local kernel service](../automation/local-kernel.md) is experimental, works only on the same computer, and needs a build that matches the app.

## Platform

- **English only.** No right-to-left layout. Kernel error text is English. See [Languages](languages.md).
- **Browser storage** may be cleared by the browser or blocked in private windows. Autosave skips parts over about 3 MB of text. Save to files.
- **Saving over the same file** works only in browsers with direct file access. Others download a new copy each time.
- **Memory.** The in-browser kernel keeps caches in memory that does not shrink while the tab lives. A part of several hundred features can take about half a gigabyte of the tab's memory. Close other tabs, or use the local kernel service.
- **The kernel is single-threaded.** Free-form parts, propellers and long patterns take seconds to tens of seconds in the browser. The local kernel service is about two to three times faster.

## Next

- [Troubleshooting](troubleshooting.md)
- [Glossary](glossary.md)
- [Commands and shortcuts](commands.md)
