# Agent link (GUI bridge): an agent sees and drives the open document

Issue #15. Today the MCP server (`docs/mcp.md`) has its own document and kernel; it cannot see the part the user has open in the browser. The agent link lets an agent do that, under the user's control. First slice: local only, explicit opt-in, read and screenshot, plus the script command.

## What it does

An agent calls extra MCP tools (`bridge_pair`, `app_status`, `app_state`, `app_screenshot`, `app_run_script`, `app_undo`, `app_redo`, and the read-only measuring tools `app_bodies`, `app_measure`, `app_clearance`, `app_interference`, `app_thickness`, `app_draft`, `app_dfm`, `app_section`). The daemon forwards them to the browser app, which answers from the document the user has open.

| Tool | Does | Needs edit permission |
| --- | --- | --- |
| `bridge_pair` | opens a one-time pairing code for the user to paste in the app | no |
| `app_status` | linked or not, edit allowed or not, pairing open or not | no |
| `app_state` | the open document. Default (compact): documentId, revision, name, units, bounds, then `features` as rows `{id, type, name, status}` with `totalCount` / `returnedCount` / `nextCursor`. Narrow with `ids`, `query`, `types`, `fields` (type, name, status, suppressed, error, params), `limit` + `cursor`; `sinceRevision` returns only the features added or changed since that revision, with `delta.removed`; `includeBlobs` keeps long parameter values. `detail: summary` is the earlier shape (features with errors, variables, selection, counts), `detail: full` adds the document JSON | no |
| `app_screenshot` | PNG of the model from `view` at `size` px (with `section: {origin?, normal}` it is cut at that plane and the exact loops are drawn), drawn from the app's current geometry with the snapshot renderer (the document, not the user's screen: no panels, not their camera) | no |
| `app_bodies`, `app_measure`, `app_clearance`, `app_interference`, `app_thickness`, `app_draft`, `app_dfm`, `app_interfaces` | the measuring tools of the headless server (`packages/readback`, one definition for both routes; `app_interfaces` is described in "Geometry interface queries"), asked of the open document's kernel session and body list: distance and closest points, gap with pass / fail, overlap volume, wall thickness, draft angles, injection / cnc / printing checks. Read-only: the ops are not in `EDIT_OPS` | no |
| `app_section` | exact cross-section of the open document at a plane `{origin?, normal}`: loops (outer / inner) with their areas, the plane frame; `detail: true` adds the points. Read-only | no |
| `app_run_script` | the same script language as `run_script`, attach mode on the open document: features are added after the existing ones, as ONE undo step, with a notice | yes |
| `app_open_asset` | open a `.ckpart`, `.solidcraft`, STEP or mesh file BY PATH in a new tab (a mesh is added to the open part): the file is read by the local MCP service, never sent through the model. Returns document id, revision and counts. Only below the folders the user allowed (see "Opening files by path") | yes |
| `app_edit` | one atomic transaction of `add`, `replace`, `remove`, `transform`, `setParam` ops on the open document, guarded by `expectedRevision`. One undo step; ids never change; returns `revision`, `changedIds`, `addedIds`, `removedIds`, `validation`. See "Edit transactions" | yes |
| `app_job_start`, `app_job_status`, `app_job_cancel`, `app_recipe_list` | long work as a job: `open_asset`, a saved `recipe`, or a batch of read-only `checks`; a job id at once, a small status, explicit cancel and failure. See "Jobs and recipes" | `open_asset` and `recipe`: yes |
| `app_undo`, `app_redo` | step the app's history | yes |

Built on top of this link: the in-app chat panel (`docs/agent-chat.md`), which starts Claude Code through the daemon with only the `app_*` tools. Not in this slice: the other headless tools (`tree`, `facts`, `probe`, `section`, `drawing`, `export`) against the app's document (`app_state` covers the tree; `app_run_script` with `check`/`expect` covers facts), live mirroring of the agent's own document.

