# Feature tree and keyboard interaction

Branch `tree-interaction` (from `ui-sketch`). Covers the "Feature tree" and "Keyboard shortcuts" rows of `gui-parity.md`.
Pure logic is in `apps/cad/src/treeActions.ts` and `treeCommands.ts`; the wiring is `useTreeInteraction.ts`; the rows are
`packages/ui/src/FeatureTree.tsx`.

## What works

| Feature | How |
|---|---|
| Rename a feature | `F2` on the selected row, then type; Enter commits as `set name` (one undo step), Esc cancels, an empty or unchanged name cancels. |
| Rename the part | Double-click the part name (top bar or tree head), or `F2` with no feature selected. Enter / leaving the field commits. |
| Rollback marker | A "model is here" line in the tree (at the end by default). Drag it between rows, focus it and use Up / Down / Home / End, use the row button "Roll back to here", or "Roll forward" on the line (also the palette command). Features below the line are greyed and not built; the viewport shows the model at that point. |
| New features while rolled back | They are inserted right after the marker (`add` with an `index`) and the marker moves past them. Sketches started while rolled back are previewed on the same prefix. |
| Double-click a feature row | Opens its editor (a sketch row enters sketch edit; this already worked and is unchanged). |
| Double-click a body face | Selects the feature that made the face (`F2.C1` is owned by `F2`) and opens its editor. Not while a sketch is open. |
| Delete | `Delete` or `Backspace` on the selected feature(s), or the row's trash button. A "Deleted F5" toast with an Undo button follows. If something not selected still uses a feature, the session's refusal is shown (it names the dependents); dependents that are selected too go with it. |
| Multi-select | Ctrl/Cmd-click toggles, Shift-click takes the range. Delete, the suppress button and `Ctrl+Shift+U` act on all selected. |
| Dependents | With a row selected, rows that refer to it (as a sketch, a path, a seed, or the prefix of a face / edge name) get a thin marker on the left (`dependents()` in `treeActions.ts`). |
| Suppressed / failed rows | Unchanged (dimmed italic, red with the hint). |
| Redo | `Ctrl+Y` as well as `Ctrl+Shift+Z`. |
| Rebuild | `Ctrl+B` (also in the palette). |
| Select all | `Ctrl+A`: every face, edge or corner, depending on the pick mode. |
| Escape | Clears the selection (model and tree) first; when nothing is selected it closes dialogs as before. Inside a sketch it still cancels the sketch. |
| Arrows | Turn the view 15 degrees when focus is on the canvas or the page (not in a field or a panel) and no sketch is open. `Alt+arrow` pans. |

## Hover highlight and hide (branch kit-treehover)

| Feature | How |
|---|---|
| Hover a row | The 3D view tints what the feature made: faces and edges whose names start with its id (`F5.S.e1`, `F5.C1`), a sketch's curves, a curve, a datum plane's quad. In an assembly an insert row tints its component (names carrying `@F6.1`). Colour: pale amber (`FEATURE_HOVER` in `viewport.ts`), softer than the face hover blue and the selection blue. A feature that only modifies faces (fillet) shows the faces named after it. Rows the rollback bar greys out make no geometry, so nothing is tinted. The Outliner component rows do the same through `AsmHost.hover`. Reference planes keep their own plane highlight. |
| Hover a face in the view | The owning feature's row gets a left amber mark (`.row.hov`) and is scrolled into view (`block: nearest`). Not while a tree row is hovered or a sketch is open. |
| Eye | View-only hide of the feature's faces, edges and sketch curves, see `display-styles.md`. Dimmed row, closed eye, Alt+H / Show all restore. Per session. |
| Pause button | Suppress / unsuppress (rebuilds); `Ctrl+Shift+U` unchanged. |

Code: `Viewport.setFeatureHover(ids)`, `setOwnerFn`, `viewOwner` in `treeActions.ts`, props `hiddenIds`, `onToggleHide`,
`onHoverFeature`, `hoverId` of `FeatureTree`. Not done: a "Solid Bodies" folder and a right-click menu on tree rows do not
exist in this app, so there is nothing to hook there; pattern rows do not tint their copies.

## New keys

`F2` rename, `Delete` / `Backspace` delete, `Ctrl+Y` redo, `Ctrl+B` rebuild, `Ctrl+A` select all, `Ctrl+Shift+U`
suppress / unsuppress the selection, arrows orbit, `Alt+arrows` pan. `S` stays Sketch, so suppress uses `Ctrl+Shift+U`
(`Ctrl+Shift+S` is Save As in browsers).

