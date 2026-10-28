# Spec: the local kernel module (installable service shared by our apps)

Status: draft for review, 2026-10-20. Builds on what exists: kernel `docs/native-service.md` (`ck-native`, phase 1), kit `docs/plan-local-kernel-service.md` and `docs/local-kernel-service.md` (the settings tab, router, fallback), and `docs/spec-agent-interface.md` (the protocol). Nothing new is built by this document.

## 1. Purpose

One installed program on the user's machine that runs the CAD kernel natively and is shared by every client that wants it:
- the cadkit web app (instead of the built-in wasm kernel: native is faster and has no browser memory ceiling);
- CivilKit (it vendors the kernel as wasm today: it would use the same service for connection solids, plates and FEA geometry);
- an LLM agent (MCP server or a script) that wants a warm, persistent kernel without a browser;
- command-line tools and CI (batch regen, STEP export, benchmarks).
It is also the rendezvous for apps that need to talk to each other (live link between CivilKit and cadkit, section 6), which browsers otherwise make hard across origins.

Non-goals: no cloud, no accounts, no document storage (the service holds sessions in memory only), no file access on behalf of clients, no UI.

## 2. Module boundaries (what ships)

| piece | what | where |
|---|---|---|
| `ck-native` | the service binary; same kernel code as the wasm | kernel repo, `crates/ck-native` |
| protocol | JSON message in, framed reply out (`ck_server::handle`); versioned; identical to wasm | kernel `docs/spec-agent-interface.md` |
| transport v1 | HTTP/1.1 on 127.0.0.1 (exists) | native-service.md |
| transport v2 | WebSocket + binary frames, gzip, cancel, events (new) | section 4 |
| client library | `KernelTransport` implementations (`NativeKernel` exists), discovery, pairing, version negotiation, fallback to wasm | kit `packages/kernel-client` (+ a copy-free import for CivilKit) |
| hub | named channels between clients of the same machine (new) | section 6 |
| installer | per-OS install, start at login, update | section 8 |

The module's public contract is: the protocol, the transport endpoints, the pairing and auth rules, and the capability report. Everything else may change.

## 3. Discovery, pairing and auth

