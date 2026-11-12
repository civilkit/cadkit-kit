# Agent link (GUI bridge): an agent sees and drives the open document

Issue #15. Today the MCP server (`docs/mcp.md`) has its own document and kernel; it cannot see the part the user has open in the browser. The agent link lets an agent do that, under the user's control. First slice: local only, explicit opt-in, read and screenshot, plus the script command.

## What it does

An agent calls extra MCP tools (`bridge_pair`, `app_status`, `app_state`, `app_screenshot`, `app_run_script`, `app_undo`, `app_redo`). The daemon forwards them to the browser app, which answers from the document the user has open.

| Tool | Does | Needs edit permission |
| --- | --- | --- |
| `bridge_pair` | opens a one-time pairing code for the user to paste in the app | no |
| `app_status` | linked or not, edit allowed or not, pairing open or not | no |
| `app_state` | name, features (id, type, name, suppressed, error), variables, selection, counts; `detail: full` adds the document JSON | no |
| `app_screenshot` | PNG of the model from `view` at `size` px, drawn from the app's current geometry with the snapshot renderer (the document, not the user's screen: no panels, not their camera) | no |
| `app_run_script` | the same script language as `run_script`, attach mode on the open document: features are added after the existing ones, as ONE undo step, with a notice | yes |
| `app_undo`, `app_redo` | step the app's history | yes |

Built on top of this link: the in-app chat panel (`docs/agent-chat.md`), which starts Claude Code through the daemon with only the `app_*` tools. Not in this slice: the other headless tools (`tree`, `facts`, `probe`, `section`, `drawing`, `export`) against the app's document (`app_state` covers the tree; `app_run_script` with `check`/`expect` covers facts), live mirroring of the agent's own document.

## Transport

```
agent -- MCP/stdio --> shim -- HTTP, loopback --> daemon  <== long poll == browser app
```

The browser cannot accept connections, so the app connects OUT to the daemon on `127.0.0.1:<port>` and long-polls. Four routes, all under `/bridge/`: `POST hello` (pairing), `GET poll` (up to 20 s; returns queued requests), `POST reply`, `POST bye`. Requests are `{id, op, args}` with `op` in `state | screenshot | run_script | undo | redo`; replies are `{id, ok, result | error{code, message, hint}}`. The wire format and both ends live in `packages/agent-link` (no Node or DOM imports); the daemon routes are in `packages/mcp/src/daemon.ts`, the tools in `packages/mcp/src/bridgeTools.ts`, the app side in `apps/cad/src/agentLink/`.

## Consent and auth, on the user's side

1. Off by default and at every start. Nothing is stored: not the code, not the session, not the permission.
2. The user turns it on in Settings, Agent link, by pasting a pairing code the agent got from `bridge_pair`: `<port>-XXXX-XXXX-XXXX-XXXX` (16 characters from an alphabet without look-alikes, about 78 bits). One time use, valid 10 minutes, five wrong tries revoke it, asking for a new one ends the current link.
3. The code buys a session token (256 random bits) used for poll and reply. `/bridge/*` does not accept the daemon token, and the session token opens nothing else in the daemon (`/rpc`, `/health`, `/document`, `/events` refuse it).
4. A second, separate box, "Allow the agent to change this document", is off on every connect. While it is off the agent can read and take pictures only. The daemon refuses edit ops without asking the app, and the app refuses them again when they arrive (it reads the box at each call), so unticking takes effect at once, and the app tells the daemon immediately when the box changes.
5. Visible: a status bar item "Agent: linked, view only | can edit" (click opens the settings), a notice for every script, undo and redo the agent runs, and a Turn off button. Closing the page ends the link.
6. Local only: the daemon listens on `127.0.0.1`; `Host` must be a loopback name (DNS rebinding); a browser `Origin` is accepted on `/bridge/*` only from a loopback page or one listed with `--allow-origin` (the hosted app needs `--allow-origin https://<its origin>`); every other route still refuses any `Origin`. Preflights answer `Access-Control-Allow-Private-Network`. Safari blocks a secure page from calling loopback over plain HTTP; use a local serve there.

