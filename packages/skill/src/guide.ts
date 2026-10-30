// The long-form guide an LLM reads first (the MCP resource ck://docs/guide, and the head of docs/llms.txt). Facts here are checked
// against the recorder and the kernel; the per-method detail lives in registry.generated.json (docs / list_methods tools).

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
* \`sweep(profile, path)\`: both are \`{ on, draw }\` objects; the profile plane must be perpendicular to the path where the path starts; paths are planar sketches (a vertical plane per path for 3D routings).
* Two solids that touch or overlap FUSE into one body. Keep them apart with \`newBody\`: \`extrude(10, { newBody: true })\` or \`{ newBody: 'Magnet' }\` (also revolve and sweep, never for a cut). Use \`bodies\` to confirm the body count; a clearance of 0.1 mm also keeps parts separate.

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
3. Check: \`facts\` (volume, bbox, solids, validity; pass \`expect\` for pass/fail checks), \`bodies\` (one row per body: name, creating feature, volume, bbox, colour), \`probe\` (is there material at a point), \`section\` / \`sections\` (exact slices), \`tree\`.
4. Look: \`snapshot { view: 'iso' | 'front' | 'top' | ... }\`; with \`section\` for an internal view, \`sheet\` for a multi-view sheet. For a real engineering drawing (dimensions, hole callouts, sections, PDF/SVG/DXF) use \`drawing\`.
5. \`checkpoint\` before a risky change, \`undo\` / \`restore\` after. Use \`mode: 'attach'\` to ADD to what the user has built by hand (their features are kept).
6. Export with \`export { format: 'step' | 'stl' | 'glb' | 'ckpart', path }\`. For a \`.ckpart\` that opens at once in the app, add \`cache: true\`: the built view is stored in the file (refused with \`view_unavailable\` for a part with a curated or embedded font (text in the built-in fonts is fine), or a rolled-back part).

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

## Performance

A part with many hundred features regenerates in seconds. Patterns of bodies are the heavy part; prefer one \`hole\` feature with many points (\`holes.polar\`) over a loop of \`hole()\` calls.
`;
