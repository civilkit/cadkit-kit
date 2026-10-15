# Thin wall (Extrude, Extruded cut, Revolve)

A wall of a given thickness from a curve, in one step. The curve can be OPEN (a C-shaped spline arc, a polyline) or closed
(a circle, a rectangle: the result is a hollow wall). The kernel side is the `thin` option of `extrude` and `revolve` (see
"Thin wall" in the kernel's `docs/spec-agent-interface.md`); this page is the editor.

## The Thin wall section

In the Extrude, Extruded cut and Revolve editors:

| Control | Field | Notes |
|---|---|---|
| Thin wall (checkbox) | `thin` | On: default thickness is 10% of the profile size, at least 1 mm. Off: the field is removed |
| Wall thickness | `thin.thickness` | A number or an `=expression` (variables work), unit mm |
| Side: Inside / Outside / Both / Mid | `thin.side` | Small icons show the band on the curve. Both adds "Other side thickness" (`thin.thickness2`) |
| End caps: Flat / Round | `thin.ends` | Only shown when the sketch has an open chain |
| Corners: Mitre / Round | `thin.cornerStyle` | |

`Inside` is the inside of the bend for an open curve and the interior of a closed loop. The preview is live; a thickness the
curve cannot take (past a radius of curvature, a short segment eaten by a corner) shows the kernel hint with the largest
thickness that works (`thinTooThick`: `minRadius`, `maxThickness`).

While Thin wall is on, the Shapes list also offers the open curves of the sketch ("Open curve 1 (n segments)"), so one
sketch can feed several features.

## Extruding an open profile without a thin wall

The dead-end "sketch profile is not closed" is replaced by a hint card in the editor:

- **Make thin wall**: turns the option on with the default thickness.
- **Close with a line**: adds the closing segment (one `replace` of the sketch, ONE undo step). The gap between the loose
  ends is shown in the card ("The ends are 3.2 mm apart", "Almost closed" when it is small against the profile) and as a
  red line on the sketch in the viewport. Disabled when the sketch has no single chain with two loose ends.
- **Extrude as surface**: turns the feature into a surface extrude of the same sketch (one step; Extrude only).

## The thickness handle

Select the offset wall of a thin feature (face `Fn.S.<entity>.W0`): an arrow along the wall drags `thin.thickness` live
(`Mid` walls grow on both sides, so the face moves half as far as the thickness changes). Release is one edit. Not offered
when the thickness is an expression.

## Code

- `apps/cad/src/thinRules.ts`: pure rules (read and patch the option, default thickness, `openProfile` and its gap,
  `closeWithLineOp`, `asSurfaceOp`). Tests: `thinRules.test.ts`.
- `apps/cad/src/FeatureOptions.tsx`: `ThinSection`, `OpenProfileCard`, `Segmented`. Tests: `ThinSection.test.tsx`.
- `packages/sketch/src/shapes.ts`: `sketchOpenChains`. `packages/viewport`: `highlightSketchGap`.
- `apps/cad/src/handles/plan.ts`: `thinThickness`. Tests: `handles/thinHandle.kernel.test.ts`.
- Kernel-backed tests (`CK_WASM`): `thinExtrude.kernel.test.ts` (C-shaped spline arc, circle, card actions, undo, sample).
- Sample: `thin-wall-bracket` (an open spline arc extruded as a mid wall, a sleeve revolved from an open profile).
