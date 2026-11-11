# Sketcher UI gap review: SolidCraft vs. this app

Read-only study. Nothing was built or run. Paths are relative: `<cadkit>/ext/solidcraft` is the SolidCraft clone at commit 58c64ca4 (MIT OR Apache-2.0,
version 0.29.0), the rest is this repo. Context: `docs/research-solidcraft.md`. Anything I did not confirm is marked **(unverified)**.
Their source was read for behaviour only; none of it is copied here.

## 0. Version reviewed

SolidCraft **commit 58c64ca4** (2026-11-01, version 0.29.0), re-read after the clone was updated; an earlier read of an older tree (0.16.2) was discarded.
In this version the Sketch tab matches the owner's description. Verified in `crates/ui-egui/src/workspace.rs` (`SECTIONS`, tab "SKETCH"): groups **CREATE, MODIFY, PATTERN,
CONSTRAIN, REFERENCE, INSPECT, CONFIGURE, FINISH SKETCH** (the last holds Finish and Cancel; `docs/ribbon-layout.md` calls it the Exit group). Layout doc: `docs/ribbon-layout.md`;
panel review: `docs/sketch-tool-panel-review.md`. Notes:

* Promoted (visible) buttons are set by `promoted` per section (Create 5, Modify 3, Pattern 3, Constrain 7, Reference 1, Inspect 1, Configure 2, Finish 2); every command stays in the section dropdown and saved user pins add buttons.
* The "Sketch Report" is the ribbon label of `sketch.inspect` (`workspace.rs`), opening a window (`crates/ui-egui/src/sketch_report.rs`).
* Configure = `parameters.change`, `config.table`, `config.configure` (`CONFIGURE` const in `workspace.rs`).
* I did not find the exact tooltip string "Pinned commands show on the ribbon: hover a row to pin or unpin it" (grep of `crates/`); the behaviour exists (`toolbar.rs` `dropdown_row`, pin icon, `toolbar_custom.rs`).
* Keys from `CommandSpec.key` in `crates/engine/src/cmd/sketch*.rs`: L, R, C, D, X, O, T, G (Transform), P (Project). Other commands have no default key. Keys are user-rebindable (`keymap.rs`).

## 1. Inventory

Legend: yes / partly / no. "Ours" paths are under `apps/cad/src` unless prefixed.

### 1a. Ribbon, panels, chrome

