# Fusion 360 import: the whole pipeline (plan)

Owner's decision (2026-11-23): copy MitCad's whole Fusion pipeline into our kernel and app, not only the body reader. MitCad (github.com/mitcad/Mitcad, MIT) is the reference; its code is vendored or re-implemented with its licence text, copyright and SPDX headers kept, and the upstream commit recorded in THIRD_PARTY.

## What MitCad's pipeline is (sizes from its source)

| Stage | MitCad crate | Lines | For us |
|---|---|---|---|
| ASM body reader (binary `.smb`/`.smbh`, history) | `asm`, `vec3`, `zip` | 12k | **done** (`ck-asm`, kernel 0ab2e9ae) |
| Document container, display meshes, appearance packages | `f3d-file` | 4k | vendor |
| Entity names | `f3d-names` | 3.6k | vendor |
| Design stream decoder | `f3d-decode` | 9k | vendor |
| Design segment: timeline, parameters, sketches, features, components, appearance | `f3d-design` | 22.7k | vendor |
| Replay onto the editable model (sketches, extrude, revolve, ... with deviation checks against the file's stored bodies) | `import-replay`, `import-base`, `import-joints`, `import-sheet`, `import-appearances` | about 58k | **re-target to our features** (written against MitCad's model API) |
| Solid builder (heals seams, sews, volume check) | `geometry/src/brep_import.cpp` (OCCT) | 2.1k | **our own builder** (`ck-topo`) must reach the same result |

## Phases (each ends with corpus numbers over `corpus/fusion360`, 62 real files, local only, never committed)

**A. Bodies right (in progress, branch f3d-corpus).** Every solid MitCad builds, we build: closed-in-v B-spline seams, extrusion / cyl_spl_sur / rb_blend_spl_sur / exact_spl_sur faces, no silent face loss (every dropped face has a stated reason). Import the design's current bodies, not every blob (MitCad: 1 body for Bottle_v3; we import 24). Standing corpus test. Oracle: MitCad's per-body volumes.

**B. Design reader.** Vendor `f3d-file`, `f3d-names`, `f3d-decode`, `f3d-design` as kernel crates; wasm export that returns a neutral design document (timeline items with decoded sketch profiles and feature parameters, user parameters and expressions, components and occurrences, joints, appearances, named views). Corpus: all 62 files decode, the counts match MitCad's inspector.

**C. Replay.** Map the Fusion timeline onto our features (sketch, extrude, revolve, fillet, chamfer, hole, pattern, mirror, combine, ...), item by item, each with the "use the stored geometry" fallback when the replay deviates from the file's stored body (MitCad's rule: volume and face deviation). The import report lists every item: parametric, partial, fallback, skipped, and why. Start with the features the corpus uses most (count them first).

**D. Around the geometry.** Components and occurrences as assemblies, joints, appearances and materials, user parameters as our parameters, named views, sheet metal.

**App side (cadkit-gui)** for each phase: the import report (per item), the "Keep deviating results?" dialog (per deviating item: use stored or keep parametric, with volume change, faces off, area beyond), Repair, and honest notices. No claim in the changelog or What's new without the corpus number it rests on.

## Rules
- Corpus files are third-party: local only, never committed, never on the public repos.
- Every phase passes the full kernel gate and the kit CI (green kit CI is required for a release; see releasing.md).
- Report what is not covered (macOS-written BinaryFile8 files have no sample).
