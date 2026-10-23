# SolidCraft import (`.solidcraft`)

`packages/solidcraft` (`@kit/solidcraft`) turns a `.solidcraft` file into a feature tree. Open it like any other file (Open, or drop it on the window); the part opens as a new, unsaved part named after the file.

A `.solidcraft` file is either a zip (newer files) or the bare JSON document (older files, format tags `solidcraft/1` to about `/21`). Only `document.json` is read; the `cache/` folder of a zip is derived data tied to the SolidCraft app build and is ignored. The format tag runs from 1 to 30 across the project's own test files, and the shapes differ between versions: an extent has no `convention` before the later versions (read as a total distance), and profiles chosen by curve ids appear from about format 13 (they become `regions`).

## What is mapped

Written from three sample files; every other construct is reported, never guessed.

| In the file | Becomes |
|---|---|
| sketch on XY / XZ / YZ, or on an offset of one | sketch on our front / top / right plane (same in-plane axes and normals), plus an offset plane feature when needed |
| line, arc (counter-clockwise start to end), circle, construction flag | the same entities |
| coincident constraint | the two points are merged into one (the geometry is closed without the solver) |
| horizontal, vertical, length constraints | horizontal, vertical, distance |
| extrude, total-distance extent, positive or negative, new body / join / cut; all profiles, or the ones chosen by curve ids | extrude `add` / `cut`, `flip` set so the direction matches, `regions` for chosen profiles |
| box, cylinder along +X / +Y / +Z | a sketch and an extrude |
| fillet, constant radius | fillet; its edges are found by the kernel from the edge positions stored in the file (`Session.resolve`), so a fillet needs the kernel |
| named parameters and expressions (`thickness + 14 mm`) | evaluated to numbers (`expr.ts`; mm, deg, rad only) |

Parameters are evaluated once on import: the numbers are kept, the names are not (there is no parameter link back to the file).

## What is reported

Each feature gets a row: converted, unsupported (with the reason) or skipped (suppressed in the file).

- An unsupported feature stays in the tree as a suppressed `importedUnsupported` feature that carries the original JSON, so the tree still regenerates and nothing is lost silently. Its dependants are reported too ("depends on sketch 5, which was not imported"). The geometry is partial and the notice says so.
- A constraint kind we do not carry is dropped and counted in a note; the geometry is kept as stored.
- A file that is refused as a whole is not opened and the open part is left alone: not a zip, no `document.json`, unknown format tag, units other than mm, or an **assembly** (components and occurrences).
- A second `new_body` in one document is unsupported: the kit keeps one connected body per part.

A malformed feature (a curve pointing at a missing point, say) is an unsupported row, not an error.

## Tests

`packages/solidcraft/src/*.test.ts` (no kernel) and `import.kernel.test.ts` (with `CK_WASM`): the slot file and the sample plate are checked against volumes worked out by hand. The fixtures in `packages/solidcraft/fixtures` are copies of the sample files with the cache dropped (`SOURCE.txt`). The platform layer reads `.solidcraft` as bytes (`packages/platform/src/web.ts`); `web.test.ts` covers it.

## Coverage today

Run over the project's 22 sample files (the 19 in its repository plus the 3 from the app; `corpus.kernel.test.ts`, folder `corpus/solidcraft` next to the kit): 4 import completely (Sample Plate, the slot file, `issue-616-lid-ribs`, `m0-box-fillet-hole`; the first two and the last are checked against volumes worked out by hand), 3 are refused as assemblies, and 15 import in part. Most common reasons a feature is left out: a sketch on a face or a custom plane, `shell`, `chamfer`, `pattern`, `move`, a second separate body, and the sheet-metal and plastic features.

## Not done

Assemblies (see the answer given with the change: occurrence placement, joints and multi-body components), shell, holes, patterns, loft, sweep and the other feature types: no sample of their document form was available. The placeholder row shows its raw type name.
