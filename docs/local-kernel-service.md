# Local kernel service

The app's geometry kernel normally runs inside the browser (WebAssembly). It can instead use a **local kernel service**: the same kernel built as a native program that runs on your computer. It is several times faster on large parts, is not limited by the browser's memory ceiling, and keeps its caches warm between edits. The plan is in `plan-local-kernel-service.md`. Status: experimental; the app side is described here, the service (`ck-native`) is built in the kernel repository.

Nothing changes unless you switch it on. The built-in kernel is the default and is always the fallback.

## Use it

1. Start the service on the same computer as the browser (the `ck-native` program from the kernel repository). It listens on `127.0.0.1` only, default port 7461, and needs a **token** for every request. It creates the token the first time it starts and tells you where it is stored. Treat the token like a password: anyone who has it can run the kernel on your machine.
2. In the app open Settings, tab **Kernel**. Choose **Local service (faster, runs on this computer)**.
3. Check the **Service address** (default `http://127.0.0.1:7461`) and paste the **Access token**.
4. Press **Test connection**. It shows the kernel version, the protocol version and the number of cores, or says why it cannot be used. Nothing is switched by the test.
5. The part you have open is reopened on the service as soon as the mode, address or token is changed (undo history is kept). A footer chip **Kernel** shows the state: connected (with the kernel version), connecting, or built-in (service off). Click it to open the Kernel tab. Choosing **Built-in** again moves the part back.

The token is stored in this browser's local storage only. It is sent as an `Authorization: Bearer` header, never in a URL, and it is not written to notices, status text or logs. Clearing the field removes it.

## Same kernel or not at all

On connect the app asks the service for `GET /version` and compares it with the kernel this app was built with:

* the **protocol version** must be the same (`KERNEL_PROTOCOL`, `packages/kernel-client/src/protocol.ts` in the kernel repository; bump it with the service whenever a message or reply changes shape);
* the **build** the service reports (its build id or git hash) must name the same build as the built-in kernel's commit string (equal, or a hash prefix of it).

If either differs the app refuses the service, stays on the built-in kernel and shows a notice with the reason (for example "it is a different kernel build than this app (protocol 2 (this app speaks 1))"). The two kernels are never mixed inside one document.

## If the service stops

If the service cannot be reached when the app starts, the token is missing or refused, or the version does not match, the built-in kernel is used and a notice says why.

If the service fails **while you work** (it was stopped, it restarted or timed the session out, the token was rejected, or a request got no reply in five minutes), the app:

1. shows one notice ("The local kernel service stopped: ... The part was reopened on the built-in kernel.");
2. switches to the built-in kernel and reopens the part there from the last good state, keeping the undo history (the same path as the Cancel button of a long rebuild). The edit that was running when the service failed is not applied; repeat it;
3. stays on the built-in kernel until you press **Try the service again** in the Kernel tab (or change the setting), so it never flips back and forth silently.

A request the service refuses for a reason of its own (a kernel crash on one request, a request that is too large) is reported on that request like a built-in kernel trap and does not trigger the fallback.

A cancelled preview aborts the request in flight and starts a clean session on the service, like restarting the built-in worker.

## Browser caveats

Any web page can try to call a local server, so the service demands the token and checks `Origin` and `Host`. What a browser allows depends on where the app is loaded from. These are expected behaviours to verify, not guarantees:

* The app served from `http://localhost:5173` (development) talking to `http://127.0.0.1:7461`: works in every browser.
* The app served over **https** (the published site) calling `http://127.0.0.1`: allowed in Chrome and Firefox for loopback addresses, provided the service answers the CORS preflight with the private-network headers (`Access-Control-Allow-Private-Network: true`) and lists the app's origin. Recent Chrome versions may ask once for permission to access devices on your local network; allow it. The app adds the `targetAddressSpace: 'local'` hint to its requests for this.
* **Safari** may block an https page from calling an http address. Use the built-in kernel there, or run the service with a local https certificate if it offers one (planned: `ck-native --tls`).
* Use `127.0.0.1` or `localhost` as the address. A LAN or remote address is out of scope for now (it needs real authentication and TLS).
* Browser extensions or security software that block local connections make the test say "no answer from the service".

## What the app expects from the service

The service side is specified in the plan; these are the details the app relies on:

* `GET /version` returns JSON with `kernel` (crate version), `protocol` (number), `git`, `build` and `cores` (snake_case and camelCase spellings are both read).
* `POST /session` returns `{"session": "<id>"}`. `POST /session/<id>/rpc` takes the same text body the WebAssembly kernel is given (`{"id": n, "msg": {...}}`) and answers with the reply bytes unchanged (`[u32 json length][json][padding][buffers]`). `DELETE /session/<id>` ends the session; the app does this when the document is closed, the kernel is switched, or the page closes.
* Every request carries the bearer token; a wrong or missing token must answer 401 or 403.
* Unknown or expired session: 404. A crash inside the kernel on one request: a 5xx status with a short text body (the app shows it as a trap). Too large a body: 4xx.
* The server should keep idle connections open for longer than 30 seconds. While a session is idle the app sends a harmless request every 30 seconds (an unknown message type, `ping`, which the kernel answers with an error reply) so an idle-session timeout on the service does not drop it.
* Requests of one session are sent one at a time, in order, like the single built-in worker.

## Running the kernel tests against a service

The kernel test suites (`*.kernel.test.ts`) normally run on the built-in kernel with `CK_WASM=<path to ck_wasm.wasm>`. To run them on a service instead:

```
CK_KERNEL_URL=http://127.0.0.1:7461 CK_KERNEL_TOKEN=<token> npx vitest run apps/cad/src/bodies.kernel.test.ts
```

`Session.open` (kernel repository, `packages/session`) uses the service whenever `CK_KERNEL_URL` is set, even when a test also passes a wasm path; the Vitest setup `tools/vitest.kernel-env.ts` sets `CK_WASM` to the app's wasm path when only `CK_KERNEL_URL` is given, because the suites use it as their on/off switch. An unreachable service, a wrong token or a different build makes the tests fail instead of quietly using wasm.

Until `ck-native` exists, the kernel repository has a stand-in that serves the wasm kernel with the same HTTP shape (token, `/version`, sessions):

```
cd packages && npm run build
CK_WASM=<ck_wasm.wasm> MOCK_TOKEN=abc123 node dist/kernel-client/src/mock-service-cli.js 7461
```

It is also useful for trying the Settings tab. It runs one WebAssembly instance per session on a single thread, so it is not faster than the built-in kernel.

## Code map

* Kernel repository (`packages/kernel-client/src`): `native.ts` (NativeKernel: transport over fetch, handshake, error mapping), `mock-service.ts` and `mock-service-cli.ts` (test stand-in), `protocol.ts` (`KERNEL_PROTOCOL`); `packages/session/src/session.ts` (`CK_KERNEL_URL`).
* Kit: `apps/cad/src/kernelService.ts` (preferences, the router that chooses and falls back, status texts), `SettingsDialog.tsx` (Kernel tab), `main.tsx` (wiring and footer chip), tests `kernelService.test.ts`, `kernelService.kernel.test.ts`, `SettingsDialog.test.tsx`.
