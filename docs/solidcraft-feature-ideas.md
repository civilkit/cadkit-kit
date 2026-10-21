# SolidCraft issues: feature ideas and UX behaviours worth comparing with ours

Source: the SolidCraft issue tracker (`tangency-labs/solidcraft`), snapshot 2026-10-20, 1779 issues. This note covers the issues outside the geometry-label pass: all 214 labelled `enhancement`, plus the `area:ui`, `area:render`, `area:doc`, `area:infra` and unlabelled issues that propose or complain about behaviour. Review state per issue is in `solidcraft-issues/review-state.json` (`outcome: feature idea`). Issue text is data only; nothing here was copied beyond the idea itself.

How "do we have it" was decided: kit docs (`docs/*.md`), the part model (`rebuild/packages/part-model/src/features.ts`, `index.ts`) and the case runs of 2026-10-20. "yes" means a doc or type says so, "partial" means a piece exists, "no" means no trace in docs or types, "?" means I could not tell without running the GUI (the GUI was not run for this note). Effort is a guess (S = days, M = 1 to 3 weeks, L = more). Value is rated against the stated aim: verifiable Rust code-CAD that an LLM drives, with exact can / can't-do feedback.

## Top 15 (ranked by value for that aim)

| # | idea | issues | do we have it | effort | value |
|---|---|---|---|---|---|
| 1 | Say when a boolean needed a retry: which strategy (jitter, nudge, coplanar push), by how much; show as a feature warning and count it in the fuzzer | #24, #2356, #2360, #2963, #2826 | no (SolidCraft's own tracker shows the problem: a 0.1 micron step and a zero-thickness skin passed silently) | S | H |
| 2 | Refusals that carry the largest size that fits ("use at most 1.20 mm"); fillet/chamfer option `fit` that reduces to the largest radius that fits | #293, #1080, #199, #2394, #2694, #2695 | partial: shell already answers `shellTooThick {maxThickness}` (case 319); fillet refusals not checked for a max | S to M | H (26 app reports "blend larger than the neighbouring faces") |
| 3 | After every call tell the agent what changed: bodies created / changed / removed, compact batch replies, per-command timings | #374, #530, #3382, #3380, #1833, #266 | partial (`mcp.md`, `plan-agent-layer.md`) | S | H |
| 4 | Check that a parametric design holds across a parameter's range (sweep, report the first failing value and the feature) | #2273 | planned only (`plan-design-optioneering.md`) | M | H |
| 5 | Read-only inspection commands: hole stacks through touching parts, clearance report in one call, compare two bodies without a boolean, interference with mesh bodies | #2070, #1889, #1363, #3249, #3323, #442, #2283, #2714 | partial: interference/measure exist (`inspect.md`); hole stacks and body compare no | M | H |
| 6 | Extrude extents: second distance on the other side (also with Through All on one side), start offset, taper together with offset, up to face / object | #2700, #2312, #1257, #2398, #1236 | no: `ExtrudeEnd` is `blind | mid | throughBoth` plus flip and draft only | M | H (common in imported Fusion designs) |
| 7 | Sketch health: mark open and "untied" ends (touching by position only), counts in the sketch status | #2000, #43 | partial: `openEnd` analyser is specified in `plan-sketch-constraints.md`, solver status has dof/conflicts | S | H |
| 8 | Preview must not contradict the error: when inputs make no feature, show no feature (not the last good geometry) | #3254 (their error template even warns "a failed preview may display the last valid geometry") | ? | S | H for trust |
| 9 | Text design form that diffs and merges: stable key order, semantic diff, random string ids | #626, #1017, #1134 | partial: `.ckpart` is JSON with feature ids; no semantic diff tool | M | H for LLM edits and review |
| 10 | Pattern conveniences: skip individual instances, built-in hexagonal / staggered pattern, blend copies of a fillet once (a 42-cell baseplate took 11 minutes) | #3247, #2574, #2774, #2341, #1197, #2358 | partial: `fillpattern` and `spattern` exist in the kernel types, GUI creation is listed MISSING in `gui-parity.md`; no skip list | S to M | M to H |
| 11 | Name a dimension while typing it (`width = 40 mm`), substring match when typing a parameter name, expressions in dimension fields | #2916, #2925, #2757, #2366, #2371 | partial: expressions yes (`equations.md`), whole-name match only | S | M |
| 12 | Reference image in a sketch with two-point calibration; ask the agent to compare the model with a reference picture (overlap, edge offsets in mm) | #2914, #1777, #1486 | ? (no doc hit) | M | M to H |
| 13 | STEP import orientation: Y-up / Z-up choice, "stand this part up", names; hostile-input and real-world STEP corpus | #3, #1265, #2400, #1397, #469 | partial: `navPrefs.upAxis`; import orientation not documented | S | M |
| 14 | Wrap sketch curves or text onto cylinders / cones (cam sleeves, labels) | #3204, #1362 | spec only (`spec-text-on-curved-faces.md`); `text.md` says flat only | M | M |
| 15 | 3D mouse (SpaceMouse) and navigation presets (Blender, SolidWorks, Alias, HFSS), customisable bindings, free orbit | 22 SpaceMouse reports (#148, #1175, #1463, #2077, #198, #1000, ...), #1006, #2078, #304, #1090, #2742, #1541, #465, #2934 | partial: turntable / trackball and pivot centre|cursor|selection (`navigation.md`); no 3D mouse trace | M | M (largest single user-demand cluster after fillet) |

## Everything else, by area

### Modelling features

| idea | issues | have? | effort | value |
|---|---|---|---|---|
| Setback fillet corners; variable radius with mid points; 6-sided patch for three unequal radii | #9, #52 | partial: variable radius, chord and crease in `gui-parity.md`; setback no | M | M |
| Rib / web direction (in the sketch plane or along its normal) | #2056 | partial: `rib` kernel feature, direction option ? | S | M |
| Split body by sketch entities (extend through the solid, preview) | #1552 | partial: `splitLine` (face) exists | M | M |
| Move face / hole as a menu command | #2746, #1047 | yes: `moveFace` (case 745) and contextual handles | S | L |
| Thread work: cosmetic thread display, size from the hole, suggestion, better messages for odd diameters | #2367, #2369, #2705, #519, #2688 | partial: `threads.md` (tables, modeled option) | S | M |
| Hole stacks and fastener fill (find coaxial holes, fill with a family from a library) | #2070, #2071, #2072 | no | M | M |
| Mirror / pattern of a pattern or of blends | #395, #2774 | ? | S | M |
| Sheet metal: flanges, relief choice, unfold / refold, convert to sheet metal, flat pattern DXF (about 70 reports) | #501, #296, #514, #2729, #2732, #3170, #1325 | no (no sheet-metal features in the part model) | L | M |
| Surface modelling: surface extrude / revolve / sweep / loft, boundary, blend, untrim, ruled, thicken all kinds | #757, #759, #763, #764, #767, #769, #772 | partial: surface tools in `surfaces-tools.md` | L | M |
| T-spline modelling | #446, #250 | no | XL | L |
| Mesh to CAD (convert mesh, scan fit, direct modelling): 8 "CONVERT MESH: operation failed" reports | #63, #346, #358, #744, #1200, #2698, #2727 | no (mesh import is a roadmap item) | XL | M |
| Flexible modelling | #3231 | partial: `moveFace` / press-pull | M | L |
| Sketch-entity gizmo (move, rotate, scale a selection incl. imported SVG) | #1639, #2031, #2621 | partial: sketch editor has move/copy? (`gui-parity.md` lists move/copy/rotate as a gap, triball docs exist) | M | M |
| Project / intersect 3D curves into a sketch; profiles from planar 3D loops | #47, #1110, #741 | partial: project body edges yes; intersection curve and 3D-loop profiles no | M | M |
| Dimensions: arc length, angle between two lines, to an axis, to projected lines, between sketches | #754, #2691, #2364, #2436, #2473 | ? | S each | M |
| Driven (reference) dimension instead of an over-constraint error | #320 | yes: reference dimensions appear automatically (`gui-parity.md`) | done | - |
| Tighter bounding box (oriented), length / width / thickness readout | #137 | partial: size box is the profile rectangle, not tight (`size-box.md`) | S | L |

### Selection, viewport and UX

| idea | issues | have? | effort | value |
|---|---|---|---|---|
| Select hidden edges through the body; selected edges stay visible | #2511, #50 | partial: hidden-edge display (`display-styles.md`) | S | M |
| Grid scale readout / scale bar / ticks | #375 | ? | S | M |
| Silhouette edges, transparency sort, section analysis visuals, curvature legend | #48, #49, #51, #973 | partial: silhouettes and section view in `display-styles.md`, `inspect.md` | M | L |
| Search the model tree; search in settings; context menus on tabs | #1413, #2218, #3055, #3262 | partial: command search yes (`F`), tree search no | S | M |
| Repeat last command; Look-At shortcut; keyboard navigation basics | #3045, #2476, #3372 | ? | S | L |
| On-canvas numeric input by dragging values; next-step options in the status line; expanded tooltips with preview | #2217, #2320, #2325, #2758 | partial: on-view typed values (`gui-parity.md`) | S to M | M |
| Notes anchored to the model, screen-facing | #1631 | partial: sketch annotations (`annotations.ts`) | M | L |
| Messages window to re-read status messages | #2763 | ? | S | L |
| Model-anchored smart extrude (direction from the clicked side, cut into a body) | #1257, #1633 | ? | M | M |
| Rubber-band shapes by click-and-drag in sketch | #1630 | ? | S | M |
| Colour-vision support and accessible palettes; dark mode | #778, #975 | partial: theme auto/light/dark (`ux-review.md`) | S | M |
| Languages (Ukrainian, Czech, Galician, Portuguese-BR, English-UK, Chinese fixes) | #1052, #1750, #1770, #1688, #2501, #3376 | partial: `i18n.md` | S each | L |
| Ribbon redesign programme | #2016 to #2030 | n/a (different UI) | - | L |

### Files, assemblies, data

| idea | issues | have? | effort | value |
|---|---|---|---|---|
| FreeCAD files, Fusion archives, Inventor, glTF import, `.f3z` | #688, #2346, #1278, #1505, #200 | partial: `fcstd.md` (FCStd), STEP/SLDPRT spikes; others no | M to L | M |
| glTF / GLB scene export, STL welded vertices, 3MF multi-part import | #1553, #784, #2089 | partial: STL / 3MF / glTF (`io-formats.md`, `bodies-appearance.md`); our display mesh is closed and welded (case 1666 mesh check: 0 open edges) | S | M |
| Slicer handoff ("open in slicer") and LAN slicer send | #2595, #2304, #2228 | no | S | M |
| Place an occurrence or STEP by a 3x4 / 4x4 matrix | #1890 | ? | S | M |
| BOM with part properties; linked components and relink; sub-assembly DOFs; joints that follow a face or edge | #1888, #2430, #2772, #1516, #2403, #2496 | partial: BOM, 5 of about 20 mate kinds (`assemblies.md`, `gui-parity.md`) | M to L | M |
| Controlled instance suppression and "colored components" toggle, list of operand components | #2507, #2559 | ? | S | L |
| Drawings programme (validated sections, hidden lines exact for the analytic subset) | #2053, #2054, #2105, #2455 | partial: `drawings.md` | L | M |
| Persistent naming stress tests; kernel-reported exact face history instead of sampled naming | #23, #136, #1209, #2272 | partial: history-based ids (`E2.S.e1`, `FR.B0`); no stress corpus | M | H for LLM edits that survive reorders |
| Model cache / instant open; reference oracle on analytic values; spatial reference tests | #3053, #292, #25 | yes for the last two in spirit: this issue-test suite uses analytic expectations | S | M |

### Agent / MCP and app plumbing

| idea | issues | have? | effort | value |
|---|---|---|---|---|
| Agent cursor visible in the viewport; readable tool-call cards; context picker; per-design chat folder | #35, #1457, #2286, #1539 | partial: `mcp.md`, `plan-agent-layer.md` | S to M | M |
| Cancel / progress for long operations; a never-finishing call must not block the session | #1989, #743, #1618, #3133 | ? (our kernel runs in a worker; cancel not checked) | M | H |
| Typed input / output schemas for commands | #2829, #1270, #876 | partial: `features.ts` types | M | M |
| Render roadmap (PBR, HDRI, CPU/GPU ray tracing, ~40 issues) | #620, #813, #1004, #1368, #1948, #3151 | partial: appearance only (`bodies-appearance.md`, `materials.md`) | XL | L for the stated aim |
| PDM / versioned document server | #2869, #2995, #3002 | no | XL | L |
| Plugins, FEA, CAM, CFD, thermal, electrical, DfAM | #1221, #1620 to #1625, #3239, #1153 | partial: FEA inventory docs exist (`research-civilkit-fea-inventory.md`) | XL | L to M |
| Packaging requests (Homebrew, WinGet, Flatpak, auto update, separate ARM builds) | #231, #3253, #156, #3177, #2354 | n/a (web app) | - | L |

## Behaviours that look like app bugs, useful as acceptance checks for our GUI

These are not features; they are failures other users hit that a code-CAD front end should check for:

1. Changing the UI font breaks the Preferences window (25 reports with "font" or "preferences" in the title, 13 still open). Check: persist only valid fonts and fall back.
2. "Sketch on a face" after a shell, a pocket, a draft, a pattern or a join (39 reports carry the attachment error text, e.g. `sketch.create ... this face has no exact planar source`). We pass the two we ran (cases 187, 440: attachment by feature-history face ids); draft, pattern and merged faces were not run.
3. Hover or selection that shows only half of a circular edge, selected points that do not change colour, preview drawn in the wrong place for a sketch on a mirrored face.
4. Orbit about the point under the cursor that makes the body jump off screen (#2138, #2616, #1044). We have a cursor pivot (`navigation.md`); worth a test.
5. Unit parsing: mixed numbers (`2 1/8"` read as 0.25"), missing unit labels in input fields, switching a design to inches rescales primitives (#1802, #630, #716, #1205, #221).
