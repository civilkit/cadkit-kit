# Desktop app (macOS)

CivilKit CAD runs in a Tauri 2 shell (`desktop/`): the system WebView (WKWebView on macOS) loads the bundled static build of the web app from inside the binary, so it works offline. The web build is not changed; the shell serves it at `tauri://localhost/cad/`.

Chosen over Electron so the download carries no Chromium of its own (size, and no rebuild for each Chromium security fix while there is no auto-update).

## What the shell does

- Loads `tauri://localhost/cad/index.html` (`desktop/src-tauri/tauri.conf.json`: `frontendDist` is the folder that contains the built `cad/`).
- CSP (`tauri.conf.json`): the app's own origin, `blob:`, `data:`, `wasm-unsafe-eval`, inline style attributes, and connections only to `api.polyhaven.com`, `dl.polyhaven.org` and `cdn.polyhaven.com` (used only when "Use online libraries" is on). `script-src` also has `'unsafe-eval'`: the Script tab and equation fields evaluate the user's own code with `new Function` on the main thread. Nothing remote is loaded as script.
- Links to `http(s)` and `mailto`, and new-window links, open in the default browser; the window only ever shows the bundled app.
- Downloads (Export, Save a copy, saved scripts): WKWebView ignores `<a download>`, so the shell's page script sends blob and data downloads through the native Save dialog and writes the file with the fs plugin. The web app has no special case.
- `.ckpart` is registered as a document type (Info.plist). A double-clicked file arrives as a macOS open event and is handed to the page as the same drop event the app already handles. File > Open Part File does the same through the native Open dialog.
- Native menu (app, File, Edit, View, Window, Help with the guide and What's new links), window size and position remembered.
- Version: the root `package.json` (`desktop/scripts/sync-version.mjs` copies it into `desktop/package.json` and `Cargo.toml`; `tauri.conf.json` reads `package.json`). Settings shows the same `Version X (app <commit>, kernel <build>)` from `version.json`.

## Building (macOS)

Needs Node 22, Rust (`rustup target add aarch64-apple-darwin x86_64-apple-darwin`), wabt (for `build:pages`), the gated kernel wasm and the kernel checkout.

```sh
WASM_SRC=/path/to/ck_wasm.wasm CK_REBUILD=/path/to/kernel-checkout tools/desktop_build.sh
```

It builds the static app into `dist-pages-civilkit/cad` (`npm run build:pages`), then `npm run build:mac` in `desktop/` makes a `.app` and `.dmg` for aarch64 and x86_64 under `desktop/src-tauri/target/<triple>/release/bundle/`, and checks the signature. `SKIP_WEB=1` reuses an existing web build.

The apps are ad-hoc signed (`signingIdentity: "-"`): a valid signature without a Developer ID. An arm64 app with a broken signature shows "is damaged", so the signature is verified with `codesign --verify --deep --strict`.

## Opening an unsigned app

Open the app once, then choose **Open Anyway** in **System Settings > Privacy & Security**; or run `xattr -dr com.apple.quarantine "/Applications/CivilKit CAD.app"`. On older macOS versions right-click > **Open** also works.

## Not included

- Developer ID signing and notarisation (needs an Apple developer account).
- Auto-update (#44).
- Windows.
- Linux: no package is shipped. A Tauri build on Linux needs WebKitGTK and could not be built or run here. `desktop/linux/` has UNTESTED templates (Flatpak manifest, AppStream metainfo, desktop file, MIME type) and `.github/workflows/desktop-release.yml` has a drafted, unused Linux job. Linux users install from the browser.
- Intel (x86_64) build: cross-compiled, never launched on an Intel Mac.

## Release workflow draft

`.github/workflows/desktop-release.yml` is a draft modelled on the VectorCraft release workflow (the owner's sibling project, MIT OR Apache-2.0, whose packaging files the Linux templates are adapted from). It is not used: the working repositories have no GitHub Actions. It would build on GitHub runners and create a draft release.

## Testing the window

WKWebView has no remote debugging port. A debug build (`tauri build --debug`) reads the file named by the environment variable `CK_DESKTOP_TEST_JS` and runs it in the page once the app has loaded (the hook does not exist in release builds). A test script can write its results into an overlay element, and a screenshot of the real window (`screencapture`) shows them. Launch with `open -n --env CK_DESKTOP_TEST_JS=/path/test.js "CivilKit CAD.app"`.

## Known build quirk

Tauri's dmg step drives Finder through AppleScript and can fail with "couldn't unmount ... Resource busy" when Finder or Spotlight holds the new disk image (it did once here). `hdiutil detach /dev/diskN -force` on the leftover image and re-running `npx tauri build --bundles dmg --target <triple>` fixes it.
