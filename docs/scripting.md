# Scripting

A short TypeScript/JavaScript script builds a normal, editable feature tree. Open the **Script** tab in the left panel, write or pick an example, press **Run** (Ctrl/Cmd+Enter). Running always creates a NEW untitled part (the unsaved-changes guard asks first); the script text is stored in the document (`script` field), so reopening the file shows it again. Package: `packages/script` (`@kit/script`).

## API

```js
const { w, h } = variables({ w: 60, h: 40, t: 12 });   // named values; strings are expressions over earlier ones
part('Bracket')                                          // the script must build one part (the last one wins)
  .sketch('front', (s) => s.rect(w, h))                  // plane: 'front' | 'top' | 'right', or face('>Z')
  .extrude(expr('t'))                                    // expr('t') keeps the parameter linked to the variable
  .hole(face('>Z'), [-15, 0], { diameter: 8 })
  .fillet(edges('|Z'), 4);
```

Sketch builder `s`: `rect(w, h, [cx, cy])` (centred), `circle(radius, [cx, cy])` (RADIUS), `polygon(pts)` (closed), `polyline(pts)`, `line(a, b)`, `arc(centre, start, end)` (counter-clockwise), `point(at)`, `axis()`, `axisAt(from, to)` (construction line used as the revolve axis), and point arrays that make one point feature each: `points([[x, y], ...])`, `polarPoints(center, radius, n, startAngle = 0)`, `grid(origin, [dx, dy], [nx, ny])`.

Part methods (each adds one feature, in order):

| Call | Feature |
| --- | --- |
| `.sketch(plane, fn, name?)` | sketch |
| `.extrude(depth, {direction, mid, flip, draft, thin})` | extrude (add) of the last sketch |
| `.cut(depth \| through(), {direction = 'auto', ...})` | extrude (cut) of the last sketch |
| `.revolve(angle = 360, {op, thin, axis})` | revolve about the sketch's Y axis (a construction line is added), or `axis: {from: [x0, y0], to: [x1, y1]}`, any line in the sketch plane (e.g. a cone about an offset axis) |
| `.thin(t)` | makes the previous extrude / revolve thin-walled |
| `.hole(face, [x, y], {diameter, depth?})` | sketch with a point + simple hole (through unless `depth`) |
| `.fillet(edges, r \| {radius: r \| r[] \| {key: r}, variable: [near, far]})`, `.chamfer(edges, d \| {distance, distance2?, angle?})` | fillet / chamfer (per-edge radii become one fillet per distinct radius) |
| `.holes.polar(face, {center, radius, count, startAngle = 0}, {diameter, depth?})` | ONE hole feature at `count` points on a circle (sketch-plane coordinates) |
| `.holes.grid(face, {origin, pitch: [dx, dy], count: [nx, ny]}, {diameter, depth?})` | ONE hole feature at a grid of points |
| `.holes.points(face, [[x, y], ...], {diameter, depth?})` | ONE hole feature at the listed points |
| `.shell(face \| faces, t)` | shell, the face(s) are opened |
| `.linearPattern([seed,] {count, spacing \| totalLength, direction, second})` | pattern of the last feature (or `seed`: handle, id, 'last', array) along x / y / z; `second` makes a 2D grid |
| `.circularPattern([seed,] {count, axis, angle \| total, equalSpacing})` | pattern about a world axis through the origin |
| `.workplane(base, offset, {rotate})` | a reference plane feature of its own (see Workplanes) |
| `.handle()` | a handle on the feature recorded last (for `{of}` and patterns) |
| `await .volume() / .area() / .bbox() / .centreOfMass() / .faceCount() / .edgeCount() / .isValid() / .issues() / .faces() / .edges()` | read-back (see Reading results back) |
| `.expectVolume(v, {tol \| abs})`, `.expectValid()`, `.expectBBox({min,max,size})`, `.expectFaceCount(n)` | assertions that add an error with the script line |

