# Exporting

This chapter covers every way to get a model out of the app: STEP, STL, OBJ, 3MF, glTF (GLB), DXF, drawings as PDF, SVG and DXF, the bill of materials as CSV, and the part file itself.

All exports use millimetres. Files go through the browser: depending on the browser they are saved straight to your downloads folder or you are asked where to put them. A notice confirms each export and warns about problems.

## The Export menu

Choose the **Export** button in the top bar (or press **Ctrl+E**) to open the list of formats. Each entry is also a command in the command search (press **F**), so you can type "export" to find them.

| Menu entry | File | Needs |
|---|---|---|
| Export STL (binary) | `<part>.stl` | A solid on screen |
| Export STL (ASCII) | `<part>.stl` | A solid on screen |
| Export OBJ | `<part>.obj` | A solid on screen |
| Export 3MF (3D printing) | `<part>.3mf` | A solid on screen |
| Export glTF (GLB) | `<part>.glb` | A solid on screen |
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

## 3MF and glTF (GLB)

Use 3MF for 3D printing programs that read colours and several bodies, and GLB for web viewers, game engines and AR.

- Both write one object per body, named as in the Bodies list, with the body's colour (and opacity) when it has one. 3MF also uses the same triangles as STL; GLB carries the viewport's smooth normals.
- **3MF** is a zip file, in millimetres with Z up, as the model is. The watertight check of STL and OBJ applies.
- **GLB** is a single binary glTF 2.0 file. glTF is in metres with Y up, so the part is scaled by 0.001 and turned so that the model's Z axis points up the file's Y axis (a 10 mm cube is 0.01 m). Metallic and roughness are written when you set them on the body; otherwise the material is a plain matt one.
- **Only visible bodies** and the mesh quality and chord boxes of the Export menu apply to both.

## Cosmetic knurls in exports

A [cosmetic knurl](../library/wizards.md) is only drawn in the open part. STEP, STL, OBJ and the folder exports below still include it: the app copies the part on the side, cuts the knurl into the copy as real grooves (the same cuts the Knurl wizard makes with Cosmetic off) and writes the copy. Your part is not changed: the knurl stays cosmetic and nothing is added to the history or the undo list. The notice after the export says "Included N cosmetic knurl(s) as real cuts".

Choose how this works in **Settings > General > Export > Include cosmetic knurls in exports**, kept on this device:

- **On** (the default) cuts them for every export.
- **Ask each time** shows a small dialog: **Include the knurls**, **Export without** or **Cancel**. Tick **Do not ask again** to keep the answer as the setting.
- **Off** writes the plain solid and warns that the knurls are not in the file, with a button that converts them to real cuts in the part.

Straight grooves cut in about a second. Diamond and pyramid knurls with round grooves, or dense ones, can take a minute or more (a pyramid of 90 V grooves took about 40 seconds on the test machine): a hint says so first, the busy overlay says "Cutting knurl grooves for the export..." and **Cancel** stops it. If the cut fails or takes more than 120 seconds, nothing is written until you choose: the message gives the reason and offers **Export without the knurl** or **Cancel**. One case keeps the plain solid and the warning: STL or OBJ with some bodies hidden. An STL or OBJ with a chosen mesh tolerance meshes the knurled copy at the standard tolerance and says so. Drawings and the DXF with three views are made from the open part, so they still show the plain cylinder. Mass properties are not changed. **Exporting again is instant:** a successful cut is kept, so exporting the same part again with the same knurls (also as another file type of the same kind: STEP again, or STL and OBJ) reuses it and the notice says so; changing the part, the knurl or the kernel build cuts again. The folder exports cut each time.

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

## One folder as a file

A [folder](../modelling/history.md) of the feature tree can be taken out of a model on its own. Right-click the folder.

| Choice | Result |
|---|---|
| Export folder geometry as STEP | `<part> - <folder>.step`, the exact solids of the folder |
| Export folder geometry as STL | `<part> - <folder>.stl`, binary, the same checks as a normal STL |
| Export folder geometry as part file (frozen) | `<part> - <folder>.ckpart`: a part whose one feature is the imported solid, so it opens, measures and can be cut or drilled but has no history |
| Extract folder as a part | a new document with the folder's features and the variables they use; nothing is written until you save it |

**What is in the file.** The bodies the folder's features made or changed (with the cosmetic knurls whose cylinder is on one of them, see above), as the model builds today. A body that a feature outside the folder also touched comes out whole, with those changes, and a notice says how many bodies that is. Hidden bodies are included, because you asked for this folder. The open model is not changed.

**Refused, with a hint.** A rolled-back model ("roll forward first"), a folder that holds only sketches, planes or axes, a folder whose solid features are all suppressed, and a folder whose features left no body in the result (a failed feature, or bodies a later feature deleted).

**Extract as a part** needs the folder to stand on its own. It is refused, naming exactly what it found, when a feature of the folder uses a feature outside it (a sketch from another folder), a face of one (`F2.C1`: face names are not stable in a new document) or a body made outside it. The new part is then built on the side and its volume compared with the folder's bodies; a folder that cuts geometry it does not name (a "through all" cut into a body made elsewhere) is refused with both volumes instead of opening an empty or different part. The extract keeps the feature numbers, copies the material and the variables the folder uses (with their values), and leaves behind colours, body names, configurations and the stored view.

## What is not in the Export menu

- **GLB (glTF).** Not offered in the app. The MCP server can write a GLB; see [Agents and the MCP server](../automation/mcp.md).
- **Exporting a few features that are not a folder.** Group them into a folder first; see the next section.
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
