# Changelog

Versions follow `MAJOR.MINOR.PATCH`; the live site's `version.json` carries the commit it was built from. Dates are when the change went live.

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
