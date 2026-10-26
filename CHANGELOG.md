# Changelog

Versions follow `MAJOR.MINOR.PATCH`; the live site's `version.json` carries the commit it was built from. Dates are when the change went live.

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
