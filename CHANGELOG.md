# Changelog

Versions follow `MAJOR.MINOR.PATCH`; the live site's `version.json` carries the commit it was built from. Dates are when the change went live.

## Unreleased

### Added
- **BLDC motor samples: 5010 outrunner and 2804 gimbal.** Two more bundled samples, own models with typical catalogue dimensions: a 5010 outrunner (50 mm stator, 56 mm can, 6 mm shaft, 25 x 25 mm M4 mount; `SIZE` 5010 of the outrunner script, `EXPLODE` 20) and a 2804 gimbal motor (28 mm, hollow 4 mm shaft, thin leads, no prop hub; `EXPLODE` 10). The parametric scripts are in `docs/examples/` (`motor-outrunner.script.ts` gained the 5010 row, `motor-gimbal-2804.script.ts` is new). Bundled in the app only, not on the public pages.
- **BLDC motor samples.** Three bundled samples, own models with typical catalogue dimensions: outrunner drone motors 2212 and 2306 and a 2430 inrunner. The Variables panel gives the exploded view (`EXPLODE` 14, or 11 for the 2430), the four mounting screws (`SCREWS` 1) and the lettering switch (`LETTERS` 0). The parametric scripts they are built from are in `docs/examples/` (`motor-outrunner.script.ts` with a size table, `motor-inrunner-2430.script.ts`). Bundled in the app only, not on the public pages.
- **Target body for Add and Cut, and the maker of each body in the Bodies list.** Once a part names a body, the Extrude editor shows a Target body control for Add and Cut: Automatic keeps the old behaviour (every body the shape reaches) and a named body aims the operation at that body alone, the others stay as they are (an extrude's `target` field, `{ "body": "name" }`; a name no body has is refused). Each row of the Bodies list now says which feature made the body.
- **Live parameters keep `min`, `max`, `pow`, `mod`, `round` and the other functions.** The expression grammar of a part gained `min`, `max`, `pow`, `mod`, `hypot`, `atan2`, `asin`, `acos`, `atan`, `round`, `floor`, `ceil`, `trunc`, `exp`, `ln` and `log10` (called as `name(...)`, with a comma between arguments), and an imported SolidCraft file whose parameters use them now stays live instead of keeping the number. Expressions that were valid read as before, and a variable may still be called `max` or `round`.
- **SolidCraft import keeps parameters live.** The named parameters of a converted file used to be evaluated once and their names dropped. They now arrive as the part's variables, and an extrude depth, a hole diameter or depth, a fillet radius, a chamfer or shell thickness, a sphere radius, a cylinder height, a revolve angle, a sweep twist, a pattern spacing or a sketch dimension that is written over them stays an expression: change a variable and the part follows. An expression the part cannot hold (functions beyond `sqrt`, `sin`, `cos`, `tan` and `abs`, or a parameter whose name the part cannot take) stays the number it evaluates to, and the import row says so.
- **SolidCraft import: parameter expressions with functions, powers and units.** A file whose parameters use `sqrt`, `sin`, `cos`, `min`, `max`, `pow`, `mod`, `round` and the like, a power (`a ^ 2`), `pi`, or a unit other than mm (`2 cm`, `1 in`, `0.5 rad`) was refused as a whole ("a parameter cannot be evaluated"). Such expressions are now evaluated: lengths are converted to millimetres and angles to degrees, trigonometric functions take degrees and the inverse ones return degrees. `log` and `sign` are still refused, because their base and their value at zero are not stated in the format.
- **SolidCraft import: symmetric, two-sided and tapered extrudes.** A symmetric extent (the total distance centred on the sketch plane, or through all) became an unsupported row, a taper was dropped without a word (the section came out straight), and a start from a face and an end offset from a face were ignored. A symmetric extent is now an extrude centred on the sketch plane, a second distance runs both distances from one extrude, a positive taper grows the section along the travel and a negative one shrinks it, a start from a face moves the profile to that face, and an end at a face works on a tilted sketch plane too. A taper combined with a symmetric or two-sided extent, an end offset from a face, and a second distance in the older per-side convention are reported on their row.
- **SolidCraft import: regions chosen by their whole outlines, and revolves about any axis.** Extrudes, revolves and sheet bases that name their regions by whole outer and hole outlines are carried (one curve of each outline picks the region; holes stay holes). A revolve about a line of its own sketch or a line in space that lies in the sketch plane, and a symmetric revolve, are carried; before, only the two sketch axes were.
- **SolidCraft import: sweeps along lines and arcs, lofts to a point and along rails.** A sweep along a path of lines and arcs in a planar sketch is carried, with its twist (the path sketch may draw other curves too: only the path's own are used). A profile kept at a fixed angle, an end scale and a guide rail on a sweep are reported instead of being dropped. A loft whose last or first section is a point (a cone or a pyramid) is carried, and so are up to two guide rails on a loft; a loft section that uses only some regions of its sketch is reported, where it used to take the whole sketch.
- **SolidCraft import: holes up to a face, circular patterns of features, mirrors of bodies, tori, sheet bases, ellipses and more constraints.** A hole drilled up to a face is a blind hole as deep as that face is far. A circular pattern of features about a coordinate axis through the origin is carried; a mirror of whole bodies (kept apart or united) too; a mirror and a pattern can seed one another. A torus, an ellipse in a sketch and a sheet-metal base flange (as a plate of the sheet thickness) are carried, and so are the parallel, perpendicular, equal, point-to-line distance and fixed-point constraints of a sketch.
- **SolidCraft import: sub-assemblies, hidden placements and timeline folders.** A component placed inside another component is inserted into that component's part and moves with it (it was placed from the design's origin, so a part inside a moved sub-assembly stood in the wrong place). A placement the file hides has its bodies hidden here too, which matters most for a part converted with its editable history kept hidden beside its final shape: the history no longer overlaps the shape. The timeline folders of the file become tree folders.
- **MCP `export` writes the stored view: `cache: true` on a `.ckpart`.** The file gets the same `viewCache` field as Save geometry in file, so the app shows the part at once on open. The view is built from the Session's regen reply by code now shared with the app (`@kit/viewdata`: view builder, key, codec). Refused with `view_unavailable`, writing nothing, for a curated or embedded font (text in the built-in fonts is cached), a rolled-back part, or a kernel whose wasm cannot be hashed. **The app says why it ignores a stored view**: edited part, different kernel build, unknown format version or unreadable field (no notice when the file has none).
- **Bearing rings have a ball groove.** Both rings of the Bearing wizard and `bearing()` now carry a real raceway: a circular arc in the section, centred on the ball circle at mid-width, slightly larger than the ball (radius 0.52 ball diameters) and 0.27 ball diameters deep, so the balls sit in it and the rings stand thicker at their sides, as in a deep-groove bearing. The groove is a true arc, so the faces stay clean for picking and sectioning, in open, shielded and sealed bearings alike. A bearing too small for a groove (a ring thinner than 0.4 mm under it, a narrow ring, or balls much smaller than the gap) keeps plain races. Outer diameter, bore and width are unchanged; ring volume and mass now include the groove.
- **A SolidWorks part opens as an editable body.** A `.sldprt` file used to appear as a view-only solid. The kernel reads the solid exactly (of 45 test parts 43 open, and wherever SolidWorks' own STEP of the part exists the volume agrees within 0.5% and the box is the same), and the app now writes that solid out as STEP, checks that a part built from it has the volume of the solid that was read, and opens the part with the body as its first feature, so it can be cut, drilled, filleted, measured and saved with the part. When the part cannot be built (the STEP cannot be written or the volume differs) the solid is shown view-only as before, with the old notice. The design history of the file is still not read.
- **A SolidCraft file converted from SolidWorks stands the way SolidWorks has it.** The importer turns every point of a file from Z up to this kit's Y up, but SolidWorks already is Y up with the front plane XY (as the `.sldprt` import and the `.ckpart` Dutchman writes keep it), so a converted part lay on its side (a bolt along +Y came out along -Z). The original solid a converted file keeps names the file it came from; when that is a `.sldprt` or `.sldasm`, nothing is turned: points, planes, directions and the original solid stay where the file has them, and the "(Y up)" turn is not added. Files from other programs are turned as before. The choice travels with each import, so imports can run side by side.
- **SolidCraft import checks the original solid of a converted file before it uses it.** A file converted from SolidWorks (or any program whose STEP the converter restates itself) keeps the original solid as STEP, and the converter can write some faces of it turned the other way: the kernel's importStep message repairs that, a part's importStep feature does not, so the same text gave a body of the wrong volume (a 10 mm cube shell came out at 859 mm3 instead of 424 mm3). The importer now asks the kernel to read the text both ways and, when they differ, uses the kernel's own healed STEP of it (the text is left alone when both agree, as for Fusion 360 files); a text the kernel cannot read is reported on the row and the sketches and operations are still carried. The same step checks a file that keeps its original solid *and* builds a body from sketches and operations: when the operations do not rebuild the stored solid (volume off by more than 0.5%, or errors), the stored solid is the body, the operations that build bodies are skipped with both volumes in the row, and the sketches stay.
- **A wizard's result lands in the feature tree as one folder named after the wizard.** Bearing, Screw, Knurl (cut and faceted forms), Propeller, Marine propeller, Turbo impeller and Gear (and Gear pair, mating gear included) stamp the cosmetic `group` on everything they add, through one shared helper (`wizardGroup.ts`), so the result can be hidden, shown, dragged or deleted as a unit (right-click the folder > Delete deletes exactly its features; a feature outside it that still uses one is handled by the usual dependency check). A second result gets its own folder ("Bearing 2"); re-opening a propeller, impeller or gear to edit it keeps its folder, also after the user renamed it, and one made before this change stays where it is. A cosmetic knurl is not a feature and has no folder. (#32)
- **SolidCraft import: the original solid of a converted file is the body.** A file converted from another CAD system keeps its solid as a STEP body inside the archive, followed by the sketches and operations built on it. The importer now reads that STEP text and writes it into the part as an `importStep` feature (the text sits in the part's `blobs` table, named by its SHA-256, so a large file stays out of the regeneration cache keys), turned from their Z-up to this kit's Y-up. The cuts and joins after it act on the real solid instead of on nothing; before, 46 of the 48 files in the Fusion 360 test set regenerated to no body. The editor lists the feature as "Imported STEP body" and offers only the body name; the STEP data is replaced by importing again. Needs the kernel's `importStep` feature. (#29)
- **Printed-thread clearance.** A modeled thread has a Print clearance row (None / Wider / Narrower with a millimetre value, 0.2 by default) that writes a signed `clearance` on the thread feature (Wider positive). The kit stores and edits it; the kernel has to read the field before the helix changes. The metric table already has M3.5, M7, M33 and M39 with their ISO 261 coarse pitches; a test now pins every size of the table.
- **Import offers a Z-up view only when it is clear.** A STEP or SolidWorks part whose flat area facing down Z is at least 1.5 times the larger flat area facing down or up Y (faces within 10 degrees) gets a notice with "Use Z up"; a Y-up, round or ambiguous part gets nothing. Nothing is rotated.
- **Quick measurement.** Select an edge, face or two items and their size shows in the corner of the view: edge length; round edge diameter, radius and circumference; face area; two items distance and angle; more than two the count and total. It reads the same numbers as the Measure tool and hides while that tool is on.
- **Export only visible bodies**: a checkbox in the Export menu leaves hidden bodies out of STL and OBJ files. STEP still includes every body (a notice says so).
- **Repeat last command** in the command search and the Edit group runs the command run before it again.
- **Sketch dimensions: a slot's two end caps measure its overall length** (Dimension tool: click one cap arc, then the other; the label shows the overall length, the kernel keeps the centre distance that gives it). **A dimension between two points picks horizontal, vertical or aligned from the pointer**: above or below the points' box is horizontal, beside it vertical, anywhere else aligned; H, V and A still force one.
- **Sketch: Alt makes a rectangle a square** (corner and centre rectangle: both sides take the longer pointer offset, or a typed side). **Curves and points named by a conflicting constraint turn red at once**, with or without "Colour by definition".
- **Sketch: a circle or arc dimension switches between radius and diameter** (right-click the dimension; an expression keeps driving the same size), **`name = value` in a dimension or tool value box defines a parameter** (a new variable, or the existing one given the new value; a dimension is then linked to it), and **right-click a dimension to delete it**.
- **Bearing wizard and `bearing()` script helper.** Catalog > Primitives > Generators > Bearing (or command search): pick a size by designation (608, 6204, MR63, R2) from the nominal ISO 15 table (miniature 6xx, MR, 60xx, 62xx, 63xx and inch sizes, including the 1/8 inch bore R2) or type bore, outer diameter and width; sides open (balls visible), shielded 2Z or sealed 2RS; chamfers on all four corners of each ring; live preview. Each ring and ball is its own body, so the bearing can be assembled. A housing-seat read-out gives the pocket diameter (H7, nominal or 0.2 mm printed clearance) and depth; with a flat face selected the bearing sits in that face and the pocket can be cut. Script: `bearing({ designation: '608', seal: '2RS', origin, axis })` and `part.bearing(...)`, the `seat` option cuts the same pocket, and a Bearings example is in the Script tab. There is no cage, and it is for assemblies, fit checks and looks. `docs/llms.txt` and the method registry list the new helper.
- **MCP: complete method registry, guide and `llms.txt`.** `list_methods` / `docs` read the registry generated from the script JSDoc, so every method `run_script` accepts is documented (appearance, bodyName, group, handle, sweep, workplane, insertPart, `s.arc3`, `s.rrect`, `s.text`, array seeds ...); a test walks the recorder classes. `ck://docs/guide` is a full guide and `docs/llms.txt` (also `ck://llms.txt`) adds the method index.
- **MCP `bodies` tool** (name, creating feature, volume, bbox, colour per body) and **`drawing` tool** (views, dimensions, hole callouts, section, SVG / PDF / DXF from the app's drawing layer).
- **`newBody: true | 'Name'`** on extrude, revolve and sweep keeps a solid separate instead of fusing it. `run_script` warns when one cut changed several bodies.
- `appearance({ feature })` on a pattern also styles the seed's body.
- **Bodies: Appearance applies to every selected body.** Colour, opacity and finish edited in the Bodies panel go to the whole selection (an unselected body is edited alone).

### Fixed
- **A knurl cut into a cylinder keeps its distance from the end face when the part is edited.** The Knurl wizard used to write the band as fixed positions along the axis, so changing a 30 mm shaft with a band ending 5 mm from its end to 20 mm left the band past the end of the shaft, and the knurl cuts failed ("it cuts nothing"). When the cylinder has flat end faces, a cut knurl (straight grooves, and diamond or pyramid with Build set to Cut grooves) is now built from the end face nearer to its band: the sketch planes of the grooves, rings and sweeps are made from that face, so a longer or shorter shaft takes the band with it and the model keeps building at 20, 40 and 30 mm. A band near the fixed end of an extrude stays where it is. A cosmetic knurl, a faceted diamond or pyramid band (one feature with fixed numbers), a cylinder with a chamfer, fillet or cone at its end, and knurls made in earlier versions are still placed at their numbers; the wizard says so for the faceted build. In the Script tab, `knurl({ ..., onFace: { face: 'F2.C1', at: 30 } })` does the same.
- **The message for a knurl band that cuts nothing says what happened.** Instead of "it cuts nothing", the failure card now says the knurl band no longer touches the part, and for a knurl placed at fixed positions suggests undoing the change or setting the band again (Cut grooves from a selected round face keeps its distance from the end face).
- **A bearing placed on a face stays on that face when the part is edited.** The Bearing wizard used to write the position of its first face as numbers, so changing a shaft from 30 mm to 20 mm left the bearing and its housing seat at the old end ("The edit broke the model at Bearing 608 seat: it cuts nothing"). A bearing added from a selected flat face (along x, y or z) is now built from that face: the seat pocket and the rings and balls sit on planes made from the face, so a longer or shorter shaft, a thicker plate or any other edit that moves the face takes the bearing with it, and changing the length back puts it back. Moving the bearing's centre across the face keeps it attached; a bearing placed by typing its numbers, one moved deeper into the part by hand, or one on a tilted face is still built at those numbers, and so are bearings made in earlier versions (delete one and add it again from its face to attach it). In the Script tab, `bearing({ onFace: 'F2.C1', ... })` does the same.
- **The message for a bearing seat that cuts nothing says what happened.** Instead of "it cuts nothing", the failure card now says the bearing seat no longer touches the part, and that a bearing placed at a fixed position stays where it was made when the part changes: undo the change, or delete the bearing and add it again from the face.
- **A cosmetic knurl shows in the feature tree and can be reopened.** A knurl made with the wizard's Cosmetic box ticked (display only, instant) was drawn in the view but had no row anywhere: the tree said "2 features" and listed only the cylinder, so the knurl could not be found or changed. It now has a row of its own under Origin ("Cosmetic knurl 1: 30 grooves"); click it, press Enter or use its pencil to reopen the Knurl wizard on its own settings and Update to replace it. A knurl cut into the solid (grooves, or a faceted diamond or pyramid band) reopens the same way from any of its rows, and Update puts the new cut where the old one was, in the same "Knurl" folder, as one undo step. A knurl made before this release has no stored settings and stays on the ordinary feature editor. A cosmetic knurl is still not a feature, so it is not counted in the feature total, not in mass and not in exports (the export notice offers to convert it to real cuts).
- **Extruding from a face of a converted part works again.** A part converted from another CAD system keeps the original solid (named "Original (STEP)") on top of the body its history builds, and a circle sketched on a face then extruded as Cut (through all or blind) or Add was refused, or left a loose cylinder and no cube, because the two identical solids could not be told apart. An Add or Cut sketched on a face now works on the solid that owns that face when the operation with both fails (a part that built before builds the same), and the original solid is hidden when such a part is opened, so the history body is the one you see and pick; Show in the Bodies list brings it back. A cube opened from a SolidWorks file or built from sketches was never affected.
- **SolidCraft import: the sketches of a moved body no longer show where the body used to be.** The copies of a moved body's sketches (added earlier, `<sketch> (<body>)`) are now shown when a model has up to 40 of them, so the sketches you see lie on the solids; a larger model keeps them hidden like its other sketches, and the originals, which no body sits at any more, stay hidden. A join or cut that names no body now counts as part of the body it changes when only one body exists (before it got no copy and its sketch stayed behind); with two or more bodies, or an inserted part or imported solid present, it is still left alone because the kernel unites it with whichever lump it meets. On the SELENE showcase every one of 783 moved sketches has a copy on its body, and 669 originals stay hidden.
- **Extruding from a face of a converted part works again.** A part converted from another CAD system keeps the original solid (named "Original (STEP)") next to the body its history builds, and a circle sketched on a face then extruded as Cut (through all or blind) or Add was refused ("boolean volume mismatch" or a failed boolean), or left a loose cylinder and no cube. With several bodies, a Cut that fails against all of them now goes to each body in turn, the one that owns the sketch face first: a body the tool misses, or whose hole already holds the tool, is skipped, the cut is refused only when it touches no body, and a body that really fails is named in the error. An Add goes to the body that owns the sketch face. Bodies keep their names through such an edit. The original solid is hidden when such a part is opened only when the body its history rebuilds is there and has the original's volume (within 0.5%); a history that is suppressed, greyed, failed or of another size leaves the original visible, since it is the exact solid. Show in the Bodies list brings a hidden one back. A cube opened from a SolidWorks file or built from sketches was never affected.
- **A second bearing of the same size no longer breaks the model with "body name conflict".** The Bearing wizard names its bodies after the size ("Bearing 608 inner ring"), so a second 608 repeated the names. It now numbers them ("Bearing 608 2 inner ring"), taking the first number no feature uses.
- **SolidCraft import: a control-vertex spline used as a sweep path follows its B-spline.** The path was always drawn through the file's points, which for a spline marked `control: true` (every freeform spline from a Fusion 360 conversion) are the control polygon, not points on the curve. The curve is now sampled from the B-spline of the stated degree (clamped, the file's knots when given) and carried as a through-points path, with a note on the row; the kernel's sweep path takes only through-points splines. (#31)
- **SolidCraft import: a cut that selects "all" profiles of a sketch with an outline around other shapes carries a note.** The file does not name the regions, so the cut takes the whole sketch and can remove the whole body; the row now says so. Choosing the regions is the converter's job (`profiles: {type: "curves"}`). (#30)
- **SolidCraft import names imported geometry.** A file converted from another CAD system keeps the original solid as an `import` feature (a STEP body); it was reported as an unknown feature type. The row now says what it is and that only the sketches and operations around it are carried.
- **SolidCraft import carries splines in sketches.** A spline curve in a profile sketch (a file from Fusion 360 draws its freeform edges that way) was reported as an unsupported sketch curve and took its extrude with it. A fit spline becomes a through-points spline and a control-vertex spline (`control: true`) a `cvspline` of the stated degree, both closed when the file says so.
- **Importing a large SolidCraft file shows what it is doing to the end.** The progress line used to disappear when the importer returned, and then the model was rebuilt in the kernel for minutes with nothing on screen. The overlay now stays up through that step with its own line ("Building ... in the kernel"), the elapsed seconds, and no Cancel button while it cannot be stopped; the Console gets a line with the read and rebuild times.
- A part edited while it was being saved is no longer marked saved (and its autosave copy is kept): the saved state is that of the document the write began with.
- The Save As picker reopens in the folder used last (browsers that support the file picker).
- **Imported SolidCraft sketches follow their moved body.** Move, Mirror and Pattern import as `moveBody`, which moves bodies but not the sketches that built them, so a sketch stayed where it was drawn. The importer now adds, for each body that ends at another pose, a hidden copy of its sketches on a frame plane at the body's pose (named `<sketch> (<body>)`, shown from the tree). The sketch the extrude reads is unchanged. Sketches of a join or cut that names no body get no copy. (#17)
- `snapshot` with `sheet: true` or `annotate: true` crashed; `true` now means the third-angle drawing sheet and the overall bounding-box dimensions. `projection: 'orthographic' | 'perspective'` are accepted (perspective was silently ignored). The valid sheet names are listed in the tool.
- `profileCrossesAxis` and `cutNoEffect` hints say what to draw (half the profile from the axis) and print the sketch frame. PDF and DXF output print `DEPTH` for the depth glyph and keep typographic quotes.

### Changed
- **Knurl: pick the face after opening the wizard.** Opening Knurl with no round face selected used to show a red message and a dimmed button, so you had to cancel, select the face and open Knurl again. The wizard now stays open with the hint "Click a round face of the part" and fills in the cylinder when you click one in the viewport (face picking is switched on for you). A face that cannot be knurled (flat, a tilted cylinder, the wall of a hole) is refused with the reason and the wizard keeps waiting; Escape or Cancel closes it. Opening Knurl with a round face already selected works as before.
- **The Knurl wizard starts in Cosmetic (instant) mode, and its checkbox is a normal checkbox.** The wizard used to cut a real knurl unless you ticked Cosmetic. It now opens with Cosmetic (instant) ticked for every pattern: the grooves are drawn at once at any number of grooves, the solid stays a plain cylinder and mass and exports ignore them. Untick Cosmetic to make a real cut that changes the solid (the text under the box says which one you will get); the choice you make is kept while you change the pattern. Knurls in the script's `knurl()` still cut unless you ask for `mode: 'cosmetic'`. The Cosmetic checkbox also stretched across the whole control column, with a huge blue focus box; it is now a small checkbox with the ring around the box only, and the same fix applies to the Cut seat checkbox of the Bearing wizard.

## 0.4.0 - 2026-10-27

### Changed
- **Renamed to `ck`.** Parts are saved as `.ckpart` with the format name `ck-part`, the kernel crates are `ck-*`, the wasm is `ck_wasm`, the environment switches are `CK_*` (`CK_REBUILD`, `CK_WASM`) and the kit's aliases are `@ck/*`. Nothing about how a part behaves changed.
- **Old files still open.** `.ckpart` and `.ckpart.gz` open, drop and import as before, and the format names `ck-part` and `ck-part` are read and become `ck-part` in the document, so the next save writes the new names. Only the new names are written.
- A view saved inside a file by 0.3.9 or earlier is not used (it was keyed to the old kernel build anyway); the part rebuilds as usual and the next "Save geometry in file" writes a new one.
- Sample thumbnails stay current across the rename: the picture hash reads `ck-part` as the name it was made with.

## 0.3.9 - 2026-10-27

### Added
- **Geometry in the file.** More file actions > "Save geometry in file" keeps the built view inside the `.ckpart`, so opening it anywhere shows the model about a second after the drop instead of rebuilding for ~19 s (SELENE-showcase); the kernel still rebuilds behind it. The file grows (1.9 MB to 5.3 MB for SELENE, 3.5 MB with `.gz`), so it is off by default; the choice is remembered, and a file opened with its view keeps it on Save. The view is used only when the part and the kernel build match what was saved, otherwise it is ignored. See `docs/files.md`.

### Fixed
- **Save As showed no Compress box.** 0.3.6 said it did, but the checkbox was never drawn (the state and text existed, not the markup), so `.gz` could only be had by typing it into a picker. The dialog now has "Compress" and "Keep the built geometry" boxes (the dialog appears when the browser has no file picker).

## 0.3.8 - 2026-10-27

### Added
- **Scale command.** Features > Modify > Scale scales the whole part about its centre of mass (a factor of 2 to start). The options panel takes one factor, or one per axis, the point it grows from (centre of mass, the origin, or a point) and shows the bodies it acts on. Per-axis stretches stay exact for planes, cylinders and cones along their axis and B-splines; the kernel refuses (and says why) what it cannot keep exact, for example a cylinder stretched across its axis.

### Fixed
- **A file's hidden bodies no longer stretch the view.** Fit framed the box around every body, including ones the file hides (SELENE-functional's 21 track ridges are 1.5 m wide and hidden), so the rover opened small in the middle of an empty view. Fit now frames what is drawn.
- **SolidCraft import: sketches and datum planes stay out of the way.** Imported sketches and planes are hidden (shown again from the tree), as SolidCraft hides the ones its features have consumed; before, thousands of orange sketch lines and blue plane patches covered a large model.

## 0.3.7 - 2026-10-26

### Fixed
- **Big multi-body files rebuild in seconds, not minutes (kernel).** Every boolean result re-checks the volume of each face, and the table that remembers them held 8,192 faces and emptied itself when full; SELENE-functional has 12,000, so it never hit and recomputed all of them for every cut. The table now holds a quarter of a million. The whole SELENE-functional file now rebuilds in about 40 s; before, it did not finish in ten minutes.
- **SolidCraft import: features of a component that act on a transferred body now run.** A body handed to a component by a body transfer is still built where it was made, so the component's moves, scales, cuts and removes of it found "no such body" and were dropped. With both components at the identity they now run in the part that holds the body. SELENE-functional goes from about 150 unsupported rows to the 15 that need the kernel to find edges (fillets and shells), its 8 scales convert, and its Pi board gets its holes.
- **A cut that names `participants`** (not only `targets`) cuts those bodies, as SolidCraft's own evaluator does; before, such a cut was applied to everything.

## 0.3.6 - 2026-10-26

### Added
- **Compressed parts.** Save As has a "Compress" box, which saves the part as `name.ckpart.gz` (gzip). A part is very repetitive JSON: SELENE's 1.9 MB comes out at 138 KB. Opening, dropping and the recent list accept `.ckpart.gz`, and any file that starts with the gzip header is read as compressed whatever its name. Saving over an open `.gz` file keeps it compressed. Plain `.ckpart` stays the default and stays plain JSON, so other tools and diffs still work.

## 0.3.5 - 2026-10-26

### Added
- **Scale.** The kernel scales bodies about a point by one factor or one per axis (`scale`), exactly where the shape stays exact: planes, cylinders and cones stretched along their axis, free-form faces, and spheres and tori under one factor. Cases that would need an elliptic cylinder or similar are refused with a hint instead of guessed. The SolidCraft importer converts a scale of named bodies. SELENE's own 8 scales are inside components that get their bodies by a body transfer, which is not supported yet, so they are still reported as unsupported there.
- **Extrema query (kernel, for agents and tools):** the extent of a body or selection along a direction, with the extreme points and what they lie on.

### Changed
- Kernel update: large parts open and edit faster (see 0.3.2), and the gate now also runs the fillet corpus.

## 0.3.4 - 2026-10-26

### Fixed
- **The Display panel could not be scrolled to its last items.** Its height was capped as if the window had a short header, so with the full ribbon the bottom of the list (Grid, Relations, Overall size, Threads, Design issues) sat below the viewport, out of reach. The list now takes the room under its button, whatever the ribbon height, and scrolls inside it.

## 0.3.3 - 2026-10-26

### Changed
- **New defaults.** Reference planes are hidden until you switch them on (Show > Planes). A first visit now starts with the full ribbon, the left panel floating (with its Outliner / Features / Assets tabs), the inspector docked on the right, and no tool rail, selection mode bar, sketch tool palette or bottom drawer. Saved settings are untouched, and the three presets (Plasticity, Classic, Minimal) are unchanged.

## 0.3.2 - 2026-10-26

### Changed
- **Large parts open and edit much faster (kernel).** The kernel stored a snapshot of its state after every feature, which for a part with thousands of features meant copying a growing model thousands of times. A part longer than 256 features now stores about 256 evenly spaced snapshots. SELENE-showcase (4,218 features): the kernel's rebuild went from 24-39 s to about 7 s with identical output, and an edit near the end re-runs 53 features (1.3 s) instead of all of them. Parts of 256 features or fewer are unchanged.

## 0.3.1 - 2026-10-26

### Fixed
- **SolidCraft import: a profile corner on the sketch origin of a moved plane landed on the world origin.** SELENE's parabolic dish (a bowl profile on a plane at x = -190) revolved into a huge cone because its closing point went to (0, 0) instead of the plane's own origin; the same slip made `Extrude6` cut nothing and blocked five later features (6 errors, now 0). Any sketch of a file on a custom plane whose profile touches the sketch origin is affected.
- SELENE's path sketches (hose and wire routes) and coil helices are hidden on import like the other sketches and planes, instead of drawing as thin blue lines over the model.

## 0.3.0 - 2026-10-26

### Added
- **SolidCraft colours.** The importer reads each body's colour, opacity and (in newer files) its PBR values (metallic, roughness), and the bodies a file hides, and saves them in the part (`appearance`, `view`), keyed by the feature that made each body. SELENE now opens in its own colours instead of all grey, with its three hydraulic hoses hidden.
- **Metallic and roughness per body.** The Bodies panel has two sliders (Metallic, Roughness) next to Colour, Opacity and Finish. They override the finish, are saved with the part, and picking a finish or preset clears them. Not carried over: the file's index of refraction.
- **Bodies hidden by feature.** A feature id in the hidden list hides every body that feature made; showing one body keeps its siblings hidden.

### Fixed
- Bodies of an inserted component in an assembly are keyed `feature@insert` (e.g. `F2@F6`), so their colours and names no longer collide with the assembly's own feature of the same number; a component's bodies are named after the component.

## 0.2.2 - 2026-10-26

### Fixed
- **The feature tree scrolled into blank space on long parts** (SELENE, 4,218 features): the list looked for its scroll box in the wrong place once the left panel had tabs, so scrolling never loaded the rows. It now follows whichever box really scrolls.

## 0.2.1 - 2026-10-26

### Added
- **Syntax colouring in the Script box** (comments, strings, numbers, keywords, calls), in the light and dark themes.
- **Tabs can be dragged to reorder**, and a ▾ list of all open parts appears when they no longer fit (or there are many).
- **Keyboard shortcuts for tabs:** Ctrl+Tab / Ctrl+Shift+Tab step through them (also from the Script box), Ctrl+Alt+1..9 jump to one (9 is the last), Ctrl+Alt+T opens a new part, Ctrl+Alt+W closes the active one.

### Changed
- **Script panel:** the Examples list now sits on its own row above Run / Open / Save / Format, spans the panel, and has short names (it ran off the panel before); the examples added later no longer show their raw keys.
- **Switching tabs in the middle of a sketch finishes the sketch and keeps it** (as the check mark does) instead of refusing; when the sketch cannot be finished it stays open and says so.

## 0.2.0 - 2026-10-26

### Added
- **Document tabs.** Several parts open at once, as tabs under the top bar: each has its own undo history, file, unsaved-changes mark and camera. + opens a new part, × closes (a changed tab asks Save / Don't save / Cancel), opening a file or sample uses a blank tab or a new one and never asks about the part already open, and the page asks before it is left with any unsaved tab. See `docs/tabs.md`.
- **Autosave of every changed tab.** After a reload or crash the app offers to restore the session, each changed part in its own tab.

### Changed
- **Edit this part opens the component in its own tab** (linked to its assembly) instead of replacing the assembly on screen. Done writes it back as one undo step in the assembly's own history, and the assembly may now refuse a change that breaks a mate, with the part kept open.

## 0.1.5 - 2026-10-26

### Added
- **Edit this part's features from the Features tab.** The editor of a component (the pencil on its row) now has an "Edit this part's features" button; it is the same action as the ⚙ in the Assembly panel.

### Fixed
- The "A new version is available" notice moved into the top bar, next to the part name: over the viewport it covered the Start here card in a short window and the selection filter bar elsewhere.

## 0.1.4 - 2026-10-26

### Added
- **Edit a component's own features.** Each component row of an assembly has an "Edit this part" button (⚙): it opens that part with its full feature tree (the gears of the Gear train sample can be changed again), and Done writes the changes back into the assembly, keeping placement and mates. Cancel returns the assembly unchanged. See `docs/assemblies.md`.

## 0.1.3 - 2026-10-26

### Fixed
- The "A new version is available" bar: Refresh and Later did nothing, because the layer it sits in ignores the mouse and the bar did not turn that back on.

## 0.1.2 - 2026-10-26

### Added
- **SolidCraft import: sweeps along a spline and coils.** The path sketch becomes a 3D sketch holding the spline; a coil becomes a helix, the wire's section and a sweep along it (round or square wire, either hand, inside, centred or outside). SELENE's hydraulic hoses, motor leads and suspension springs now come through: the showcase file imports with no unsupported feature (2,001 converted) and imports and rebuilds in about 25 seconds.

### Known
- Rebuilding the SELENE functional file is still very slow (many minutes): the Pi 5 board has hundreds of small boxes and cylinders cut into one body and each cut gets slower. The import itself takes about 35 seconds.
- Six cuts of the showcase's clamping hubs report `cutNoEffect` in the kernel.

## 0.1.1 - 2026-10-26

### Fixed
- **Opening a big SolidCraft file looked dead.** Each fillet, chamfer or shell made the importer rebuild and validate the whole part built so far, minutes per question on a large file. It now rebuilds without meshing or validating and reuses the kernel's earlier states: the two SELENE files import in under a minute (35 s and 46 s) instead of many minutes.

### Added
- **Import progress.** A panel appears at once ("Importing X: feature n of m") with a Cancel button; an import that throws reports it; autosave waits while an import runs.

## 0.1.0 - 2026-10-25

First versioned release; this entry covers the last day of work.

### Added
- **Sphere feature.** A kernel `sphere` (centre and radius, one spherical face; add, cut or new body) with its editor and tree icon. The Catalog's solid sphere is now one row.
- **Bodies.** The Bodies panel shows the names a document gives, and offers Copy, Delete, Join, Cut and Intersect of whole bodies. Extrude, Revolve, Loft and Sweep have a New body operation with a name of its own. A failed body edit says why in words.
- **Frame planes.** A `plane` feature in `frame` mode: a plane given by an origin and two directions.
- **Installable app.** The studio installs as a PWA.
- **Stack status.** `npm run stack:status` compares the dev wasm, the built site and the live site with `main`; the pages build writes `version.json`.
- **SolidCraft import**
  - Holes (simple, drilled, counterbore, countersink, at a position or at sketch points) become our hole feature.
  - Sketches on tilted planes and cylinders along any axis import.
  - Circular patterns of bodies import as rotated copies about any axis.
  - Formats 31 to 33 read correctly: a leading `=` and decimal commas in expressions, `#n` face names, the counter of unnamed bodies, and `legacy_per_side` extents.

### Changed
- A SolidCraft body transfer that moves nothing is skipped instead of reported as unsupported.
- Kernel `ping` reports the commit the wasm was built from.

### Kernel (landed on `main` in the same period)
- Overhang-corner fillets generalise (mirror, under the ledge, two vertices; skewed corners are refused).
- Blade-fuse clips the hub-cylinder intersection to the blade rail when it overshoots.
- Read-only design-for-manufacture queries.
- Render close-up framing option.

### Known gaps in SolidCraft import
Splines, sweeps and coils; non-uniform scale; faithful body transfer (component ownership); joints are kept as a pose; tapped holes and threads.

### Gate (kernel regression suite, unchanged)
wire 280/280, valid.brep 280/319, vol.brep 319/319, mass.brep 271/319, naming.stable 214/216, step 16/21.
