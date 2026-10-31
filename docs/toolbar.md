# Toolbars: the ribbon, the tool palette and the sketch palette

All three are built from one component, the **slot** (`packages/ui/src/Slot.tsx`), and one data file,
`apps/cad/src/toolbarModel.ts`. Command ids and keyboard shortcuts live in `apps/cad/src/commands.ts` and the
`*Commands.ts` files and are not touched by any of this.

## The slot

A slot is one button for a family of related commands.

- It shows one command: the active one if the family has an active member (a display style, a sketch tool picked by key),
  else the one used last, else the first. The last used command is remembered per slot id in `localStorage`
  (`kit.slotLast`), so the ribbon and the tool palette show the same command for the same slot.
- A small corner triangle marks a slot that holds more than one command. A long press (380 ms), a flick towards the list,
  a right click or a click on the triangle opens the list: every command with its icon, name and key; commands that cannot
  run now are greyed; a tick marks the ones that are on. Escape or a click elsewhere closes it.
- The tooltip (instant, on hover and keyboard focus) shows the name, the key and the one-line tip of the shown command.
- Variants: `radio` (the items are choices of one setting: the button shows the chosen one but is not drawn pressed),
  `menu` (the button only opens the list, used for the show/hide toggles, with `keepOpen` so several can be flipped).

## Slots (`SLOTS` in toolbarModel.ts)

`new-sketch`, `extrude` (extrude, cut), `hole` (hole, thread), `edge-round` (fillet, chamfer), `draft` (draft, rib, lip),
`pattern` (linear, circular), `loft-sweep`, `gear`, `reference` (plane, axis, helix), `surface-new`, `surface-reshape`,
`surface-edit`, `history`, `export`, `views`, `style`, `light`, `background`, `layers`, `pick-mode`, `pick-grow`,
`pick-set`, `measure`, `surface-check`, `asm-parts`, `asm-review`, `delete-geom`, `catalog`.
Adding a command id to a slot adds it to the ribbon and the palette at once.

## Adding a command: one entry

