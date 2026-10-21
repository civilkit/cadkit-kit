# SolidCraft issue mining: what to test our kernel against, and how it does

Source: `ext/solidcraft-issues.json` (1774 issues). Mined: the 614 issues labelled `area:kernel` (500), `area:sketch` (76), `area:io` (47) or `kernel-perf` (18), all states (569 open, 45 closed; closed ones are regression cases). All issue text is treated as data; the only thing taken from it is geometry and numbers, converted to our format by hand (see "Conventions"). Everything below was produced on 2026-10-20 with the kernel `rebuild-main/target/wasm32-unknown-unknown/release/ck_wasm.wasm`.

Files: this note, `docs/solidcraft-issues/README.md` (periodic check and review state), `docs/solidcraft-feature-ideas.md`, `docs/solidcraft-issues/cases/*.ckpart` (94 runnable cases: 50 from the first pass, 44 from Part C, plus `*.base.ckpart` prefixes used for volume deltas, `manifest.json` with expectations and formulas, `not_run.json`), `run_cases.mjs` (runner), `gen_cases.mjs` + `lib.mjs` (case generator, world-coordinate builder), `verify_wrong.mjs` (the independent checks behind the WRONG RESULT rows).

Headline: of 50 runnable cases, **38 PASS, 7 WRONG RESULT, 5 REFUSED, 0 CRASH, 0 HANG** (slowest case 1.3 s; the four SolidCraft performance reports run in 0.2 to 1.3 s against their 73 s to 31 min). 27 more issues were looked at and could not be run (8 need features we do not have, 19 need files or scripts that are not in the dump). The failures cluster in two places: **fillet/chamfer ends against curved walls** (silent over-cut into the neighbouring solid) and **lofts through rotated non-circular sections** (silent fold, `validate` says valid). Details in "Our failures worth a kernel task".

