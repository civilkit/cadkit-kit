# SolidCraft import (`.solidcraft`)

`packages/solidcraft` (`@kit/solidcraft`) turns a `.solidcraft` file into a feature tree. Open it like any other file (Open, or drop it on the window); the part opens as a new, unsaved part named after the file.

A `.solidcraft` file is either a zip (newer files) or the bare JSON document (older files, format tags `solidcraft/1` to about `/21`). Only `document.json` is read; the `cache/` folder of a zip is derived data tied to the SolidCraft app build and is ignored. The format tag runs from 1 to 30 across the project's own test files, and the shapes differ between versions: an extent has no `convention` before the later versions (read as a total distance), and profiles chosen by curve ids appear from about format 13 (they become `regions`).

## Orientation

SolidCraft is Z-up and this kit is Y-up. Everything is rotated by -90 degrees about X on the way in: a point (x, y, z) becomes (x, z, -y), so a part keeps its shape and stands the right way up. Their ground plane XY is our top plane; their XZ plane is our front plane (with the sketch's y reversed); their YZ plane is our right plane. A mirrored sketch plane reverses arcs, and horizontal and vertical constraints swap when the plane axes swap.

## What is mapped

Written from three sample files; every other construct is reported, never guessed.

| In the file | Becomes |
|---|---|
| sketch on an origin plane, an offset of one, a construction plane, a **face** or a **custom plane** | a sketch on our front / top / right plane at an offset. A face or custom plane carries its own frame (origin and axes), so it needs no face lookup; the frame must lie flat on one of the three standard planes, with its axes along ours (a tilted face is reported) |
| line, arc (counter-clockwise start to end), circle, construction flag | the same entities |
| coincident constraint | the two points are merged into one (the geometry is closed without the solver) |
| horizontal, vertical, length constraints | horizontal, vertical, distance |
| extrude (new body / join / cut, either direction, a negative distance = the other way, **through all**) | extrude `add` / `cut`, `flip` set so the direction matches |
| profiles: all, or chosen by curve ids | all regions, or the regions bounded by the chosen curves (`regions`). A loop that runs along only part of a longer line gets a small hidden profile sketch of its own outline, because selecting by curve id would also pick the neighbouring regions that share the line |
| box, cylinder along +X / +Y / +Z (or the negative way) | a sketch and an extrude |
| fillet, chamfer (equal distance) | fillet / chamfer; the edges are found by the kernel from the edge positions stored in the file, so they need the kernel |
| shell (inside or outside), offset face | shell / move face; the faces are found by the kernel from the positions stored in the file (the nearest face, only when clearly the nearest) |
| revolve about the sketch's own x or y axis | revolve with a construction line along that axis |
| loft | loft through the section sketches |
| mirror about an origin, offset or construction plane | mirror of the named features |
| rectangular pattern of named features | one or two linear patterns (the second also repeats the first row) |
| construction plane | remembered by name; sketches carry their own plane, so no feature is added |
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

`packages/solidcraft/src/*.test.ts` (no kernel) and `import.kernel.test.ts` (with `CK_WASM`): the slot file and the sample plate are checked against volumes worked out by hand. The sample files are not in this repository: the tests that need them read `cadkit/corpus/solidcraft` (next to the kit; see its README) and are skipped when it is missing, so the kernel and file-based tests do not run on a machine without the corpus. The synthetic tests build their documents in the test and always run. The platform layer reads `.solidcraft` as bytes (`packages/platform/src/web.ts`); `web.test.ts` covers it.

## Coverage today

Run over the project's 22 sample files (the 19 in its repository plus the 3 from the app; `corpus.kernel.test.ts`, folder `corpus/solidcraft` next to the kit), against the numbers their own evaluator saved next to them where those exist (`expected/`):

- **7 import completely.** Four match their saved volume and bounding box (`issue-489-stacked-join`, `issue-616-lid-ribs`, `m0-box-fillet-hole`, `split-body-pieces`); two more were checked by hand against closed-form volumes (Sample Plate, the slot file); one (`crazy-geom-cuts`) imports completely but our kernel fails one of its near-coincident cuts (`booleanFailed`), so it is listed as a known kernel issue.
- **12 import in part**, each reporting what was left out. The partial ones that have saved numbers differ from them, as they should.
- **3 are refused as assemblies** (the hinge sample, `joints-hinge`, `components-arm`).

Plastic features become ordinary sketches and extrudes, checked against the volumes of their own tests: a **boss** (draft, hole and hole depth; a fillet at its foot and ribs are reported, not guessed), a **rest** (rectangle, round, hollow, drafted), a **snap fit** (arm and triangular catch) and a **lip / groove** (a band along the inner or outer edge of a flat rim, read from the kernel's outline of the rim; a clearance `gap`, a rim with curved edges or a face without an inner edge are reported). A lip needs the kernel's rim resolver (`kernelResolvers`); without it the row says so.

Edges and faces are found by the position stored in the file. When a parameter changed after the pick (the file's own `height` is 32 but its fillet edges were stored at 24), the position is off the body, so the importer then tries, in order: the straight edge parallel to the stored direction whose line passes through the point; the point moved along the one axis on which the body's box differs from the box stored with the edge; and, for a face named as an extrude's start or end cap (`F2:top`), that cap by name.

Extents: a **start offset** is the same sketch on an offset plane in the extrude direction; an extent **to** a point or face runs towards the plane through that point (parallel to the sketch) and keeps the depth it has now, with a note (the stored distance is only the value the file last had).

Lettering is kept as text: a sketch that links glyph outlines to a string becomes our text entity (string, height, position, angle; the built-in sans stands in for their font, with a note), and an extrude that selects those outlines selects the text.

Left out most often: a second separate body (and `move`, `combine`, `remove`, which work on whole bodies), intersect, a path pattern, sheet metal, and edges and faces that are not found on a body built differently from theirs.

## Not done

Assemblies (occurrence placement, joints and multi-body components), sweep, hole features, circular and path patterns, and the other feature types listed above. The placeholder row shows its raw type name.
