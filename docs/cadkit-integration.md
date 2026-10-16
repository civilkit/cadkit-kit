# cadkit: DWG / DXF / DGN reading for the CAD app and CivilKit

Decision (user, 2026-10-16): adopt cadkit (github.com/TNYCL/cadkit, MIT OR Apache-2.0) for both the CAD app and CivilKit.

## What it is

Pure-Rust, clean-room reader for DWG (AC1014 to AC1032), DXF (R12 to 2018), DGN V7 and V8, CityGML 2.0, into one neutral
`Document` model (entities, layers, blocks, units, warnings). Writes DXF, SVG, JSON, seed-based DGN V8 and CityGML.
Packages: npm `cadkit-wasm` (browser and Node), PyPI `pycadkit`, Rust crate `cadkit`, CLI, C API. 0.x: minor releases may
change the API, so pin an exact version. Provenance ledger (docs/PROVENANCE.md in their repo): public ODA DWG spec,
MIT code (ACadSharp, GDAL dgnlib, ezdxf), public Autodesk DXF reference; GPL/LGPL code and vendor SDKs excluded.

## Spike results (2026-10-16, pycadkit, local files, nothing installed in either repo)

| File | Format | Result |
|---|---|---|
| steel section drawing | DWG, mm | one closed polyline with bulge arcs: a clean sketch profile |
| garden shed | DWG, mm | 3 block inserts, 3 texts |
| a project drawing (6.9 MB) | DWG, mm | lines, polylines, arcs, 195 `3DSOLID` entities reported as Unknown with a warning, parsed in 0.03 s |
| building floor plan | DWG, inch | 2254 entities (mostly solid hatches made of line loops), 25 layers; coordinates around 7e7 inch: needs recentring |
| 11 DWG files in total | AC1014 to AC1032 | all read, 0.00 to 0.15 s each, none failed |
| smalltest, knot_oob (GDAL test data) | DGN V7 | circle, polyline, line, text; unknown element reported as a warning; units unitless |
| test_dgnv8 (GDAL test data) | DGN V8, metres | 35 entities: degree-3 B-splines with knots, 3D points and lines, text (Unicode, fonts), text-node group |

Not covered: 3D solids (ACIS), real civil DGN from Bentley tools (none freely available: needs client files), large DGN.

## Plan for the CAD app (kit)

1. Add `cadkit-wasm` (exact version pinned) to the kit; THIRD_PARTY entry (kernel repo has the file) with the licence and the provenance note.
2. File picker accepts `.dwg .dxf .dgn`; read in a Worker (parse is fast but files can be large); show a dialog: layers (checkboxes with counts),
   units (detected, overridable), a recentre option (move the extent centre or the first point to the origin: needed for real-world
   coordinates), a scale option, and the target (new sketch on the Top/Front/Right plane, or one sketch per layer).
3. Map entities to sketch entities: line, arc, circle, ellipse (as spline or kernel ellipse), polyline with bulges (lines + arcs), spline
   (B-spline with knots to our cvspline/spline), hatch loops (as closed profiles when asked), text and dimensions as annotations
   (optional), block inserts expanded (with scale and rotation), 3D entities skipped with a notice that lists what was skipped.
   Gaps and zero-length lines cleaned; closed loops detected so the result extrudes.
4. Replace or complement the existing DXF importer (`apps/cad/src/dxfSketch.ts`) after comparing both on the same files.
5. Tests: the three DGN samples above and the steel section as fixtures (public GDAL test files are MIT; the steel section is the user's own drawing: keep it out of the repo unless cleared).
6. Effort: 3 to 5 days.

## Plan for CivilKit (separate repo and session: hand-off, nothing changed there)

- Use cadkit for DGN and DWG reading (the main value is Bentley DGN, which AutoCAD cannot open), through `cadkit-wasm` in the browser studio or `pycadkit` / the Rust crate in a backend tool.
- Map the neutral entities to CivilKit geometry: levels/layers to CivilKit layers, lines/polylines/arcs/splines to the member and
  alignment geometry the studio already uses, text to labels; honour units (`meters_per_unit`) and recentre.
- First task: a spike that runs real client DGN/DWG files through cadkit and lists the entity mix and the warnings (private files stay on the machine).
- Risks: the project is 0.x and two weeks old, entity coverage still growing (their README), no DWG writer; DGN V8 writing needs a seed file and covers a subset.
- Provenance: tell cadkit's maintainers if we find format bugs; pin versions; keep a corpus of our own anonymised test files.
