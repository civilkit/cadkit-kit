# Sketch tools

A tool is a pure state machine (`Tool<S>` in `types.ts`): `step(state, event, draft, settings)` returns the next
state, the next draft, a preview to draw, the on-view fields and an optional hint. No DOM, no Three.js, no kernel
calls. The viewport turns pointer input into plane coordinates and snap hits; the controller previews the draft.

## Rules for a new tool

1. One file per tool (`<name>.ts`) with an exported `<name>Tool: Tool<State>` and its state type; export both from `index.ts`.
2. Build drafts only with the helpers in `builders.ts` (`addPoint`, `addLine`, `addConstraintOf`, `nextId`). Drafts are
   immutable: never mutate the one you were given.
3. Reuse a snapped existing point (`snap.pointId`) instead of adding a duplicate; shapes that meet share point ids.
4. Kernel conventions (checked against the solver and the fixtures): entities `line {p1,p2}`, `circle {c,r}`,
   `arc {c,p1,p2}`, `ellipse {c,p,r}`, `point {p}`, `spline {pts}`, `cvspline {pts}`; `construction: true` marks a
   construction entity. Constraints: `horizontal`/`vertical` take a line entity id; `distance` takes two point ids and
   a value; `coincident` takes two point ids. Before using any other constraint (`tangent`, `angle`, `equal`,
   `midpoint`, ...), probe the kernel for the exact `refs` convention and write the result in your tool's header.
5. Typed values: `field` with `commit: true` (Tab or Enter) locks a driving dimension and writes its constraint; without
   `commit` it only previews. `Escape` clears typed values first, then ends the shape. All text is an i18n key
   (`app.sketch.*`), never display text.
6. Honour the settings: `autoConstraints` (and Shift) for inferred constraints, `onViewValues: 'off'` returns no fields.
   Return inferred constraints as `pending` so the viewport can show them before the click.
7. Tests: pure tests in `tools.test.ts` style (events in, draft out), plus at least one test in `kernel.test.ts` style
   that regenerates the drawn sketch with the real kernel (`CK_WASM`) and checks the resulting size and that the
   solver status reports no conflicts.
8. A task is not done until `npx tsc --noEmit -p tsconfig.json` and `CK_WASM=... npx vitest run packages apps` are clean.

Reference tools: `line.ts` (chained, typed length and angle, H/V inference, close on first point) and `rectangle.ts`
(two corners, typed width and height).

## Edit and reference tools added after the first set

Each one has its conventions in its file header; the short version:

- `offset` (`offset.ts`): click a line/arc/circle (selects its connected chain, Shift-click toggles one entity), Enter,
  then the pointer picks the side and the distance (or type `d`). Copies are parametric: lines get `parallel` +
  `pldist` (driving, value = the distance), arcs and circles share the original's centre point and get `raddiff`.
  Corners are joined at the intersection of the offset curves (trim/extend); collapsed segments are dropped with a hint.
- `construction` (`construction.ts`): click to flip an entity between normal and `construction: true` (Shift-click: the whole
  chain). `markNewAsConstruction(prev, next)` is the per-sketch "draw as construction" mode (the app applies it after
  draw-group tool steps while the banner toggle is on). The kernel's profile builder skips construction entities, so
  they are never extruded (kernel test); the viewport draws them dashed.
- `project` (`project.ts`): the only tool that looks at the body. `Tool.step` takes an optional fifth argument `env`
  (`ToolEnv`: the sketch plane frame, the body's edges as world polylines, the pick radius, and what was selected in the
  3D view before the sketch opened); the app builds it in `runTool` from `controller.sketchFrame()` and
  `controller.bodyEdges()` (edges carry their `pts` polyline from the regen reply; no kernel change was needed). Hover
  previews the projection of the nearest edge, a click projects it, Enter projects the pre-selection (edge keys, and the
  boundary edges of selected faces, including the face the sketch sits on). Result: fixed points, `construction: true`
  and `ext: true` entities (line / arc / circle by fit, else a spline). Limits are listed in the file header: a
  snapshot (not associative), tilted circles become splines, edges square-on to the plane are skipped, and body picking
  stays off while sketching, so the pre-selection must be made before the sketch opens.
- `pattern-linear` / `pattern-circular` (`pattern.ts`): copies of selected entities along a line or around a centre.
  The spacing (linear: `hdist` + `vdist`, or `horizontal`/`vertical` plus one `hdist`/`vdist`) and the step angle
  (circular: an `angle` between construction radial lines) are visible driving dimensions; the placing of every other
  point against its anchor is written with `hidden: true` constraints (`annotate` skips them, the list shows them).
  Arcs are copied with `equal` radius rather than a placed centre to avoid a redundant constraint (the solver already
  ties an arc's ends to one radius). Copies follow the spacing, not later reshaping of the original.
- `extend` (`extend.ts`): the counterpart of Trim. Click a line or arc near the end to lengthen: it runs on (a line straight,
  an arc round its own circle) to the nearest boundary line/arc/circle. A point already at that place is reused (so
  outlines close with a shared point); otherwise a new point is bound with `pointOnLine` / `pointOnCircle`.
- `mirror` (verified end to end, `mirror.kernel.test.ts`): selection is drawn highlighted so Enter reaches the tool (it used to
  confirm the sketch instead, so the axis step was unreachable); circle copies get `equal` radius; arc copies avoid the
  redundant constraint (see the header of `mirror.ts`).

## Move, copy, rotate, scale; snaps; definition

- `transform` (`transform.ts`): four tools from one factory (`makeTransformTool`) and the pure `applyTransform(draft, ids, xform, copies)`. They act on
  `ToolEnv.entities` (the entities selected in Select mode before the tool was chosen) or on entities clicked in the tool
  (clicks read `snap.entityId`, which the on-curve snap supplies). Details and constraint handling are in `docs/sketch-tools.md`.
- `ToolOutput.from` is the start of the shape being drawn (the line tool sets it); the app passes it to `snapAt` for the
  perpendicular and tangent snaps. `SnapHit.role` says what an existing-point snap is; `entityId` / `entityIds` name the
  curves of an on-curve, quadrant, perpendicular, tangent or intersection snap, and `applySnapConstraints` turns them into
  point-on-curve constraints.
- `define.ts` (`fullyDefine`, `definitionMap`) and `refdims.ts` (reference dimensions) take a `solve` callback or only the draft:
  no kernel dependency in the package; the app passes `Controller.probeSketch`.
