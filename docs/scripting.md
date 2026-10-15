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

Sketch builder `s`: `rect(w, h, [cx, cy])` (centred), `circle(radius, [cx, cy])` (RADIUS), `polygon(pts)` (closed), `polyline(pts)`, `line(a, b)`, `arc(centre, start, end)` (counter-clockwise), `point(at)`, `axis()`.

Part methods (each adds one feature, in order):

| Call | Feature |
| --- | --- |
| `.sketch(plane, fn, name?)` | sketch |
| `.extrude(depth, {mid, flip, draft, thin})` | extrude (add) of the last sketch |
| `.cut(depth \| through(), {...})` | extrude (cut) of the last sketch |
| `.revolve(angle = 360, {op, thin})` | revolve about the sketch's Y axis (a construction line is added) |
| `.thin(t)` | makes the previous extrude / revolve thin-walled |
| `.hole(face, [x, y], {diameter, depth?})` | sketch with a point + simple hole (through unless `depth`) |
| `.fillet(edges, r)`, `.chamfer(edges, d)` | fillet / chamfer |
| `.shell(face, t)` | shell, the face is opened |
| `.linearPattern({count, spacing, axis})` | pattern of the last feature along x / y / z |
| `.circularPattern({count, axis, angle})` | pattern of the last feature about x / y / z |

Values are numbers or `expr('w*2')` (an expression over the variables; it is stored as `=w*2` in the feature, and `variables` become the document's variables, so they stay editable in the Variables tab). Inside a sketch an `expr` contributes its current number only.

## Selectors

Resolved when the script runs, against the body as it is just BEFORE that step.

* `face(sel)`: one planar face. `'>X' '<X' '>Y' '<Y' '>Z' '<Z'`: the face whose normal is that axis and which is furthest along it (ties: the biggest). `'#top'` = `'>Z'`, `'#bottom'` = `'<Z'`.
* `edges(sel)`: `'all'`; `'|X' '|Y' '|Z'` straight edges parallel to the axis; `'>X' … '<Z'` edges lying in the extreme plane along that axis.

An unsupported selector, or one that matches nothing, gives `Line N: ...` in the error list; clicking it selects that line.

## Result and errors

`runScript(code, host)` returns `{ ops, document, errors }`: `ops` are the `EditOp`s applied, `document` the recorded document (with `script`), `errors` a list of `{ line, message, feature? }`. A thrown error, a bad selector or a kernel rejection stops the run at that line; features that were kept but failed to regenerate are listed and the run continues. `host` is `{ load(doc), edit(ops), geometry() }` (the app passes the Controller).

## Limits and safety

* The code runs in `new Function` with only the API names in scope; `window`, `document`, `fetch`, `Function`, timers etc. are shadowed with `undefined`, loops are fuel-limited (100000 turns), source is limited to 20000 characters and 500 steps. This stops accidents, it is NOT a security boundary against hostile scripts (e.g. `(()=>{}).constructor`); do not run untrusted scripts. A Worker would be the next step.
* Line numbers come from the V8 stack (Chrome, Edge, Node); in other engines errors may show line 0.
* Not supported yet: sweep, loft, mirror, draft, rib, threads, assemblies, face selectors by index or by feature, sketch constraints (sketches are unconstrained geometry), spline sketch entities.
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

## Design: MCP tool `run_script` (not implemented here)

For the agent interface (`packages/mcp` of the kernel repo): `run_script({ session_id?, code })` evaluates the same script text with the same `evaluate()` / step compiler, but with the kernel `Session` as the host (`load` = open a session on the recorded base document, `edit` = `session.edit`, `geometry` = `bodyForView()` plus the edge/face enrichment the viewer does). It returns `{ ok, features, errors: [{ line, feature, message }], volume }`. The compiler lives in `@kit/script` and has no DOM dependency, so it can be moved or published as a separate package; only `geometry()` needs the face/edge enrichment (`faces`/`mid` on edges) that the viewer's Controller currently produces and that would need to be factored out of the app.