Values are numbers or `expr('w*2')` (an expression over the variables; it is stored as `=w*2` in the feature, and `variables` become the document's variables, so they stay editable in the Variables tab). Inside a sketch an `expr` contributes its current number only.

## Selectors

Resolved when the script runs, against the body as it is just BEFORE that step.

### Faces

* `face(sel, {of})`: ONE face.
  * Direction: `'>X' '<X' '>Y' '<Y' '>Z' '<Z'` (`'#top'` = `'>Z'`): the planar face whose outward normal is that axis and which lies furthest along it (ties: the biggest).
  * Name: `'F3.C1'` (cap 1 of feature F3), `'F3.S.e2'` (the side made by sketch entity e2), `'F8.C0@F10.1'` (a copy made by pattern F10). Persistent across edits that keep the feature; `'F3.*'` is a prefix. List the names with `await part.faces()`.
  * Rule object (keys AND together): `dir`, `normal: [x,y,z]` (planar faces facing that way), `planar: true|false`, `at: [x,y,z]` (planar: the point lies on its plane; curved: centroid within `within`, default 1), `kind: 'plane'|'cylinder'|'sphere'|'other'`, `radius` (cylinder / sphere, 0.2 percent), `createdBy` / `of` (feature), `areaGreater`, `areaLess`, `near: [x,y,z]` (+ `within`; alone it keeps the nearest face), and `not`, `union`, `intersect`, `difference` of other `face()` / `faces()` selectors, exactly as for `edges()` rules. A rule must match ONE face, or the run stops with `Line N: face(...) matches 6 faces (...)`.
  * `{of: handle | 'F2'}` restricts any of these to the faces one feature created. Take a handle with `const boss = part.handle()` right after the feature.
* `faces(sel, {of})`: every match (same specs). Use it for `shell(faces(...), t)`, `edges({onFace: faces(...)})`, or choose one with `.nth(i)` (position in the body's face list), `.largest()`, `.smallest()`, `.first()`, `.last()`, `.near([x,y,z])`, each of which returns a `face()`.
* **Ambiguity warning.** After a boss or a pocket several planar faces face the same way (the plate top and the boss top both face +Z). `face('>Z')` still returns the furthest one (the boss top) and the run result gets a warning on that line: `face('>Z') resolved to F4.C1 (feature F4, the furthest along Z); other faces point the same way: F2.C1 (feature F2); use {of: ...} or a face name to choose`. It is only given when the candidates belong to different features. `result.warnings` is `[{line, message}]`; the agent layer returns them as `warnings` (code `scriptWarning`), the Script tab shows them as notices. Warnings never stop a run.

### Edges

* `edges(sel)`: `'all'`; `'|X' '|Y' '|Z'` straight edges parallel to the axis; `'>X' … '<Z'` edges lying in the extreme plane along that axis.
* `edges(rule)`: a rule object; keys AND together. `parallel: 'X'|'Y'|'Z'` (straight edges), `outside: [[x0,y0,z0],[x1,y1,z1]]` / `inside: box` (edge midpoint outside / inside the box), `not: edges(...)`, `onFace: face(...) | faces(...)`, `createdBy: handle | 'F4'` (edges that bound a face that feature created), `lengthGreater: n`, `lengthLess: n`, `near: [x,y,z], within: r` (midpoint within r), and set operators `union: [edges(...), ...]`, `intersect: [...]`, `difference: [a, b, ...]` (a minus the others). Rules nest, e.g. `edges({ parallel: 'Z', outside: [[0,-99,-99],[99,99,99]] })` or `edges({ not: edges('|X') })`.

An unsupported selector, or one that matches nothing, gives `Line N: ...` in the error list; clicking it selects that line.

## Sketch planes and cut direction

Frames as the kernel reports them (`sketches[i].frame`), also readable in a script as `plane('top')` → `{origin, x, y, normal, toWorld([u, v], offset)}`:

| plane | sketch x is world | sketch y is world | normal (extrude direction) |
| --- | --- | --- | --- |
| `'front'` | +X | +Y | +Z |
| `'top'` | +X | **-Z** | +Y |
| `'right'` | **-Z** | +Y | +X |

So on `'top'` a point at sketch y = 10 is at world z = -10 (toward the back); Y is up. A sketch on a face has its normal pointing OUT of the body.

`extrude` goes ALONG the sketch normal, `cut` goes AGAINST it (into the body from a face sketch). `direction` states it relative to the normal, for both:

| `direction` | meaning |
| --- | --- |
| `'away'` | along the normal (extrude default) |
| `'into'` | against the normal (cut default in the kernel) |
| `'both'` | symmetric about the sketch plane, `depth` is the total (the kernel's `mid` / `throughBoth`) |
| `'auto'` | cuts only, and the default: try `'into'`; if the kernel answers `cutNoEffect` (the body is on the other side, e.g. a front-plane sketch at z = 0 under a +Z body) flip once and add the warning `cut direction flipped automatically` |

`flip: true` and `mid: true` still work and switch auto off. State the direction yourself in hot paths: the automatic retry costs an extra build.

## Reading results back

A script can read the part as built so far and assert on it:

```js
const p = part('Plate').sketch('front', (s) => s.rect(60, 40)).extrude(10).hole(face('>Z'), [0, 0], { diameter: 8 });
const v = await p.volume();              // number, mm3
const box = await p.bbox();              // {min, max, size}
const bores = (await p.faces()).filter((f) => f.kind === 'cylinder');   // [{name, kind, area, normal, center, radius, feature}]
p.expectVolume(60 * 40 * 10 - Math.PI * 16 * 10, { tol: 1e-6 })         // no await: an assertion step
 .expectValid().expectBBox({ size: [60, 40, 10] }).expectFaceCount(7);
```

* Accessors (all `await`): `volume() area() bbox() centreOfMass() faceCount() edgeCount() isValid() issues() faces() edges()`. `faces()` areas and surface kinds are the kernel's exact values; `edges()` gives the keys the per-edge `fillet` form takes.
* A script that uses `await` runs as an async function (top-level `await` is allowed). The runner builds everything recorded so far on the scratch kernel when the read is reached, answers, and the script goes on recording. Only await the read-backs.
* **Cost.** Every read forces a regeneration of ALL features recorded so far (a headless build; a view build for bbox / faces / counts) plus a kernel query. Results are cached until the next feature is added, so several reads in a row cost one build. Read once after a group of features; never inside a loop that adds features.
* `expectVolume(v, {tol = 1e-3 | abs})`, `expectValid()`, `expectBBox({min, max, size}, {tol = 1e-3})`, `expectFaceCount(n)` are steps like any other (no await). A failure is an error `{line, message}` (`Line 4: expected volume 25000 (tolerance 0.025), got 24000`), the run goes on, and the agent layer does not replace the open document when the run has errors.
* Step accounting: every read or expect is a step (label `read ...` / `expect ...`) that adds no feature, so `ops`, ids and progress counts are those of the features only.

## Patterns, fillets, workplanes

* `linearPattern([seed,] {count, spacing | totalLength, direction, reverse, second})`: `seed` is `'last'` (default), a handle, a feature id or an array of them (several features patterned together). `direction` is `'x'|'y'|'z'`, a vector or a straight edge, and must be parallel to a world axis. `second: {direction, count, spacing | totalLength}` makes a rectangular grid (a pattern of a pattern, seeded with the originals plus the first pattern: a pattern alone does not contain its own original: to pattern a pattern yourself pass `[original, patternHandle]`).
* `circularPattern([seed,] {count, axis, angle | total = 360, equalSpacing, reverse})`: `axis` is `'x'|'y'|'z'`, `[ox,oy,oz,dx,dy,dz]` or a straight edge, and must be a world axis through the origin. `equalSpacing` (default for 360) steps `angle / count`; false steps `angle / (count - 1)`.
* `fillet(edges, {radius: 3 | [r per selected edge] | {[edge key]: r, '*': default}, variable: [near, far]})`: unequal radii become one fillet feature per distinct radius (increasing), i.e. sequential blends. `chamfer(edges, {distance, distance2})` / `{distance, angle}` emit the kernel's distanceDistance / angleDistance chamfers.
* Workplanes: `at(base, offset = 0, {rotate: {axis, angle}, flip})` with `base` = `'front'|'top'|'right'` (moved along +Z / +Y / +X), `face(...)` (the face's plane, offset along its OUTWARD normal), a plane handle (`part.workplane(...)` then `part.handle()`), or `{origin: [x,y,z], normal: [x,y,z], xdir?}`. `rotate.axis` is `'x'|'y'|'z'` or an `edges(...)` selector; the plane passes through the axis line (an `offset` is applied first). `part.workplane(base, offset, opts)` adds the plane as a feature of its own.

### What the kernel does not do (and how the script behaves)

| Wish | Kernel | Script |
| --- | --- | --- |
| pattern along an oblique vector / edge | patterns follow world x, y, z only | `Line N` error naming the limit; rotate the part or use `holes.points` |
| circular pattern about an offset or oblique axis | axis must be a world axis through the origin (an offset origin is silently ignored) | `Line N` error; use `holes.polar` for a bolt circle anywhere |
| chamfer with two distances or distance + angle | `unsupported` today (only equal distance) | emitted as the kernel's features; the run reports the kernel's `unsupported` error. Cut the bevel instead |
| one fillet feature with different radii | one `radius` per fillet; `filletType: 'variable'` takes `radii: [near, far]` for ALL its edges | per-edge radii become sequential fillets; `variable` works on isolated edges (junctions give `blendFailed`) |
| plane from a point and a normal | no such mode | axis-aligned normals use an offset standard plane; others add helper sketch points + a three-point plane (up to 7 features) |
| patterns of patterns | supported | the 2D grid uses it |
| face selection by cone / torus kind | the display-mesh fit knows plane, cylinder, sphere only | `kind: 'other'` for the rest in selectors; `part.faces()` reports the kernel's exact `cone` / `torus` |

## Result and errors

`runScript(code, host)` returns `{ ops, document, errors, warnings }`: `ops` are the `EditOp`s applied, `document` the recorded document (with `script`), `errors` a list of `{ line, message, feature? }`, `warnings` a list of `{ line, message }` (ambiguous face selections, a cut direction flipped automatically). A thrown error, a bad selector or a kernel rejection stops the run at that line; features that were kept but failed to regenerate are listed and the run continues. `host` is `{ load(doc), edit(ops), geometry(), build?(doc, view), release?(), facts?(need) }` (the app passes the Controller): `build` gives the batched run, `facts` ({mass, validate, describe}) answers the read-backs.

## Limits and safety

* The code runs in `new Function` with only the API names in scope; `window`, `document`, `fetch`, `Function`, timers etc. are shadowed with `undefined`, loops are fuel-limited (100000 turns), source is limited to 20000 characters and 500 steps. This stops accidents, it is NOT a security boundary against hostile scripts (e.g. `(()=>{}).constructor`); do not run untrusted scripts. A Worker would be the next step.
* Line numbers come from the V8 stack (Chrome, Edge, Node); in other engines errors may show line 0.
* Not supported yet: draft, rib, threads, assemblies, sketch constraints (sketches are unconstrained geometry). Sweep, loft, mirror and spline entities are covered by other helpers where present (see the method registry).
* Hole direction: the hole drills into the material from the selected face; use `flip: true` if a hole on an unusual face cuts the wrong way.

## Examples

```js
// bracket
const { w, h } = variables({ w: 60, h: 40, t: 12 });
part('Bracket').sketch('front', (s) => s.rect(w, h)).extrude(expr('t'))
  .hole(face('>Z'), [-15, 0], { diameter: 8 }).hole(face('>Z'), [15, 0], { diameter: 8 })
  .fillet(edges('|Z'), 4);

// flanged cylinder (revolve)
part('Flanged cylinder')
  .sketch('front', (s) => s.polygon([[10, 0], [25, 0], [25, 6], [15, 6], [15, 30], [10, 30]]))
  .revolve(360);

// thin-walled box
part('Thin box').sketch('front', (s) => s.rect(50, 30)).extrude(20).shell(face('>Z'), 2);
```

## BenchCAD examples

Five parts of the BenchCAD library (CC-BY-4.0, BenchCAD, arXiv 2605.10865; the scripts are our own translations, not copies of the dataset programs) are in the Script tab's example list (`bc-*` in `packages/script/src/examples.ts`) and checked against the dataset's reference volume on the real kernel by `packages/script/src/benchcad.kernel.test.ts` (tolerance 1e-3).

| Part | Features used | Script lines | Reference volume (mm3) | Our volume | Relative error |
| --- | --- | --- | --- | --- | --- |
| pulley_000030 | revolve of a polygon | 10 | 315628.4374 | 315628.4374 | 1.5e-10 |
| washer_000001 | extrude, hole, chamfer on a face's edges | 7 | 11087.95596 | 11087.95596 | 1.0e-10 |
| hex_nut_000006 | computed polygon, sketch on a face, through cut | 8 | 45.891956 | 45.891964 | 1.7e-7 |
| enclosure_000042 | mid-plane extrude, shell, fillet | 7 | 100770.1092 | 100770.1092 | 2.1e-10 |
| motor_end_cap_000242 | face sketches, cut, chamfer, fillet, circular pattern (x2) | 16 | 245873.6614 | 245880.6963 | 2.9e-5 |

Notes: the 'top' sketch plane extrudes along +Y, so the face on top of a 'top' sketch is `face('>Y')` (the 'front' plane extrudes along Z). A workplane offset was not needed: the motor end cap sketches on the face of the disc instead. The 2.9e-5 on the end cap (7 mm3) was not chased; the other four match to 1e-7 or better.

```js
// BenchCAD pulley_000030
const { bore, rim, flange, w, gw } = variables({ bore: 17.5, rim: 62.4, flange: 70, w: 12.6, gw: 5 });
part('Pulley')
  .sketch('right', (s) => s.polygon([[bore, -w], [rim, -w], [rim, -gw], [flange, -gw], [flange, gw], [rim, gw], [rim, w], [bore, w]]))
  .revolve(360);
```

The other four are in the example list.

## Design: MCP tool `run_script` (not implemented here)

For the agent interface (`packages/mcp` of the kernel repo): `run_script({ session_id?, code })` evaluates the same script text with the same `evaluate()` / step compiler, but with the kernel `Session` as the host (`load` = open a session on the recorded base document, `edit` = `session.edit`, `geometry` = `bodyForView()` plus the edge/face enrichment the viewer does). It returns `{ ok, features, errors: [{ line, feature, message }], volume }`. The compiler lives in `@kit/script` and has no DOM dependency, so it can be moved or published as a separate package; only `geometry()` needs the face/edge enrichment (`faces`/`mid` on edges) that the viewer's Controller currently produces and that would need to be factored out of the app.
