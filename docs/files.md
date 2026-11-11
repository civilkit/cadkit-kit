# File handling

Code: `apps/cad/src/files/*`, `packages/platform/src/{fsaccess,web}.ts`. Wiring in `apps/cad/src/main.tsx`.

## Autosave and restore
- `cad.autosave.v1` in localStorage holds `{name, doc, savedAt}`, written 400 ms after the last change while the part is changed
  since the last save/open, and at once on `pagehide` / hidden tab.
- A document over 2 MB of JSON is skipped, and a quota error is caught; each problem is announced once (notice).
- Save, Open, Library and New clear it. On start, a stored session with at least one feature opens the "Restore your last
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
- The Library dialog (was Samples) has a Recent section (last 8 samples and files, with age). Names and times are in `cad.recent.v1`;
  handles of saved files are in IndexedDB (`cad.handles.v1`). Clicking a file reopens it if the browser still grants
  permission; otherwise a notice says to use Open. Files opened through the plain Open dialog have no handle (the API used there
  is an `<input>`); they are listed but explained, not reopened.

## Drag and drop, Open by type
Dropping one file (or choosing it in Open) routes by extension: `.ckpart`/`.json` load with the unsaved-changes guard;
`.step`/`.stp` import as a new part; `.dxf` and `.svg` go into the open sketch, else a new sketch on the front plane; `.stl` says mesh
import is not available; anything else gets a notice. More than one file: notice. A dashed overlay shows while dragging.

## Imported meshes and STEP in the file (assets)
`apps/cad/src/files/assets.ts`, codec `packages/io/src/meshPack.ts`. In memory a mesh is a `doc.meshes` record (base64 of raw Float32 / Uint32 arrays, optional `mats` and `m` for SketchUp
materials) and the STEP text of an `importStep` feature is `doc.blobs[<sha256>]`; the kernel needs the blobs, never the meshes. Everything that leaves the app is packed and everything that comes in is unpacked:
- `packDoc` (file save, folder export of a frozen part, library) writes `meshes[i] = { ...settings, fmt: 2, z, n, crc, c }` (z = base64 of deflate-raw of the payload, n = payload bytes, crc = FNV-1a, c = 1 deflated) and
  `blobsZ[key] = { z, n, c }` in place of `blobs`, plus `assets: 2`. Payload: vertices on a grid of min(1e-3 mm, 1e-5 of the size) in decades, zigzag-varint deltas; indices as zigzag-varint distance below the highest index used; material run-lengths.
  A non-finite or huge coordinate stores the float bytes (byte planes). Indices and materials are exact; vertices are within half a grid step (the only loss) and a second save gives identical bytes.
- `unpackDoc` (every open, restore, recover) reverses it. A record that fails (cut base64, inflate error, size or checksum mismatch, index out of range, `fmt` newer than 2) is left out and listed (`AssetProblem`); a blob whose text does not hash to its key is dropped. Raw meshes and plain `blobs` (earlier versions) pass through.
- Backups (autosave, snapshots) use `packDocCached`: what `warmPackCache` has already packed (called after open and import), raw otherwise; autosave leaves meshes out past 2 MB of packed data and says so once.
- `lightDoc` stands in for the document in the "changed since save" signature and the thumbnail hash; the recipe key of the stored view excludes `meshes`.
- Measured (500,000 triangles + a 240 KB STEP): file 1.2 MB, about 5% of the JSON-number-array size and 10% of the first version's base64 form; pack 0.15-0.4 s, unpack 0.2-0.4 s, no main-thread stall over about 60 ms in Chrome; the picking tree builds in 8 ms slices (about 0.5 s total).

## STEP import
`Import STEP` (command) and Open/drop ask: **Part feature** (default; `partOfStep`: an `importStep` feature with the text in `blobs`, so it is saved, rebuilds on open and later features can use it; falls back to view only
with the reason when the part does not build) or **View only** (below). The choice is remembered per kind in `cad.import.step` / `cad.import.skp`. SketchUp asks **Reference mesh** (default, `files/skpMesh.ts`) or View only.

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
- **Why a stored view is not used.** When a file carries a `viewCache` that is rejected, the app says so in a short notice and rebuilds: the part was edited since the view was stored (recipe), the view is from another kernel build, the field has a format version this build does not know, or the field is damaged. A file with no `viewCache`, or one whose kernel build id cannot be read, gives no notice. `checkEmbedded` in `packages/viewdata/src/viewCache.ts` returns the reason.
- **Written by the MCP too.** `export` with `format: 'ckpart'` and `cache: true` writes the same field (see `docs/mcp.md`). The code that builds the view, the key and the codec is the `@kit/viewdata` package, shared by the app and the agent tools.
- **Autosave** never writes the view (it runs often and the session already restores through the cache).

## Up axis hint (`upAxis`)
A part document may carry a top-level `"upAxis": "z"` (or `"y"`): which world axis is up on screen when the part opens. It is a view hint like `appearance`: the kernel and the MCP ignore it and keep it when they round-trip the document (no `unknownField` warning: that check is for feature fields only), and the GUI applies it to the camera when the part is opened or its tab is shown (the same as View > Up axis, but not saved as the user's setting; a part without the field shows the user's saved setting). A script sets it with `part('Name').upAxis('z')`. The bundled samples built along Z (`pet-bottle`, `motor-*`) carry it, in the field and in their `script`.
