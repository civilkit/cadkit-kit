# Exporting

This chapter covers every way to get a model out of the app: STEP, STL, OBJ, DXF, drawings as PDF, SVG and DXF, the bill of materials as CSV, and the part file itself.

All exports use millimetres. Files go through the browser: depending on the browser they are saved straight to your downloads folder or you are asked where to put them. A notice confirms each export and warns about problems.

## The Export menu

Choose the **Export** button in the top bar (or press **Ctrl+E**) to open the list of formats. Each entry is also a command in the command search (press **F**), so you can type "export" to find them.

| Menu entry | File | Needs |
|---|---|---|
| Export STL (binary) | `<part>.stl` | A solid on screen |
| Export STL (ASCII) | `<part>.stl` | A solid on screen |
| Export OBJ | `<part>.obj` | A solid on screen |
| Export STEP | `<part>.step` | A solid on screen |
| Export sketch as DXF | `<part>-<sketch>.dxf` | A sketch being edited, or selected in the feature tree |
| Export 3 views as DXF | `<part>-views.dxf` | A solid on screen |

An entry that cannot run is greyed out. The file name starts with the part name; characters that file systems do not allow are replaced with an underscore. If there is nothing to export you get a notice: "There is no solid to export yet" or "Open a sketch or select one in the feature tree to export it".

Before the export runs, the app waits for the model to finish rebuilding, so a file is never made from a stored preview.

What is exported is the model as built: hiding a body or a component, changing the display style, the exploded view and section views do not change the file. Colours, finishes and materials are not written to any of these formats.

## STEP

Use STEP to hand an exact solid to another CAD program. **Export STEP** writes the kernel's exact surfaces, not triangles. It can take a moment on a large part, with the busy overlay showing. The exported file imports back to the same volume. STEP carries no colours or feature history.

## STL and OBJ

Use STL for 3D printing and slicers, and OBJ for rendering programs.

- Both are triangle meshes made from the same triangles the viewport shows.
- **STL (binary)** is smaller and is the usual choice. **STL (ASCII)** is readable text. The solid name inside the file is the part name.
- **OBJ** has welded vertices and counter-clockwise faces, one object.
- After writing, the app checks that the mesh is watertight. The file is still written, but if the surface has open edges, non-manifold edges or flipped faces you get a warning ("... is not watertight ... a slicer may need to repair it"). The note on the number of triangles tells you the size of the mesh.

## DXF from a sketch

**Export sketch as DXF** writes the sketch you are editing, or the sketch selected in the feature tree. The file is DXF R12 (ASCII), which most CAD, laser and CNC programs read.

- Lines, circles, arcs and points are written exactly. Ellipses and splines are written as short line segments, because R12 has no spline or ellipse. Some entities that cannot be written are counted in a warning.
- Construction geometry goes on a layer called CONSTRUCTION with a dashed line type. Everything else is on layer 0.
- The units are marked as millimetres. A sketch with no geometry is refused.

## DXF with three views

**Export 3 views as DXF** writes the edges of the solid as three views: front, top above it and right beside it (third-angle projection). Edges seen end-on collapse to a line and edges that land on top of each other are written once. Hidden lines are not drawn, and there are no dimensions. For a proper drawing with hidden lines, sections and dimensions use the drawing view below.

## Drawings: PDF, SVG, DXF and print

In the **Drawing** view the toolbar has **PDF**, **SVG**, **DXF** and **Print** buttons. They are described in [Drawings](drawings.md). In short: PDF is one vector page at the sheet size, SVG is the sheet in millimetres, DXF has layers for visible, hidden, centre, thin, hatch, dimension, text and border lines (arrowheads are left out), and Print opens your browser's print dialog, where "Save as PDF" also works. The file name comes from the title in the title block, or the part name. A sheet with no views cannot be exported ("Add views first").

## Bill of materials

In the Assembly panel, **Bill of materials > Save CSV** writes `bom.csv`. See [Assemblies and mates](../assemblies/assemblies.md).

## The part file

**Save** and **Save as** write the editable part, `.ckpart`, optionally compressed to `.ckpart.gz`. That is the way to keep or share a model you want others to edit, and the only export that preserves the feature history. See [Saving and opening](files.md).

## What is not in the Export menu

- **GLB (glTF).** Not offered in the app. The MCP server can write a GLB; see [Agents and the MCP server](../automation/mcp.md).
- **Exporting one folder or a few features of the tree as a separate file.** Not available yet. To reuse part of a model, save the part and insert it as a component, or keep it in the library.
- **STL/OBJ import.** The app can export meshes but cannot read them.

## Troubleshooting

- **The Export button or an entry is greyed out.** There is no solid on screen. A part that only holds a view-only import (see [Importing](import.md)) has no mesh built from features, which is what the entries test for, so they should be greyed out. And a sketch export needs an open or selected sketch.
- **The slicer says the STL is not watertight.** Read the warning for the count of open edges. A model with open surfaces (a surface body that was never thickened or knitted) is not a solid.
- **A DXF opens at a strange size.** The sketch is in millimetres; check the unit setting in the program that opens it.
- **STEP fails or the file is empty.** Check Diagnostics for feature errors first; see [Checks and diagnostics](../analysis/checks.md).

## Next

- [Drawings](drawings.md)
- [File formats at a glance](formats.md)
- [Importing](import.md)
- [Assemblies and mates](../assemblies/assemblies.md)
