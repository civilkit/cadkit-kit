# Scripting

A short JavaScript script can build a part for you: you describe sketches and features in code, press **Run**, and the app creates a normal feature tree that you can edit like any other part. This chapter covers where to write a script, what it can create, a complete example, and the limits.

Scripts are useful for parts with many repeated or computed features, for parameter studies, and for building something the same way every time.

## Write and run a script

1. Run the **Script** command (ribbon **Home** tab, **Create** group, on the button it shares with **Catalog** and **Variables**). The **Script** tab opens in the left panel.
2. Write your script in the code box, or pick one from the **Examples** list. Examples include a bracket, a flanged cylinder and a thin-walled box.
3. Choose **Run**, or press **Ctrl/Cmd+Enter** in the code box.

What happens when you run:

- A script always builds a **new** untitled part. If the part that is open has unsaved changes, the app asks what to do with them first.
- A progress bar shows "Building n / total" and the time. **Cancel** stops the run and leaves your open part untouched.
- When the run finishes, the status says "Script ran: n features". Warnings appear as notices.
- The script text is saved in the document, so reopening the file shows it in the Script tab again.

Other buttons in the Script tab:

| Button | What it does |
| --- | --- |
| **Open** | Loads a script from a `.js`, `.ts` or `.txt` file into the box. |
| **Save** | Downloads the script as a file. |
| **Format** | Tidies the indentation (**Shift+Alt+F**). It never changes what the script builds. |

A run that fails shows a red banner above the code box with the message and the line number ("Line N: message"). The banner stays until the next **Run**, the failing line is tinted in the box, and clicking the message selects that line. Opening the **Script** tab puts the cursor in the box, and the cursor returns there after a run, so what you type never reaches the viewport's single-key shortcuts. A clean run shows a green line with the number of features built, and under it one row per `expect...` check: a tick and what was checked, or a cross and the failure (which is also in the banner). Clicking a row selects its line. If the script cannot start at all (a syntax error, a name clash such as `const plane = ...`), nothing is replaced and the part that was open stays as it was.

Some names belong to the script itself and cannot be used for your own variables: `at`, `bearing`, `edges`, `expr`, `face`, `faces`, `group`, `part`, `plane`, `screw`, `through` and `variables`. Declaring one (`const plane = ...`) stops the run with a message that names the line and suggests a new name.

![The Script tab in the left panel with the bracket example in the code box and the Run button, and the resulting plate with two holes and rounded edges in the viewport.](../img/script-tab.png)

### Editing variables afterwards

If your script declares `variables`, they appear in the **Variables** tab. When you change one there and you have not edited the model by hand since the run, the app reruns the script with your values and rebuilds the part. If you have changed the model by hand, the app does not rerun and tells you: press **Run** to rebuild from the script, which replaces those changes.

## A complete example

This script builds a 60 x 40 x 12 plate with two 8 mm holes and rounded vertical edges.

```js
// plate with two holes and rounded edges
const { w, h } = variables({ w: 60, h: 40, t: 12 });
part('Bracket')
  .sketch('front', (s) => s.rect(w, h))
  .extrude(expr('t'))
  .hole(face('>Z'), [-15, 0], { diameter: 8 })
  .hole(face('>Z'), [15, 0], { diameter: 8 })
  .fillet(edges('|Z'), 4);
```

What each line does:

- `variables({...})` declares named values. They become document variables, editable in the **Variables** tab. It returns their numbers, so you can use `w` and `h` in the code.
- `part('Bracket')` starts the part. The name becomes the document name. Every script builds one part. If you write several `part(...)` calls, the last one wins.
- `.sketch('front', ...)` adds a sketch on the front plane. The function receives a sketch builder `s`.
- `.extrude(expr('t'))` extrudes the sketch. `expr('t')` keeps the depth linked to the variable `t`.
- `.hole(face('>Z'), [x, y], {...})` drills a hole in the face that points furthest toward +Z, at that position on the face.
- `.fillet(edges('|Z'), 4)` rounds the edges that run parallel to Z with a 4 mm radius.

A script must start with `part(...)`. A script that builds no part gives "the script builds no part: start with part("Name")".

## What a script can create

Each part method adds one feature, in order.

### Sketches

`part.sketch(plane, fn, name?)` takes a plane: `'front'`, `'top'` or `'right'`, a face selector such as `face('>Z')`, or an offset plane made with `at('front', 10)`.