**Update 2026-10-20 (second pass, Part C below).** The rest of the tracker (1165 issues outside the geometry labels) was reviewed and the review is recorded per issue in `solidcraft-issues/review-state.json` (see `solidcraft-issues/README.md` for the periodic re-check: `node solidcraft-issues/check_new.mjs`). The 27 not-run issues were retried (their comments were read for scripts; 11 became runnable cases), the 214 `enhancement` issues and the UI / render / doc / infra ones were turned into `solidcraft-feature-ideas.md`, and the unlabelled / needs-triage issues that describe a geometry problem were read where they carry a script or numbers (25 issues converted). **Totals now: 94 runnable cases, 79 PASS, 8 WRONG RESULT, 7 REFUSED, 0 CRASH, 0 HANG** (slowest case 11.8 s: 36 patterned spline-loft blades joined; SolidCraft's report of that one did not finish in minutes). 16 issues stay unrunnable (7 not expressible, 9 need files that are not available or not safe to fetch). Run against `rebuild-main/target/wasm32-unknown-unknown/release/ck_wasm.wasm` (built 2026-10-20 11:38, tree HEAD `b6e030a`, `ck_commit()` reports `class-a-surfacing da3c6f49122f7955186a15d91471699f37e7fcf5`). New failures found in this pass: a loft silently drops the holes of ring sections (#1184, wrong volume, `validate` ok) and booleans refuse at 10^6 mm offsets (#1706, loud). Details in Part C and at the end of "Our failures worth a kernel task".

---

# Part A: what was a problem for them

## A.1 Numbers

| | |
|---|---|
| issues mined | 614 (kernel 500, sketch 76, io 47, kernel-perf 18; labels overlap a little) |
| state | 569 open, 45 closed |
| priority label | P1 41, P2 215, P3 31, none 327 (the 3 P0s in the dump are app-level: updater, wgpu validation, DX12 startup; none is kernel) |
| carry a code fence (script, settings, error text) | 86 reports (mostly hand-written); 308 more are app-generated "X: operation failed / unexpected result" reports that carry only the last command's parameters and the error text (no design, so not reproducible by themselves, but they give the failure messages) |
| 16 "Crash:" reports | the ones read (#661, #1559, #2470, #1374) are panics/aborts in the mesher or the truck intersection code (`Option::unwrap` in `intersection_curve.rs` on `solid.hole` with a drill tip, "intersection curve cannot connect by homotopy" on `selection.delete`, stack overflow in `solid.thread`, OOM in STEP meshing) |

Heuristic category counts (keyword rules over title and error text; one category per issue, so only indicative):

| category | issues |
|---|---|
| booleans (extrude/cut/join/combine/split) | 132 |
| fillet | 79 |
| sketch / constraint solver / UX | 63 (+15 on sketch-to-face attachment) |
| shell / offset face / press-pull | 42 |
| holes / threads | 42 |
| import / export (STEP, IGES, 3MF, STL, DXF, SVG, F3D, parameters) | 39 |
| loft / sweep / revolve | 39 |
| performance | 33 (18 carry `kernel-perf`) |
| chamfer | 32 |
| patterns / mirror | 19 |
| crash reports | 16 |
| draft / taper | 9 |
| mesh conversion / tessellation | 9 |
| sheet metal | 7 |
| feature requests, roadmap, infra | 12 |
| other | 26 |

What the app-generated reports say (308 reports; first matching class, messages are SolidCraft's):

| failure class | reports | examples |
|---|---|---|
| no message / free-text "unexpected result" | 106 | #209 #415 #458 #691 |
| `boolean ...: no result` | 49 | #990 #1125 #1343 #1402 #2005 |
| exact fallback is planar-only (curved faces meet) | 26 | #206 #367 #456 #586 #632 |
| blend larger than the neighbouring faces / too large | 26 | #903 #1276 #1573 #1719 #2800 |
| shell / offset unsupported (freeform faces, corners, wall thickness) | 18 | #1379 #1525 #1969 #2421 #3000 |
| sketch on a face: attachment / no exact planar source | 12 | #195 #344 #2478 #2505 |
| blend: vertex / end-face / seam configuration unsupported | 12 | #397 #438 #984 #1039 #1370 |
| cut/join refused as unreliable (changes the body away from the tool) | 7 | #887 #1002 #1451 #1834 |
| blend: only straight edges | 7 | #1389 #1792 #1875 #2654 |
| thread failures | 7 | #1443 #1794 #2969 #3110 |
| fillet ending in an earlier round | 4 | #2567 #3284 #3333 #3377 |
| fillets leave openings | 3 | #2971 #3398 #3401 |
| lumps / cavity ownership ambiguous | 3 | #2454 #2887 #3212 |
| other (mesh bodies, sheet metal, budgets, split) | 20 | |

## A.2 Geometry situations (de-duplicated, by category)

Columns: issues; the situation; why it matters for us; repro (S = script in the body that we ran, F = needs an attached file that is not in the dump, T = text description only, - = none); their priority label / my priority (H, M, L for value as a test of our kernel); expected outcome if stated. "Ours" is the result of Part B where the situation was run.

### Fillet and chamfer

| issues | situation | why it matters for us | repro | prio | expected / ours |
|---|---|---|---|---|---|
| #3369 #3370 | R2 fillet on the edge between a bar top and a slot floor, both ends of the edge sit on the tangent seam where the flat top turns into a rounded end (stadium bar); tangent-chain pick also grabs smooth seam edges | the case a separate agent is fixing | S | P? / H | removed 5.150 mm3 (= (1-pi/4) r^2 L). Ours: 10.30 (WRONG, known) |
| #556 (closed) #397 #438 #1572 #1945 #2051 #2653 #2983 | a single-edge fillet/chamfer whose end meets a cylinder, a slanted face or several faces (box with a joined cylinder) | very common in real parts; the end treatment is where fillet kernels go wrong | S | - / H | small round along the edge, trimmed at the cylinder. Ours: runs ~3 r past the cylinder and notches it (WRONG) |
| #1207 | R2 fillet on the concave partial-arc edge where a bar top meets a joined boss; and on the straight top edge of the bar that runs out into the boss | concave blend on plane/cylinder, partial arc (not a full circle) | S | P2 / H | arc: +29.1 mm3 (full arc); straight: about -74.5. Ours: arc REFUSED (both edges), straight WRONG (-79.07, notch in the boss), one pick on the arc fillets only half |
| #1986 #2771 #2784 #3062 #1728 | chamfer/fillet refused as "larger than the neighbouring faces / taller than the walls" although the faces are large: walls split into stacked co-cylindrical faces after a prism join | face merging after booleans decides whether a blend fits | S (1986 as 1865 + chamfer) | P2 / M | 3 mm chamfer on the 120 degree sector arc edge removes 226.19. Ours PASS |
| #903 #1573 #1719 #2042 #2498 #2800 #3091 #1951 #2439 #1955 #293 | "blend larger than neighbouring faces", "largest radius that fits is X" (a `fit` option is requested) | blend limits must be reported with the radius that works; ours reports `blendOverflow`/`blendUnsupported` without a radius hint in the cases run | T | P2 / M | |
| #2567 #3284 #3333 #3377 #1039 #989 | blend ends in an earlier round / end face almost along the edge | chained fillets in the order a user applies them | - | P2 / M | |
| #2971 #3398 #3401 #1488 | "rounds would leave openings" after a join that needed the nudge; 0.0001 mm sliver faces left by the retry | sliver faces poison later blends | S (1488) | P1 / H | R1 on a 3.5 mm wall end edge removes 0.751. Ours PASS |
| #1390 (P1) | 0.5 chamfer on the rim of a sphere cut (ball tangent to the bottom face) grows the part by 0.65 mm3 and pokes 0.48 below z=0 | a blend that adds material must never be accepted | S | P1 / H | chamfer removes material, bbox z >= 0. Ours: REFUSED `blendUnsupported` (acceptable) |
| #1293 (P1) | 0.5 chamfer on a hinge knuckle cap circle adds 0.21 mm3 (should remove ~2.9) | same family | F (oracle design) | P1 / H | |
| #2797 #3300 | two-distance and distance+angle chamfer on plane-cylinder edges (straight and circular) | asymmetric chamfers on curved neighbours | S | P2 / M | 0.5 mm3 (straight, 1 x 0.1 x 10 / 2); 37.2 to 37.4 (circular 1 x 0.5). Ours PASS |
| #9 #52 #58 | setback corners, variable radius with mid points, 6-sided patch for three unequal radii, saddle fillet between two cylinders is not an exact rolling ball (~0.05 mm) | vertex blends and accuracy | T | P2-P3 / M | |
| #258 #691 #984 #1370 #1389 | cone to a point, half torus, freeform face put surface far off the part; degenerate rolling-ball spine; curved seam where a chain turns | fillet on cone/torus/spline faces | - | P2 / M | |
| #324 #2531 #3115 | fillet over a hole feature; a face picked by point re-attaches to another face after a parameter edit (shell opens a second face) | persistent naming for blends | T | P2 / M | |

### Booleans

| issues | situation | why it matters | repro | prio | expected / ours |
|---|---|---|---|---|---|
| #114 #1865 (P1) #3243 #1025 #938 #999 #1021 #1391 | join of solids meeting along coincident coaxial cylindrical faces (same radius, overlapping or adjacent); tube plus ring sector; rim plus tooth overlapping 0.01 mm; flange flush with a bent tapered loft | their kernel falls back to a planar-only path; ours should not need one | S/T | P1 / H | 114: one cylinder, 3 faces, 1500 pi. 1865: 7500 pi = 23561.94. 3243: 1992.70. Ours PASS (all) |
| #307 #1692 #2591 #2826 #308 #2040 #1690 | tangent or coplanar contacts: tangent hole circles, tool wall tangent to a chamfer cone edge, cut ending exactly on a face at a fillet tangent edge (zero-thickness double disc), blind cut ending 0.3 mm above a face inside a cylinder (spurious sphere/freeform face), extrude from a face rounded by fillets, text cut twice into a rounded block | the usual source of wrong topology; check faces and area, not only volume | S (2591, 1692) | P2 / H | 2591: 13 faces, area 1415.118, V 803.132. 1692: 35862.33. Ours PASS |
| #423 (P1) #1488 #1279 #1140 #1717 #1983 #2904 #3156 #24 #2579 | near-coincident data (0.002 to 1e-6 mm): through-all cut removes 4.73 mm3 behind its plane after the coplanar retry; vertex 1.65e-6 apart that never merges; tolerance proportional to the larger operand loses a small hole; retry silently drops part of a countersink; booleans stop terminating after a faceted fallback | tolerance policy; retries must be reported | S (1717, 3156), F (423, 1279) | P1 / H | 1717: 2043.655. 3156: 8608.97. Ours PASS |
| #1647 #1648 #1649 #924 #10 | generic-position property tests: box/cylinder intersect, sphere union box meshing, two crossing cylinders translated by 1000 mm lose volume; platform-dependent outcomes (16 of 96 seeds differ on Windows); random-design fuzzer | translation invariance and determinism are cheap to test | S | P2 / H | 1647: 7.2393; 1648: 8313.109; 1649: 2893.458 at both positions. Ours PASS |
| #500 (P1) #1691 (P1) | coaxial cut of a thin disc spanning x -1..1 loses 2.6 % of the volume; split by a plane across a chamfer cone loses 294 mm3 with no error | silent volume loss at seams and shallow-angle cone/plane | S | P1 / H | 500: 7539.82; 1691: piece 1288.617. Ours PASS |
| #451 (P1) #1107 #2454 #2887 #3212 #3379 | hollow (shelled) tools and cavities: a body inside the hollow is removed; crossing body cannot be cut; "cavity ownership ambiguous"; lumps errors with thin spokes | solids with voids | S | P1 / H | 451: inside block unchanged 512, crossing 653.343. Ours: crossing PASS, inside geometry right but flagged `cutNoEffect` |
| #168 #140 | edge-only contact joins two solids into one body; pad half past the target edge adds material under the overhang | non-manifold results | S | P2, closed / M | 168: 2 bodies. 140: 4500. Ours PASS |
| #2947 #500 #1452 #818 #1788 | faces that hold the seam of a periodic surface; blind cut splits every vertical edge at the cut depth (14 edges); points on a sketch leave separation lines on flat faces | seam handling and face splitting | S (818) | P2 / M | 818: 5 faces, no split seams. Ours PASS |
| #206 #367 #456 #522 #586 #632 ... (26 reports) | exact fallback is planar-only when the target has curved faces; "implausible result volume" refusals | this is their weakness, our curved booleans are general; use as a source of real parts | F | P2 / M | |
| #562 #2873 #746 | press-pull / extrude from a face next to rounds or curved neighbours | push-face on curved neighbours | T | P1 / M | |
| #793 #1760 #3100 #2566 #2979 #3118 #1552 | split/cut a coil or a body by a plane or sketch: "no result", "tool does not split the body" | helical sweeps vs a plane | S (793) | P2 / M | 793: 0.75 of 1977.9. Ours PASS |

### Shell, offset, thicken

| issues | situation | why | repro | prio | expected / ours |
|---|---|---|---|---|---|
| #142 #566 #1494 #3031 #3161 #1996 | corner whose faces do not meet the same way after the offset: saddle corners, four-face corners touching curved faces, swept bars with a bend, sheet-metal trays | shell/offset corner logic | S (566) | P2 / H | 566: 12 L + 14 = 1299.5. Ours PASS |
| #1525 #2421 #2432 #2917 #3000 #2480 #2905 #3105 #745 | "offset: only planes, cylinders, cones, spheres, tori"; Offset Face refuses a planar face when the body has a freeform face anywhere | free-form faces in shell/offset | T | P2 / M | |
| #2557 #2745 #3341 #1969 #1972 #1379 | move larger than a wall (faces would cross); shell of a sphere removes everything; a half sphere shells the hidden half; rim with no thickness where an open face meets a round | thickness limits and reporting | T | P2 / M | |
| #391 | R6 on a tapered tower then shell 2.5 open at the top | shell after fillet on drafted walls | S | P2 / H | Ours REFUSED `offsetUnsupported {detail:"edge curve type"}` |
| #23 #2531 | open face picked by point re-attaches after a parameter edit | naming | S | P2 / M | |

### Loft, sweep, pipe, revolve, coil

| issues | situation | why | repro | prio | expected / ours |
|---|---|---|---|---|---|
| #2847 | loft through identical non-circular sections on planes rotating about a common axis folds once the span exceeds ~90 degrees (6 % of Pappus volume at 180), no error | silent wrong body | S | P2 / H | Pappus pi a b R theta. Ours WRONG (same numbers as theirs) |
| #1093 #1107 #2992 #1856 #3379 | patterns of lofted blades joined to a hub (31 min; "cavity ownership ambiguous"; 36 twisted blades; 20-tooth helical pinion) | many-operand joins of freeform solids | S (1093) | P2 / H | 1093: 48039. Ours 47990 in 1.2 s |
| #1391 #1669 #1140 #1488 | join/mirror/cut around lofts: flange flush with a bent tapered loft, mirror of a cut plus loft join at wall 3.5, hollow lofted tube cut in half | lofts in booleans | F/py | P2 / M | |
| #1666 | STL/3MF of a body with ruled loft faces: each face two triangles, self-intersecting, 1 % volume error | tessellation of ruled/twisted faces | S (truncated) | P1 / M | |
| #2005 #2954 #1402 #3345 #3006 #2993 #2891 | sweep cut/join no result or unexpected; sweep cut crashes the web build | sweeps in booleans | T | P2 / M | |
| #2004 #2453 #3076 #1853 #3156 | revolve: implausible volume, profile crosses the axis (refused), end faces flush with a face (needs the nudge) | revolve end cases | S (3156) | P2 / M | 3156: 8608.97. Ours PASS |
| #3111 #2570 #1988 #201 #3402 #3326 | loft with inner loops unsupported, freezes, hidden bodies merged, three 45-degree circles look wrong | loft inputs | F | P2-P3 / M | |

### Draft and taper

| issues | situation | why | repro | prio | expected / ours |
|---|---|---|---|---|---|
| #831 #2810 (closed) #1531 | tapered extrude of an arc meeting a line at a corner, text/spline profiles, all-arc loop whose arcs meet at corners (wrong walls without an error, +0.36 %) | offsetting profiles with corners | S | P2 / H | 831 D shape: 87.90; 2810: 18907.67. Ours PASS (text glyph profile not run) |
| #390 #1126 #2586 #2766 #3176 | draft of a flange end face refused when a tapered boss exists elsewhere; draft on faces with non-perpendicular sides | draft preconditions are too global | S (390) | P2 / M | |wedge| 79.24. Ours PASS |
| #1183 | tapered hexagon walls and pockets on a plate with 8 mm (builds) and 10 mm (fails) corner fillets, 2x2 patterns | interplay of taper, pattern and fillet | S | P2 / M | must build. Ours PASS for both |

### Holes and threads

| issues | situation | why | repro | prio | expected / ours |
|---|---|---|---|---|---|
| #559 (P1) #367 #3050 #3130 #2055 #967 | through-all hole running along a wall or beside curved faces (1 mm hole into a 2 mm rim of a shelled box) | hole in thin walls | S | P1 / H | removes pi/4 x 30 = 23.562. Ours PASS |
| #1355 #1736 #661 #2904 #1023 | concentric holes with a drill-tip bottom (degenerate case); countersink partially lost in a retry; panic in `solid.hole` with a tip; hole hangs the UI | drill tips and coaxial cuts | S (1355 reconstructed) | P1 / H | V 8627.16. Ours REFUSED `booleanFailed` on the second hole |
| #2038 #1443 #2969 #1731 #3337 #2892 #3183 #2470 #1250 | modeled threads: a second thread on one body, combine of two threaded bodies hangs, hole too wide, "shell not oriented and closed", "tree too deep", stack overflow, inefficiency | threads stress booleans | S (2038) | P1 / M | two modeled threads must build. Ours PASS (standard sizes) |
| #1219 #2974 | cut of 24 grooves into a bore 350x slower when the bore edge has an unrelated R1 fillet | retry storms | S | P2 / M | 124568.06 (OCCT). Ours PASS 0.2 s |

### Patterns and mirror

| issues | situation | why | repro | prio | expected / ours |
|---|---|---|---|---|---|
| #2076 #255 #2037 #2811 | pattern of a cylinder join scales quadratically (100 pins 84 s, 225 pins 527 s); fillets on many edges grow faster than N^2 | many-operand booleans | S | P2 / H | 8650.78. Ours 0.4 s |
| #3378 #3379 #2450 #2524 #2885 #3279 #3302 #2755 #2464 | circular pattern of a join fails (`unknown body`, `lumps`), copies cut every body they meet | patterns | S (3379) | P2 / M | 3379: 6917.72 and 6280.00. Ours PASS |
| #3247 #2774 #2997 | skip instances; blends copied once; pattern on path | feature requests | - | P3 | |

### Sketch regions, solver, attachment

| issues | situation | why | repro | prio | expected |
|---|---|---|---|---|---|
| #741 | profile from a planar loop of 3D sketch curves | regions out of plane | S (not run) | P2 / M | 1 profile + tilted triangles |
| #3261 #195 #344 #2478 #2493 #2505 #2514 #2530 #2585 #3037 | sketch/plane attached to a face breaks when upstream edit changes the face (topological naming); "no exact planar source" | naming | T | P2 / H | |
| #1788 #307 #168 #458 #608 | points on a sketch leave separation lines; tangent circles; narrow/zero-width faces after double cuts | region building with tangent/overlapping curves | T | P3 / M | |
| #320 #590 #2940 #2961 #1796 #1976 #3360 | over-constraining should become a driven dimension; symmetric constraint failures; constrained drag stops short (four-bar 10/40/20/42: closest feasible grab for cursor (-7,11.2) is (-3.70999258, 5.93598813)) | solver behaviour | S (numbers in #3360) | P2 / M | |
| #939 #2424 #754 #44 #47 #1110 | sketch offset of splines, arc length dimension, project/intersect | sketch features | T | P2 / L | |
| #3248 #2748 #3216 | plane origin as expression silently becomes 0; parameter import forward references | silent defaults | S | P2 / L | |

### Import, export, tessellation

| issues | situation | why | repro | prio | expected |
|---|---|---|---|---|---|
| #3351 #1706 (negative volume at 1e6 mm) #1974 #1033 #1934 #2872 #3120 | STEP import drops faces whose vertices sit slightly off their curves; bodies at 10^6 mm with negative volume; production assemblies import as "circles" | healing and trimmed freeform surfaces | F | P1-P2 / H | |
| #3358 #14 | IGES: composite trim curve whose pieces run end to start is dropped (5358 of 9276 faces) | IGES trims | F | P2 / M | |
| #1374 #1784 #2809 #2814 #3108 #3221 | STEP import runs out of memory (unbounded curve subdivision), 38 MB, 61 MB assemblies in an hour | resource limits | F | P1 / M | |
| #11 #3394 #1985 | STEP export merges user-split faces, loses faces, never finishes on a small box/cylinder part | export correctness | F/T | P1 / M | |
| #311 #1400 #3020 #1648 #1452 #1468 #1493 #818 | tessellation: ramp cut pinches a cylinder (chord-midpoint deficit 4.36 mm), groove fillet leaves 36 open STL edges, boundary parameter spike, periodic faces mesh outside the trim, black flat B-spline faces | holes and normals | F | P1 / H | |
| #1666 #2998 #469 #346 #358 #744 #1200 | 3MF/STL validity; mesh-to-solid limits; hostile DXF/SVG | io | F | P1-P2 / L | |

### Sheet metal (out of scope for our kernel today)

#296 (closed), #501, #732, #1231, #1325, #1326, #1475, #1603, #2987, #3078, #3353: base/edge flanges, bend relief, flat pattern, perforation budgets. Listed under NOT EXPRESSIBLE.

## A.3 Top 40, ranked by value for testing our kernel

Ranking rule: first the situations our kernel gets wrong (they are the tests that pay), then P1 situations with a repro, then situations that exercise a different subsystem from the ones already covered, then the rest. "Ours" is from Part B.

| rank | issue(s) | situation | their label | repro | ours |
|---|---|---|---|---|---|
| 1 | #3369 (#3370) | R2 fillet, edge ends on a tangent seam | - | S | WRONG (10.30 vs 5.15), being fixed elsewhere |
| 2 | #556 | fillet/chamfer end meeting a cylinder wall | closed | S | WRONG: runs 3 r past the end |
| 3 | #1207 | fillet at a boss: concave partial arc, straight edge into it | P2 | S | REFUSED / WRONG / half |
| 4 | #2847 | loft through rotated non-circular sections | P2 | S | WRONG, silent, `validate` ok |
| 5 | #1390 | chamfer on a sphere cut rim grows the part | P1 | S | REFUSED |
| 6 | #391 | shell after fillet on drafted tower | P2 | S | REFUSED |
| 7 | #1355 (#1736 #661) | coaxial hole with drill tip | P2/P1 | S (rebuilt) | REFUSED |
| 8 | #1691 | split across a chamfer cone loses 294 mm3 | P1 | S | PASS |
| 9 | #1717 | overlapping sphere cuts | P2 | S | PASS |
| 10 | #500 | thin symmetric disc, coaxial cut | P1 | S | PASS |
| 11 | #3243 | rim and tooth, coincident cylinders, 0.01 overlap | P2 | S | PASS |
| 12 | #1865 | union meeting along cylindrical faces | P1 | T | PASS |
| 13 | #114 | same-radius extrude on a cylinder | P2 | T | PASS |
| 14 | #451 | hollow tool cut | P1 | S | crossing PASS, inside flagged `cutNoEffect` |
| 15 | #1488 | sliver after nudge, later fillet | P1 | S | PASS |
| 16 | #423 | through-all cut removes material behind the plane | P1 | F | not run |
| 17 | #1293 | chamfer adds material (knuckle cap) | P1 | F | not run |
| 18 | #559 | through hole into a shelled rim | P1 | S | PASS |
| 19 | #2591 (#2826) | zero-thickness double disc, 13 faces | P2 | S | PASS |
| 20 | #2810 | tapered all-arc loop, analytic volume | closed | S | PASS |
| 21 | #831 | tapered D shape (arc meets line); text profile | P2 | S | D PASS; text not run |
| 22 | #1647 #1648 #1649 | generic-position property tests | P2 | S | PASS |
| 23 | #566 (#142) | shell of a swept bend | P2 | S | PASS |
| 24 | #1093 (#1107 #2992 #1856) | pattern of lofted blades | P2 | S | PASS 1.2 s |
| 25 | #2076 | pattern of joins, quadratic | P2 | S | PASS 0.4 s |
| 26 | #1219 | cut near an unrelated fillet, 73 s | P2 | S | PASS 0.2 s |
| 27 | #3156 | revolve end faces flush with a face | P2 | S | PASS |
| 28 | #793 | coil split by a plane | P2 | S | PASS |
| 29 | #2038 | second modeled thread on a body | P1 | S | PASS |
| 30 | #3379 (#3378) | circular pattern of a thin spoke | P2 | S | PASS |
| 31 | #390 | draft on a flange end face | P2 | S | PASS |
| 32 | #1183 | tapered hexagon pockets, 10 mm corner fillets | P2 | S | PASS |
| 33 | #1986 | chamfer on an arc edge after a prism join | P2 | S | PASS |
| 34 | #818 | blind cut must not split seams | P2 | S | PASS |
| 35 | #168 #140 | edge-only contact; overhanging pad | closed | S | PASS |
| 36 | #2797 (#3300) | asymmetric chamfers on plane-cylinder edges | P2 | S | PASS |
| 37 | #311 (#1400 #3020) | tessellation of trimmed cylinders after a ramp cut | P1 | F | not run |
| 38 | #3351 #1706 #3358 #1452 | STEP/IGES healing and trimmed freeform surfaces | P1-P2 | F | not run |
| 39 | #2947 #2579 #1983 | seam inside a revolved face; tolerance scaling on large bodies; termination after a faceted fallback | P1-P2 | T | not run |
| 40 | #308 #1692 #2826 | blind cut ending 0.3 mm above a face in a cylinder; tool tangent to a chamfer cone; cut up to a face leaves a skin | P2 | S/F | 1692 PASS; others not run |

---

# Part B: running them

## Conventions (verified numerically)

World coordinates are kept as in the issues. Our std planes, read from the solved sketch frames: `front` u=x v=y n=+z; `top` u=x v=-z n=+y; `right` u=-z v=y n=+x (so their YZ sketch is our `right` with u/v swapped, as in the slot case, and their XZ sketch has v = -z, like our `top`). `lib.mjs` therefore builds each sketch from right-handed pairs about the axis (z: (x,y), x: (y,z), y: (z,x)) and maps them onto the std plane (a rotation in all three cases, so counter-clockwise arcs stay counter-clockwise); a plane that does not pass through the origin is an offset plane feature. Cut direction: `op:"cut"` goes along -n unless `flip`, `op:"add"` along +n (`extrudeSketch` sets `flip` from the sign of the requested interval; checked by volume on a box). Fillet/chamfer edges are `{faces:[...],at:[x,y,z]}` taken from a `closestPoint` query on the prefix (distance < 0.05). Face picks for shell/draft/thread come from `closestPoint on face`. There is no box/cylinder/sphere primitive, so primitives are sketch + extrude/revolve (a sphere is a half-disc revolved about its diameter). `intersect` does not exist as a feature, so intersections are measured as V(A) - V(A - B). Each case file was also run through `kit/docs/bench-solidcraft/ours_run.mjs` (cold regen, fresh instance) for three cases and gave identical volume, area and face counts to the runner.

Adaptations that change the original script (all noted in `manifest.json`): #3243 is built tooth first, then the base disc and bore (same final solid); #1691 uses a simple hole plus a D9 x 1.5 cut instead of a counterbore hole because `kind:"cbore"` with a free diameter is `holeInvalid` (no hint); #2038 uses table sizes (M12x1.25, M24x1.5) because the thread table does not know M13.5x1.337; #3379 starts the spoke at x=10 instead of 12 so it overlaps the hub; #1649 reads `at` as the base centre (our own numeric integration gives 2893.457 at both positions; the issue quotes 2955.58 for the origin position, I could not reproduce that figure from any reading of its parameters, which does not matter for the translation-invariance check); #1355, #451, #1183 and #1093 are reconstructed from the prose and scripts (hexagon orientation and pocket direction in #1183 are my reading); #1207 is run with both halves of the arc as separate edges, plus the single-pick variant.

Classification: PASS (kernel `ok`, no feature error, `validate` ok, all expectations met), WRONG RESULT (no error but an expectation is not met), REFUSED (a feature error; code and parameters shown), CRASH / HANG (child process killed at 60 s: none occurred), NOT EXPRESSIBLE (needs something we do not have), NOT RUN (data not in the dump).

## B.1 Results

Expected values are analytic (formulas in `cases/manifest.json`, field `formula`) or the issue's own exact figure where it gives one (2591, 1219, 2810). `dV` means the change in volume against the `*.base.ckpart` prefix. Times are cold wall seconds in the runner's child process (wasm instantiation included).

| # | case | outcome | kernel result (ok / errors) | ours | expected | faces | valid | s |
|---|---|---|---|---|---|---|---|---|
| #3369 | [slot-seam-r2](cases/3369-slot-seam-r2.ckpart) | **WRONG RESULT** | ok | V 9758.5152 (dV -10.3009) | dV -5.15 | 15 | true | 0.07 |
| #556 | [box-cyl-fillet](cases/556-box-cyl-fillet.ckpart) | **WRONG RESULT** | ok | V 45571.1706 (dV -0.5097) | dV -0.429 | 12 | true | 0.11 |
| #556 | [box-cyl-chamfer](cases/556-box-cyl-chamfer.ckpart) | **WRONG RESULT** | ok | V 45570.4928 (dV -1.1875) | dV -1 | 12 | true | 0.06 |
| #1207 | [arc-edge-boss-r2](cases/1207-arc-edge-boss-r2.ckpart) | **REFUSED** | errors: B1 blendOverflow | V 49756.1794 | dV 29.119 | 7 | true | 0.08 |
| #1207 | [straight-edge-into-boss-r2](cases/1207-straight-edge-into-boss-r2.ckpart) | **WRONG RESULT** | ok | V 49677.1117 (dV -79.0677) | dV -74.485 | 11 | true | 0.07 |
| #559 | [rim-hole-through](cases/559-rim-hole-through.ckpart) | **PASS** | ok | V 19968.4381 (dV -23.5619) | dV -23.562 | 12 | true | 0.05 |
| #500 | [thin-disc-cut-sym](cases/500-thin-disc-cut-sym.ckpart) | **PASS** | ok | V 7539.8224 | V 7539.8224, 4 faces | 4 | true | 0.06 |
| #500 | [thin-disc-cut-asym](cases/500-thin-disc-cut-asym.ckpart) | **PASS** | ok | V 11309.7336 | V 11309.7336, 4 faces | 4 | true | 0.06 |
| #1717 | [two-sphere-cuts](cases/1717-two-sphere-cuts.ckpart) | **PASS** | ok | V 2043.6548 | V 2043.6548 | 9 | true | 0.08 |
| #1647 | [box-cyl-general](cases/1647-box-cyl-general.ckpart) | **PASS** | ok | V 142.4581 (dV -7.2393) | dV -7.239 | 8 | true | 0.05 |
| #1648 | [sphere-box-union](cases/1648-sphere-box-union.ckpart) | **PASS** | ok | V 8313.1091 | V 8313.1091 | 8 | true | 0.09 |
| #1649 | [crossing-cyl-origin](cases/1649-crossing-cyl-origin.ckpart) | **PASS** | ok | V 2893.4579 | V 2893.4568 | 6 | true | 0.10 |
| #1649 | [crossing-cyl-moved1000](cases/1649-crossing-cyl-moved1000.ckpart) | **PASS** | ok | V 2893.4579 | V 2893.4568 | 6 | true | 0.10 |
| #3243 | [ring-tooth-union](cases/3243-ring-tooth-union.ckpart) | **PASS** | ok | V 1992.7262 | V 1992.7044 | 8 | true | 0.14 |
| #114 | [coincident-cylinder-join](cases/114-coincident-cylinder-join.ckpart) | **PASS** | ok | V 4712.389 | V 4712.389, 3 faces | 3 | true | 0.06 |
| #168 | [edge-contact-join](cases/168-edge-contact-join.ckpart) | **PASS** | ok | V 3556.2829 | V 3556.2829, 2 bodies | 7 | true | 0.11 |
| #1865 | [tube-sector-cyl-faces](cases/1865-tube-sector-cyl-faces.ckpart) | **PASS** | ok | V 23561.9449 | V 23561.9449 | 7 | true | 0.09 |
| #818 | [blind-cut-splits-seams](cases/818-blind-cut-splits-seams.ckpart) | **PASS** | ok | V 23737.0887 | V 23737.0887, 5 faces | 5 | true | 0.06 |
| #1390 | [sphere-rim-chamfer](cases/1390-sphere-rim-chamfer.ckpart) | **REFUSED** | errors: CH blendUnsupported | V 16940.6337 | dV < 0 | 12 | true | 0.10 |
| #2591 | [cut-on-face-at-fillet-tangent](cases/2591-cut-on-face-at-fillet-tangent.ckpart) | **PASS** | ok | V 803.127 | V 803.132, A 1415.118, 13 faces | 13 | true | 0.08 |
| #3156 | [revolve-90-flush-join](cases/3156-revolve-90-flush-join.ckpart) | **PASS** | ok | V 8608.9702 | V 8608.9703 | 10 | true | 0.06 |
| #390 | [draft-flange-end](cases/390-draft-flange-end.ckpart) | **PASS** | ok | V 2.20274e+5 (dV -79.2406) | |dV| 79.24 | 11 | true | 0.04 |
| #391 | [fillet-then-shell](cases/391-fillet-then-shell.ckpart) | **REFUSED** | errors: SH offsetUnsupported | V 2.19462e+5 | sanity | 19 | true | 0.09 |
| #831 | [taper-d-shape](cases/831-taper-d-shape.ckpart) | **PASS** | ok | V 87.9005 | V 87.9019 | 4 | true | 0.05 |
| #2810 | [taper-arc-loop-corners](cases/2810-taper-arc-loop-corners.ckpart) | **PASS** | ok | V 18907.6766 | V 18907.67 | 6 | true | 0.06 |
| #2797 | [chamfer-two-dist-straight-edge](cases/2797-chamfer-two-dist-straight-edge.ckpart) | **PASS** | ok | V 2610.5125 (dV -0.5) | dV -0.5 | 7 | true | 0.06 |
| #2797 | [chamfer-two-dist-circular-edge](cases/2797-chamfer-two-dist-circular-edge.ckpart) | **PASS** | ok | V 5492.0276 (dV -37.1755) | dV -37.3 | 5 | true | 0.09 |
| #2076 | [pins-one-sketch](cases/2076-pins-one-sketch.ckpart) | **PASS** | ok | V 8650.7831 | V 8650.7831 | 206 | true | 0.39 |
| #2076 | [pins-pattern](cases/2076-pins-pattern.ckpart) | **PASS** | ok | V 8650.7831 | V 8650.7831 | 206 | true | 0.31 |
| #1219 | [bore-fillet-24-grooves](cases/1219-bore-fillet-24-grooves.ckpart) | **PASS** | ok | V 1.24568e+5 | V 1.24568e+5 | 128 | true | 0.17 |
| #1355 | [concentric-holes](cases/1355-concentric-holes.ckpart) | **REFUSED** | errors: H2 booleanFailed | V 8667.9725 | V 8627.1633 | 8 | true | 0.07 |
| #1691 | [split-across-chamfer-cone](cases/1691-split-across-chamfer-cone.ckpart) | **PASS** | ok | V 1288.617 | V 1288.617 | 5 | true | 0.12 |
| #2847 | [loft-rotated-ellipses-90](cases/2847-loft-rotated-ellipses-90.ckpart) | **PASS** | ok | V 2219.9294 | V 2220.661 | 4 | true | 0.12 |
| #2847 | [loft-rotated-ellipses-120](cases/2847-loft-rotated-ellipses-120.ckpart) | **WRONG RESULT** | ok | V 1730.3417 | V 2960.8813 | 4 | true | 0.20 |
| #2847 | [loft-rotated-ellipses-180](cases/2847-loft-rotated-ellipses-180.ckpart) | **WRONG RESULT** | ok | V 246.7391 | V 4441.322 | 4 | true | 0.18 |
| #793 | [coil-cut-by-plane](cases/793-coil-cut-by-plane.ckpart) | **PASS** | ok | V 1480.4393 | V 1483.4376 | 4 | true | 0.25 |
| #566 | [shell-swept-bar](cases/566-shell-swept-bar.ckpart) | **PASS** | ok | V 1299.4867 | V 1299.4867 | 19 | true | 0.06 |
| #3379 | [spoke-pattern-flush](cases/3379-spoke-pattern-flush.ckpart) | **PASS** | ok | V 6917.7172 | V 6917.7172, 1 bodies | 23 | true | 0.10 |
| #3379 | [spoke-pattern-thin](cases/3379-spoke-pattern-thin.ckpart) | **PASS** | ok | V 6279.9972 | V 6279.9972, 1 bodies | 27 | true | 0.14 |
| #1093 | [impeller-loft-pattern](cases/1093-impeller-loft-pattern.ckpart) | **PASS** | ok | V 47990.5147 | V 48039 | 30 | true | 1.25 |
| #2038 | [two-modeled-threads](cases/2038-two-modeled-threads.ckpart) | **PASS** | ok | V 10781.6294 |  | 31 | true | 0.69 |
| #1183 | [dumpling-mould-corner-r8](cases/1183-dumpling-mould-corner-r8.ckpart) | **PASS** | ok | V 1.47364e+5 | sanity | 57 | true | 0.15 |
| #1183 | [dumpling-mould-corner-r10](cases/1183-dumpling-mould-corner-r10.ckpart) | **PASS** | ok | V 1.46993e+5 | sanity | 57 | true | 0.15 |
| #1488 | [fillet-after-flush-join](cases/1488-fillet-after-flush-join.ckpart) | **PASS** | ok | V 41598.1978 (dV -0.7511) | dV -0.751 | 23 | true | 0.23 |
| #1692 | [cut-outside-ring-on-chamfered-disc](cases/1692-cut-outside-ring-on-chamfered-disc.ckpart) | **PASS** | ok | V 35862.3273 | V 35862.3273 | 8 | true | 0.10 |
| #451 | [hollow-tool-cut-inside](cases/451-hollow-tool-cut-inside.ckpart) | **REFUSED** | errors: SHL cutNoEffect | V 512 | V 512 | 6 | true | 0.07 |
| #451 | [hollow-tool-cut-crossing](cases/451-hollow-tool-cut-crossing.ckpart) | **PASS** | ok | V 653.3429 | V 653.343 | 6 | true | 0.13 |
| #140 | [pad-hangs-past-edge](cases/140-pad-hangs-past-edge.ckpart) | **PASS** | ok | V 4500 | V 4500, 1 bodies | 12 | true | 0.06 |
| #1986 | [chamfer-arc-edge-after-join](cases/1986-chamfer-arc-edge-after-join.ckpart) | **PASS** | ok | V 23335.7502 (dV -226.1947) | dV -226.195 | 8 | true | 0.77 |
| #1207 | [arc-edge-boss-r2-single-pick](cases/1207-arc-edge-boss-r2-single-pick.ckpart) | **WRONG RESULT** | ok | V 49771.0643 (dV 14.8849) | dV 29.119 | 11 | true | 0.16 |

Not run (27):

- #296 (NOT EXPRESSIBLE): Sheet metal: hole cut through a base with two adjacent edge flanges (sew: nonmanifold edge contact; expected V=13916.01 A=12035.96 for two holes). no sheet-metal features (base/edge flange, bend rules, flat pattern) in the ckpart schema.
- #501 (NOT EXPRESSIBLE): Edge flange with different per-edge angles leaves open corner gaps. sheet-metal edge flange.
- #732 (NOT EXPRESSIBLE): Perforated sheet panel: 2000 holes in one cut exceed the budget. sheet-metal; the plain-solid analogue (2000 holes in a plate) is covered by 2076-pins-one-sketch scaled down.
- #3353 (NOT EXPRESSIBLE): Mirrored sheet body loses its flat pattern. sheet-metal flat pattern.
- #2755 (NOT EXPRESSIBLE): Pattern/mirror copies of a primitive cut every body they meet, ignoring the seed's targets. our features act on one body; there is no per-feature target list, so the situation cannot arise.
- #3378 (NOT EXPRESSIBLE): Circular pattern of a join that merged its targets fails with unknown body. no body targets (single body per part); see 3379-spoke-pattern-* for the geometric half.
- #2464 (NOT EXPRESSIBLE): Extrude join/cut changes hidden bodies too. no multi-body target selection in a part.
- #3248 (NOT EXPRESSIBLE): sketch.create custom plane origin given as an expression silently becomes [0,0,0]. SolidCraft command parsing; our planes are features with numeric/expression offsets (no silent zero).
Updated 2026-10-20: after the second pass 16 issues remain unrunnable (the other 11 are cases now, Part C.2). Their reasons are in `cases/not_run.json`:

- NOT EXPRESSIBLE (7): #296, #501, #732, #3353 (sheet metal: no flange / bend / flat-pattern features in the part model); #2755, #2464 (per-feature body targets and hidden bodies: a part has one solid, no `targets`); #3248 (SolidCraft command parsing of a plane origin given as an expression).
- NOT RUN (9): #1279 (zip attachment, not downloaded), #3358 (IGES: no IGES reader; no attachment), #1374, #1784, #1974, #2809 (large or private STEP files not attached or external), #2037 (SolidCraft design + imported STEP body: needs the STEP), #1856 (zip bundle on a gist, not downloaded), #1140 (generator readable now, but 56 section planes normal to a horizontal path tangent cannot be authored: our plane features take offset / mid / angle about picked references).

## B.2 Notes on the individual verdicts

- **#3369 slot seam**: dV -10.30 against -5.150 (known, another agent is on it).
- **#556** (box 40x40x20 + cylinder r12 at (40,20), bottom edge of the x=40 face, y 0..8). The edge is 8 long, so a 0.5 fillet should remove 0.429 mm3 and a 0.5 chamfer 1.000. Ours remove 0.5097 and 1.1875. Independent check (`verify_wrong.mjs`): the point (39.97, 9.0, 0.03) is inside the joined cylinder (11 from its axis, 0.03 above the bottom) and inside the solid before the fillet, outside after it; bisection on the line x=39.97, z=0.03 shows material removed up to y = 9.500 = 8 + 3 r, for the fillet and the chamfer alike. The blend overshoots its end by three radii into the cylinder.
- **#1207 straight edge** (top edge y=15 of the bar, R2, runs into the boss at x = 13.2): dV -79.07 against about -74.5; the point (10, 14.97, 9.97), 18 from the boss axis, is inside the boss before and outside after; material is removed from x = 7.89 (13.2 minus about 3 r again) on the line y=14.97, z=9.97.
- **#1207 arc**: the arc between the bar top and the boss is two B-rep edges (split at the cylinder seam, angle 0). With both edges picked the fillet is REFUSED (`blendOverflow {detail:"B1.B1: spring leaves its face away from its edges"}`). With the one pick of the issue, only the half that holds the pick is rounded (probe: fillet material present at +30 degrees, absent at -30 degrees), dV +14.88 against +29.1 for the full arc. This second part may be by design (an edge ref names one B-rep edge), but a one-pick script silently gets half a fillet.
- **#2847**: loft through 13 and 19 ellipse sections (semi-axes 3 and 5, centre 30 from the Z axis, planes rotated every 10 degrees about Z). Reference: one ellipse revolved 180 degrees gives 4441.32 = Pappus. The loft gives 1730.3 at 120 degrees and 246.7 at 180 degrees, `ok`, `validate` ok, no warning; SolidCraft's report quotes 1745 and 247. The 90 degree loft is right (2219.9 against 2220.7).
- **#1390**: refused with `blendUnsupported` and no hint; their bug (part grows) is therefore not reproduced, but a valid chamfer is declined.
- **#391**: shell 2.5 refused after R6 on the four edges of a tower with a 2 degree outward taper: `offsetUnsupported {detail:"edge curve type"}` (the fillet edges on tapered faces are not circles).
- **#1355**: first hole (D8.5 x 5, 118 degree tip) builds; the second (D4 through, same axis) is `booleanFailed`; expected volume 8627.16.
- **#451 inside**: the block stays 512.000 (correct) but the feature reports `cutNoEffect` as an error; the crossing block gives 653.3429 against 653.343.
- **PASS rows that matter most**: #1717 (2043.6548 against 2043.6548 from the closed form), #500 (exact), #1691 (1288.617 against the polar quadrature 1288.617), #3156 (8608.970), #2810 (18907.677 against 18907.67), #3243, #1865, #114, #2591 (13 faces and area 1415.118), #1219 (124568.06 within 2e-5 in 0.2 s; they take 73 s).
- Close calls to know about: #831 is 87.9005 against 87.9019 (the 4e-4 gap is the difference between mitred and rounded corners in the formula); #1093 is 0.1 % under the issue's figure (47990.5 against 48039, whose blade geometry is read from the same script but whose hub/blade overlap is not stated).

## B.3 Re-running

```
cd kit/docs/solidcraft-issues
node run_cases.mjs                      # table on stdout, one child process per part, 60 s limit
node run_cases.mjs --only 556,2847      # by issue number
node run_cases.mjs --md --json out.json # markdown rows / machine-readable results
node verify_wrong.mjs                   # the independent probes behind the WRONG RESULT rows
node gen_cases.mjs                      # regenerate cases/ (needs the kernel; edge picks are resolved against it)
CK_WASM=/path/to/ck_wasm.wasm node run_cases.mjs
```

---

# Part C: the rest of the tracker (second pass, 2026-10-20)

Scope: everything the first pass did not read, 1165 issues of the 1779 in the 2026-10-20 snapshot (the snapshot grew from 1774 while this was written; the 5 newcomers #3403 to #3407 are included). Order: (a) retry the 27 not-run issues, (b) feature ideas from the 214 `enhancement` issues and the UI / render / doc / infra ones, (c) unlabelled and needs-triage issues that look like geometry problems. Same method as Part B: cold regeneration, expected values from formulas or from the issue's own exact figures, every WRONG RESULT re-derived independently (below). Added files: `gen_cases2.mjs` (the generators for these cases), extra judge checks in `run_cases.mjs` (`mesh`, `step`, `noKinds`) and a mesh / STEP round-trip probe in `lib.mjs`.

## C.1 Where the 1165 issues went

| pass | what | issues | result |
|---|---|---|---|
| 2a | the 27 not-run issues of Part B, retried with their comments | 27 | 11 became cases (15 case files), 16 stay unrunnable |
| 2b | `enhancement` (214, 137 of them outside the geometry labels) and feature requests found by title | 232 | `solidcraft-feature-ideas.md` (top 15 + the rest by area) |
| 2c | unlabelled / needs-triage / `bug` issues with a geometry flavour | 417 | 25 issues converted to 29 cases; 392 not testable here (see C.3) |
| 2d | app, UI, render, infra, platform, i18n, docs: triaged from title and labels only | 568 | no action for the kernel; clusters listed in the feature-ideas note |

Depth: pass 2d and the non-repro part of 2c were triaged from title, labels and the first lines, not read closely. If a cluster matters (for example the 25 font / preferences reports, the 22 SpaceMouse reports), read its issues then; `check_new.mjs` lets you re-mark them with a better outcome.

## C.2 Not-run issues retried (pass 2a)

What changed: the dump had cut several bodies at 8 KB; the full text of #308, #745, #1107, #1140, #1985, #2992 and #1666 is now readable, #1293 has a maintainer comment (fixed upstream), #141's setup is described in the PRs #119 and #126, and #2826's stand-in could be rebuilt with an exact blind cut. Attachments: only plain text was read. The two zip files (#1279, #1856) were not downloaded; JSON attachments were not needed.

| # | case | outcome | ours | expected | faces | s | detail |
|---|---|---|---|---|---|---|---|
| #308 | [hinge-knuckle-blind-cut](solidcraft-issues/cases/308-hinge-knuckle-blind-cut.ckpart) | PASS | V 4783.1169 | 4783.1127 | 14 | 0.28 |  |
| #1293 | [chamfer-knuckle-cap](solidcraft-issues/cases/1293-chamfer-knuckle-cap.ckpart) | PASS | V 4433.3946 (dV -2.8566) | dV -2.7855 | 19 | 0.22 |  |
| #745 | [offset-face-with-spline-boss](solidcraft-issues/cases/745-offset-face-with-spline-boss.ckpart) | PASS | V 8671.5114 (dV 200.0009) | dV 200 | 9 | 0.28 |  |
| #1107 | [hub-9-blades-combine](solidcraft-issues/cases/1107-hub-9-blades-combine.ckpart) | PASS | V 20788.4971 | 20788.497 | 37 | 2.47 |  |
| #1107 | [hub-9-blades-tip-trim](solidcraft-issues/cases/1107-hub-9-blades-tip-trim.ckpart) | PASS | V 19976.0718 (dV -812.4253) |  | 37 | 2.89 |  |
| #1666 | [loft-mesh-valid](solidcraft-issues/cases/1666-loft-mesh-valid.ckpart) | PASS | V 17993.4055 | 17993.4055 | 20 | 0.13 |  |
| #1706 | [step-roundtrip-1e6](solidcraft-issues/cases/1706-step-roundtrip-1e6.ckpart) | **REFUSED** | V 6000 | 5666.9912 | 6 | 0.10 | E6: booleanFailed; E9: booleanFailed |
| #1706 | [step-roundtrip-1e6-block](solidcraft-issues/cases/1706-step-roundtrip-1e6-block.ckpart) | PASS | V 6000 | 6000 | 6 | 0.05 |  |
| #1985 | [enclosure-step-export](solidcraft-issues/cases/1985-enclosure-step-export.ckpart) | PASS | V 44967.4557 |  | 27 | 0.16 |  |
| #141 | [boss-ring-0.5deg-pos1](solidcraft-issues/cases/141-boss-ring-0.5deg-pos1.ckpart) | PASS | V 1.454137e+05 | 1.454137e+05 | 12 | 0.20 |  |
| #141 | [boss-ring-0.5deg-pos2](solidcraft-issues/cases/141-boss-ring-0.5deg-pos2.ckpart) | PASS | V 1.457518e+05 | 1.457518e+05 | 12 | 0.21 |  |
| #141 | [boss-ring-0.5deg-pos3](solidcraft-issues/cases/141-boss-ring-0.5deg-pos3.ckpart) | PASS | V 1.448881e+05 | 1.448881e+05 | 12 | 0.17 |  |
| #2826 | [cut-ends-in-top-face](solidcraft-issues/cases/2826-cut-ends-in-top-face.ckpart) | PASS | V 3942.5052 | 3942.5052 | 9 | 0.10 |  |
| #3378 | [spoke-pattern-merged-targets](solidcraft-issues/cases/3378-spoke-pattern-merged-targets.ckpart) | PASS | V 6916.9021 | 6916.9021 | 26 | 0.20 |  |
| #2992 | [disk-36-twisted-blades](solidcraft-issues/cases/2992-disk-36-twisted-blades.ckpart) | PASS | V 3.533287e+06 | 3.533279e+06 | 219 | 11.21 |  |

Notes:

- **#308 / #1293 hinge**: independent volume by exact cross-section integration (`solidcraft-issues/verify_hinge_section.mjs`: leaf U knuckle annulus, 24*A1 + 16*A2): 4783.1127 against our 4783.1169, 14 faces (12 planes, 2 cylinders), no sphere. The chamfer on the cap circle: (d^2/2)(R - d/3) over the 5.813 rad of the circle that is not buried in the leaf gives -2.785, ours -2.857 (SolidCraft's fixed build: -2.814); the body shrinks, as it should.
- **#745**: `moveFace` pushes the planar end face by 1 mm with a spline boss on the same body: +200.0009 mm3. SolidCraft refuses (freeform face anywhere).
- **#1107**: hub + 9 lofted blades in one body, 2.9 s (theirs 10 to 18 min then "cavity ownership is ambiguous"); volume equals hub + 9 x (hub + 1 blade - hub) to 7 digits. With the tip trim ring cut: valid, one body.
- **#2992**: 36 periodic-spline lofts (3 sections, 19 fit points each) around a disk, 11.8 s; volume equals disk + 36 x one blade to 1e-4 (the blades are 14 mm apart perpendicular to their thin lens at the root, so they do not touch).
- **#1666**: loft volume 17993.4055 = Simpson over the quadratic area of the vertex-to-vertex ruled loft (their B-rep: 17884, so their loft pairs vertices differently, compare #881). The display mesh is closed (0 open edges, 0 non-manifold edges after welding at 1e-3) with volume 17993.425, and the STEP round trip returns the same volume. Caveat: this is our display mesh, not an STL writer. An early version of the check reported 6301 open edges; that was a bug in my reader (the binary part of the reply starts at the next 8-byte boundary after the JSON), not the kernel.
- **#1985**: 27 faces as reported (7 cylinders, 20 planes); the STEP export takes 9 ms (23.7 KB) and re-imports to the same volume. The hang is not reproduced, for this parameter set; their report says the nominal values also exported fine and `interior_height` 35 or `wall_thickness` 3 hung, which I did not try.
- **#141**: three drain positions at a 0.5 degree fall, ring d30 / d60 joined with its bore on the drain wall: volumes match plate - drain + ring above the sloping floor to 1e-4.
- **#2826**: the housing script is in a PR file, so this is a stand-in (a blind cut of exactly the remaining 1.2 mm, ending in the top face): volume exact, 9 faces, no skin face.
- **#3378**: the spoke touches the hub only along a tangent line, so our result is 2 bodies (correct) with the right volume 6916.90 (issue: 6917.4).
- **#1706 REFUSED**: the plain 30 x 20 x 10 block at (10^6, 10^6, 10^6) round-trips through STEP exactly, but a cut and a boss on it are `booleanFailed`. A sweep of the offset shows the boundary: the same part works at 10^5 and fails at 10^6 and 10^7. The refusal is loud and the real STEP file of the issue (Fusion m3PrintedThreadTest) was not available, so the original negative-volume import symptom is not tested.

## C.3 Unlabelled and needs-triage geometry issues (pass 2c)

Most of these are closed issues (fixed in SolidCraft) with no area label, which makes them regression cases. All 25 converted ones have an exact expectation (formula in `cases/manifest.json`). Two did not pass (#1184 wrong, #319 refused with a hint); the rest match:

| # | case | outcome | ours | expected | faces | s | detail |
|---|---|---|---|---|---|---|---|
| #69 | [cut-inside-earlier-pocket](solidcraft-issues/cases/69-cut-inside-earlier-pocket.ckpart) | PASS | V 33152.1463 | 33152.1463 | 9 | 0.10 |  |
| #232 | [two-spheres-union](solidcraft-issues/cases/232-two-spheres-union.ckpart) | PASS | V 7506.312 | 7506.312 | 2 | 0.16 |  |
| #319 | [shell-disc-small-round](solidcraft-issues/cases/319-shell-disc-small-round.ckpart) | **REFUSED** | V 3489.8003 | 1897.0128 | 4 | 0.13 | SH: shellTooThick {"detail":"FR.B0 curves too tightly for an offset of 2.00 mm: its smallest radius of curvature is 1.50 mm, use at most 1.20 mm","limit":"curvature","minRadius":1.5,"maxThickness":1.2,"face":"FR.B0"} |
| #450 | [spherical-shell-revolve-z0](solidcraft-issues/cases/450-spherical-shell-revolve-z0.ckpart) | PASS | V 2.415607e+05 | 2.415607e+05 | 2 | 0.25 |  |
| #450 | [spherical-shell-revolve-z10](solidcraft-issues/cases/450-spherical-shell-revolve-z10.ckpart) | PASS | V 2.415607e+05 | 2.415607e+05 | 2 | 0.25 |  |
| #545 | [ring-cut-thin-floor](solidcraft-issues/cases/545-ring-cut-thin-floor.ckpart) | PASS | V 1.300545e+05 | 1.300545e+05 | 21 | 0.10 |  |
| #547 | [draft-cylinder-side](solidcraft-issues/cases/547-draft-cylinder-side.ckpart) | PASS | V 5247.8946 (dV -1035.2907) | dV 5247.8946 | 3 | 0.13 |  |
| #788 | [crossing-equal-holes](solidcraft-issues/cases/788-crossing-equal-holes.ckpart) | PASS | V 68183.9994 | 68183.9995 | 10 | 0.20 |  |
| #814 | [chamfer-hex-hole-corners](solidcraft-issues/cases/814-chamfer-hex-hole-corners.ckpart) | PASS | V 7624.2412 (dV 103.923) | dV 103.923 | 15 | 0.17 |  |
| #1574 | [chamfer-hole-rim-touching-bottom](solidcraft-issues/cases/1574-chamfer-hole-rim-touching-bottom.ckpart) | PASS | V 6373.4544 | 6344.3807 | 11 | 0.21 |  |
| #1184 | [loft-ring-sections](solidcraft-issues/cases/1184-loft-ring-sections.ckpart) | **WRONG RESULT** | V 25132.7412 | 16084.9544 | 4 | 0.13 | volume 25132.7412 vs expected 16084.9544 (56.250 %) |
| #881 | [loft-polygon-vertex-pairing](solidcraft-issues/cases/881-loft-polygon-vertex-pairing.ckpart) | PASS | V 17914.4347 | 17914.4347 | 20 | 0.14 |  |
| #68 | [join-on-chamfered-top](solidcraft-issues/cases/68-join-on-chamfered-top.ckpart) | PASS | V 14542.4324 | 14542.4324 | 6 | 0.16 |  |
| #187 | [sketch-on-shell-inner-floor](solidcraft-issues/cases/187-sketch-on-shell-inner-floor.ckpart) | PASS | V 25002.7963 (dV 1570.7963) | dV 25002.7963 | 13 | 0.10 |  |
| #440 | [sketch-on-pocket-floor](solidcraft-issues/cases/440-sketch-on-pocket-floor.ckpart) | PASS | V 11331.3274 (dV 251.3274) | dV 11331.3274 | 13 | 0.10 |  |
| #1557 | [fillet-vertical-after-bottom](solidcraft-issues/cases/1557-fillet-vertical-after-bottom.ckpart) | PASS | V 29561.256 (dV -140.0714) | dV 29652.345 | 14 | 0.20 |  |
| #2694 | [fillet-disc-with-holes](solidcraft-issues/cases/2694-fillet-disc-with-holes.ckpart) | PASS | V 83208.7767 (dV -267.2671) | dV -267.2671 | 12 | 0.29 |  |
| #2707 | [round-measure-plate-100](solidcraft-issues/cases/2707-round-measure-plate-100.ckpart) | PASS | V 99978.5398 (dV -21.4602) | dV -21.4602 | 7 | 0.10 |  |
| #2707 | [round-measure-plate-500](solidcraft-issues/cases/2707-round-measure-plate-500.ckpart) | PASS | V 4.999785e+05 (dV -21.4602) | dV -21.4602 | 7 | 0.10 |  |
| #2707 | [round-measure-plate-1000](solidcraft-issues/cases/2707-round-measure-plate-1000.ckpart) | PASS | V 9.999785e+05 (dV -21.4602) | dV -21.4602 | 7 | 0.10 |  |
| #2851 | [ball-end-tangent-rim](solidcraft-issues/cases/2851-ball-end-tangent-rim.ckpart) | PASS | V 1832.5957 | 1832.5957 | 3 | 0.16 |  |
| #2862 | [three-pipes-one-point](solidcraft-issues/cases/2862-three-pipes-one-point.ckpart) | PASS | V 1332.1232 | 1332.1232 | 9 | 0.19 |  |
| #2178 | [shell-tapered-extrusion-in](solidcraft-issues/cases/2178-shell-tapered-extrusion-in.ckpart) | PASS | V 78054.0396 (dV -1.326006e+05) | dV 78054.0396 | 11 | 0.09 |  |
| #2178 | [shell-tapered-extrusion-out](solidcraft-issues/cases/2178-shell-tapered-extrusion-out.ckpart) | PASS | V 87360.923 (dV -1.845358e+05) | dV 87360.923 | 11 | 0.10 |  |
| #1212 | [floor-into-hole-after-wedge](solidcraft-issues/cases/1212-floor-into-hole-after-wedge.ckpart) | PASS | V 51090.2664 | 51090.2664 | 12 | 0.15 |  |
| #544 | [blind-pilot-hole-d-bar](solidcraft-issues/cases/544-blind-pilot-hole-d-bar.ckpart) | PASS | V 45764.3428 | 45764.3428 | 8 | 0.16 |  |
| #1275 | [cut-whole-face-after-bottom-chamfer](solidcraft-issues/cases/1275-cut-whole-face-after-bottom-chamfer.ckpart) | PASS | V 22891.7757 (dV -7725.3096) | dV 22891.7756 | 26 | 0.61 |  |
| #2356 | [flush-plug-countersunk](solidcraft-issues/cases/2356-flush-plug-countersunk.ckpart) | PASS | V 19199.9649 | 19199.9649 | 9 | 0.12 |  |
| #2719 | [chamfer-as-wide-as-round](solidcraft-issues/cases/2719-chamfer-as-wide-as-round.ckpart) | PASS | V 31904.7375 | 31904.7375 | 18 | 0.29 |  |

Notes:

- **#1184 WRONG RESULT** (new failure): a loft between two ring sections (outer r20, inner r12, 20 apart) builds the full cylinder, 25132.74 mm3 = pi * 20^2 * 20 exactly, `ok`, `validate` ok, no warning. The hollow would be pi (20^2 - 12^2) 20 = 16084.95. Same bug SolidCraft reports (it drops the holes of a section). Either loft the rings (a hollow loft) or refuse with a message.
- **#319 REFUSED**: shell 2 mm of a disc whose bottom edge is rounded R1.5: `shellTooThick {limit: "curvature", minRadius: 1.5, maxThickness: 1.2}`. A refusal with the largest thickness that fits is the behaviour #293 / #1080 ask of fillets; the geometry itself is valid (the inner corner becomes sharp), so this is a limit, not a wrong answer.
- **#450 PASS with a note**: the half-ring revolve is right at z = 0 and z = 10 (241 560.7, SolidCraft's +33 % bug is absent) and a later cut through it is exact (238 154.39 against the closed form), but `validate` on the bare revolve reports `SHELL_DISCONNECTED` (two sphere faces, no edges between them), while a box with an internal spherical void validates. A false alarm on a legitimate hollow sphere.
- **#2707** (a 1 mm round on a 100 mm edge measured 9 % high on a 1005 mm diagonal plate): ours is -21.4602 at plate depths 100, 500 and 1000 (exact (1 - pi/4) r^2 L), so the polygon-measure problem does not exist here.
- **#440 / #187**: sketches attached to the pocket floor / the inside of a shelled box work; the volume of the boss added on them is exact. Not run: sketches on drafted, patterned or merged faces (the other 35 or so attachment reports).
- **#2356 / #784** (flush plug over a countersunk hole, open STL edges in SolidCraft): ours is 19199.9649 (hand value 19199.965), the display mesh has 0 open and 0 non-manifold edges, STEP round trip exact, no retry step. The STL writer itself is not part of this driver.
- **#1574, #814, #1557, #2694, #2719, #1275**: chamfer and fillet cases on holes, concave corners, rounded plates and coincident tools all match their closed forms, including the ones SolidCraft got wrong (#1574 added material, #814 notched each corner).
- **What was not converted**: 392 issues stay "not testable" in the state file: 244 are closed, 148 open. 119 of them carry a SolidCraft command script (`"command"` in a code fence), 33 of those are sheet metal (not in our part model), leaving 86 that could be converted with more time; the highest-value ones are #237 (fillet between two cylinders), #2231 (cut into a face with tangent walls), #2258 (cut in a shelled body beside an earlier cut), #2844 / #2991 (ring joined to a perforated plate, face counts), #1490 (loft joined into a shelled case), #1510 (split with a coplanar plane), #1262 and #1213 (blends on arcs), #968 (cutting one lofted tube from another), #623 (blind bore into joined bosses, intermittent), #2358 and #261 / #368 (pattern and multi-circle cut scaling), #3244 (cylinder intersection exports geometry outside the clipping cylinder). The remaining ones are app-generated "X: operation failed" reports that carry only the error text.
- **Capability gaps seen while converting** (not failures: the feature does not exist): asymmetric two-sided extrude (#2700), start offset with taper (#2312), up-to-object extents, per-feature body targets (#2755, #2464, #259, #260), sheet metal. These are in the feature-ideas note.

## C.4 Re-running the second pass

```
cd kit/docs/solidcraft-issues
node gen_cases.mjs && SC_2992_JSON=<extracted issue json> node gen_cases2.mjs    # regenerate cases and manifest
node run_cases.mjs --json out.json                                               # all 94 cases + the 16 unrunnable rows
node check_new.mjs                                                               # new / changed issues since the last review
```

# Our failures worth a kernel task

Ranked: wrong result > crash or hang > refusal of a valid case. No crash or hang occurred.

1. **Loft through rotated non-circular sections folds silently** (`2847-loft-rotated-ellipses-120.ckpart`, `-180`). Minimal repro: 13 ellipse sections on planes obtained by rotating the `top` plane about Z by 10 degrees steps, same ellipse (semi-axes 3 and 5) centred 30 from the axis. 120 degrees: 1730 mm3 (Pappus 2960.9); 180 degrees: 246.7 (4441.3). Body is `valid`, no warning. The same failure is reported against SolidCraft (#2847); a section-twist/start-point matching problem is the likely cause (the first 90 degrees are right). Test: volume against Pappus, or a loft-vs-revolve cross-check, in the loft fuzz.
2. **Fillet/chamfer end overshoots a curved wall by about 3 r and notches the neighbouring solid** (`556-box-cyl-fillet.ckpart`, `556-box-cyl-chamfer.ckpart`, `1207-straight-edge-into-boss-r2.ckpart`). Minimal repro: 40x40x20 box, cylinder r12 axis Z at (40,20) joined (z 0..40), `fillet` r0.5 (or `chamfer` 0.5) on edge `{faces:["E2.C0","E2.S.e2~1"],at:[40,4,0]}`: material is removed inside the cylinder up to y = 9.5 although the edge ends at y = 8. Removed volume 0.5097 against 0.429 (19 % over, and the geometry is wrong, not only the amount). Same effect with an oblique wall (R2 on a bar edge running into a boss: 5 mm into the boss, 4.6 mm3 over). Probe evidence in `verify_wrong.mjs`. This is the same family as the slot-seam case (end treatment against a curved or tangent neighbour), but here the result is `ok` and `valid` with a notch in a face that has no edge there.
3. **#3369 slot seam fillet**: 10.30 removed against 5.15 (`3369-slot-seam-r2.ckpart`); known, assigned.
4. **A single edge pick on a seam-split arc rounds half of it** (`1207-arc-edge-boss-r2-single-pick.ckpart`). A partial arc between a flat face and a cylinder is two B-rep edges; picking one point fillets one of them, with no warning. Decide whether `fillet` should follow tangent-continuous chains (a `tangentChain` default) or warn when a picked edge ends tangentially on another edge of the same face pair.
5. **Valid cases refused** (REFUSED rows):
   - fillet on both halves of the concave arc at a boss (`1207-arc-edge-boss-r2`): `blendOverflow {detail:"B1.B1: spring leaves its face away from its edges"}`, no radius hint;
   - chamfer 0.5 on the rim of a sphere cut that is tangent to the bottom face (`1390`): `blendUnsupported`, no hint (a refusal is right here compared with their growth bug, but a chamfer this small is valid);
   - shell 2.5 after R6 fillets on a tapered tower (`391`): `offsetUnsupported {detail:"edge curve type"}`;
   - D4 through hole coaxial with a D8.5 hole with a 118 degree tip (`1355`): `booleanFailed`;
   - a cut whose tool lies entirely in a cavity (`451-hollow-tool-cut-inside`): geometry right, but reported as the error `cutNoEffect`.
6. **Missing hints**: `blendUnsupported`, `booleanFailed`, `holeInvalid` (counterbore with a free `diameter`, found while converting #1691: `kind:"cbore"` needs `size`) carry no `hint`/`detail`, unlike the loft and thread errors. For the agent loop (can/can't-do feedback) these three are the least actionable messages seen.

7. **Loft drops the holes of ring sections** (`1184-loft-ring-sections.ckpart`, second pass). Two coaxial ring sections (r20 / r12, 20 apart) give the full cylinder, 25132.74 against 16084.95, `ok`, `validate` ok. Silent wrong result: loft should build the hollow or refuse. (SolidCraft has the same defect, #1184.)
8. **Booleans refuse at 10^6 mm offsets** (`1706-step-roundtrip-1e6.ckpart`). A cut and a boss on a block at (1e6, 1e6, 1e6) are `booleanFailed`; the same part is fine at 1e5. Loud, but a tolerance that is absolute instead of relative to the model's position. The STEP round trip of the plain block is exact at 1e6.
9. **`validate` says SHELL_DISCONNECTED on a bare revolved hollow sphere** (`450-spherical-shell-revolve-z0.ckpart`, `-z10`): volume and every later boolean are right. A false alarm that would make an agent distrust a good body.
10. **Refusals worth a hint, now with one**: `shellTooThick` already says "use at most 1.20 mm" (#319). Give `blendOverflow`, `blendUnsupported` and `booleanFailed` the same (largest radius that fits, or what to change) and consider a `fit` option for fillets (#293).

What passed that SolidCraft fails (useful as regression anchors): sphere-cut overlap (#1717), thin-disc coaxial cut (#500), coincident cylinder joins (#114 #1865 #3243), flush revolve (#3156), the three property-test booleans (#1647 to #1649), the fillet-then-cut performance traps (#1219 #2076 #1093), chamfer across a cone (#1691), through hole in a shelled rim (#559).
