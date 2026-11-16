#!/bin/sh
# Build the browser module for feature recognition from STEP (quiddity, Apache-2.0) into apps/cad/public/quiddity/.
#   tools/build_quiddity_wasm.sh            needs rustup, the wasm-bindgen CLI at the version in tools/quiddity_wasm/Cargo.toml
# The output is not committed (like the kernel wasm); it is loaded on demand the first time a STEP file is analysed.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
crate="$root/tools/quiddity_wasm"
out="$root/apps/cad/public/quiddity"
target=${CARGO_TARGET_DIR:-"$crate/target"}
want=$(sed -n 's/^wasm-bindgen = "=\(.*\)"/\1/p' "$crate/Cargo.toml")
have=$(wasm-bindgen --version 2>/dev/null | awk '{print $2}')
[ "$want" = "$have" ] || { echo "wasm-bindgen CLI is '$have', the crate pins '$want': cargo install wasm-bindgen-cli --version $want --locked" >&2; exit 1; }
# panic locations are compiled into the binary: map the build machine's paths to fixed names so nothing of the machine ships
cargo_home=${CARGO_HOME:-$HOME/.cargo}
sysroot=$(cd "$crate" && rustc --print sysroot)
flags="--remap-path-prefix=$cargo_home=/cargo --remap-path-prefix=$sysroot=/rust --remap-path-prefix=$root=/repo --remap-path-prefix=$HOME=/home"
( cd "$crate" && RUSTFLAGS="$flags" CARGO_TARGET_DIR="$target" cargo build --release --target wasm32-unknown-unknown )
mkdir -p "$out"
wasm-bindgen --target web --out-dir "$out" --out-name quiddity_wasm "$target/wasm32-unknown-unknown/release/quiddity_wasm.wasm"
# the licence and notice that Apache-2.0 asks to travel with the binary, from the exact crate version built
ver=$(sed -n 's/^quiddity = { version = "=\([^"]*\)".*/\1/p' "$crate/Cargo.toml")
src=$(ls -d "${CARGO_HOME:-$HOME/.cargo}"/registry/src/*/quiddity-"$ver" | head -1)
cp "$src/LICENSE" "$out/LICENSE-quiddity"
cp "$src/NOTICE" "$out/NOTICE-quiddity"
# the build is refused if a machine path got through anyway
if strings -a "$out/quiddity_wasm_bg.wasm" "$out/quiddity_wasm.js" | grep -E "$HOME|/Users/|/Volumes/|/private/|/home/[a-z]" | grep -v '^/home$' | head -3 | grep -q .; then
  echo "the build still contains a machine path:" >&2
  strings -a "$out/quiddity_wasm_bg.wasm" "$out/quiddity_wasm.js" | grep -E "$HOME|/Users/|/Volumes/|/private/" | head -3 >&2
  exit 1
fi
ls -la "$out"
