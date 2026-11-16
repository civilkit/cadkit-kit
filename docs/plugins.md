# Plugins

A plugin adds **generators**: a named parameter list plus a function that turns the checked values into a script in the app's own dialect.
The app draws the form from the parameter list, previews the result live, and adds it as ordinary features in **one undo step** and one
tree folder. The same list is the JSON schema of an agent tool, so a form and a tool cannot disagree. Plugins add no UI code.

The built-in plugins are **Enclosures** (Case) and **Springs** (compression, extension, torsion). Other people's plugins can be installed from a
packed zip, a `github:` address or a link (see below); they are off until "Allow plugins from other people" is switched on, and a package with
compiled code runs in a sandbox. User-facing guide: *Plugins* in the user guide.

## In the app
Features tab > **Plugins** (or search the commands for "Plugins"): pick a generator, change the fields, see the preview, **Add**.
Fields that only apply to one choice appear and disappear with it (a spring's *Ends* only for compression). A numeric field left empty
shows *auto*: the generator chooses. A wrong value marks its field and disables Add. **Back to the list** and **Cancel** leave the model
untouched; **Reset to defaults** restores the starting values.

## For agents (MCP)
`plugin_list` names the installed plugins and their tools. Each generator is a tool, e.g. `plugin_civilkit_enclosures_case` and
`plugin_civilkit_springs_spring`, with its parameters as the input schema. A call adds features to the open document (attach mode, one
undo step, hand-made features are kept). Unknown parameter names are refused with the list of valid ones.

## Code
`packages/plugin` (browser-safe: manifest, parameter list, registry, built-ins), `packages/plugin-tools` (agent tools),
`apps/cad/src/PluginPanel.tsx` (the generated form) and `pluginRun.ts` (script to ops, grouped).

## Wasm plugins and the sandbox

A wasm plugin's package carries compiled code and the JavaScript glue that loads it. Neither runs in the page. The app runs the package in a Worker inside a sandboxed iframe (`sandbox="allow-scripts"`, an opaque origin) under the policy `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; worker-src blob:` (the package's glue is evaluated inside the sandbox rather than imported from a `data:` URL, so a host page with a strict policy only has to allow the relay script by hash). The package's code therefore has no network (fetch, XHR, WebSocket, importScripts, imports from a URL, sub-workers, beacons), no access to the page's DOM, storage or IndexedDB, and can only talk to the page by message. The page answers only the commands in the manifest's `wasm.commands`, counts them against `maxCommands`, and removes the frame (ending the Worker) at the deadline.

Checked in a real browser with two deliberately hostile packages: one that tries every route out and one that spins forever. Every route reported "blocked", the server saw none of the requests, the page stayed responsive, and the spinner was stopped at its 3 s deadline.

Repeat the check any time with `node tools/plugin_sandbox_check.mjs --zip <packed woodwork.zip> --work <scratch dir>` against a served build (it repacks the zip with hostile glue, drives headless Chrome and exits 1 if anything gets out).

In the desktop app the page's own policy applies to the frame too. `desktop/src-tauri/tauri.conf.json` therefore lists the relay script's `sha256` in `script-src` (a test fails with the new hash if the relay changes), and nothing broader. The desktop policy's `connect-src` allows `github:` installs (raw.githubusercontent.com) but not arbitrary `https://…zip` links, which work in the browser version only. This was checked by serving the build with the desktop policy as a response header in Chrome (cabinet builds, all eleven hostile routes blocked); the same check was then run in Safari 26.5 (the engine the Mac app uses) with the desktop policy as a response header: the cabinet builds, ten routes report blocked, and the eleventh (starting a sub-Worker from a URL) returns without an error in Safari because the load is refused asynchronously; the server saw no request. It has not been run inside the Tauri window itself, and Firefox is not tested.

