# Cosmetic knurls

A cosmetic knurl is drawn, not cut. It exists for diamond and pyramid patterns, whose real cut takes 4 to 30 s and fails with
`booleanBudgetExceeded` when dense. Real cuts are the default.

* Script: `part.knurl({ ..., mode: 'cosmetic' })`. Default mode is `'cut'`. Same options as the real cut (`count` or `pitch`, `depth`,
  `profile`, `helixAngle`, `ringPitch`, band `from`..`to`). No feature is added; volume, faces and validity are those of the plain cylinder.
  The overlap and crossing limits of the real cut do not apply (they are checked when you convert).
* Wizard: "Cosmetic (instant)" is off by default (a diamond or pyramid is built as a real faceted cut in seconds, and a cosmetic knurl is missing from exports); tick it for instant display at any density, and it stays where you put it.
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
* Export: STL, OBJ and STEP contain the plain solid. When the part has cosmetic knurls the export still runs, and a warning toast
  says so with a button "Convert to real cut". Convert clears the records and commits the cuts (two undo steps); export again
  to include them. Mass properties, the check panel and drawings also see the plain cylinder.
