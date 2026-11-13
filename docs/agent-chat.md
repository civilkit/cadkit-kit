# In-app chat (Claude Code provider)

Issue #15. A panel in the app where the user types a change and an assistant edits the open part. It runs the user's own Claude Code (the `claude` command-line program, signed in with their plan) through the local service. The page holds no API key and no account; there is no server of ours.

## Parts

```
ChatPanel (page) -- POST /bridge/chat, NDJSON back --> daemon -- spawn --> claude -p ... --mcp-config --> ck-mcp shim --> daemon /rpc
                                                                                                           app_* tools --> bridge --> the page's handlers
```

* Page: `apps/cad/src/chat/` (`types.ts` the provider interface, `claudeCode.ts` the provider, `chatSession.ts` messages/Stop/model/context, `ChatPanel.tsx`). Strings in `apps/cad/src/locales/chat.ts`.
* Daemon: `packages/mcp/src/chat.ts` (the process and the event mapping), the route in `packages/mcp/src/daemon.ts`.
* Tools: the `app_status`, `app_state`, `app_screenshot`, `app_run_script`, `app_undo`, `app_redo` tools of `docs/agent-bridge.md`, the read-only measuring tools `app_bodies`, `app_measure`, `app_clearance`, `app_interference`, `app_thickness`, `app_draft`, `app_dfm` (CHAT_TOOLS in `packages/mcp/src/chat.ts`; the same permission as `app_state`), plus the read-only `docs` and `list_methods`. The page executes them through the same handler as a linked agent, so the edit permission box (Settings, Agent link; shown in the panel too) gates `app_run_script`, `app_undo` and `app_redo` exactly as before (the measuring tools only read), and every edit is one undo step with a notice.

## Auth and what the route can do

`POST /bridge/chat` is one more route under `/bridge/`: same loopback `Host` check, same `Origin` rule (loopback page or `--allow-origin`), and it takes the **session token** the pairing code bought. No new credential. The daemon token does not open it.

The body is `{text, model, resume?}`. `model` must be `opus`, `sonnet` or `haiku`; `resume` must be a UUID (the id of an earlier reply); `text` is at most 20 000 characters. Nothing else reaches the command line. The process is started with a fixed argument list and no shell:

`claude -p --output-format stream-json --verbose --include-partial-messages --model <alias> --tools "" --strict-mcp-config --mcp-config <this server's shim> --allowedTools mcp__ck-cad__app_state,...(the eight tools above) --permission-mode dontAsk --setting-sources project --settings {"disableAllHooks":true} --disable-slash-commands --max-turns 24 --append-system-prompt <fixed text> [--resume <id>]`

The prompt goes on stdin. There are no built-in tools (no Bash, no file access), only the allow-listed tools of this server, anything else is refused without asking, and the working directory is an empty temporary folder that is removed when the daemon stops. One turn runs at a time; a second gets the `busy` error.

## Events (newline-delimited JSON)

`{type:'session', id}` (keep it to continue the conversation), `{type:'text', delta}`, `{type:'tool', id, name}`, `{type:'tool_result', id, ok}`, `{type:'done'}`, `{type:'error', code, detail?}` with `code` one of `claude_missing`, `not_logged_in`, `rate_limit`, `overloaded`, `cap` (the 24-step limit), `busy`, `bad_request`, `failed`. Tool inputs and results are not relayed (the scripts and the part stay between the process and the page). **Stop** is closing the request: the daemon sends the process SIGTERM (SIGKILL after 2 s).

## Starting it

`node <checkout>/packages/mcp/bin/ck-mcp.mjs --pair [--allow-origin <page origin>]` starts the daemon if needed and prints a pairing code; the user pastes it in the Chat panel (or Settings, Agent link). `CK_CLAUDE_BIN` names a different `claude` executable.

## Privacy

Sent to Claude, through the user's Claude Code: the message, the context boxes ticked (Selection: the selected ids; View: asks it to take a picture; Comments: the script saved with the part), and what the tools return (features, variables, pictures, the scripts it writes). Claude Code keeps its own session files on the user's computer, as it does for any use. Nothing is stored in the document.

## Tests

`packages/mcp/src/chat.http.test.ts` runs the real route against a FAKE `claude` (a node script printing canned stream-json): auth, input checks, the fixed argument list, events, resume, error codes, Stop, one-at-a-time. `apps/cad/src/chat/chat.test.tsx` covers the session, the panel and the provider with a fake provider / fake fetch. No real Claude Code, model or network is used in any test.

## Not built

A direct API-key provider (the `ChatProvider` interface in `chat/types.ts` is where it would go), starting the daemon from the Mac app, and sending the user's real camera.
