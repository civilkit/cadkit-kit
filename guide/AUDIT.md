# Audit: the guide against the app

What the guide does not cover, or covers wrongly, checked against the code in this worktree. Every row cites a
command id or a file and line, so a row can be checked without leaving this page. Ranked by how often a new user
runs into the thing, with accuracy problems (the guide saying something the app does not do) counted as needing a
fix regardless of rank. Sheet metal is out of scope.

Where the guide stands today: the ribbon, selection, sketching, solids, edges, patterns, history, files, drawings,
assemblies, measurements, checks, catalog and most of the library are covered well. The gaps below are the
exceptions.

## The eight gaps this audit writes up

| # | What is missing | Where it lives in the app | What the guide says today | Fix |
| --- | --- | --- | --- | --- |
| 1 | **Size of the selection, read as you select**: a small card in the corner of the view gives the edge length, a circle's diameter, radius and circumference, a face's area, or the distance and angle between two picks, without opening the Measure tool. It hides while the Measure tool is open and while you sketch. | `apps/cad/src/inspect/QuickMeasure.tsx:11,26`; shown from `apps/cad/src/main.tsx:1812,4011`; strings `quick.label`, `quick.count`, `quick.circumference` in `apps/cad/src/locales/inspect.ts:24` | Nothing. `analysis/measure.md:20` says "There is no separate probe tool"; `getting-started/navigation.md:56` mentions "the selection readout" only as something the view cube must not cover. | New section in `analysis/measure.md` |
| 2 | **Repeat last command** (`repeat-last`): runs the last command again. Home > Edit, next to Undo and Redo, no shortcut; greyed with "No command has been run yet" until one has run. Command search and the palette do not count as the last command, and neither does Repeat itself. | `apps/cad/src/commands.ts:136-139,207-218`; `toolbarModel.ts:53`; `cmd.repeat-last` at `locales/en.ts:292` | Nowhere. Missing from the Home > Edit table in `reference/commands.md:89-97`, which lists only Undo and Redo plus the tree commands. | Section in `reference/commands.md` + a row in its Edit table |
| 3 | **Screw wizard** (`add-screw`): size, length, head, drive, where the head bears and which way the shank points, with a live preview; builds an ordinary feature that is a separate body. Cross and Torx drives are approximations. | `apps/cad/src/commands.ts:188`; `apps/cad/src/ScrewWizard.tsx`; rules and strings `apps/cad/src/screw.ts`, `apps/cad/src/locales/screw.ts` | One word. `library/wizards.md:15` lists "Screw" among the wizards that do not move with the part; `wizards.md:9` names only Gear, Gear pair, Propeller and Impeller in the button family (the family also holds Knurl, Screw and Bearing: `toolbarModel.ts:22`). | New `## Screws` section in `library/wizards.md` |
| 4 | **Curves on faces: Project curve, Edit curve, Freeform**. Project curve puts a sketch or a curve feature onto picked faces (or every face); Edit curve refits picked edges, sketch curves or a curve feature into a smooth curve; Freeform rebuilds picked faces as a control-point net you can drag. | `featureCreators.ts:571,572,586` with ops at `:504-513,525-534`; editors at `FeatureOptions.tsx:865,905,957`; in the ribbon as members of the Reference and Trim/Surface edit families (`toolbarModel.ts:23,27`) | **Wrong.** `modelling/surfaces.md:88` says "Project curve onto a surface has no command" and `:90` says "Free-form surface editing (control points) and curve editing have no tools". Neither command is in `reference/commands.md` (Reference table `:106-112`, Surfaces > Edit table `:164-170`). | New page `modelling/curves.md`, corrected bullets in `surfaces.md`, two rows added to `reference/commands.md` |
| 5 | **Import report and Repair**: when a file comes in with a part that is not a solid, a notice offers **Import report** — one row per part saying solid, surface body that needs repair, or not imported, with the kernel's reasons and the faces concerned — and **Repair**, which adds one undoable Repair Part step (rebuilds the faces it could not read, sews gaps, fills flat holes). For a view-only STEP it makes the file an editable part first. The same buttons are on the warning in the Diagnostics tab. | `main.tsx:1387-1411` (report and repair), `:3926-3927` (Diagnostics), dialog `apps/cad/src/files/ImportReportDialog.tsx`, strings `locales/en.ts:208-220` | Nothing. `files/import.md:151-160` tells you to fix gaps "in the source program"; the word "report" never appears in the guide. | New section in `files/import.md` |
| 6 | **Thicken, variable thickness**: one thickness over a sheet, or a ramp along X, Y, Z or a custom axis with 2 to 6 stops whose thicknesses rise and must cover the whole surface. | `FeatureOptions.tsx:587-610` (`ThickenOptions`); strings `opt.thicken.variable`, `opt.thicken.along`, `opt.thicken.stopsNote` at `locales/en.ts:927-930` | `modelling/surfaces.md:65` lists Surface, Thickness, Side and Operation only. | Extend the Thicken paragraph in `surfaces.md` |
| 7 | **Cut from**: the Cut editor's list of bodies the cut acts on — "All bodies the shape reaches" (default) or the ticked ones. Add has a different control, **Target body**, which is a single choice of Automatic or one body. | `FeatureOptions.tsx:98-126`; strings `opt.cutFrom`, `opt.cutFrom.all`, `opt.target`, `opt.target.auto` at `locales/en.ts:915` | `modelling/bodies.md:50` says the Extrude editor "shows a **Target body** control for Add and Cut" — the label is right for Add and wrong for Cut, and the multi-select behaviour is not described. | Correct and extend the paragraph in `bodies.md` |
| 8 | **Tool rail**: the column of modelling commands down the left edge, in sections (For selection, History, Sketch, Create, Modify, Frame, Surfaces, Pattern, Inspect, Assembly, Select). Each cell is a family that shows the tool used last and opens the rest on a long press, a flick, a right click or the corner triangle. It is off on a first visit; the Plasticity-style preset turns it on. In a sketch only the History section and the sketch tools stay. | `apps/cad/src/ToolRail.tsx:15-60`; sections `toolbarModel.ts:92-109`; setting `settings.toolRail` at `locales/en.ts:356`; first-visit default `packages/store/src/index.ts:52` | One settings row (`getting-started/settings.md:39`, preset table `:55`) and one bullet in `reference/commands.md:13`. Nothing says what is on it or how a family opens. | New section in `getting-started/interface.md` |

