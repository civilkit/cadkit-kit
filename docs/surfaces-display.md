# Surface bodies in the viewport

Features that make a sheet (Extruded / Revolved / Planar / Offset Surface, Trim, Fill, Extend, a sheet Knit, Delete Face,
Pipe Cutter, a Sweep or Loft with `surface: true`) leave a **surface body**: faces and edges but no volume. The kernel's regen
reply carries them in `surfaces` (`[featureId, body]` pairs, the same face / edge / mesh record as `body`; faces are named
`<id>.S.<entity>` or `<id>.P`, edges `<face>#n`). `Session.bodyForView` hands the viewer only `body` (the solid) and drops
`surfaces`, so until now they were never drawn.

## Where they come from

The Session lives in the kernel repo and is not changed here. `apps/cad/src/surfaceView.ts` asks the kernel for the regen reply
itself, the same way the thread markers are fetched (`Controller.regenExtras`):

- Only when the document has a feature that can make a sheet (`makesSurface`). Other documents pay nothing.
- One extra `regen` on its own tag (`<session tag>-surf`; `-psurf` for a preview), with `opts.upTo` while rolled back.
- Live preview (dragging a handle, editing a field) fetches the candidate's sheets too, so they follow the edit; a failed or
  trapped request gives no sheets rather than an error.
- `Controller.bodyNow` attaches them to the view body as `surfaces: ViewSurface[]` (`id`, `mesh`, `edges`, `box`) and widens
  `box` to cover them (a part of sheets only has an empty solid box). If `Session.bodyForView` one day returns `surfaces`
  itself, only `surfacesFor` needs to change.

## How they are drawn

`@kit/viewport` `setBody` merges the solid and the visible sheets into **one mesh and one edge list** (`surfaces.ts`
`mergeBodies`). Face and edge names are unique across bodies, so picking, hover, selection highlight, section, measure and Select
all work on a sheet face or edge exactly as on the solid's, with no second code path.

- Material: the body's material is double sided, so both faces of a sheet are lit (the back is shaded with the flipped normal).
- Tint: sheet faces get a per-vertex colour (`SURFACE_TINT`, a cool teal) that multiplies the part colour; the solid stays
  white (unchanged). The tint is switched off in Hidden-lines (flat white), kept in Shaded, Wireframe and Ghost.
- Edges: sheet edges are in the same edge list, so they follow the Edges layer and the style rules (always in Wireframe and
  Hidden lines, faint through the surface in Wireframe, black in Hidden lines).
- Display styles apply to the merged mesh: Ghost makes sheets translucent too, Wireframe draws them colourless but still
  hiding and picking, the sketch editor's 25 percent fade covers them.

## Hide and show

H hides what the selection belongs to. `hideSelection` now takes `surfaceOf(name)`:

| Selected | H hides |
|---|---|
| a face or edge of a surface body | that surface body (its feature id goes into `Hidden.ids`) |
| a face or edge of the solid | the solid (`Hidden.body`) |
| faces of several bodies | each of them |
| a corner | the solid (nothing when the part has no solid) |
| a surface feature selected in the tree | its surface body |

The viewport rebuilds without the hidden bodies (the solid is left out of the merge when hidden, rather than the mesh being
made invisible), so a hidden sheet or solid stops picking too. Alt+H / "Show all" restores everything. Hidden state is for the
session and is not saved.

## Tree

All surface features use the `feature-surface` icon (`featureIconName`): Extruded, Revolved, Planar, Offset, Trim, Fill, Extend,
Pipe Cutter, Thicken, Sweep, Loft. Knit keeps its own icon. Before this, Extruded and Revolved Surface showed the solid icons.

## Inspect

- Mass properties and Interference are for solids: a part with no solid says "Only surface bodies here: they have no volume or
  mass" and Compute is off (`Controller.hasSolid()`); a part with a solid and sheets says "Mass counts the solid only; surface
  bodies add no volume" (`surfaces` prop of `InspectPanel`). The kernel's `massProps` already ignores sheets.
- Measure: picks of sheet faces and edges resolve from the merged view. The kernel's `measure` answers null for a sheet face;
  the single-face area and edge measures from the triangles and polylines still work.
- Section: the cut clips sheets with the solid; the cap is drawn for closed solids only, so a sheet shows an open cut.
- Status bar face and triangle counts include sheets.

## Sample

`surface-patch` (Samples): a base plate, a wavy spline wall (`surfaceExtrude`) standing on it and a floating rectangle
(`surfacePlanar`), so the list shows a solid and two sheets, a hover target on each and a Hide/Show case.

## Code map

- `packages/viewport/src/surfaces.ts`: `mergeBodies`, `mergedBox`, `vertexTints`, `surfaceOwners`, `SURFACE_TINT` (tests in
  `surfaces.test.ts`); `viewport.ts` `setBody` / `setHidden` use them; `styles.ts` `applyBodyLook(..., tinted)`.
- `apps/cad/src/surfaceView.ts`: which features make sheets, decoding the kernel's `surfaces`, the extra regen, merged view
  (tests `surfaceView.test.ts`, `surfaceView.kernel.test.ts` with `CK_WASM`).
- `apps/cad/src/controller.ts`: `bodyNow`, `surfacesFor`, `surfaceBodies()`, `surfaceOf()`, `hasSolid()`; `lastView` is the
  merged view, `shown` keeps the bodies apart.
- `apps/cad/src/look.ts`: `hideSelection`.

## Not done

- Hiding one face of a sheet (same limit as solids).
- Face-direction shading (outside blue, inside red) from the original tool list: both sides are lit alike.
- A sheet is not offered a Properties/colour of its own; the part colour is tinted.
- Capping a section through a sheet (a sheet has no inside).
- `thicken`, `knit` and the other sheet operations have no creators in the ribbon beyond those already there; this change is
  display only.
