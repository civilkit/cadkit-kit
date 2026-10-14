# Inspect: mass properties, measure, section, interference

The drawer's **Inspect** tab (key `\` opens the drawer; the Evaluate ribbon tab and the command search open it too) holds
four tools. Nothing here edits the document: every result is a read-only query of the part as it is on screen.

| Tool | Command id | Key | Where |
|---|---|---|---|
| Mass properties | `mass-props` | | card in the tab, computed on open and after every edit |
| Measure | `measure` | `M` | card plus leaders and labels in the 3D view |
| Section view | `section-view` | | card plus a clipping plane in the 3D view |
| Interference check | `interference` | | card, run on demand |

Code: `apps/cad/src/inspect/` (`InspectPanel.tsx` is the view, `useInspect.ts` all the state, `geometry.ts` / `measure.ts` /
`mass.ts` the maths, `kernel.ts` the queries, `inspectCommands.ts` the ribbon entries), `packages/viewport/src/section*.ts`
and `measureMarks.ts` for the 3D side. Strings are in `locales/inspect.ts` (merged into the English catalogue).

## Mass properties

Volume, surface area, mass, centre of mass, bounding box and size, and the principal moments of inertia, from the kernel's
`massProps` (exact on the analytic geometry). Units: millimetres, grams, g/cm3 for the density, g mm2 for the moments.

- The density starts from the part's `material` (steel 7.85, aluminium 2.70, ... see `DENSITIES` in `mass.ts`). A material
  that is not in the table, or no material, leaves the field at 1 with a note asking for a density. The field is yours to
  change; mass and moments follow at once, no new request is made (the kernel returns unit-density numbers and the UI scales).
- A part of several solid bodies lists volume and mass per body.
- The result follows the part: after an edit it is recomputed, and `Out of date` shows for the moment in between.
- Copy puts `label<TAB>value` lines on the clipboard.

## Measure

Press `M` (or Start measuring). Picks now add up instead of replacing: pick one or two items, using the usual selection
modes (`Q` face, `E` edge, `V` corner). A third pick keeps the last two. The result is live; Copy puts `label<TAB>value` lines
on the clipboard; Clear picks empties the selection. A red leader with the value is drawn in the view.

| Picks | Results |
|---|---|
| corner | position |
| edge | length; a circular edge also radius, diameter, centre |
| face | area, surface kind; a cylinder, cone, sphere or torus also radius, diameter, centre |
| corner, corner | minimum distance, offset per axis |
| corner, edge | minimum distance |
| corner, face | minimum distance to the face's triangles, and the distance along the normal for a flat face |
| edge, edge | minimum distance; the angle (0 to 90) between two straight edges; two circles also centre distance |
| face or edge with a face | the kernel's `measure`: distance, normal distance, angle between the faces, per-item values |

Corners and edges are measured in the UI from the polylines the view already holds (an arc or curve is a polyline, so its
distances are as fine as the display tessellation). Anything with a face asks the kernel's `measure` request, which works on
the exact surface. A face against a corner is measured on the face's triangles because `measure` takes no corner references.
If the kernel cannot answer, a single face still shows its area from the triangles; otherwise the card says there is no
measurement for the pair.

## Section view

Pick Front, Top or Right (the plane starts through the middle of the part) or Selected face (one flat face must be selected;
the plane starts on it). The offset slider and the number field move the plane along its normal over the extent of the part,
Flip side keeps the other half, Off removes the cut. Front is the XY plane (normal +Z), Top XZ (+Y), Right YZ (+X); by default
the half the normal points to is cut away.

In the viewport it is `Viewport.setSection(spec | null)` with `spec = { normal, offset, flip? }` (plane `normal . x = offset`).
The body and its edges get a three.js clipping plane; the cut is closed by a cap drawn with the stencil technique of three.js'
`webgl_clipping_stencil` example (the renderer is created with `stencil: true`). The section survives rebuilds of the body and
tab changes. Selection, hover and the issue colours are not clipped.

## Interference check

Runs the kernel's `interference`: pairs of solid bodies (lumps) of the part that share volume, each with the shared volume. A
part with one solid says so. Clicking a pair selects the two faces the kernel names and frames them. The result goes
`Out of date` after an edit and is not recomputed on its own.

## Not done

- **Curvature map, zebra, continuity and draft analysis.** The kernel has `curvatureMap` / `comb` / `curvatureAt`, but a
  false-colour face overlay needs per-vertex values and a legend, and zebra needs a reflection shader: not cheap, skipped.
- **Mass properties of assemblies by part** (BOM) and materials per feature: the part has one material.
- Multi-body interference could only be tested for the empty answer: the kernel merges overlapping solids, so a part built
  from the feature set has no overlapping pair to test with.

## Kernel and session gaps

- `Session` has `massProps` but no `measure` or `interference`; `inspect/kernel.ts` reaches the session's transport directly
  (`sessionQuery`). Adding `Session.measure(refs)` and `Session.interference()` would remove that.
- `measure` takes no corner references and no point-to-face request; corners are handled in the UI.
- The `interference` pair names two face ids, not body ids; the list shows the features they belong to.
- `measure` returns the angle between faces in radians (converted here) and the angle of two parallel faces as 0.