## Accuracy problems to correct while writing

| Claim | Where | The code says |
| --- | --- | --- |
| "Project curve onto a surface has no command" and "Free-form surface editing (control points) and curve editing have no tools" | `modelling/surfaces.md:88,90` | `add-project-curve`, `add-edit-curve`, `add-freeform` exist and are on the ribbon (`featureCreators.ts:571,572,586`) |
| "The Extrude editor shows a **Target body** control for Add and Cut" | `modelling/bodies.md:50` | Add gets `TargetBody` (one choice), Cut gets `CutFrom` (a tick list headed **Cut from**): `FeatureOptions.tsx:98-126` |
| "There is no 3MF export." | `reference/limits.md:55` | 3MF is exported (`commands.ts:35-37`, `files/export.md:41-46`), and `limits.md:53` in the same section already lists it |
| "STL, OBJ and 3MF cannot be imported." | `reference/limits.md:45` | STL imports as a reference mesh (`files/import.md:37-54`) |
| "STEP and SketchUp files open as **view-only** bodies" | `reference/limits.md:41` | The default STEP choice is an imported solid feature and SketchUp a reference mesh; view-only is the alternative you choose (`files/import.md:7-13`) |
| "One button holds Gear, Gear pair, Propeller and Impeller" | `reference/commands.md:114`, `library/wizards.md:9` | The family also holds Knurl, Screw and Bearing (`toolbarModel.ts:22`) |
| Thicken's options | `modelling/surfaces.md:65` | Plus Variable thickness and its stops (`FeatureOptions.tsx:587-610`) |

## Covered, but thin (no new page planned)

| What | Where it stands | Note |
| --- | --- | --- |
| Rib, Lip / groove | Two bullets, `modelling/edges.md:111-116`; rows in `reference/commands.md:130,131` | Correct as far as it goes; the commands carry no tooltip description of their own (`featureCreators.ts:563,564` have no `tip`), so the guide is the only description. |
| Pipe cut | One paragraph, `modelling/surfaces.md:82-84`; row in `reference/commands.md:134` | Correct, including "the solid becomes a surface body" (`featureCreators.ts:255-260`). |
| Console tab of the drawer | One line, `getting-started/interface.md:164`; passing mentions in `analysis/checks.md:18`, `files/import.md:154` | Enough for what the tab does (recent notices). |
| Tool palette in sketches | One settings row, `getting-started/settings.md:40` | The sketch ribbon carries the same tools (`sketching/tools.md:9`). |

## Missing rows in the command reference

`reference/commands.md` claims to list every command (`commands.md:3`). These are absent:

| Command | Should appear under | Evidence |
| --- | --- | --- |
| Repeat last command | Home > Edit | `commands.ts:214`, `toolbarModel.ts:53` |
| Screw, Bearing, Knurl | Features > Create (the Gear family) | `commands.ts:184,188,189`; `toolbarModel.ts:22`; the table at `commands.md:116-121` lists four of the seven |
| Project curve, Edit curve | Features > Reference | `featureCreators.ts:571,572`; the table at `commands.md:106-112` lists Plane, Axis and Helix only |
| Freeform | Surfaces > Edit | `featureCreators.ts:586`; the table at `commands.md:164-170` lists Trim, Knit and Thicken only |

## What this audit did not check

- It reads the code, not a running app. Rows that depend on where a control lands on screen (the corner card of
  gap 1, the Cut from tick list of gap 7) should be confirmed against a screenshot before the wording is treated
  as final.
- Sheet metal, the drawing workspace's commands beyond what the guide already covers, and the script API are out
  of scope.