| SolidCraft element (where) | Ours? | Where in ours | How ours differs |
|---|---|---|---|
| Contextual SKETCH tab: Create / Modify / Pattern / Constrain / Reference / Inspect / Configure / Finish (`workspace.rs` `SECTIONS`) | partly | `SketchToolStrip.tsx` `sketchRibbonGroups`, `packages/ui/src/Ribbon.tsx` (`onlyTab`) | Ours: SketchSelect, Finish, Make, Draw, Dimension, Constrain, Modify, Reference, Status. No Pattern, Inspect or Configure group (patterns sit in Modify; Parameters is on the Home tab). |
| Per-group dropdown listing every command with key (`toolbar.rs` section menus) | partly | `packages/ui/src/Slot.tsx` (flyout from a corner arrow, long press, right click, flick) | Our flyout lists only the slot's variants (`PALETTE_SLOTS`), not "all commands of the group"; shows keys via `SlotItem.keys`. |
| Pinned commands on the ribbon, hover a row to pin/unpin (`toolbar_custom.rs`, `toolbar.rs` `sketch_menu_rows`/`dropdown_row`) | no | we have last-used memory instead (`slotMemory`, key `kit.slotLast`) | Ours auto-promotes the last-used variant; theirs is explicit user pinning, plus drag to reorder, Customize Toolbar window, Reset. |
| Promoted-count defaults (`workspace.rs` `Section.promoted`) | partly | `PALETTE_SLOTS` in `SketchToolStrip.tsx` | Ours is a fixed table of slots. |
| Responsive panel fit: labels wrap/truncate, panels collapse to one button, then `»` (`toolbar.rs` `fit`) | partly | `Ribbon.tsx` (compact mode), `layoutMode.ts` | Ours switches layout by device class, not per-panel width fitting. |
| Right "Feature Options" panel while sketching (`sketch_palette.rs`, width 236) | no (partly in pieces) | `SketchBar.tsx` `SketchStatus` (DOF chip, snaps popover, Display popover) | Ours spreads these over the Status group and popovers; no right-docked sketch panel. `FeatureOptions.tsx` is for solid features (extrude, fillet...), not sketch tools. |
| Tool-variant icon buttons (circle by centre/2-pt/3-pt; `sketch_families.rs` FAMILIES: Line, Rectangle, Circle, Arc, Slot, Polygon, Spline) | partly | `PALETTE_SLOTS` draw group: `['circle','ellipse']`, `['rectangle','center-rectangle','slot','polygon']` | Ours has one `circle` tool (centre + radius) and `arc-three-point/centre/tangent`; no 2-point, 3-point or 2/3-tangent circle, no 3-point/rounded rectangle, no inscribed/circumscribed/edge polygon choice, no 3-point arc slot or overall-length slot variants. Variants are in a flyout, not a persistent panel; mode switch mid-draw (restart tool) is theirs only. |
| Constrain group: large Dimension button + 3x2 icon-only gallery (H/V, Coincident, Tangent; Equal, Parallel, Perpendicular) (`docs/ribbon-layout.md`, `ui_kit/gallery.rs`) | partly | `SketchToolStrip.tsx` Constrain slots | Ours: ordinary slot buttons (one per slot, last-used variant); no compact gallery. |
| Line Type Normal / Construction / Centerline buttons (`sketch_palette.rs` `set_linetype`, mode 0/1/2) | partly | `SketchBar.tsx` `SketchConstruction` (draw-as-construction toggle + toggle selected), `tools/construction.ts`, `tools/centerline.ts` | Same idea; ours has centerline as a draw tool, not a line type. X key exists in both. |
| Display checkboxes: Grid, Snap, Slice, Profile, Points, Dimensions, Constraints, Projected, Construction, 3D Sketch (`TOGGLES`) | partly | `sketchPrefs.ts` (`snapOn`, `gridSnap`, `show.{dimensions,relations,reference,colours,panel}`), Display popover, status-bar Snap/Grid | Ours lacks Profile, Points, Projected, Construction visibility toggles and Slice. |
| Look At | yes | `main.tsx` `lookNormal`, key `N`, `look-normal` button in `SketchBar.tsx` | Equivalent (animated: unverified for ours; theirs has `look_at_anim` preference). |
| Slice (section the model at the sketch plane while sketching) | no | n/a | Mechanism in clone: `slice` option via `sketch.options` (`sketch_palette.rs`); render side not read **(unverified)**. Ours fades the body (`meshFade`) instead. |
| Finish Sketch / Cancel (`sketch.finish`, `sketch.cancel`) | yes | `SketchBar.tsx` `SketchFinish` (check and cross buttons) | Equivalent. Theirs also has "Finish with AutoConstrain" (`sketch.finish_auto_constrain`). |
| DOF status line (`dof_text`, "Constraints conflict") | yes (ahead) | `SketchBar.tsx` `dof-chip`, `define.ts`, `docs/sketch-tools.md` | Ours also colours geometry by definition and lists conflicts. |
| Command search box at top right (`ui_kit/search.rs`: expanding ribbon editor + results sheet; `toolbar.rs` `CommandSearch`) | partly | `packages/ui/src/CommandPalette.tsx` (key `F`, centred popup, `pinned` row, includes sketch tools) | Ours is a modal popup, substring match. Theirs: always-visible field in the ribbon row, ranked results, valid/invalid badges; plus the S box at the cursor (`shortcut_box.rs`) with recents and favourites. |
| View-nav gizmo (axis ball) | yes | `packages/viewport/src` viewcube (`viewcubeGeom.ts`) | Not compared in detail. |
| Bottom view toolbar | partly | status bar (`packages/ui/src/StatusBar.tsx`, `sketchReadout.tsx`) and Views group on the View tab | Not compared in detail **(unverified)**. |
| Origin square | partly | grid ring marks the origin (`docs/sketch-tools.md`, Grid) | Ours: ring plus red/green axes. Theirs: square drawn via `selection.rs` `origin_quads` **(unverified visually)**. |

### 1b. Create group

