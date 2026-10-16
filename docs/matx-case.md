# The mATX tower case as a script

Source: the user's private FreeCAD Part-workbench script (parameters block, `add(shape, label, rgb)`, `rrect_face`, `hoop`, boxes, corner blocks, panels, tray, slats, combs, hex fields, rivets) and its saved result (51 cached shapes, used as ground truth). Our version is **re-expressed, not copied**: `packages/script/src/matx.ts` (`matxScript(only?)`), Script-tab examples `matx-frame` (hoops + blocks + strips, quick) and `matx-case` (everything, ~3.5 minutes to regenerate: 600+ features, one regeneration per step). Check: `packages/script/src/matx.kernel.test.ts` (per component volume against the cached shapes; `MATX_ONLY=hoops,tray` selects, `MATX_ALL=1` runs the whole case).

Frame: the design uses X depth, Y width, Z height; the app has Y up and the front plane = XY. The script keeps the design's frame and maps it in two helpers: `bx` (box by min corner and sizes: a rectangle sketch on the front plane offset to x, extruded along it) and `cylZ`/`cylY`/`cylX`. Top plane sketches use (u, v) = (design Y, minus design X); right plane (u, v) = (minus design X, design Z). A cut runs against the sketch normal unless `flip`, so every script cut passes `flip:true`.

## API added (smallest set, tested in `script.kernel.test.ts`)

| Addition | Use |
| --- | --- |
| `at(plane, offset)` as a sketch plane | workplane offset: adds a `plane` offset feature, sketches on it |
| `s.arc3(a, mid, b)` | arc by three points (either direction; the circle is computed) |
| `s.rrect(w, h, r, [cx, cy])` | rounded rectangle, four lines + four arcs sharing end points |
| `MAX_STEPS` 500 -> 2000, `MAX_SOURCE` 20000 -> 40000 | the whole case is 678 features and ~19 KB; honeycomb fields are ONE sketch with hundreds of polygons |

## Components, operations, how they are built

