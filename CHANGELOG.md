# Changelog

Versions follow `MAJOR.MINOR.PATCH`; the live site's `version.json` carries the commit it was built from. Dates are when the change went live.

## Unreleased

### Added
- **Printed-thread clearance.** A modeled thread has a Print clearance row (None / Wider / Narrower with a millimetre value, 0.2 by default) that writes a signed `clearance` on the thread feature (Wider positive). The kit stores and edits it; the kernel has to read the field before the helix changes. The metric table already has M3.5, M7, M33 and M39 with their ISO 261 coarse pitches; a test now pins every size of the table.
- **Import offers a Z-up view only when it is clear.** A STEP or SolidWorks part whose flat area facing down Z is at least 1.5 times the larger flat area facing down or up Y (faces within 10 degrees) gets a notice with "Use Z up"; a Y-up, round or ambiguous part gets nothing. Nothing is rotated.
- **Quick measurement.** Select an edge, face or two items and their size shows in the corner of the view: edge length; round edge diameter, radius and circumference; face area; two items distance and angle; more than two the count and total. It reads the same numbers as the Measure tool and hides while that tool is on.
- **Export only visible bodies**: a checkbox in the Export menu leaves hidden bodies out of STL and OBJ files. STEP still includes every body (a notice says so).
- **Repeat last command** in the command search and the Edit group runs the command run before it again.
- **Sketch dimensions: a slot's two end caps measure its overall length** (Dimension tool: click one cap arc, then the other; the label shows the overall length, the kernel keeps the centre distance that gives it). **A dimension between two points picks horizontal, vertical or aligned from the pointer**: above or below the points' box is horizontal, beside it vertical, anywhere else aligned; H, V and A still force one.
- **Sketch: Alt makes a rectangle a square** (corner and centre rectangle: both sides take the longer pointer offset, or a typed side). **Curves and points named by a conflicting constraint turn red at once**, with or without "Colour by definition".
- **Sketch: a circle or arc dimension switches between radius and diameter** (right-click the dimension; an expression keeps driving the same size), **`name = value` in a dimension or tool value box defines a parameter** (a new variable, or the existing one given the new value; a dimension is then linked to it), and **right-click a dimension to delete it**.
- **Bearing wizard and `bearing()` script helper.** Catalog > Primitives > Generators > Bearing (or command search): pick a size by designation (608, 6204, MR63, R2) from the nominal ISO 15 table (miniature 6xx, MR, 60xx, 62xx, 63xx and inch sizes, including the 1/8 inch bore R2) or type bore, outer diameter and width; sides open (balls visible), shielded 2Z or sealed 2RS; chamfers on all four corners of each ring; live preview. Each ring and ball is its own body, so the bearing can be assembled. A housing-seat read-out gives the pocket diameter (H7, nominal or 0.2 mm printed clearance) and depth; with a flat face selected the bearing sits in that face and the pocket can be cut. Script: `bearing({ designation: '608', seal: '2RS', origin, axis })` and `part.bearing(...)`, the `seat` option cuts the same pocket, and a Bearings example is in the Script tab. The races are plain cylinders (no ball grooves, no cage), for assemblies, fit checks and looks. `docs/llms.txt` and the method registry list the new helper.
- **MCP: complete method registry, guide and `llms.txt`.** `list_methods` / `docs` read the registry generated from the script JSDoc, so every method `run_script` accepts is documented (appearance, bodyName, group, handle, sweep, workplane, insertPart, `s.arc3`, `s.rrect`, `s.text`, array seeds ...); a test walks the recorder classes. `ck://docs/guide` is a full guide and `docs/llms.txt` (also `ck://llms.txt`) adds the method index.
- **MCP `bodies` tool** (name, creating feature, volume, bbox, colour per body) and **`drawing` tool** (views, dimensions, hole callouts, section, SVG / PDF / DXF from the app's drawing layer).
- **`newBody: true | 'Name'`** on extrude, revolve and sweep keeps a solid separate instead of fusing it. `run_script` warns when one cut changed several bodies.
- `appearance({ feature })` on a pattern also styles the seed's body.
- **Bodies: Appearance applies to every selected body.** Colour, opacity and finish edited in the Bodies panel go to the whole selection (an unselected body is edited alone).

### Fixed
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