| SolidCraft command (id) | Ours? | Where in ours | Difference |
|---|---|---|---|
| Line `L`, Midpoint Line | yes / no | `tools/line.ts` (`l`) | No midpoint-line variant. Ours has typed length/angle, X/Y entry, relative angle. |
| Rectangle `R`: 2-pt, 3-pt, centre, rounded | partly | `tools/rectangle.ts` (`r`), `center-rectangle.ts` | No 3-point or rounded rectangle (rounded can be done with fillet). |
| Circle `C`: centre, 2-pt, 3-pt, 2-tangent, 3-tangent | partly | `tools/circle.ts` (`c`) | Centre only. |
| Arc: 3-pt, centre-point, tangent | yes | `threePointArc.ts` (`a`), `centreArc.ts`, `tangentArc.ts` | Equivalent. |
| Slot: 5 variants | partly | `tools/slot.ts`, `tools/arcSlot.ts` | Two slot tools: straight (centre to centre) and arc slot (centre point style: centre, start on the centre arc, end angle, width), grouped in one palette slot. No 3-point arc slot, no overall-length or end-point slot variants. |
| Polygon: inscribed/circumscribed/edge | partly | `tools/polygon.ts` | One tool; variants not verified **(unverified)**. |
| Ellipse, fit/control spline (deg 3 and 5), conic | partly | `ellipse.ts`, `spline.ts`, `cvspline.ts` | No conic, no degree-5 spline choice. Ours adds equation curve. |
| Point, Text, Centerline | yes | `point.ts`, `text.ts` (`q`), `centerline.ts` | Equivalent. |
| X-Line / Construction Line (`sketch.construction_line`, 9 variants: horizontal, vertical, angle, bisector, parallel, perpendicular, tangent at/external/two; icons `construction_line_*.svg`) and Infinite Line | no | n/a | Reference lines of this kind are missing. Promoted in their Create group. |
| Equation Curve (`sketch.equation_curve`) | yes | `tools/equation.ts`, `EquationPanel.tsx` | Equivalent. |
| Sketch Dimension `D` | yes | `tools/dimension.ts` (`d`), `dimGraphics.ts`, `dimLayout.ts` | Ours: smart dimension, reference dimensions, double-click edit. |
| Normal/Construction `X` | yes | `tools/construction.ts` (`x`) | Equivalent. |
| Sketch Constrainer (`sketch.constrainer`, in CONSTRAIN group; applies the constraint the picked geometry nearly has) | no | closest: `define.ts` `fullyDefine` (whole sketch only) | Theirs works on 1-2 picked entities; ours is all-or-nothing. |
| Project, Intersect, Include 3D, Project to Surface, Intersection Curve, Spun Profile, Isoparametric, Fit curves to section | partly | `tools/project.ts` (`p`) | Ours: snapshot projection of body edges only, not associative (`docs/sketch-tools.md`, "What is not here"). |

### 1c. Modify and Pattern groups

| SolidCraft command | Ours? | Where in ours | Difference |
|---|---|---|---|
| Trim `T` (+ Trim Along Path `sketch.trim.path`: no) | yes | `tools/trim.ts` (`t`) | Equivalent; theirs shows the hover piece to be removed (`sketch_tools.rs` Trim piece), ours similar **(unverified)**. |
| Extend | yes | `tools/extend.ts` (`e`) | Equivalent. |
| Break (`sketch.break`, split at a point) | no | n/a | Trim splits when cutting inside an entity (`trim.ts`), but no stand-alone Break tool. |
| Offset `O` (+ Break Offset Association) | yes | `tools/offset.ts` (`o`), `offsetRef.*` | Ours also offsets body edges and splines. Break-association: no. |
| Fillet | yes | `tools/fillet.ts` | Equivalent. |
| Chamfer: equal / distance+angle / two distances | partly | `tools/chamfer.ts` (equal distance only) | Two more chamfer modes missing. |
| Blend Curve (G1..G4) | partly | `tools/bridge.ts` ("Bridge curve", G1 and G2 via keys `1`/`2`) | Ours covers G1/G2; theirs up to G4. |
| Transform `G` (`sketch.transform`) / Move/Copy / Scale | partly | `tools/transform.ts`: move, copy (n copies), rotate, scale as four tools | Same capabilities spread over four tools; theirs is one `G` command with a panel. No `G` key. |
| Copy / Cut / Paste Sketch Entities (clipboard; `sketch_clipboard.rs`, `edit_clipboard.rs`) | no | Ctrl+C is not wired in sketch mode (`main.tsx` has Ctrl+A and Ctrl+Z in sketch only) | Ours copies by displacement (`copy` tool) but has no clipboard across sketches. |
| Mirror | yes | `tools/mirror.ts` | Equivalent. |
| Circular / Rectangular pattern | yes | `tools/pattern.ts` (`pattern-linear`, `pattern-circular`) | Ours drives spacing/angle with visible dimensions. |

