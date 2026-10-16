#!/usr/bin/env bash
# Packs the parts of the kernel repository that the pages build needs and a CI runner does not have (the kit imports the kernel's TypeScript
# packages by path): the five packages' src/, THIRD_PARTY.md and the licence texts that travel with the wasm. Prints the sha256 to give the workflow.
#   tools/pages_kernel_bundle.sh <kernel-repo-checkout> <out.tar.gz>
set -euo pipefail
src="${1:?kernel repo checkout}"; out="${2:?output .tar.gz}"
files=()
for p in driver session render part-model kernel-client; do files+=("packages/$p/src" "packages/$p/package.json"); done
files+=(THIRD_PARTY.md crates/ck-text/fonts/OFL-BarlowCondensed.txt crates/ck-text/fonts/OFL-PTSerif.txt
        crates/ck-check/LICENSE-MIT crates/ck-check/LICENSE-APACHE crates/ck-sldprt/NOTICE crates/ck-sldprt/NOTICE-sldprt2step crates/ck-sldprt/LICENSE-MIT-sldprt-format-research)
for f in "${files[@]}"; do [ -e "$src/$f" ] || { echo "missing in kernel checkout: $f" >&2; exit 1; }; done
tar -czf "$out" -C "$src" --exclude='*.test.ts' "${files[@]}"
echo "wrote $out"
if command -v shasum >/dev/null; then shasum -a 256 "$out"; else sha256sum "$out"; fi