Known residual risks: WebRTC is not covered by `connect-src` in every browser; a plugin can use CPU until its deadline; the check was run in Chrome and Safari (Firefox is untested); a plugin can still produce misleading geometry. Install only plugins you trust; the switch "Allow plugins from other people" stays off by default.

## Edit parameters

A plugin run stores its parameters in the document (`pluginRuns`, keyed by the folder name it made). Right-click that folder and choose **Edit parameters…**: the form opens with the stored values, and **Update** rebuilds the folder in place, at the same position in the tree, under the same name, as one undo step (the colours and the stored record are undone with it). Later features that refer to the folder's bodies by name (a Move folder, a cut of a named body) keep working. If a later feature is built on one of the folder's features by id (a sketch on a face of it), Update refuses and names it, because rebuilding would delete it.

## Plugins and the MCP server

Two different servers, two different answers:

- **The app the user has open** (agent link, `docs/agent-bridge.md`): the agent sees every plugin the app has switched on, built-in and installed, with `app_plugin_list` (each generator with its JSON parameter schema, the same one the form is made from) and runs one with `app_plugin_run {plugin, generator, params}`. A run needs the edit permission, adds ONE folder in ONE undo step (the user can undo it or right-click the folder and use Edit parameters), and the app shows a notice. Position fields `place_x`, `place_y`, `place_z` (mm) place it. A bad parameter comes back as an error naming it.
- **The headless server** (stdio or daemon, its own scratch document): it lists the built-in plugins as tools `plugin_list` and `plugin_<id>_<generator>`. It does not see the plugins installed in the user's browser (they live in that browser's IndexedDB). Installing a package into the headless server is not built yet.

## Moving a whole cabinet after it is placed

Right-click its folder in the Features tree:

- **Move folder (drag with the ball)** adds one `moveBody` over every body the folder made, selects it, and turns the positioning ball on it (F10 turns it off). Drag an arrow or the ring in the view; further drags fold into the same Move feature, so the whole thing is one tree entry. Select that Move feature any time and press F10 to drag it again.
- If a face was selected in the view when you chose it, the app clears that selection first: a selected face would otherwise make the ball pull that face out like a push-pull (a "square block") instead of moving the cabinet.
- Select the Move entry and open its editor (the pencil): **Move X / Y / Z** are typed fields, in mm or as expressions, so you can fix the numbers after dragging.
- **Move folder by distance…** asks for X, Y and Z in mm and previews as you type.
- **Edit parameters…** has the Position fields too: change Move X/Y/Z and Update to rebuild it elsewhere (this rebuilds the cabinet, so use the two above for a plain move).

## Installing from git or a link

In **Plugins**, switch on "Allow plugins from other people", then paste into the link box either:

- `github:owner/repo@v1.0.0`: the app reads `plugin.json` and each file it lists from raw.githubusercontent.com, checks every file against the hashes in `plugin.json`, and shows the confirmation card. Use a tag or a commit: a branch name installs with a warning because it can move. The repo must contain the packed package (see `tools/plugin-wasm-dev/README.md`), with a `files` list in `plugin.json`.
- `https://host/path/plugin.zip`: a direct link to a packed zip. The host must allow reading from other pages (CORS); a GitHub release asset does not, raw.githubusercontent.com does. Nothing pins it, so the card says so; compare the shown package hash with the one the author published.

A SolidCraft plugin repo as the author publishes it (a raw `.wasm` and their `plugin.json`) cannot be installed directly: it has to be packed first (jco output plus our manifest). The wasm itself is not changed.

## Credit

The wasm plugin format this app runs is the SolidCraft `craft:plugin` format, and the first plugin it was checked against is the SolidCraft
**Woodwork** plugin (cabinets and furniture in sheet goods) by TomasDJo, MIT licence: https://github.com/TomasDJo/solidcraft-woodwork.
Nothing of it ships with the app and the app does not fetch it. A package made from it for this app (the jco glue plus our `plugin.json`) is
a separate file; see "Installing from git or a link" for why the repository itself cannot be installed directly.