## Conflicts with the original, left alone on purpose

- **`F`**: opens the command search here; the original uses it for another command. Not changed.
- **`P`**: toggles the projection (perspective / parallel) in the model here, and is Project inside a sketch; the original's
  `P` is the point-sketch key. Not changed.

## What the session could not do

1. **Rollback cannot be committed.** The kernel honours a numeric `rollback` on the document and `upTo` on a regen request
   (`regen.rs`), and `Session.preview(ops, { upTo })` reaches the latter, but `EditOp` has only `add / set / remove /
   move / replace`, all addressed to a feature id. There is no document-level op, so `doc.rollback` stays `null`. The marker
   is therefore view only: it lives in the controller (as the id of the last included feature, so it survives inserts, moves,
   deletes and undo), is not saved with the file, and is not an undo step. Consequences: Save, STEP export and the design
   checks use the whole model; the Diagnostics statuses still cover every feature; reloading drops the marker. If the session
   gains a `{ op: 'setDoc', path, value }` (or a `rollback` field on `edit`), `Controller.setRollback` is the one place to
   change.
2. **No document rename op** for the same reason. The part name is kept in the controller and applied by `document()`, so the
   top bar, Save and the dirty marker see it; it is not an undo step and is reset by loading another part.
3. **No regen cache to bypass.** The kernel has no cache option (`noCache` does not exist): every regen builds the whole
   part, so `Ctrl+B` simply rebuilds from the document and shows a "Rebuilt" notice.
4. A rollback to before the first solid shows an empty view (the preview then carries only sketches, which the controller
   does not turn into a view body).
5. "Delete with sketches" and hide / show are out of scope here. Folders and the tree's right-click menu are described under Folders below.

## Tests

- `treeActions.test.ts`, `treeCommands.test.ts`: pure functions and key dispatch.
- `FeatureTree.test.tsx`: rename, multi-select, dependents, rollback marker (drag, keys, buttons).
- `useTreeInteraction.test.tsx`: the wiring with a stub controller.
- `controller.tree.kernel.test.ts` (needs `CK_WASM`): rename, part rename, delete with dependents, rollback preview, insert at the
  marker, marker repair after delete and undo, preview while rolled back.
- `Toast.test.tsx`: notices with an action.

Nothing was looked at in a browser; the viewport additions (`onBodyDouble`, `panBy`) are covered by type checking only,
as WebGL is not available in the test environment.

## Folders

A folder is not a record of its own: it is the `group` name on features (what the script helper `group()` writes), and the tree
shows a run of two or more consecutive top-level rows with the same name under one folder row. So a folder is always a
contiguous range of the build order, and nothing about it changes how the part regenerates. The names are in the document and
survive save and load; open / closed is a per-document choice kept in the browser (`cad.treeFolders`), not in the file.
`treeFolders.ts` turns each action into edits: select two or more neighbouring rows and use Group into folder (right-click
menu or Ctrl+G); the name starts as "Folder" ("Folder 2" ...) and is in rename mode at once. Double click a folder, or use the
menu, to rename it (a name another folder has is refused); Ungroup removes the name and leaves the features where they are;
Delete folder deletes its features through the normal delete (refused, with the reason, while a feature outside still uses
one of them) and offers Undo; Remove from folder takes features off the first or last end of a folder. Drag a row onto a folder
to join it (it goes to the end of the folder), onto a row inside a folder to take that place, onto a row outside to leave; drag
a folder header onto a row or another folder to move the whole folder (a row inside a folder stands for that folder; folders do
not nest). A row travels with the sketches tucked under it. A move is refused with a short message when it would put a feature
before one it uses, when the rows to group are not neighbours, or when it would split a folder. Name changes and grouping are
`set` / `replace` ops in one `controller.edit`; anything that changes the order goes in as one document patch (`order` in
`DocPatch`, because the session checks each `move` of a batch against the document before any applies, so a feature cannot be
moved past its own sketch that way). Every action is one undo step. Tests: `treeFolders.test.ts` (grouping, naming, ungroup,
refused moves), `treeFolders.ui.test.tsx` (menu, rename, drag), `controller.folders.kernel.test.ts` (undo, redo, reload; needs
`CK_WASM`). Not looked at in a browser.
