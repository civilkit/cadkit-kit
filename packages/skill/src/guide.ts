// The long-form guide an LLM reads first (the MCP resource ck://docs/guide, and the head of docs/llms.txt). Facts here are checked
// against the recorder and the kernel; the per-method detail lives in registry.generated.json (docs / list_methods tools).

import { SHEET_GUIDE } from './sheetGuide';

export const GUIDE = `# CadKit script API: guide for LLM agents

CadKit builds parametric solids from a short JavaScript script. Every call on the part chain adds ONE normal feature (sketch, extrude, cut, hole, fillet, pattern ...) to a history tree; the kernel regenerates it and returns exact numbers. You never write geometry kernel calls: you write \`part('Name').sketch(...).extrude(...)\`, run it with \`run_script\`, and then PROVE the result with \`facts\`, \`bodies\`, \`probe\`, \`section(s)\` and \`snapshot\`.

## Units and conventions

* Millimetres and degrees. Y is up. Right-handed axes.
* \`circle(r)\` takes a RADIUS, \`hole()\` and \`holes.*\` take a DIAMETER.
* A script builds ONE part: \`part(name)\` then a chain. Each extrude / cut / revolve CONSUMES the sketch just before it (sketch again for the next feature).
* \`variables({ w: 60, t: 'w/10' })\` declares named values (strings are expressions); \`expr('w*2')\` keeps a feature parameter linked to them.

## Sketch planes and their frames (this is where most mistakes happen)

| plane | sketch x (u) | sketch y (v) | normal | extrude goes |
| --- | --- | --- | --- | --- |
| \`'front'\` | world +X | world +Y | +Z | +Z |
| \`'top'\` | world +X | world -Z | +Y | +Y |
| \`'right'\` | world -Z | world +Y | +X | +X |

So on 'top' a larger sketch y moves towards the BACK (world -Z); on 'right' a larger sketch x moves towards world -Z. \`plane('top').toWorld([u, v], offset)\` gives the world point.

* \`at('front', 20)\` is the plane moved 20 mm along its normal (top along +Y, right along +X); \`at(face('>Z'), 5)\` offsets a planar face along its outward normal.
* \`sketch(face('>Z'), ...)\`: the sketch origin is the world origin projected on that face; u/v follow the face's own frame. Hole centres are [u, v] in that frame.
* Any plane: \`at({ origin: [x, y, z], normal: [nx, ny, nz], xdir: [dx, dy, dz] })\` (or \`part.workplane(...)\` for a plane feature of its own). Frame: the sketch origin is \`origin\`; sketch x (u) = xdir projected perpendicular to the normal; sketch y (v) = normal x u. Example: normal [1,0,0], xdir [0,0,1] gives u = +Z, v = X x Z = -Y. GIVE xdir whenever the orientation matters. Without xdir an axis-aligned normal is the standard plane of that axis (frames above), an oblique normal gets u = normal x [1,0,0].
* A tilt about a world axis: \`at('front', 10, { rotate: { axis: 'x', angle: 30 } })\`.

## Extrude, cut, revolve, sweep

* \`extrude(d)\` goes ALONG the sketch normal; \`direction: 'into' | 'away' | 'both'\`, \`mid: true\` (symmetric, d is the total), \`draft\`, \`thin\`. A sketch on a face adds material outward (a boss).
* \`cut(d)\` / \`cut(through())\` removes material. Default direction 'auto': it tries against the sketch normal (into the body from a face sketch) and flips once if the kernel says cutNoEffect (the run then carries the warning 'cut direction flipped automatically'). Say \`direction: 'into' | 'away' | 'both'\` to skip the retry.
* A cut applies to EVERY body that exists when it runs. A through-cut for the base plate's holes also slits an earlier body that crosses it. Build later parts after the cut, or leave clearance. The run warns when one cut changed several bodies.
* \`revolve(360)\`: the sketch must be the HALF profile on one side of the axis (x = distance from the axis, y = height; the axis is the sketch y axis unless \`axis: { from, to }\`). Drawing both sides gives profileCrossesAxis.
* \`sweep(profile, path)\`: both are \`{ on, draw }\` objects; the profile plane must be perpendicular to the path where the path starts; paths are planar sketches (a vertical plane per path for 3D routings). The path can be a helix: \`p.helix({ radius, pitch, revolutions }); const h = p.handle(); p.sweep(profile, { curve: h })\`. \`guides: [{ on, draw }]\` (one or two sketches, each ONE curve touching the profile and running along the path) with \`guideMode: 'scale' | 'turn' | 'stretch'\` makes the section follow the guides (a flare, a taper); no \`twist\` with guides.
* Two solids that touch or overlap FUSE into one body. Keep them apart with \`newBody\`: \`extrude(10, { newBody: true })\` or \`{ newBody: 'Magnet' }\` (also revolve and sweep, never for a cut). Use \`bodies\` to confirm the body count; a clearance of 0.1 mm also keeps parts separate.

## Direct edits and body operations

* \`draft(faces, angle, { neutral })\` tapers walls about a neutral plane ('front' | 'top' | 'right', \`at(...)\`, \`face(...)\`; its normal is the pull direction, \`flip\` reverses). \`moveFace(faces, { distance })\` pushes or pulls faces along their normals; \`{ translate: [x, y, z] }\` moves planar faces.
* \`lip(rim, edges, { width, height })\` raises a band on a planar rim; \`groove(...)\` cuts the same band into a rim (a lid). \`rim\` is \`face(...)\`, \`edges\` the rim edges (\`edges({ onFace: rim })\` also picks the inner rim edges of a shell: exclude them with \`not\`).
* Bodies: \`scale(factor | [sx, sy, sz], { about: 'origin' | 'centroid', at, bodies })\`; \`moveBody(bodies, { translate, rotate: { axis, origin, angle }, copy, body, mirror })\` (rotation first, then translation; bodies are not united afterwards); \`split(target, tools)\` cuts a body into the part outside and the part inside the tool bodies; \`deleteBody(bodies, { keep })\` takes names, handles or \`face(...)\`. Bodies are named with \`newBody: 'Name'\`.
* \`deleteFace(faces)\` turns the solid into a sheet without those faces. It does NOT heal the gap (the kernel has no heal mode yet); use it to open a shell for surface work, not to remove a hole.
* \`sphere(radius, { centre, op, newBody })\` needs no sketch. \`helix({ radius, pitch | height | revolutions (two of them), on })\` adds a curve only. \`axis('y')\` / \`axis(edges(...))\` / \`axis(face(cylinder))\` / \`axis(planeA, planeB)\` adds a reference axis feature (take its \`handle()\`). \`dome\` is not built in the kernel; do not try it through \`feature()\`.

* Parts from the wizards are their own bodies, placed by \`origin\` and \`axis\`: \`nut({ size: 'M5', type })\`, \`standoff({ size, length, kind, ends })\`, \`heatSetInsert({ size, hole })\`, \`spring({ outer, wire, length, coils, ends: 'ground' })\`, \`extensionSpring(...)\`, \`torsionSpring(...)\`, \`caseBox({ width, depth, height, lidHeight })\` (a closed two-part case, stands up from \`origin\`), plus \`screw\`, \`washer\` and \`bearing\`. \`docs({ names })\` lists the options of each.

## Handles, bodies, names, appearance

* \`const h = part.handle()\` right AFTER a feature returns a handle on that feature. Use it in \`face('>Z', { of: h })\`, \`faces({ createdBy: h })\`, patterns (\`linearPattern(h, ...)\`, \`circularPattern([h1, h2], ...)\`: the seed may be 'last', a handle, an id like 'F7', or an ARRAY), \`appearance\` and \`bodyName\`.
* A body (a connected lump) is identified by the feature that created it. \`bodyName(h, 'Rotor')\` names it (a pattern's bodies are numbered 'Rotor 1', 'Rotor 2').
* \`appearance({ feature: h, colour: '#b87333', opacity: 0.2, finish: 'plastic' })\` styles the bodies a feature created. finish is 'matte' | 'plastic' | 'chrome' | 'glass' | 'brushed'; 'brushed' and 'chrome' are metallic and make colours read grey, so use 'plastic' or 'matte' for coloured parts. A pattern's appearance also covers the seed's body. \`{ face: 'F3.C1' }\` / \`{ face: 'F3.*' }\` / \`{ face: handle }\` styles single faces. Appearance is view state (no geometry, no undo step); a .ckpart keeps it and STEP does not.
* \`group('Name', () => { ... })\` (or \`part.group\`) puts the features it records in a named folder of the tree.
* \`insertPart(doc, { at, fixed, name })\` inserts another part's document as a component; \`mate(...)\` positions it.

## Holes

Use hole FEATURES (\`hole\`, \`holes.points\`, \`holes.polar\`, \`holes.grid\`) for anything that should be a hole: the drawing layer lists callouts such as "M2.5 TAPPED DEPTH 2" only for real hole features, not for a sketch circle plus a cut.

## Workflow

1. \`list_methods { query }\` / \`docs { names }\`: read the exact signatures of what you use. Do not guess option names.
2. \`run_script { mode: 'new', code }\`. It is atomic: an error leaves the document unchanged and names the line (and the kernel code with a repair hint).
3. Check: \`facts\` (volume, bbox, solids, validity; pass \`expect\` for pass/fail checks), \`bodies\` (one row per body: name, creating feature, volume, bbox, colour), \`probe\` (is there material at a point), \`section\` / \`sections\` (exact slices), \`tree\`. Numeric design questions have their own read-only tools: \`measure { a, b }\` (distance and closest points between bodies, faces, edges, points), \`clearance { required }\` (gap between two bodies, pass or fail), \`interference\` (do bodies overlap, by how many mm3; a part that must stay separate needs \`newBody\`), \`thickness { min }\` (thinnest wall and where), \`draft { pull, min }\` (draft angle per face against a pull direction) and \`dfm { process: 'injection' | 'cnc' | 'printing' }\` (design-for-manufacture issues per rule, with faces and numbers). Bodies are named as \`bodies\` lists them; each result gives a verdict, so use them to check your own work instead of estimating.
4. Look: \`snapshot { view: 'iso' | 'front' | 'top' | ... }\`; with \`section\` for an internal view, \`sheet\` for a multi-view sheet. For a real engineering drawing (dimensions, hole callouts, sections, PDF/SVG/DXF) use \`drawing\`.
5. \`checkpoint\` before a risky change, \`undo\` / \`restore\` after. Use \`mode: 'attach'\` to ADD to what the user has built by hand (their features are kept).
6. Export with \`export { format: 'step' | 'stl' | 'glb' | 'ckpart', path }\`. For a \`.ckpart\` that opens at once in the app, add \`cache: true\`: the built view is stored in the file (refused with \`view_unavailable\` for a part with a curated or embedded font (text in the built-in fonts is fine), or a rolled-back part).

${SHEET_GUIDE}
## Worked example: a bracket with a rib

\`\`\`js
part('Clevis')
  .sketch('top', (s) => s.rrect(140, 90, 8)).extrude(12)
  .holes.points(face('>Y'), [[-55, -30], [55, -30], [-55, 30], [55, 30]], { diameter: 10 })
  .sketch('front', (s) => s.rect(30, 79, [15, 45.5])).extrude(60, { mid: true })   // block
  .sketch('front', (s) => s.circle(25, [15, 85])).extrude(60, { mid: true })       // boss
  .sketch('front', (s) => s.line([-50, 12], [-5, 70])).rib(15)                     // rib: ONE open line
  .sketch('front', (s) => s.circle(15, [15, 85])).cut(through(), { direction: 'both' }); // bore
\`\`\`

Volume 335157 mm3, one valid body. The rib is ONE open line, centred on the sketch plane, 15 total thickness, extended past both ends until it meets the body and fused. The web stops at the outer wall of the body and never fills a bore, so the rib may come before or after the bore. Options: \`.rib(15, { fillet: 3, draft: 2, side: 'right', target: 'Bracket' })\` rounds the free edge (radius below half the thickness), tapers the two sides (degrees, one straight line only), puts all the thickness on one side of the sketch plane ('left' | 'right', default 'both') and grows to the named body only. Gotchas: a through cut from a sketch on the mid-plane needs \`direction: 'both'\` (the run warns when it is left out); a closed triangle in rib gives ribNeedsOpenSketch, and extruding one open line gives noClosedProfile (use \`rib\` for a web, \`thin\` for a thin wall).

## Worked example: a two-part case

\`\`\`js
part('Case')
  .sketch('front', (s) => s.rect(80, 50)).extrude(30)
  .feature({ type: 'shell', faces: [], thickness: 2 })                  // no open face: a closed cavity
  .lipJoint(at('front', 15), { height: 1.5, width: 1, clearance: 0.2, names: ['Base', 'Lid'] });
\`\`\`

Two valid bodies, Base (14930 mm3) and Lid (13952.24 mm3); total 29104 + 378 - 599.76 = 28882.24 (box + tongue - groove). The tongue is 1 mm wide and 1.5 mm high, centred in the 2 mm wall; the groove is 0.2 mm wider on each side and 0.2 mm deeper. \`split(plane, { names })\` alone cuts a body into two named bodies. A mould is: \`scale\` the part body by 1/(1-shrinkage), a block as \`newBody\`, \`combine('cut', block, part, { keepTools: true })\`, then \`split(plane, { target: block })\`. Not yet: draft, a curved or stepped parting surface, undercut detection.

## Common errors and what to do

| code | meaning | fix |
| --- | --- | --- |
| cutNoEffect | the cut tool does not overlap the material | check the plane frame (table above) and the sketch coordinates; use \`direction\`; a sketch circle outside the body misses in BOTH directions |
| nothingToCut | a cut ran with no body yet | build the base solid first |
| profileCrossesAxis | revolve profile lies on both sides of the axis | draw half of the profile, from the axis outwards |
| sweepProfileNotNormal | profile plane is not perpendicular to the path start | sketch the profile on the plane the path leaves at right angles |
| booleanFailed | the union / cut could not be completed | move the tool by 0.01 mm, avoid coincident faces, unite touching bodies first |
| unsupported selector / Line N | a face()/edges() selector found nothing | selectors resolve against the body just before that step; print \`tree\` and use \`find\` for names |
| unknown method | not in the API | \`list_methods { query }\` |
| flangeHeightTooLow | a sheet flange is shorter than its bend | raise the height (the error gives minHeight) or reduce radius / angle |
| invalidValue (field) | a sheet feature value or pick is wrong | the hint names the field; edges are world points on the base outline |
| sheetMetalUnsupported | a sheet case the kernel does not build yet | the hint says what to reorder (flange before cuts, fold before flanges) |

## Performance

A part with many hundred features regenerates in seconds. Patterns of bodies are the heavy part; prefer one \`hole\` feature with many points (\`holes.polar\`) over a loop of \`hole()\` calls.
`;