## Transport

```
agent -- MCP/stdio --> shim -- HTTP, loopback --> daemon  <== long poll == browser app
```

The browser cannot accept connections, so the app connects OUT to the daemon on `127.0.0.1:<port>` and long-polls. Four routes, all under `/bridge/`: `POST hello` (pairing), `GET poll` (up to 20 s; returns queued requests), `POST reply`, `POST bye`. Requests are `{id, op, args}` with `op` in `state | screenshot | section | run_script | undo | redo` (plus the measuring ops); replies are `{id, ok, result | error{code, message, hint}}`. The wire format and both ends live in `packages/agent-link` (no Node or DOM imports); the daemon routes are in `packages/mcp/src/daemon.ts`, the tools in `packages/mcp/src/bridgeTools.ts`, the app side in `apps/cad/src/agentLink/`.

## Consent and auth, on the user's side

1. Off by default and at every start. Nothing is stored: not the code, not the session, not the permission.
2. The user turns it on in Settings, Agent link, by pasting a pairing code the agent got from `bridge_pair`: `<port>-XXXX-XXXX-XXXX-XXXX` (16 characters from an alphabet without look-alikes, about 78 bits). One time use, valid 10 minutes, five wrong tries revoke it, asking for a new one ends the current link.
3. The code buys a session token (256 random bits) used for poll and reply. `/bridge/*` does not accept the daemon token, and the session token opens nothing else in the daemon (`/rpc`, `/health`, `/document`, `/events` refuse it).
4. A second, separate box, "Allow the agent to change this document", is off on every connect. While it is off the agent can read and take pictures only. The daemon refuses edit ops without asking the app, and the app refuses them again when they arrive (it reads the box at each call), so unticking takes effect at once, and the app tells the daemon immediately when the box changes.
5. Visible: a status bar item "Agent: linked, view only | can edit" (click opens the settings), a notice for every script, undo and redo the agent runs, and a Turn off button. Closing the page ends the link.
6. Local only: the daemon listens on `127.0.0.1`; `Host` must be a loopback name (DNS rebinding); a browser `Origin` is accepted on `/bridge/*` only from a loopback page or one listed with `--allow-origin` (the hosted app needs `--allow-origin https://<its origin>`); every other route still refuses any `Origin`. Preflights answer `Access-Control-Allow-Private-Network`. Safari blocks a secure page from calling loopback over plain HTTP; use a local serve there.

## What is exposed

Only what the tools above return: the document the user has open (it contains their features, variables and names) and a rendering of it. Nothing from other tabs, the file system or the clipboard. `app_run_script` is as powerful as the Script tab (it can add and cut features) but cannot save, export or open files, and the user can undo it. Scripts run in the same restricted environment as the Script tab, which is not a security boundary: tick the box only for an agent you trust.

## How it fails

Every failure is an MCP error result `{ok:false, error:{code, message, hint}}`: `app_not_connected` (not paired, or the app stopped polling for 35 s; the hint says to call `bridge_pair`), `edit_not_allowed`, `app_timeout` (60 s, tab in the background or busy), `app_disconnected` (turned off mid call), `no_document`, `no_body`, `snapshot_failed`, `bad_input`, plus the pairing codes `no_pairing`, `code_expired`, `bad_code`. If the daemon goes away the app shows "lost the agent server" after three failed polls and goes back to off. An edit script that fails changes nothing (the kernel rebuilds the candidate first). Calls run one at a time with the other MCP tools. While an app is linked the daemon does not idle out.

## Running it for a demo or recording

`tools/agent_link_demo.mjs` plays the agent so a recording needs no assistant. It starts its own daemon on a free loopback port (state in a private folder under `--out`, so a daemon you already run is untouched), asks for a pairing code, and prints it and writes it to `<out>/pairing-code.txt`. When the app links it runs: `app_status`, `app_screenshot`, then, only if "Allow the agent to change this document" is ticked, `app_run_script` (adds a block beside the part), a second screenshot and `app_undo`. It prints a step line for each, writes `<out>/steps.json` with the timings, and at the end stops only the daemon it started (HTTP shutdown, then a kill of that one child).

