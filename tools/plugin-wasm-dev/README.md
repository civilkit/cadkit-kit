# Developing and testing wasm plugins

A wasm plugin is a SolidCraft `craft:plugin@0.1.0` component (for example the MIT woodwork plugin). The app never compiles it: it installs a **package** made by `tools/plugin_wasm_pack.mjs` (jco output, our `plugin.json`, a sha256 for every file).

## One-time setup (this folder only; jco is not an app dependency)

    cd tools/plugin-wasm-dev && npm install        # @bytecodealliance/jco 1.42.0 (about 340 MB of node_modules, ignored by git)

## Pack a plugin

    node tools/plugin_wasm_pack.mjs \
      --from <folder with the plugin's plugin.json and its .wasm, e.g. an unpacked release> \
      --jco tools/plugin-wasm-dev/node_modules/@bytecodealliance/jco/dist/jco.js \
      --id tomasdjo.woodwork --entries cabinet,corner,joinery,material --preview-off labels,shelf_pins --out <scratch dir>/woodwork
    # --preview-off: boolean switches whose detail is slow to build (an engraved label, rows of holes). The live preview runs with them off and says so; Add builds them.
    # A plugin authored for CivilKit can set `previewOff: true` on the parameter, or `"x-preview-off": true` in a JSON schema.
    # writes <scratch dir>/woodwork.zip: install it from Plugins > Install from a .zip file

## Run the kernel tests against a package

    CK_WASM=<gated kernel wasm> CK_WOODWORK_ZIP=<scratch dir>/woodwork.zip \
      npx vitest run packages/plugin-wasm

## Attack the sandbox (needs Chrome, `zip` and a served build)

    tools/serve_local.sh --port 5191
    node tools/plugin_sandbox_check.mjs --zip <woodwork.zip> --work <scratch dir> --port 5191

Woodwork 0.1.7 runs on this host, installed straight from the author's zip (the app converts it at install; no pack step is needed): `cabinet`, `corner`, `joinery` and `material` are wired, and `cutlist` is a read entry (Run instead of Add: it reads the open document, shows a table, and a "Save as" file comes back as a download; the manifest's `permissions.files` is shown at install and no folder is ever read or written). `edit` (the app's own Edit parameters does that) is left out. Placing, labels, turned doors, Match selected and Joinery on a moved cabinet are covered by `packages/plugin-wasm/src/woodwork.kernel.test.ts`; the Cut list by `packages/plugin-wasm/src/cutlist.test.ts` (set `CK_WOODWORK_RELEASE` to the unzipped release). Not done: joints (doors and drawers do not swing, `Place` makes no link between cabinets: the document has no kinematic joints), `model.mesh` for the cut list of a turned board.

The woodwork plugin is MIT licensed (copyright its author); the package carries its LICENSE file. Ask the author before publishing a package or any fixture derived from their sample kitchen.
