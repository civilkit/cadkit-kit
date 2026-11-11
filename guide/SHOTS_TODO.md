# Shots still to make

The Freeform image was written into `modelling/curves.md` after the audit, but the app cannot show what its caption
describes, so the line was taken out of the page. The shot stays in `tools/doc_shots_defs.mjs` and calls `c.skip(...)`,
so a run reports it as SKIP rather than FAIL. `guide/screenshots.json` still carries the caption, for when the viewport
can draw it; there is no `freeform-editor.png`.

| Shot | Page | Why it is skipped | What would make it possible |
| --- | --- | --- | --- |
| `freeform-editor` | `modelling/curves.md` (the image line was taken out) | The caption says the face is "rebuilt as a net with a control point lifted". The kernel does return the net: a Freeform feature's marker carries `faces[0].net` (25 points, see `apps/cad/src/curveCommands.kernel.test.ts:149`). The viewport never reads `ViewBody.markers`, though: the field is declared at `packages/viewport/src/viewport.ts:59` and nothing in `viewport.ts` or `viewdata` draws it. `docs/surfaces-tools.md:67-68` says the same ("freeform control-net handles ... no UI yet", "Freeform and editCurve need handle editing in the viewport"). So the rebuilt face and the editor can be shown, but not the net or a lifted control point. | Draw `markers` in the viewport (the control net as lines and its points as handles), then pick one face and lift a point with a move row in the editor. |

Nothing else is skipped: the other shots build their state from the document and the editor, so they need no viewport
dragging.

## Rendered 10 Nov 2026, three still missing

Rendered and in the pages: `cut-from`, `edit-curve-editor`, `project-curve-editor`, `tool-rail` and `wizard-screw`.

These three did not render, so their pages do not show them (the definitions stay in `tools/doc_shots_defs.mjs`):

- `quick-measure`: the readout did not answer for the hole's circular edge, so the card never appeared.
- `repeat-last`: the fillet editor stayed open (Confirm was not found), so Repeat last command was still greyed out.
- `thicken-variable`: the stop rows are cramped at the panel width: the Position and Thickness labels are cut off and the value boxes show empty. This looks like a real layout problem in the Thicken editor, not only a shot problem.

## Sheet metal shots to make (10 Nov 2026)

Four definitions are in `tools/doc_shots_defs.mjs` and captioned in `guide/screenshots.json`. The
[sheet metal page](src/modelling/sheet-metal.md) does not reference an image yet: none of these has been rendered,
because this worktree has no `node_modules` and the task forbade running the app or a browser.

| Shot | What it would show |
| --- | --- |
| `sheet-rule-editor` | The Rules editor on the Sheet metal tab: Stock (rule name, thickness, k-factor, bend radius, the active tick) and Relief (relief width and depth, corner relief and its shape, the two gaps, Follow the thickness again) |
| `sheet-edge-flange-editor` | The Edge flange editor with four edges picked: Height, Angle, Bend radius, Height measured, Flange position, Flip direction, and the four legs previewed on the plate |
| `sheet-flat-pattern` | The flat pattern panel: the blank outline and bend zones, bend lines B1 to B5 with their angles, the size and rule, the bend table, and the DXF, CSV and JSON buttons |
| `sheet-dxf-options` | The Flat pattern DXF dialog with version, units, layers, layer names, bend lines, tangent lines, bend notes and note height |

All four build the part from the `sheetTray` helper: 100 x 60 of 2 mm stock, a 4 mm round corner relief, four 15 mm
edge flanges and a hem on the first leg's tip. If the kernel refuses that hem on a leg, the two flat-pattern shots fail
with it, and the chapter's worked example needs the hem moved to a free edge.
