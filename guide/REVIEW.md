# Review: the pages written after the audit, against the code

This is the statement-by-statement check of the guide text written after the [audit](audit.md) (commits `0bdaffb`,
`5c2693c`, `e034c6f`; `65f3e90..e034c6f`). Statements are checked against the `kit` checkout at `12b9d28` ("main"), not against the docs branch. Citations in
the right-hand column are files and lines in that checkout. I read the code and its tests; I did not run the app.

A statement is listed when the code does not show it, shows something else, or when the behaviour lives in the geometry
kernel, which is a WASM binary and has no source in this checkout. The older, unchanged text of these pages was
audited in the [audit](audit.md) already; I checked the changed hunks and spot-checked the rest of each page.

These rows describe the tree at `b3f042c`. Most were corrected in `9802940` after the review, so a row may already be
fixed in the page it names; the line numbers are the ones the review read.

## Statements the code does not support

| Where | The statement | What the code shows |
| --- | --- | --- |
| `analysis/measure.md:20`, `:61` | "The size of whatever you have selected is **always** in the corner of the view." | A single corner pick produces no lines at all, so no card appears: `apps/cad/src/inspect/quick.ts:37` ("a lone corner has a position, not a size"). A whole-body pick falls back to the selection summary, not to a size (`quick.ts:22-27`). |
| `analysis/measure.md:61` | The card is "headed **Size of the selection**". | That string is the card's `aria-label`, not visible text. The card renders only the value lines: `apps/cad/src/inspect/QuickMeasure.tsx:28`, string at `apps/cad/src/locales/inspect.ts:24`. There is no visible heading. |
| `analysis/measure.md:70` | "Two items \| The minimum distance between them **and the angle**." | An angle row exists only for two straight edges, two circular edges, or a pair the kernel answers for: `apps/cad/src/inspect/measure.ts:118,122,156`. `quick.ts:31` adds the angle line only when that row exists, so two corners give the distance alone. |
| `analysis/measure.md:83` | "with three or more it **only counts them**." | Three or more falls back to the selection summary, which appends the total area or length: `apps/cad/src/inspect/quick.ts:23,27` and `apps/cad/src/select/summary.ts:13-17` ("3 edges, 60 mm"). It does more than count. |
| `reference/limits.md:55` | "There is no 3MF export." | Contradicted by the code: 3MF is an export kind and gets a command — `apps/cad/src/commands.ts:38,231` — and the same page lists 3MF two bullets earlier at `:52`. This is the audit's own accuracy row (`audit.md:31`); the commit did not fix it. |
| `reference/limits.md:41` | "A **SolidWorks** part opens as an editable imported body that is saved with the part." | Unconditional in the guide, conditional in the code: when the feature history and the exact-solid import both fail, the part is shown view only — `apps/cad/src/main.tsx:1454-1468` (`reportImport(file, r.parts, true, ...)`). |
| `files/import.md:159`, `:161` | The new step is a "**Repair Part** step". | No such label exists. The feature type is `repairPart` with no `name` (`apps/cad/src/files/importReport.ts:74-78`), the tree shows `f.name` or falls back to the raw type (`apps/cad/src/treeModel.ts:30`; `packages/ui/src/FeatureTree.tsx:219`), and there is no `feature.repairPart` string in `apps/cad/src/locales/en.ts`. The History entry is labelled "Repair" (`locales/en.ts:214`). |
| `getting-started/interface.md:98` | "the commands that apply ... most relevant first, **in the order of the right-click menu**." | The section is one `Slot` that shows one command and puts the rest in its flyout (`apps/cad/src/ToolRail.tsx:37`), and `orderFirstEnabled` moves disabled commands to the end (`ToolRail.tsx:57`). The order matches the menu only among the enabled commands. |
| `getting-started/interface.md:101` | The sketch rail "gains the sketch sections (**Draw**, **Dimension**, **Constrain**, **Modify**, **Reference**)". | The list is incomplete: a **Select** section is always emitted first (`apps/cad/src/SketchToolStrip.tsx:93-95`). Empty groups are dropped, so the rest can be shorter. |
| `getting-started/interface.md:97` | "A cell shows the tool you used last from that family." | Not for slots marked `fixed`: they ignore the memory and always show their first command (`packages/ui/src/Slot.tsx:86,106`). The rail's Create section fixes the Extrude cell (`apps/cad/src/toolbarModel.ts:102`), so that cell always reads Extrude, whatever was used last. |
| `modelling/curves.md:7` (alt text) | "the face rebuilt as a **net with a control point lifted**". | The kernel does return the net, as a marker (`apps/cad/src/curveCommands.kernel.test.ts:150`), but the viewport never reads `ViewBody.markers`: the field is declared at `packages/viewport/src/viewport.ts:59` and drawn nowhere. The image cannot show a net or a lifted point. |
| `modelling/curves.md:28` | "several separate pieces ... **are reported**." | Only the editor's own note claims this (`apps/cad/src/locales/en.ts:977`). The kernel test projects a two-line chain, gets `pieces: 2` on the marker and an empty error list (`apps/cad/src/curveCommands.kernel.test.ts:69,73`); the app has no message that reads the piece count. |

## Kernel behaviour this checkout cannot confirm