Sketch builder methods:

| Method | Draws |
| --- | --- |
| `rect(w, h, [cx, cy])` | A rectangle, centred at `[cx, cy]`. |
| `rrect(w, h, r, [cx, cy])` | A rectangle with rounded corners. |
| `circle(radius, [cx, cy])` | A circle (the argument is the radius). |
| `polygon(points)`, `polyline(points)`, `line(a, b)` | A closed polygon, an open chain, a single line. |
| `arc(centre, start, end)`, `arc3(a, mid, b)` | An arc, counter-clockwise from start to end, or through three points. |
| `spline(points, {closed})`, `cvspline(points, {closed, degree})` | An interpolating or control-point spline. |
| `curve(fn, {from, to, count, closed})` (short names `t0`, `t1`, `n`) | A spline through a JavaScript function `t => [x, y]` sampled `count` times (default 48). With `closed: true` it is a loop that does not repeat the end point. |
| `polar(fn, {count, closed, center})` (`n` for `count`) | A polar curve: `fn(angle)` returns the radius, the angle is in radians, a full turn by default (96 points, closed). Waves, cams, petals, rounded stars. |
| `point([x, y])`, `points(list)` | Point entities, which holes use. |
| `polarPoints(centre, radius, n, startAngle)`, `grid(origin, [dx, dy], [nx, ny])` | Points on a circle or grid. |
| `axis()`, `axisAt(from, to)` | A construction line used as a revolve axis. |
| `text(string, at, options)` | Letters as closed profiles. See [Text](../sketching/text.md). |

For example, a wavy disc outline and a closed section for a loft:

```js
// radius 30 with 12 waves, 3 mm deep
part('Wavy').sketch('front', (s) => s.polar((a) => 30 + 1.5 * Math.cos(12 * a), { count: 120 })).extrude(5);

// a closed spline as a loft section, at two sizes
const wave = (r) => (s) => s.polar((a) => r * (1 - 0.1 * (1 - Math.cos(8 * a)) / 2), { count: 96 });
part('Taper').loft([{ on: at('top', 0), draw: wave(30) }, { on: at('top', 20), draw: wave(18) }], { newBody: 'Taper' });
```

The function is sampled when the script runs and the points are stored. To keep the curve as a formula the kernel refits (and that follows variables without rerunning), use `equation({ x, y, t })` instead; its formulas are text and use degrees. A polar curve takes radians, like JavaScript's `Math.sin`. (`polar(count, draw)` with a number first is the polar pattern, which repeats a drawing round a centre.)

Sketch planes use these axes:

| Plane | Sketch x is world | Sketch y is world | Extrudes toward |
| --- | --- | --- | --- |
| `'front'` | +X | +Y | +Z |
| `'top'` | +X | -Z | +Y |
| `'right'` | -Z | +Y | +X |

A sketch on a face has its normal pointing out of the body.

### Features

