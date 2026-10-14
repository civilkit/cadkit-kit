# File formats: export and DXF import

Code: `packages/io/src` (pure functions, no DOM, no kernel), `apps/cad/src/exportFiles.ts` (builds the files from the
controller's state), `apps/cad/src/dxfSketch.ts` (adds a DXF to the open sketch), `apps/cad/src/ExportMenu.tsx` (top bar).
All units are millimetres. Files go out through `platform.saveFile(name, data, mime)`, which now takes text or bytes.

## Export

The top bar has one Export button (icon, `Ctrl+E`) next to Save with a menu of formats. Every format is also its own
command in the command search (`export-stl`, `export-stl-ascii`, `export-obj`, `export-step`, `export-dxf-sketch`,
`export-dxf-views`). File names come from the part name (`<part>.stl`, `<part>-<sketch>.dxf`, `<part>-views.dxf`).

| Format | Source | Notes |
| --- | --- | --- |
| STL binary (default) / ASCII | the viewer's triangles (`controller.bodyMesh()`) | facet normals recomputed from the corners; solid name = part name; header does not start with `solid` so readers do not take it for ASCII |
| OBJ | same triangles | welded vertices (1e-5 mm), one object, counter-clockwise faces |
| STEP | `session.step()` (kernel) | the same text the MCP tool returns |
| DXF, sketch | the open sketch, else the sketch selected in the tree | R12 ASCII (`AC1009`, `$INSUNITS` 4); LINE, CIRCLE, ARC, POINT exact; ellipse, fit spline and control-point spline written as sampled POLYLINE (R12 has no ELLIPSE / SPLINE); construction geometry on layer `CONSTRUCTION` with a DASHED line type; everything else layer `0` |
| DXF, 3 views | the body's feature edges (`controller.bodyEdges()`) | front, top above it, right beside it (third-angle); edges seen end-on collapse to one segment, edges that coincide in a view are written once; hidden lines are not drawn |

Mesh exports run a watertight check on the mesh they write (`checkMesh`: welded edges used once = open, more than twice =
non-manifold, walked twice in the same direction = flipped). The file is still written; an open or non-manifold skin is
reported as a warning in the notice area.

## DXF import

Two commands: `Import DXF into sketch` (while a sketch is open) and `New sketch from DXF` (on the selected face or plane,
front when nothing is selected). The file picker is `platform.openFile()`.

- Read: LINE, CIRCLE, ARC, LWPOLYLINE and POLYLINE/VERTEX (bulges become arcs, closed flag closes the outline), SPLINE
  (fit points -> `spline`; control points with clamped uniform knots -> `cvspline`; any other knot vector, or rational ->
  sampled into line segments), POINT. Mirrored OCS (extrusion -Z) is undone.
- Not read, and listed in a notice: everything else (INSERT/blocks, TEXT, HATCH, DIMENSION, ELLIPSE, 3D entities,
  polyface/mesh). Binary DXF is refused; DWG is not supported.
- Units from `$INSUNITS` (1 in, 2 ft, 5 cm, 6 m, ... converted; 0 and 4 = mm). An unknown code is read as mm with a notice.
  The DXF Y axis is the sketch v axis; coordinates are used as drawn (no recentring).
- End points within 1e-6 mm share one sketch point, so connected outlines close. No constraints are written.
- Layer `CONSTRUCTION` (any case) marks entities as construction.
- Limits: more than 20000 entities is refused with a message; coordinates beyond 1e6 mm from the origin are refused
  (survey-frame drawings); zero-length lines and zero-radius circles are dropped and counted.

## Tests

- `packages/io/src/stl.test.ts`: watertight check (cube, open, flipped, welding), STL binary and ASCII round trip, OBJ.
- `packages/io/src/dxfWrite.test.ts`: golden header and tables, sketch round trip through our reader, view layout.
- `packages/io/src/dxfImport.test.ts`: every entity type, bulges (minor, major, negative), units, OCS, splines, limits, merging.
- `apps/cad/src/io.kernel.test.ts` (needs `CK_WASM`): STL of a real part is watertight with the kernel's volume, STEP text, DXF of the real edges.
- `apps/cad/src/dxfSketch.kernel.test.ts` (needs `CK_WASM`): imported DXF extrudes to the expected volume (rounded rectangle with hole, inches, our own export, closed spline).
- `exportFiles.test.ts`, `ExportMenu.test.tsx`, `commands.test.ts`: file names, notices, menu behaviour, commands, icons, shortcut.

## Not done

STL/OBJ/STEP import, hidden lines in the DXF views, DXF dimensions and text, DXF layers other than the two above, 3MF.