These may well be true, but the rule is enforced inside the WASM kernel, which is not in the repository. The app only
repeats the promise in a string; nothing in `apps/` or `packages/` checks it.

| Where | The statement | What the checkout does show |
| --- | --- | --- |
| `modelling/curves.md:32`, `:78` | The chain "must meet end to end, in the order you add them", or the rebuild will not build. | The app passes the curve rows in the order given and does no continuity check (`apps/cad/src/featureCreators.ts:511-530`). The rule appears only in the editor note (`locales/en.ts:979`). |
| `modelling/curves.md:69` | "The outer ring of the net never moves". | Editor note only (`locales/en.ts:989`). The kernel test moves a middle point of the 5 x 5 net, not a ring point (`curveCommands.kernel.test.ts:150-151`). |
| `modelling/surfaces.md:76` | Thickness is interpolated between stops and changes smoothly; positions run smallest to largest; stops that do not cover the sheet are refused. | The app does not sort or validate the stops (`apps/cad/src/surfaceRules.ts:94-112`); it only shows the note (`locales/en.ts:953`). `docs/propellers.md:178` supports the coverage rule ("needs stops covering the whole sheet along the direction"); interpolation is the kernel's. |
| `files/import.md:157` | Repair "rebuilds the faces that could not be read on their own surface, sews small gaps and fills flat holes". | The wording is the button's tooltip (`locales/en.ts:215`); the app only builds and commits the step (`apps/cad/src/main.tsx:1430-1445`). The repair itself is the kernel's. |

## Checked and confirmed

The main new claims that do hold, so the review above is read in context:

- **Cut from / Target body** — Add gets `TargetBody`, Cut gets `CutFrom` with a tick per named body, neither appears
  without a named body and neither for New body; shown for Extrude, Revolve, a solid Loft and Sweep
  (`apps/cad/src/FeatureOptions.tsx:99-129,297,580,657`).
- **Repeat last command** — Home > Edit, no shortcut, not remembered as a command search run and never itself,
  greyed when the last command cannot run (`apps/cad/src/commands.ts:142,214-222`).
- **Tool rail** — off on a first visit, on in the Plasticity-style preset only (`packages/store/src/index.ts:48-53`);
  sections and their labels (`apps/cad/src/toolbarModel.ts:99-108`, `locales/toolbar.ts:6-7`), empty sections skipped
  (`ToolRail.tsx:41-44`); the flyout's four ways to open (`packages/ui/src/Slot.tsx:168-178,190`); per-kind memory for
  the selection section (`ToolRail.tsx:36-37`); only the Edit section in a sketch with the ribbon on
  (`toolbarModel.ts:163-170`, `main.tsx:4082`).
- **Screw** — defaults M3 / 8 mm / pan / cross / 0,0,0 / down -Z, M2..M16, M12 and M16 without pan or cheese, the exact
  "size M12 has no pan head in the table" refusal, one body named `Screw`, one commit on Add screw
  (`apps/cad/src/screw.ts:11-26`, `packages/script/src/features/screw.ts:38-51,170,217`, `apps/cad/src/main.tsx:3251-3268`).
- **Import report and repair** — notice with the Import report action, one row per part with the three outcomes, six
  faces then "… and n more", Close and Repair, the view-only note, and the Diagnostics warning with both buttons
  (`apps/cad/src/files/ImportReportDialog.tsx:15,26-46`; `files/importReport.ts:59-78`; `main.tsx:1424-1445,3992`).
  Repair is one commit and a refused repair is not added (`main.tsx:1430-1438`).
- **Thicken variable thickness** — the control, the three axes plus a custom vector, 2 to 6 stops, the defaults
  (thickness, then half), Add stop / Remove (`FeatureOptions.tsx:588-610`, `surfaceRules.ts:72-112`).
- **The quick readout's table** for one straight edge, one circular edge, one face and a count
  (`apps/cad/src/inspect/quick.ts:29-37`); hidden while measuring or sketching (`main.tsx:1855`); top left on a phone or
  tablet (`apps/cad/src/app.css:1515-1516`); the card over the selection list (`app.css:29,840`).
- **Import limits** — STEP and SketchUp ask and remember per kind, both default to the saved form, 3MF and OBJ are not
  accepted (`apps/cad/src/files/ImportKindDialog.tsx:11-18`, `files/names.ts:42-43`).
- **Command rows** — Project curve, Edit curve, Freeform, Knurl, Screw and Bearing exist with the stated availability
  (`apps/cad/src/featureCreators.ts:571-586,504-513,511-530`, `apps/cad/src/toolbarModel.ts:22-23`, `commands.ts:187-192`).

## The audit, after the work

All eight gaps in the [audit](audit.md) now have prose: the quick readout (`measure.md`), Repeat last command (`history.md`,
`commands.md`), Screws (`wizards.md`), the curves page and its two command rows, the import report and Repair, variable
thickness (`surfaces.md`), Cut from (`bodies.md`) and the tool rail (`interface.md`). The corrected claims about
Project curve/Freeform, the Target-body label, STL import, STEP/SketchUp view-only and the Gear family are gone.

One accuracy row had slipped through at the time of the review: `reference/limits.md:55` still said "There is no 3MF
export." while the same page listed 3MF and the code exports it (first table above, fifth row). `9802940` removed it.