## What is exposed

Only what the tools above return: the document the user has open (it contains their features, variables and names) and a rendering of it. Nothing from other tabs, the file system or the clipboard. `app_run_script` is as powerful as the Script tab (it can add and cut features) but cannot save, export or open files, and the user can undo it. Scripts run in the same restricted environment as the Script tab, which is not a security boundary: tick the box only for an agent you trust.

## How it fails

Every failure is an MCP error result `{ok:false, error:{code, message, hint}}`: `app_not_connected` (not paired, or the app stopped polling for 35 s; the hint says to call `bridge_pair`), `edit_not_allowed`, `app_timeout` (60 s, tab in the background or busy), `app_disconnected` (turned off mid call), `no_document`, `no_body`, `snapshot_failed`, `bad_input`, plus the pairing codes `no_pairing`, `code_expired`, `bad_code`. If the daemon goes away the app shows "lost the agent server" after three failed polls and goes back to off. An edit script that fails changes nothing (the kernel rebuilds the candidate first). Calls run one at a time with the other MCP tools. While an app is linked the daemon does not idle out.

## Running it for a demo or recording

`tools/agent_link_demo.mjs` plays the agent so a recording needs no assistant. It starts its own daemon on a free loopback port (state in a private folder under `--out`, so a daemon you already run is untouched), asks for a pairing code, and prints it and writes it to `<out>/pairing-code.txt`. When the app links it runs: `app_status`, `app_screenshot`, then, only if "Allow the agent to change this document" is ticked, `app_run_script` (adds a block beside the part), a second screenshot and `app_undo`. It prints a step line for each, writes `<out>/steps.json` with the timings, and at the end stops only the daemon it started (HTTP shutdown, then a kill of that one child).

```sh
CK_WASM=<path to ck_wasm.wasm> CK_REBUILD=<kernel checkout> node tools/agent_link_demo.mjs --origin http://localhost:5173 --out /tmp/agent-link-demo
```

Options: `--origin` (the local serve's origin; a loopback page is allowed anyway, the flag is for a non-loopback host), `--wasm` (else `CK_WASM`), `--link-wait 180` (seconds to wait for the paste), `--edit-wait 20` (seconds to wait for the edit box before skipping the change, never assumed), `--pause 1500` (ms between steps so a recording can show each). Files written: `pairing-code.txt`, `agent-link-before.png`, `agent-link-after.png`, `steps.json`.

For a recording: open a part that has a solid before the screenshot step (with an empty part the first screenshot reports `no_body` and the script goes on), paste the code in Settings, Agent link, press Turn on, and tick the edit box within `--edit-wait` seconds of the link. Timings seen on a local serve: daemon start about 9 s (the code appears then), link as soon as the code is pasted, `app_status` 5 ms, `app_screenshot` 35 ms to 1.7 s, `app_run_script` 0.2 s, `app_undo` 0.1 s, plus the pauses. The script ends about 15 s after the link with the default pause; the status bar item stays until the user turns the link off or the page closes.

## Tests

`packages/agent-link/src/bridge.test.ts` (pairing, expiry, single use, revocation, request and reply, edit gate, timeouts, aborted polls), `packages/mcp/src/bridge.http.test.ts` (real daemon routes and client on loopback with no kernel: opt-in, token separation, origins and preflight, edit gate on both sides, errors, link ended by a new code), `apps/cad/src/agentLink/appHandlers.test.ts` (what the app exposes and refuses).

## Next

The in-app chat is built (`docs/agent-chat.md`) and reuses this link. Still open: the remaining headless tools against the app document, a screenshot of the live canvas with the user's camera, multiple linked tabs, and a native pairing flow so the code need not be pasted.