### 1d. Constrain group

| SolidCraft command | Ours? | Where in ours | Difference |
|---|---|---|---|
| Horizontal/Vertical (one button) | yes, two tools | `horizontalTool` (`h`), `verticalTool` (`v`) | Ours splits them (grouped in one slot). |
| Coincident, Tangent, Equal, Parallel, Perpendicular, Fix/UnFix, MidPoint, Concentric, Collinear, Symmetry | yes | `packages/sketch/src/tools/constraint-tools.ts`, `constraints.ts`, `CONSTRAINTS.md` | Equivalent set. Unfix: **(unverified)** that ours toggles off from the same tool. |
| Curvature (G2 between curves), Polygon (regular-polygon constraint) | no | n/a (bridge writes g1/g2 itself) | Kernel has `g1`/`g2` constraints (`bridge.ts` header). No stand-alone tool. **(kernel side for a polygon constraint: unverified)**. |
| AutoConstrain (tolerances, then dimension to fully constrained) | partly | `define.ts` `fullyDefine`, aux-bar "Fully define" button | Ours: relations as drawn (1 deg tolerance), then dimensions until DOF 0. Theirs has explicit tolerance parameters and a "from datum" variant (positions measured from a chosen datum). |
| AutoConstrain from datum | no | n/a | See above. |
| Constraint glyphs at entities (`sketch_tools.rs` `glyphs`, `markers.rs`; avoid dimension text; hover-aware) | yes | relation glyphs (H, V, =, tangent) in `SketchAnnotations.tsx`, Display > relations | Glyph set and styling not compared **(unverified)**; ours has no hover-to-highlight chip for each constraint but the list highlights on hover. |

### 1e. Inspect, Configure, Insert

| SolidCraft | Ours? | Where in ours | Difference |
|---|---|---|---|
| Sketch Report (`sketch_report.rs`: solver status, DOF left, counts of curves/points/constraints, list of not-fully-constrained items, Copy JSON; follows edits while open) | partly | DOF chip + conflict list (`SketchBar.tsx`) | No report window. Also theirs: Loose Ends / Tie Loose Ends (`sketch.loose_ends*`). |
| Parameters (Configure group on the sketch tab) | yes | `open-variables` (`toolbarModel.ts` slot `catalog`), `docs/equations.md`, `packages/ui/src/ExprInput.tsx` | Equivalent in function. |
| Config Table (rows of parameter values and suppressions; `config.*` in `crates/engine/src/cmd/config.rs`) | no | `docs/gui-parity.md`: "Configurations: neither" | Large. |
| Insert DXF / SVG, Canvas, Decal (they sit in the REFERENCE group) | partly | `sketch-import-dxf` command (`dxfSketch.ts`) | No SVG import, no canvas/decal reference images. |
| Sketch on face / plane attach | yes | `sketchOnFace`, `sketchHere`, `new-sketch` slot | Not compared. |

### 1f. On-canvas visuals