- **Address:** `127.0.0.1:7461` by default (documented, and the one allowed default in the pages leak check); the port is configurable; clients may also probe a short list (7461, then 7462 to 7469) and a user-entered address.
- **Capability report:** `GET /version` keeps needing the token, like every other call. A new unauthenticated `GET /ping` returns only `{"service":"ck-native","protocol":N}` with CORS for allowed origins so a page can tell "installed and running" from "not running" without a token and offer the right message.
- **Token today:** one 256-bit token file; the user pastes it once into Settings. Keep it working.
- **Pairing (new):** `ck-native --pair` prints a short one-time code (valid 2 minutes, single use). A client sends `POST /pair {code, origin, label}`; the service answers with a **per-client token** bound to that origin and label. The user sees paired clients with `ck-native clients` and can revoke each (`ck-native revoke <id>`). The shared token file remains for scripts and CI.
- **Origin policy:** an explicit allow-list, per paired client; default only `http://localhost:5173`. A page whose origin is not allow-listed gets no CORS headers and 403. The service never accepts `Origin: null`. A wildcard is not offered.
- **Browser rules:** answer the Private Network Access preflight; document the per-browser behaviour (`targetAddressSpace` hint must not be sent from a page that is itself on localhost; an https site calling http://127.0.0.1 works in Chrome and Firefox, Safari may block: offer the optional local TLS certificate, `--tls`, or use the built-in kernel).

## 4. Transport v2

v1 (HTTP request per message) stays and is always available. v2 adds, behind capability flags the client reads from `/version`:
1. **WebSocket** `/session/<id>/ws`: the same messages as frames; replies as binary frames in the existing framing; unsolicited **events** (progress, regen phase, cache stats) as JSON frames with an `event` field.
2. **Binary meshes:** replies carry mesh buffers as raw f32/u32 (they already do: keep) and the JSON no longer repeats number arrays for large bodies (the 23 MB large reply becomes about a tenth).
3. **gzip** (`Accept-Encoding`/permessage-deflate) for JSON parts.
4. **Cancel:** `DELETE /session/<id>/request/<request-id>` or a `cancel` frame; the kernel checks a cooperative cancel flag at feature boundaries and inside long loops, returns `{"error":"cancelled"}`, and the session state stays valid (the regen cache keeps what finished).
5. **Backpressure and fairness:** per-session queue depth 1 by default (a newer preview replaces a pending one); a global CPU budget so one client cannot starve others (round-robin between sessions).
6. **Limits:** per-session memory cap (reported in `/version`; exceeding it ends the request with a structured error, not a crash); the existing body, reply, session and idle limits.

## 5. Sessions and documents

- A session is one kernel state (regen cache, tags): exactly one wasm instance's worth. Created by `POST /session`, closed by `DELETE` or idle timeout.
- **Shared sessions (new):** a client may attach a second connection to an existing session id as `read` or `write` when the first client allows it (`POST /session/<id>/share {role}` returns a share key). The hub (section 6) uses this for the live link: CivilKit writes the part, cadkit attaches read-only and renders.
- The service never writes a document to disk and never reads one: clients send the document in every `regen`. Exports (STEP etc.) are returned as bytes.
- Reproducibility: a request and its reply are the same bytes as the wasm gives for the same kernel build, except `ms` and the two floating-point libm differences already documented (the CI check compares them).

## 6. Hub: talking between apps on one machine

Problem: CivilKit and cadkit run in different origins, so `BroadcastChannel` and workers cannot connect them (see kit docs discussion of inter-tab and subdomain options). The service is a neutral meeting point.
- **Channels:** `GET /hub/ws?channel=<name>` (WebSocket). Names are namespaced by the paired client's label (for example `civilkit.joint-42`). A client can only join channels its pairing allows (`channels` list in the pairing record).
- **Envelope:** `{ "v": 1, "type": "part.open" | "part.update" | "part.massprops" | "selection" | "ping" | ..., "from": client-id, "seq": n, "body": {...} }`, JSON, at most 16 MiB, types are a closed list per channel contract (so the service can drop anything else); bodies are protocol messages or plain data, never code.
- **Delivery:** at-most-once, ordered per channel, last-value cache for `part.update` so a late joiner gets the current state.
- **Consent:** the first message from a new client to a channel that has an existing member is held until that member's user accepts (an event `hub.request` the app shows as a prompt). Apps decide what to do with `part.open`.
- **Browser-only fallback** (service not installed): `BroadcastChannel` when both apps share an origin, else `postMessage` between windows the user opened from one app. The bridge module hides the three transports behind one interface.

## 7. Security model

| threat | control |
|---|---|
| any web page calls the service | bind 127.0.0.1; token or pairing required; Origin allow-list; Host check (DNS rebinding); PNA preflight |
| a paired app is malicious or compromised | per-client tokens, revocable; per-client channel list; limits per client; no file or network access exists in the protocol |
| denial of service | body, reply, session, memory and queue limits; fairness; per-client rate limit; cancel |
| data leakage in logs | request log is method, route, status, size, ms only; panic logs carry source location only; never bodies or tokens |
| supply chain | no third-party runtime dependencies in the service (today: none); the installer is signed and checksummed; auto-update only from a pinned source with signature verification |
| stale or mismatched build | version handshake: protocol number plus build id; a client refuses a service whose protocol or kernel build differs from the one it was verified against and falls back to wasm, so two kernels never mix inside one document |
| local privilege | runs as the user, never as root; the config dir is mode 700; the token files mode 600 |

## 8. Packaging, lifecycle, updates

- **Install:** macOS first: a signed `.pkg` or a Homebrew formula; a launch agent starts it at login on 127.0.0.1 only. Linux: a user systemd unit and a tarball; Windows later.
- **Start/stop:** `ck-native start|stop|status|pair|clients|revoke|version`; the menu-bar or tray item is optional and out of scope.
- **Update:** the client shows "service v.. is older than this app expects" with the update command; `ck-native update` checks a signed manifest (version, checksum, notes). The service supports the previous protocol number for one release (N-1) so an app update never strands a service.
- **Uninstall:** one command removes the binary, launch agent and config.

## 9. Verification and gates

- Existing: `tools/native_diff.mjs` (280 wire cases byte-identical to the wasm, big documents within last-digit float noise), loopback protocol tests, auth/Origin/Host matrix.
- New CI gate (kernel): build `ck-native` with the service profile, run the wire/valid/vol/step corpora and the fan and large sample through it, fail on any difference beyond the documented libm tolerance; run the pairing, revoke, limit, cancel and hub tests; fuzz the HTTP parser and the WebSocket framing (no panics).
- Conformance suite: a client-agnostic script (`tools/service_conformance.mjs`) that any client implementation (kit, CivilKit, an MCP bridge) can run against a live service.
- Performance: native vs wasm timings per case on the CI box (kept in the repo as data), so a regression shows.

## 10. Milestones

1. **v1.1 (small):** `/ping`, pairing and per-client tokens, revoke, origin allow-list per client, the CI gate above. Kit: Settings shows the paired state; discovery probes the port list.
2. **v2:** WebSocket, gzip, cancel, events, per-session memory cap, fairness. Kit: previews cancel stale requests; progress in the status bar.
3. **Hub:** channels, consent prompt, shared sessions; kit bridge module with the three transports; CivilKit "Open in CAD kit" and the live parameter link.
4. **Packaging:** signed macOS installer and launch agent, update command, uninstall.
5. **Agent use:** the MCP server in `packages/session` targets the service by default when it is present (warm cache across calls).

## 11. Open questions

1. Is the service to be redistributed publicly (licence, signing, notarisation), or private use only for now? That sets how much of section 8 is needed.
2. Is CivilKit allowed to import the kit's client library, or must it have its own copy of the thin client?
3. Should hub channels be able to carry kernel requests on behalf of another client (a CivilKit session asking cadkit's session for mass properties), or only data the owner publishes? The second is safer; the first is more convenient.
4. Port policy: fixed 7461 with a documented fallback range, or a random port discovered through a registry file in the config dir (more private, needs a helper for browsers)?
5. TLS: required for Safari support of an https page calling the service, or accept "use the built-in kernel" there?
6. Branch history (section 13): real git remote plus synced-folder exports, or the built-in commit store only? Sections 12 to 14 assume the built-in store with files that git could also hold.
7. Who maintains the markup link convention (section 14) for RedColumn: a thin adapter of ours, or a change upstream?

## 12. Contracts and versioning (added 2026-10-21)

Goal: two or more programs (cadkit, CivilKit, RedColumn through an adapter, an agent) release on their own schedules and still interoperate. So the contracts are versioned, not the codebases. An app keeps its own app version.

| contract | version carried in | lives in |
|---|---|---|
| document format | `format` field in every `.ckpart` and snapshot | kernel `docs/` + schema file |
| kernel protocol | protocol number + kernel build id (`/ping`, `/version`) | kernel `docs/spec-agent-interface.md` |
| hub envelope | `v` in the envelope | section 6 |
| hub topic (per message type) | semver per topic | schema registry (below) |
| link field (section 14) | `v` inside the field | schema registry |

Rules:
- **Within a major version:** readers ignore unknown fields; a minor version only adds optional fields; a patch changes no shape.
- **A major bump** needs a migration and a documented N-1 window of one release (the service already supports the previous protocol, section 8).
- **Each client declares** the contract versions it reads and writes. Outside the range it refuses with a structured error and falls back to its built-in behaviour (wasm kernel, no live link). It never guesses.
- **Results are tied to the build:** a result that crosses apps carries the kernel build id, and an app does not treat results from different builds as the same state.
- **Schema registry:** one JSON schema file per topic and per contract, in a repository both sides can read, named `<topic>@<semver>.json`. A change that is not backward compatible must change the major version; CI checks this by running the previous version's example messages against the new schema.
- **Conformance, not version matching, is the proof:** `tools/service_conformance.mjs` (section 9) is extended with the hub topics and the link field, and runs in every participating repo's CI. A compatibility table (app version x contract versions) is generated from it, not hand-written.
- **Code owned by others** (RedColumn) is not versioned by us. We version the adapter and the contract it implements.

## 13. Shared storage and branching (added 2026-10-21)

Context: CivilKit already has git-style branching: a deterministic canonical snapshot whose hash is the commit identity, entities matched by stable id, a structural diff, and a three-way merge that reports clean merges and conflicts. The CAD kernel is a good fit for the same pattern, because a `.ckpart` is deterministic and regenerates deterministically.

- **Commit identity:** hash of the canonical document bytes plus the kernel build id.
- **Entity identity:** features and stable face names play the role of entity ids. Every feature in a document must carry a stable id before any merge is attempted (to verify).
- **Diff:** feature-level (added, removed, changed parameter) and, from the kernel, geometry-level (volume, changed faces). Both deterministic.
- **Merge:** three-way at feature level. The merged document must regenerate and pass validation; on failure the result names the first broken feature (a structured refusal, like other kernel refusals).
- **Where history lives:** in files owned by the user, not in the service (the service never writes documents). The hub carries commit identities only, never the history.

Shared storage on Google Drive, Dropbox or OneDrive treats them as dumb file sync. They offer no locking and create "conflicted copy" files, so the layout must make conflicts impossible or visible:
- `objects/<hash>`: immutable commit and blob files named by content. Two writers of the same hash write identical bytes, so these never conflict.
- `refs/<branch>/<client-id>`: one head file per client and branch. The branch head is computed by reading all of them; diverging heads are a merge to resolve. No file is written by two clients.
- A conflicted-copy file is detected by name and surfaced to the user as a conflict, never ignored.
- No `.git` directory inside a synced folder (sync clients corrupt object stores). If real git is wanted, use a git remote and keep the synced folder for exports.
- Two ways to reach a provider: (a) a local synced folder (one code path for all three, no OAuth, File System Access API in Chromium); (b) per-provider API adapters with one interface (list, get, put-if-match, delete), using each provider's revision tag as compare-and-swap (to verify per provider). Start with (a).
- Optional shared stores such as RedColumn's own OneDrive live sessions stay outside this contract.

## 14. Hub additions: registry, blob cache, links (added 2026-10-21)

- **Schema registry:** section 12. Hub types are checked against it; the service drops anything not registered.
- **Blob cache:** a hash-keyed store inside the service for bulk data (meshes, results, drawing sheets as PDF bytes). A client publishes `{hash, bytes}` once and messages carry only the hash; receivers pull on demand. In memory only, with a size cap and eviction, never written to disk, consistent with section 5. Because sessions are deterministic, a hash identifies a result for all clients.
- **Link field (v1):** `{ v, model, branch, commit, element }` where `element` is a stable name (`part`, `face`, `joint-42`), plus the unit and scale for any quantity. A quantity without a recorded scale and unit is not trusted.
- **Stale detection:** the hub compares a link's `commit` with the branch head and emits a "model changed since measured" event, so dependent markups and quantities are marked stale instead of silently wrong.
- **Markup interchange:** XFDF (standard PDF annotation exchange) is the first external contract, with the link field carried as a custom field on each annotation. Reference client: RedColumn (open source, Apache-2.0, runs in the browser or desktop, annotations as standard PDF, XFDF and CSV export). Its internal annotation code must be read before the convention is fixed.
- **Not adopted (for now):** a general content-addressed network store, a WIT/component-model bus, and MCP as app-to-app transport. MCP remains the route for an agent reading an open drawing or model.
- **First consumer to prove it:** a read-only query package (Mathcad-style) subscribing to the hub.
