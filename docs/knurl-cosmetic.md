# Cosmetic knurls

A cosmetic knurl is drawn, not cut. It exists for diamond and pyramid patterns, whose real cut takes 4 to 30 s and fails with
`booleanBudgetExceeded` when dense. Real cuts are the default of the script helper; the wizard starts cosmetic.

* Script: `part.knurl({ ..., mode: 'cosmetic' })`. Default mode is `'cut'`. Same options as the real cut (`count` or `pitch`, `depth`,
  `profile`, `helixAngle`, `ringPitch`, band `from`..`to`). No feature is added; volume, faces and validity are those of the plain cylinder.
  The overlap and crossing limits of the real cut do not apply (they are checked when you convert).
* Wizard: "Cosmetic (instant)" is on by default for every pattern (instant at any density, display only: the solid, mass and exports are unchanged); untick it for a real cut that changes the solid, and it stays where you put it while you change the pattern. Reopening a knurl keeps its own form.
  The preview is the same shading and needs no rebuild.
* Stored in the document as the top-level field `cosmeticKnurls`: an array of records with every number resolved
  (`axis, center, radius, from, to, pattern, count, depth, profile, angle, width, helixAngle, ringPitch`). The kernel keeps the
  field without reading it. The wizard writes it with `Controller.setUndoableExtra` (one undo step, no rebuild, ordered with the
  session's own steps); a script writes it through the run. Save, load, undo and redo carry it.
* Viewport: `packages/viewport/src/knurlview.ts`. A hook on the body material finds the points on each record's cylinder and bends
  the normal as the grooves would (a bump from the pattern's formula, sharp at any zoom) and darkens the groove floors. Grooves
  under a pixel fade out. Up to 4 per body. The record matches by geometry (axis, radius, band), not by face name, so it keeps
  working when feature ids change; a record whose cylinder is gone draws nothing. An exploded view moves the mesh but not the
  shading, so a knurl on an exploded component is not placed correctly.
* Export: STEP, STL, OBJ and the folder exports (STEP, STL, frozen part file) bake the records into real cuts in a scratch copy of the document
  (`bakedDoc` in `apps/cad/src/exportKnurl.ts`: the records are removed and the cuts `cosmeticToCutOps` makes are appended) and export the copy; the
  open document, its history and its undo stack are untouched. Setting `cad.exportPrefs.knurl`: `on` (default), `ask`, `off`. A cut that fails or
  runs past 120 s is never written silently: the app offers the plain export or Cancel. `off` keeps the plain solid and a warning toast with a
  button "Convert to real cut" (clears the records and commits the cuts, two undo steps). A folder export cuts only the records whose cylinder
  (same radius, face area covering the band) is on a body of the folder. STL and OBJ with hidden bodies keep the plain solid and the warning.
  Mass properties, the check panel and drawings also see the plain cylinder.
