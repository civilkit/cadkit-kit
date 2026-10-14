# File handling

Code: `apps/cad/src/files/*`, `packages/platform/src/{fsaccess,web}.ts`. Wiring in `apps/cad/src/main.tsx`.

## Autosave and restore
- `cad.autosave.v1` in localStorage holds `{name, doc, savedAt}`, written 400 ms after the last change while the part is changed
  since the last save/open, and at once on `pagehide` / hidden tab.
- A document over 2 MB of JSON is skipped, and a quota error is caught; each problem is announced once (notice).
- Save, Open, Samples and New clear it. On start, a stored session with at least one feature opens the "Restore your last
  session?" dialog (Restore / Start new). Escape does nothing there, so a stray key cannot discard it. A restored part counts
  as changed (it was never saved to a file).

## Save, Save As, file name
- `Save` (Ctrl/Cmd+S) writes to the remembered file: the same handle where the File System Access API exists
  (`showSaveFilePicker`, Chromium), otherwise a download named after the file / part. The first Save with a picker asks where.
- `Save as` (Ctrl/Cmd+Shift+S): with a picker, the browser's dialog; without one, a small dialog asks for the name (`.ckpart` is
  appended). The name becomes the part name (title bar, saved file, autosave). The document model has no root `set` op yet, so
  the chosen name is held by the app (`FileManager.partName`) and applied on save; it is not an undo step.
- Cancelling the picker does nothing. The unsaved-changes dialog's Save only goes on when the save really happened.

## Recent
- The Samples dialog has a Recent section (last 8 samples and files, with age). Names and times are in `cad.recent.v1`;
  handles of saved files are in IndexedDB (`cad.handles.v1`). Clicking a file reopens it if the browser still grants
  permission; otherwise a notice says to use Open. Files opened through the plain Open dialog have no handle (the API used there
  is an `<input>`); they are listed but explained, not reopened.

## Drag and drop, Open by type
Dropping one file (or choosing it in Open) routes by extension: `.ckpart`/`.json` load with the unsaved-changes guard;
`.step`/`.stp` import as a new part; `.dxf` goes into the open sketch, else a new sketch on the front plane; `.stl` says mesh
import is not available; anything else gets a notice. More than one file: notice. A dashed overlay shows while dragging.

## STEP import (view only)
`Import STEP` (command) and Open/drop create a blank part named after the file and show the imported solid in the viewport
(`Controller.importStep`, `files/stepImport.ts`, kernel `importStep`). The kernel imports into a body of its own, not a feature,
so the solid is not part of the document: it is not saved with the `.ckpart` and the next edit replaces the display. Making
it a feature (an `importBody` feature carrying the STEP text, or `insertPart` of a stored body) is a model change and the
natural next step. Round trip tested on the real kernel: box -> STEP -> import -> same volume and size.

## Units
The document has no unit field: everything is millimetres (Check and Inspect panels, exports). A display unit would need a
document or preference field and conversion in every panel, so it was not added.

## New part
`New` opens a blank part named Part1, Part2, ... (counter per session; opening a part named PartN moves the counter past N).