| Call | Feature |
| --- | --- |
| `.extrude(depth, {direction, mid, flip, draft, thin})` | Extrude (add) the last sketch. |
| `.cut(depth or through(), {direction})` | Extrude (cut). With the default `direction: 'auto'` the script tries into the part, and flips once if that cuts nothing, adding a warning. State the direction yourself to skip the retry. |
| `.revolve(angle = 360, {op, thin, axis})` | Revolve about the sketch's axis line. |
| `.thin(t)` | Makes the previous extrude or revolve thin-walled. |
| `.hole(face, [x, y], {diameter, depth, kind, ...})` | A hole. `kind` can be `'cbore'`, `'csk'` or `'tapped'`. Through unless `depth` is given. |
| `.holes.points / .polar / .grid(...)` | One hole feature at many points. |
| `.fillet(edges, radius)`, `.chamfer(edges, distance)` | Edge rounding. Different radii become one fillet per radius. |
| `.shell(face or faces, t)` | Hollow out, opening the given faces. |
| `.linearPattern({count, spacing, direction})`, `.circularPattern({count, axis, angle})`, `.pathPattern({path, count, spacing})` | Patterns of the last feature, or of seeds you name. A linear pattern's `direction` is `'x'`, `'y'`, `'z'`, any vector such as `[1, 1, 0]` (oblique is fine) or a straight edge; a circular pattern's `axis` is `'x'`, `'y'`, `'z'`, `[ox, oy, oz, dx, dy, dz]`, `{ point, dir }` or a straight edge, so a bolt circle can turn about any point. A linear pattern can use `totalLength` or `to` (a plane, face or point the last copy reaches) instead of `spacing`, and a `second` direction. A path pattern follows an open sketch. |
| `.workplane(base, offset)` | A reference plane. |
| `.loft(sections)`, `.sweep(profile, path, {guides, guideMode})`, `.mirror(plane)`, `.rib(thickness, {fillet, draft, side, target})` | Loft, sweep, mirror and rib. A rib can round its free edge (`fillet`), taper its sides (`draft`, degrees), put all its thickness on one side of the sketch plane (`side: 'left'` or `'right'`) and grow to named bodies only (`target`). A sweep path can be a helix (`{ curve: handle }`), and one or two guide curves make it taper or flare. |
| `.draft(faces, angle, {neutral})`, `.moveFace(faces, {distance})` | Taper walls about a neutral plane; push or pull faces. |
| `.lip(rim, edges, {width, height})`, `.groove(...)` | A raised band on a rim, and the groove it fits. |
| `.scale(factor, {about})`, `.moveBody(bodies, {translate, rotate, copy, mirror})` | Scale bodies; move, rotate or copy them, also as a mirror image. |
| `.split(plane, {names})`, `.split(target, tools)`, `.deleteBody(bodies)`, `.deleteFace(faces)` | Split a body at a plane (a face, a standard plane or an offset plane) into two named bodies, or by tool bodies; remove bodies, or remove faces (the solid becomes a sheet; nothing is healed). |
| `.lipJoint(plane, {height, width, clearance, tongue, names})` | Split a shelled body at a plane and give the cut a centred tongue on one half and a matching groove, wider and deeper by `clearance`, on the other. See [Cases and moulds](../modelling/cases-and-moulds.md). |
| `.sphere(radius, {centre, op})`, `.helix({radius, pitch, revolutions})`, `.axis(...)` | A ball, a helix curve, and a reference axis. |
| `.gear({module, teeth, thickness, ...})` | The gear generator. |
| `.screw(...)`, `.washer(...)`, `.nut({size, type})`, `.standoff({size, length, kind, ends})`, `.heatSetInsert({size, hole})`, `.bearing(...)` | The fastener and bearing wizards, each as its own body placed by `origin` and `axis`. See [Parametric wizards](../library/wizards.md). |
| `.spring(...)`, `.extensionSpring(...)`, `.torsionSpring(...)` | The Spring wizard's three types, each as its own body. |
| `.thread(...)` | A cosmetic or modelled thread on a hole or cylinder. |
| `.surfaceExtrude`, `.surfacePlanar`, `.surfaceLoft`, `.thicken`, `.knit` | Surface bodies. |
| `.insertPart(doc, {...})`, `.mate({...})` | Assemblies inside the part. |
| `.appearance({...})`, `.bodyName(handle, name)` | Colour, opacity, finish and body names. They add no feature and no history step. |
| `.feature(json)`, `.sketchFeature(on, {...})` | Raw features, for anything without a helper. |

Values are numbers or `expr('w*2')`, an expression over your variables stored in the feature. Inside a sketch, an `expr` contributes its current number only, so a sketch size does not follow later edits to a variable.

### Choosing faces and edges

Selectors are resolved when the script runs, against the body as it is just before that step.

- `face('>Z')` is the face pointing along that axis that lies furthest along it. Other forms: `'<X'`, `'>Y'` and so on, or a persistent name such as `'F3.C1'`. Rule objects such as `face({ normal: [0,0,1], areaGreater: 100 })` combine tests. A selector for one face must match exactly one, or the run stops with "Line N: face(...) matches 6 faces".
- `faces(...)` matches several. Use `.largest()`, `.smallest()` and `.nth(i)` to pick one.
- `edges('|Z')` is edges parallel to Z. `edges('all')`, `'>X'`, and rule objects such as `edges({ onFace: face('>Z') })` also work.
- **Order and group by position.** `edges(...)` and `faces(...)` take `.sortBy(key)` and `.groupBy(key)`, so a selection can say where something is instead of relying on a generated name. A key is `'>Z'` (highest first), `'Z'` or `'<Z'` (lowest first), likewise X and Y, a direction such as `[1, 1, 0]`, or `{ along: edges(...) }` (the distance along a straight rail edge). After `.sortBy`, `.nth(i)`, `.first(n)` and `.last(n)` count in that order (a negative `i` counts from the end): `edges('|X').sortBy('>Z').first(2)` is the two highest edges running along X. `.groupBy(key, { tol })` collects the ones at the same position (within `tol` mm, 0.001 by default) and `.first()`, `.last()`, `.nth(i)` or `.at(height)` chooses a group: `edges('all').groupBy('Z').at(12)` is every edge at height 12. Ties are broken by x, y, z, so the pick is the same after the model rebuilds.
- A face selector that resolves to the furthest of several same-facing faces gives a warning that names the candidates. Restrict it with a face name or `{of: handle}`.
- `const h = part.handle()` captures the feature just recorded, for `{of: h}` and for patterns.