| SolidCraft | Ours? | Where in ours | Difference |
|---|---|---|---|
| Live cursor coordinates (`tools.rs` ~1182 draws `x, y` via `tool_cursor::readout_at` next to the pointer) | yes (different place) | `sketchReadout.tsx` `st-coords` in the status bar, e.g. `232.1 mm, -5.1 mm`; `sketchStatus.ts`; precision rises with zoom | Ours is in the bottom status bar, not next to the cursor. Moving it to a cursor-following label is small. |
| Typed value boxes while drawing (`sketch_dims.rs`) | yes | `SketchFields.tsx`, `onViewValues` pref, Tab-to-lock | Equivalent. |
| Dimension drawing: extension lines, arrows, value, driven in brackets (`dim_view.rs`, `sketch_dims.rs`) | yes | `annotations.ts`, `dimGraphics.ts`, `dimLayout.ts` (collision-avoiding placement), `SketchAnnotations.tsx` | Ours: driving dimensions in the error colour token, reference in muted brackets; **plain text labels**, not value chips. Theirs: value drawn on a filled rounded backing (`dim_view.rs` ~808); colour tokens in `theme.rs`. Pale-violet look: not verified. |
| Angle chip, diameter chip (`Ø80.00 mm`, `90.0 deg`) | partly | `dimGraphics.ts` labels `Ø8 mm`, `110°`; right-angle square option | Same content; no chip background or pill. |
| Filled translucent region for closed profiles | not found | `handleLayer.ts` uses ShapeGeometry only for handles; sketch rendering in `packages/viewport/src/viewport.ts` **(unverified: I did not find a profile fill)**. Region *picking* exists (`regionPick`). Theirs: `viewport.rs` profile fill (`profile_region`, `tk.profile_fill`). | Likely a gap. Needs a quick look at the viewport before scoping. |
| Snap markers with label | yes (ahead) | `packages/viewport/src/snapMarks.ts`, 8 snap kinds, model snaps | Ours has more snap kinds documented. |
| Keyboard shortcuts | partly | `registry.ts` keys: l r c a q d h v t e o x p; no rebinding UI (docs/gui-parity.md) | Theirs: user-rebindable (`keymap.rs`, Preferences), keys come from the command spec, conflicts reported. |

## 2. Prioritised gaps

Effort is for one person who knows the code. "Mobile" is a flag for section 4.

### Quick wins (under a day each)

1. **Cursor-following coordinate label.** User sees `5.61 mm, -7.13 mm` beside the pointer. Data already exists (`sketchReadout.tsx`, `formatCursor`). Theirs: `tools.rs` draws it beside the pointer while a tool is hovering.
   Files: `sketchReadout.tsx`, `packages/viewport/src` overlay, `app.css`. Pitfall: hide on touch (no hover), keep the status-bar field, avoid re-render per
   pointer move (it is fed once per animation frame already).
2. **Dimension value chips.** Give `SketchAnnotations.tsx` labels a rounded background, and a distinct colour per kind
   (driving, reference, angle). User sees pills like `Ø80.00 mm`. Files: `SketchAnnotations.tsx`, `dimGraphics.ts` (`labelBox` width
   estimate `text.length*7+14` must follow any padding change), `app.css`/theme tokens. Pitfall: `dimLayout.ts` collision uses `labelBox`, and
   dark/light contrast tokens.
3. **Constraint glyph chips.** Same treatment for relation glyphs, plus hover-link between glyph and the entities it names (list rows already do this).
   Files: `SketchAnnotations.tsx`, `SketchConstraintList.tsx`. Pitfall: glyphs must avoid dimension text (their `glyphs()` moves a glyph that would sit on a value; ours may already, **unverified**).
4. **Missing display toggles** (Profile fill, Points, Projected, Construction visibility). Files: `sketchPrefs.ts` (`SketchShow`), Display popover in `SketchBar.tsx`,
   viewport layer filter. Pitfall: `sanitizeSketchPrefs` must default new keys on for stored prefs.
5. **Chamfer variants** (distance + angle, two distances). Files: `tools/corner.ts`, `chamfer.ts`, field set in `SketchFields.tsx`. Pitfall: kernel must
   express the unequal chamfer with existing constraints (distance per leg, angle); check with a kernel test per `tools/README.md` rule 7.
6. **Extra circle/rectangle/polygon/slot variants that need no new kernel concept** (2-point, 3-point circle; 3-point and rounded rectangle; the centre-point arc slot is done, a 3-point one is not): all reduce to existing
   `circle`, `arc`, `line` entities and coincident/tangent constraints. Files: `tools/circle.ts`, `rectangle.ts`, `slot.ts`, `registry.ts`, `PALETTE_SLOTS`, icons, i18n
   (`app.sketch.tool.*`). Pitfall: every tool needs a kernel test and an i18n key; two-tangent and three-tangent circles need solver-friendly seeds.
