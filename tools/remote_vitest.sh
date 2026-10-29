#!/usr/bin/env bash
# Run kit tests (vitest) on the CI box instead of this machine: the kernel-backed suites are heavy (esbuild plus the wasm kernel).
#   tools/remote_vitest.sh [--worktree DIR] [--kernel DIR] [--wasm FILE] [--timeout SEC] [--workers N] -- <vitest args, e.g. packages/script/src/knurl.kernel.test.ts -t straight>
# --worktree  the kit checkout to test (default: this one)
# --kernel    the kernel checkout whose packages/ the kit aliases to (default: ../rebuild-main next to this kit)
# --wasm      the wasm the kernel suites load (default: the newest ck_wasm.wasm under the kernel checkout's target/); build one with
#             the kernel's tools/remote_build.sh when none exists or the kernel changed
# Host: $REMOTE_BUILD_HOST, else the host part of the kernel checkout's `ci` git remote (as tools/remote_build.sh).
# Everything on the box lives under ~/ci-cad/remote-vitest/<name>; nothing outside it is written or deleted. Results print here.
set -uo pipefail
HERE=$(cd "$(dirname "$0")/.." && pwd -P)
WT="$HERE"; KERNEL=""; WASM=""; TMO=1500; WORKERS=1
while [ $# -gt 0 ]; do
  case "$1" in
    --worktree) WT=$(cd "$2" && pwd -P) || exit 64; shift 2 ;;
    --kernel) KERNEL=$(cd "$2" && pwd -P) || exit 64; shift 2 ;;
    --wasm) WASM="$2"; shift 2 ;;
    --timeout) TMO="$2"; shift 2 ;;
    --workers) WORKERS="$2"; shift 2 ;;
    --) shift; break ;;
    -h|--help) sed -n 2,9p "$0" >&2; exit 64 ;;
    *) echo "unknown arg: $1 (put vitest args after --)" >&2; exit 64 ;;
  esac
done
case "$WORKERS" in ''|*[!0-9]*) echo "--workers must be a number" >&2; exit 64 ;; esac
case "$TMO" in ''|*[!0-9]*) echo "--timeout must be a number of seconds" >&2; exit 64 ;; esac
KERNEL="${KERNEL:-$(cd "$HERE/../rebuild-main" 2>/dev/null && pwd -P)}"
[ -f "$WT/package.json" ] && [ -d "$WT/packages/script" ] || { echo "not a kit worktree: $WT" >&2; exit 64; }
[ -d "$KERNEL/packages/session" ] || { echo "not a kernel checkout: ${KERNEL:-?}" >&2; exit 64; }
if [ -z "$WASM" ]; then
  WASM=$(ls -t "$KERNEL"/target/wasm32-unknown-unknown/release/ck_wasm.wasm 2>/dev/null | head -1)
fi
[ -f "$WASM" ] || { echo "no ck_wasm.wasm: pass --wasm FILE, or build one with the kernel's tools/remote_build.sh" >&2; exit 64; }
H=${REMOTE_BUILD_HOST:-}
if [ -z "$H" ]; then
  U=$(git -C "$KERNEL" remote get-url ci 2>/dev/null) || { echo "set REMOTE_BUILD_HOST or add the 'ci' git remote to the kernel checkout" >&2; exit 64; }
  H=${U%%:*}
fi
NAME="$(basename "$WT" | tr -c 'A-Za-z0-9._\n-' '_')-$(printf '%s' "$WT" | cksum | cut -d' ' -f1)"
SSHO=(-o BatchMode=yes -o ConnectTimeout=20 -o ServerAliveInterval=30)
R='$HOME/ci-cad/remote-vitest'          # expanded on the box only
ssh "${SSHO[@]}" "$H" "mkdir -p $R/$NAME/kit $R/$NAME/kernel/packages" 2>/dev/null || { echo "cannot reach the CI box" >&2; exit 69; }
RSH="ssh ${SSHO[*]}"
# copy only, never remove: a file deleted here stays on the box until the box directory is cleared by hand
SYNC=(rsync -a -e "$RSH" --exclude node_modules --exclude 'dist*' --exclude .git --exclude .DS_Store --exclude 'target' --exclude '.serve-local-*')
"${SYNC[@]}" "$WT/" "$H:ci-cad/remote-vitest/$NAME/kit/" >/dev/null || { echo "sync of the kit failed" >&2; exit 70; }
# the kernel packages go with their built dist/ (the worker host the session spawns lives there)
SYNCK=(rsync -a -e "$RSH" --exclude node_modules --exclude .DS_Store)
"${SYNCK[@]}" "$KERNEL/packages/" "$H:ci-cad/remote-vitest/$NAME/kernel/packages/" >/dev/null || { echo "sync of the kernel packages failed" >&2; exit 70; }
rsync -a -e "$RSH" "$WASM" "$H:ci-cad/remote-vitest/$NAME/ck_wasm.wasm" || { echo "sync of the wasm failed" >&2; exit 70; }
# a run directory without the kernel packages' built dist (the session's worker host lives there) takes a copy of the shared one, ci-cad/remote-vitest/.kernel-dist
# (build it once on the box with `npm run build` in the kernel's packages/, then copy that dist/ there)
ssh "${SSHO[@]}" "$H" "d=$R/$NAME/kernel/packages/dist; [ -f \$d/kernel-client/src/worker-host.js ] || { [ -d $R/.kernel-dist ] && cp -r $R/.kernel-dist \$d; }" || true
# the vitest args cross ssh as one quoted string
ARGS=""; for a in "$@"; do ARGS="$ARGS $(printf '%q' "$a")"; done
ssh "${SSHO[@]}" "$H" bash -s <<EOF
set -u
cd $R/$NAME/kit || exit 70
STAMP=\$(cat package.json packages/*/package.json apps/*/package.json 2>/dev/null | cksum)
if [ ! -d node_modules ] || [ "\$(cat .npm-stamp 2>/dev/null)" != "\$STAMP" ]; then
  echo "installing dependencies on the box (once per change to the package files; the kit lockfile is not used because it lags package.json)..." >&2
  npm install --no-audit --no-fund >/tmp/remote-vitest-npm.log 2>&1 || { tail -5 /tmp/remote-vitest-npm.log >&2; echo "npm install failed on the box" >&2; exit 71; }
  printf '%s' "\$STAMP" > .npm-stamp
fi
CK_REBUILD=$R/$NAME/kernel CK_REBUILD=$R/$NAME/kernel CK_WASM=$R/$NAME/ck_wasm.wasm CK_TEST_WORKERS=$WORKERS timeout $TMO npx vitest run$ARGS
EOF