### Reading results back

A script can check what it built.

```js
const p = part('Plate').sketch('front', (s) => s.rect(60, 40)).extrude(10);
const v = await p.volume();                        // mm3
p.expectVolume(60 * 40 * 10).expectValid().expectBBox({ size: [60, 40, 10] });
```

`await` reads: `volume()`, `area()`, `bbox()`, `centreOfMass()`, `inertia(density)` (mass, first moments, inertia tensor about the centre of mass and the origin, principal moments and axes; density in g/cm³), `faceCount()`, `edgeCount()`, `isValid()`, `issues()`, `faces()`, `edges()`. Assertions check the result without `await`; a failed one adds a "Line N: expected volume 25000, got 24000 (tolerance 1e-6 relative)" style error and the run continues:

| Assertion | Checks | Tolerance |
| --- | --- | --- |
| `expectVolume(v, {tolerance, abs, body})` | The exact volume in mm³. | Relative, default 0.001 (0.1 %); `abs` in mm³ instead. |
| `expectBBox({min, max, size}, {tolerance, body})` | The bounding box, in mm, for the keys you give. It is the display box, not the control polygon of a spline or loft, and can fall short of curved faces by a few thousandths of a mm (more for small round bodies). | Absolute in mm, default 0.001. |
| `expectMinFaceArea(a, {body})` | No face smaller than `a` mm², so no slivers; the message names the smallest face. | None: `a` is the limit. |
| `expectValid()`, `expectFaceCount(n)` | The validity check, the number of faces. | None. |

All of them read every body together; give `{ body: 'Name' }` (a body made with `newBody`) to check one body. Volumes of lofted and swept bodies are best checked to about 0.5 %: `expectVolume(78968, { tolerance: 0.005 })`.

Each read rebuilds everything recorded so far, so read once after a group of features, never inside a loop that adds features.

## Limits

- **Size:** a script is limited to 40,000 characters and 2,000 steps. A `for` or `while` loop stops after 100,000 turns ("loop limit exceeded").
- **Safety:** the script runs with only the API names in scope. Browser functions such as `fetch`, `window` and timers are blocked. This prevents accidents but is **not** a security boundary. Do not run scripts from people you do not trust.
- **No sketch constraints:** sketches made by a script are plain geometry without constraints.
- **No separate assemblies:** an assembly is `insertPart` plus `mate` features inside one part.
- **Not covered by helpers:** closed (ring) lofts, sweep with a kept normal, and surface features such as `fill`, `trimSurface`, `extend` and `projectCurve`. Use `.feature({ type: ... })` for kernel features that have no helper. `dome` is not built in the kernel.
- **Patterns take any direction or axis:** a linear pattern's `direction` can be a vector at any angle or a straight edge, and a circular pattern's `axis` a point and a direction (`{ point: [40, 0, 0], dir: [0, 0, 1] }`) or an edge. `.holes.polar` still makes a bolt circle of holes in one feature.
- **Chamfers:** a chamfer with two distances, or with distance and angle, is reported as unsupported by the kernel today. Cut the bevel instead.
- **Line numbers** come from the browser. In browsers other than Chrome and Edge, an error may show line 0.
- **Fonts:** a script can use the built-in fonts `gauge` and `engrave` and a short list of library fonts by id. Fonts picked in the editor cannot be named from a script.
- **Running creates a new part.** A script run in the Script tab cannot modify the part you have open. An agent linked in Settings can run a script on the open part, as one undo step (see [Agents and the MCP server](mcp.md)).

## Next

- [Agents and the MCP server](mcp.md)
- [Equations and variables](../modelling/equations.md)
- [Catalog parts](../library/catalog.md), which are built with this same script language
- [Text](../sketching/text.md)