```sh
CK_WASM=<path to ck_wasm.wasm> CK_REBUILD=<kernel checkout> node tools/agent_link_demo.mjs --origin http://localhost:5173 --out /tmp/agent-link-demo
```

Options: `--origin` (the local serve's origin; a loopback page is allowed anyway, the flag is for a non-loopback host), `--wasm` (else `CK_WASM`), `--link-wait 180` (seconds to wait for the paste), `--edit-wait 20` (seconds to wait for the edit box before skipping the change, never assumed), `--pause 1500` (ms between steps so a recording can show each). Files written: `pairing-code.txt`, `agent-link-before.png`, `agent-link-after.png`, `steps.json`.

For a recording: open a part that has a solid before the screenshot step (with an empty part the first screenshot reports `no_body` and the script goes on), paste the code in Settings, Agent link, press Turn on, and tick the edit box within `--edit-wait` seconds of the link. Timings seen on a local serve: daemon start about 9 s (the code appears then), link as soon as the code is pasted, `app_status` 5 ms, `app_screenshot` 35 ms to 1.7 s, `app_run_script` 0.2 s, `app_undo` 0.1 s, plus the pauses. The script ends about 15 s after the link with the default pause; the status bar item stays until the user turns the link off or the page closes.

## Tests

`packages/agent-link/src/bridge.test.ts` (pairing, expiry, single use, revocation, request and reply, edit gate, timeouts, aborted polls), `packages/mcp/src/bridge.http.test.ts` (real daemon routes and client on loopback with no kernel: opt-in, token separation, origins and preflight, edit gate on both sides, errors, link ended by a new code), `apps/cad/src/agentLink/appHandlers.test.ts` (what the app exposes and refuses).

## Next

The in-app chat is built (`docs/agent-chat.md`) and reuses this link. Still open: the remaining headless tools against the app document, a screenshot of the live canvas with the user's camera, multiple linked tabs, and a native pairing flow so the code need not be pasted.

## Jobs and recipes

`app_job_start { kind, args }` returns `{jobId, state: "running"}` at once. `kind`: `open_asset` `{path, unit?}` (as `app_open_asset`, without waiting for the answer in the call), `recipe` `{id, params?}`, `checks` `{checks: [{tool, args?, expect?, label?}]}` (up to 20 read-only measuring calls: clearance, interference, thickness, draft, dfm, measure, interfaces, bodies). `app_job_status { jobId }` is small and says `running` (`elapsedMs`, `progress`), `done`, `failed` (`error {code, message, hint}`) or `cancelled`. A finished job's `result` is `{ok, revision, changedCount, errorCount, warningCount, reportUri, previewUri?, cached?}`: `ok` is false whenever `errorCount > 0`, so a failed validation or check is never reported as success; the report and a 512 px preview are resources (`ck://result/<handle>`, `fetch_result`). `app_job_cancel` marks the job cancelled at once and stops the daemon waiting; work already sent to the app cannot be recalled, and if it finishes it is shown as `lateResult` (not as the result), so check `app_state` after a cancel. Up to four jobs run at once; the last 50 are kept. (MCP calls to this server run one at a time, which is why a long operation is a job: `app_open_asset` itself holds the call until the open ends, up to 30 minutes.)

Recipes are DATA. A recipe is a `*.ckrecipe.json` file in a `recipes` folder inside an allowed asset root (`CK_MCP_ASSET_ROOTS`, see "Opening files by path"); links are not followed. Fields (anything else is refused, so there is no place for a command or a script): `id`, `title`, `version`, `params` (`number`, `integer`, `string`, `boolean` or `enum`, with `default`, `min`, `max`, `maxLength`, `values`), `steps` (`app_edit` ops; a string that is exactly `"$name"` is replaced by that parameter's typed value, nothing is interpolated or evaluated), `checks` (read-only measuring calls with an optional `expect`: each key must equal the result's value, or lie in `{min, max}`) and `sources` (files that the recipe depends on, resolved through the same allow-list). Example:

```json
{ "id": "plate-depth", "title": "Set the pad depth", "params": { "depth": { "type": "number", "default": 10, "min": 1, "max": 200 } },
  "steps": [{ "op": "setParam", "id": "F2", "path": "depth", "value": "$depth" }],
  "checks": [{ "tool": "clearance", "args": { "required": 1 }, "expect": { "pass": true } }], "sources": ["parts/base.ckpart"] }
```

A run is one `app_edit` transaction at the document's current revision, then the checks. The edit is atomic; a failed check leaves it committed (one undo step), says so in the report and the job is not ok. A run is remembered only when it succeeded: the same recipe file, parameters and source contents on the document the last run left (same revision) answers `cached: true` and does nothing. Not done: rebuilding only the features a changed source affects (it runs the whole transaction or nothing), recipes that call recipes, and tools to write recipes.

## Geometry interface queries (app_interfaces)

`app_interfaces { kinds?, component?, precision?, tolerance?, limit? }` (also the headless tool `interfaces`) answers what is needed to mate parts without reading every face: `holes` (unique axes: radius, diameter, `axis`, `point`, barrel `length`, a `frame`), `holePatterns` (linear rows with `pitch` and `direction`; bolt circles with `center`, `pcd`, `angularPitch`), `planes` (unique planes: `normal`, `offset` = n . x, total `area`, `faceCount`, an `anchor` point on the largest face and a `frame`), `contacts` (opposite-facing coplanar faces of two bodies that the kernel measures as touching: `bodies`, `faces`, `normal`, `offset`, `areaUpperBound`) and `frames` (the world, each body's centre of mass with world axes, and the principal axes of the whole part). `component` (a body name or number) limits it to one body (contacts that involve it); each kind has a `<kind>Total` so a `limit` is never silent.

Precision: every numeric field is the kernel's value and is never rounded here; `label` is a rounded line (`precision`, default 3 decimals) for reading and must not be used to place anything. The kernel gives positions and areas to 9 decimals, an axis-aligned direction exactly (+X ... -Z), and an oblique direction to 4 decimals, so an oblique normal or axis is good to about 1e-4 (`precision.obliqueDirectionDecimals`); for placement-critical oblique frames measure between the faces (`app_measure`). `tolerance` (default 0.001 mm) decides when two holes or planes are one; oblique planes use a looser one. Limits, said plainly: `point` of a hole is the centre of its barrel face (on the axis for a full barrel; a half-round slot end is not), the contact area is an upper bound (the overlap is not computed, an edge-only touch is included), a body frame uses world axes. Built on the kernel's `describe` and `massProps`; no new geometry code. Tests: `packages/readback/src/interfaces.test.ts`, `packages/agent-tools/src/interfaces.kernel.test.ts`.

## Edit transactions (app_edit)

`app_edit { expectedRevision, ops, reason?, dryRun? }`. The ops: `add {feature, index?}` (no id: the next free `F<n>` is assigned), `replace {id, feature}` (the id is kept; a different `feature.id` is refused), `remove {id, cascade?}`, `setParam {id, path, value}` (a dot path such as `depth` or `entities.0.r`; `id` and `type` cannot be set), `transform {id, translate?, rotate?}` (sets `translate` / `rotate` of a `moveBody` feature, degrees and mm; any other feature type is refused with the way to add a moveBody). Rules, in order: edit permission; `expectedRevision` must be the app's revision (`stale_revision`, checked again inside the controller's queue so a user edit cannot slip in); every op is checked against the document as the ops before it leave it, and the first bad one refuses the whole list (`bad_op`, with its index); the kernel then rebuilds the candidate and commits all of it as ONE history record or none of it (`edit_rejected`, the document, revision and history untouched). `dryRun` stops after the checks. At most 50 ops and 200,000 characters per transaction; a big model goes in with `app_open_asset`. `changedIds` is computed by comparing the features before and after (JSON and build status), not guessed from the ops. Tests: `apps/cad/src/agentLink/agentEdit.test.ts`, `agentEdit.kernel.test.ts` (real controller and kernel: one undo step, nothing changed on failure, stale and racing edits), `packages/mcp/src/bridge.http.test.ts`.

## Output budget

Every `app_*` tool except `bridge_pair` and `app_status` takes `maxChars` (500 to 48000, default 4000). A result that does not fit is returned as a summary with `_budget` and a handle, and `fetch_result` gives the rest (see `docs/mcp.md`). `maxChars` is the daemon's: the app never sees it. The tool list is built once.

## Revisions (app_state)

The document revision is `Controller.revision`: a counter that goes up in `refresh()`, after every successful edit, document patch (variables, configurations), undo, redo and every load. A material or viewer-only change does not move it. `documentId` changes at every load, so a new part with the same revision numbers is not mistaken for the old one. The app remembers a hash of each feature (its JSON and status) at the last 32 revisions it observed (at every state read, and before and after every edit op), which is what `sinceRevision` compares against; a revision it did not observe answers `delta.available: false` and the whole list. A cursor carries the revision it was made at and is refused (`stale_cursor`) once the document moves.

## Opening files by path (app_open_asset)

`app_open_asset { path, unit? }` is for files too big to send as a script (a 9 MB part or STEP file does not fit `app_run_script`, which takes 40,000 characters). The model gives a path; the local service checks it, reads the file and stages the bytes under a one-time handle; the app fetches them from the loopback service (`GET /bridge/asset/<handle>`, session token) and opens them. Only `{documentId, revision, counts, errorCount, previewRef}` come back to the model.

What the user must set up (nothing is allowed by default): the folders files may be opened from, as `CK_MCP_ASSET_ROOTS` (a list, separated like `PATH`) or `<state dir>/assets.json` `{"roots": ["/abs/folder"], "maxMb": 256}`; `CK_MCP_ASSET_MAX_MB` overrides the size limit. Read at every call, no restart needed. A relative path is below the first folder.

What is refused, with a code: `asset_roots_not_configured`, `path_traversal` (any `..`), `path_outside_workspace` (absolute path outside every folder, or a symlink that leads out: the real path is checked), `asset_extension_not_allowed` (only `.ckpart .solidcraft .step .stp .stl .obj .glb .3mf`, by the name and by the link's target), `asset_not_file`, `asset_not_found`, `asset_too_large`, and `edit_not_allowed` (checked first, so a refused call reads no file). An outside path is refused before the file system is touched, so it does not reveal whether the file exists. A hard link inside a folder cannot be told from a copy: do not put links to private files into an allowed folder. The app checks the size and SHA-256 of what arrived against what was staged.

A part, STEP or SolidCraft file opens in a NEW document tab (the user's part is untouched and recoverable); the app shows its usual notices. An open can take minutes: the app serves it beside its poll loop (`LONG_OPS` in `wire.ts`) and the service waits up to 30 minutes. Tests: `packages/mcp/src/assetPolicy.test.ts`, `packages/mcp/src/openAsset.http.test.ts`.

## Plugin tools (app_plugin_list, app_plugin_run)

`app_plugin_list` (read) lists the plugin generators the app has switched on, with a JSON schema for each one's parameters. `app_plugin_run` (needs "Allow the agent to change this document") runs one on the open document through the same path as the Plugins panel's Add: one tree folder, one undo step, and the run's parameters are stored in the document so the folder offers Edit parameters. See `docs/plugins.md`.
