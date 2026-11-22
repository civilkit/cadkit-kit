#!/usr/bin/env bash
# Builds the macOS desktop app (Tauri: .app and .dmg for aarch64 and x86_64, ad-hoc signed) from this checkout. Run on a Mac.
#   WASM_SRC=/path/ck_wasm.wasm CK_REBUILD=/path/kernel-checkout tools/desktop_build.sh
#   SKIP_WEB=1 tools/desktop_build.sh      # reuse an existing dist-pages-civilkit/cad
# See docs/desktop.md.
set -euo pipefail
cd "$(dirname "$0")/.."
PAGES_OUT=dist-pages-civilkit/cad
if [ "${SKIP_WEB:-0}" != 1 ]; then
  : "${WASM_SRC:?set WASM_SRC to the kernel ck_wasm.wasm to bundle}"
  : "${CK_REBUILD:?set CK_REBUILD to the kernel repository checkout}"
  PAGES_OUT="$PAGES_OUT" WASM_SRC="$WASM_SRC" CK_REBUILD="$CK_REBUILD" npm run build:pages
fi
test -f "$PAGES_OUT/index.html" || { echo "no web build in $PAGES_OUT" >&2; exit 1; }
# The app embeds the native kernel (ck-native) as a Cargo path dependency. Build it from the SAME kernel checkout as the wasm
# (CK_REBUILD), not from whatever ../rebuild happens to have checked out, and stamp the build with that commit.
: "${CK_REBUILD:?set CK_REBUILD to the kernel repository checkout (also the source of the embedded native kernel)}"
CK_REBUILD="$(cd "$CK_REBUILD" && pwd)"
test -d "$CK_REBUILD/crates/ck-native" || { echo "no crates/ck-native in $CK_REBUILD" >&2; exit 1; }
CK_COMMIT="$(git -C "$CK_REBUILD" rev-parse HEAD)"
export CK_COMMIT
CARGO_TOML=desktop/src-tauri/Cargo.toml
cp "$CARGO_TOML" "$CARGO_TOML.orig"
trap 'mv -f "$CARGO_TOML.orig" "$CARGO_TOML"' EXIT
sed -i.bak "s#path = \"[^\"]*crates/ck-native\"#path = \"$CK_REBUILD/crates/ck-native\"#" "$CARGO_TOML" && rm -f "$CARGO_TOML.bak"
grep -q "$CK_REBUILD/crates/ck-native" "$CARGO_TOML" || { echo "could not point ck-native at $CK_REBUILD" >&2; exit 1; }
cd desktop
npm ci --no-audit --no-fund
npm run build:mac
for app in src-tauri/target/*/release/bundle/macos/*.app; do
  echo "== $app"
  codesign --verify --deep --strict --verbose=2 "$app"
  codesign -dv --verbose=2 "$app" 2>&1 | grep -E "Signature|Identifier|Format" || true
done
# The embedded native kernel must report the kernel commit it was built from (not "unknown" and not another checkout).
for app in src-tauri/target/*/release/bundle/macos/*.app; do
  bin="$app/Contents/MacOS/$(ls "$app/Contents/MacOS" | head -1)"
  if strings -a "$bin" | grep -q "$CK_COMMIT"; then echo "native kernel stamp ok in $app ($CK_COMMIT)"; else echo "native kernel commit $CK_COMMIT NOT found in $bin" >&2; exit 1; fi
done
ls -la src-tauri/target/*/release/bundle/dmg/*.dmg
