# Report: the guide work after the audit

What was left unfinished at the handover, what I finished, and what a reader should not yet trust. Branch `docs-mimo`,
base commit `e034c6f` (the task's last commit). This report covers Task A: the nine shot definitions the pages ask for.
The statement-by-statement check of the prose is in the [review](review.md).

## Pages changed since the audit

The audit is the [audit page](audit.md), committed at `65f3e90`. Three commits then changed the guide (`git diff --stat
65f3e90..e034c6f`): 11 files, +247 / -14.

| Commit | Page | Change |
| --- | --- | --- |
| `0bdaffb` | `modelling/curves.md` (new), `SUMMARY.md`, `modelling/surfaces.md`, `reference/commands.md` | The Curves on faces page (Project curve, Edit curve, Freeform) and the corrections that point at it; two command-table rows |
| `5c2693c` | `files/import.md`, `library/wizards.md`, `reference/commands.md` | The import report with Repair; the Screws section; Screw, Bearing and Knurl in the Create table |
| `e034c6f` | `analysis/measure.md`, `getting-started/interface.md`, `modelling/bodies.md`, `modelling/history.md`, `modelling/surfaces.md`, `reference/commands.md`, `reference/limits.md` | The quick readout; the tool rail; Cut from; Repeat last command; variable thickness; the 3MF and import limits |

Every one of these pages cites an image that did not exist. That was the handover: the prose was written, the shots
were not.

## Shots defined

Nine images are referenced by the pages above; all nine are now in `tools/doc_shots_defs.mjs` (appended to `SHOTS`, in
the order below) and in `guide/screenshots.json`. Eight produce a PNG; `freeform-editor` is skipped (next section).

| Shot | Page that shows it | How the shot reaches the state |
| --- | --- | --- |
| `cut-from` | `modelling/bodies.md:61` | A plate (add) and a block (New body, `body: 'Block'`), then a cut extruded from the block's top face with `target: [{ body: 'Block' }]`, opened from its tree row. The editor's Operation shows Cut and its Cut from group lists *All bodies the shape reaches* plus Block, ticked. |
| `edit-curve-editor` | `modelling/curves.md:38` | A plate, an offset reference plane 2 mm above its top face, a two-line chain sketched on that plane, and an `editCurve` over the two sketch curves with one control-point edit. Opened from the Edit curve row. |
| `project-curve-editor` | `modelling/curves.md:18` | The kernel test's own document (`curveCommands.kernel.test.ts:11-26`): a plate and a two-line sketch on the front plane, projected onto the plate's top face `F2.C1` with degree 3 and both-ways direction. Opened from the Project curve row. |
| `freeform-editor` | `modelling/curves.md:7` | **Skipped** — see below. |
| `quick-measure` | `analysis/measure.md:63` | A plate with a through hole; front view and Fit put the hole's rim around the view centre, edge mode is on, and a pointer ray from the centre finds the rim through the status bar's `.st-hover`, then clicks it. The clip is the bottom-right corner of `#vp`, where the card sits. The shot fails over to a skip if the card does not say *Circumference*. |
| `repeat-last` | `modelling/history.md:107` | The tutorial plate with a fillet applied through the editor (the same clicks as `first-part-finished`), then the pointer rests on the Home > Edit group's *Repeat last command* button with `keepPointer` so the hover survives the capture. |
| `thicken-variable` | `modelling/surfaces.md:78` | A wavy open spline extruded 10 mm as a sheet, then a `thicken` with thickness 4 and `thicknessAt: { along: [0,0,1], stops: [[0,4],[10,2]] }`, opened from its row. The Thickness section shows Variable thickness ticked, Ramp along Z axis and the two stops. |
| `tool-rail` | `getting-started/interface.md:94` | The `plasticity` workspace (ribbon off, tool rail on), then the Create section's Extrude cell triangle (`More tools like Extrude`) opens the flyout. The clip covers the rail and the flyout. |
| `wizard-screw` | `library/wizards.md:276` | The Catalog's Primitives tab, the Generators block's Screw button, and the wizard's defaults (M3, 8 mm, pan head, cross drive, origin 0,0,0, shank down -Z) preview on the top plane; Fit frames it. |

All shots use only the helpers the script already has (`open`, `editRow`, `find`, `click`, `fillField`, `key`, `rect`,
`canvasRect`, `page.mouse`, `page.eval`, `settle`, `skip`). `page.eval` is already used by `display-menu` and
`expression-field`.

## Shots skipped

`freeform-editor` cannot be shown, and `guide/SHOTS_TODO.md` records why. In short: the caption needs "the face rebuilt
as a net with a control point lifted". The kernel does produce the net (a Freeform marker's `faces[0].net` has 25 points,
`apps/cad/src/curveCommands.kernel.test.ts:147-149`), but the viewport never draws `ViewBody.markers` — the field is
declared at `packages/viewport/src/viewport.ts:59` and nothing reads it. `docs/surfaces-tools.md:67-68` says the same
("freeform control-net handles ... no UI yet"). The shot stays in `SHOTS` and calls `c.skip(...)`, so a run reports SKIP
rather than FAIL.