7. **Sketch Report.** (Theirs: `sketch_report.rs`.) A popover/sheet listing entity counts by type, DOF, conflicts, loose ends (open chains: `sketchOpenChains` already exists in `@kit/sketch`), profiles found
   (`shapes.ts`). Files: new `SketchReport.tsx`, `SketchBar.tsx`, command in `commands.ts`. Pitfall: wording for "loose end" vs "open profile"; tie-loose-ends is the useful action.
8. **Command search field in the ribbon** (visible box, not just `F`). Reuse `CommandPalette.tsx` with an inline input. Files: `Ribbon.tsx` or app header, `main.tsx` (`palette` state). Pitfall: on
   phones the box must collapse to an icon (see section 4).

### Medium (a few days)

9. **Pinnable commands + "all commands" group dropdown.** Replace or complement last-used memory with explicit pinning: each group's flyout lists every command of the group with its key,
   hovering a row shows a pin toggle, pinned commands render as ribbon buttons. Files: `packages/ui/src/Slot.tsx` (flyout rows, `slotMemory` -> a pinned set),
   `Ribbon.tsx`/`resolveLayout`, `toolbarModel.ts` (`SLOTS`), `SketchToolStrip.tsx` (`PALETTE_SLOTS`, new `groupItems`), persistence in `packages/store` workspace (not localStorage only, so it follows the workspace
   preset). Pitfalls: (a) slots and pins fight: decide whether the ribbon button for a family shows the *last used* or the *pinned* variant; (b) the left tool rail and flyouts read the same SLOTS
   (`toolbarModel.ts` header), so pin state must be shared or the rail diverges; (c) their pin icon only appears on hover, which does not exist on touch: use a long-press or edit mode there; (d) reset must be possible.
10. **Sketch Constrainer + AutoConstrain with tolerance.** (a) Constrainer: pick 1-2 entities, apply the constraint the geometry nearly has (H/V, parallel, perpendicular, collinear, coincident,
    concentric, equal, tangent). The detection logic already exists inside `fullyDefine` step 1 (`define.ts`): factor it to accept a selection. (b) Expose `fullyDefine` tolerances (1 deg, 1e-4) and a "relations only" mode, and a
    "from datum" variant. Files: `define.ts`, new `tools/constrainer.ts`, `registry.ts`, `SketchBar.tsx`. Pitfall: the solver refuses over-constraint; apply one at a time and drop what the solver blames (already how `fullyDefine` works).
11. **Right-hand "Feature Options"-style sketch panel.** Persistent panel (docked, foldable) holding: tool variants as icon buttons for the running tool, line type (normal/construction/centerline),
    display checkboxes, DOF status, Finish. Files: new `SketchPanel.tsx` (reuse `SketchStatus`, `SketchConstruction`, `SketchPrefsSection.tsx`), `layoutMode.ts` (`sketchPalette` workspace flag exists), `Slot.tsx` items for the family.
    Pitfalls: ours already puts these in the ribbon Status/Reference groups and the left rail; docking a third place needs the workspace presets (Plasticity-style, Classic, Minimal) to say where it goes. Mode switch mid-draw needs "restart tool, keep draft" in `main.tsx` `runTool`.
12. **Break tool and Extend/Break variants.** Break: split a curve at a picked point, without removing anything. Reuse `trim.ts` split code (`lines ~128`). Files: new `tools/break.ts`, `registry.ts`. Pitfall: a split must keep constraints on both halves and reuse the cut point id.
13. **Copy / Cut / Paste Sketch Entities.** In-app clipboard of entities with their internal constraints (the `transform.ts` copy code already builds copies "with constraints that live entirely inside the copied set"), paste at the pointer, across sketches and across documents. Files: `tools/transform.ts`, `main.tsx` key handling (Ctrl+C/X/V in sketch mode are currently free), `packages/sketch/src/select.ts`. Pitfall: ids must be remapped; paste into a sketch on another plane keeps UV coordinates.
14. **Rebindable shortcuts + show keys in every dropdown row.** Files: new keymap store in `packages/store`, `commands.ts` key table (`keys` field exists on `Command`), `registry.ts`. Pitfall: reserved keys (sketch letters collide with model keys; `docs/gui-parity.md` row "Sketch keys").
15. **Profile fill.** Translucent fill of closed shapes in the sketch view. Files: viewport sketch layer (find where sketch lines are built **(unverified)**), `shapes.ts` for loops with holes (ring = outer minus inner). Pitfall: nested loops and open profiles; fill must not steal picks (their profile picking is separate).
16. **Slice / section while sketching.** Clip the body at the sketch plane. Files: viewport clipping planes (`packages/viewport/src/viewport.ts`, section view exists in `measure` slot `section-view`). Pitfall: interplay with `meshFade`.