`SLOTS` in `toolbarModel.ts` is the single table: slot id -> command ids in order (the first is the default cell). The ribbon
and the palette both read it; `RIBBON_LAYOUT` and `RAIL_SECTIONS` only choose where a slot goes. To add a command: register it
in the command table, add its icon to `icons.tsx` (the audit test fails without one), and add its id to a slot (or a new slot,
placed once in each layout). The command search finds it automatically. Ids may be reserved ahead of the command in `PLANNED`;
the toolbars skip ids that are not registered. Reserved now: `add-thin-extrude`, `add-thin-cut`, `add-thin-revolve` (slot `thin`,
in the Create group of the ribbon's Home tab and the palette).

## The ribbon (`RIBBON_LAYOUT`)

Tabs of titled groups, each group a row of slots (File, Import / Export, Sketch, Create, Modify, Pattern, Edit on Home;
Reference, Create, Modify, Bodies on Features; and so on). Rules:

- One row. The ribbon measures itself: if the text mode does not fit it drops the names under the icons (and the group
  titles) automatically; if the icons still do not fit, the groups that do not fit move into a **More** menu at the right.
  Every window width from a phone to a wide screen therefore shows one row.
- Text mode: icon with a short name under it (`rb.<command id>` in `locales/toolbar.ts`, the full name is the tooltip and the
  accessible name) and a small group title under the group. Icons-only mode: 34 px icon buttons, no group titles, dividers
  between groups, tooltips with name and key.
- A command that the layout does not place is appended to a group of its own tab (`resolveLayout`), so a new command is
  never hidden; a unit test (`toolbarModel.test.ts`) fails until it is placed.

## The tool palette (`RAIL_SECTIONS`, `ToolRail.tsx`)

The vertical palette at the left edge of the viewport is the primary way to reach modelling commands: sections Edit,
Sketch, Create, Modify, Surfaces, Pattern, Inspect, Assembly and Select, each a grid of slots (two columns; a name under
each icon in the text mode, icons only in the icons-only mode).

- **For selection**: when a face, edge, corner or body is selected, the first section is a slot holding the commands that
  apply to it (the right-click menu's list: sketch on face, hole, shell, patterns; fillet, chamfer; ...), enabled ones first.
- Every command except files, export, camera and display settings must be on the palette
  (`notOnRail`, enforced by a test); everything is also in the ribbon and in the command search (F).
- Responsive: below 900 px wide the palette is one column of icons without section titles; below 640 px it is a horizontal
  strip along the bottom of the viewport. It scrolls when the window is shorter than the palette.

## The sketch palette (`SketchToolStrip.tsx`)

The right-edge palette (only when nothing else carries the sketch tools or the Tool palette setting is on; see `sketchChrome`) uses the same slots: sections Select, Draw, Dimension, Constrain, Edit; the
active tool is drawn pressed; text mode shows a name under each icon; the list shows names and keys. Slot families are
`PALETTE_SLOTS`; a tool in no family still gets a cell.

## Icons

Every command has an icon in `packages/ui/src/icons.tsx` (see `docs/icons.md`); `apps/cad/src/iconAudit.test.ts` builds the
whole command table (every optional command included) and fails for a command without one.


## Contextual ribbon (Onshape style)

- **File actions live in the top bar only** (New, Open, Save, Export, Samples, and a "more" menu with Save as and Import STEP). The
  ribbon no longer has File / Import-Export groups: `isFileCommand` (toolbarModel.ts) lists them and the ribbon's `hidden` prop keeps
  `resolveLayout` from appending them to a tab. Chosen over a second app-menu button because the top bar already had the group.
- **Home** holds the model commands: Sketch, Create (extrude, thin, revolve, loft / sweep, hole, catalog), Modify (fillet, chamfer,
  shell), Pattern, Edit (undo, redo, history / rebuild).
- **Sketch tab**: while a sketch is open the tab strip is replaced by one tab named after the sketch ("Editing <name>"), with the
  groups Select, Finish (OK / Cancel), Make (Extrude, Revolve; absent for a hole sketch), Draw, Dimension, Constrain, Modify,
  Reference (project, the Construction toggle, and "Make construction" when geometry is selected) and Status (definition badge
  "Fully defined" / "N DOF" / red when over-defined, Fully define, Snaps, and the single "Look normal (N)" button, accented while the
  view is angled to the plane). The tool groups use the palette's slots (`sketchRibbonGroups` in SketchToolStrip.tsx), so the
  last-used memory, icons, names and keys are the same. Nothing floats over the canvas. The hint line and the selection count
  (with Clear) sit in the status bar. Closing the sketch restores the tab the user was on (`activeRibbonTab`).
- **Display toggles**: the sketch's dimension / relation / reference / colour switches are a "Sketch" section of the viewport's
  Display menu, shown only while sketching (one Display menu, no copy in the sketch controls).
- **The sketch bar** (`SketchBar.tsx`) is only the fallback when the ribbon is off (`sketchChrome(...).bar`): the same controls
  (Make, name, OK / Cancel, Construction, Status) as one top-centre pill, built from the same components as the ribbon groups.
- **Constraint list**: a popover under the bar, not a permanent card. It opens when the badge is clicked and by itself when a
  conflict or an over-defined sketch appears; Esc or a click outside closes it.
- **Who owns the sketch tools** (`sketchChrome` in toolbarModel.ts, tested per preset): ribbon on: the Sketch tab (the right-hand
  palette only with the `sketchPalette` setting, and a left tool column, if on, shrinks to undo / redo / rebuild). Ribbon off with the
  left column (Plasticity): the column swaps to Select, Draw, Dimension, Constrain, Modify, Reference under undo / redo / rebuild,
  the model groups (Create, Modify, Surfaces, Pattern, Inspect) are hidden, and no right palette is shown; it swaps back when the
  sketch closes. Ribbon off and no column (Minimal): the floating right palette is the only home of the tools.
- **Keyboard and F search**: Enter confirms, Esc cancels, tool letters pick tools; while a sketch is open the F search also lists
  OK, Cancel, Fully define, Construction, Look normal, Show dimensions / relations, Select and every sketch tool (`sketch-*` commands,
  search only: they are not placed on the ribbon).
- **Feature editors**: while one is open the ribbon greys the model commands (`idleDuringEdit` / `MODEL_COMMANDS`); undo, redo,
  views, selection and inspection stay. Keyboard shortcuts are not affected.
- **Assemblies**: a document with inserted components (`docKindOf`) selects the Assembly tab when it becomes one (`tabForKindChange`).

## Hull fixes (UX review of the boat-hull film)

* **Loft profiles.** A closed spline, closed control-point spline, circle or ellipse is ONE closed profile (a closed spline's two ends are
  one point, so it counts twice in the chain degree). Loft takes the sketches selected in the tree (in selection order) when two or more
  are selected; otherwise every unused closed sketch drawn since the last Loft / Extrude / Revolve / Sweep, in tree order; otherwise the
  two newest. The loft editor lists them with up / down / remove / add. If Confirm is refused the editor stays open on the same draft and
  shows the structured error and its hint (nothing is reverted).
* **Point sections.** A sketch whose only entity is one Point (the Point tool, then Finish; it is kept, never dropped as empty) is a
  "point profile": the first or the last section of a solid loft, where the surface converges to that point (a boat's bow). It counts
  as a loft profile for the Loft command and the default selection, is listed as "Point: <name>" in the loft editor, and the tree shows
  it with a point icon. The editor shows an inline rule when a point is in the middle or both ends are points (also for guides or a
  surface loft with a point); the kernel refuses those with `loftProfiles` and the editor stays open with its error. Test:
  `apps/cad/src/pointLoft.kernel.test.ts`.
* **Sketch on a plane feature.** A Plane feature selected in the tree, or a datum plane clicked in the viewport (its square outline is the
  pick area, `onPlaneFeaturePick`), is a valid sketch target: S or the "Sketch on this plane" chip starts a sketch on it.
* **Plane tool base.** Base = picked planar face, else the selected Plane feature, else the Front / Top / Right plane chosen in the tree,
  else Front. The plane editor shows it as a "Base plane" selector (Front / Top / Right / earlier planes / the face) that can be changed.
* **Default names.** Planes `Plane -60 from Front` (or `Plane between A and B`), sketches `Sketch on <plane>`. Only the defaults;
  existing documents and typed names are untouched.
* **Auto-constrain from guides** (Snaps menu, off by default): a click on a snap or alignment guide only places the point. With it on,
  the snap's constraint (aligned, midpoint, on curve ...) is added too, as before. Shift at the click still suppresses it.
* **Dismissing a menu.** The click that closes a menu or popover is not passed to the viewport (`dismissGuard.ts`), so it no longer
  starts a line point.
* **Navigation.** Middle-drag orbits, Shift+middle pans, Ctrl/Cmd+middle zooms; right-drag pans and never opens the context menu (a right
  click without movement does). In a sketch the middle button still pans.
* **Splines** draw as their curve (interpolating spline or B-spline, sampled by the same math the sketch tools preview with), with the
  points as handles, in the sketch layer and while editing.
* **Keep view when entering a sketch** (Settings, Sketching; default on): the camera stays exactly where it is; Look normal squares up.
  Off: entering a sketch squares the view to the plane (the old behaviour).

## Hull fixes, second round (UX review of the narrated hull film)

* **Live default names.** A Plane or Sketch that still carries its generated name is shown under a name derived from its CURRENT offset,
  base and plane: a plane typed at -60 reads `Plane -60 from Right`, a plane built on it reads `Plane 20 from Plane -60 from Right`, a
  sketch on it `Sketch on Plane -60 from Right`. New planes carry `autoName: true`; older documents are recognised by the shape of the
  name. A rename (F2 or double-click) writes `autoName: false` and the typed name is kept. A base plane is always labelled by what the
  tree shows, never by an inherited stale name. Code: `featureLabel`, `hasAutoName`, `refLabel` in `featureCreators.ts`.
* **Plane tool base.** The base is read from the tree selection at the moment the tool starts. Selecting a feature row clears the chosen
  Front / Top / Right row and the reverse (and a new Plane after OK is a selected feature, so the Right row is no longer highlighted and the
  next click on it selects instead of toggling off). Test: `planeBase.test.ts` (select Right, Plane, OK, select Right, Plane).
* **Loft order.** If the loft editor is given a sketch that comes later in the tree, the loft moves to just after the last sketch it uses
  (one `move` op in the same edit) and a notice says `Loft moved after <name>` (`loftMoveAfter`).
* **Loft tool and point sections.** With one or two point sketches among the profiles they are put at the ends, by their plane positions
  along the loft direction (read through standard planes and chains of offset planes; with unreadable positions the order is kept and the
  editor's inline rule shows the problem). When the kernel refuses the first try, the editor still opens: the loft is stored as a
  suppressed draft (`draftNew`) with the error shown inline; the first accepted edit makes it real, Cancel removes it. The same draft
  mechanism serves Shell, Fillet, Chamfer, Extrude, Revolve and Sweep (`createFeature` in `main.tsx`). Tests: `loftOrder.kernel.test.ts`.
* **Look normal.** Entering a sketch with the camera more than 5 degrees off the plane normal shows a `Look normal (N)` chip in the sketch
  bar; N does the same in a sketch. Settings > Sketching (and the Snaps menu) has `Auto look normal for new sketches` (default on).
  The automatic grid is 1 mm whenever 1 mm is 8 to 80 px wide, so the snap step is whole millimetres without setting the spacing.
* **Guides and constraints.** `Auto-constrain from guides` is off for a clean profile (tests: `sketchPrefs.test.ts`); guides are drawn and
  snap either way, only the constraint is gated (`constrainsFromGuides`).
* **Fit in a sketch** frames the sketch (its entities and points; a 100 mm view around the origin when empty), never the body or the
  reference planes (`sketchFitView`).
* **Shell.** The default wall is 1.0 mm or 2% of the body's smallest bounding-box side, whichever is larger, to 0.1 mm. A refused Shell
  keeps the editor open with the structured error persistently; when the error carries `maxThickness` the card offers
  `Use suggested thickness (x mm)` (`editorFixes.ts`). The kernel gives `maxThickness` only for some failures (for example `thinTooThick`).
* **Extruded cut.** Direction is `auto`: the side the body lies on is tried first, then the other, and the one that cuts is kept
  (`autoCutFlip`, probed with a preview). If neither touches the body the editor opens on the draft with `The cut does not touch the body
  in this direction. Flip?` and a `Flip direction` button. There is no extra direction arrow in the viewport (the boss preview has none either).
