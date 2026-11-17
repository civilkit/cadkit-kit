# build123d support: which architecture

Status: recommendation, 2026-11-16. Nothing here is built. "Verified" means checked today against a primary source (PyPI, the GitHub API, our code); "estimate" means judged from reading, not run.

## 1. Recommendation

**Run the real build123d in the browser (Pyodide + the OCP.wasm wheel) in a worker, and convert its result into our document in two tiers: an imported body always, an editable feature tree when a recorded trace of the script's 3D operations replays on our kernel and matches the OpenCascade result.**

Main reason: build123d is not a feature list, it is a Python library whose scripts read geometry back at every line (`part.edges().filter_by(Axis.Z)`, `faces().sort_by()[-1]`, `line @ 1`, `arc % 0.5`). A compatibility layer has to reproduce that whole query surface on our kernel before the first real example runs; running the real library gives every script on day one and leaves our kernel only the work that pays: editable features.

## 2. Evidence

| Question | Finding | Status |
|---|---|---|
| Does OCP run in Pyodide? | Yes. `yeicor/OCP.wasm` (MIT) ports OCP for build123d. Wheel `cadquery-ocp-novtk-OCP.wasm` is on PyPI: version 8.0.1.1 (OCCT 8.0.1), tag `cp314 pyemscripten_2026_0 wasm32`, **22.7 MB**, uploaded 2026-09-24. Repo last pushed 2026-09-24, 52 stars, one maintainer. | verified |
| Does build123d itself run there? | The project states "(almost) 100% of the build123d tests" pass with its workarounds; tests in the browser are Chrome only. Three public apps use it (Yet Another CAD Viewer, build123d-sandbox, build123dWebAssmGenDemo). | read, not run |
| build123d activity | 3.7k stars, pushed 2026-11-15, latest release v0.13.0 (2026-09-21), Apache-2.0. | verified |
| Total download, start time, speed, memory on Safari / iPad | Not found anywhere. Wheel 22.7 MB + Pyodide runtime + numpy, scipy, sympy, ezdxf, svgpathtools, lib3mf and others; expect 50 MB or more on first use. | **not verified, M1 measures it** |
| How the upstream bootstrap loads | At run time from PyPI and GitHub, through a third-party CORS proxy. Not acceptable for us: we must pin and self-host the wheels. | verified (read `bootstrap.py`) |
| Our side | `importStep` exists in the kernel and the app, but the body is on screen only: it is not saved and not editable until the `importedBody` feature (spec-imported-body, 2026-10-20) is built. `recognize` (ck-recog: prisms, revolves, holes) exists. The script layer (`packages/script`) records steps and emits feature JSON (`{op:'add', feature}`); it evaluates JS in a restricted scope, with awaited read-backs. No Python anywhere today. | verified |

## 3. The candidates

| | Runs all scripts | Editable features | Browser | Cost | Verdict |
|---|---|---|---|---|---|
| (a) Our own build123d-style API over our kernel | No: only what we re-implement. build123d's topology, selector, `Location`/`Plane` algebra and BuildLine surface is tens of thousands of lines, and every kernel gap (closed-spline fillet, 3D offset, projection, fonts) becomes a script failure | Yes, by construction | Yes | Very large, open-ended | Rejected as the base. Its good part (features) is kept by the trace tier |
| (b) Local Python service, STEP in | Yes | No | No (desktop only) | Small, plus packaging Python + OCP per platform | Kept as an optional faster runner behind the same protocol, later |
| (c) Transpile to our script language | No: Python is dynamic (loops, classes, comprehensions over geometry); static translation fails on most real scripts | Yes when it works | Yes | Large | Rejected as an input path. "Save as kit script" falls out of the trace tier for free |
| **(d) Real build123d in Pyodide + trace** | Yes (same library) | Yes when the trace replays and matches; otherwise an imported body | Yes; desktop uses the same worker | Medium, in steps | **Recommended** |

