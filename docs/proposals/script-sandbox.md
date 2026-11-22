# Proposal: isolate user script execution

Status: proposal, not implemented. Owner decision needed.

## Finding

`packages/script/src/run.ts` runs user scripts with `new Function` (or an async function when the source has `await`). The `DENIED` list
shadows names (`window`, `document`, `fetch`, `globalThis`, `Function`, `localStorage`, ...) by passing `undefined` for each as a parameter.
That stops a script that writes those names. It does not stop a script that reaches the same objects through a value:

```js
(function () {}).constructor("return this")()      // the real Function constructor, in sloppy mode: `this` is the global object
[].constructor.constructor("return this")()
```

The test `packages/script/src/sandbox.escape.test.ts` runs both and checks whether the global object was reached. Result: **the escape works**
(both cases reach the global object; the tests are `it.fails` so they document it without breaking the suite). From the global object a script
has `fetch`, `localStorage` (including the local kernel-service token, see `kernelService.ts`), `document`, IndexedDB and the whole app.
The loop guard (`guardLoops`) and `MAX_SOURCE` are accident protection only.

`packages/plugin/src/package.ts` has a text lint (`BLOCKED`) that includes `constructor`; its own comment says it is not a security boundary.
It also only covers plugin files, not the other entry points below, and a regex is easy to get around (`this["constr"+"uctor"]`).

## Where scripts come from (sets the priority)

| Source | Untrusted? | Notes |
|---|---|---|
| Script editor in the app (typed or pasted by the user) | the user's own code, but pasted code is common | runs on an explicit Run |
| Script saved inside a `.ckpart` (`script` field), shown in the script panel | yes: a shared file | runs only if the user presses Run, but they are shown the text, not warned |
| Third-party plugins (`pluginRun.ts`, generators) | yes | gated behind the "third-party plugins" switch, which is a consent, not a boundary |
| MCP / agent tools (`agent-tools`, `agentLink/appRun.ts`) | yes: LLM output, possibly steered by a document or web page | runs automatically when the agent calls `runScript` |
| Samples, BOSL catalogue, teardrop, recognise-features | no: our own generated text | |

So scripts do arrive from shared files, plugins and agents. The agent path is the highest priority because it runs without a human reading the
code, and the shared-file path is next. If the app only ever ran the user's own typed scripts this could wait.

## Proposal

Run every script in a dedicated Worker, and make the script API a message protocol.

1. **Worker per run.** A module Worker that imports `makeApi` and `runScript`'s recording half (they are pure: they build the op list and never touch a
   kernel). The code is evaluated inside the Worker. A Worker has no DOM, no `localStorage` and no app state, so reaching its global object gets
   nothing worth stealing except `fetch`/`importScripts`.
2. **Close the Worker's network.** Start it from a blob/data URL with a `Content-Security-Policy` of `connect-src 'none'` (for a blob Worker, serve
   it from a same-origin file with that CSP header; the static host can set it). Also delete `fetch`, `XMLHttpRequest`, `WebSocket`,
   `importScripts`, `indexedDB`, `Function` and `eval` from the Worker global before evaluating, and freeze the intrinsics' `constructor`
   properties (`Function.prototype.constructor` and the async/generator variants replaced with a thrower). That closes the `.constructor` route inside
   the Worker too.
3. **Message API.** Main thread sends `{ code, overrides }`. The Worker replies with `{ state, errors }` (plain JSON: ops, parts, vars, warnings).
   The read-backs (`await part.volume()`) become request/response messages: the Worker posts `{ read: id, need }`, the main thread answers from
   the kernel host (`host.facts`), the Worker resumes. This is what `runScript` already does with promises, so the shape is kept.
4. **Limits that work.** `worker.terminate()` after a time budget replaces the cooperative `__fuel` counter (an endless loop in a Worker no longer
   freezes the page). Cap the result size.
5. **Node and tests.** Node has `worker_threads`; the MCP server (headless) uses the same module through a small adapter. Unit tests that call
   `evaluate()` directly keep working through an in-process adapter flagged "trusted" (samples and our own generators), so the existing 3000+ tests do not change.

An alternative is a sandboxed iframe (`sandbox="allow-scripts"`, null origin) with `postMessage`. It has the same message protocol; a Worker is
lighter and has no DOM at all, so prefer it. A WASM JS interpreter (QuickJS) gives the strongest isolation and no ambient globals, at the cost of a
dependency and slower scripts; keep it as the fallback if the Worker's remaining surface is not acceptable.

## Cost and order

1. Cheap first: replace the denylist with a frozen-intrinsics step run before evaluation (point 2), as defence in depth even before the Worker. A
   day of work, closes the two probes above in the main thread. Not a full boundary (other routes exist), so do not rely on it alone.
2. Worker with message API for the agent and plugin paths: about 3 to 5 days including the read-back protocol and the headless adapter.
3. Move the editor and file-script paths onto it; mark the `it.fails` tests as plain `it`.

## Decision for the owner

Is it acceptable to ship third-party plugins and agent scripts with the present boundary? If not, step 2 gates the "third-party plugins" switch.
