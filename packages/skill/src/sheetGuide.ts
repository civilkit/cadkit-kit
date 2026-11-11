// The sheet metal chapter of the agent guide (the MCP `docs { names: ['guide'] }`, ck://docs/guide, llms.txt) and of the sheet_reference tool.
// Facts checked against the kernel's docs/sheet-metal.md; the numbers in the worked example are the kernel's (a kernel test builds this very tray).
// To extend: when the kernel gains a feature (panel tree, corner shapes, convert-to-sheet, cut across bends, corner round / chamfer), move its line
// from "Coming" to the recipe or the feature list and give it an entry in packages/script/src/sheetCatalog.ts.

export const SHEET_RECIPE = `Sheet metal recipe: rules -> base flange -> flanges / hems -> flat pattern -> DXF

1. run_script: define the stock, draw ONE closed outline, make the base flange, then flange the edges.
   Edges are picked by a WORLD point on them (rect(100, 60) on 'front' is centred on the origin: edges at x = +-50, y = +-30; z = the thickness is the cap face, z = 0 the front face).

   part('Tray')
     .sheetRules({ name: 'Steel2', thickness: 2, kFactor: 0.44, bendRadius: 2 })
     .sketch('front', (s) => s.rect(100, 60))
     .baseFlange({ rule: 'Steel2' })
     .edgeFlange([[0, -30, 2], [0, 30, 2], [-50, 0, 2], [50, 0, 2]], { height: 15 });

2. sheet_info: the rule, the flat pattern after the last sheet feature (flatSize = width, length, thickness; bends with direction, angle, radius, allowance, line; bend zones) and advice on the rule. Tray above: flat 123.0478 x 83.0478 x 2, four 90 degree bends of allowance 4.5239 each.
3. facts / bodies: the folded solid (bodies lists the sheet metal summary on the base body).
4. sheet_export { format: 'dxf', path } writes the flat pattern DXF (layers CUT_OUTER, CUT_INNER, BEND_UP, BEND_DOWN; bendNotes, tangentLines, units, version options); { format: 'csv' | 'json' } returns the bend table.
5. Part of an edge, shaped legs: edgeFlange (and hem, for the first three) take start / length (mm along the picked edge from its start vertex, the outline runs counter-clockwise) or from / to (two world points on the edge, any order), relief ('none' | 'rectangular' | { width, depth }, the notch beside a partial flange), profile (the leg outline: 'sketch' = the last sketch, or { sketch: id }, or an inline loop of { line } / { arc } in the flange's own frame: v along the flange from the start of the span, h outward from the height line; circles inside a sketch outline are holes, inline holes go in holes: [{ circle: { center: [v, h], radius } }]):

   .edgeFlange([[50, 0, 2]], { height: 20, start: 20, length: 40, relief: 'rectangular' })      // 40 mm of the edge
   .sketch('front', (s) => s.rect(40, 20)).edgeFlange([[50, 0, 2]], { profile: 'sketch', from: [20, 0, 1], to: [60, 0, 1] })   // leg from a sketch (x = v, y = h)

6. Optional: add .unfold() to turn the body into the flat sheet (refold() undoes it), or .hem(...) for a 180 degree edge.

Rules of thumb
* Flat length = sum of the legs and flats + one bend allowance per bend, BA = (radius + kFactor x thickness) x angle (radians).
* heightFrom 'outer' (default) measures a flange height to the outer virtual sharp: leg = height - (radius + thickness) x tan(angle / 2). The height must reach the end of the bend (flangeHeightTooLow).
* A flange may cover part of an edge (start / length or from / to); the edge is then split in pieces and a later pick names the piece it is nearest to, so give later flanges from / to. A span must lie inside one free piece of the edge. With a profile the height is the top of the outline (leave height out), the outline must reach down to the bend line (the part below the end of the bend is the bend), and from / to must run along the edge's direction (counter-clockwise outline) or the outline comes out mirrored and fails with 'the profile does not reach beyond the bend': swap from and to and mirror it. A hole is listed once: a sketch's own inner loops already are holes. A hem takes start / from / to and relief, not length (its length is the hem's size).
* One flange per edge. Folds, flanges and hems combine in any order (panel tree); pick a flange edge on a leg with 'P2.tip' or { edge, panel }. Holes and slots go in with sheetCut (sketch in the flat layout, works across bends); a plain cut or hole breaks the sheet. Corners: sheetCorner round / chamfer; reliefs: cornerReliefShape notch | round | rectangular | tear on the rule. A solid bent plate becomes a sheet with sheetConvert.
* Keep bendRadius >= thickness and reliefWidth >= thickness: smaller values build, but crack in real stock (sheet_info reports them as advice).
* Picks by role ({ role: 'P0.side.e2' }) follow the sketch curve when the outline changes; points do not.`;

export const SHEET_COMING = `Limits (not in the kernel yet, do not script them): flanges on curved edges (a base outline with arcs takes flanges on its straight edges), relief shapes other than a rectangle for partial flanges, arcs or several chains in a contour flange, a zig-zag fold chain on a concave base, sheetCorner across bends, sheetConvert of cones, tori or free-form bends, sheetCut that splits a panel. sheet_reference lists the status of every feature.`;

export const SHEET_GUIDE = `## Sheet metal

Sheet metal parts are ordinary script features: sheetRules (stock), baseFlange or contourFlange (first plate) or sheetConvert (from a solid), edgeFlange, hem, fold, sheetCut, sheetCorner, then unfold / refold. The flat pattern, bend table and DXF are results of those features, read with sheet_info and sheet_export. sheet_reference { feature } documents each feature with defaults and units. A sheet feature error carries the kernel code (flangeHeightTooLow, invalidValue with a field, sheetMetalUnsupported, nothingToCut) and a repair hint.

${SHEET_RECIPE}

${SHEET_COMING}
`;