### Large

17. **Configuration table** (rows of parameter values and feature suppressions, switchable, undoable). Needs document model and kernel support for configurations; our parameters/equations (`docs/equations.md`) are the base.
    Files: `packages/store`, controller, new `ConfigTable.tsx`. Pitfall: all-or-nothing activation, rename/delete propagation (theirs: `config.rs`, "kept through parameter renames and feature deletes").
18. **Associative projection/include and the rest of the projection family** (Intersect, Project to Surface, Intersection Curve, Spun Profile). Kernel-limited (`docs/sketch-tools.md`, "What is not here").
19. **Conic curve, G3/G4 blend curves, Curvature and Polygon constraints, Infinite line.** Kernel support first; the UI is small afterwards.
20. **Canvas/decal reference images and SVG insert.**

## 3. Icons: licence and reuse

**Licence.** The repository is "MIT OR Apache-2.0" (`<cadkit>/ext/solidcraft/LICENSE-MIT`, `LICENSE-APACHE`; `NOTICE`: "Copyright (c) 2026 SolidCraft contributors").
The `NOTICE` says: "Most bundled assets are drawn in code or contributed originally"; the per-file list is `ATTRIBUTION.md`.
`ATTRIBUTION.md` states a mandatory policy: no Autodesk iconography, images, artwork, fonts or help text, and every asset is original work by SolidCraft contributors
or third-party under an open licence. `NOTICE` also disclaims affiliation with CAD vendors and lists trademarks (we should not reproduce product names beyond that).

**What exists** (all under `<cadkit>/ext/solidcraft/assets/icons/ui/`):

| Kind | Files | Format | Attribution |
|---|---|---|---|
| Command/menu icons | `design/svg/model/` (about 280 files incl. sketch ones: `line`, `rect`, `rect3`, `rect_center`, `rect_rounded`, `circle`, `circle2`, `circle3`, `circle_tt`, `circle_ttt`, `arc3`, `arc_center`, `arc_tangent`, `slot*`, `polygon*`, `ellipse`, `spline`, `spline_cv`, `conic`, `point`, `centerline`, `construction`, `trim`, `extend`, `offset`, `mirror`, `fillet`, `sketch_chamfer`, `sketch_chamfer_angle`, `sketch_chamfer_two_distances`, `sketch_mirror`, `blend`, `break` and `dimension`, `constrainer`, `auto_constrain`, `c_*` constraint icons, `pattern_rect`, `pattern_circ`, `project`, `params`, `configuration_table`) | SVG, `viewBox="0 0 64 64"`, stroked paths, `stroke-width` 4.25, two-tone with fixed hex values that are mapped to palette roles (`design/palette.toml`) | One row per file in `ATTRIBUTION.md`: "SolidCraft contributors", "original SolidCraft artwork", MIT OR Apache-2.0 (363 rows for 363 svg masters at 58c64ca4; `cargo xtask assets` fails CI if a file is missing from the table) |
| Navigation/app icons | `design/svg/flat/` (undo, redo, lookat, orbit, pan, zoom...), `small/`, `workspace/` | SVG, single colour via `currentColor` | same |
| Palette and aliases | `design/palette.toml`, `design/aliases.toml` (e.g. `sketch_break` shares a master) | TOML | same |
| Glyphs, markers, pointer, navigation | `source/glyphs.rs`, `markers.rs`, `pointer.rs`, `navigation.rs` | **Rust drawing code** (egui painter) | "Original"; titlebar caption geometry adapted from VectorCraft (same family, MIT OR Apache-2.0) |
| App icon | `assets/icons/app/` | Icon Composer source plus SVG | same; not relevant for us |

