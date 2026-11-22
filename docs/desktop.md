# Desktop app (macOS, Windows, Linux)

CivilKit CAD runs in a Tauri 2 shell (`desktop/`): the system WebView (WKWebView on macOS, WebView2 on Windows, WebKitGTK on Linux) loads the bundled static build of the web app from inside the binary, so it works offline. The web build is not changed; the shell serves it at `tauri://localhost/cad/` (or `http://tauri.localhost/cad/` on Windows).

Chosen over Electron so the download carries no Chromium of its own (size, and no rebuild for each Chromium security fix while there is no auto-update).

## What the shell does

- Loads `tauri://localhost/cad/index.html` (`desktop/src-tauri/tauri.conf.json`: `frontendDist` is the folder that contains the built `cad/`).
- CSP (`tauri.conf.json`): the app's own origin, `blob:`, `data:`, `wasm-unsafe-eval`, inline style attributes, and connections only to `api.polyhaven.com`, `dl.polyhaven.org` and `cdn.polyhaven.com` (used only when "Use online libraries" is on). `script-src` also has `'unsafe-eval'`: the Script tab and equation fields evaluate the user's own code with `new Function` on the main thread. Nothing remote is loaded as script.
- Links to `http(s)` and `mailto`, and new-window links, open in the default browser; the window only ever shows the bundled app.
- Downloads (Export, Save a copy, saved scripts): WKWebView ignores `<a download>`, so the shell's page script sends blob and data downloads through the native Save dialog and writes the file with the fs plugin. The web app has no special case.
- `.ckpart` and `.ckpart.gz` are registered as document types (macOS `Info.plist`, Windows MSI/NSIS registry associations, Linux `.desktop` / `shared-mime-info`). On macOS a double-clicked file arrives via `RunEvent::Opened`; on Windows and Linux it arrives via CLI `argv` (supporting both filesystem paths and `file://` URIs) and is handed to the page as the same drop event the app already handles. File > Open Part File does the same through the native Open dialog.
- Embedded native kernel (`ck-native`): runs on an ephemeral `127.0.0.1` port authenticated with a 256-bit OS CSPRNG token (`getrandom`) and accepts `tauri://localhost`, `http://tauri.localhost`, and `https://tauri.localhost` origins.
- Platform-specific bundle targets are configured in `tauri.macos.conf.json` (`app`, `dmg`), `tauri.windows.conf.json` (`msi`, `nsis`), and `tauri.linux.conf.json` (`deb`, `appimage`), sharing common config and icons (`icon.icns`, `icon.ico`, PNGs) from `tauri.conf.json`.
- Native menu (macOS app menu on macOS; File/Edit/View/Window/Help with Quit and About on Windows and Linux), window size and position remembered.
- Version: the root `package.json` (`desktop/scripts/sync-version.mjs` copies it into `desktop/package.json` and `Cargo.toml`; `tauri.conf.json` reads `package.json`). Settings shows the same `Version X (app <commit>, kernel <build>)` from `version.json`.

## Building (macOS)

Needs Node 22, Rust (`rustup target add aarch64-apple-darwin x86_64-apple-darwin`), wabt (for `build:pages`), the gated kernel wasm and the kernel checkout.

```sh
WASM_SRC=/path/to/ck_wasm.wasm CK_REBUILD=/path/to/kernel-checkout tools/desktop_build.sh
```

The app also embeds the native Rust kernel (`ck-native`, a Cargo path dependency). The script points that dependency at `CK_REBUILD` (the same checkout as the wasm, not whatever `../rebuild` has checked out), exports `CK_COMMIT` from it, and after the build fails unless the kernel commit is found in each `.app` binary. A Mac release therefore cannot pair a gated wasm with a different native kernel.

It builds the static app into `dist-pages-civilkit/cad` (`npm run build:pages`), then `npm run build:mac` in `desktop/` makes a `.app` and `.dmg` for aarch64 and x86_64 under `desktop/src-tauri/target/<triple>/release/bundle/`, and checks the signature. `SKIP_WEB=1` reuses an existing web build.

The apps are ad-hoc signed (`signingIdentity: "-"`): a valid signature without a Developer ID. An arm64 app with a broken signature shows "is damaged", so the signature is verified with `codesign --verify --deep --strict`.

## Building (Windows & Linux)

Build the static web app into `dist-pages-civilkit/cad` first (`npm run build:pages`), ensure the sibling `../rebuild` kernel checkout is at the matching commit, then run in `desktop/`:

- **Windows** (requires MSVC build tools, Rust, Node 22, WiX / NSIS via Tauri CLI): `npm ci && npm run build:win` (produces `.msi` and `.exe` NSIS installers).
- **Linux** (requires `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev patchelf fuse`, Rust, Node 22): `npm ci && npm run build:linux` (produces `.deb` and `.AppImage` bundles).

## Opening an unsigned app

- **macOS:** Open the app once, then choose **Open Anyway** in **System Settings > Privacy & Security**; or run `xattr -dr com.apple.quarantine "/Applications/CivilKit CAD.app"`. On older macOS versions right-click > **Open** also works.
- **Windows:** In Windows Defender SmartScreen, click **More info** > **Run anyway**.
- **Linux:** For `.AppImage`, run `chmod +x CivilKit*.AppImage` before launching.

## Not included

- Code signing and notarisation (Apple Developer ID / Windows Authenticode).
- Auto-update (#44).

## Release workflow

`.github/workflows/desktop-release.yml` builds the kernel WASM and static web app once, then runs a 3-platform matrix (`macos-latest`, `ubuntu-22.04`, `windows-latest`) that compiles the embedded native kernel (`ck-native`) and Tauri bundles (`.dmg`, `.deb`, `.AppImage`, `.msi`, `.exe`) and uploads all installers plus `SHA256SUMS` to a draft GitHub release.

## Testing the window

WKWebView has no remote debugging port. A debug build (`tauri build --debug`) reads the file named by the environment variable `CK_DESKTOP_TEST_JS` and runs it in the page once the app has loaded (the hook does not exist in release builds). A test script can write its results into an overlay element, and a screenshot of the real window (`screencapture`) shows them. Launch with `open -n --env CK_DESKTOP_TEST_JS=/path/test.js "CivilKit CAD.app"`.

## Known build quirk

Tauri's dmg step drives Finder through AppleScript and can fail with "couldn't unmount ... Resource busy" when Finder or Spotlight holds the new disk image (it did once here). `hdiutil detach /dev/diskN -force` on the leftover image and re-running `npx tauri build --bundles dmg --target <triple>` fixes it.
