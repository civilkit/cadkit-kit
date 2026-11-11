# File formats: export, DXF import and SVG import

Code: `packages/io/src` (pure functions, no DOM, no kernel), `apps/cad/src/exportFiles.ts` (builds the files from the
controller's state), `apps/cad/src/dxfSketch.ts` and `svgSketch.ts` (add a DXF or SVG to the open sketch), `apps/cad/src/ExportMenu.tsx` (top bar).
All units are millimetres. Files go out through `platform.saveFile(name, data, mime)`, which now takes text or bytes.

## Export

The top bar has one Export button (icon, `Ctrl+E`) next to Save with a menu of formats. Every format is also its own
command in the command search (`export-stl`, `export-stl-ascii`, `export-obj`, `export-3mf`, `export-glb`, `export-step`, `export-dxf-sketch`,
`export-dxf-views`). File names come from the part name (`<part>.stl`, `<part>-<sketch>.dxf`, `<part>-views.dxf`).

| Format | Source | Notes |
| --- | --- | --- |
| STL binary (default) / ASCII | the viewer's triangles (`controller.bodyMesh()`) | facet normals recomputed from the corners; solid name = part name; header does not start with `solid` so readers do not take it for ASCII |
| OBJ | same triangles | welded vertices (1e-5 mm), one object, counter-clockwise faces |
| 3MF | the same triangles, split per body (`splitBodies` in `bodies.ts`) | zip written by hand (`packages/io/src/zip.ts`, deflate through `CompressionStream` when the platform has it, else stored); `3D/3dmodel.model` with `unit="millimeter"`, Z up, one `<object>` and build item per body, welded vertices, body colour as a `basematerials` entry (opacity as alpha) |
| GLB | same, with the mesh's per-corner normals | binary glTF 2.0 by hand (`glb.ts`): JSON and BIN chunks, POSITION / NORMAL / uint32 indices per body, one node, mesh and material per body (sRGB colour converted to linear, opacity as `BLEND`, metallic and roughness when set). Y up and metres: `(x, y, z)` mm becomes `(x, z, -y) / 1000`, a rotation about X, so winding is kept |
| STEP | `session.step()` (kernel) | the same text the MCP tool returns |
| DXF, sketch | the open sketch, else the sketch selected in the tree | R12 ASCII (`AC1009`, `$INSUNITS` 4); LINE, CIRCLE, ARC, POINT exact; ellipse, fit spline and control-point spline written as sampled POLYLINE (R12 has no ELLIPSE / SPLINE); construction geometry on layer `CONSTRUCTION` with a DASHED line type; everything else layer `0` |
| DXF, 3 views | the body's feature edges (`controller.bodyEdges()`) | front, top above it, right beside it (third-angle); edges seen end-on collapse to one segment, edges that coincide in a view are written once; hidden lines are not drawn |

Mesh exports run a watertight check on the mesh they write (`checkMesh`: welded edges used once = open, more than twice =
non-manifold, walked twice in the same direction = flipped). The file is still written; an open or non-manifold skin is
reported as a warning in the notice area.

### One folder

A feature-tree folder is exported from its right-click menu (`apps/cad/src/folderExport.ts`): STEP, STL or a frozen `.ckpart` of the
bodies its features created or changed, and Extract as a part. See the guide chapter Exporting. The file is built from a scratch
copy of the document with a `deleteBody` (keep) at the end; the frozen part is checked by rebuilding it and comparing its volume
with the folder's to 0.5 percent.

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
- `packages/io/src/svgImport.test.ts`: every element, path commands and arc flags, transforms, units and viewBox, Y flip, what is skipped, hostile input.
- `apps/cad/src/svgSketch.kernel.test.ts` (needs `CK_WASM`): `fixtures/svg/shapes.svg` (gear outline with a bore, rounded plate, circle) and Bezier / arc outlines extrude to the expected volume, units, refusals leave the draft alone.
- `apps/cad/src/io.kernel.test.ts` (needs `CK_WASM`): STL of a real part is watertight with the kernel's volume, STEP text, DXF of the real edges.
- `apps/cad/src/dxfSketch.kernel.test.ts` (needs `CK_WASM`): imported DXF extrudes to the expected volume (rounded rectangle with hole, inches, our own export, closed spline).
- `folderExport.test.ts`, `apps/cad/src/folderExport.kernel.test.ts` (needs `CK_WASM`): body selection, refusals, extract plan; STEP / STL / frozen part volumes of a folder on a real kernel.
- `exportFiles.test.ts`, `ExportMenu.test.tsx`, `commands.test.ts`: file names, notices, menu behaviour, commands, icons, shortcut.

## SVG import

Two commands next to the DXF ones: `Import SVG into sketch` (`sketch-import-svg`, while a sketch is open) and `New sketch from SVG`
(`sketch-from-svg`, on the selected face or plane, front when nothing is selected). `.svg` is a text kind in `packages/platform/src/kinds.ts`,
so Open and drag-and-drop route it like `.dxf` (into the open sketch, else a new sketch). The parser is `svgToSketch` in
`packages/io/src/svgImport.ts` (no dependency: a small XML reader, a path parser, an affine matrix); it returns the same `points` /
`entities` shape as the DXF import and `mergeIntoDraft` adds them to the draft.

- Read: `path` (M L H V C S Q T A Z, absolute and relative, packed arc flags, parsed up to the first error like a renderer), `rect`
  (rounded: `rx` / `ry`, clamped to half the side), `circle`, `ellipse`, `line`, `polyline`, `polygon`; nested `g` / `a` / `switch` / `svg`,
  internal `<use href="#id">` (with x / y, `symbol` viewBox); `transform` (matrix translate scale rotate skewX skewY, any nesting).
- Mapping: lines -> `line`; circular arcs -> `arc` (also under a uniform scale or a mirror); circle -> `circle`; ellipse, and a circle under
  a rotation or non-uniform scale -> `ellipse` (axes from the conjugate diameters); a cubic or quadratic Bezier -> `cvspline` of degree 3 or 2
  (exact: a Bezier is a clamped uniform B-spline of its control points); a Bezier whose control points are on its chord -> `line`; one that
  closes on itself is split in two; an elliptical arc (or a circular one under a non-uniform scale) -> a chain of cubic `cvspline`s of at most
  a quarter turn. End points within 1e-6 mm share a sketch point so closed subpaths close. No constraints are written.
- Size: root `width` / `height` (mm cm in pt pc px) with the `viewBox` (and `preserveAspectRatio`) give the scale. No physical size
  (`units: 'px'`): 1 user unit = 1 CSS px = 25.4/96 mm and the notice `io.svg.unitless` says so. `svgToSketch(text, { mmPerUnit })` overrides.
  Y is flipped about the bottom of the viewport so the drawing is upright with its lower left corner at the origin.
- Not read, listed in a notice: `text`, `image`, `foreignObject`, `script`, other unknown elements, external `use`, a bad `transform`,
  path data errors. Fill, stroke, gradients, `defs`, `style`, CSS classes are ignored quietly; `display:none` elements are skipped;
  elements with `clip-path`, `mask` or `filter` are imported whole and counted (`io.svg.clipped`). Exact repeats (a fill and a stroke layer
  of the same shape) and zero-size shapes are dropped and counted.
- Safety: nothing is executed or fetched. A DOCTYPE with `<!ENTITY` is refused (`unsafe`), as are binary data / non-SVG (`notSvg`), files over
  10 MB (`tooLarge`), more than 200000 elements or 100000 element visits (`use` bombs) or 20000 entities (`tooMany`), nesting deeper than 64,
  coordinates beyond 1e6 mm or non-finite after the transform (`range`), and a file with nothing drawable (`nothing`, naming what was skipped).
- i18n: `io.svg.*` and `cmd.sketch-import-svg` / `cmd.sketch-from-svg` / `rb.*` in `apps/cad/src/locales/en.ts` and `toolbar.ts` (English is the only locale).

## Not done

STL/OBJ/STEP import, hidden lines in the DXF views, DXF dimensions and text, DXF layers other than the two above, 3MF; SVG: text (no outlines), stroke widths, dashes as construction, gzip (`.svgz`), CSS classes and `<style>` rules, percentage lengths, an on-open prompt for the unit of a unitless file.
