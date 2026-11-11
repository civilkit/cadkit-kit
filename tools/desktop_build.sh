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
cd desktop
npm ci --no-audit --no-fund
npm run build:mac
for app in src-tauri/target/*/release/bundle/macos/*.app; do
  echo "== $app"
  codesign --verify --deep --strict --verbose=2 "$app"
  codesign -dv --verbose=2 "$app" 2>&1 | grep -E "Signature|Identifier|Format" || true
done
ls -la src-tauri/target/*/release/bundle/dmg/*.dmg
