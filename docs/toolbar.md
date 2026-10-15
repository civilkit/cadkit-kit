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

The right-edge palette shown while sketching uses the same slots: sections Select, Draw, Dimension, Constrain, Edit; the
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
  groups Select, Draw, Dimension, Constrain, Modify, Reference and Finish (OK / Cancel). It uses the palette's slots
  (`sketchRibbonGroups` in SketchToolStrip.tsx), so the last-used memory, icons, names and keys are the same. Closing the sketch
  restores the tab the user was on (the user's tab is never overwritten: `activeRibbonTab`). The Sketch tab is not a command tab, so
  the command search (F) lists the same commands as before.
- **Sketch dialog** (left of the viewport): name, plane, Show constraints, Show dimensions, OK and Cancel (`SketchDialog.tsx`).
- **Tool palette in sketches** (Settings, `sketchPalette`, default off): the right-hand floating sketch palette. It is also shown when
  the ribbon is off (the Plasticity preset), as then nothing else carries the sketch tools. Flick / long press stay in the slot.
- **Feature editors**: while one is open the ribbon greys the model commands (`idleDuringEdit` / `MODEL_COMMANDS`); undo, redo,
  views, selection and inspection stay. Keyboard shortcuts are not affected.
- **Assemblies**: a document with inserted components (`docKindOf`) selects the Assembly tab when it becomes one (`tabForKindChange`).