**Drawn in code or asset files?** Command icons are asset files (SVG masters, embedded at build and rasterised with tiny-skia in `crates/ui-egui/src/icon_svg.rs`;
`icons.rs` is the thin paint boundary). Only the small canvas glyphs (constraint glyph chips in `markers.rs`, pointers, navigation cube bits) are Rust painter code. So the command
icons are directly reusable as SVG; the canvas glyph code is not (it would have to be re-drawn from its geometry, which would be our own implementation of the same shapes).

**What reuse would need.**
1. Our icons are a hand-built path table on a 24 grid, one `currentColor` stroke 1.75 (`packages/ui/src/icons.tsx`, `docs/icons.md`). Theirs are 64 grid, 4.25 stroke (about 1.6 on a 24 grid, close),
   two-tone. Importing means: scale paths or change `viewBox`, map the hex values (`#34465b` ink, `#236ead` active accent, `#8e9faf` passive) to CSS variables so dark theme works (their dark mapping is in `palette.toml`), and keep the
   two-tone or flatten to `currentColor`.
2. Keep the notice: MIT requires the copyright notice and licence text in copies or substantial portions. Choose one licence (MIT is the simplest) and carry:
   * a row in `THIRD_PARTY.md` ("SolidCraft UI icons, `<files>`, https://github.com/tangency-labs/solidcraft, Copyright (c) 2026 SolidCraft contributors, MIT") with the MIT text beside the BOSL2 text already there;
   * if we took the Apache-2.0 option instead, also carry the Apache licence text and their `NOTICE` content;
   * file-level: a comment or a sibling `LICENSE` in whatever directory holds the copied SVGs.
3. Do not copy anything that `ATTRIBUTION.md` attributes to another party: fonts (Liberation Sans, BIZ UDPGothic are OFL 1.1), example parts, the `rover` recordings by a third-party author. None of those are icons.
4. Not verified: whether any individual SVG embeds a different copyright in its body (I read `trim.svg`, `undo.svg`, `c_tangent.svg`: none do), and trademark/trade-dress risk for icons that resemble another product's. Their own policy and review tooling
   (`design/tools/`, `STYLE_GUIDE.md`) claims independence, but I did not audit the artwork.
5. Practical note: SolidCraft's set is in a consistent house style; mixing a few borrowed icons with our hand-drawn set will look uneven. Reusing the whole sketch set (about 60 icons) would be needed
   to avoid it, or use them as drawing references only (drawing our own, which needs no notice).

## 4. Mobile note

Our layouts: phone / tablet / desktop (`layoutMode.ts`; phone hides the left/right panels, `sketchPalette: false`, bottom sheets for tree/properties).

Do not carry over to touch (or only with a different form):

* **Hover-to-pin rows and hover tooltips**: use long-press or an "edit toolbar" mode. Our `Slot.tsx` already has long press and flick to open a flyout.
* **Cursor-following coordinate label**: no hover on touch; show the coordinates of the touch point only while a finger is down (offset above the finger), otherwise rely on the status bar field.
* **236 px right-docked options panel**: wrong for a phone. On tablet it can dock (as the properties panel does); on phone use a bottom sheet opened from a "Tool options" button.
* **Keyboard shortcut keys in dropdowns** and the typed command line: show nothing on phone.
* **Always-visible search box**: collapse to an icon on phone.

Carry over fine:

* Group dropdown/flyouts, pinned buttons (with long-press to pin), icon-only mode, per-panel collapse (`fit`) which is how they cope with narrow windows.
* Dimension and glyph chips: larger hit targets than plain text labels, a net gain for touch; keep a 32 px minimum hit area and let `dimLayout.ts` account for it.
* Variant icon buttons for the running tool: good on tablet, a one-row strip above the canvas on phone.
* Look At and Finish/Cancel as big buttons.

Their own app does not target touch: the clone has navigation presets for mouse and touchpad but no touch gestures (`crates/ui-egui/src/control.rs` only simulates touch phases for tests) and a wasm browser build; so none of the patterns above is proven on touch there **(code search only)**.

## 5. Suggested order

Chips for dimensions/constraints and the cursor label first (visible, cheap), then missing tool variants and chamfers, then Sketch Report and the visible search box, then pinning (largest UX
change, touches `Slot.tsx` shared by the rail and ribbon), then Constrainer/AutoConstrain options, clipboard, Break, profile fill. Configuration table and the projection family wait for kernel work.
