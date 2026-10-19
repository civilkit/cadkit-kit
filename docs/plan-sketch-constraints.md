# Plan: better constraints in the sketch editor

Status: plan, 2026-10-19. Nothing here is built. Related: `sketch-tools.md` (what exists), kernel `crates/ck-model/src/sketch/status.rs` (solver status).

## What exists already
- Kernel solver status: `dof`, `state`, `conflicts`, `redundant`, `solved`. Chip in the aux bar ("N degrees of freedom", "Fully defined", "Over-constrained").
- Colour by definition (blue = can still move, dark = defined, red = conflicting), found by pinning each point (up to 60 solves, debounced 350 ms).
- Conflict list with delete buttons; constraint panel with red/amber rows; hover lights what a row names.
- Fully define (relations as drawn, then dimensions); reference dimensions; snaps that write constraints; `sketchOpenChains` and `sketchShapes` in `packages/sketch/src/shapes.ts`.

## What is missing, by your four points

### 1. Setting constraints better
- **Inference while drawing** (the main gain): the cursor shows the constraint it will write before the click (horizontal, vertical, coincident, tangent, on-curve, equal), as a glyph beside the cursor; Shift or a click on the glyph turns it off. Today snaps can write constraints but there is no preview of which.
- **Select-then-act**: select 1 to 3 entities and the aux bar offers only the constraints that apply (line: H, V, fix, length; two lines: parallel, perpendicular, equal, angle; line + circle: tangent). A kind that would conflict is greyed with the reason.
- **Smart dimension**: one tool; click the thing and it picks length, radius, diameter or angle; two things gives a distance or angle. Value box opens at once.
- **Batch**: "apply horizontal/vertical to all near-axis lines", "make selected equal", "mirror constraint about an axis". (Fully define already does the whole sketch; add it for a selection.)

### 2. Finding what is unconstrained easier
- **Free-direction arrows**: on a blue point draw small arrows for the directions it can still move (x, y, or along a curve), instead of only a colour. Source: the null space of the solver Jacobian. This needs a kernel query `sketchFreedoms` returning, per point, the free directions and per circle/arc whether radius is free. It replaces the 60 probe round trips with one call and fixes the "half determined" case (one free direction shown as one arrow).
- **DOF filter and list**: a panel list "Under defined (7)" of the entities; click zooms and selects; "next free" key (F8-style) cycles through them.
- **Drag test**: dragging a blue point moves it and springs back on release (a preview solve), so the user sees what is loose.
- **Per-axis status** in the chip: "2 free: 1 position, 1 radius".

### 3. Adjusting and editing constraints
- **Click a glyph or dimension to select it**; the aux bar shows its kind, value, the entities it names, with Delete, Convert (driving to reference), Suppress.
- **Suppress** (disable without deleting): a flag in the constraint, solver ignores it. Needs a kernel field `suppressed`; sketch status reports it.
- **Replace**: change kind in place (distance to horizontal distance, coincident to point-on-curve) keeping its names; today you delete and re-add.
- **Edit a dimension numerically with expressions** (exists via equations) plus an on-canvas drag of the dimension value.
- **Why-is-this-conflicting**: selecting a conflict row highlights the smallest set that conflicts (kernel already lists `conflicts`; add the minimal subset), with a one-click "make this one reference".
- **Undo granularity**: each constraint add/remove is one undo step (check, fully define already is one).

### 4. Finding unconnected wires (the sketch analyzer)
CATIA's "Sketch Analysis" and SolidWorks' "Check Sketch for Feature Usage" report open contours, overlaps and so on. Ours:
- **Kernel query `sketchAnalyze(featureId)`** returning structured findings, each with entity ids and a location:
  - `openEnd`: an endpoint touching nothing, with the distance to the nearest other endpoint ("gap 0.02 mm to e7 start"), so near misses are visible.
  - `nearCoincident`: two points closer than a tolerance but not constrained coincident.
  - `selfIntersection`, `overlap` (two collinear or coincident segments), `duplicate` (same entity twice), `zeroLength`, `tinySegment` (below a length), `branch` (more than two edges at a point), `isolatedPoint`.
  - `closed` / `open` per chain, and why a sketch has no profile (feeds `noClosedProfile` with a reason and the gap location).
- **Analyzer panel in the GUI**: lists findings; click selects and zooms; markers drawn in the viewport (red ring on open ends with the gap value, orange on overlaps).
- **One-click repairs**: "close gap" (adds coincident between the two ends), "merge duplicates", "remove zero-length", "trim overlap". Each is one undo step and previews first.
- **Extrude/revolve errors link here**: when `noClosedProfile` happens, the message offers "Analyze sketch" and shows the biggest gap.
- This also serves the original aim: an LLM driving the kernel gets the same structured findings instead of a bare `noClosedProfile`.

## Order of work
1. **Kernel**: `sketchAnalyze` (item 4) and `sketchFreedoms` (item 2). Both are read-only queries, low risk, with tests on small fixtures. Then `suppressed` constraints (item 3). Size M.
2. **Analyzer panel + repairs** in the kit (item 4 UI). Size M. Quickest visible win for "my sketch will not extrude".
3. **Free-direction arrows and the under-defined list** (item 2 UI), replacing the probe loop. Size M.
4. **Constraint inference preview and select-then-act bar** (item 1). Size L; biggest change to how drawing feels.
5. **Selection, suppress, replace, minimal conflict set** (item 3 UI). Size M.

## Tests
- Kernel: fixtures for each finding kind (open square with 0.02 gap, duplicate line, overlapping collinear lines, tee junction, zero-length line); `sketchFreedoms` on a point on a circle (one free direction), on a free point (two), on a fully defined sketch (none); suppressed constraint ignored.
- Kit: panel tests with fixtures; repair round trip (close gap makes the sketch extrude); kernel tests in the existing `*.kernel.test.ts` style.
- Differential: check whether the original kernel has a sketch analysis query (search the Ghidra dump for strings like "open", "overlap", "duplicate" near the sketch code) and mirror its finding names where present.

## Open questions for you
- Tolerance defaults: near-coincident 0.01 mm? tiny segment 0.001 mm?
- Should "close gap" move one endpoint or both to the midpoint? Proposed: move the free one onto the other, or the midpoint if both are free.
