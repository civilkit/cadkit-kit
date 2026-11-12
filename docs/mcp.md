# MCP server (`@kit/mcp`) and agent tools (`@kit/agent-tools`)

Lets Claude Code, Codex, Cursor or Claude Desktop drive OUR kernel and script layer. The host owns the model and its API key; nothing here reads or stores a key. Phase 3 of `docs/plan-agent-layer.md`.

* `packages/agent-tools` (`@kit/agent-tools`): transport-independent tool definitions (name, description, JSON schema, handler) over an `AgentSession` (a kernel `Session` plus the script runner). The in-app chat (`docs/agent-chat.md`) does not call it directly: it runs Claude Code, which calls the `app_*` tools of the daemon.
* `packages/mcp` (`@kit/mcp`): the MCP server. Zero dependencies: JSON-RPC 2.0 is implemented directly (`initialize`, `ping`, `tools/list`, `tools/call`, `resources/list` + `read`, notifications, batches).

## Install

Requirements: this repo with `npm install` done (the launcher runs the TypeScript sources through the repo's own `vite-node`, so the `@kit/*` and `@ck/*` aliases apply), Node 22, and the kernel wasm (`apps/cad/public/kernel/ck_wasm.wasm`, or any build via `CK_WASM` / `--wasm`).

Claude Code:

```sh
claude mcp add ck-cad -e CK_WASM=<repo>/apps/cad/public/kernel/ck_wasm.wasm -- node <repo>/packages/mcp/bin/ck-mcp.mjs
```

or commit a project `.mcp.json` (see `packages/mcp/examples/mcp.json`). Cursor: the same JSON in `~/.cursor/mcp.json` (or the project's `.cursor/mcp.json`). Claude Desktop: `packages/mcp/examples/claude_desktop_config.json` merged into `claude_desktop_config.json`. Codex: `packages/mcp/examples/codex-config.toml` appended to `~/.codex/config.toml`.

Kernel checkout: the launcher and the tests resolve `@ck/*` (session, part-model, kernel-client, driver) from a kernel repo checkout. The default is `../rebuild` next to this repo (`vite.config.ts`); set `CK_REBUILD=<path to the kernel checkout>` when yours lives elsewhere (for example `CK_REBUILD=/work/kernel`), otherwise the server fails at start with `@ck/session` not resolving. Put it in the same `env` block as `CK_WASM` (`claude mcp add ck-cad -e CK_WASM=... -e CK_REBUILD=... -- node ...`).

Launcher flags (after the script path):

| Flag | Meaning |
| --- | --- |
| (none) | stdio shim; connects to the shared daemon, starting it on demand |
| `--stdio-direct` | no daemon: the kernel lives in this process (tests, simple setups; state dies with the host) |
| `--daemon` | run the daemon in the foreground |
| `--status`, `--stop` | report / stop the daemon |
| `--idle-seconds N` | daemon exits after N idle seconds (default 1800; env `CK_MCP_IDLE_SECONDS`) |
| `--wasm PATH` | kernel wasm (else `CK_WASM`, else the repo's `apps/cad/public/kernel`) |
| `--allow-origin URL[,URL]` | opt-in origins for the GUI bridge (default none) |

State directory: `~/.ck-cad` (mode 0700), override with `CK_MCP_HOME`. Nothing is ever written to stdout except protocol messages.

## Architecture

```
host (Claude Code ...) --stdio--> ck-mcp.mjs (shim) --HTTP 127.0.0.1:<random port>--> daemon
                                                                                       |- McpProtocol + SerialQueue (one tool call at a time)
                                                                                       |- AgentSession -> kernel Session -> wasm worker
```

* ONE daemon per machine. Several hosts (or several windows of one host) share the same kernel and the same open document, which is what makes the optional GUI mirror possible.
* The state file `daemon.json` (0600) holds `{port, token, pid}`. The token is 256 random bits, made at daemon start. Every request needs `Authorization: Bearer <token>` (constant-time compare), a `Host` of `127.0.0.1:<port>` or `localhost:<port>` (DNS-rebinding guard), and NO `Origin` header (a web page always sends one, so a page cannot call the daemon even if it guessed the port). `--allow-origin` lets a specific page into `/bridge/*` only (the agent link, `docs/agent-bridge.md`), which takes a pairing code and session token instead of this token.
* The shim starts the daemon when no live one answers `/health` (a lock file keeps simultaneous shims from starting two), and starts a new one once if the daemon idled out mid-session. The daemon exits after the idle period and removes its state file.
* Tool calls run strictly one at a time (`SerialQueue`); `run_script` is atomic (any error leaves the document unchanged).

## Tools

All inputs are validated (small JSON-schema subset, unknown fields refused) before the handler runs. Errors come back as `isError` results: `{"ok":false,"error":{"code","message","hint"}}`. Codes: `bad_input`, `unknown_tool`, `no_such_feature`, `no_such_checkpoint`, `nothing_to_undo`, `snapshot_unavailable` ("snapshot package not installed"), `no_body`, `internal_error`. Kernel errors inside a script run carry the kernel code and its repair hint. Output is capped (about 48000 characters): long arrays are cut with an "... N more items" marker.

| Tool | Input | Returns |
| --- | --- | --- |
| `run_script` | `code`, `mode: 'new'\|'attach'`, `name?`, `replace?: 'last'\|'all'\|'none'` | `{ok, run, mode, errors[{line, message, feature?, code?, hint?}], warnings, created[], removed[], regenMs, featureCount, solids, volume, area, centerOfMass, bbox{min,max,size}, faceCount, edgeCount, validity{ok,issues}}` |
| `tree` | none | `{name, featureCount, handMade, features[{index,id,type,name,origin,params,error?}]}` |
| `find` | `query` | features, face names and edge names matching |
| `inspect` | `id` | the feature JSON (sketch points and entities), `createdFaces`, `touchedEdges`, `usedBy`, `error?` |
| `bodies` | none | one row per body (connected solid): `{index, name, key, feature, featureType, volume, bbox{min,max,size}, faceCount, appearance, hidden}`. Shows which solids fused and which one a cut sliced |
| `drawing` | `views?, sheet?, orientation?, scale?, projection?, hidden?, dimensions?, section?, tidy?, minDiameter?, title?, path?` | an engineering sheet from the app's drawing layer: SVG text (no `path`) or `<path>.pdf` / `.dxf` / `.svg` files; summary of views, dimensions and hole callouts |
| `facts` | `expect?` (kernel check grammar) | mass props, bbox, counts, validity, and `check` results |
| `probe` | `points?`, `rays?` | per point `{inside, distance, face, nearest}`; per ray the hit list |
| `section` | `plane{origin?, normal}`, `detail?` | exact loops (outer/inner), area, frame |
| `sections` | `axis`, `n?`, `positions?` | areas per slice, integrated volume vs exact volume |
| `snapshot` | `view, up, size, style, projection, section, sheet, highlight, markers, frame, annotate, background` | MCP image content (base64 PNG) plus a text summary. `projection`: `ortho` (alias `orthographic`) or `persp` (alias `perspective`). `sheet`: `single`, `orthos`, `drawing-third-angle`, `drawing-first-angle`, `ab`, `section` (`true` means `drawing-third-angle`). `annotate: true` draws the three overall bounding-box dimensions. `front` looks along the part's -Z axis |
| `checkpoint` / `restore` / `checkpoints` | `name` | named full-document snapshots in memory (at most 20; the oldest goes) |
| `notes` | `text?`, `append?` | the scratch notes; persist across restore, undo and new scripts |
| `list_methods` / `docs` | `query?` / `names[]` | the script API registry (generated from the JSDoc of `packages/script/src/recorder.ts`, the same source as the Script tab: every method `run_script` accepts is there, with parameters, notes and an example); recipes by id; `docs {names:['guide']}` returns the guide |
| `undo` / `redo` | none | document history (50 states) |
| `ask_user` | `question`, `options?` | `{needsUserInput: true, ...}`: there is no UI in MCP, ask in your reply |
| `export` | `format: 'step'\|'stl'\|'glb'\|'ckpart'`, `path?`, `cache?` | writes the file (default `./<part name>.<ext>` in the server's cwd). `cache: true` (ckpart only) also writes the built view as the file's `viewCache` field, the one the app's Save geometry in file writes (see `docs/files.md`); the result carries `viewCache {build, key, base64Bytes}` |

Resources: `ck://docs/guide` (units, plane frames, bodies and appearance, workflow, common errors), `ck://llms.txt` (the guide plus a one-line index of every method, kept in the repo as `docs/llms.txt`), `ck://docs/methods`, `ck://recipes/<id>` (the Script tab's examples), `ck://document`, `ck://notes`.

### Attach mode and origin marks

`run_script` with `mode: 'new'` replaces the document with the script's part. With `mode: 'attach'` the script's features are APPENDED to the open document (selectors see the body as it is, ids continue from the document's counter). Every feature a script run makes gets `"origin": "script#N"` in its JSON; the kernel and the GUI keep unknown feature fields, so the marks survive regeneration, saving and hand edits (the session also keeps an id to origin map). By default an attach run first removes the features of the PREVIOUS script run (`replace: 'last'`), so re-running a corrected script does not duplicate it; `'all'` replaces every script feature, `'none'` only appends. Hand-made features are never removed. If a hand-made feature uses a script feature that would be replaced (a sketch on its face, a reference to its edge), the run is refused with the feature named and the hint to use `replace:'none'` or remove it first.

### Things worth knowing before you script (all in `ck://docs/guide`)

* Sketch frames: `front` x=X y=Y n=+Z; `top` x=X y=-Z n=+Y; `right` x=-Z y=Y n=+X; for `{origin, normal, xdir}` planes sketch x = xdir, sketch y = normal x xdir. A `cutNoEffect` error prints the frame of the sketch involved.
* A cut applies to EVERY body that exists when it runs. `run_script` adds a `cutHitManyBodies` warning when one cut (or hole) changed more than one body (checked for results with several bodies, at most 24 cuts and about 8 s).
* Touching or overlapping solids fuse. `extrude / revolve / sweep` accept `newBody: true | 'Name'` to keep a solid separate; `bodies` shows the result.
* `appearance({feature})` on a pattern styles the copies and the seed's body. Hole callouts in `drawing` need real hole features (`hole`, `holes.*`), not a sketch circle plus a cut.

## Worked example: a flanged bushing

Calls are shown as `tool {input}`; results are abbreviated (`...`) but the shapes are exact.

1. `list_methods {"query": "revolve hole"}` returns method rows `{name, group, signature, summary}`; `docs {"names": ["revolve", "holes.polar"]}` returns the full entries.

2. `run_script`:

```json
{ "mode": "new", "code": "const { od, id, fl, len, ft } = variables({ od: 30, id: 20, fl: 44, len: 40, ft: 6 });\npart('Flanged bushing')\n  .sketch('front', (s) => s.polygon([[id / 2, 0], [fl / 2, 0], [fl / 2, ft], [od / 2, ft], [od / 2, len], [id / 2, len]]))\n  .revolve(360)\n  .holes.polar(face('<Y'), { center: [0, 0], radius: 18, count: 4 }, { diameter: 4 });" }
```

```json
{ "ok": true, "run": "script#1", "mode": "new", "errors": [], "warnings": [], "created": ["F1","F2","F3","F4"], "removed": [],
  "regenMs": 269, "featureCount": 4, "solids": 1, "volume": 20288.4054, "area": 9160.8842, "centerOfMass": [0, 16.162, 0],
  "bbox": { "min": [-22, 0, -22], "max": [22, 40, 22], "size": [44, 40, 44] },
  "faceCount": 10, "edgeCount": 14, "validity": { "ok": true, "issues": [] } }
```

3. `checkpoint {"name": "v1"}` returns `{"saved": "v1", "features": 4, "checkpoints": 1}`.

4. `tree {}` returns `features: [{index:0, id:"F1", type:"sketch", origin:"script#1", params:{plane:{kind:"std",id:"front"}, points:"9 items", ...}}, {id:"F2", type:"revolve", params:{op:"add", sketch:"F1", axis:"e7", angle:360}}, {id:"F3", type:"sketch", params:{plane:{kind:"face", id:"F2.S.e1"}, ...}}, {id:"F4", type:"hole", params:{diameter:4, end:"through", ...}}]`.

5. Prove the numbers. `facts {"expect": [{"kind":"valid"}]}` returns the same numbers plus `check: {passed: 1, failed: 0, results: [...], measured: {volume, area, com, bbox, faces: 10, edges: 14, solids: 1, holes: 5, innerLoops: 6}}`. The volume by hand: `pi*(22^2-10^2)*6 + pi*(15^2-10^2)*34 - 4*pi*2^2*6 = 20288.4`.

6. `probe {"points": [[0,20,0],[12,20,0],[18,3,0]]}`:

```json
{ "points": [
  { "inside": false, "distance": 10, "face": "F2.S.e6", "nearest": [10, 20, 0] },
  { "inside": true,  "distance": -2, "face": "F2.S.e6", "nearest": [10, 20, 0] },
  { "inside": false, "distance": 2,  "face": "F4.S.h1~1", "nearest": [20, 3, 0] } ] }
```

The first point is in the bore (outside the material, 10 mm from the wall), the second is in the wall, the third is next to a flange bolt hole (2 mm from its surface).

7. `sections {"axis": "y", "n": 4}` returns `{axis, range:[0,40], positions:[5,15,25,35], areas:[1156.1, 392.7, 392.7, 392.7], loops:[6,2,2,2], volume, exactVolume: 20288.4, volumeError}`; the flange slice shows 4 bolt holes plus the bore (6 loops). The `volumeError` of a 4-slice midpoint rule is large (15 percent: the flange is a step); use more slices for a tighter check.

8. `snapshot {"view": "iso", "size": 512}` returns an image content block plus `{view, size, bytes}` once `@kit/snapshot` is installed; otherwise `isError` with code `snapshot_unavailable`.

9. The user opens the same document in the GUI and adds a hand fillet. The agent then runs a second script in attach mode to add a keyway; the hand fillet is untouched:

`run_script {"mode": "attach", "code": "..."}` returns `{ok: true, run: "script#2", mode: "attach", created: [...ids after the document's counter], removed: [], ...}`; a corrected re-run returns `removed: [<the previous run's ids>]` and new ids (ids shown here are not literal).

10. A script error:

```json
{ "ok": false, "run": "script#3", "mode": "attach",
  "errors": [ { "line": 4, "message": "edges('|Q'): unsupported selector (use 'all', '|X', '|Y', '|Z', '>X', '<X', '>Y', '<Y', '>Z', '<Z', or a rule object)" } ],
  "warnings": [], "created": [], "removed": [], "regenMs": 112, "featureCount": 4 }
```

Nothing changed; fix line 4 and run again. `undo` and `restore {"name": "v1"}` are there for the other cases.

## Limits and notes

* Atomic runs: a script that fails halfway does not leave its good prefix behind (the error says where). A partial result mode could be added if agents want to see it.
* One document per daemon. `run_script new` replaces it; `undo` brings it back.
* A script is evaluated with the fuel-limited `new Function` sandbox of `@kit/script`: NOT a security boundary (see `docs/scripting.md`); do not point the daemon at untrusted scripts. The daemon only listens on loopback and needs the token, but any local process of the same user can read the state file.
* Checkpoints and history are in memory (bounded: 20 and 50) and die with the daemon.
* The launcher uses vite-node, so a start costs about 1.5 s; the daemon removes that cost for later sessions. A bundled `dist` build (esbuild) is the packaging step still to do.
* `export ckpart` with `cache: true` builds the view from the Session's regen reply of the exact document written (shared code in `@kit/viewdata`, also used by the app controller), keyed by the SHA-256 of the canonical recipe and the kernel build id, the SHA-256 of the wasm file the server runs (`CK_WASM` / `wasmPath`; the app hashes the wasm it loads, so the two agree when they run the same build). It writes nothing and returns `view_unavailable` when the view could not be reproduced exactly: a document with a curated or embedded font (the app loads those through its font pool; built-in fonts are fine), a rolled-back document, a non-`ck-part` format, or a kernel that is not a local wasm file (no hash).
* `export glb` writes flat-shaded triangles from the display mesh; `stl` uses `@kit/io`.
* `snapshot` and a generated registry depend on two parallel branches (below).

### Dependencies on the parallel branches

* `@kit/snapshot` (branch `kit-snapshot`): the tool imports it dynamically by name and calls `snapshotOf(session, opts)` (else `renderSnapshot`), passing the kernel `Session`. The result may be PNG bytes, a base64 string, or an object with `png` / `data` / `image`; other fields are returned as text. Until the package exists the tool answers `snapshot package not installed`. `vite.config.ts` already has the `@kit/snapshot` alias (a merge conflict there is trivial). Tests use `src/testing/placeholder-snapshot.ts`, a bounding-box PNG, injected through `AgentSession.open({ snapshotFn })`.
* `@kit/skill` (branch `kit-skill`): `list_methods` and `docs` read an injectable `Registry` (`methods()`, `recipes()`, `search(q)`, `get(name)`, `guide()`). `defaultRegistry()` is a minimal hand-written one (from `docs/scripting.md`; recipes from the Script tab examples). Swap with `AgentSession.open({ registry })` and pass it in `cli.ts`.

## GUI bridge

Built as the agent link: see `docs/agent-bridge.md` (pairing code, loopback long poll, `app_*` tools, edit permission). The earlier design below (mirror the daemon's document into the app) is not built.

### Earlier design (not built; daemon side of `/events` and `/document` exists)

Goal: the running app (`apps/cad`) mirrors the agent's document live, the "docked GUI".

Implemented in the daemon:

* `GET /events` (Server-Sent Events, token required): `event: hello` with the current `version`, then `event: document` with `{version, label, features, name}` on every document change (script run, undo, redo, restore). `version` increases by one per change.
* `GET /document`: `{version, document}`, the full part JSON.
* `GET /health`: `{ok, pid, server, version, pending}`.

What the app would do (not built):

1. Discover the daemon: a browser cannot read `~/.ck-cad/daemon.json`. Either the user starts the app with `--allow-origin <app origin>` and pastes the token once (`--status` deliberately does not print the token), or a tiny native/Vite-dev-server proxy attaches the token server-side. The default stays closed: no Origin is accepted.
2. Subscribe: `fetch('/events')` with the bearer header and a streaming reader (EventSource cannot set headers). On `document`, if `version` is newer than the last applied, `GET /document` and call `controller.load(doc)` in a read-only "agent" mode (or open it as a second tab), keeping the app's own undo separate.
3. Hand edits flow the other way: when the user edits in the GUI, post `POST /rpc` `tools/call` is NOT the way (agents own `run_script`); add a `PUT /document` (token, version check) that replaces the daemon's document with the app's, so the agent's next `tree` sees the user's edit. Feature `origin` marks make the agent's next attach run keep the user's features.
4. Conflicts: last writer wins by `version`; the daemon answers 409 on a stale PUT and the app reloads.

## Tests

`CK_WASM=<wasm> CK_REBUILD=<kernel checkout> npx vitest run packages/agent-tools packages/mcp packages/skill packages/snapshot` (kernel suites are skipped without `CK_WASM`; the registry-coverage test walks the recorder classes and needs neither): tool handlers on the real kernel (new and attach, hand-made feature survives, hand dependents block replacement, tree / inspect / facts / probe / section(s), checkpoint / restore / notes / undo, script error line numbers, schema errors, export), a protocol test that spawns `ck-mcp.mjs --stdio-direct` and speaks JSON-RPC, and daemon tests (token required, Origin and Host refused, 0600 state file, two concurrent calls serialised, idle exit, event stream, shim forwarding).