## 4. How it works

1. **Runner.** A dedicated worker loads Pyodide, our pinned wheels and build123d (lazy, cached, only when a Python script is first run). No network after load; no DOM. The script editor gets a language switch; `show(...)`/`show_object(...)` and the last top-level `Part`/`Compound` define the result. Cancel = terminate the worker.
2. **Tier 1, imported body.** The result is exported as STEP in memory and goes through `importStep` into an `importedBody` feature. The script text stays in the document (as our scripts do) and top-level numeric assignments (read with Python's `ast`) appear in the Variables tab; a change re-runs the script. So even an opaque body is parametric through its script.
3. **Tier 2, editable features.** Before the script runs we wrap build123d's 3D entry points (`extrude`, `revolve`, `loft`, `sweep`, `fillet`, `chamfer`, `offset`, `split`, `mirror`, `Hole`, `Box`/`Cylinder`/..., the `+ - &` operators and `Mode`). Each call is recorded with its inputs **as geometry**: a profile is the planar face build123d produced, read back as lines, arcs, circles and splines on its plane. So BuildSketch, BuildLine, Locations, Align, `@`/`%` and all 2D selectors need no mapping at all: OpenCascade evaluates them, we convert the outcome. Selected edges and faces are matched to ours by geometry (midpoint, length, surface kind).
4. **Oracle.** The trace is replayed on our kernel as ordinary features. After each step volume, area, bounding box and face count are compared with the OpenCascade shape of the same step. All steps match: the document gets the feature tree. Any step fails or differs: the body falls back to tier 1, and the step, the reason and both numbers are logged. That log is a free kernel conformance report (the closed-spline fillet will show up in it by name).
5. **CadQuery** uses the same OCP wheel; its own dependencies in Pyodide (nlopt, casadi for the assembly solver) are not verified. Same runner, own wrap table.

## 5. API surface and mapping (tier 2)

| build123d | Our feature | Note |
|---|---|---|
| BuildSketch / BuildLine / sketch objects / Locations, GridLocations, PolarLocations / Align / 2D `offset`, `make_face`, `trace` | `sketch` with line, arc, circle, spline entities | converted from the resulting face; no constraints or dimensions, fixed geometry |
| `Plane`, `Axis`, `Pos`, `Rot`, `Location` | `plane` (offset, rotated, on face), `axis`, `moveBody` | evaluated in Python; we receive frames |
| `Box`, `Cylinder`, `Cone`, `Wedge`, `Torus`, `Sphere` | `sketch` + `extrude` / `revolve`, `sphere` | or a small primitive feature in the kernel (cleaner tree) |
| `extrude` (amount, both, taper, until) | `extrude` (mid, draft, through) | `until=` a face: to check |
| `revolve`, `loft`, `sweep`, `Helix` | `revolve`, `loft`, `sweep`, `helix` | multisection sweep, twist: gap |
| `Mode.ADD/SUBTRACT/INTERSECT`, `+ - &` | `extrude` op add/cut, `combine`, `newBody` | |
| `Hole`, `CounterBoreHole`, `CounterSinkHole` | `hole` | |
| `fillet`, `chamfer` | `fillet`, `chamfer` | closed-spline edges fail today |
| `offset` (3D, openings) | `shell`, `thicken` | general 3D offset of a solid: gap |
| `mirror`, `split`, `scale` | `mirror`, `split`, `scale` | |
| patterns via Locations on 3D objects | `lpattern`, `cpattern` (or repeated features) | recognise regular grids, else repeat |
| `Text` | `text` | we have two fonts, Latin-1; system fonts: fall back to tier 1 |
| `project`, `make_hull`, `full_round`, `section`, twist extrude, custom `Solid` from faces | none | tier 1 |
| `import_step/svg`, `export_step/stl/3mf` | virtual file system; our exporters | imports from the user's files need a picker |
| Joints, assemblies (`Compound` children, labels, colours) | `mate`, `insertPart`, bodies, appearance | M3 |

**Conformance corpus.** The official `examples` folder has 67 scripts (verified count; about 38 models, 29 of them also in an algebra variant). Tier 1: expect nearly all, short of those needing local files, system fonts or a viewer call (estimate). Tier 2: roughly 20 to 25 of the 38 models (extrude, holes, din_rail, pillow_block, lego, handle, loft, vase, tea_cup, spring, circuit_board, multiple_workplanes, intersecting_chamfers, pegboard_j_hook, heat_exchanger, key_cap, ...); not projection, platonic_solids, bicycle_tire, roller_coaster, playing_cards, benchy (estimate, to be replaced by the measured table at M2).

## 6. Milestones

| | What runs | Size |
|---|---|---|
| **M1** Runner and measurement | Pinned self-hosted wheels, Pyodide worker, Python mode in the script editor, result as STEP into the existing import (on screen, exportable). The 67 examples run headless and produce a table: runs / time / size / valid after our STEP import. Measured download, start time and memory on Chrome, Safari and iPad. **Go / no-go on the numbers.** | 1 to 1.5 weeks |
| **M2** Saved, parametric, first editable trees | Minimal `importedBody` (already specified) so the result saves, reopens and takes features on top. Script kept in the document, variables from top-level numbers, re-run on change. Trace + oracle for primitives, extrude, revolve, booleans, holes, fillet, chamfer, mirror; all-or-nothing per body. Corpus report in CI with a baseline. | 3 to 4 weeks (1 to 1.5 of it is `importedBody`) |
| **M3** Breadth | Loft, sweep, helix, shell/offset, split, patterns, text where fonts allow, several bodies with names and colours, joints as mates, "Save as kit script", CadQuery wrap table, optional native Python runner on desktop. | 3 to 4 weeks |

## 7. Risks

* **Weight and iPad.** 50 MB or more and a large wasm heap may be slow or fail on Safari / iPad. Unmeasured; M1 exists to find out. If it fails there, tier 1 on tablets needs a server or is desktop only.
* **One-maintainer dependency.** OCP.wasm is one person's port tied to a Pyodide ABI (`pyemscripten_2026_0`) and a build123d version. Mitigation: pin and mirror the wheels; keep the build recipe; the native runner (b) is the escape hatch.
* **Two kernels in one product.** OpenCascade (LGPL-2.1 with exception) ships as a lazily loaded module beside our kernel: licence notices, and a positioning question.
* **Trace fragility.** Wrapping build123d internals follows its releases; geometric edge matching can pick the wrong edge on symmetric parts. The oracle catches wrong results, at the price of more fallbacks.
* **Honest editability.** Sketches arrive without constraints, and a converted tree no longer follows the script: editing a feature forks from the script (the same rule as our own scripts must be stated in the UI).
* **Our kernel gaps become visible.** Fallback rates are public the moment users compare; the corpus report keeps this measured rather than anecdotal.
* **Untrusted code.** Python in a worker is sandboxed by the browser, but must have no network and no access to the document beyond its result.

## 8. Open questions for the owner

1. Is shipping OpenCascade inside the app (lazy, browser) acceptable, given our own kernel is the product? If not, the choice is (a) alone, at several times the cost and a fraction of the scripts.
2. Is a first-use download of 50 MB or more acceptable, and must Python scripts work on iPad, or is desktop browser + desktop app enough?
3. What matters more first: "any build123d script opens" (tier 1) or "common scripts become editable trees" (tier 2)? It decides how much of M2 goes to `importedBody` versus the trace.
4. When a converted tree is edited by hand, does the script stay attached (read-only, out of date) or is it detached?
5. Do we host the wheels on our own domain, and may the corpus (Apache-2.0 examples) live in our public repo?
6. CadQuery: follow at M3 as planned, or is there a known user who needs it earlier?
