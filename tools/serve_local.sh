#!/usr/bin/env bash
# Build the app and serve it for looking at: ONE static server per port, no Vite, no esbuild watching.
#   tools/serve_local.sh [--port 5173] [--no-build] [--stop]
# Builds into dist-local/ (never dist-pages/, which is what gets deployed) and serves it with tools/pages_serve.mjs.
# A server already on the port that this script started is replaced; anything else on the port is left alone and the script stops.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=5173; BUILD=1; STOP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --no-build) BUILD=0; shift ;;
    --stop) STOP=1; shift ;;
    *) echo "usage: $0 [--port N] [--no-build] [--stop]" >&2; exit 2 ;;
  esac
done
PIDFILE=".serve-local-$PORT.pid"
stop_ours() {
  if [ -f "$PIDFILE" ]; then
    pid=$(cat "$PIDFILE")
    if ps -p "$pid" -o command= 2>/dev/null | grep -q "pages_serve.mjs"; then kill "$pid" 2>/dev/null || true; sleep 1; fi
    rm -f "$PIDFILE"
  fi
}
stop_ours
if [ "$STOP" = 1 ]; then echo "serve_local: port $PORT stopped"; exit 0; fi
if lsof -iTCP:"$PORT" -sTCP:LISTEN -P >/dev/null 2>&1; then
  echo "serve_local: port $PORT is already used by something this script did not start:" >&2
  lsof -iTCP:"$PORT" -sTCP:LISTEN -P >&2 || true
  exit 1
fi
if [ "$BUILD" = 1 ]; then
  # wasm-strip is only for the public bundle's size; a local view does without it
  STRIP="${WASM_STRIP:-$(command -v wasm-strip || command -v true)}"
  PAGES_OUT=dist-local PAGES_SKIP_LEAKCHECK=1 WASM_STRIP="$STRIP" node tools/build_pages.mjs
fi
[ -d dist-local ] || { echo "serve_local: no dist-local/ yet; run without --no-build" >&2; exit 1; }
nohup node tools/pages_serve.mjs dist-local --port "$PORT" > ".serve-local-$PORT.log" 2>&1 &
echo $! > "$PIDFILE"
sleep 1
echo "serve_local: http://localhost:$PORT/  (pid $(cat "$PIDFILE"); stop with: tools/serve_local.sh --port $PORT --stop)"