The caption is still in `guide/screenshots.json` (the task asked for all nine names there), so that one entry has no
`freeform-editor.png` behind it until the viewport draws the net. `guide/SHOTS_TODO.md` says so in the same words.

## Claims I could not verify from the code

These are about the new shot definitions, not about the guide prose (that is the [review](review.md)). The task forbade running the
app, a browser or mdBook, so nothing below was seen on screen.

1. **Every clip and camera position.** The `{x,y,w,h}` rectangles follow the existing shots, not a measurement of the
   new panels. A wrong clip is cosmetic; a wrong `editRow` name fails loudly.
2. **The cut needs `flip: true`.** The code and tests say a cut from a face sketch runs along the face's outward normal
   unless flipped (`apps/cad/src/editorFixes.ts:60,67-70`; `optionRules.kernel.test.ts:39-40`). I set `flip: true` in
   both new cut features, but whether the pocket of `cut-from` removes material (rather than missing) depends on the
   kernel, which I did not run.
3. **Face names.** `F2.C1` / `F4.C1` as the top cap of an extrusion from the front plane is the naming every earlier
   shot relies on (`boxWithCircle`, `bracketDoc`, `reference-plane`), not something the app documents. If the names
   moved, the sketches land on a missing plane and the shots fail.
4. **The thicken ramp covers the sheet.** The stops 0..10 are meant to span the sheet's 0..10 mm along Z, and the
   editor refuses stops that do not cover it (`doc_shots_defs.mjs` note; `surfaceRules.ts:71-112`). That the built sheet
   really spans exactly 0..10 along Z is my reading of `surfaceExtrude` + `blind`, not a measurement.
5. **The quick readout's ray.** The scan assumes the hole is at the view centre after Fit and that the rim is the first
   edge met along +x. It depends on the face frame's origin and the fit margin, neither of which I could check without
   the app. The shot checks the card's text for *Circumference* and skips instead of saving a wrong picture, so a
   failure here is honest but the image would still be missing.
6. **`Repeat last command` is enabled after a fillet.** The button's `enabled` reads the module-level last command
   (`apps/cad/src/commands.ts:210-218`), and the Fillet button click sets it; the Confirm tick is not a command. `c.key('e')`
   does run a command (`sel-edge`), but it comes before the fillet, so the fillet is the last one run. Whether any other
   helper in the sequence dispatches a command (a view or a mode) I could not see without the browser.
7. **The rail flyout's label.** `More tools like Extrude` is `ui.slot.more` with the slot's first label
   (`packages/ui/src/Slot.tsx:190`, `packages/ui/src/locales/en.ts:137`); that the rail's Create cell has two items and
   therefore a triangle follows from `toolbarModel.ts:10`. The flyout's direction and the clip are guesses.
8. **The screw preview's framing.** The wizard defaults are code (`screw.ts:26`), and `openScrew` switches the left tab
   to Editor (`main.tsx:3219-3226`), but whether `z` (Fit) frames the preview rather than the empty part box is not
   something I could see.
9. **`screenshots.json` is not consumed by any script.** A search finds no reader, so the entries are a caption list
   only; adding the nine names cannot break a build.

To render them, after a pages build:

```sh
WASM_SRC=<ck_wasm.wasm> CK_REBUILD=<kernel checkout> PAGES_OUT=dist-docshots PAGES_SKIP_LEAKCHECK=1 npm run build:pages
node tools/doc_shots.mjs --out guide/src/img --only cut-from,edit-curve-editor,project-curve-editor,freeform-editor,quick-measure,repeat-last,thicken-variable,tool-rail,wizard-screw
```
