# Surface tools

The Surfaces tab (Features tab for solids) creates every surface feature the kernel can regenerate, edits them in the Editor
with ordered pickers, and shows surface analysis in the viewport. Code: `apps/cad/src/featureCreators.ts` (what a command
makes), `surfaceRules.ts` (pure editor rules), `FeatureOptions.tsx` (the forms), `packages/viewport/src/analysis*.ts` (analysis).
Tests: `surfaceRules.test.tsx`, `surfaceCreators.kernel.test.ts`, `surfaceSamples.kernel.test.ts`, `analysis.test.ts`.

## Commands

| Command | Key | Makes | Starts from |
|---|---|---|---|
| Loft (`add-loft`) | Shift+O | `loft {sketches:[a,b]}` solid | the two newest closed sketches no other feature uses |
| Lofted surface (`add-surface-loft`) | | `loft {surface:true}` | same, open or closed (all of one kind) |
| Sweep (`add-sweep`) | Shift+W | `sweep {sketch, path:{kind:'sketch',id}}` | newest unused closed sketch (profile), newest unused open sketch (path) |
| Planar / Extruded / Revolved surface | | existing | closed sketch / any curves / sketch with axis line |
| Fill surface (`add-fill`) | Shift+I | `fill {edges, continuity:'G0', merge:true}` | picked edges (edge mode), else the first open loop of the surface selected in the tree or owning a picked face |
| Extend surface (`add-extend`) | Shift+X | `extend {edges, distance, shape:'same'}` | picked border edge, else the first open edge of the surface |
| Trim surface | | `trimSurface` | see mapping below |
| Knit | | `knit {surfaces, solid:false}` | see mapping below |
| Thicken, Delete face | | existing | surface of a picked face / picked faces |

Every command opens the Editor on the new feature (draft and confirm, live preview, one undo step). Each has an icon and a
ribbon tooltip with a sentence (`tip.<id>` in `locales/en.ts`, `Command.tip` in the ribbon, `hint` on `Tip`).

## Selection to feature

A surface face or edge is named `<feature>.…`, so a picked face or edge tells which surface body it belongs to
(`surfacesInSelection`). The target of Trim, Knit, Thicken, Fill and Extend is the surface selected in the tree, else the first
surface a picked face or edge belongs to, else the last surface feature.

- Trim: faces of two surfaces: the first is trimmed by the second (`toolSurface`). A surface face plus a solid face: the solid
  face's plane trims it. Otherwise another surface, else the last reference plane.
- Knit: the surfaces the picked faces belong to, else the tree one, else all.
- Edge lists (Fill, Extend, Fillet...) take border edges of sheets (one face) as well as inner edges (two faces); the kernel
  reference is `{faces:[...], at:[x,y,z]}`.

## Editors (`FeatureOptions.tsx`, rules in `surfaceRules.ts`)

- Loft: ordered profile list (drop-down per row, up / down / remove, add; at least two), guide curves (open sketches, `guides:[{sketch}]`),
  Make a surface, Add / Cut, start and end tension (`startNormal`, `endNormal`, 0 = free).
- Sweep: profile drop-down (closed sketches), path drop-down (open sketches), guide curves as `{kind:'sketchCurve', sketch, entity}`
  (the guide must be as long as the path: `sweepGuideShort`), twist (not with guides), Add / Cut.
- Fill: continuity G0 to G3, fairing (smooth net, thin plate, curvature, variation), merge; edges through the generic list with Use selection.
- Extend: distance. Knit: a check per surface body, Make a solid. Trim: surface, trimmed by (a plane picked on a face, or a surface), flip, mutual.

## Surface analysis

Display menu > Surface analysis, and Evaluate tab commands (`analysis-zebra` Alt+Z, `analysis-gaussian`, `analysis-mean`,
`analysis-draft` Alt+D, `analysis-comb` Alt+C). Viewer-only and per session, like the look; never saved in the part.

- Zebra stripes: a fragment-shader hook on the body material (reflection of the view vector, stripes along world Y); density slider.
- Gaussian and mean curvature: principal curvatures per vertex from the kernel's vertex normals (shape operator per triangle,
  area-weighted over the face), blue to white to red, scale = 95th percentile of the absolute value; the legend shows the range.
  A sphere of radius R reads 1/R in both. Sheet normals have no outside, so the sign of mean curvature on a sheet follows its normal.
- Draft: colour by the angle of each face to a pull direction (+-X, Y, Z): green draft at least the minimum, red less than that, blue
  faces the other mould half. The default pull is +Y (the app is Y up).
- Curvature comb: teeth along edges and sketch curves, length proportional to curvature, the longest 12 percent of the model size
  times the Comb size slider, plus a line through the tooth tips.
- Hidden-line and wireframe styles draw no faces, so only the comb shows there.

## Not done

- Surface sweep: the kernel answers `TODO(rebuild): surface sweep`; no command.
- No kernel support yet for surfaceOffset, cutWithSurface, projectCurve, splitLine (all answer `TODO(rebuild) ... needs ck-ops`), so no creators.
- Extend takes one border edge per feature: several adjacent edges answer `extendNotBoundary`; a wavy spline wall answers
  "cannot be extended" at the default distance.
- fill guide curves and strength, freeform control-net handles, editCurve and rebuildFace editors, curve-driven pattern: no UI yet.
  Freeform and editCurve need handle editing in the viewport.
- Analysis is on the displayed mesh (tessellation), not exact surfaces; continuity (G1/G2) comparison between faces is not shown.
