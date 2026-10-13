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