| Component (count) | FreeCAD / OCCT operations | Our build |
| --- | --- | --- |
| HOOP rear/front (2) | `rrect_face` (3-point arcs), outer.cut(inner), extrude | one sketch with two `rrect` loops, extrude 20 on `at('front', x)` |
| STRIP (4), PSU/BOARD refs, SLATS (8), combs bar | `makeBox` | `bx` |
| BLOCK (8) | rounded band, common with 3 boxes, fuse foot pad / shelf / anchor, fillet, cut groove ring, cut tunnel, rivet hole cylinder | the common is a closed profile (quarter band + two arms: lines + two `arc3`) extruded; pad/shelf/anchor boxes; groove = same profile family cut; tunnel box; cylinder holes. **Fillets missing** (+1.3% volume) |
| PANEL rear/front | `rrect_face` extrude, cut blocks/strips/base slot, cut openings, honeycomb, fuse combs | extrude, cut the block profile (the cutter is the same function as the block body), boxes, circles; hex field = one polygon sketch; combs = box + one sketch of eight pockets |
| PANEL top | band.common(box), pegs, honeycomb | profile (two arcs per side) extrude, peg cylinders, hex field |
| BASE plate | box, honeycomb with keep-out pads, peg holes | box, one hex sketch (cells computed in the script), cylinders |
| TRAY (4 tiles) | boxes fused, bosses (cylinders), holes, honeycomb with seams kept solid, `common` into 4 tiles, keyhole cuts | same boxes/cylinders/hex field; the tiles are the same solid because the seams have no thickness, keyholes cut. Snap lips overlap the ledge slightly (the design's lip only touches it along an edge, a boolean failure here) |
| STRAPS (10) | boxes fused | boxes |
| RIVETS (8) | cylinders, cone barb, slot cut | head + shank cylinders, slot box. **No cone** (no positioned revolve) |
| FAN ref | box minus cylinder | box, cut |

## Volumes (kernel from `matx.kernel.test.ts`, FreeCAD = OCCT `GProp` on the cached BRep of the saved file)

| Component | FreeCAD mm3 | Ours mm3 | Rel. error | Notes |
| --- | --- | --- | --- | --- |
| HOOP x2 | 71464.8 | 71464.8 | 0 | exact |
| STRIP x4 | 40960.0 | 40919.0 | -0.10% | 0.02 mm shorter: a face laid on the tunnel wall breaks the boolean |
| PANEL_rear | 92371.7 | 92357.6 | -0.015% | |
| PANEL_front | 85779.0 | 85764.9 | -0.016% | 400+ honeycomb cells in one cut |
| PANEL_top | 117103.0 | 117103.0 | 0 | exact |
| BASE_plate | 76548.7 | 76548.7 | 0 | exact (honeycomb cell for cell) |
| BLOCK x8 | 207042.8 | 209709.2 (alone, with its own peg-hole drill) | +1.29% | no edge fillets (can't select the outside edges by a rule) |
| PSU + BOARD + FAN refs | 2026180.9 | 2026180.9 | 0 | exact |
| RIVET x8 | 3004.5 | 3461.8 | +15% | no barb cone; the top rivets' shank is 2 mm longer (a boolean fails on some lengths in that hole) |
| SLAT x8 | 400896.0 | 400896.0 | 0 | exact |
| TRAY x4 tiles | 360408.5 | 361232.2 | +0.23% | the snap lips (see above) |
| STRAP x10 | 7040.0 | 7040.0 | 0 | exact |

Whole case as ONE part (`matx-case` sample): see the result at the end of this file. The lumps stay separate bodies of the part (multi-lump bodies work); order matters because a script cut cuts every lump in its range: panels and tray first (with their notches, cut by the blocks' own profile), then base (the front panel's plate-slot cutter would remove it), blocks (their grooves must not exist yet around the hoops), strips, top, hoops, refs, slats. Top rivets are left out of the default build.

## Findings and gaps (ranked)

1. **Cuts are body-wide; still OPEN: no target-body option exists on the kernel extrude/revolve cut feature (no `target`/`bodies` field; only the interference check names lumps), so `cut(..., {target})` needs a kernel change first** (high value, medium effort): every cut hits every lump in range, forcing the ordering above and the extra care for cutters (the fan cutter's 1 mm overshoot would nick the front panel). A cut with a target ("from body k" / lump pick) or a script-level `body('name')` with an assembly is the real fix. Alternative: an assembly sample of the 51 components (each its own part): not done, needs one script part per component.
2. **Boolean robustness** (kernel, unknown effort): fuse/cut failed (`booleanFailed`) with faces laid exactly on another (strip on tunnel wall, rivet head on the panel, snap lip on its ledge edge) and, unexplained, a thin slot cut through a free-hanging cylinder end and a shank-length-dependent fuse near hole walls. Workarounds are in the script comments.
3. **CLOSED: edge-rule selectors for fillets** (API, small; `edges({parallel, outside, not, onFace, lengthGreater, near, union, ...})`): "all outside edges except those near box X" (block fillets, +1.3% volume).
4. **CLOSED: positioned revolve / cone** (API, small; `revolve(angle, { axis: {from, to} })`): revolve about an axis at an offset (rivet barb cone, rivet head+shank in one go).
5. **Speed** (kernel/app, medium): 678 features regenerate one step at a time (3.5 min); a batch edit (all ops, one regeneration) in `runScript` would cut that to seconds.
6. **CLOSED** (`holes.polar/grid/points`, `s.points/polarPoints/grid`): 2D array of holes in one sketch is scripted by hand (JS loops); a `s.grid()` / `s.polarArray()` helper is cheap (small) but not needed to reproduce this case.
7. Colours per body (the design colours aluminium, black, steel, wood): not part of the part model.

## Not done

No assembly version, no screenshot, no exact block fillets, no barb cones. Original FreeCAD parameter names are kept as `variables()` (WIDTH, HEIGHT, DEPTH, FAN, TOP_T, ...); sketch values use their current numbers (an `expr` contributes only its number inside a sketch), so edit the variables and re-run the script.

## Whole case result

`matx-case` (sample and example): 612 features, one part with 129 separate lumps' worth of components, volume 3,488,435.4 mm3 against 3,488,799.7 for the sum of the 51 FreeCAD shapes (-0.010%; was +0.005% with 618 features before the peg holes were drilled once instead of twice, see docs/matx-corner-bug.md: the missing rivets, 3,000 mm3, are offset by the missing block fillets, 2,700 mm3 too much material). Bounding box matches the original apart from the missing rivets. Regeneration of the 612 features takes about 200 s on the kernel test host (the sample file is stored with its features; opening it does not regenerate every step by script, only the normal document regeneration).

## Corner artefacts (user report) and the fix

Mesh check of the whole case (`MATX_ALL`, part of `matx.kernel.test.ts`): the kernel said valid, but the display mesh had 270 open edges and 10 faces without triangles, all at the peg holes (rear base feet, the four top shelves). Cause: a kernel boolean defect when a cut's cylinder coincides with an existing hole wall (docs/matx-corner-bug.md). The script now drills each peg hole once (base and blocks, blocks and top): open edges 0, faces without triangles 0, `validate` ok. The flat ends of the block arms next to the hoop (the "step" and the quarter-round cross-section) are the missing r=2 fillets of the design, not a boolean artefact: the kernel cannot fillet that edge chain (same document).
