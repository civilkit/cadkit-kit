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

## Sketch mode

While a sketch is open the chrome rearranges once, by `sketchChrome(workspace, sketching)` (`toolbarModel.ts`): one sketch bar at the
top centre of the viewport (`SketchBar.tsx`, `.sketch-bar-wrap` in app.css; it keeps 400 px free on the right for the Display button and
view cube, and under 900 px sits between the left column and the right-hand controls), the sketch tools in exactly one place (the
Sketch ribbon tab, or the left column in the Plasticity preset, or the floating palette in Minimal), and the constraint list as a
popover. See `docs/toolbar.md`.

## Reset

`Reset layout` (command search, and the Layout tab of Settings) restores `DEFAULT_SIZES` and unfolds the left panel. Applying a layout preset keeps the stored sizes.

## Known limits

- Opening a folded panel by dragging shows the result on release (the panel is not mounted while folded), except the left panel which grows blank while dragging.
- Folding a panel is previewed live, then the panel disappears one frame after release.
