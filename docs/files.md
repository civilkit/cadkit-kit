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

## Old names
Parts used to be `.ckpart` with the format name `ck-part` (and `ck-part` before that). All three names are read: Open, drag and drop, the recent list and the library accept `.ckpart` and `.ckpart.gz`, and `normalizePartFormat` turns an old format name into `ck-part` in the document, so the next save writes the new names. Save As and downloads write `.ckpart` only.

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

## Compressed parts
A file whose name ends in `.gz` (`part.ckpart.gz`) is written gzip-compressed: the platform layer compresses when the name the file ended up with (the picker may change it) ends in `.gz`, so the Save As box, the browser's picker and a plain download all agree. Reading is by content, not by name: bytes that start with the gzip magic (`1f 8b`) are decompressed first, so Open, drag and drop and the recent list need no special case. The browser's `CompressionStream` does the work; where it is missing the text is written plain (the file still opens). The kernel and the corpus tools read plain JSON only: `gunzip` a part before giving it to them.

## Geometry in the file
A big part takes a while to rebuild (SELENE-showcase: about 19 s), and the view cache that makes the second open instant lives in the browser, so a file opened on another machine, or after the cache was cleared, still rebuilds. **More file actions > Save geometry in file** (also a box in the Save As dialog when the browser has no file picker) keeps the built view inside the file: a top-level `viewCache` field, the same snapshot the cache holds (mesh welded, edges, sketch frames, feature statuses, errors) as base64. Opening such a file shows the model and the tree about a second after the drop; the kernel rebuilds behind it, as for a cached view, and the result replaces it.

- **It is a cache, never an input.** The field carries the SHA-256 of the recipe as written (the document without its `fonts`, `thumbnail` and `viewCache`) and the build id of the kernel (the hash of its wasm). The view is used only when both match what is being opened; an edited file, a file saved by another kernel build, or a damaged field is ignored and the part rebuilds as always. Nothing else reads the field, so removing it from the JSON is always safe.
- **Size.** About 2.6 MB of binary (3.4 MB as base64) for SELENE's 185,000 triangles, on top of the 1.9 MB recipe: 5.3 MB in all, 3.5 MB with `.gz` (base64 of compressed bytes does not compress again). It is off by default for that reason; the choice is remembered, and a file opened with its view keeps it when saved.
- **Autosave** never writes the view (it runs often and the session already restores through the cache).
