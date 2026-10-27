# Plan: a local native kernel service, selectable from the browser app

Status: plan, 2026-10-19. Nothing here is built. Related: kernel `docs/spec-agent-interface.md` (the protocol), `docs/regen-cache.md` (why a warm process matters), `docs/robustness.md` (budgets), kit `docs/future-cad-llm.md` and `docs/plan-agent-layer.md` (an agent drives the same service).

## Why

- Measured: the whole fan shroud runs about 3x slower as wasm than as a native build (previous speed work, same functions hot in both). Native is also free of the browser's memory ceiling and can use several cores.
- The kernel's protocol is already transport-agnostic: one call is a JSON message in and framed reply bytes out (`ck_server::handle(body) -> reply`). `ck-wasm` is a thin wrapper (`ck_alloc`, `ck_request`, `ck_reply`) around it, and the kit reaches it through the `KernelTransport` interface (`packages/driver/src/verify.ts`) implemented by the module-worker client (`packages/kernel-client`). A native service is another implementation of the same interface.
- A long-lived native process keeps the regen cache warm between edits, and is the natural way for an LLM agent to drive the kernel (no browser needed).

## Shape

```
browser app (wasm kernel built in)  <--- setting: Kernel = Built-in | Local service --->  ck-native (installed binary)
  KernelTransport                         same JSON messages,                              one OS thread + kernel instance per session
  WorkerKernel (wasm) | NativeKernel      same reply bytes                                 listens on 127.0.0.1 only, token required
```

- **ck-native**: one binary, new crate `crates/ck-native` in the kernel repo, outside the default workspace members so the wasm build and the gate are untouched. It links the same crates as `ck-wasm` and calls `ck_server::handle`. Hooks installed exactly as `ck-wasm/src/engine.rs` does. Kernel state (regen cache, tags, thread-locals such as `REPLY`) is per thread, so one worker thread per session keeps it exactly like one wasm instance per Worker.
- **Transport**: HTTP/1.1 on 127.0.0.1: `POST /session` (open, returns a session id), `POST /session/<id>/rpc` (body = the message, reply = the reply bytes unchanged, optionally gzip), `DELETE /session/<id>`, `GET /version` (kernel crate version, protocol version, git hash, wasm-equivalent build id, cores). A WebSocket variant (`/ws`) for streaming and previews is phase 3.
- **Clock**: the wasm host supplies `ck_now`; native uses a monotonic clock. Replies carry `ms`, so byte comparison with wasm normalises it (as the wire gate already does).
- **App side**: `NativeKernel implements KernelTransport` (fetch, abort support for cancelled previews), a Settings entry "Kernel: Built-in (wasm) | Local service", the service address and token, a status dot (connected, version, session count), automatic fallback to wasm when unreachable (with a notice), and a version handshake: the app refuses a service whose protocol or kernel version differs from the one it was built against, so two kernels never mix inside one document.

## Security (the part that is easy to get wrong)

Any web page can try to call a local server. Required from phase 1:
- bind 127.0.0.1 only (never 0.0.0.0), random port or fixed port from config;
- a bearer token generated at first start (file in the user's config dir, mode 600), required on every request; the app asks the user to paste it once (or gets it from a `ck-native --pair` handshake with a one-time code shown in the terminal);
- check `Host` (must be 127.0.0.1 or localhost) and `Origin` (allow-list: the app's origins, default localhost:5173 and the published site) to stop DNS rebinding and cross-site calls; answer CORS preflight only for allowed origins, including the Private Network Access header Chrome sends;
- per-session limits: `featureTimeMs`/`regenTimeMs` (already in the kernel), maximum request body and reply size, maximum sessions, idle session timeout, memory cap per session;
- no file system access from requests (the protocol has none beyond the document); log without document contents.
Known browser caveat, to verify not assume: an https page (the Cloudflare site) calling `http://127.0.0.1` is allowed in Chrome and Firefox with the private-network checks above; Safari may block it. `http://localhost:5173` talking to localhost works everywhere. If Safari blocks the published site, offer a local https certificate option (`ck-native --tls`) or tell Safari users to use the built-in kernel.

## Phases

1. **Kernel: ck-native, minimal.** Crate, `handle` loop, per-session threads, `/version`, `/session`, `/rpc`, token and Origin checks, limits. Smallest possible dependencies (a tiny HTTP crate or hand-rolled std::net: decide and document; no async runtime unless needed). Tests: protocol tests over a loopback socket; the wire cases of `tools/cases.mjs` (280) sent through the server and compared with the wasm replies (ms normalised) must match byte for byte; a script `tools/native_diff.mjs`; the hair dryer and fan regen replies identical; an auth/Origin test matrix (missing token, wrong token, bad Origin, bad Host, oversized body, unknown session).
2. **Kit: NativeKernel and settings.** Transport class, setting, status dot, fallback, version handshake, tests against a mock server and (when available) the real binary through the existing kernel tests (`CK_KERNEL_URL` as an alternative to `CK_WASM`, so the whole kernel test suite can run against the service).
3. **Speed and polish.** gzip replies, binary buffers for meshes instead of JSON number arrays (reply is 23 MB for the hair dryer), cancel of an in-flight regen, WebSocket for previews, multi-core tessellation, a `--pair` flow, a launch agent / `brew` formula or a simple install script, an installer check for the version.
4. **Gate for the native build.** CI builds ck-native, runs the wire/valid/vol/step corpora and the fan/large replies through it, and fails if any reply differs from the wasm. Release notes tie each app version to a service version.
5. **Agent use.** The MCP server in `packages/session` can use the service as its kernel (faster and warm), the same way the app does.

## Costs and decisions to make

- A second build of the kernel to keep identical to the wasm: the gate in phase 4 is what protects that; until it exists, treat the service as experimental.
- Per-edit latency is local (microseconds of socket) so it only wins; the 23 MB replies are acceptable on localhost, and phase 3 trims them.
- Where the service runs: the user's machine (default), or the CI box / a VM for shared use (needs real authentication and TLS: out of scope for v1).
- Packaging for macOS first (the user's machine); Linux next; Windows later.
- Licence and dependency review for any new crate in the server.

## Order of work and size (rough, unverified)

Phase 1 about 1 to 2 days, phase 2 about half a day, phases 3 to 5 each a day or less. First useful milestone: phases 1 and 2 together, switchable in Settings, passing the wire-identical test.
