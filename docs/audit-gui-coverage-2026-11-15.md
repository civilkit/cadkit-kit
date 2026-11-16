# GUI coverage audit, 15 Nov 2026

Why: the Surfaces tab showed three buttons (Planar, Fill, Thicken) with the other 11 surface commands hidden in dropdowns, far from a full surfaces ribbon. This audit asks, for every kernel feature type: can the GUI create it, does it have an editor, and is it findable.

## Method (static, 15 Nov 2026)

`FEATURE_TYPES` in the kernel's `packages/part-model/src/features.ts` (69 types) against: the kernel's not-implemented list, create sites in `apps/cad/src` (`type: '<t>'`), `case '<t>'` in `FeatureOptions.tsx` / `optionRules.ts` (a feature editor with its own options), `feature:<t>` in `helpMap.ts`, and the word in `guide/src`. This is a text search, so it shows where something is missing, not that the rest works. **Nothing here was exercised in the running app except Extruded surface and Thicken.**

## Findings

- **Not creatable from the GUI:** fillpattern, spattern, cutWithSurface, knurlBand. `fillpattern` and `cutWithSurface` are not implemented in the kernel (`crates/ck-model/tests/not_implemented_code.rs`). `spattern` is in the kernel and has no command. `knurlBand` has no create site (the knurl commands may reach it another way; check).
- **No feature-specific editor options** (they fall back to the plain editor or another editor file; check each in the app): sketch, sketch3d, draft, hole, helix, lip, fillpattern, spattern, surfacePlanar, surfaceRevolve, surfaceExtrude, surfaceOffset, insertPart, mate, deleteFace, cutWithSurface, pipeCut, dome, splitLine, moveFace, axis, thread, knurlBand, importStep, repairPart, frame, torus, pipe, coil, boundingSolid, unfold, refold. Includes the 0.7.3 features torus, pipe, coil, boundingSolid, dome, splitLine and surfaceOffset.
- **Help map:** every type has an entry, so that column says nothing. Check that the pages are right, not just present.
- **Guide:** the word is missing for: sketch3d, fillpattern, spattern, surfaceRevolve, surfaceOffset, cutWithSurface, pipeCut, freeform, editCurve, splitLine, knurlBand, importStep, repairPart, boundingSolid, sheetRules, baseFlange, edgeFlange, contourFlange, sheetConvert, sheetCut, sheetCorner.
- **Ribbon (fixed here):** Surfaces now shows one button per command (Planar, Extruded, Revolved, Lofted, Fill, Offset, Extend, Trim, Knit, Thicken, Freeform). The Features tab shows Reference, Draft family and Bodies as plain buttons; only the long "parts" family stays a dropdown. The tool palette still groups them. A command can be placed once only (`toolbarModel.test.ts`), so Delete Face stays on Features > Bodies.
- **Against the reference ribbon:** Cut With Surface (kernel does not have it); Rebuild Face (kernel preset of Freeform, no button); Split Line (kernel yes, planar faces only; the command is "Split face" on Features); Offset Surface (plane, cylinder, cone, sphere, torus only); Fill without guide curves or strength.

## Still to do

1. Walk every command in the running app and record: opens, previews, confirms, edits, undoes, survives save and reopen, plain-language error when refused.
2. Look at each type in the no-editor list above in the app, and add proper options where the plain editor is not enough.
3. Decide Cut With Surface, Rebuild Face, spattern and Split Line on curved faces.
4. Compare the other tabs (Home, Sheet metal, Assembly) with a reference ribbon the same way.
