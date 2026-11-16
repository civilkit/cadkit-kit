# Developing and testing wasm plugins

A wasm plugin is a SolidCraft `craft:plugin@0.1.0` component (for example the MIT woodwork plugin). The app never compiles it: it installs a **package** made by `tools/plugin_wasm_pack.mjs` (jco output, our `plugin.json`, a sha256 for every file).

## One-time setup (this folder only; jco is not an app dependency)

    cd tools/plugin-wasm-dev && npm install        # @bytecodealliance/jco 1.42.0 (about 340 MB of node_modules, ignored by git)

## Pack a plugin

    node tools/plugin_wasm_pack.mjs \
      --from <folder with the plugin's plugin.json and its .wasm, e.g. an unpacked release> \
      --jco tools/plugin-wasm-dev/node_modules/@bytecodealliance/jco/dist/jco.js \
      --id tomasdjo.woodwork --entries cabinet,corner --out <scratch dir>/woodwork
    # writes <scratch dir>/woodwork.zip: install it from Plugins > Install from a .zip file

## Run the kernel tests against a package

    CK_WASM=<gated kernel wasm> CK_WOODWORK_ZIP=<scratch dir>/woodwork.zip \
      npx vitest run packages/plugin-wasm

## Attack the sandbox (needs Chrome, `zip` and a served build)

    tools/serve_local.sh --port 5191
    node tools/plugin_sandbox_check.mjs --zip <woodwork.zip> --work <scratch dir> --port 5191

The woodwork plugin is MIT licensed (copyright its author); the package carries its LICENSE file. Ask the author before publishing a package or any fixture derived from their sample kitchen.
