# Panel layout and resizing

The left panel, the right (properties) panel, the bottom drawer and the floating left panel are resizable. Sizes persist with the rest of the workspace settings.

## Where things live

| Piece | File |
| --- | --- |
| `Splitter`, `CornerGrip`, `resolveDrag` | `packages/ui/src/Splitter.tsx` |
| Size fields, defaults, `resetLayout` | `packages/store/src/index.ts` (`Workspace.leftWidth`, `rightWidth`, `drawerHeight`, `floatWidth`, `floatHeight`; `DEFAULT_SIZES`) |
| Wiring, limits, live CSS variables | `apps/cad/src/useLayout.tsx` |
| Grid, clamps, handle styling | `apps/cad/src/app.css` (end of file, and the `#app` rules at the top) |

## Behaviour

- Drag a handle with a mouse, pen or finger (pointer capture; `touch-action: none`). The hit area is 8px, the line 2px and it lights up on hover, keyboard focus and while dragging.
- While dragging, `html[data-resizing]` is set: no text selection, the viewport ignores the pointer, the cursor stays `col-resize` / `row-resize` / `nwse-resize`.
- Keyboard: the handle is a focusable `role="separator"` with `aria-orientation`, `aria-valuenow/min/max`. Arrow keys move 16px (Shift: 64px), Home and End jump to the minimum and maximum, Enter or a double click resets to the default.
- Limits: side panels 200px to 60% of the window width, drawer 80px to 70% of the window height, and the 3D viewport always keeps 320px (when both panels are open each one's maximum accounts for the other). Floating panel: 200px to 60% wide, 120px up to the viewport height.
- Snap to collapse: dragging a panel more than 48px under its minimum folds it away (same state as the hide toggle: `leftCollapsed`, `rightPanel: 'off'`, `drawerOpen: false`). Dragging from the edge of a folded panel past half of the minimum opens it at the minimum or wider. The left splitter stays at the window edge while folded; the drawer splitter sits just above the status bar; the right splitter at the right window edge.
- Floating left panel: drag its right edge (width) or the bottom-right corner grip (width and height). `floatHeight: 0` means "fill the viewport height". Enter or double click on the corner resets both.
- At 760px wide or less the panels are overlays and the splitters are hidden; the old behaviour is unchanged.

## How it stays smooth

During a drag only CSS variables on `#app` change (`--lw`, `--rw`, `--dh`, `--fw`, `--fh`, plus the `-user` variants); nothing re-renders. The viewport's `ResizeObserver` follows the grid and calls `resize()`. On release the value is committed once with `store.setWorkspace(...)`, the inline overrides are dropped, and `main.tsx` persists the workspace to `localStorage` (`cad.workspace`, in a try/catch).

The stylesheet clamps stored sizes to the current window (`clamp(200px, var(--lw-user), 60vw ...)`), so a size saved on a large monitor cannot swamp a smaller window.

## Phone and tablet

One codebase, three layouts. `apps/cad/src/layoutMode.ts` holds the `layout` signal (`phone`, `tablet`, `desktop`) computed from the window size and `pointer: coarse` (phone under 700 px wide or a touch device with a short side under 500 px; tablet under 1100 px or any coarse pointer), and the user's override (`cad.layout`: auto, phone, tablet, desktop; Settings, Layout tab). `#app[data-layout]` carries it, and the touch rules in `app.css` (end of the file) are scoped to it, so the desktop layout is untouched.

`effectiveWorkspace(workspace, layout)` is the workspace the layout draws; the stored workspace (what Settings edits and `cad.workspace` saves) is never changed by it. Tablet: one top bar row, compact ribbon, docked tree and properties (30% of the window at most, so the canvas keeps 320 px), no document strip for a single document.

Phone (grid areas `top`, `vp`, `sheet`, `skact`, `status`, `nav` in `app.css`): no docked or floating panel, no tool rail, no drawer, no ribbon row and no document strip. The top bar (`.phone-bar`, about 48 px) is the file menu (a `Slot` menu), the title (`tabs/DocSwitcher.tsx`: tap for the open documents and New), undo, redo and a "more" menu (search, Part / Drawing, rename, settings). The bottom bar (`BottomNav`, 52 px) is Tools, Tree, Properties, Diagnostics; with the sheets closed the two bars take about 100 px, and the status line is hidden (a sketch brings it back for its snap and grid toggles). **Tools** opens `ToolTray` (`packages/ui/src/ToolTray.tsx`) on the bottom bar: the ribbon's tabs as chips and one labelled, sideways-scrolling strip of the active tab's tools (the same commands and layout as the `Ribbon`); a tool pick, Escape or a tap on the scrim dismisses it. While a sketch is open its action bar (Done, Cancel shape, Undo, Delete: the keys a phone lacks) sits between the canvas and the bottom bar.

The tree, the properties or editor, and the drawer are `Sheet`s (`packages/ui/src/Sheet.tsx`) with `docked`: the sheet is a row of the page grid, not an overlay, so `#vp` shrinks to the room above it (the existing `ResizeObserver` resizes the renderer; the camera keeps its field of view, so the model stays in frame). Snaps are shares of the screen height: an editing sheet (`SPLIT_FRACTION`) 18% / 38% / 60%, a browse list (`BROWSE_FRACTION`) 20% / 45% / 90% with a scrim only at its full snap; each sheet opens at its middle snap. It moves with its handle (a fast flick goes to the next snap), closes by dragging under the lowest snap, with Escape and with its close button. `watchViewport` publishes the on-screen keyboard (`--kb-inset`, `--vvh`, `--vv-top`, and `data-kb` on the root while it covers 120 px or more): the phone app is as tall as the visible area, the bars hide, and the sheet and the canvas share what is left, so the focused field is never behind the keyboard.

Numeric fields (`ExprInput` and the plain `type="number"` inputs) ask for `inputmode="decimal"` (a count: `numeric`) and `enterkeyhint="done"` (`next` when another field follows); on a coarse pointer a field that takes expressions also shows an "ƒ" key (digit pad or full keyboard) and a "±" key.

Sketching by finger (`packages/viewport/src/viewport.ts`): with a tool active `controls.touches.ONE` is off, so one finger never orbits and two fingers still pan and pinch. The viewport reports a finger as `press` (the spot, for the snap marker), `dragstart` (it left the spot by 8 px: the app sends the tool its first click there unless the tool already has a first point) and a `click` where it lifts; `cancel` (a second finger, `pointercancel`) restores the tool's state from the press. A tap is a press and a lift within 8 px, so tap-tap placement is unchanged. Pick and snap radius is 24 px for a finger (12 for a mouse). A circle placed by a drag is selected and its radius field focused. Dragging the view cube (one finger, pointer capture, `touch-action: none`) orbits through the same `OrbitRig` as the canvas.

The viewport keeps a `TouchGuard` (`packages/viewport/src/touchguard.ts`): a second touch cancels the first finger's click, point drag, rubber band and box select (`cancelGesture`), and the canvas ignores pointer events until the last finger is up; `pointercancel` runs the same cancel. `tools/ux/mobile.mjs` checks all of this in a browser with touch emulation.

## Sketch mode

While a sketch is open the chrome rearranges once, by `sketchChrome(workspace, sketching)` (`toolbarModel.ts`): the sketch controls
in the Sketch ribbon tab (Finish, Make, Construction, Status; nothing floats over the canvas), with a floating sketch bar
(`SketchBar.tsx`, `.sketch-bar-wrap` in app.css) only as the fallback when the ribbon is off, the sketch tools in exactly one place (the
Sketch ribbon tab, or the left column in the Plasticity preset, or the floating palette in Minimal), and the constraint list as a
popover. See `docs/toolbar.md`.

## Reset

`Reset layout` (command search, and the Layout tab of Settings) restores `DEFAULT_SIZES` and unfolds the left panel. Applying a layout preset keeps the stored sizes.

## Known limits

- Opening a folded panel by dragging shows the result on release (the panel is not mounted while folded), except the left panel which grows blank while dragging.
- Folding a panel is previewed live, then the panel disappears one frame after release.
